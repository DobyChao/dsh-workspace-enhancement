/**
 * REQ-I9 / ADR-0022 WIRING slice tests (`src/process.ts` argv stage,
 * `src/subprocess.ts` fence dep + terminal refusal, `src/remote-sandbox-fence.ts`
 * closure, `src/registry.ts` + `src/web.ts` machine field, client badge helper).
 *
 * The three assertions that matter most, in order of blast radius:
 *
 *  1. **The approval gate still sees the UNWRAPPED argv.** This is the trap A3
 *     §Q3 recorded: a fence placed upstream of `SshSubprocessEngine.spawn` would
 *     make `bwrap` the gate's `argv[0]`, `isRemoteShellShape()` would stop
 *     matching, and AUDIT-6 would silently stop covering every remote command.
 *     The comment in `process.ts` is not the guarantee — these tests are.
 *  2. **Startup ordering.** `preflight` (the gate) is awaited BEFORE
 *     `resolveArgv` (the fence), and the argv that reaches the serializer is the
 *     WRAPPED one.
 *  3. **Fail closed.** A failed/absent probe throws `SANDBOX_UNAVAILABLE` and the
 *     user's command never reaches the transport (not even as a string).
 *
 * No live SSH host is required for any of it: the transport, the connection and
 * the probe are all structural fakes.
 * @module test/remote-sandbox-wiring
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SshSubprocessHandle } from '../src/process.ts'
import { SshSubprocessEngine, SshSubprocessRuntime } from '../src/subprocess.ts'
import { SshRegistry } from '../src/registry.ts'
import { sshRoutePlaceholder } from '../src/transport.ts'
import type { SshTransport } from '../src/transport.ts'
import type { ExecOutcome } from '../src/ssh-core.ts'
import { RemoteGateError, createRemoteSpawnGate } from '../src/remote-approval-gate.ts'
import type { RemoteGateInput, RemoteSpawnGate } from '../src/remote-approval-gate.ts'
import {
  REMOTE_SANDBOX_MESSAGES,
  REMOTE_SANDBOX_UNAVAILABLE,
  RemoteSandboxError,
  buildRemoteProbeCommand,
  createRemoteSandboxCache,
  normalizeRemoteSandbox,
  remoteRunnerArgv,
} from '../src/remote-sandbox.ts'
import type { RemoteProbeVerdict, RemoteSandboxMode } from '../src/remote-sandbox.ts'
import {
  composeFencedGate,
  createRemoteSandboxFence,
  createRemoteSandboxTerminalGuard,
  effectiveModeOf,
  fenceWorkspaceRootOf,
  probeRunner,
  refuseFencedCommands,
  remoteSandboxDepsOf,
  remoteSandboxUnavailable,
  terminalRefusalOf,
} from '../src/remote-sandbox-fence.ts'
import type {
  RemoteSandboxConnectionFace,
  RemoteSandboxDeps,
  RemoteSandboxFence,
  RemoteSandboxMachineFace,
} from '../src/remote-sandbox-fence.ts'
import { sandboxBadgeOf } from '../src/client/sandbox-badge.ts'
import { lookup } from '../src/locale/index.ts'
import type { DswKey } from '../src/locale/index.ts'
import { machinePayload, EMPTY_MACHINE_FORM } from '../src/client/machine-payload.ts'

/* ---------------------------------------------------------------- helpers */

const COMMAND_ARGV = ['bash', '-c', 'echo hi'] as const
const BWRAP_PREFIX = ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent', '--'] as const

/**
 * A fake ssh2 channel: `SshSubprocessHandle` wires stdout/stderr, ends stdin and
 * awaits the `close` event, so the fake provides exactly those. No real process
 * is spawned, which is what lets `test:agent` (no pipes allowed) run these cases.
 */
function fakeChannel(): ClientChannel & { command: string } {
  const channel = new EventEmitter() as unknown as ClientChannel & { command: string }
  channel.command = ''
  channel.stdout = new PassThrough()
  channel.stderr = new PassThrough()
  channel.signal = (): void => {}
  channel.end = (): void => {}
  return channel
}

/**
 * A transport that captures every serialized remote command string and lets the
 * exec succeed. `commands` holds BOTH kinds of round-trip this suite cares
 * about: control-channel probes (via `exec`) and the spawn itself (via
 * `getClient().exec`), so "the user command never reached the transport" is an
 * assertion about a real capture, not about a sentinel that throws.
 */
