/**
 * REQ-I9 / ADR-0022 → AUDIT-7 → REQ-I27 wiring tests (`src/process.ts` argv
 * stage, `src/subprocess.ts` fence + terminal mark, `src/remote-sandbox-fence.ts`,
 * the subpath `SshFileSystem` write face).
 *
 * After REQ-I27 (ADR-0031) the confine MARK — not the session mode — is the
 * policy truth on the exec path: a registered `markConfinedArgv` product
 * enforces its mode, unmarked argv runs `--sandbox off` (owner-accepted
 * narrowing), and `spawnTerminal` refuses only MARKED confined argv (the
 * model-side persistent shell) while the human browser terminal opens
 * unfenced. The fs write face still reads the session policy service.
 *
 * What these tests pin:
 *  1. **The approval gate still sees the UNWRAPPED argv**, and runs before the
 *     fence (`preflight` → `resolveArgv`).
 *  2. **Fail closed.** A confined MARK with no remote component hub (subpath
 *     row, degraded path) or no registry connection is refused before any
 *     command text reaches the transport — for spawn, marked terminals AND
 *     writes.
 *  3. **Unmarked argv stays the plain path** (identity argv, SFTP writes).
 *
 * No live SSH host is required: transport, registry and hub are fakes.
 * @module test/remote-sandbox-wiring
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SshSubprocessHandle } from '../src/process.ts'
import { SshSubprocessEngine, SshSubprocessRuntime } from '../src/subprocess.ts'
import { SshFileSystem } from '../src/filesystem.ts'
import { sshRoutePlaceholder, sshTargetKey } from '../src/transport.ts'
import type { SshTransport } from '../src/transport.ts'
import type { ExecOutcome } from '../src/ssh-core.ts'
import { RemoteGateError } from '../src/remote-approval-gate.ts'
import type { RemoteSpawnGate } from '../src/remote-approval-gate.ts'
import { REMOTE_SANDBOX_UNAVAILABLE, RemoteSandboxError } from '../src/remote-sandbox.ts'
import { createRemoteSandboxFence } from '../src/remote-sandbox-fence.ts'
import type { RemoteSandboxFence } from '../src/remote-sandbox-fence.ts'
import { markConfinedArgv } from '../src/remote-confine-policy.ts'

/* ---------------------------------------------------------------- helpers */

const COMMAND_ARGV = ['bash', '-c', 'echo hi'] as const

type Mode = 'read-only' | 'workspace-write' | 'danger-full-access'

const policyService = (mode: Mode) => ({
  defaultMode: mode,
  resolve: () => ({ mode, workspaceRoot: '/srv/work' }),
})

/** A fake ssh2 channel: stdout/stderr, stdin end, `close` — no real process. */
function fakeChannel(): ClientChannel & { command: string } {
  const channel = new EventEmitter() as unknown as ClientChannel & { command: string }
  channel.command = ''
  channel.stdout = new PassThrough()
  channel.stderr = new PassThrough()
  channel.signal = (): void => {}
  channel.end = (): void => {}
  return channel
}

/** A transport that records every serialized command and lets the exec succeed. */
function recordingTransport(): SshTransport & { commands: string[] } {
  const commands: string[] = []
  return {
    commands,
    endpoint: 'root@srv.example',
    cwd: '/srv/work',
    getClient: async () => {
      const channel = fakeChannel()
      return {
        exec(command: string, _options: unknown, callback: (error: undefined, stream: ClientChannel) => void) {
          channel.command = command
          commands.push(command)
          setImmediate(() => {
            callback(undefined, channel)
            setImmediate(() => { channel.emit('close', 0, null) })
          })
        },
      } as unknown as Client
    },
    getSftp: async () => { throw new Error('unexpected getSftp') },
    getRemoteEnvironment: async () => ({ PATH: '/usr/bin:/bin', HOME: '/root' }),
    exec: async (command: string) => { commands.push(command); return outcome(0) },
    resolveRemoteCwd: () => '/srv/work',
  }
}

const outcome = (exitCode: number | null, stdout = '', stderr = '', signal: string | null = null): ExecOutcome =>
  ({ exitCode, stdout, stderr, signal })

const spawnSpec = (argv: readonly string[], cwd = 'ssh://c1/srv/work'): SubprocessSpawnSpec => ({
  argv: [...argv],
  cwd,
  // `{ data: '' }` ends the fake channel's stdin instead of holding it open.
  stdio: { stdin: { data: '' }, stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } },
  graceMs: 1000,
})

/**
 * A spawn spec whose argv IS a registered confine product (REQ-I27: the mark
 * rides the array object, so the spec must carry it BY REFERENCE).
 */
const markedSpawnSpec = (argv: readonly string[], mode: Mode, cwd = 'ssh://c1/srv/work'): SubprocessSpawnSpec =>
  ({ ...spawnSpec(argv, cwd), argv: markConfinedArgv(argv, { mode }).argv })

