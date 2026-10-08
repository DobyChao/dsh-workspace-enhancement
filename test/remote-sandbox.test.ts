/**
 * REQ-I9 / ADR-0022 → AUDIT-7: the pure remote sandbox vocabulary.
 *
 * 1. The bwrap profile tokens the remote component's jail is built from
 *    (exact order; `workspace-write` without a usable root fails closed).
 * 2. The workspace-root shape guard.
 * 3. The refusal surface: code, mode, cause, and the deploy hint only when
 *    the cause names the component binary.
 * @module test/remote-sandbox
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REMOTE_BWRAP_PROFILE_READ_ONLY,
  REMOTE_BWRAP_PROFILE_WRITE_EXTRA,
  REMOTE_SANDBOX_MESSAGES,
  REMOTE_SANDBOX_UNAVAILABLE,
  RemoteSandboxError,
  RemoteSandboxPolicyError,
  coreMissingHint,
  isUsableRemoteWorkspaceRoot,
  remoteProfileArgs,
  remoteSandboxUnavailableError,
  resolveRemoteWorkspaceRoot,
} from '../src/remote-sandbox.ts'

const READ_ONLY_VECTOR = [
  '--ro-bind', '/', '/',
  '--dev', '/dev',
  '--unshare-pid',
  '--proc', '/proc',
  '--die-with-parent',
]

const WORKSPACE = '/home/uuz/repos/demo'

/* ------------------------------------------------- 1) profile vectors */

test('REMOTE_BWRAP_PROFILE_READ_ONLY: the deployed upstream token order, verbatim', () => {
  assert.deepEqual([...REMOTE_BWRAP_PROFILE_READ_ONLY], READ_ONLY_VECTOR)
  assert.deepEqual(REMOTE_BWRAP_PROFILE_WRITE_EXTRA, ['--tmpfs', '/tmp'])
})

test('remoteProfileArgs: read-only is exactly the pinned vector, and ignores a workspaceRoot', () => {
  assert.deepEqual(remoteProfileArgs({ mode: 'read-only' }), READ_ONLY_VECTOR)
  assert.deepEqual(remoteProfileArgs({ mode: 'read-only', workspaceRoot: WORKSPACE }), READ_ONLY_VECTOR)
})

test('remoteProfileArgs: workspace-write = read-only + --tmpfs /tmp + --bind ws ws', () => {
  assert.deepEqual(remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE }), [
    ...READ_ONLY_VECTOR,
    '--tmpfs', '/tmp',
    '--bind', WORKSPACE, WORKSPACE,
  ])
})

test('remoteProfileArgs: the profile is file-effects only (no net/env/chdir/session/seccomp)', () => {
  const tokens = [...remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE })]
  for (const forbidden of ['--unshare-net', '--unshare-all', '--unshare-user', '--clearenv',
    '--chdir', '--new-session', '--seccomp']) {
    assert.equal(tokens.includes(forbidden), false, `${forbidden} must not be in the profile`)
  }
})

test('remoteProfileArgs: workspace-write without a usable root fails closed (no silent downgrade)', () => {
  for (const workspaceRoot of [undefined, '', '/', 'relative/path', 'C:\\ws', '/ws\n/x', '/ws\u0000']) {
    assert.throws(
      () => remoteProfileArgs({ mode: 'workspace-write', ...(workspaceRoot === undefined ? {} : { workspaceRoot }) }),
      (error: unknown) => error instanceof RemoteSandboxPolicyError
        && error instanceof RemoteSandboxError
        && error.code === REMOTE_SANDBOX_UNAVAILABLE
        && error.message === REMOTE_SANDBOX_MESSAGES.workspaceRootRequired,
      `workspaceRoot=${JSON.stringify(workspaceRoot)} must be refused`,
    )
  }
})

test('remoteProfileArgs: each call returns a fresh array (callers may mutate)', () => {
  const first = remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE })
  const second = remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE })
  assert.notEqual(first, second)
  first.push('--junk')
  assert.deepEqual(second, [...READ_ONLY_VECTOR, '--tmpfs', '/tmp', '--bind', WORKSPACE, WORKSPACE])
})

/* --------------------------------------------- 2) workspace-root guard */

test('isUsableRemoteWorkspaceRoot: absolute, non-empty, NUL/newline-free only', () => {
  assert.equal(isUsableRemoteWorkspaceRoot(WORKSPACE), true)
  assert.equal(isUsableRemoteWorkspaceRoot('/'), false, 'the root is not a workspace')
  for (const bad of [undefined, null, '', 'relative', './ws', '../ws', '~/ws', '/ws\n', '/ws\r', '/ws\u0000', 7, {}, ['/ws']]) {
    assert.equal(isUsableRemoteWorkspaceRoot(bad), false, `${JSON.stringify(bad)} must be rejected`)
  }
})

test('resolveRemoteWorkspaceRoot: first usable candidate wins, else undefined', () => {
  assert.equal(resolveRemoteWorkspaceRoot(undefined, '/', WORKSPACE, '/other'), WORKSPACE)
  assert.equal(resolveRemoteWorkspaceRoot(), undefined)
  assert.equal(resolveRemoteWorkspaceRoot(undefined, 'relative', '/'), undefined)
})

/* ------------------------------------------------- 3) error surface */

test('remoteSandboxUnavailableError: carries the code and the mode, with and without a cause', () => {
  const plain = remoteSandboxUnavailableError('read-only')
  assert.equal(plain.code, REMOTE_SANDBOX_UNAVAILABLE)
  assert.equal(plain.name, 'RemoteSandboxError')
  assert.match(plain.message, /sandbox mode "read-only"/)
  assert.match(plain.message, /refusing to run it unconfined/)
  assert.equal(plain.message.includes('Cause:'), false)

  const detailed = remoteSandboxUnavailableError('workspace-write', 'no registry connection is associated with this route')
  assert.match(detailed.message, /sandbox mode "workspace-write"/)
  assert.match(detailed.message, /Cause: no registry connection/)
  assert.equal(remoteSandboxUnavailableError('read-only', '').message, plain.message)
})

test('coreMissingHint: only a missing component binary gets the redeploy hint', () => {
  const coreGone = 'core stdout closed: bash: line 1: /home/uuz/.dsh-core/current/dsh-core: No such file or directory'
  assert.match(String(coreMissingHint(coreGone)), /core\.deploy/)
  assert.equal(coreMissingHint("env: 'bwrap': No such file or directory"), undefined)
  assert.equal(coreMissingHint('bwrap: Permission denied'), undefined)
  const refusal = remoteSandboxUnavailableError('workspace-write', coreGone)
  assert.match(refusal.message, /re-run sw_connect to redeploy it \(or use the plugin settings \/ core\.deploy\)/)
})

test('the refusal vocabulary stays distinct from the approval gate refusal', () => {
  assert.equal(REMOTE_SANDBOX_UNAVAILABLE, 'SANDBOX_UNAVAILABLE', 'the upstream code string, verbatim')
  assert.equal(REMOTE_SANDBOX_MESSAGES.terminalUnsupported.includes('{mode}'), true)
})