function recordingTransport(): SshTransport & {
  commands: string[]
  channels: Array<ClientChannel & { command: string }>
} {
  const commands: string[] = []
  const channels: Array<ClientChannel & { command: string }> = []
  return {
    commands,
    channels,
    endpoint: 'root@srv.example',
    cwd: '/srv/work',
    getClient: async () => {
      const channel = fakeChannel()
      channels.push(channel)
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

const spawnSpec = (argv: readonly string[]): SubprocessSpawnSpec => ({
  argv: [...argv],
  cwd: 'ssh://c1/srv/work',
  // `{ data: '' }` (not `'pipe'`) so the handle ENDS the channel's stdin instead
  // of attaching a PassThrough that would keep the fake channel open forever.
  stdio: { stdin: { data: '' }, stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } },
  graceMs: 1000,
})

const terminalSpec = (argv: readonly string[]): SubprocessTerminalSpawnSpec => ({
  argv: [...argv],
  cwd: 'ssh://c1/srv/work',
  cols: 80,
  rows: 24,
  graceMs: 1000,
  signal: new AbortController().signal,
})

const machine = (overrides: Partial<RemoteSandboxMachineFace> = {}): RemoteSandboxMachineFace =>
  ({ id: 'c1', ...overrides })

/** A probe transport: records every `exec` command text, replays one outcome. */
function probeConnection(result: ExecOutcome): RemoteSandboxConnectionFace & { commands: string[] } {
  const commands: string[] = []
  return {
    commands,
    async exec(command: string) { commands.push(command); return result },
  }
}

const okVerdict = (): RemoteProbeVerdict => ({ ok: true, version: '0.8.0' })
const failedVerdict = (): RemoteProbeVerdict => ({ ok: false, detail: "env: 'bwrap': No such file or directory" })

function fenceDeps(options: {
  machines?: RemoteSandboxMachineFace[]
  connection?: RemoteSandboxConnectionFace
}): RemoteSandboxDeps {
  return {
    machine: (id: string) => options.machines?.find(entry => entry.id === id),
    connection: () => options.connection,
    // The PRODUCTION refusal builder, so the assertions below pin the real
    // `SANDBOX_UNAVAILABLE` text rather than a bespoke test string.
    unavailable: remoteSandboxUnavailable,
  }
}

/**
 * A transport sentinel: any remote-touching call marks the point the startup
 * sequence reached. `getRemoteEnvironment` is where `buildCommand` starts, i.e.
 * "past the gate AND past the fence".
 */
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

/** An aggregate `ctx.ssh` transport whose every remote-touching call is a sentinel. */
function aggregateTransport(): SshTransport {
  return sentinelTransport()
}

/** A minimal registry service face: route resolution + the fence's machine view. */
function registryService(machines: RemoteSandboxMachineFace[]): Record<string, unknown> {
  return {
    get: (id: string) => (machines.some(entry => entry.id === id) ? sentinelTransport() : undefined),
    listMachines: () => ({ machines }),
  }
}

/**
 * The engine under test with the REAL route resolution: `ctx.sshRegistry`
 * supplies both the machine view the fence reads and the connection the
 * `ssh://` cwd resolves to, while the fence's probe deps are injected so no
 * network round-trip is attempted.
 */
function engineHarness(options: {
  mode?: RemoteSandboxMode
  gate?: RemoteSpawnGate
  terminalGuard?: (connectionId: string | undefined, mode: RemoteSandboxMode) => string | undefined
  probe?: () => Promise<RemoteProbeVerdict>
  machines?: RemoteSandboxMachineFace[]
} = {}): { engine: SshSubprocessEngine; probes: number[]; gateCalls: string[][] } {
  const machines = options.machines ?? [machine({ remoteSandbox: options.mode ?? 'read-only' })]
  const probes: number[] = []
  const gateCalls: string[][] = []
  const gate: RemoteSpawnGate = options.gate ?? (async (input) => { gateCalls.push([...input.argv]) })
  const ctx = new Context()
  ctx.provide('ssh', aggregateTransport())
  ctx.provide('sshRegistry', registryService(machines))
  const fence = createRemoteSandboxFence(ctx, {
    deps: fenceDeps({ machines, connection: probeConnection(outcome(0, 'bubblewrap 0.8.0')) }),
    probe: async () => { probes.push(probes.length + 1); return (options.probe ?? (async () => okVerdict()))() },
  })
  const engine = new SshSubprocessEngine(ctx, gate, fence, options.terminalGuard)
  return { engine, probes, gateCalls }
}

/** A fence whose probe verdict is fixed and whose probe count is observable. */
function fakeFence(options: {
  mode?: RemoteSandboxMode
  probe?: () => Promise<RemoteProbeVerdict>
} = {}): { fence: RemoteSandboxFence; probes: number[] } {
  const probes: number[] = []
  const connection = probeConnection(outcome(0, 'bubblewrap 0.8.0'))
  return {
    probes,
    fence: createRemoteSandboxFence(new Context(), {      deps: fenceDeps({ machines: [machine({ remoteSandbox: options.mode ?? 'read-only' })], connection }),
      probe: async () => { probes.push(probes.length + 1); return (options.probe ?? (async () => okVerdict()))() },
    }),
  }
}

/* ------------------------------------- 1) the handle's ordered argv stage */

test('handle run(): preflight runs BEFORE resolveArgv, and the WRAPPED argv is serialized', async () => {
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
      return remoteRunnerArgv(argv, { mode: 'read-only' }, 'bwrap')
    },
  )
  const finished = await handle.done
  assert.equal(finished.exitCode, 0)
  assert.deepEqual(order, ['preflight', 'resolveArgv'], 'the gate is asked first, the fence second')
  assert.deepEqual(staged[0], [...COMMAND_ARGV], 'the fence receives the UNWRAPPED argv')
  assert.equal(transport.commands.length, 1)
  const command = transport.commands[0] as string
  assert.match(command, /'bwrap' '--ro-bind' '\/' '\/'/, 'the wrapped vector was serialized')
  assert.match(command, /'--' 'bash' '-c' 'echo hi'/, 'the original argv survives verbatim after `--`')
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

test('engine spawn: the gate sees the UNWRAPPED argv while the fence wraps what executes', async () => {
  const { engine, probes, gateCalls } = engineHarness({ mode: 'read-only' })
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
  assert.deepEqual(gateCalls, [['bash', '-c', 'echo hi']], 'argv[0] is still the shell — isRemoteShellShape() keeps matching')
  assert.equal(gateCalls[0]?.[0], 'bash', 'AUDIT-6 coverage is preserved (a bwrap argv[0] here would be the regression)')
  assert.equal(probes.length, 1, 'the fence probed exactly once for the fenced mode')
})

test('engine spawn: mode off ships identity argv and probes NOTHING', async () => {
  const { engine, probes, gateCalls } = engineHarness({ mode: 'off' })
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
  assert.equal(gateCalls.length, 1)
  assert.deepEqual(probes, [], 'off ⇒ zero probe round-trips (I9-7)')
})

/* ------------------------------------------ 3) spawnTerminal refuses */

test('engine spawnTerminal: a fenced machine is REFUSED with the honest terminal message', async () => {
  const { engine } = engineHarness({ mode: 'read-only' })
  await assert.rejects(
    () => engine.spawnTerminal(terminalSpec(['bash'])),
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError)
      assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
      assert.match(error.message, /refuses to open an interactive terminal/)
      assert.match(error.message, /read-only/)
      return true
    },
  )
})

