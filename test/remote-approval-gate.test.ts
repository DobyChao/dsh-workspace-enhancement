/**
 * AUDIT-6（ADR-0020）远程审批门单测：
 *
 * 1. 纯逻辑——shell 形状判定、reason 标记/解析、命令预览截断、白名单分类器
 *    （放行面与拒绝面，含元字符/截断/终端形状）；
 * 2. asker——假 approval 服务下的门行为（allowed-once 放行 / rejected /
 *    cancelled / unavailable / never 策略确定性拒绝 / approval 服务缺失 /
 *    agent 缺失 / request 抛错 / 覆盖判定 off·未知机器·非壳形状·终端）；
 * 3. AI answerer——只答带标记 ask（机器 ai + 白名单），其余与异常一律 next()；
 * 4. sw_exec 同门——`buildShellArgv` 的产物形状就是壳形状，且引擎级
 *    spawn（sw_exec 的 argv + `ssh://` cwd）在拒绝时 done 以门错误失败、
 *    连接零接触；
 * 5. 装配——engine spawn/spawnTerminal 门、混合门面本地分支不过门；
 * 6. 生命周期——answerer 经 ctx.effect 注册可逆，重挂不抛 already
 *    registered；
 * 7. 配置面——machines.json 归一化（缺字段 ⇒ 'off'）、saveMachine upsert
 *    语义、machinePayload 恒带字段。
 * @module test/remote-approval-gate
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SshRegistry } from '../src/registry.ts'
import { buildShellArgv } from '../src/exec-tools.ts'
import { MixedSubprocessRuntime } from '../src/mixed.ts'
import type { SubprocessBranch } from '../src/mixed.ts'
import { SshSubprocessEngine, SshSubprocessRuntime } from '../src/subprocess.ts'
import { sshRoutePlaceholder } from '../src/transport.ts'
import { machinePayload, EMPTY_MACHINE_FORM } from '../src/client/machine-payload.ts'
import {
  GATE_ERRORS,
  GATE_MARKER,
  REMOTE_COMMAND_WHITELIST,
  REMOTE_EXEC_TOOL_NAME,
  RemoteGateError,
  askRemoteApproval,
  commandPreviewOf,
  createRemoteApprovalAnswerer,
  createRemoteSpawnGate,
  gateReasonOf,
  isRemoteShellShape,
  isTruncatedPreview,
  isWhitelistedRemoteCommand,
  parseGateReason,
  registerRemoteApprovalAnswerer,
} from '../src/remote-approval-gate.ts'
import type {
  RemoteApprovalAgentFace,
  RemoteApprovalDeps,
  RemoteApprovalMachineFace,
  RemoteApprovalOutcome,
  RemoteApprovalServiceFace,
  RemoteSpawnGate,
} from '../src/remote-approval-gate.ts'

/* ---------------------------------------------------------------- helpers */

const AGENT: RemoteApprovalAgentFace = { id: 'sess-1' }

function machine(overrides: Partial<RemoteApprovalMachineFace> = {}): RemoteApprovalMachineFace {
  return { id: 'c1', username: 'root', host: 'srv.example', remoteApproval: 'human', ...overrides }
}

/**
 * Fake approval service implementing the platform contract the gate relies on
 * (`dsh-user-approval` 0.1.5: `never` rejects deterministically BEFORE any
 * answerer; `ask` returns the composed outcome).
 */
function fakeApproval(options: { policy?: 'ask' | 'never'; outcome?: RemoteApprovalOutcome; throwWith?: Error } = {}):
  { service: RemoteApprovalServiceFace; asks: Array<{ toolName: string; reason?: string }> } {
  const asks: Array<{ toolName: string; reason?: string }> = []
  return {
    asks,
    service: {
      async request(req) {
        asks.push({ toolName: req.toolName, reason: req.reason })
        if (options.throwWith !== undefined) throw options.throwWith
        if (options.policy === 'never') return 'rejected'
        return options.outcome ?? 'allowed-once'
      },
    },
  }
}

