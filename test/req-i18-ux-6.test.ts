/**
 * REQ-I18: one-shot spawn policy reaches the core, and a denial carries the
 * official escalation hint. UX-6: tool schemas stay English when Language is zh.
 * @module test/req-i18-ux-6
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { escalationHintMarker, sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'
import { SshSubprocessEngine } from '../src/subprocess.ts'
import { coreServeSandboxOf } from '../src/remote-policy.ts'
import {
  currentRemoteSpawnPolicy,
  installRemoteSpawnPolicyBridge,
  runWithRemoteSpawnPolicy,
} from '../src/remote-spawn-policy.ts'
import { registerSwExec, registerWin32Bash, renderSwExecForeground } from '../src/exec-tools.ts'
import type { SwExecForeground } from '../src/exec-tools.ts'
import { SW_CONNECT_DESCRIPTION, SW_STATUS_DESCRIPTION } from '../src/tool-schema.ts'
import type { SshRegistry } from '../src/registry.ts'

const CJK = /[\u3400-\u9fff]/

function handle(exitCode: number, stderr: string): SubprocessHandle {
  return {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: stderr, nextOffset: 0, lossy: false }) },
    },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: () => {},
    waitForExit: async () => true,
  }
}

const spec = (): SubprocessSpawnSpec => ({
  argv: ['bash', '-c', 'echo'],
  cwd: 'ssh://c1/srv/work',
  stdio: { stdin: { data: '' }, stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } },
  graceMs: 1000,
})

test('REQ-I18: allowed-once uses danger for this spawn; the next spawn stays session-fenced', () => {
  const seen: string[] = []
  const ctx = new Context()
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write' }) })
  ctx.provide('sshRegistry', { get: () => ({}) })
  const hub = {
    require: async (_id: string, opts?: { policy?: string }) => {
      seen.push(opts?.policy ?? '')
      throw new Error('stop')
    },
  }
  const engine = new SshSubprocessEngine(
    ctx,
    undefined,
    async () => { throw new Error('fence should not run') },
    undefined,
    hub as never,
  )
  engine.spawn(spec())
  runWithRemoteSpawnPolicy({ mode: 'danger-full-access' }, () => { engine.spawn(spec()) })
  engine.spawn(spec())
  assert.deepEqual(seen, ['workspace-write', 'danger-full-access', 'workspace-write'])
  assert.equal(coreServeSandboxOf('danger-full-access'), 'off')
  assert.equal(coreServeSandboxOf('workspace-write'), 'workspace-write')
})

test('REQ-I18: shell.run keeps sandboxPolicy across await and clears it after', async () => {
  const ctx = new Context()
  ctx.provide('shell', {
    async run() {
      await Promise.resolve()
      return currentRemoteSpawnPolicy()
    },
    start() {
      return currentRemoteSpawnPolicy()
    },
  })
  installRemoteSpawnPolicyBridge(ctx)
  const shell = ctx.get('shell') as {
    run: (spec: { sandboxPolicy?: unknown }) => Promise<unknown>
    start: (spec: { sandboxPolicy?: unknown }) => unknown
  }
  const during = await shell.run({ sandboxPolicy: { mode: 'danger-full-access' } })
  assert.deepEqual(during, { mode: 'danger-full-access' })
  assert.equal(currentRemoteSpawnPolicy(), undefined)
  assert.deepEqual(shell.start({ sandboxPolicy: { mode: 'workspace-write' } }), { mode: 'workspace-write' })
})

interface Captured {
  name: string
  description: string
  parameters: { properties?: Record<string, { description?: string; enum?: string[] }> }
  execute: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
  output: { render: (args: unknown, value: unknown) => Array<{ text: string }> }
}

function toolHost(options: {
  preference?: string
  spawn?: (spec: SubprocessSpawnSpec) => SubprocessHandle
  approval?: { request: () => Promise<string> }
} = {}): { ctx: Context; tools: Captured[] } {
  const tools: Captured[] = []
  const ctx = {
    get: (name: string) => {
      if (name === 'subprocess') return { spawn: options.spawn ?? (() => handle(0, '')) }
      if (name === 'settings') return { get: () => ({ preference: options.preference ?? 'en' }) }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (name === 'approval') return options.approval
      return undefined
    },
    tools: { register: (definition: Captured) => { tools.push(definition); return () => {} } },
    systemPrompt: { section: () => () => {} },
    effect: (fn: () => unknown) => { fn() },
    on: () => () => {},
  }
  return { ctx: ctx as unknown as Context, tools }
}

const remoteExec = () => ({
  signal: new AbortController().signal,
  callId: 'call-1',
  agent: { session: { header: { cwd: 'ssh://c1/srv' } } },
})

test('UX-6: Language=zh keeps bash and sw_* schemas English and execution errors Chinese', async () => {
  assert.equal(CJK.test(SW_STATUS_DESCRIPTION), false)
  assert.equal(CJK.test(SW_CONNECT_DESCRIPTION), false)
  const host = toolHost({ preference: 'zh' })
  registerSwExec(host.ctx, () => ({ get: () => undefined, listMachines: () => ({ machines: [] }) }) as unknown as SshRegistry)
  registerWin32Bash(host.ctx, () => ({ get: () => undefined, listMachines: () => ({ machines: [] }) }) as unknown as SshRegistry, {
    platform: 'win32',
    forceRegister: true,
  })
  const sw = host.tools.find(tool => tool.name === 'sw_exec')
  const bash = host.tools.find(tool => tool.name === 'bash')
  assert.ok(sw !== undefined && bash !== undefined)
  for (const tool of [sw, bash]) {
    assert.equal(CJK.test(tool.description), false)
    assert.match(tool.description, /sandbox_permissions/)
    const command = tool.parameters.properties?.command?.description ?? ''
    assert.equal(CJK.test(command), false)
    assert.match(command, /command to execute/)
    assert.deepEqual(tool.parameters.properties?.sandbox_permissions?.enum, ['workspace-write', 'danger-full-access'])
  }
  await assert.rejects(
    () => sw.execute({ command: '  ', description: 'List' }, remoteExec()),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /无效命令/)
      return true
    },
  )
})

test('REQ-I18: sw_exec denial hint, then allowed-once is only that spawn', async () => {
  const policies: unknown[] = []
  let exitCode = 1
  let stderr = 'mkdir: cannot create directory: Read-only file system\n'
  const approvalCalls: string[] = []
  const host = toolHost({
    preference: 'zh',
    spawn: () => {
      policies.push(currentRemoteSpawnPolicy())
      return handle(exitCode, stderr)
    },
    approval: { request: async () => { approvalCalls.push('asked'); return 'allowed-once' } },
  })
  const registry = () => ({
    get: (id: string) => (id === 'c1' || id === 'c2') ? {
      id,
      endpoint: 'root@10.0.0.5',
      spec: { id, label: id, host: '10.0.0.5', port: 22, username: 'root', workspace: '/srv/c1' },
      exec: async () => ({ exitCode: 0, signal: null, stdout: 'Linux\n', stderr: '' }),
    } : undefined,
    getActive: () => null,
    listMachines: () => ({ machines: [{ id: 'c1' }, { id: 'c2' }], currentId: null }),
  }) as unknown as SshRegistry
  registerSwExec(host.ctx, registry)
  const tool = host.tools[0]
  assert.ok(tool !== undefined)
  const denied = await tool.execute({ command: 'mkdir /etc/x', description: 'Make a directory', server: 'c2' }, remoteExec()) as SwExecForeground
  assert.equal(denied.sandbox?.mode, 'workspace-write')
  assert.equal(denied.sandbox?.denied, true)
  const rendered = tool.output.render({}, denied)[0]?.text ?? ''
  assert.match(rendered, /服务器：/)
  assert.ok(rendered.includes(sandboxDenialMarker('workspace-write')))
  assert.ok(rendered.includes(escalationHintMarker('command')))
  exitCode = 0
  stderr = ''
  await tool.execute({
    command: 'mkdir /etc/x',
    description: 'Make a directory',
    server: 'c2',
    sandbox_permissions: 'danger-full-access',
    justification: 'the directory is outside the workspace',
  }, remoteExec())
  await tool.execute({ command: 'pwd', description: 'Print directory', server: 'c2' }, remoteExec())
  assert.equal(approvalCalls.length, 1)
  assert.equal(policies[0], undefined)
  assert.deepEqual(policies[1], { mode: 'danger-full-access' })
  assert.equal(policies[2], undefined)
  await assert.rejects(
    () => tool.execute({
      command: 'pwd',
      description: 'Print directory',
      server: 'c2',
      sandbox_permissions: 'danger-full-access',
    }, remoteExec()),
    /sandbox_permissions requires a justification/,
  )
})

test('REQ-I18: sw_exec foreground render includes the denial lines', () => {
  const text = renderSwExecForeground({
    kind: 'foreground',
    server: 'c1',
    endpoint: 'root@10.0.0.5',
    os: 'linux',
    exitCode: 1,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: '', truncated: false },
    stderr: { text: 'Read-only file system', truncated: false },
    sandbox: { mode: 'workspace-write', denied: true },
  })
  assert.ok(text.includes(sandboxDenialMarker('workspace-write')))
  assert.ok(text.includes(escalationHintMarker('command')))
  assert.match(text, /\[exit code: 1\]/)
})
