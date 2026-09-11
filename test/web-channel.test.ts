/**
 * Channel-transport tests (UPSTREAM-3 F2): the plugin's browser channel now
 * rides the official shared `/api` transport as exact Fetch routes, so this file
 * pins the wire identity both halves import (`../src/web-channel.ts`), the
 * envelope adapter's HTTP behaviour, the reload contract (a route built by an
 * EARLIER apply must serve the NEWEST dispatch), and the endpoint-list ↔
 * dispatch-switch lockstep in `../src/web.ts`.
 * @module test/web-channel
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { URL } from 'node:url'
import {
  API_CHANNEL,
  CHANNEL_NAMESPACE,
  channelEndpointOf,
  channelPathOf,
  channelRouteOf,
  isAlreadyRegistered,
} from '../src/web-channel.ts'
import type { ChannelDispatch } from '../src/web-channel.ts'

/** Repo root (this file lives in `test/`). */
const repoRoot = new URL('..', import.meta.url)

/** Read one repository file as text. */
function source(relative: string): string {
  return readFileSync(new URL(relative, repoRoot), 'utf8')
}

/** A POST carrying one JSON body, verbatim (so malformed envelopes stay malformed). */
function post(body: unknown): Request {
  return new Request('http://127.0.0.1/api/dsw/connections.list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** One well-formed `client-request` envelope. */
function envelope(payload: unknown = {}, rpcId = 'r1', method = 'dsw/connections.list'): unknown {
  return { type: 'client-request', rpcId, method, payload }
}

/** A dispatch that answers `value` and records every call. */
function recordingDispatch(value: unknown = []): { calls: Array<[string, unknown]>; dispatch: ChannelDispatch } {
  const calls: Array<[string, unknown]> = []
  const dispatch: ChannelDispatch = async (endpoint, payload) => {
    calls.push([endpoint, payload])
    return { ok: true, value }
  }
  return { calls, dispatch }
}

test('wire identity: one namespace below the shared /api channel', () => {
  assert.equal(API_CHANNEL, '/api')
  assert.equal(CHANNEL_NAMESPACE, 'dsw')
  assert.equal(channelEndpointOf('connections.list'), 'dsw/connections.list')
  assert.equal(channelPathOf('connections.list'), '/api/dsw/connections.list')
  // The endpoint spelling must stay ONE valid segment sequence for the client's
  // own `assertTarget` (`^[A-Za-z0-9_$.-]+$` per segment) — dots are allowed.
  for (const segment of channelEndpointOf('machines.setCurrent').split('/')) {
    assert.match(segment, /^[A-Za-z0-9_$.-]+$/u)
  }
})

test('route shape: POST-only, buffered, exact path', () => {
  const { dispatch } = recordingDispatch()
  const route = channelRouteOf('connections.list', () => dispatch)
  assert.equal(route.path, '/api/dsw/connections.list')
  assert.deepEqual(route.methods, ['POST'])
  assert.equal(route.requestBody, 'buffered')
})

test('a valid envelope reaches the dispatch and answers one server-response', async () => {
  const { calls, dispatch } = recordingDispatch([{ id: 'c1' }])
  const route = channelRouteOf('connections.list', () => dispatch)
  const response = await route.fetch(post(envelope({ hello: 'there' }, 'r-42')))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    type: 'server-response',
    rpcId: 'r-42',
    result: { ok: true, value: [{ id: 'c1' }] },
  })
  assert.deepEqual(calls, [['connections.list', { hello: 'there' }]])
})

test('a method that disagrees with the endpoint is a bad-request envelope, not a silent dispatch', async () => {
  const { calls, dispatch } = recordingDispatch()
  const route = channelRouteOf('connections.list', () => dispatch)
  const response = await route.fetch(post(envelope({}, 'r-9', 'dsw/browse.list')))
  assert.equal(response.status, 200)
  const body = await response.json() as { rpcId: string; result: { ok: boolean; error: { code: string } } }
  assert.equal(body.rpcId, 'r-9')
  assert.equal(body.result.ok, false)
  assert.equal(body.result.error.code, 'gateway/bad-request')
  assert.deepEqual(calls, [])
})