/** Deps harness: every slot overridable, calls observable. */
function fakeDeps(overrides: Partial<RemoteApprovalDeps> & { machines?: RemoteApprovalMachineFace[] } = {}): RemoteApprovalDeps {
  return {
    approval: overrides.approval ?? (() => fakeApproval().service),
    initiator: overrides.initiator ?? (() => AGENT),
    machine: overrides.machine ?? ((id: string) => overrides.machines?.find(m => m.id === id)),
    ...(overrides.warn !== undefined ? { warn: overrides.warn } : {}),
  }
}

const gateInput = (argv: readonly string[], extra: { connectionId?: string; terminal?: boolean; signal?: AbortSignal } = {}) => ({
  argv,
  ...('connectionId' in extra ? { connectionId: extra.connectionId } : { connectionId: 'c1' as const }),
  ...(extra.terminal !== undefined ? { terminal: extra.terminal } : {}),
  ...(extra.signal !== undefined ? { signal: extra.signal } : {}),
})

/* ------------------------------------------------ 1) shell 形状与纯函数 */

test('isRemoteShellShape: model-command carrier shapes are gated, host-assembled argv is not', () => {
  assert.equal(isRemoteShellShape(['bash', '-c', 'make']), true)
  assert.equal(isRemoteShellShape(['sh', '-c', 'true']), true)
  assert.equal(isRemoteShellShape(['zsh', '-c', 'ls']), true)
  assert.equal(isRemoteShellShape(['dash', '-c', 'ls']), true)
  assert.equal(isRemoteShellShape(['pwsh', '-Command', 'Get-Date']), true)
  assert.equal(isRemoteShellShape(['powershell', '-Command', 'Get-Date']), true)
  assert.equal(isRemoteShellShape(['pwsh', '-c', 'Get-Date']), true, 'pwsh short -c form')
  assert.equal(isRemoteShellShape(['bash', '-lc', 'make']), true, 'POSIX combined short flag carrying c')
  assert.equal(isRemoteShellShape([String.raw`C:\cygwin\bin\bash.exe`, '-c', 'make']), true, 'basename + .exe strip')
  // Not gated (ADR-0020 D1 carve-outs):
  assert.equal(isRemoteShellShape(['bash', 'script.sh']), false, 'bash running a file carries no -c text')
  assert.equal(isRemoteShellShape(['rg', '--path', '.']), false)
  assert.equal(isRemoteShellShape(['node', '-e', 'console.log(1)']), false)
  assert.equal(isRemoteShellShape(['bash']), false, 'bare interactive shell (spawn path; terminals gate via terminal flag)')
  assert.equal(isRemoteShellShape([]), false)
})

test('command preview: joined argv, capped with an explicit truncation marker', () => {
  assert.equal(commandPreviewOf(['bash', '-c', 'uname -a']), 'bash -c uname -a')
  assert.equal(commandPreviewOf(['bash', undefined, '-c', 'x']), 'bash -c x', 'undefined argv slots drop out')
  const long = ['bash', '-c', 'x'.repeat(500)]
  const preview = commandPreviewOf(long)
  assert.equal(preview.length, 161)
  assert.equal(isTruncatedPreview(preview), true)
  assert.equal(isTruncatedPreview('bash -c uname -a'), false)
})

