/**
 * REQ-I27 / ADR-0031 单测：confine 标记注册表（`src/remote-confine-policy.ts`）的
 * 契约——进程内身份语义（防伪造核心）、无标记 = 不围栏（`--sandbox off`）、
 * spawnTerminal 的「有标记（模型侧）拒 / 无标记（人开的）放行」（ADR-0031 §4，
 * 所有者 2026-10-11 拍板）、以及 `isRemoteCommandDenial` 从 `remote-confine.ts`
 * 再导出的连续性。
 * @module test/req-i27-confine-policy
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  REMOTE_CORE_DENIAL_SIGNATURE,
  confinedSpawnMarkOf,
  isRemoteCommandDenial,
  markConfinedArgv,
} from '../src/remote-confine-policy.ts'
import {
  REMOTE_CORE_DENIAL_SIGNATURE as REEXPORTED_SIGNATURE,
  isRemoteCommandDenial as reexportedDenial,
} from '../src/remote-confine.ts'
import { createRemoteSandboxFence } from '../src/remote-sandbox-fence.ts'
import { SshSubprocessEngine } from '../src/subprocess.ts'
import { REMOTE_SANDBOX_UNAVAILABLE, RemoteSandboxError } from '../src/remote-sandbox.ts'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SshTransport } from '../src/transport.ts'

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

/* --------------- 3) spawnTerminal：有 confined 标记拒 / 无标记放行（§4） */

/** A transport whose every remote-touching member is a loud sentinel. */
function sentinelTransport(): SshTransport {
  const boom = (what: string): never => { throw new Error(`TRANSPORT-REACHED: ${what}`) }
  return {
    endpoint: 'root@srv.example',
    cwd: '/srv/work',
    getClient: () => boom('getClient'),
    getSftp: () => boom('getSftp'),
    getRemoteEnvironment: () => boom('getRemoteEnvironment'),
    exec: () => boom('exec'),
    resolveRemoteCwd: () => '/srv/work',
  }
}

/** A minimal context: aggregate ssh transport + registry `c1` → sentinel. */
function terminalContext(): Context {
  const ctx = new Context()
  ctx.provide('ssh', sentinelTransport())
  ctx.provide('sshRegistry', {
    get: (id: string) => (id === 'c1' ? sentinelTransport() : undefined),
    listMachines: () => ({ machines: [{ id: 'c1' }] }),
  })
  return ctx
}

const terminalSpec = (argv: readonly string[]): SubprocessTerminalSpawnSpec => ({
  argv: [...argv],
  cwd: 'ssh://c1/srv/work',
  cols: 80,
  rows: 24,
  graceMs: 1000,
  signal: new AbortController().signal,
})

test('spawnTerminal: a MARKED confined argv is refused naming the mode (model-side persistent shell)', async () => {
  const engine = new SshSubprocessEngine(terminalContext())
  const mode: SandboxMode = 'read-only'
  const marked = markConfinedArgv(['bash'], { mode })
  // NB: the spec must carry the marked array BY REFERENCE — a copying helper
  // would drop the mark (that is the anti-forgery semantics under test).
  await assert.rejects(
    () => engine.spawnTerminal({ ...terminalSpec(['bash']), argv: marked.argv }),
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError, String(error))
      assert.match((error as Error).message, /refuses to open an interactive terminal/)
      assert.match((error as Error).message, /read-only/)
      return true
    },
  )
})

test('spawnTerminal: an UNMARKED argv proceeds to the transport (the human browser terminal, §4)', async () => {
  const engine = new SshSubprocessEngine(terminalContext())
  await assert.rejects(
    () => engine.spawnTerminal(terminalSpec(['bash'])),
    (error: unknown) => {
      assert.ok(!(error instanceof RemoteSandboxError), 'an unmarked terminal must not be refused')
      assert.match(String(error), /TRANSPORT-REACHED/)
      return true
    },
  )
})

test('spawnTerminal: a DANGER mark is not a fence — it proceeds like unmarked', async () => {
  const engine = new SshSubprocessEngine(terminalContext())
  const marked = markConfinedArgv(['bash'], { mode: 'danger-full-access' })
  await assert.rejects(
    () => engine.spawnTerminal({ ...terminalSpec(['bash']), argv: marked.argv }),
    /TRANSPORT-REACHED/,
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
