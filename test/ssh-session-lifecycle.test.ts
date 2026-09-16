/**
 * BUG-5 regression tests: an ssh2 `Client` whose socket dies after auth must
 * never surface as an uncaught `'error'` (that kills the whole host process),
 * and the death must invalidate the session's cached state so `isConnected()`
 * stops reporting a zombie connection and the next call reopens. Covers the
 * lifecycle watcher, the generation/dispose guards, the invalidate sweep, and
 * the post-invalidation retry path.
 * @module test/ssh-session-lifecycle
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from 'ssh2'
import { SshSession, watchChainClient } from '../src/ssh-core.ts'
import type { Client as ClientType } from 'ssh2'

/** Build a session and reach into its private state for direct assertions. */
function exposed(session: SshSession): {
  generation: number
  connected: boolean
  ready: Promise<ClientType> | undefined
  sftp: unknown
  sftpOpening: unknown
  remoteEnvironment: unknown
  handleChainDeath(generation: number, error?: Error): void
  invalidate(error?: Error): void
} {
  return session as unknown as never
}

function liveState(session: SshSession): void {
  const inner = exposed(session)
  inner.generation = 1
  inner.connected = true
  inner.ready = Promise.resolve(new Client())
  inner.sftp = {}
  inner.sftpOpening = Promise.resolve({} as never)
  inner.remoteEnvironment = Promise.resolve({})
}

test('watchChainClient: an emitted error is observed, not uncaught', () => {
  const client = new Client()
  const deaths: Array<Error | undefined> = []
  watchChainClient(client, (error) => { deaths.push(error) })
  // On ssh2 a bare emitted 'error' with no listener crashes the process;
  // with the watcher attached this must stay a plain callback invocation.
  client.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))
  assert.equal(deaths.length, 1)
  assert.match(deaths[0]?.message ?? '', /ECONNRESET/)
  // A silent close reports death without an error.
  client.emit('close')
  assert.equal(deaths.length, 2)
  assert.equal(deaths[1], undefined)
})

test('handleChainDeath: the current generation is invalidated, stale ones are not', () => {
  const session = new SshSession([{ host: 'h', port: 22, username: 'u' }], false, [])
  liveState(session)
  // A stale generation (a superseding open owns the state) is ignored.
  exposed(session).handleChainDeath(99, new Error('old chain'))
  assert.equal(exposed(session).connected, true)
  assert.notEqual(exposed(session).ready, undefined)
  // The current generation invalidates.
  exposed(session).handleChainDeath(1, new Error('read ECONNRESET'))
  assert.equal(exposed(session).connected, false)
  assert.equal(exposed(session).ready, undefined)
  assert.equal(session.isConnected(), false)
})

test('handleChainDeath: a close after dispose is ignored (dispose ends clients deliberately)', () => {
  const session = new SshSession([{ host: 'h', port: 22, username: 'u' }], false, [])
  liveState(session)
  session.dispose()
  // dispose() already flipped connected; the death event must not re-enter.
  assert.equal(exposed(session).connected, false)
  assert.doesNotThrow(() => exposed(session).handleChainDeath(1, new Error('late error')))
  assert.equal(session.isConnected(), false)
})

test('invalidate: clears ready, sftp, and the cached remote environment', () => {
  const session = new SshSession([{ host: 'h', port: 22, username: 'u' }], false, [])
  liveState(session)
  exposed(session).invalidate()
  const inner = exposed(session)
  assert.equal(inner.connected, false)
  assert.equal(inner.ready, undefined)
  assert.equal(inner.sftp, undefined)
  assert.equal(inner.sftpOpening, undefined)
  assert.equal(inner.remoteEnvironment, undefined)
  // invalidate() on an already-dead session is a no-op (the connected guard).
  assert.doesNotThrow(() => exposed(session).invalidate())
})

test('a session invalidated after ready retries the open on the next getClient', async () => {
  const session = new SshSession([{ host: 'h', port: 22, username: 'u' }], false, [])
  let attempts = 0
  const inner = exposed(session) as { open: () => Promise<ClientType> }
  inner.open = () => {
    attempts += 1
    // The real open() marks the session live after openChain resolves.
    exposed(session).connected = true
    return Promise.resolve(new Client())
  }
  const first = await session.getClient()
  assert.ok(first)
  // The chain dies post-auth (the BUG-5 scenario).
  liveState(session)
  exposed(session).handleChainDeath(1, new Error('read ECONNRESET'))
  assert.equal(session.isConnected(), false)
  // The next caller must get a fresh open, not the dead cached client.
  const second = await session.getClient()
  assert.ok(second)
  assert.equal(attempts, 2)
  assert.equal(session.isConnected(), true)
})