test('gate reason: machine=<id> target=<user@host> cmd=<preview> round-trips strictly', () => {
  const reason = gateReasonOf({ machineId: 'c1', target: 'root@srv.example', preview: 'bash -c uname -a' })
  assert.equal(reason, `${GATE_MARKER} machine=c1 target=root@srv.example cmd=bash -c uname -a`)
  assert.deepEqual(parseGateReason(reason), { machineId: 'c1', target: 'root@srv.example', preview: 'bash -c uname -a' })
  assert.equal(parseGateReason(reason).preview, 'bash -c uname -a')
  // A preview containing spaces survives (cmd= is the tail).
  const spaced = gateReasonOf({ machineId: 'c1', target: 'root@srv.example', preview: 'bash -c git status --short' })
  assert.equal(parseGateReason(spaced)?.preview, 'bash -c git status --short')
  // Everything else is not ours:
  assert.equal(parseGateReason('sandbox escalation for pwsh'), null)
  assert.equal(parseGateReason(`${GATE_MARKER} machine=`), null)
  assert.equal(parseGateReason(undefined), null)
  assert.equal(parseGateReason(`${GATE_MARKER} machine=c1 target=a@b cmd=`), null, 'empty preview rejected')
})

/* ------------------------------------------------------- 2) 白名单分类器 */

test('whitelist: read-only single commands are granted (final AUDIT-6 shortlist)', () => {
  const granted = [
    'bash -c pwd',
    'bash -c whoami',
    'bash -c uname',
    'bash -c uname -a',
    'bash -c uname --all',
    'bash -c ls',
    'bash -c ls -la /tmp',
    'bash -c cat /etc/hosts',
    'bash -c head -n 5 app.log',
    'bash -c tail -f /var/log/syslog',
    'bash -c wc -l notes.txt',
    'bash -c echo hello world',
    'bash -c git status',
    'bash -c git status --short',
    'bash -c git log -1',
    'bash -c git diff',
    'bash -c git show HEAD',
    'bash -c git status --short --output=x y', // extra args after an allowlisted subcommand stay read-only
    'bash -c node -v',
    'bash -c node --version',
    'bash -c rg --version',
    'bash -c rg -V',
    'sh -c pwd',
    'pwsh -Command node -v',
    `bash -c ${'ls'}`,
  ]
  for (const preview of granted) {
    assert.equal(isWhitelistedRemoteCommand(preview), true, `expected grant: ${preview}`)
  }
  // The reviewable rule table stays in sync with the classifier.
  assert.equal(Object.keys(REMOTE_COMMAND_WHITELIST).length >= 17, true)
})

test('whitelist: everything else falls to the human — metachars, truncation, mutation, terminals', () => {
  const denied = [
    'bash -c touch x',
    'bash -c rm -rf /',
    'bash -c git push',
    'bash -c git -c core.pager=sh log', // global git flags → human (documented rule)
    'bash -c node -e process.exit(1)',
    'bash -c rg --pre /bin/sh pattern', // rg proper is NOT allowlisted: --pre executes commands
    'bash -c git status; rm -rf /', // `;`
    'bash -c echo $(whoami)', // `$`
    'bash -c echo `id`', // backtick
    'bash -c echo a | tee /etc/passwd', // `|`
    'bash -c git diff > /etc/crontab', // `>`
    'bash -c git status && touch /tmp/x', // `&`
    'bash -c (cd / && rm x)', // `(`
    'bash -c echo hi\ncurl evil', // newline is a command separator (guard addition)
    'bash -l', // interactive terminal shape: no -c payload → never auto-granted
    'bash -c ' + 'x'.repeat(300), // truncated preview
    '',
    'rg --path .', // not even a shell preview
  ]
  for (const preview of denied) {
    assert.equal(isWhitelistedRemoteCommand(preview), false, `expected deny: ${preview.slice(0, 60)}`)
  }
})

/* ------------------------------------------------------------- 3) asker */

