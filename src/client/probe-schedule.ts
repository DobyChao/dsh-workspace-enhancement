/**
 * Reachability-probe schedule (UX-13).
 *
 * Surfaces that show a connection (the sidebar machine list, a remote session
 * header, a settings row) used to read `conn.status` and sit unchecked until
 * a click. This scheduler turns that into an automatic `conn.probe`:
 *
 * - **Debounce.** The first automatic look at an id waits a short quiet
 *   period so a sidebar render burst collapses to one probe. Later requests
 *   in that window do not push the deadline out (a chatty observer must not
 *   starve the probe).
 * - **Cache.** A reachable result is reused for {@link PROBE_CACHE_TTL_MS}.
 *   While something is still watching, the id is probed again when the TTL
 *   ends.
 * - **Backoff.** An unreachable result (or a thrown probe) is shown
 *   immediately and retried at {@link PROBE_BACKOFF_MS}, capped at the last
 *   step. A success clears the failure count.
 * - **Manual.** `recheck` cancels the wait and probes now, ignoring TTL and
 *   backoff. That is the「重新检测」button.
 *
 * The scheduler does not know about RPC. Callers pass the probe function and
 * a classifier. Dropping the last watcher cancels the pending timer; an
 * in-flight probe is allowed to finish and its result stays cached.
 *
 * @module dsh-workspace-enhancement/client/probe-schedule
 */

/** Quiet period before the first automatic probe of an id. */
export const PROBE_DEBOUNCE_MS = 400

/** How long a reachable result is served without a new probe. */
export const PROBE_CACHE_TTL_MS = 60_000

/**
 * Delays after the 1st, 2nd, and later failed probes. The last step repeats.
 */
export const PROBE_BACKOFF_MS: readonly number[] = [2_000, 8_000, 30_000]

/** Automatic interest versus the re-check button. */
export type ProbeMode = 'auto' | 'manual'

/** What a settled probe means for the next schedule. */
export type ProbeOutcome = 'reachable' | 'unreachable'

/** Scheduling fields of one id. Pure helpers take and return this. */
export interface ProbeSlot {
  /** Absent until the first settle. */
  outcome?: ProbeOutcome
  /** Epoch ms of the last settle. 0 before the first. */
  settledAt: number
  /** Failures since the last reachable result. */
  failures: number
  /** A probe function is currently running. */
  inflight: boolean
  /**
   * Epoch ms when the next automatic probe may start.
   * 0 means "not yet scheduled".
   */
  dueAt: number
}

/** What to do for one request. `slot` is the next scheduling state. */
export interface ProbeStep {
  action: 'probe' | 'wait' | 'skip'
  /** Milliseconds until the wait elapses. 0 unless `action` is `wait`. */
  delayMs: number
  slot: ProbeSlot
}

/** Knobs tests shrink. Production uses {@link DEFAULT_PROBE_SCHEDULE}. */
export interface ProbeScheduleConfig {
  debounceMs: number
  ttlMs: number
  backoffMs: readonly number[]
}

/** Production timings. */
export const DEFAULT_PROBE_SCHEDULE: ProbeScheduleConfig = {
  debounceMs: PROBE_DEBOUNCE_MS,
  ttlMs: PROBE_CACHE_TTL_MS,
  backoffMs: PROBE_BACKOFF_MS,
}

/** Clock the scheduler waits on. Tests pass a manual one. */
export interface ProbeClock {
  now(): number
  delay(ms: number, fn: () => void): { cancel(): void }
}

/** `Date.now` + `setTimeout`, the clock the client bundle uses. */
export function systemProbeClock(): ProbeClock {
  return {
    now: () => Date.now(),
    delay(ms, fn) {
      const handle = setTimeout(fn, ms)
      return { cancel: () => clearTimeout(handle) }
    },
  }
}

/** A slot that has never been probed. */
export function emptyProbeSlot(): ProbeSlot {
  return { settledAt: 0, failures: 0, inflight: false, dueAt: 0 }
}

/** Delay for the Nth failure (1-based). The last step repeats. */
export function probeBackoffMs(failures: number, steps: readonly number[]): number {
  if (steps.length === 0 || failures <= 0) return 0
  const index = Math.min(failures, steps.length) - 1
  return steps[index] ?? 0
}

