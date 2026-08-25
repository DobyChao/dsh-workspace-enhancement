/**
 * Status-center client tests (P2-①): the in-flight dedupe of
 * {@link createStatusCenter} is keyed by `endpoint:id`, never by id alone —
 * `conn.status` (cache-first read), `conn.probe` (live echo), and
 * `conn.reconnect` (dispose + rebuild + probe) have different semantics, so
 * one endpoint's pending call must never satisfy another endpoint's request
 * for the same id (the old id-only slot made a reconnect return a pending
 * status read and never actually reconnected). Same-endpoint calls still
 * share one in-flight slot, and the TTL cache is per id (latest view wins).
 * @module test/status-center
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStatusCenter } from '../src/client/status.tsx'
import type { RpcCall } from '../src/client/status.tsx'
import type { ConnStatusView } from '../src/client/status.tsx'

/** A scripted `/dsw` channel: records calls and resolves on demand. */
function scriptedRpc() {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const waiters: Array<{ endpoint: string; resolve: (value: unknown) => void }> = []
  const remote: RpcCall = (endpoint, payload) => {
    calls.push({ endpoint, payload })
    return new Promise(resolve => { waiters.push({ endpoint, resolve }) })
  }
  const settle = (endpoint: string, view: ConnStatusView): void => {
    const index = waiters.findIndex(waiting => waiting.endpoint === endpoint)
    const waiter = waiters.splice(index, 1)[0]
    if (waiter === undefined) throw new Error(`no pending call for ${endpoint}`)
    waiter.resolve({ ok: true, value: view })
  }
  return { calls, waiters, settle, remote }
}

/** A minimal status view for one id. */
function viewOf(id: string, state: ConnStatusView['state'] = 'unknown'): ConnStatusView {
  return {
    id, state,
    connected: state === 'active',
    label: '', host: '', port: 22, username: '', hostKeyKnown: false,
  }
}

/** Wait a microtask so chained promise callbacks have run. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

test('P2-①: same-endpoint same-id calls share one in-flight request', async () => {
  const { remote, calls, settle } = scriptedRpc()
  const center = createStatusCenter(remote)
  const first = center.get('c1')
  const second = center.get('c1')
  assert.equal(calls.length, 1) // the second get joined the first
  settle('conn.status', viewOf('c1', 'active'))
  const a = await first
  const b = await second
  assert.equal(a?.state, 'active')
  assert.equal(b?.state, 'active')
  assert.equal(calls.length, 1)
})

test('P2-①: status/probe/reconnect for one id never share an in-flight slot', async () => {
  const { remote, calls, settle } = scriptedRpc()
  const center = createStatusCenter(remote)
  // A pending status read must not satisfy a probe…
  const pendingStatus = center.get('c1')
  const pendingProbe = center.probe('c1')
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.endpoint, 'conn.status')
  assert.equal(calls[1]?.endpoint, 'conn.probe')
  // …and a pending probe must not satisfy a reconnect.
  const pendingReconnect = center.reconnect('c1')
  assert.equal(calls.length, 3)
  assert.equal(calls[2]?.endpoint, 'conn.reconnect')
  settle('conn.status', viewOf('c1', 'active'))
  settle('conn.probe', viewOf('c1', 'active'))
  settle('conn.reconnect', viewOf('c1', 'active'))
  assert.equal((await pendingStatus)?.state, 'active')
  assert.equal((await pendingProbe)?.state, 'active')
  assert.equal((await pendingReconnect)?.state, 'active')
})

test('P2-①: different ids never share an in-flight slot even on one endpoint', async () => {
  const { remote, calls, settle } = scriptedRpc()
  const center = createStatusCenter(remote)
  void center.get('c1')
  void center.get('c2')
  assert.equal(calls.length, 2)
  settle('conn.status', viewOf('c1', 'active'))
  settle('conn.status', viewOf('c2', 'offline'))
  await flush()
  assert.equal(center.peek('c1')?.state, 'active')
  assert.equal(center.peek('c2')?.state, 'offline')
})

test('P2-①: a fresh cache entry serves get() without the wire; a probe replaces it', async () => {
  const { remote, calls, settle } = scriptedRpc()
  const center = createStatusCenter(remote)
  const first = center.get('c1')
  settle('conn.status', viewOf('c1', 'offline'))
  assert.equal((await first)?.state, 'offline')
  // Fresh (status TTL) → served from cache, no second wire call.
  const second = center.get('c1')
  assert.equal(calls.length, 1)
  const cached = await second
  assert.equal(cached?.state, 'offline')
  // A forced probe replaces the cached view even before the status TTL ends.
  const probed = center.probe('c1')
  assert.equal(calls.length, 2)
  settle('conn.probe', viewOf('c1', 'active'))
  assert.equal((await probed)?.state, 'active')
  assert.equal(center.peek('c1')?.state, 'active')
})

test('P2-①: a failed call resolves to null and frees the in-flight slot', async () => {
  let calls = 0
  const remote: RpcCall = () => {
    calls += 1
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'boom' } })
  }
  const center = createStatusCenter(remote)
  assert.equal(await center.probe('c1'), null)
  assert.equal(await center.probe('c1'), null) // slot freed → the second call ran
  assert.equal(calls, 2)
  assert.equal(center.peek('c1'), null)
})