test('asker: coverage — off machine, unknown machine, absent connectionId, and non-shell argv never ask', async () => {
  const approval = fakeApproval()
  const deps = fakeDeps({ approval: () => approval.service, machines: [machine({ remoteApproval: 'off' })] })
  await askRemoteApproval(deps, gateInput(['bash', '-c', 'make']))
  assert.equal(approval.asks.length, 0, 'off machine: no ask')

  const depsUnknown = fakeDeps({ approval: () => approval.service, machines: [machine({ id: 'c2' })] })
  await askRemoteApproval(depsUnknown, gateInput(['bash', '-c', 'make']))
  assert.equal(approval.asks.length, 0, 'unknown machine id: no ask')

  const depsNoRoute = fakeDeps({ approval: () => approval.service, machines: [machine()] })
  await askRemoteApproval(depsNoRoute, gateInput(['bash', '-c', 'make'], { connectionId: undefined }))
  assert.equal(approval.asks.length, 0, 'no registry connection: no ask')

  const depsShape = fakeDeps({ approval: () => approval.service, machines: [machine()] })
  await askRemoteApproval(depsShape, gateInput(['rg', '--path', '.']))
  await askRemoteApproval(depsShape, gateInput(['node', '-e', '1']))
  await askRemoteApproval(depsShape, gateInput(['bash', 'script.sh']))
  assert.equal(approval.asks.length, 0, 'non-shell shapes: no ask')
})

test('asker: gated machine asks with toolName sw:remote-exec and the marked reason', async () => {
  const approval = fakeApproval()
  const deps = fakeDeps({ approval: () => approval.service, machines: [machine()] })
  await askRemoteApproval(deps, gateInput(['bash', '-c', 'uname -a']))
  assert.equal(approval.asks.length, 1)
  assert.equal(approval.asks[0]?.toolName, REMOTE_EXEC_TOOL_NAME)
  const facts = parseGateReason(approval.asks[0]?.reason)
  assert.deepEqual(facts, { machineId: 'c1', target: 'root@srv.example', preview: 'bash -c uname -a' })
})

test('asker: allowed-once is the only grant — each other outcome maps to a distinct error', async () => {
  const texts = new Set<string>()
  for (const outcome of ['rejected', 'cancelled', 'unavailable', 'weird-value'] as const) {
    const approval = fakeApproval({ outcome })
    const deps = fakeDeps({ approval: () => approval.service, machines: [machine()] })
    await assert.rejects(
      () => askRemoteApproval(deps, gateInput(['bash', '-c', 'make'])),
      (error: unknown) => {
        assert.ok(error instanceof RemoteGateError)
        texts.add(error.message)
        return true
      },
    )
  }
  assert.equal(texts.size, 4, 'four outcomes, four pairwise-distinguishable texts')
  for (const text of texts) {
    assert.match(text, /^remote command (blocked|not run|rejected)/)
  }
  assert.equal(GATE_ERRORS.rejected.includes('`never`'), true)
  assert.equal(GATE_ERRORS.unavailable.includes('failing closed'), true)
})

test('asker: the never policy is the service\'s deterministic rejection — no special-casing', async () => {
  const approval = fakeApproval({ policy: 'never' })
  const deps = fakeDeps({ approval: () => approval.service, machines: [machine({ remoteApproval: 'ai' })] })
  await assert.rejects(
    () => askRemoteApproval(deps, gateInput(['bash', '-c', 'uname -a'])),
    /remote command rejected — the approval policy is `never`/,
  )
})

test('asker: degradation ladder — missing approval service, missing agent, throwing request', async () => {
  const noService = fakeDeps({ approval: () => undefined, machines: [machine()] })
  await assert.rejects(
    () => askRemoteApproval(noService, gateInput(['bash', '-c', 'make'])),
    /remote command blocked: machine c1 has the approval gate enabled but no approval service/,
  )

  const noAgent = fakeDeps({ initiator: () => undefined, machines: [machine()] })
  await assert.rejects(
    () => askRemoteApproval(noAgent, gateInput(['bash', '-c', 'make'])),
    /remote command blocked: no initiating agent/,
  )

  const thrown = fakeDeps({
    approval: () => fakeApproval({ throwWith: new Error('outside an open turn') }).service,
    machines: [machine()],
  })
  await assert.rejects(
    () => askRemoteApproval(thrown, gateInput(['bash', '-c', 'make'])),
    /remote command blocked: the approval request failed — outside an open turn/,
  )
})