test('engine spawnTerminal: an unfenced machine is unchanged (the route is attempted as before)', async () => {
  const { engine } = engineHarness({ mode: 'off' })
  await assert.rejects(
    () => engine.spawnTerminal(terminalSpec(['bash'])),
    (error: unknown) => {
      assert.ok(!(error instanceof RemoteSandboxError), 'no fence refusal for an off machine')
      assert.match(String(error), /TRANSPORT-REACHED/)
      return true
    },
  )
})

test('engine spawnTerminal: no fence dep at all ⇒ no refusal (pre-REQ-I9 behaviour)', async () => {
  const engine = new SshSubprocessEngine(new Context())
  await assert.rejects(
    () => engine.spawnTerminal(terminalSpec(['bash'])),
    (error: unknown) => !(error instanceof RemoteSandboxError),
  )
})

test('terminalGuard dep wins over the config-derived decision (engine seam is injectable)', async () => {
  const { engine } = engineHarness({ mode: 'off', terminalGuard: connectionId => (connectionId === 'c1' ? 'injected refusal' : undefined) })
  await assert.rejects(() => engine.spawnTerminal(terminalSpec(['bash'])), /injected refusal/)
})

/* ----------------------------------------------- 4) the fence closure */

test('effectiveModeOf: unknown route / missing field / junk all read as off', () => {
  const deps = fenceDeps({ machines: [machine(), machine({ id: 'c2', remoteSandbox: 'workspace-write' })] })
  assert.equal(effectiveModeOf(deps, 'c1'), 'off', 'pre-REQ-I9 record')
  assert.equal(effectiveModeOf(deps, undefined), 'off', 'aggregate transport')
  assert.equal(effectiveModeOf(deps, 'nope'), 'off', 'unknown machine')
  assert.equal(effectiveModeOf(deps, 'c2'), 'workspace-write')
  assert.equal(effectiveModeOf(deps, 'c2', 'read-only'), 'workspace-write', 'stored value wins over the fallback')
  assert.equal(effectiveModeOf(deps, undefined, 'read-only'), 'read-only', 'subpath rows may configure a fallback')
})

test('fenceWorkspaceRootOf: the spawn cwd wins, then the machine defaults, else undefined', () => {
  const m = machine({ workspace: '/srv/ws', cwd: '/srv/legacy' })
  assert.equal(fenceWorkspaceRootOf('/srv/work', m), '/srv/work')
  assert.equal(fenceWorkspaceRootOf(undefined, m), '/srv/ws')
  assert.equal(fenceWorkspaceRootOf('relative/path', machine({ cwd: '/srv/legacy' })), '/srv/legacy', 'a non-absolute cwd is skipped, not bound')
  assert.equal(fenceWorkspaceRootOf('relative', machine()), undefined, 'no usable root ⇒ workspace-write must refuse')
})

test('fence: off ⇒ identity argv, zero probes, and the registry is not even read', async () => {
  let machineReads = 0
  const deps: RemoteSandboxDeps = {
    machine: () => { machineReads += 1; return machine() },
    connection: () => undefined,
    unavailable: mode => new RemoteSandboxError(`unavailable:${mode}`),
  }
  const probes: number[] = []
  const fence = createRemoteSandboxFence(new Context(), {
    deps,
    probe: async () => { probes.push(1); return okVerdict() },
  })
  const argv = [...COMMAND_ARGV]
  const resolved = await fence({ connectionId: 'c1', cwd: '/srv/work', argv })
  assert.equal(resolved, argv, 'the SAME array reference — identity, not a copy (I9-7)')
  assert.deepEqual(probes, [])
})

test('fence: no registry machine at all ⇒ off (the aggregate transport is never fenced)', async () => {
  const fence = createRemoteSandboxFence(new Context(), { deps: fenceDeps({}) })
  const argv = [...COMMAND_ARGV]
  assert.equal(await fence({ connectionId: undefined, cwd: '/srv/work', argv }), argv)
  assert.equal(await fence({ connectionId: 'unknown', cwd: '/srv/work', argv }), argv)
})