/**
 * Decide the next action for one id. Does not touch timers or the network.
 * A manual request always probes unless one is already in flight (the caller
 * may still preempt; this helper itself does not).
 * @param slot - current scheduling fields (undefined = never seen).
 * @param now - epoch ms.
 * @param mode - `auto` honors debounce, TTL, and backoff; `manual` does not.
 * @param config - timings (defaults to the production schedule).
 */
export function planProbe(
  slot: ProbeSlot | undefined,
  now: number,
  mode: ProbeMode,
  config: ProbeScheduleConfig = DEFAULT_PROBE_SCHEDULE,
): ProbeStep {
  const current = slot ?? emptyProbeSlot()
  if (current.inflight) return { action: 'skip', delayMs: 0, slot: current }
  if (mode === 'manual') {
    return { action: 'probe', delayMs: 0, slot: { ...current, dueAt: 0 } }
  }
  if (current.outcome === 'reachable' && now - current.settledAt < config.ttlMs) {
    return { action: 'skip', delayMs: 0, slot: current }
  }
  if (current.outcome === 'unreachable') {
    const retryAt = current.settledAt + probeBackoffMs(current.failures, config.backoffMs)
    if (now < retryAt) {
      return {
        action: 'wait',
        delayMs: retryAt - now,
        slot: { ...current, dueAt: retryAt },
      }
    }
  } else if (current.outcome === undefined) {
    // Coalesce, don't reset: a burst keeps the first deadline.
    if (current.dueAt > now) {
      return { action: 'wait', delayMs: current.dueAt - now, slot: current }
    }
    if (current.dueAt === 0) {
      const dueAt = now + config.debounceMs
      return { action: 'wait', delayMs: config.debounceMs, slot: { ...current, dueAt } }
    }
  }
  return { action: 'probe', delayMs: 0, slot: { ...current, dueAt: 0 } }
}

/**
 * Record a settled probe. Reachable clears the failure count and the
 * deadline (the TTL is applied by the next {@link planProbe}). Unreachable
 * arms the backoff deadline.
 */
export function settleProbe(
  slot: ProbeSlot,
  now: number,
  outcome: ProbeOutcome,
  config: ProbeScheduleConfig = DEFAULT_PROBE_SCHEDULE,
): ProbeSlot {
  if (outcome === 'reachable') {
    return { ...slot, outcome, settledAt: now, failures: 0, inflight: false, dueAt: 0 }
  }
  const failures = slot.failures + 1
  return {
    ...slot,
    outcome,
    settledAt: now,
    failures,
    inflight: false,
    dueAt: now + probeBackoffMs(failures, config.backoffMs),
  }
}

/** One watcher: the probe function plus the paint callback. */
interface ProbeWatcher<T> {
  run: () => Promise<T>
  listener: (value: T) => void
}

/** Mutable per-id state held by {@link ProbeScheduler}. */
interface ProbeEntry<T> {
  probe: ProbeSlot
  value?: T
  generation: number
  inflightPromise: Promise<T> | null
  timer: { cancel(): void } | null
  watchers: Set<ProbeWatcher<T>>
}

/**
 * Shared interest in one id's reachability. `watch` is the automatic path;
 * `recheck` is the button. The last `unwatch` cancels a pending timer.
 */
export interface ProbeScheduler<T> {
  /**
   * Show interest in `id`. Fires `listener` immediately when a cached value
   * exists, then keeps it updated across TTL refresh and backoff retries
   * until the returned function is called.
   */
  watch(id: string, run: () => Promise<T>, listener: (value: T) => void): () => void
  /**
   * Probe now, ignoring debounce, TTL, and backoff. Notifies current
   * listeners. A probe already in flight is superseded: its later result
   * does not overwrite this one.
   */
  recheck(id: string, run: () => Promise<T>): Promise<T>
  /** Cancel every pending timer. In-flight probes settle without rescheduling. */
  dispose(): void
}

/**
 * Create a scheduler. `classify` maps a successful probe value onto the
 * outcome that drives TTL versus backoff. A thrown `run` counts as
 * unreachable and rethrows.
 */