const terminalSpec = (argv: readonly string[]): SubprocessTerminalSpawnSpec => ({
  argv: [...argv],
  cwd: 'ssh://c1/srv/work',
  cols: 80,
  rows: 24,
  graceMs: 1000,
  signal: new AbortController().signal,
})

/** Any remote-touching call marks how far startup got ("past gate AND fence"). */
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

/** Registry face: `c1` resolves to a sentinel transport. */
function registryService(): Record<string, unknown> {
  return {
    get: (id: string) => (id === 'c1' ? sentinelTransport() : undefined),
    listMachines: () => ({ machines: [{ id: 'c1' }] }),
  }
}

/** A context with the aggregate transport, the registry, and an optional session mode. */
function hostContext(mode?: Mode): Context {
  const ctx = new Context()
  ctx.provide('ssh', sentinelTransport())
  ctx.provide('sshRegistry', registryService())
  if (mode !== undefined) ctx.provide('sandboxPolicy', policyService(mode))
  return ctx
}

/** A hub fake: records `require` calls and either succeeds or throws `error`. */
function fakeHub(error?: Error): { hub: { require: (...args: unknown[]) => Promise<unknown> }; calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    hub: {
      require: async (...args: unknown[]) => {
        calls.push(args)
        if (error !== undefined) throw error
        return {}
      },
    },
  }
}

const isUnavailable = (error: unknown): boolean => {
  assert.ok(error instanceof RemoteSandboxError, String(error))
  assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
  return true
}

/* ------------------------------------- 1) the handle's ordered argv stage */

test('handle run(): preflight runs BEFORE resolveArgv, and the resolved argv is serialized', async () => {
  const transport = recordingTransport()
  const order: string[] = []
  const staged: Array<readonly string[]> = []
  const handle = new SshSubprocessHandle(
    transport,
    '/srv/work',
    spawnSpec(COMMAND_ARGV),
    mkdtempSync(join(tmpdir(), 'dsh-i9-order-')),
    async () => { order.push('preflight') },
    async (argv) => {
      order.push('resolveArgv')
      staged.push(argv)
      return ['wrapper', '--', ...argv]
    },
  )
  const finished = await handle.done
  assert.equal(finished.exitCode, 0)
  assert.deepEqual(order, ['preflight', 'resolveArgv'], 'the gate is asked first, the fence second')
  assert.deepEqual(staged[0], [...COMMAND_ARGV], 'the fence receives the UNWRAPPED argv')
  assert.equal(transport.commands.length, 1)
  assert.match(transport.commands[0] as string, /'wrapper' '--' 'bash' '-c' 'echo hi'/)
})

test('handle run(): no resolveArgv is identity — the serialized text keeps its shape (BUG-9 steward, no pid echo)', async () => {
  const transport = recordingTransport()
  const handle = new SshSubprocessHandle(transport, '/srv/work', spawnSpec(COMMAND_ARGV), mkdtempSync(join(tmpdir(), 'dsh-i9-plain-')))
  const finished = await handle.done
  assert.equal(finished.exitCode, 0)
  const command = transport.commands[0] as string
  assert.match(command, /^cd -- '\/srv\/work' && env -i -- 'PATH=\/usr\/bin:\/bin' 'HOME=\/root' sh -c /)
  assert.match(command, / 'bash' '-c' 'echo hi'/)
  assert.match(command, /kill -TERM 0/)
  assert.doesNotMatch(command, /echo \$\$/)
})

test('handle run(): a rejection from resolveArgv fails done and NOTHING reaches the transport', async () => {
  const transport = recordingTransport()
  const handle = new SshSubprocessHandle(
    transport,
    '/srv/work',
    spawnSpec(COMMAND_ARGV),
    mkdtempSync(join(tmpdir(), 'dsh-i9-stage-fail-')),
    undefined,
    async () => { throw new RemoteSandboxError('refused') },
  )
  await assert.rejects(() => handle.done, RemoteSandboxError)
  assert.deepEqual(transport.commands, [], 'not even buildCommand ran')
})

/* ------------------------------- 2) the approval gate keeps the raw argv */

test('engine spawn: the gate sees the UNWRAPPED argv, before the injected fence', async () => {
  const ctx = hostContext('danger-full-access')
  const order: string[] = []
  const gateCalls: string[][] = []
  const gate: RemoteSpawnGate = async (input) => { order.push('gate'); gateCalls.push([...input.argv as string[]]) }
  const fence: RemoteSandboxFence = async (input) => { order.push('fence'); return input.argv ?? [] }
  const engine = new SshSubprocessEngine(ctx, gate, fence)
  await assert.rejects(() => engine.spawn(spawnSpec(COMMAND_ARGV)).done, /TRANSPORT-REACHED: getRemoteEnvironment/)
  assert.deepEqual(gateCalls, [['bash', '-c', 'echo hi']], 'argv[0] is still the shell — isRemoteShellShape() keeps matching')
  assert.deepEqual(order, ['gate', 'fence'])
})