test('fence: a passing probe wraps read-only exactly like the pure module', async () => {
  const connection = probeConnection(outcome(0, 'bubblewrap 0.8.0'))
  const fence = createRemoteSandboxFence(new Context(), {
    deps: fenceDeps({ machines: [machine({ remoteSandbox: 'read-only' })], connection }),
    probe: async () => okVerdict(),
  })
  const resolved = await fence({ connectionId: 'c1', cwd: '/srv/work', argv: [...COMMAND_ARGV] })
  assert.deepEqual(resolved, [...BWRAP_PREFIX, ...COMMAND_ARGV])
  assert.equal(connection.commands.length, 0, 'the injected probe replaces the network call')
})

test('fence: workspace-write binds the spawn cwd and adds exactly one --bind pair', async () => {
  const fence = createRemoteSandboxFence(new Context(), {
    deps: fenceDeps({ machines: [machine({ remoteSandbox: 'workspace-write' })], connection: probeConnection(outcome(0)) }),
    probe: async () => okVerdict(),
  })
  const resolved = await fence({ connectionId: 'c1', cwd: '/srv/work', argv: [...COMMAND_ARGV] })
  assert.deepEqual(resolved, [
    ...BWRAP_PREFIX.slice(0, -1), '--tmpfs', '/tmp', '--bind', '/srv/work', '/srv/work', '--', ...COMMAND_ARGV,
  ])
})

test('fence: workspace-write without a usable root FAILS CLOSED (no silent degradation)', async () => {
  const fence = createRemoteSandboxFence(new Context(), {
    deps: fenceDeps({ machines: [machine({ remoteSandbox: 'workspace-write' })], connection: probeConnection(outcome(0)) }),
    probe: async () => okVerdict(),
  })
  await assert.rejects(
    () => fence({ connectionId: 'c1', cwd: 'relative', argv: [...COMMAND_ARGV] }),
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError)
      assert.match(error.message, /requires an absolute remote workspace root/)
      return true
    },
  )
})

test('fence: a failed probe throws SANDBOX_UNAVAILABLE and the argv never reaches the transport', async () => {
  const connection = probeConnection(outcome(127, '', "env: 'bwrap': No such file or directory"))
  const fence = createRemoteSandboxFence(new Context(), {
    deps: fenceDeps({ machines: [machine({ remoteSandbox: 'read-only' })], connection }),
  })
  await assert.rejects(
    () => fence({ connectionId: 'c1', cwd: '/srv/work', argv: [...COMMAND_ARGV] }),
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError)
      assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
      // The PRODUCTION text, not a paraphrase: the upstream-style mode line plus
      // the "no command text was sent" promise plus the probe's own diagnostic.
      assert.ok(error.message.includes('sandbox mode "read-only" is requested but no remote sandbox runner is usable'))
      assert.ok(error.message.includes('refusing to run the command unconfined'))
      assert.ok(error.message.includes('no command text was sent'))
      assert.match(error.message, /No such file or directory/, 'the probe detail is carried')
      return true
    },
  )
  assert.equal(connection.commands.length, 1, 'only the PROBE ran')
  assert.match(connection.commands[0] as string, /command -v 'bwrap'/)
  assert.ok(!(connection.commands[0] as string).includes('echo hi'), 'the user command was never sent')
})

test('fence: an unusable connection (registry cannot build it) fails closed', async () => {
  const fence = createRemoteSandboxFence(new Context(), {
    deps: fenceDeps({ machines: [machine({ remoteSandbox: 'read-only' })] }),
  })
  await assert.rejects(
    () => fence({ connectionId: 'c1', cwd: '/srv/work', argv: [...COMMAND_ARGV] }),
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError)
      assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
      return true
    },
  )
})

/* ------------------------------------------------- 5) the probe + cache */

test('probeRunner: the functional probe text, exit 0 required, real control-channel call', async () => {
  const connection = probeConnection(outcome(0, 'bubblewrap 0.8.0\n'))
  const verdict = await probeRunner(connection, 'bwrap')
  assert.equal(verdict.ok, true)
  assert.equal(verdict.version, '0.8.0')
  assert.equal(connection.commands[0], buildRemoteProbeCommand('bwrap'), 'one round-trip, the constant text')
})

test('probeRunner: a non-zero exit is a failure even with output', async () => {
  const connection = probeConnection(outcome(1, 'usage: bwrap …', 'bwrap: setting up uid map: Permission denied'))
  const verdict = await probeRunner(connection)
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail ?? '', /Permission denied/)
})

test('fence probe cache: one round-trip per CONNECTION IDENTITY; a rebuilt connection re-probes', async () => {
  const first = probeConnection(outcome(0, 'bubblewrap 0.8.0'))
  const second = probeConnection(outcome(0, 'bubblewrap 0.8.0'))
  const cache = createRemoteSandboxCache()
  const deps = fenceDeps({ machines: [machine({ remoteSandbox: 'read-only' })] })
  let current: RemoteSandboxConnectionFace = first
  const fence = createRemoteSandboxFence(new Context(), {
    cache,
    deps: { ...deps, connection: () => current },
  })
  const input = { connectionId: 'c1', cwd: '/srv/work', argv: [...COMMAND_ARGV] }
  await fence(input)
  await fence(input)
  assert.equal(first.commands.length, 1, 'the second spawn reuses the cached verdict')
  current = second
  await fence(input)
  assert.equal(second.commands.length, 1, 'the rebuilt connection was probed again')
  assert.equal(first.commands.length, 1, 'and the old connection was not re-probed')
})