test('asker: terminals are gated regardless of shell shape; ai machines still ask (the answerer decides)', async () => {
  const approval = fakeApproval()
  const deps = fakeDeps({ approval: () => approval.service, machines: [machine()] })
  await askRemoteApproval(deps, gateInput(['bash'], { terminal: true }))
  assert.equal(approval.asks.length, 1, 'bare interactive shell on a terminal spawn IS gated')

  const ai = fakeApproval()
  const aiDeps = fakeDeps({ approval: () => ai.service, machines: [machine({ remoteApproval: 'ai' })] })
  await askRemoteApproval(aiDeps, gateInput(['bash', '-c', 'uname -a']))
  assert.equal(ai.asks.length, 1, 'ai machines ask too — auto-grant lives on the answerer side')
  assert.equal(parseGateReason(ai.asks[0]?.reason)?.machineId, 'c1')
})

/* ----------------------------------------------------------- 4) answerer */

function answererHarness(machines: RemoteApprovalMachineFace[], opts: { machineThrows?: boolean } = {}): {
  answer: (reason: string | undefined) => Promise<{ value: RemoteApprovalOutcome; nextCalls: number }>
  warns: string[]
} {
  let nextCalls = 0
  const warns: string[] = []
  const deps = fakeDeps({
    machines,
    warn: text => { warns.push(text) },
    machine: (id: string) => {
      if (opts.machineThrows === true) throw new Error('registry exploded')
      return machines.find(m => m.id === id)
    },
  })
  const handler = createRemoteApprovalAnswerer(deps)
  return {
    answer: async reason => {
      const before = nextCalls
      const value = await handler.call(undefined, { reason }, async () => {
        nextCalls += 1
        return 'unavailable' as const
      })
      return { value, nextCalls: nextCalls - before }
    },
    warns,
  }
}

test('answerer: only marked asks on ai machines with whitelisted previews are auto-granted', async () => {
  const h = answererHarness([machine({ remoteApproval: 'ai' })])
  const granted = await h.answer(gateReasonOf({ machineId: 'c1', target: 'root@srv.example', preview: 'bash -c uname -a' }))
  assert.deepEqual({ value: granted.value, nextCalls: granted.nextCalls }, { value: 'allowed-once', nextCalls: 0 })

  const notListed = await h.answer(gateReasonOf({ machineId: 'c1', target: 'root@srv.example', preview: 'bash -c touch x' }))
  assert.equal(notListed.value, 'unavailable', 'not whitelisted → delegated to the chain (fallback here)')
  assert.equal(notListed.nextCalls, 1)
})

test('answerer: unmarked reasons, human machines, and unknown machines delegate untouched', async () => {
  const h = answererHarness([machine({ remoteApproval: 'human' })])
  for (const reason of [
    'sandbox escalation for pwsh',
    undefined,
    `${GATE_MARKER} machine=zz target=a@b cmd=bash -c pwd`, // unknown machine
    `${GATE_MARKER} machine=c1 target=a@b cmd=bash -c pwd`, // c1 here is 'human'
  ]) {
    const result = await h.answer(reason)
    assert.equal(result.value, 'unavailable', `expected delegation for ${String(reason)}`)
    assert.equal(result.nextCalls, 1)
  }
})

test('answerer: classifier exceptions delegate (never grant, never throw) and warn', async () => {
  const h = answererHarness([machine({ remoteApproval: 'ai' })], { machineThrows: true })
  const result = await h.answer(gateReasonOf({ machineId: 'c1', target: 't', preview: 'bash -c pwd' }))
  assert.equal(result.value, 'unavailable')
  assert.equal(result.nextCalls, 1, 'exactly one delegation even on failure')
  assert.equal(h.warns.length, 1)
  assert.match(h.warns[0] as string, /classifier failed/)
})