test('engine spawn: the gate denial wins over the fence (order is gate → fence)', async () => {
  const ctx = hostContext('danger-full-access')
  let fenced = 0
  const gate: RemoteSpawnGate = async () => { throw new RemoteGateError('denied by the gate') }
  const fence: RemoteSandboxFence = async (input) => { fenced += 1; return input.argv ?? [] }
  const engine = new SshSubprocessEngine(ctx, gate, fence)
  await assert.rejects(() => engine.spawn(spawnSpec(COMMAND_ARGV)).done, /denied by the gate/)
  assert.equal(fenced, 0, 'the fence is never consulted after a gate denial')
})

test('the route cwd reaches the fence, placeholder spelling included', async () => {
  const seen: Array<string | undefined> = []
  const fence: RemoteSandboxFence = async (input) => { seen.push(input.cwd); return input.argv ?? [] }
  const ctx = new Context()
  ctx.provide('sandboxPolicy', policyService('danger-full-access'))
  ctx.provide('sshRegistry', {
    get: () => ({ ...sentinelTransport(), cwd: '/team/project', resolveRemoteCwd: () => '/team/project' }),
    listMachines: () => ({ machines: [{ id: 'c1' }] }),
  })
  const engine = new SshSubprocessEngine(ctx, undefined, fence)
  await assert.rejects(() => engine.spawn(spawnSpec(COMMAND_ARGV, sshRoutePlaceholder('c1', '/team/project'))).done, /TRANSPORT-REACHED/)
  assert.deepEqual(seen, ['/team/project'])
})

/* ----------------------- 3) the context-derived fence (no injected dep) */

for (const mode of ['read-only', 'workspace-write'] as const) {
  test(`subpath row, ${mode} MARK, no remote component hub: spawn is refused before any SSH activity`, async () => {
    const engine = new SshSubprocessEngine(hostContext())
    await assert.rejects(() => engine.spawn(markedSpawnSpec(COMMAND_ARGV, mode)).done, isUnavailable)
  })
}

test('subpath row: the fence ignores the session policy service — only the mark decides', async () => {
  // A workspace-write session service with an UNMARKED argv runs `off`
  // (the owner-accepted narrowing, ADR-0031 §3.1); the inverse of the old
  // fail-safe read-only refusal, which the fs write face still keeps.
  const engine = new SshSubprocessEngine(hostContext('workspace-write'))
  await assert.rejects(() => engine.spawn(spawnSpec(COMMAND_ARGV)).done, /TRANSPORT-REACHED: getRemoteEnvironment/)
})

test('subpath row, unmarked argv: identity reaches the transport (a danger grant skips confine)', async () => {
  const engine = new SshSubprocessEngine(hostContext())
  await assert.rejects(() => engine.spawn(spawnSpec(COMMAND_ARGV)).done, /TRANSPORT-REACHED: getRemoteEnvironment/)
})

test('subpath row: a DANGER mark behaves like unmarked — never fenced, never refused', async () => {
  const engine = new SshSubprocessEngine(hostContext())
  await assert.rejects(() => engine.spawn(markedSpawnSpec(COMMAND_ARGV, 'danger-full-access')).done, /TRANSPORT-REACHED: getRemoteEnvironment/)
})

test('SshSubprocessRuntime (gate-only constructor) derives the same fence', async () => {
  const ctx = hostContext()
  const runtime = new SshSubprocessRuntime(ctx, async () => {})
  await assert.rejects(() => runtime.spawn(markedSpawnSpec(COMMAND_ARGV, 'read-only')).done, isUnavailable)
})

test('aggregate-transport route (no connection id): a confined MARK refuses, unmarked runs', async () => {
  const confined = new SshSubprocessEngine(hostContext())
  await assert.rejects(() => confined.spawn(markedSpawnSpec(COMMAND_ARGV, 'workspace-write', '/srv/work')).done, isUnavailable)
  const plain = new SshSubprocessEngine(hostContext())
  await assert.rejects(() => plain.spawn(spawnSpec(COMMAND_ARGV, '/srv/work')).done, /TRANSPORT-REACHED: getRemoteEnvironment/)
})

test('fence with a hub: a confined MARK requires a jailed session (policy + cwd) and keeps the argv', async () => {
  const ctx = hostContext()
  const { hub, calls } = fakeHub()
  const fence = createRemoteSandboxFence(ctx, { hub: hub as never })
  const marked = markConfinedArgv(COMMAND_ARGV, { mode: 'workspace-write' })
  const argv = await fence({ connectionId: 'c1', cwd: '/srv/work/app', argv: marked.argv })
  assert.deepEqual(argv, marked.argv)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.[0], 'c1')
  assert.deepEqual(calls[0]?.[1], { policy: 'workspace-write', cwd: '/srv/work/app' })
})