test('fence probe cache: a NEGATIVE verdict is cached too (no re-probe storm, still refused)', async () => {
  const connection = probeConnection(outcome(127, '', "env: 'bwrap': No such file or directory"))
  const fence = createRemoteSandboxFence(new Context(), {
    deps: fenceDeps({ machines: [machine({ remoteSandbox: 'read-only' })], connection }),
    cache: createRemoteSandboxCache(),
  })
  const input = { connectionId: 'c1', cwd: '/srv/work', argv: [...COMMAND_ARGV] }
  const refusal = /sandbox mode "read-only" is requested/
  await assert.rejects(() => fence(input), refusal)
  await assert.rejects(() => fence(input), refusal)
  assert.equal(connection.commands.length, 1, 'the negative verdict was cached')
})

test('fence: concurrent cold-cache spawns share ONE probe round-trip', async () => {
  const connection = probeConnection(outcome(0, 'bubblewrap 0.8.0'))
  let started = 0
  const fence = createRemoteSandboxFence(new Context(), {
    deps: fenceDeps({ machines: [machine({ remoteSandbox: 'read-only' })], connection }),
    probe: async () => {
      started += 1
      await new Promise(resolve => setTimeout(resolve, 5))
      return okVerdict()
    },
  })
  const input = { connectionId: 'c1', cwd: '/srv/work', argv: [...COMMAND_ARGV] }
  await Promise.all([fence(input), fence(input), fence(input)])
  assert.equal(started, 1, 'in-flight deduplication: three spawns, one probe')
})

/* ----------------------------------------------------- 6) terminal guard */

test('terminalRefusalOf: only a fenced mode refuses; off/unknown never does', () => {
  const deps = { machine: (id: string) => (id === 'c1' ? machine({ remoteSandbox: 'read-only' }) : undefined) }
  const text = terminalRefusalOf(deps, 'c1')
  assert.equal(text, REMOTE_SANDBOX_MESSAGES.terminalUnsupported.replace('{mode}', 'read-only'))
  assert.equal(terminalRefusalOf(deps, 'c2'), undefined)
  assert.equal(terminalRefusalOf(deps, undefined), undefined)
  assert.equal(terminalRefusalOf(deps, 'c1', 'off'), REMOTE_SANDBOX_MESSAGES.terminalUnsupported.replace('{mode}', 'read-only'))
})

test('remoteSandboxDepsOf: a context with no registry degrades to off, never throws', async () => {
  const fence = createRemoteSandboxFence(new Context())
  const argv = [...COMMAND_ARGV]
  assert.equal(await fence({ connectionId: 'c1', cwd: '/srv/work', argv }), argv)
  assert.equal(createRemoteSandboxTerminalGuard(new Context())('c1', 'off'), undefined)
})

/* -------------------------------------- 7) registry / payload / badge face */

test('registry: missing/invalid remoteSandbox reads as off and off is omitted from machines.json', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-i9-cfg-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const registry = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })
  const legacy = await registry.saveMachine({ host: 'h1', username: 'u' })
  assert.equal(legacy.remoteSandbox, 'off', 'pre-REQ-I9 record: default off, no migration')

  const fenced = await registry.saveMachine({ id: legacy.id, host: 'h1', username: 'u', remoteSandbox: 'read-only' })
  assert.equal(fenced.remoteSandbox, 'read-only')
  const kept = await registry.saveMachine({ id: legacy.id, host: 'h1', username: 'u' })
  assert.equal(kept.remoteSandbox, 'read-only', 'upsert: an omitted field keeps the stored mode')

  const write = await registry.saveMachine({ id: legacy.id, host: 'h1', username: 'u', remoteSandbox: 'workspace-write' })
  assert.equal(write.remoteSandbox, 'workspace-write', 'the second active mode round-trips')

  const off = await registry.saveMachine({ id: legacy.id, host: 'h1', username: 'u', remoteSandbox: 'off' })
  assert.equal(off.remoteSandbox, 'off')
  await new Promise(resolve => setTimeout(resolve, 30))
  const persisted = JSON.parse(readFileSync(machinesFile, 'utf8')) as { list: Array<Record<string, unknown>> }
  assert.equal('remoteSandbox' in (persisted.list[0] as object), false, 'off omits the field entirely (zero migration)')

  // Persisted round-trip of an ACTIVE mode: reload the file through the registry.
  await registry.saveMachine({ id: legacy.id, host: 'h1', username: 'u', remoteSandbox: 'read-only' })
  await new Promise(resolve => setTimeout(resolve, 30))
  const reloaded = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })
  assert.equal(reloaded.listMachines().machines[0]?.remoteSandbox, 'read-only', 'the stored mode survives a reload')
})

