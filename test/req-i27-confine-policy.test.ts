/**
 * REQ-I27 / ADR-0031 单测：confine 标记注册表（`src/remote-confine-policy.ts`）的
 * 契约——进程内身份语义（防伪造核心）、无标记 = 不围栏（`--sandbox off`）、
 * 以及 `isRemoteCommandDenial` 从 `remote-confine.ts` 再导出的连续性。
 * spawnTerminal 的拒/放行契约（ADR-0031 §4）在 `test/remote-sandbox-wiring.test.ts` §4。
 * @module test/req-i27-confine-policy
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  REMOTE_CORE_DENIAL_SIGNATURE,
  carryConfinedSpawnMark,
  confinedSpawnMarkOf,
  isRemoteCommandDenial,
  markConfinedArgv,
} from '../src/remote-confine-policy.ts'
import {
  REMOTE_CORE_DENIAL_SIGNATURE as REEXPORTED_SIGNATURE,
  isRemoteCommandDenial as reexportedDenial,
} from '../src/remote-confine.ts'
import { createRemoteSandboxFence } from '../src/remote-sandbox-fence.ts'
import { REMOTE_SANDBOX_UNAVAILABLE, RemoteSandboxError } from '../src/remote-sandbox.ts'

/* ------------------------------------------------ 1) 注册表的身份语义 */

const ARGV = ['bash', '-c', 'echo hi'] as const

test('markConfinedArgv: the ConfinedArgv shape matches the remote core dialect', () => {
  const product = markConfinedArgv(ARGV, { mode: 'read-only' })
  assert.deepEqual(product.argv, [...ARGV])
  assert.equal(product.enforcement, 'full')
  assert.deepEqual(product.denialSignatures, ['read-only file system'])
  assert.deepEqual(product.runnerFailureRules, [{ fatalSignatures: ['bwrap: '] }])
})

test('the registry: the RETURNED argv is the mark (ADR-0031 §3.1 — policy rides the object)', () => {
  const product = markConfinedArgv(ARGV, { mode: 'workspace-write' })
  assert.deepEqual(confinedSpawnMarkOf(product.argv), { mode: 'workspace-write' })
})

test('the registry: the ORIGINAL argv stays unmarked (only the product carries the policy)', () => {
  const original = ['bash', '-c', 'x']
  markConfinedArgv(original, { mode: 'read-only' })
  assert.equal(confinedSpawnMarkOf(original), undefined)
})

test('anti-forgery: a copied array loses the mark — [...marked] never matches', () => {
  const product = markConfinedArgv(ARGV, { mode: 'read-only' })
  const copied = [...product.argv]
  assert.equal(confinedSpawnMarkOf(copied), undefined)
})

test('BUG-25: carryConfinedSpawnMark moves an existing mark and does not invent one', () => {
  const product = markConfinedArgv(ARGV, { mode: 'workspace-write' })
  const copied = [...product.argv]
  assert.equal(confinedSpawnMarkOf(copied), undefined)
  assert.equal(carryConfinedSpawnMark(product.argv, copied), copied)
  assert.deepEqual(confinedSpawnMarkOf(copied), { mode: 'workspace-write' })
  assert.equal(carryConfinedSpawnMark(product.argv, product.argv), product.argv)

  const unmarked = ['bash', '-c', 'plain']
  const target = ['bash', '-c', 'plain']
  carryConfinedSpawnMark(unmarked, target)
  assert.equal(confinedSpawnMarkOf(target), undefined)
  carryConfinedSpawnMark(undefined, target)
  assert.equal(confinedSpawnMarkOf(target), undefined)
})

test('anti-forgery: a NEW array with identical CONTENT never matches (no prefix protocol)', () => {
  const product = markConfinedArgv(ARGV, { mode: 'workspace-write' })
  const lookalike = [...ARGV]
  assert.deepEqual(lookalike, product.argv)
  assert.equal(confinedSpawnMarkOf(lookalike), undefined)
  assert.equal(confinedSpawnMarkOf(undefined), undefined)
})

/* ------------------------------- 2) 无标记 = danger（fence 闭包纯断言） */

test('fence: an UNMARKED argv with no hub runs as-is — no session service consulted', async () => {
  // 无 sandboxPolicy/coreHub/sshRegistry 服务：无标记 argv 仍原样返回（--sandbox off）。
  const fence = createRemoteSandboxFence(new Context())
  const argv = ['bash', '-c', 'echo hi']
  assert.deepEqual(await fence({ connectionId: 'c1', cwd: '/srv/work', argv }), argv)
})

test('fence: a confined MARK with no hub stays fail-closed (SANDBOX_UNAVAILABLE)', async () => {
  const fence = createRemoteSandboxFence(new Context())
  const marked = markConfinedArgv(ARGV, { mode: 'read-only' })
  await assert.rejects(
    () => fence({ connectionId: 'c1', cwd: '/srv/work', argv: marked.argv }),
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError, String(error))
      assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
      return true
    },
  )
})

/* ------------------------- 4) 再导出连续性（remote-confine.ts 旧路径） */

test('isRemoteCommandDenial: the remote-confine re-export is the SAME binding', () => {
  assert.equal(reexportedDenial, isRemoteCommandDenial)
  assert.equal(REEXPORTED_SIGNATURE, REMOTE_CORE_DENIAL_SIGNATURE)
  assert.equal(REEXPORTED_SIGNATURE, 'read-only file system')
})

test('isRemoteCommandDenial: exit 0 / null never deny; a bwrap dialect stderr does', () => {
  assert.equal(isRemoteCommandDenial(0, 'Read-only file system'), false)
  assert.equal(isRemoteCommandDenial(null, 'Read-only file system'), false)
  assert.equal(isRemoteCommandDenial(1, 'mkdir: Read-only file system'), true)
  assert.equal(isRemoteCommandDenial(1, 'permission denied'), false)
})