test('answerer: a failing rest-of-chain propagates — not swallowed, single delegation', async () => {
  const deps = fakeDeps({ machines: [machine({ remoteApproval: 'ai' })] })
  const handler = createRemoteApprovalAnswerer(deps)
  let nextCalls = 0
  await assert.rejects(
    () => handler.call(undefined, { reason: gateReasonOf({ machineId: 'c1', target: 't', preview: 'bash -c touch x' }) }, async () => {
      nextCalls += 1
      throw new Error('ui answerer exploded')
    }),
    /ui answerer exploded/,
  )
  assert.equal(nextCalls, 1)
})

/* ------------------------------------------------- 5) sw_exec same gate */

test('sw_exec: buildShellArgv output is exactly the gated shell shape (both OSes)', () => {
  assert.deepEqual(buildShellArgv('linux', 'make'), ['bash', '-c', 'make'])
  assert.deepEqual(buildShellArgv('win32', 'Get-Date'), ['pwsh', '-Command', 'Get-Date'])
  assert.equal(isRemoteShellShape(buildShellArgv('linux', 'make')), true)
  assert.equal(isRemoteShellShape(buildShellArgv('win32', 'Get-Date')), true)
  assert.equal(isRemoteShellShape(buildShellArgv('unknown', 'make')), true)
})

/* ------------------------------------------------ 6) engine/facade wiring */

/**
 * A transport whose every remote-touching method throws a sentinel: any of
 * them being reached proves execution moved PAST the gate.
 */
function sentinelTransport(): { endpoint: string; cwd: string } & Record<string, unknown> {
  const boom = (what: string): never => {
    throw new Error(`TRANSPORT-REACHED: ${what}`)
  }
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

/** A minimal `sshRegistry` service face the gate and routing both consume. */
function fakeRegistryService(machines: RemoteApprovalMachineFace[]): Record<string, unknown> {
  return {
    get: (id: string) => (machines.some(m => m.id === id) ? sentinelTransport() : undefined),
    listMachines: () => ({ machines }),
  }
}

/** Spawn spec shaped exactly like sw_exec / the official bash tool's remote spawn. */
const remoteSpawnSpec = (argv: readonly string[], cwd: string): SubprocessSpawnSpec => ({
  argv: [...argv],
  cwd,
  stdio: { stdin: 'ignore', stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } },
  graceMs: 1000,
})

test('engine spawn: denial fails done with the gate error before any SSH activity', async () => {
  const ctx = new Context()
  ctx.provide('sshRegistry', fakeRegistryService([machine()]))
  const approval = fakeApproval({ outcome: 'rejected' })
  ctx.provide('approval', approval.service)
  ctx.provide('agents', { currentInitiator: () => AGENT })
  const engine = new SshSubprocessEngine(ctx, createRemoteSpawnGate(ctx))
  const handle = engine.spawn(remoteSpawnSpec(buildShellArgv('linux', 'make'), 'ssh://c1/srv/work'))
  await assert.rejects(
    () => handle.done,
    /remote command rejected — the approval policy is `never` \(unattended\) or the answerer denied it/,
  )
  assert.equal(approval.asks.length, 1)
})

test('engine spawn: an allowed-once ask proceeds past the gate (transport sentinel proves ordering)', async () => {
  const ctx = new Context()
  ctx.provide('sshRegistry', fakeRegistryService([machine()]))
  ctx.provide('approval', fakeApproval({ outcome: 'allowed-once' }).service)
  ctx.provide('agents', { currentInitiator: () => AGENT })
  const engine = new SshSubprocessEngine(ctx, createRemoteSpawnGate(ctx))
  const handle = engine.spawn(remoteSpawnSpec(buildShellArgv('linux', 'make'), 'ssh://c1/srv/work'))
  // The gate granted, so run() advanced to the remote-environment read — the
  // sentinel transport marks exactly that point.
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
})