export function createProbeScheduler<T>(
  clock: ProbeClock,
  classify: (value: T) => ProbeOutcome,
  config: ProbeScheduleConfig = DEFAULT_PROBE_SCHEDULE,
): ProbeScheduler<T> {
  const entries = new Map<string, ProbeEntry<T>>()

  const ensure = (id: string): ProbeEntry<T> => {
    const existing = entries.get(id)
    if (existing !== undefined) return existing
    const created: ProbeEntry<T> = {
      probe: emptyProbeSlot(),
      generation: 0,
      inflightPromise: null,
      timer: null,
      watchers: new Set(),
    }
    entries.set(id, created)
    return created
  }

  const cancelTimer = (entry: ProbeEntry<T>): void => {
    if (entry.timer === null) return
    entry.timer.cancel()
    entry.timer = null
  }

  const notify = (entry: ProbeEntry<T>, value: T): void => {
    for (const watcher of entry.watchers) {
      try {
        watcher.listener(value)
      } catch {
        // A paint failure must not cancel the rest of the listeners or the timer.
      }
    }
  }

  const firstRun = (entry: ProbeEntry<T>): (() => Promise<T>) | undefined => {
    const watcher = entry.watchers.values().next().value as ProbeWatcher<T> | undefined
    return watcher?.run
  }

  const runNow = (id: string, run: () => Promise<T>, preempt: boolean): Promise<T> => {
    const entry = ensure(id)
    if (!preempt && entry.inflightPromise !== null) return entry.inflightPromise
    const generation = ++entry.generation
    entry.probe = { ...entry.probe, inflight: true }
    const promise = run().then(value => {
      if (entry.generation !== generation) return value
      let outcome: ProbeOutcome = 'unreachable'
      try {
        outcome = classify(value)
      } catch {
        outcome = 'unreachable'
      }
      entry.probe = settleProbe(entry.probe, clock.now(), outcome, config)
      entry.value = value
      notify(entry, value)
      return value
    }, (error: unknown) => {
      if (entry.generation === generation) {
        entry.probe = settleProbe(entry.probe, clock.now(), 'unreachable', config)
      }
      throw error
    }).finally(() => {
      if (entry.generation !== generation) return
      entry.probe = { ...entry.probe, inflight: false }
      entry.inflightPromise = null
      if (entry.watchers.size > 0) schedule(id)
    })
    entry.inflightPromise = promise
    return promise
  }

  const schedule = (id: string): void => {
    const entry = entries.get(id)
    if (entry === undefined || entry.watchers.size === 0 || entry.probe.inflight) return
    if (entry.timer !== null) return
    const step = planProbe(entry.probe, clock.now(), 'auto', config)
    entry.probe = step.slot
    if (step.action === 'probe') {
      const run = firstRun(entry)
      if (run === undefined) return
      // The slot is already settled on failure; swallow so an automatic
      // retry is not an unhandled rejection. `recheck` callers still see it.
      void runNow(id, run, false).catch(() => undefined)
      return
    }
    if (step.action === 'wait') {
      const delay = step.delayMs > 0 ? step.delayMs : 0
      entry.timer = clock.delay(delay, () => {
        entry.timer = null
        schedule(id)
      })
      return
    }
    if (entry.probe.outcome === 'reachable') {
      const remain = entry.probe.settledAt + config.ttlMs - clock.now()
      if (remain > 0) {
        entry.timer = clock.delay(remain, () => {
          entry.timer = null
          schedule(id)
        })
      }
    }
  }

  return {
    watch(id, run, listener) {
      const entry = ensure(id)
      const watcher: ProbeWatcher<T> = { run, listener }
      entry.watchers.add(watcher)
      if (entry.value !== undefined) listener(entry.value)
      if (entry.watchers.size === 1) schedule(id)
      let released = false
      return () => {
        if (released) return
        released = true
        entry.watchers.delete(watcher)
        if (entry.watchers.size === 0) cancelTimer(entry)
      }
    },
    recheck(id, run) {
      const entry = ensure(id)
      cancelTimer(entry)
      entry.probe = { ...entry.probe, dueAt: 0 }
      return runNow(id, run, true)
    },
    dispose() {
      for (const entry of entries.values()) {
        cancelTimer(entry)
        entry.watchers.clear()
        entry.generation += 1
      }
      entries.clear()
    },
  }
}