test('fence: the coreHub service is used when no hub is injected', async () => {
  const ctx = hostContext()
  const { hub, calls } = fakeHub()
  ctx.provide('coreHub', hub)
  const marked = markConfinedArgv(COMMAND_ARGV, { mode: 'read-only' })
  await createRemoteSandboxFence(ctx)({ connectionId: 'c1', argv: marked.argv })
  assert.equal(calls.length, 1)
})

test('fence: a missing remote component refuses a confined MARK but an unmarked argv passes', async () => {
  const missing = Object.assign(new Error('core missing'), { code: 'CORE_MISSING' })
  const confined = hostContext()
  confined.provide('coreHub', fakeHub(missing).hub)
  const marked = markConfinedArgv(COMMAND_ARGV, { mode: 'read-only' })
  await assert.rejects(() => createRemoteSandboxFence(confined)({ connectionId: 'c1', argv: marked.argv }), /core missing/)
  const plain = hostContext()
  plain.provide('coreHub', fakeHub(missing).hub)
  assert.deepEqual(await createRemoteSandboxFence(plain)({ connectionId: 'c1', argv: [...COMMAND_ARGV] }), [...COMMAND_ARGV])
})

/* ---------------------------------------------- 4) terminals (no PTY jail) */

test('terminal: a MARKED confined argv is REFUSED with the honest message (model-side persistent shell)', async () => {
  const engine = new SshSubprocessEngine(hostContext())
  for (const mode of ['read-only', 'workspace-write'] as const) {
    const marked = markConfinedArgv(['bash'], { mode })
    await assert.rejects(
      // The spec carries the marked array BY REFERENCE (a copy would lose it).
      () => engine.spawnTerminal({ ...terminalSpec(['bash']), argv: marked.argv }),
      (error: unknown) => {
        isUnavailable(error)
        assert.match((error as Error).message, /refuses to open an interactive terminal/)
        assert.match((error as Error).message, new RegExp(mode))
        return true
      },
    )
  }
})

test('terminal: an UNMARKED argv proceeds to the transport — the human browser terminal (ADR-0031 §4)', async () => {
  // The session service says workspace-write and it does NOT matter any more:
  // the human's terminal opens unfenced, aligned with the official local host.
  const engine = new SshSubprocessEngine(hostContext('workspace-write'))
  await assert.rejects(() => engine.spawnTerminal(terminalSpec(['bash'])), (error: unknown) => {
    assert.ok(!(error instanceof RemoteSandboxError), 'no refusal for the human terminal')
    assert.match(String(error), /TRANSPORT-REACHED/)
    return true
  })
})

test('terminal: a DANGER mark is not a fence — it proceeds like the human terminal', async () => {
  const engine = new SshSubprocessEngine(hostContext())
  const marked = markConfinedArgv(['bash'], { mode: 'danger-full-access' })
  await assert.rejects(() => engine.spawnTerminal({ ...terminalSpec(['bash']), argv: marked.argv }), /TRANSPORT-REACHED/)
})

/* ----------------------------- 5) subpath SshFileSystem write face */

function subpathFs(mode: Mode, hub?: unknown): { fs: SshFileSystem; target: { targetKey: string; displayPath: string } } {
  const ctx = hostContext(mode)
  if (hub !== undefined) ctx.provide('coreHub', hub)
  const fs = new SshFileSystem(ctx)
  const target = { targetKey: sshTargetKey('c1', '/srv/work/a.txt'), displayPath: '/srv/work/a.txt' }
  return { fs, target }
}

test('subpath fs: a confined write with no remote component hub is refused, never sent over SFTP', async () => {
  for (const mode of ['read-only', 'workspace-write'] as const) {
    const { fs, target } = subpathFs(mode)
    await assert.rejects(() => fs.writeText(target as never, 'x'), isUnavailable)
    await assert.rejects(() => fs.editText(target as never, { oldText: 'a', newText: 'b' } as never), isUnavailable)
  }
})

test('subpath fs: a danger write keeps the plain SFTP path', async () => {
  const { fs, target } = subpathFs('danger-full-access')
  await assert.rejects(() => fs.writeText(target as never, 'x'), /TRANSPORT-REACHED: getSftp/)
})

test('subpath fs: with the coreHub service a write goes through the remote component', async () => {
  const { hub, calls } = fakeHub(new Error('HUB-REACHED'))
  const { fs, target } = subpathFs('workspace-write', hub)
  await assert.rejects(() => fs.writeText(target as never, 'x'), /HUB-REACHED/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.[0], 'c1')
})