test('engine spawnTerminal: gated before the terminal exists; local cwd never reaches the engine gate', async () => {
  const ctx = new Context()
  const gateCalls: Array<{ terminal?: boolean }> = []
  const gate: RemoteSpawnGate = async input => { gateCalls.push({ ...(input.terminal === true ? { terminal: true } : {}) }) }
  ctx.provide('sshRegistry', fakeRegistryService([machine()]))
  const engine = new SshSubprocessEngine(ctx, gate)
  const spec: SubprocessTerminalSpawnSpec = {
    argv: ['bash'],
    cwd: 'ssh://c1/srv/work',
    cols: 80,
    rows: 24,
    graceMs: 1000,
    signal: new AbortController().signal,
  }
  await assert.rejects(() => engine.spawnTerminal(spec), /TRANSPORT-REACHED/)
  assert.deepEqual(gateCalls, [{ terminal: true }], 'spawnTerminal runs the gate before touching SSH')
})

test('mixed facade: a LOCAL spawn never consults the gate', () => {
  const gateCalls: string[] = []
  const gate: RemoteSpawnGate = async input => { gateCalls.push(input.argv.join(' ')) }
  const local: SubprocessBranch = {
    async resolveExecutable(command: string): Promise<string> { return command },
    spawn(): SubprocessHandle {
      throw new Error('unexpected local spawn execution — shape assertion only')
    },
    async spawnTerminal(): Promise<never> { throw new Error('unexpected') },
  }
  const ctx = new Context()
  const engine = new SshSubprocessEngine(ctx, gate)
  const mixed = new MixedSubprocessRuntime(local, engine)
  assert.throws(() => mixed.spawn(remoteSpawnSpec(['rg', '--files'], join(tmpdir(), 'dsw-local-gate'))))
  // A local-cwd spawn failed inside the local branch (stub throws) — the point
  // is that the gate never fired:
  assert.deepEqual(gateCalls, [])
})

test('standalone SshSubprocessRuntime: mounts bare (subpath row) still fences gated machines', async () => {
  // A subpath deployment mounts this class with NO gate argument — the
  // constructor must attach one from its own context (ADR-0020 D1 uniformity).
  const ctx = new Context()
  ctx.provide('sshRegistry', fakeRegistryService([machine()]))
  const approval = fakeApproval({ outcome: 'rejected' })
  ctx.provide('approval', approval.service)
  ctx.provide('agents', { currentInitiator: () => AGENT })
  const runtime = new SshSubprocessRuntime(ctx)
  const handle = runtime.spawn(remoteSpawnSpec(buildShellArgv('linux', 'make'), 'ssh://c1/srv/work'))
  await assert.rejects(() => handle.done, /remote command rejected/)
  assert.equal(approval.asks.length, 1, 'the default-attached gate asked')
})

test('mixed facade: a REMOTE shell-shaped spawn reaches the engine gate (sw_exec argv)', () => {
  const gateCalls: Array<{ argv: string[]; connectionId?: string }> = []
  const gate: RemoteSpawnGate = async input => {
    gateCalls.push({ argv: [...input.argv], ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}) })
    throw new RemoteGateError(GATE_ERRORS.rejected)
  }
  const local: SubprocessBranch = {
    async resolveExecutable(command: string): Promise<string> { return command },
    spawn(): SubprocessHandle { throw new Error('local branch must not be reached') },
    async spawnTerminal(): Promise<never> { throw new Error('unexpected') },
  }
  const ctx = new Context()
  ctx.provide('sshRegistry', fakeRegistryService([machine()]))
  const engine = new SshSubprocessEngine(ctx, gate)
  const mixed = new MixedSubprocessRuntime(local, engine)
  const cwd = sshRoutePlaceholder('c1', '/srv/work')
  const handle = mixed.spawn(remoteSpawnSpec(buildShellArgv('linux', 'make'), cwd))
  assert.equal(gateCalls.length, 1, 'the remote spawn hit the gate')
  assert.deepEqual(gateCalls[0]?.argv, ['bash', '-c', 'make'])
  assert.equal(gateCalls[0]?.connectionId, 'c1')
  // The gate denial surfaces as the handle's done rejection (sync contract kept:
  // spawn returned a live handle immediately).
  return assert.rejects(() => handle.done, /remote command rejected/)
})

