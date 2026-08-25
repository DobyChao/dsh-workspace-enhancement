/**
 * Keychain same-session injection regression tests: a keychain machine is
 * persisted with `password: ''` (plaintext marker); the connect-time resolver
 * must still inject the OS-store secret into the TARGET hop, and an explicit
 * non-empty password must NEVER be overwritten.
 * @module test/keychain
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveTargetPassword } from '../src/connection.ts'
import type { ResolvedConnectionHost } from '../src/ssh-core.ts'

/** Minimal target hop (the fields the resolver cares about). */
function hop(overrides: Partial<ResolvedConnectionHost> = {}): ResolvedConnectionHost {
  return {
    host: '127.0.0.1',
    port: 22,
    username: 'uuz',
    readyTimeout: 45_000,
    keepaliveInterval: 0,
    keepaliveCountMax: 3,
    ...overrides,
  }
}

/** A two-hop chain: one jump + the target (registry builder order). */
function chain(target: ResolvedConnectionHost): readonly ResolvedConnectionHost[] {
  return [hop({ host: 'bastion', port: 2222, username: 'jump', password: 'jump-pass' }), target]
}

const provider = (secret: string | undefined) => async (machineId: string): Promise<string | undefined> => {
  assert.equal(machineId, 'c1')
  return secret
}

test('keychain machine persisted with empty password still resolves the OS secret into the target hop', async () => {
  // Regression: saveMachine stores password: '' for a keychain machine; the
  // old guard `hop.password === undefined` skipped resolution entirely.
  const target = hop({ password: '' })
  const resolved = await resolveTargetPassword(chain(target), provider('keychain-secret'), 'c1')
  const result = [...resolved]
  const targetOut = result[result.length - 1] as ResolvedConnectionHost
  assert.equal(targetOut.password, 'keychain-secret')
  // The jump hop keeps its own configured auth.
  assert.equal(result[0]?.password, 'jump-pass')
})

test('an explicit non-empty password always wins over keychain resolution', async () => {
  const target = hop({ password: 'explicit' })
  const resolved = await resolveTargetPassword(chain(target), provider('keychain-secret'), 'c1')
  const result = [...resolved]
  assert.equal((result[result.length - 1] as ResolvedConnectionHost).password, 'explicit')
  assert.equal(result.length, 2)
})

test('a provider miss leaves the chain untouched (no empty-password auth attempt)', async () => {
  const target = hop({ password: '' })
  const resolved = await resolveTargetPassword(chain(target), provider(undefined), 'c1')
  const result = [...resolved]
  const targetOut = result[result.length - 1] as ResolvedConnectionHost
  assert.equal(targetOut.password, '') // unchanged: still the persisted marker
  assert.equal(result[0]?.password, 'jump-pass')
  assert.equal(targetOut.host, '127.0.0.1') // and no extra prop was added
})

test('undefined target password also triggers resolution', async () => {
  const target = hop({}) // password absent entirely (restart-normalized spec)
  const resolved = await resolveTargetPassword(chain(target), provider('keychain-secret'), 'c1')
  const result = [...resolved]
  assert.equal((result[result.length - 1] as ResolvedConnectionHost).password, 'keychain-secret')
})
