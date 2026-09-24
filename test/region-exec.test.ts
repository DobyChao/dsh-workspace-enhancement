/**
 * REQ-I19 / ADR-0028: tool-to-world decisions and the jail that an undeclared
 * cwd must not mint. Refusals stay English.
 * @module test/region-exec
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'
import {
  BASH_USE_LOCAL,
  BASH_USE_SW_EXEC,
  BASH_USE_SW_EXEC_LOCAL_SESSION,
  SW_EXEC_USE_BASH,
  SW_EXEC_USE_LOCAL_BASH,
  SW_EXEC_USE_PWSH,
  SW_EXEC_WORLD_CONFLICT,
  decideSwExec,
  isReservedLocalServer,
  pinBashWorkdir,
  pinPwshWorkdir,
  sessionLocalCwd,
} from '../src/region-exec.ts'
import { adjustShellSpec } from '../src/remote-spawn-policy.ts'
import type { Context } from '@deepseek-ai/cordis'

const CJK = /[\u3400-\u9fff]/

test('decideSwExec: Windows remote session refuses its own machine and local paths', () => {
  const session = { platform: 'win32' as const, sessionMachineId: 'c1' }
  assert.deepEqual(decideSwExec({ ...session, requestedServer: undefined, workdir: undefined }), {
    action: 'refuse',
    message: SW_EXEC_USE_BASH,
  })
  assert.equal(decideSwExec({ ...session, requestedServer: 'c1', workdir: '/srv' }).action, 'refuse')
  assert.deepEqual(decideSwExec({ ...session, requestedServer: 'c2', workdir: undefined }), { action: 'remote' })
  assert.equal(decideSwExec({ ...session, requestedServer: 'local', workdir: undefined }).message, SW_EXEC_USE_PWSH)
  assert.equal(decideSwExec({ ...session, requestedServer: undefined, workdir: 'C:\\proj' }).message, SW_EXEC_USE_PWSH)
  assert.equal(decideSwExec({ ...session, requestedServer: 'c2', workdir: 'C:\\proj' }).message, SW_EXEC_WORLD_CONFLICT)
  for (const message of [SW_EXEC_USE_BASH, SW_EXEC_USE_PWSH, SW_EXEC_WORLD_CONFLICT]) {
    assert.equal(CJK.test(message), false)
  }
})

test('decideSwExec: Linux remote session uses bash for itself and sw_exec(local) for the host', () => {
  const session = { platform: 'linux' as const, sessionMachineId: 'c1' }
  assert.equal(decideSwExec({ ...session, requestedServer: undefined, workdir: undefined }).message, SW_EXEC_USE_BASH)
  assert.deepEqual(decideSwExec({ ...session, requestedServer: 'local', workdir: undefined }), { action: 'local' })
  assert.deepEqual(decideSwExec({ ...session, requestedServer: undefined, workdir: '/home/me/side' }), { action: 'local' })
  assert.deepEqual(decideSwExec({ ...session, requestedServer: 'c2', workdir: 'ssh://c2/opt' }), { action: 'remote' })
})

test('decideSwExec: a local session keeps sw_exec for remote servers and bash for the host', () => {
  const session = { platform: 'linux' as const, sessionMachineId: undefined }
  assert.deepEqual(decideSwExec({ ...session, requestedServer: 'c1', workdir: undefined }), { action: 'remote' })
  assert.equal(decideSwExec({ ...session, requestedServer: 'local', workdir: undefined }).message, SW_EXEC_USE_LOCAL_BASH)
  assert.equal(decideSwExec({ ...session, requestedServer: undefined, workdir: undefined }).action, 'remote')
})

test('sessionLocalCwd: one local side root, otherwise home', () => {
  assert.equal(sessionLocalCwd(['/work/side']), '/work/side')
  assert.equal(sessionLocalCwd(['/a', '/b']), homedir())
  assert.equal(sessionLocalCwd([]), homedir())
})

test('pinBashWorkdir: remote session rejects local paths and other machines', () => {
  assert.equal(pinBashWorkdir('ssh://c1/srv', 'ssh://c1/srv'), 'ssh://c1/srv')
  assert.throws(() => pinBashWorkdir('ssh://c2/opt', 'ssh://c1/srv'), new RegExp(BASH_USE_SW_EXEC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.throws(() => pinBashWorkdir('/home/me', 'ssh://c1/srv'), /server "local"/)
  assert.throws(() => pinBashWorkdir('ssh://c1/srv', '/home/me'), new RegExp(BASH_USE_SW_EXEC_LOCAL_SESSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.throws(() => pinBashWorkdir('/home/box/proj/ssh:/c1/srv', '/home/box/proj'), new RegExp(BASH_USE_SW_EXEC_LOCAL_SESSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.throws(() => pinBashWorkdir('/home/box/.dsh-lab/dsw-routes/c1/work/ssh:/c2/other', 'ssh://c1/srv'), new RegExp(BASH_USE_SW_EXEC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(pinBashWorkdir('/home/me', '/home/proj'), '/home/me')
  assert.equal(BASH_USE_LOCAL.includes('server "local"'), true)
})

test('pinPwshWorkdir: remote spellings stay on the local default cwd', () => {
  assert.equal(pinPwshWorkdir('ssh://c1/srv', 'D:\\side'), 'D:\\side')
  assert.equal(pinPwshWorkdir('/srv/app', 'D:\\side'), 'D:\\side')
  assert.equal(pinPwshWorkdir('C:\\proj', 'D:\\side'), 'C:\\proj')
  assert.equal(pinPwshWorkdir(undefined, 'D:\\side'), undefined)
})

test('isReservedLocalServer: only the sentinel', () => {
  assert.equal(isReservedLocalServer('local'), true)
  assert.equal(isReservedLocalServer('c1'), false)
  assert.equal(isReservedLocalServer(undefined), false)
})

test('adjustShellSpec: the host shell stays in its own world', () => {
  const ctx = { get: () => undefined } as unknown as Context
  if (process.platform === 'win32') {
    const next = adjustShellSpec(ctx, { workdir: 'ssh://c1/srv' })
    assert.equal(next.workdir, homedir())
    return
  }
  assert.throws(() => adjustShellSpec(ctx, { workdir: 'ssh://c1/srv' }), /Remote commands use sw_exec/)
})

test('adjustShellSpec: a local-exec flag is stripped and not repinned', () => {
  const ctx = { get: () => undefined } as unknown as Context
  const next = adjustShellSpec(ctx, { workdir: '/home/side', dswLocalExec: true, sandboxPolicy: { mode: 'workspace-write' } })
  assert.equal(next.workdir, '/home/side')
  assert.equal('dswLocalExec' in next, false)
  assert.deepEqual(next.sandboxPolicy, { mode: 'workspace-write' })
})