/* ----------------------------------------------- 7) registration lifecycle */

test('registerRemoteApprovalAnswerer: reversible, remounts without already-registered', async () => {
  const ctx = new Context()
  ctx.provide('sshRegistry', fakeRegistryService([machine({ remoteApproval: 'ai' })]))
  const ask = (): Promise<RemoteApprovalOutcome> =>
    ctx.waterfall('approval/request', { reason: gateReasonOf({ machineId: 'c1', target: 'root@srv.example', preview: 'bash -c uname -a' }) }, () => Promise.resolve('unavailable' as const))

  // Manual mount of exactly what the effect registers — `ctx.on` returns the
  // disposer (`ctx.effect` itself returns void; the effect scope owns it).
  const off = ctx.on('approval/request', createRemoteApprovalAnswerer({
    approval: () => undefined,
    initiator: () => AGENT,
    machine: (id: string) => (id === 'c1' ? machine({ remoteApproval: 'ai' }) : undefined),
  }), { prepend: true })
  assert.equal(await ask(), 'allowed-once')

  // Unload + remount: disposing frees the listener; a fresh registration must
  // not throw "already registered".
  assert.doesNotThrow(() => { off() })
  assert.doesNotThrow(() => registerRemoteApprovalAnswerer(ctx))
  // The fresh mount still answers (it re-reads the ai machine through the
  // fake registry service)…
  assert.equal(await ask(), 'allowed-once')
  // …and a double registration under one context is likewise accepted.
  assert.doesNotThrow(() => registerRemoteApprovalAnswerer(ctx))
})

test('registerRemoteApprovalAnswerer: unmarked asks fall through to the waterfall tail', async () => {
  const ctx = new Context()
  registerRemoteApprovalAnswerer(ctx)
  const outcome = await ctx.waterfall('approval/request', { reason: 'sandbox escalation for pwsh' }, () => Promise.resolve('unavailable' as const))
  assert.equal(outcome, 'unavailable', 'other tools\' asks reach the human answerer unchanged')
})

/* ------------------------------------------------------------ 8) config face */

test('normalizeMachine: missing/invalid remoteApproval reads as off (zero migration)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-gate-cfg-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const registry = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })
  const legacy = await registry.saveMachine({ host: 'h1', username: 'u' })
  assert.equal(legacy.remoteApproval, 'off', 'pre-AUDIT-6 record: default off, no migration')

  const human = await registry.saveMachine({ id: legacy.id, host: 'h1', username: 'u', remoteApproval: 'human' })
  assert.equal(human.remoteApproval, 'human')

  const untouched = await registry.saveMachine({ id: legacy.id, host: 'h1', username: 'u' })
  assert.equal(untouched.remoteApproval, 'human', 'upsert: an omitted field keeps the stored mode')

  const off = await registry.saveMachine({ id: legacy.id, host: 'h1', username: 'u', remoteApproval: 'off' })
  assert.equal(off.remoteApproval, 'off', 'explicit off clears the stored mode')

  // persist() is serialized behind the previous write — let it flush before
  // reading the file (same pattern as registry-view's sleep helper).
  await new Promise(resolve => setTimeout(resolve, 30))
  const persisted = JSON.parse(readFileSync(machinesFile, 'utf8')) as { list: Array<Record<string, unknown>> }
  assert.equal('remoteApproval' in (persisted.list[0] as object), false, 'off omits the field entirely')
})

test('machine payload: the approval select always carries an explicit mode', () => {
  assert.equal(EMPTY_MACHINE_FORM.remoteApproval, 'off')
  assert.equal(machinePayload({ ...EMPTY_MACHINE_FORM, host: 'h', username: 'u' }).remoteApproval, 'off')
  assert.equal(machinePayload({ ...EMPTY_MACHINE_FORM, host: 'h', username: 'u', remoteApproval: 'ai' }).remoteApproval, 'ai')
})