test('registry: normalizeRemoteSandbox rejects junk spellings the way the wire guard does', () => {
  assert.equal(normalizeRemoteSandbox('read-only'), 'read-only')
  assert.equal(normalizeRemoteSandbox('workspace-write'), 'workspace-write')
  for (const junk of ['OFF', 'Read-Only', '', 'full-access', 1, null, undefined, {}, []]) {
    assert.equal(normalizeRemoteSandbox(junk), 'off')
  }
})

test('machine payload: the fence select always carries an explicit mode', () => {
  assert.equal(EMPTY_MACHINE_FORM.remoteSandbox, 'off')
  assert.equal(machinePayload({ ...EMPTY_MACHINE_FORM, host: 'h', username: 'u' }).remoteSandbox, 'off')
  assert.equal(machinePayload({ ...EMPTY_MACHINE_FORM, host: 'h', username: 'u', remoteSandbox: 'read-only' }).remoteSandbox, 'read-only')
  assert.equal(machinePayload({ ...EMPTY_MACHINE_FORM, host: 'h', username: 'u', remoteSandbox: 'workspace-write' }).remoteSandbox, 'workspace-write')
})

test('sandboxBadgeOf: off renders nothing, the two active modes render the localized badge', () => {
  // The zh seat the settings page falls back to (`status.tsx` zhBaseline is the
  // same `lookup('zh', …)` call; taking the dictionary directly keeps this file
  // free of a `.tsx` import so `test:agent` can run it).
  const zhSeat = (key: DswKey, params?: Record<string, unknown>): string => lookup('zh', key, params)
  assert.equal(sandboxBadgeOf('off', zhSeat), '')
  assert.equal(sandboxBadgeOf(undefined, zhSeat), '', 'an older host row without the key shows nothing')
  assert.equal(sandboxBadgeOf('junk' as RemoteSandboxMode, zhSeat), '')
  assert.match(sandboxBadgeOf('read-only', zhSeat), /read-only/)
  assert.match(sandboxBadgeOf('workspace-write', zhSeat), /workspace-write/)
  assert.notEqual(sandboxBadgeOf('read-only', zhSeat), '')
  // The EN dictionary carries the same key (the static gate enforces the key
  // sets are exactly equal; this pins that the badge is actually localized).
  assert.match(lookup('en', 'settings.machines.sandboxBadge', { mode: 'read-only' }), /read-only/)
})

/* ------------------------- 9) the degraded (install-failure) composition */

/**
 * `plugin.ts`'s install-failure fallback:
 * `ctx.plugin(SshSubprocessRuntime, composeFencedGate(createRemoteSpawnGate(ctx),
 * refuseFencedCommands(remoteSandboxDepsOf(ctx))))`. The runtime takes ONE
 * non-context argument, so both arms (spawn refusal + terminal refusal) ride
 * the gate closure. The refusal fence never probes — it has no probe deps.
 */
function fallbackEngine(
  mode: RemoteSandboxMode,
  baseGate?: RemoteSpawnGate,
): { engine: SshSubprocessEngine; gateCalls: string[][]; transport: ReturnType<typeof recordingTransport> } {
  // 'off' is registered by OMITTING the field, exactly like every pre-REQ-I9
  // machine record (the registry never persists 'off').
  const machines = [mode === 'off' ? machine() : machine({ remoteSandbox: mode })]
  const gateCalls: string[][] = []
  const transport = recordingTransport()
  const ctx = new Context()
  ctx.provide('ssh', transport)
  ctx.provide('sshRegistry', {
    get: (id: string) => (id === 'c1' ? transport : undefined),
    listMachines: () => ({ machines }),
  })
  const gate = baseGate ?? (async (input: RemoteGateInput) => { gateCalls.push([...input.argv]) })
  const engine = new SshSubprocessEngine(ctx, composeFencedGate(gate, refuseFencedCommands(remoteSandboxDepsOf(ctx))))
  return { engine, gateCalls, transport }
}

test('fallback composition: a fenced machine CANNOT run unwrapped (no connection is ever made)', async () => {
  const { engine, transport } = fallbackEngine('read-only')
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(
    () => handle.done,
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError, 'the refusal is the sandbox refusal, not a transport error')
      assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
      assert.ok(error.message.includes('refusing to run the command unconfined'))
      assert.match(error.message, /cannot run the remote runner probe/)
      return true
    },
  )
  assert.deepEqual(transport.commands, [], 'the user command never became a string, let alone a channel')
  assert.deepEqual(transport.channels, [])
})

test('fallback composition: workspace-write is refused too (both active modes)', async () => {
  const { engine, transport } = fallbackEngine('workspace-write')
  await assert.rejects(() => engine.spawn(spawnSpec(COMMAND_ARGV)).done, RemoteSandboxError)
  assert.deepEqual(transport.commands, [])
})

test('fallback composition: a fenced machine cannot open an unfenced terminal either', async () => {
  const { engine, transport } = fallbackEngine('read-only')
  await assert.rejects(
    () => engine.spawnTerminal(terminalSpec(['bash'])),
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError)
      assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
      assert.match(error.message, /refuses to open an interactive terminal/)
      return true
    },
  )
  assert.deepEqual(transport.commands, [], 'no PTY was opened')
})

