/**
 * REQ-I5 / ADR-0024 §6: jail-root identity is pure POSIX prefix math.
 * @module test/core-session
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CORE_IDLE_MS,
  coreSessionKey,
  longestContainingRoot,
  posixInside,
  resolveCoreWorkspace,
  uniquePosixRoots,
} from '../src/core-session.ts'

test('posixInside: prefix match, not a three-dot string compare', () => {
  assert.equal(posixInside('/work', '/work'), true)
  assert.equal(posixInside('/work', '/work/a.txt'), true)
  assert.equal(posixInside('/work', '/work-other'), false)
  assert.equal(posixInside('/tmp', '/tmp/../../etc/passwd'), false)
  assert.equal(posixInside('/a', '/b'), false)
})

test('longestContainingRoot ignores the filesystem root', () => {
  assert.equal(longestContainingRoot(['/', '/work'], '/tmp/x'), undefined)
  assert.equal(longestContainingRoot(['/work', '/'], '/work/a'), '/work')
})

test('resolveCoreWorkspace: a file cwd under a declared root stays in that root', () => {
  assert.equal(
    resolveCoreWorkspace({
      mode: 'workspace-write',
      machineWorkspace: '/home/uuz/ssh-test-lab',
      cwd: '/home/uuz/ssh-test-lab/r27-in.txt',
    }),
    '/home/uuz/ssh-test-lab',
  )
})

test('resolveCoreWorkspace: never mints the filesystem root', () => {
  assert.equal(
    resolveCoreWorkspace({
      mode: 'workspace-write',
      machineWorkspace: '/home/uuz/ssh-test-lab',
      cwd: '/',
    }),
    '/home/uuz/ssh-test-lab',
  )
})

test('resolveCoreWorkspace: write path /tmp does not select a remembered /', () => {
  assert.equal(
    resolveCoreWorkspace({
      mode: 'workspace-write',
      machineWorkspace: '/home/uuz/ssh-test-lab',
      knownRoots: ['/home/uuz/ssh-test-lab', '/'],
      path: '/tmp/dsw-r27-out.txt',
    }),
    '/home/uuz/ssh-test-lab',
  )
})

test('longestContainingRoot prefers the deepest declared root', () => {
  assert.equal(longestContainingRoot(['/a', '/a/b'], '/a/b/c'), '/a/b')
  assert.equal(longestContainingRoot(['/a'], '/tmp'), undefined)
})

test('uniquePosixRoots drops relatives and trailing slashes', () => {
  assert.deepEqual(uniquePosixRoots(['/a/', '/a', 'rel', '/b']), ['/a', '/b'])
})

test('coreSessionKey: read-only collapses workspace; workspace-write keeps it', () => {
  assert.equal(coreSessionKey('c1', 'read-only', '/a'), coreSessionKey('c1', 'read-only', '/b'))
  assert.notEqual(coreSessionKey('c1', 'workspace-write', '/a'), coreSessionKey('c1', 'workspace-write', '/b'))
  assert.equal(
    coreSessionKey('c1', 'workspace-write', '/a/'),
    coreSessionKey('c1', 'workspace-write', '/a'),
  )
})

test('resolveCoreWorkspace: read-only has no jail root', () => {
  assert.equal(resolveCoreWorkspace({ mode: 'read-only', cwd: '/a', machineWorkspace: '/a' }), undefined)
})

test('resolveCoreWorkspace: sibling cwd mints a second root', () => {
  assert.equal(
    resolveCoreWorkspace({ mode: 'workspace-write', machineWorkspace: '/a', cwd: '/b' }),
    '/b',
  )
})

test('resolveCoreWorkspace: a git-dir cwd mints the working tree, not .git', () => {
  assert.equal(
    resolveCoreWorkspace({ mode: 'workspace-write', cwd: '/home/uuz/ssh-test-lab/.git' }),
    '/home/uuz/ssh-test-lab',
  )
  assert.equal(
    resolveCoreWorkspace({ mode: 'workspace-write', cwd: '/home/uuz/ssh-test-lab/.git/HEAD' }),
    '/home/uuz/ssh-test-lab',
  )
  assert.equal(
    resolveCoreWorkspace({
      mode: 'workspace-write',
      machineWorkspace: '/home/uuz/ssh-test-lab',
      cwd: '/home/uuz/ssh-test-lab/.git',
    }),
    '/home/uuz/ssh-test-lab',
  )
})

test('resolveCoreWorkspace: nested cwd shares the ancestor', () => {
  assert.equal(
    resolveCoreWorkspace({ mode: 'workspace-write', machineWorkspace: '/a', cwd: '/a/sub' }),
    '/a',
  )
})

test('resolveCoreWorkspace: browse path does not mint a jail', () => {
  assert.equal(
    resolveCoreWorkspace({
      mode: 'workspace-write',
      machineWorkspace: '/work',
      path: '/tmp',
    }),
    '/work',
  )
})

test('resolveCoreWorkspace: fs path picks the matching known root', () => {
  assert.equal(
    resolveCoreWorkspace({
      mode: 'workspace-write',
      machineWorkspace: '/a',
      knownRoots: ['/a', '/b'],
      path: '/b/file.txt',
    }),
    '/b',
  )
})

test('coreSessionKey: off collapses workspace like read-only', () => {
  assert.equal(coreSessionKey('c1', 'off', '/a'), coreSessionKey('c1', 'off', '/b'))
  assert.notEqual(coreSessionKey('c1', 'off'), coreSessionKey('c1', 'read-only'))
})

test('resolveCoreWorkspace: off has no jail root', () => {
  assert.equal(resolveCoreWorkspace({ mode: 'off', cwd: '/a', machineWorkspace: '/a' }), undefined)
})

test('CORE_IDLE_MS is ten minutes', () => {
  assert.equal(CORE_IDLE_MS, 10 * 60 * 1000)
})
