/**
 * REQ-I31: the `sw_use_machine` decision core and the effective-cwd seam.
 * The gate matrix is pinned here so the sandbox suite covers every refusal
 * without a host; the only mutating step (workingDirectory.set) stays behind
 * the pure decision.
 * @module test/use-machine-tool
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideUseMachine, type UseMachineTarget } from '../src/use-machine-tool.ts'
import { effectiveCwdOf, type SessionProjectionsFace } from '../src/remote-policy.ts'

const machines: UseMachineTarget[] = [
  { id: 'c1', workspace: '/home/u/alpha', cwd: '/home/u' },
  { id: 'c2', cwd: '/srv/beta' },
  { id: 'c3' },
  { id: 'c4', workspace: 'not-absolute' },
]

test('decideUseMachine: empty and reserved targets are refused first', () => {
  assert.deepEqual(decideUseMachine('', undefined, machines, ['c1'], null), { action: 'refuse', reason: 'empty' })
  assert.deepEqual(decideUseMachine('local', undefined, machines, ['c1'], null), { action: 'refuse', reason: 'reserved' })
})

test('decideUseMachine: unknown machine is refused with the known list', () => {
  assert.deepEqual(decideUseMachine('c9', undefined, machines, ['c1'], null), { action: 'refuse', reason: 'unknown' })
})

test('decideUseMachine: a known machine outside the session connection set is refused', () => {
  assert.deepEqual(decideUseMachine('c2', undefined, machines, ['c1'], null), { action: 'refuse', reason: 'notConnected' })
})

test('decideUseMachine: the landing defaults to workspace, then cwd, never /', () => {
  assert.deepEqual(decideUseMachine('c1', undefined, machines, ['c1'], null),
    { action: 'switch', machineId: 'c1', landing: '/home/u/alpha' })
  assert.deepEqual(decideUseMachine('c2', undefined, machines, ['c1', 'c2'], 'c1'),
    { action: 'switch', machineId: 'c2', landing: '/srv/beta' })
  // No workspace AND no cwd → the caller must name the landing explicitly.
  assert.deepEqual(decideUseMachine('c3', undefined, machines, ['c3'], null), { action: 'refuse', reason: 'noRegisteredRoot' })
  // A non-absolute registered value is as good as none (defaultRemoteDir's rule).
  assert.deepEqual(decideUseMachine('c4', undefined, machines, ['c4'], null), { action: 'refuse', reason: 'noRegisteredRoot' })
})

test('decideUseMachine: an explicit path must be absolute POSIX and never /', () => {
  assert.deepEqual(decideUseMachine('c3', 'relative/x', machines, ['c3'], null), { action: 'refuse', reason: 'pathNotAbsolute' })
  assert.deepEqual(decideUseMachine('c3', 'C:\\x', machines, ['c3'], null), { action: 'refuse', reason: 'pathNotAbsolute' })
  assert.deepEqual(decideUseMachine('c3', 'ssh://c3/home', machines, ['c3'], null), { action: 'refuse', reason: 'pathNotAbsolute' })
  assert.deepEqual(decideUseMachine('c3', '/', machines, ['c3'], null), { action: 'refuse', reason: 'noRegisteredRoot' })
  // A valid explicit path overrides the registered root and normalizes.
  assert.deepEqual(decideUseMachine('c1', '/data/proj/../proj2', machines, ['c1'], 'c2'),
    { action: 'switch', machineId: 'c1', landing: '/data/proj2' })
  // An explicit path rescues a machine with no registered root.
  assert.deepEqual(decideUseMachine('c3', '/home/u/gamma', machines, ['c3'], null),
    { action: 'switch', machineId: 'c3', landing: '/home/u/gamma' })
})

test('decideUseMachine: the current machine without a path is an honest no-op', () => {
  assert.deepEqual(decideUseMachine('c1', undefined, machines, ['c1'], 'c1'),
    { action: 'noop', machineId: 'c1', landing: '/home/u/alpha' })
  // An explicit path still switches (a same-machine directory move).
  assert.deepEqual(decideUseMachine('c1', '/home/u/other', machines, ['c1'], 'c1'),
    { action: 'switch', machineId: 'c1', landing: '/home/u/other' })
})

const projectionsOf = (state: unknown): SessionProjectionsFace => ({
  stateOf: (_session: unknown, key: string) => (key === 'workingDirectory' ? state : undefined),
})

test('effectiveCwdOf: a committed projection wins over the header', () => {
  assert.equal(effectiveCwdOf(projectionsOf('ssh://c2/srv/beta'), {}, '/local/alpha'), 'ssh://c2/srv/beta')
})

test('effectiveCwdOf: a null projection (never had a cwd) falls back to the header', () => {
  assert.equal(effectiveCwdOf(projectionsOf(null), {}, '/local/alpha'), '/local/alpha')
  assert.equal(effectiveCwdOf(projectionsOf(null), {}, undefined), undefined)
})

test('effectiveCwdOf: an unregistered key or absent service keeps the header behavior', () => {
  // Pre-0.2.1 families: the key is not registered at all.
  assert.equal(effectiveCwdOf(projectionsOf(undefined), {}, '/local/alpha'), '/local/alpha')
  assert.equal(effectiveCwdOf(undefined, {}, '/local/alpha'), '/local/alpha')
  // No session carrier → the header is all there is.
  assert.equal(effectiveCwdOf(projectionsOf('ssh://c2/srv'), undefined, '/local/alpha'), '/local/alpha')
})