test('fallback composition: an off machine behaves exactly as today', async () => {
  const { engine, gateCalls } = fallbackEngine('off')
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  const finished = await handle.done
  assert.equal(finished.exitCode, 0, 'the spawn proceeded')
  assert.equal(gateCalls.length, 1, 'the approval gate still ran')
})

test('fallback composition: the approval gate still precedes the refusal (and its denial wins)', async () => {
  const order: string[] = []
  const gate: RemoteSpawnGate = async () => {
    order.push('gate')
    throw new RemoteGateError('denied by the gate')
  }
  const { engine, transport } = fallbackEngine('read-only', gate)
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(() => handle.done, /denied by the gate/)
  assert.deepEqual(order, ['gate'], 'the fence never ran after a gate denial')
  assert.deepEqual(transport.commands, [])
})

test('fallback composition: an aggregate-transport route (no connection id) is not refused', async () => {
  const { engine, transport } = fallbackEngine('read-only')
  // A LOCAL-absolute cwd resolves to `ctx.ssh`, which carries no connection id:
  // no machine record can be named, so nothing is fenced — today's behaviour.
  const handle = engine.spawn({ ...spawnSpec(COMMAND_ARGV), cwd: '/srv/work' })
  const finished = await handle.done
  assert.equal(finished.exitCode, 0)
  assert.equal(transport.commands.length, 1)
  assert.ok(!(transport.commands[0] as string).includes('bwrap'), 'no runner was introduced')
})

test('composeFencedGate: a wrapping (probe-backed) fence is REJECTED — it would silently discard the wrap', () => {
  // The composition cannot receive the per-spawn cwd, and it discards the argv
  // the fence returns, so composing a wrapping fence here would report "fenced"
  // while the unwrapped command ran. The guard turns that into a loud error.
  const gate: RemoteSpawnGate = async () => {}
  assert.throws(
    () => composeFencedGate(gate, fakeFence({ mode: 'read-only' }).fence),
    /requires a configuration-deciding fence/,
  )
  assert.doesNotThrow(() => composeFencedGate(gate, refuseFencedCommands({ machine: () => undefined })))
})

test('SshSubprocessRuntime: the optional fence dep rides through to the engine', async () => {
  const ctx = new Context()
  ctx.provide('ssh', aggregateTransport())
  ctx.provide('sshRegistry', {
    get: () => undefined,
    listMachines: () => ({ machines: [machine({ remoteSandbox: 'read-only' })] }),
  })
  const runtime = new SshSubprocessRuntime(ctx, undefined, createRemoteSandboxFence(ctx))
  // A LOCAL-absolute cwd resolves to the aggregate transport, which carries no
  // connection id — so the fence reads 'off' and the command proceeds. This is
  // the "the fence did not break the plain path" pin.
  const handle = runtime.spawn({ ...spawnSpec(COMMAND_ARGV), cwd: '/srv/work' })
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
})

/* -------- 9b) the documented SUBPATH row: no deps ⇒ still fenced (context) */

/**
 * The mount shape of the documented subpath row
 * (`dsh-workspace-enhancement/subprocess`): the engine is constructed with an
 * (optional) gate argument ONLY — no fence dep, no terminal guard. The registry
 * IS mounted (a deployment composing providers individually still runs the ssh
 * row that owns it), so the machine view resolves and the live connection is
 * the probe transport.
 *
 * `ctx.ssh` is a sentinel: reaching it proves the startup sequence got past the
 * gate AND past the fence. `probes` records the control-channel round-trips the
 * context-derived fence performed; `spawnCommands` records any command that
 * actually reached the wire.
 */
function subpathHarness(mode: RemoteSandboxMode, probeExit = 0): {
  ctx: Context
  probes: string[]
  otherCommands: string[]
} {
  const machines = [mode === 'off' ? machine() : machine({ remoteSandbox: mode })]
  const probes: string[] = []
  const otherCommands: string[] = []
  const connection = {
    endpoint: 'root@srv.example',
    cwd: '/srv/work',
    getClient: () => { throw new Error('TRANSPORT-REACHED: getClient') },
    getSftp: () => { throw new Error('TRANSPORT-REACHED: getSftp') },
    getRemoteEnvironment: () => { throw new Error('TRANSPORT-REACHED: getRemoteEnvironment') },
    exec: async (command: string) => {
      // The fence's probe is the plugin constant; anything else on this channel
      // would be a command that should never have been sent.
      if (command.startsWith('command -v ')) probes.push(command)
      else otherCommands.push(command)
      if (probeExit === 0) return { exitCode: 0, signal: null, stdout: 'bubblewrap 0.8.0', stderr: '' }
      return { exitCode: probeExit, signal: null, stdout: '', stderr: "env: 'bwrap': No such file or directory" }
    },
    resolveRemoteCwd: () => '/srv/work',
  }
  const ctx = new Context()
  ctx.provide('ssh', sentinelTransport())
  ctx.provide('sshRegistry', {
    get: (id: string) => (id === 'c1' ? connection : undefined),
    listMachines: () => ({ machines }),
  })
  return { ctx, probes, otherCommands }
}