test('a malformed envelope is echoed back as gateway/bad-request', async () => {
  const { dispatch } = recordingDispatch()
  const route = channelRouteOf('connections.list', () => dispatch)
  // A usable rpcId is echoed back (so the caller can correlate); otherwise the
  // upstream placeholder is returned.
  const cases: Array<[unknown, string]> = [
    [{ type: 'server-response', rpcId: 'x', method: 'connections.list' }, 'x'],
    [{ type: 'client-request', method: 'connections.list' }, 'invalid-request'],
    [{ type: 'client-request', rpcId: '', method: 'connections.list' }, 'invalid-request'],
    ['not-an-object', 'invalid-request'],
  ]
  for (const [body, rpcId] of cases) {
    const response = await route.fetch(post(body))
    assert.equal(response.status, 200)
    const parsed = await response.json() as { rpcId: string; result: { error: { code: string } } }
    assert.equal(parsed.result.error.code, 'gateway/bad-request')
    assert.equal(parsed.rpcId, rpcId)
  }
})

test('transport-level rejections mirror the shared handler (415 / 400 / 404)', async () => {
  const { dispatch } = recordingDispatch()
  const route = channelRouteOf('connections.list', () => dispatch)
  const wrongType = await route.fetch(new Request('http://127.0.0.1/api/dsw/connections.list', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  }))
  assert.equal(wrongType.status, 415)
  const badJson = await route.fetch(new Request('http://127.0.0.1/api/dsw/connections.list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  }))
  assert.equal(badJson.status, 400)
  const wrongMethod = await route.fetch(new Request('http://127.0.0.1/api/dsw/connections.list', { method: 'GET' }))
  assert.equal(wrongMethod.status, 404)
  // A host that never mounted the connection registry resolves no dispatch.
  const unmounted = channelRouteOf('connections.list', () => undefined)
  assert.equal((await unmounted.fetch(post(envelope()))).status, 404)
})

test('a throwing dispatch surfaces as a 500 handler failure', async () => {
  const route = channelRouteOf('connections.list', () => async () => {
    throw new Error('boom')
  })
  const response = await route.fetch(post(envelope()))
  assert.equal(response.status, 500)
  assert.match(await response.text(), /handler failure: Error: boom/u)
})

test('reload contract: one surviving route serves the NEWEST dispatch', async () => {
  // The registry binds registrations to the Connection service's effect scope,
  // so after a plugin reload the OLD route can still be the live one. The route
  // must therefore be stateless and resolve the handler per request.
  let current: ChannelDispatch = async () => ({ ok: true, value: 'first' })
  const route = channelRouteOf('connections.list', () => current)
  const first = await route.fetch(post(envelope()))
  assert.deepEqual((await first.json() as { result: unknown }).result, { ok: true, value: 'first' })
  current = async () => ({ ok: true, value: 'second' })
  const second = await route.fetch(post(envelope()))
  assert.deepEqual((await second.json() as { result: unknown }).result, { ok: true, value: 'second' })
})

test('isAlreadyRegistered matches the registry guard only', () => {
  assert.equal(isAlreadyRegistered(new Error('connection: exact Fetch route "/api/dsw/status" is already registered')), true)
  assert.equal(isAlreadyRegistered(new Error('connection: invalid exact Fetch route "/dsw"')), false)
  assert.equal(isAlreadyRegistered('already registered'), false)
})

test('CHANNEL_ENDPOINTS stays in lockstep with the dispatch switch', () => {
  const web = source('src/web.ts')
  const listBlock = /export const CHANNEL_ENDPOINTS = \[([\s\S]*?)\] as const/u.exec(web)
  assert.notEqual(listBlock, null, 'CHANNEL_ENDPOINTS must stay a literal list in src/web.ts')
  const listed = [...(listBlock?.[1] ?? '').matchAll(/'([^']+)'/gu)].map(match => match[1] ?? '')
  const cases = [...web.matchAll(/^\s+case '([^']+)':/gmu)].map(match => match[1] ?? '')
  assert.ok(listed.length >= 20, `expected the full endpoint surface, found ${listed.length}`)
  assert.deepEqual([...listed].sort(), [...cases].sort())
  assert.equal(new Set(listed).size, listed.length, 'no duplicate endpoints')
})

test('no half hard-codes the channel path any more', () => {
  const client = source('src/client/index.ts')
  assert.equal(/rpc\.call\('\/dsw'/u.test(client), false, 'the client must call through ../web-channel.ts')
  assert.match(client, /channelEndpointOf\(endpoint\)/u)
  const web = source('src/web.ts')
  assert.equal(/connection\.rpc\.handle\(/u.test(web), false, 'rpc.handle is unusable on the 0.1.5 line')
  assert.match(web, /connection\.fetch\.register\(route\)/u)
})
