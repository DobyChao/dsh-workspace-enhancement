/**
 * UX-13: automatic reachability probes debounce, cache a reachable result,
 * and back off after a failure. Manual recheck skips the wait.
 * @module test/probe-schedule
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PROBE_BACKOFF_MS,
  PROBE_CACHE_TTL_MS,
  PROBE_DEBOUNCE_MS,
  createProbeScheduler,
  emptyProbeSlot,
  planProbe,
  probeBackoffMs,
  settleProbe,
} from '../src/client/probe-schedule.ts'
import type { ProbeClock, ProbeScheduleConfig, ProbeSlot } from '../src/client/probe-schedule.ts'

const FAST: ProbeScheduleConfig = {
  debounceMs: 100,
  ttlMs: 1_000,
  backoffMs: [50, 200, 500],
}

interface FakeClock extends ProbeClock {
  advance(ms: number): Promise<void>
}

/** A clock whose timers fire only when the test advances it. */
function fakeClock(): FakeClock {
  let now = 0
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = []
  return {
    now: () => now,
    delay(ms, fn) {
      const timer = { at: now + ms, fn, cancelled: false }
      timers.push(timer)
      return { cancel() { timer.cancelled = true } }
    },
    async advance(ms) {
      now += ms
      for (let guard = 0; guard < 20; guard += 1) {
        const due = timers
          .filter(timer => !timer.cancelled && timer.at <= now)
          .sort((left, right) => left.at - right.at)
        const next = due[0]
        if (next === undefined) return
        next.cancelled = true
        next.fn()
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      throw new Error('timer storm')
    },
  }
}

interface Sample { state: 'active' | 'offline' }

test('UX-13 planProbe: the first automatic look waits out the debounce, and a second look does not reset it', () => {
  const first = planProbe(undefined, 1_000, 'auto', FAST)
  assert.equal(first.action, 'wait')
  assert.equal(first.delayMs, FAST.debounceMs)
  assert.equal(first.slot.dueAt, 1_100)
  const second = planProbe(first.slot, 1_040, 'auto', FAST)
  assert.equal(second.action, 'wait')
  assert.equal(second.delayMs, 60)
  assert.equal(second.slot.dueAt, 1_100)
  const due = planProbe(first.slot, 1_100, 'auto', FAST)
  assert.equal(due.action, 'probe')
})

test('UX-13 planProbe: a reachable result is cached until the TTL, then probed again', () => {
  const settled = settleProbe(emptyProbeSlot(), 5_000, 'reachable', FAST)
  const fresh = planProbe(settled, 5_000 + FAST.ttlMs - 1, 'auto', FAST)
  assert.equal(fresh.action, 'skip')
  const stale = planProbe(settled, 5_000 + FAST.ttlMs, 'auto', FAST)
  assert.equal(stale.action, 'probe')
})

test('UX-13 planProbe: failures wait out a growing backoff, and a success clears it', () => {
  const once = settleProbe(emptyProbeSlot(), 0, 'unreachable', FAST)
  assert.equal(once.failures, 1)
  assert.equal(once.dueAt, probeBackoffMs(1, FAST.backoffMs))
  assert.equal(planProbe(once, once.dueAt - 1, 'auto', FAST).action, 'wait')
  assert.equal(planProbe(once, once.dueAt, 'auto', FAST).action, 'probe')
  const twice = settleProbe(once, once.dueAt, 'unreachable', FAST)
  assert.equal(twice.failures, 2)
  assert.equal(twice.dueAt - twice.settledAt, probeBackoffMs(2, FAST.backoffMs))
  const recovered = settleProbe(twice, twice.dueAt, 'reachable', FAST)
  assert.equal(recovered.failures, 0)
  assert.equal(planProbe(recovered, recovered.settledAt + 1, 'auto', FAST).action, 'skip')
})

test('UX-13 planProbe: manual recheck probes immediately unless one is already in flight', () => {
  const cached = settleProbe(emptyProbeSlot(), 0, 'reachable', FAST)
  assert.equal(planProbe(cached, 1, 'manual', FAST).action, 'probe')
  const failing = settleProbe(emptyProbeSlot(), 0, 'unreachable', FAST)
  assert.equal(planProbe(failing, 1, 'manual', FAST).action, 'probe')
  const inflight: ProbeSlot = { ...emptyProbeSlot(), inflight: true }
  assert.equal(planProbe(inflight, 1, 'manual', FAST).action, 'skip')
})

test('UX-13 scheduler: two watches in the debounce window share one probe', async () => {
  const clock = fakeClock()
  const calls: number[] = []
  const seen: Sample[] = []
  const scheduler = createProbeScheduler<Sample>(clock, value => value.state === 'active' ? 'reachable' : 'unreachable', FAST)
  const run = (): Promise<Sample> => {
    calls.push(clock.now())
    return Promise.resolve({ state: 'active' })
  }
  const stopA = scheduler.watch('c1', run, value => seen.push(value))
  const stopB = scheduler.watch('c1', run, value => seen.push(value))
  assert.equal(calls.length, 0)
  await clock.advance(FAST.debounceMs - 1)
  assert.equal(calls.length, 0)
  await clock.advance(1)
  assert.deepEqual(calls, [FAST.debounceMs])
  assert.equal(seen.length, 2)
  assert.equal(seen[0]?.state, 'active')
  stopA()
  stopB()
  scheduler.dispose()
})

test('UX-13 scheduler: a reachable result is not probed again until the TTL', async () => {
  const clock = fakeClock()
  const calls: number[] = []
  const scheduler = createProbeScheduler<Sample>(clock, value => value.state === 'active' ? 'reachable' : 'unreachable', FAST)
  const stop = scheduler.watch('c1', () => {
    calls.push(clock.now())
    return Promise.resolve({ state: 'active' })
  }, () => undefined)
  await clock.advance(FAST.debounceMs)
  assert.equal(calls.length, 1)
  await clock.advance(FAST.ttlMs - 1)
  assert.equal(calls.length, 1)
  await clock.advance(1)
  assert.equal(calls.length, 2)
  stop()
  scheduler.dispose()
})

test('UX-13 scheduler: a failure retries on backoff, and the gap grows', async () => {
  const clock = fakeClock()
  const calls: number[] = []
  const scheduler = createProbeScheduler<Sample>(clock, value => value.state === 'active' ? 'reachable' : 'unreachable', FAST)
  const stop = scheduler.watch('c1', () => {
    calls.push(clock.now())
    return Promise.resolve({ state: 'offline' })
  }, () => undefined)
  await clock.advance(FAST.debounceMs)
  assert.deepEqual(calls, [FAST.debounceMs])
  await clock.advance(FAST.backoffMs[0] - 1)
  assert.equal(calls.length, 1)
  await clock.advance(1)
  assert.equal(calls.length, 2)
  await clock.advance(FAST.backoffMs[1] - 1)
  assert.equal(calls.length, 2)
  await clock.advance(1)
  assert.equal(calls.length, 3)
  stop()
  scheduler.dispose()
})

test('UX-13 scheduler: recheck cancels the debounce and probes once, immediately', async () => {
  const clock = fakeClock()
  const calls: number[] = []
  const scheduler = createProbeScheduler<Sample>(clock, value => value.state === 'active' ? 'reachable' : 'unreachable', FAST)
  const stop = scheduler.watch('c1', () => {
    calls.push(clock.now())
    return Promise.resolve({ state: 'active' })
  }, () => undefined)
  const view = await scheduler.recheck('c1', () => {
    calls.push(clock.now())
    return Promise.resolve({ state: 'active' })
  })
  assert.equal(view.state, 'active')
  assert.deepEqual(calls, [0])
  await clock.advance(FAST.debounceMs)
  assert.equal(calls.length, 1, 'the cancelled debounce must not probe again')
  stop()
  scheduler.dispose()
})

test('UX-13 scheduler: dropping the last watcher cancels a pending probe', async () => {
  const clock = fakeClock()
  let calls = 0
  const scheduler = createProbeScheduler<Sample>(clock, value => value.state === 'active' ? 'reachable' : 'unreachable', FAST)
  const stop = scheduler.watch('c1', () => {
    calls += 1
    return Promise.resolve({ state: 'active' })
  }, () => undefined)
  stop()
  await clock.advance(FAST.debounceMs + FAST.ttlMs)
  assert.equal(calls, 0)
  scheduler.dispose()
})

test('UX-13 scheduler: recheck ignores a fresh cache', async () => {
  const clock = fakeClock()
  let calls = 0
  const scheduler = createProbeScheduler<Sample>(clock, value => value.state === 'active' ? 'reachable' : 'unreachable', FAST)
  const stop = scheduler.watch('c1', () => {
    calls += 1
    return Promise.resolve({ state: 'active' })
  }, () => undefined)
  await clock.advance(FAST.debounceMs)
  assert.equal(calls, 1)
  await scheduler.recheck('c1', () => {
    calls += 1
    return Promise.resolve({ state: 'active' })
  })
  assert.equal(calls, 2)
  stop()
  scheduler.dispose()
})

test('UX-13 scheduler: a superseded in-flight probe cannot overwrite the recheck', async () => {
  const clock = fakeClock()
  let releaseFirst: (value: Sample) => void = () => undefined
  const first = new Promise<Sample>(resolve => { releaseFirst = resolve })
  let calls = 0
  let last: Sample | undefined
  const scheduler = createProbeScheduler<Sample>(clock, value => value.state === 'active' ? 'reachable' : 'unreachable', FAST)
  const stop = scheduler.watch('c1', () => {
    calls += 1
    return first
  }, value => { last = value })
  await clock.advance(FAST.debounceMs)
  assert.equal(calls, 1)
  const settled = scheduler.recheck('c1', () => {
    calls += 1
    return Promise.resolve({ state: 'offline' })
  })
  releaseFirst({ state: 'active' })
  const view = await settled
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(view.state, 'offline')
  assert.equal(last?.state, 'offline')
  assert.equal(calls, 2)
  stop()
  scheduler.dispose()
})

test('UX-13 production timings stay the documented debounce, TTL, and backoff', () => {
  assert.equal(PROBE_DEBOUNCE_MS, 400)
  assert.equal(PROBE_CACHE_TTL_MS, 60_000)
  assert.deepEqual([...PROBE_BACKOFF_MS], [2_000, 8_000, 30_000])
})