test('subpath row (no fence dep): a fenced machine IS probed and fenced', async () => {
  const { ctx, probes } = subpathHarness('read-only')
  // The exact construction the subpath row uses: no fence dep at all.
  const engine = new SshSubprocessEngine(ctx)
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
  assert.equal(probes.length, 1, 'the context-derived fence ran the PROBE')
  assert.match(probes[0] as string, /command -v 'bwrap'/, 'the probe is the plugin constant')
  assert.ok(!(probes[0] as string).includes('echo hi'), 'the user command was never sent')
})

test('subpath row (no fence dep): an unusable runner fails closed (nothing executes)', async () => {
  const { ctx, probes, otherCommands } = subpathHarness('read-only', 127)
  const engine = new SshSubprocessEngine(ctx)
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(
    () => handle.done,
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError)
      assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
      return true
    },
  )
  assert.equal(probes.length, 1, 'the probe ran and failed')
  assert.deepEqual(otherCommands, [], 'and no other command reached the channel')
})

test('subpath row (no fence dep): an off machine ships the bare argv and probes NOTHING', async () => {
  const { ctx, probes } = subpathHarness('off')
  const engine = new SshSubprocessEngine(ctx)
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
  assert.deepEqual(probes, [], 'off ⇒ zero probe round-trips, even with the context-derived fence')
})

test('subpath row (no fence dep): a fenced terminal is REFUSED by the context-derived guard', async () => {
  const { ctx } = subpathHarness('read-only')
  const engine = new SshSubprocessEngine(ctx)
  await assert.rejects(
    () => engine.spawnTerminal(terminalSpec(['bash'])),
    (error: unknown) => {
      assert.ok(error instanceof RemoteSandboxError)
      assert.equal((error as RemoteSandboxError).code, REMOTE_SANDBOX_UNAVAILABLE)
      assert.match(error.message, /refuses to open an interactive terminal/)
      return true
    },
  )
})

test('subpath row (no fence dep): an off machine keeps its terminal path (no new refusal)', async () => {
  const { ctx } = subpathHarness('off')
  const engine = new SshSubprocessEngine(ctx)
  await assert.rejects(
    () => engine.spawnTerminal(terminalSpec(['bash'])),
    (error: unknown) => {
      assert.ok(!(error instanceof RemoteSandboxError), 'the derived guard must not refuse an off machine')
      assert.match(String(error), /TRANSPORT-REACHED/, 'the terminal path proceeded to the transport')
      return true
    },
  )
})

test('subpath row (no fence dep): the SshSubprocessRuntime form (gate-only constructor) is fenced too', async () => {
  const { ctx, probes } = subpathHarness('read-only')
  // The runtime's default gate asks the platform approval service; allow once so
  // the assertion lands on the FENCE (reaching `getRemoteEnvironment` proves
  // both stages ran).
  ctx.provide('approval', { request: async () => 'allowed-once' })
  ctx.provide('agents', { currentInitiator: () => ({ id: 'sess-1' }) })
  const runtime = new SshSubprocessRuntime(ctx, createRemoteSpawnGate(ctx))
  const handle = runtime.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
  assert.equal(probes.length, 1, 'no fence dep was passed — the engine derived one from ctx')
})

test('engine spawn: the gate denial still wins over the fence (order is gate → fence)', async () => {
  const gate: RemoteSpawnGate = async () => { throw new RemoteGateError('denied by the gate') }
  const { engine, probes } = engineHarness({ gate })
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(() => handle.done, /denied by the gate/)
  assert.deepEqual(probes, [], 'the fence (and its probe) is never consulted after a gate denial')
})

test('the route cwd reaches the fence (the --bind root candidate is the spawn cwd, POSIX)', async () => {
  const seen: string[] = []
  const probe = async (): Promise<RemoteProbeVerdict> => okVerdict()
  const ctx = new Context()
  ctx.provide('ssh', aggregateTransport())
  ctx.provide('sshRegistry', registryService([machine({ remoteSandbox: 'workspace-write' })]))
  const fence = createRemoteSandboxFence(ctx, {
    deps: fenceDeps({ machines: [machine({ remoteSandbox: 'workspace-write' })], connection: probeConnection(outcome(0)) }),
    probe,
  })
  const observed: RemoteSandboxFence = async (input) => { seen.push(input.cwd); return fence(input) }
  const engine = new SshSubprocessEngine(ctx, undefined, observed)
  const handle = engine.spawn(spawnSpec(COMMAND_ARGV))
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
  assert.deepEqual(seen, [posix.normalize('/srv/work')])
})

test('a placeholder cwd routes to the same fence cwd (the settings page spelling)', async () => {
  const seen: string[] = []
  const fence: RemoteSandboxFence = async (input) => { seen.push(input.cwd); return input.argv }
  const ctx = new Context()
  ctx.provide('sshRegistry', {
    get: () => {
      const transport = sentinelTransport()
      return { ...transport, cwd: '/team/project', resolveRemoteCwd: () => '/team/project' } as SshTransport
    },
    listMachines: () => ({ machines: [machine({ remoteSandbox: 'workspace-write' })] }),
  })
  const engine = new SshSubprocessEngine(ctx, undefined, fence)
  const handle = engine.spawn({ ...spawnSpec(COMMAND_ARGV), cwd: sshRoutePlaceholder('c1', '/team/project') })
  await assert.rejects(() => handle.done, /TRANSPORT-REACHED: getRemoteEnvironment/)
  assert.deepEqual(seen, ['/team/project'])
})
