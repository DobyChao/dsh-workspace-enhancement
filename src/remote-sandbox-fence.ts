/**
 * REQ-I9 / ADR-0022: the remote sandbox fence — WIRING half.
 *
 * {@link module:dsh-workspace-enhancement/remote-sandbox} owns the pure decision
 * surface (the bwrap profile vector, the probe command, the probe parser, the
 * verdict cache, the refusal vocabulary). This module owns what that pure half
 * deliberately left out: the **live** closure the subprocess seam awaits per
 * spawn, built from `ctx` exactly like the AUDIT-6 gate
 * ({@link module:dsh-workspace-enhancement/remote-approval-gate}):
 *
 *  1. resolve the per-machine mode through the registry's secret-free views;
 *  2. `'off'` — and every machine record that predates the field — returns the
 *     argv **by identity**, with zero probes (ADR-0022 §2.1, I9-7);
 *  3. `'read-only'` / `'workspace-write'` require a **positive** proof that the
 *     remote runner is usable *for this connection* — the functional probe of
 *     `buildRemoteProbeCommand` over the transport's control channel;
 *  4. only then is the argv handed to `remoteRunnerArgv`.
 *
 * ## Fail-closed is the whole point (ADR-0022 §2.3)
 *
 * There is no fallback path in this file. A failed probe, an unknown machine, a
 * `workspace-write` request without a usable absolute remote workspace root, or
 * a broken registry lookup all **throw** a `SANDBOX_UNAVAILABLE` error before
 * any user command text reaches SSH. It never runs the unwrapped argv and never
 * degrades to `read-only` on its own. That is the strongest acceptance
 * assertion of the REQ-I9 suite (I9-5: prove the command never executed).
 *
 * ## Where this sits relative to the approval gate (ADR-0022 §2.2)
 *
 * The gate and the fence are two different questions asked at two different
 * stages of `SshSubprocessHandle.run()`: the gate ("may this run?") sees the
 * **unwrapped** argv first, the fence ("what exactly runs?") resolves it
 * afterwards. Wrapping earlier — in `MixedSubprocessRuntime.spawn` — would make
 * `bwrap` the `argv[0]` the gate inspects, `isRemoteShellShape()` would stop
 * matching, and AUDIT-6 would silently stop covering every remote command
 * (recon A3 §Q3). `test/remote-sandbox-wiring.test.ts` pins both halves.
 *
 * ## The two honest boundaries (ADR-0022 §2.7)
 *
 * The fence covers **spawned commands only**: the fs/SFTP write face travels the
 * host-side channel and bwrap cannot confine it, and interactive terminals are
 * refused rather than opened unfenced ({@link createRemoteSandboxTerminalGuard},
 * ADR-0022 §2.4). Both facts are carried to the UI by the settings hint and to
 * the model by {@link REMOTE_SANDBOX_MESSAGES}.
 *
 * @module dsh-workspace-enhancement/remote-sandbox-fence
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_REMOTE_RUNNER_PATH,
  REMOTE_SANDBOX_MESSAGES,
  RemoteSandboxError,
  buildRemoteProbeCommand,
  createRemoteSandboxCache,
  isRemoteSandboxEnabled,
  normalizeRemoteSandbox,
  parseRemoteProbe,
  remoteRunnerArgv,
  remoteSandboxUnavailableError,
  resolveRemoteRunnerPath,
  resolveRemoteWorkspaceRoot,
} from './remote-sandbox.ts'
import type {
  RemoteProbeOutcome,
  RemoteSandboxCache,
  RemoteSandboxConfinementMode,
  RemoteSandboxMode,
} from './remote-sandbox.ts'
import type { ExecOutcome } from './ssh-core.ts'

/* --------------------------------------------------------------- surfaces */

/**
 * The connection face the probe needs. `SshConnection` and the aggregate
 * `ctx.ssh` runtime both satisfy it structurally; tests substitute a fake, so
 * no live SSH host is required to exercise the whole fail-closed ladder.
 */
export interface RemoteSandboxConnectionFace {
  exec(command: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<ExecOutcome>
}

/**
 * The registry slice the fence reads. Deliberately narrower than
 * {@link module:dsh-workspace-enhancement/remote-approval-gate}'s machine face:
 * the fence needs the mode, the configured runner (absent in v1 — the machine
 * record has no such field yet, so it stays optional) and the two configured
 * remote directory spellings used as workspace-root fallbacks.
 */
export interface RemoteSandboxMachineFace {
  readonly id: string
  /** Raw stored mode; `undefined` on every pre-REQ-I9 record ⇒ `'off'`. */
  readonly remoteSandbox?: RemoteSandboxMode
  /** Optional per-machine runner path (`bwrap` when absent or non-absolute). */
  readonly remoteSandboxRunner?: string
  /** Configured default remote directory (dsh-remote canonical spelling). */
  readonly workspace?: string
  /** Configured default remote directory (legacy spelling). */
  readonly cwd?: string
}

/** The registry slice the fence reads (secret-free views only). */
export interface RemoteSandboxRegistryFace {
  listMachines(): { machines: readonly RemoteSandboxMachineFace[] }
  /** The LIVE connection object of one entry — the probe cache key's identity. */
  get(id: string): RemoteSandboxConnectionFace | undefined
}

/** Faceted deps: everything the fence needs, injectable in tests. */
export interface RemoteSandboxDeps {
  /** The machine view of one route, or `undefined` for unknown targets. */
  machine(id: string): RemoteSandboxMachineFace | undefined
  /** The live connection of one route, or `undefined` when it cannot be built. */
  connection(id: string): RemoteSandboxConnectionFace | undefined
  /**
   * The error class raised on refusal. Defaults to the pure module's
   * {@link RemoteSandboxError}; production passes the host's
   * `SandboxUnavailableError` so the `SANDBOX_UNAVAILABLE` code also travels
   * the structured `HarnessError` channel (`@deepseek-ai/dsh-sandbox`), not
   * only this plugin's `Error` subclass.
   */
  unavailable(mode: RemoteSandboxConfinementMode, detail?: string): Error
  /** Optional diagnostic sink (never gates anything). */
  warn?(text: string): void
}

/** One fence request: the route plus the argv the seam is about to execute. */
export interface RemoteSandboxFenceInput {
  /** Registry connection id of the route; `undefined` ⇒ no machine ⇒ no fence. */
  connectionId: string | undefined
  /** The remote working directory of this spawn (the `--bind` root candidate). */
  cwd: string
  /** The final remote argv, BEFORE any wrapping. */
  argv: readonly string[]
  /** Cancellation lifetime of the spawn. */
  signal?: AbortSignal
}

/**
 * The fence closure the seam awaits between `preflight` and serialization.
 * Returns the argv to serialize — the input verbatim when the machine's mode is
 * `'off'`, the runner-wrapped vector otherwise.
 */
export type RemoteSandboxFence = (input: RemoteSandboxFenceInput) => Promise<readonly string[]>

/**
 * The terminal refusal decision (ADR-0022 §2.4): `spawnTerminal` is refused,
 * not fenced, in v1. This closure performs **no I/O and no probe** — it is a
 * configuration read, so the refusal cannot be delayed by the network (and a
 * machine that has never spawned anything is still refused rather than opened).
 * Returns the message to raise, or `undefined` when the machine is unfenced.
 */
export type RemoteSandboxTerminalGuard = (
  connectionId: string | undefined,
  mode: RemoteSandboxMode,
) => string | undefined

/* ------------------------------------------------------------- constants */

/** Cap of the probe round-trip (the status probe uses 8 s; bwrap is slower). */
export const REMOTE_SANDBOX_PROBE_TIMEOUT_MS = 15_000

/* -------------------------------------------------------- host wiring */

/** Read the registry service by name (optional service: never injected). */
function registryOf(ctx: Context): RemoteSandboxRegistryFace | undefined {
  return ctx.get('sshRegistry', false) as RemoteSandboxRegistryFace | undefined
}

/** Build {@link RemoteSandboxDeps} from a live Cordis context. */
export function remoteSandboxDepsOf(ctx: Context): RemoteSandboxDeps {
  const registry = (): RemoteSandboxRegistryFace | undefined => registryOf(ctx)
  return {
    machine: (id: string) => registry()?.listMachines().machines.find(machine => machine.id === id),
    connection: (id: string) => registry()?.get(id),
    unavailable: remoteSandboxUnavailable,
    warn: text => ctx.logger.warn(text),
  }
}

/**
 * The terminal guard built from a live context. The refusal text is the
 * pure module's `terminalUnsupported` constant with `{mode}` interpolated.
 */
export function createRemoteSandboxTerminalGuard(ctx: Context): RemoteSandboxTerminalGuard {
  const deps = remoteSandboxDepsOf(ctx)
  return (connectionId, mode) => terminalRefusalOf(deps, connectionId, mode)
}

/** The pure refusal decision shared by the context-built guard and the tests. */
export function terminalRefusalOf(
  deps: Pick<RemoteSandboxDeps, 'machine'>,
  connectionId: string | undefined,
  fallbackMode: RemoteSandboxMode = 'off',
): string | undefined {
  const mode = effectiveModeOf(deps, connectionId, fallbackMode)
  if (!isRemoteSandboxEnabled(mode)) return undefined
  return REMOTE_SANDBOX_MESSAGES.terminalUnsupported.replace('{mode}', mode)
}

/* ------------------------------------------------------ mode resolution */

/**
 * The effective mode of one route. An unknown machine (the aggregate `ctx.ssh`
 * transport, an `ssh://` route to a machine that is not in the table) has no
 * `remoteSandbox` field by definition and therefore reads as `'off'` — the same
 * honest non-coverage ADR-0020 §D1 records for the approval gate, except that
 * here the *fallback mode* also covers the subpath runtime, which is built with
 * no connection id at all.
 */
export function effectiveModeOf(
  deps: Pick<RemoteSandboxDeps, 'machine'>,
  connectionId: string | undefined,
  fallbackMode: RemoteSandboxMode = 'off',
): RemoteSandboxMode {
  if (connectionId === undefined) return normalizeRemoteSandbox(fallbackMode)
  const machine = deps.machine(connectionId)
  if (machine === undefined) return normalizeRemoteSandbox(fallbackMode)
  return normalizeRemoteSandbox(machine.remoteSandbox)
}

/**
 * The remote workspace root of one spawn: the spawn's own remote cwd first
 * (ADR-0022 §2.5 — the `--bind` root follows `sw_exec`'s workdir semantics),
 * then the machine's configured `workspace` / `cwd`. Every candidate goes
 * through the pure shape guard (absolute, no NUL/newline); `undefined` means
 * `workspace-write` will refuse rather than bind something unusable.
 */
export function fenceWorkspaceRootOf(
  cwd: string | undefined,
  machine: RemoteSandboxMachineFace | undefined,
): string | undefined {
  return resolveRemoteWorkspaceRoot(cwd, machine?.workspace, machine?.cwd)
}

/* ---------------------------------------------------------------- probe */

/** Cap the diagnostic text handed to the refusal (the pure module caps at 240). */
function probeDetailOf(verdict: { detail?: string }): string | undefined {
  return verdict.detail
}

/**
 * Run the functional probe for one connection and cache the verdict by
 * connection **identity** (a rebuilt connection re-probes; the
 * `createRemoteOsCache` precedent).
 *
 * The probe text is a plugin constant executed over the transport's **control
 * channel**, which is the same carve-out ADR-0020 D1 grants `uname -s` /
 * `cmd /c ver` / `echo ok`: it is not the user's command and it is not routed
 * through the sandboxed spawn seam.
 *
 * A negative verdict is cached too: "this connection cannot confine" is a
 * stable fact for the connection's lifetime, and re-probing on every command
 * would turn a refusal into a latency tax while changing nothing (the mode is
 * still refused either way).
 * @param deps - faceted deps.
 * @param connection - the live connection (probe transport + cache key).
 * @param runnerPath - remote runner program to probe.
 * @param mode - the requested mode (only used to shape the refusal).
 * @param signal - the spawn's cancellation lifetime.
 * @param probe - the probe outcome function (injectable; see {@link probeRunner}).
 * @param cache - the process-local identity-keyed verdict cache.
 */
export async function ensureRunnerProbed(
  deps: Pick<RemoteSandboxDeps, 'unavailable'>,
  connection: RemoteSandboxConnectionFace,
  runnerPath: string,
  mode: RemoteSandboxConfinementMode,
  signal: AbortSignal | undefined,
  probe: RemoteSandboxProbe,
  cache: RemoteSandboxCache,
): Promise<void> {
  const project = deps.unavailable
  const cached = cache.get(connection)
  if (cached !== undefined) {
    if (!cached.ok) throw project(mode, probeDetailOf(cached))
    return
  }
  const verdict = await probe(connection, runnerPath, signal)
  cache.set(connection, verdict)
  if (!verdict.ok) throw project(mode, probeDetailOf(verdict))
}

/**
 * The default refusal builder: the production rule is the pure module's
 * {@link remoteSandboxUnavailableError}, which composes the upstream-style
 * `sandbox mode "{mode}" …` line and appends the probe detail. Exported so the
 * production ladder and the tests exercise ONE error shape (a bespoke message
 * in a test would stop pinning the real text).
 */
export const remoteSandboxUnavailable: RemoteSandboxDeps['unavailable'] = (mode, detail) =>
  remoteSandboxUnavailableError(mode, detail)

/** The probe outcome function: one round-trip per connection (async, injectable). */
export type RemoteSandboxProbe = (
  connection: RemoteSandboxConnectionFace,
  runnerPath: string,
  signal: AbortSignal | undefined,
) => Promise<ReturnType<typeof parseRemoteProbe>>

/** Combine the spawn's lifetime with the probe's own budget (both may be absent). */
function probeSignalOf(signal: AbortSignal | undefined): AbortSignal {
  const budget = AbortSignal.timeout(REMOTE_SANDBOX_PROBE_TIMEOUT_MS)
  return signal === undefined ? budget : AbortSignal.any([signal, budget])
}

/**
 * Run {@link buildRemoteProbeCommand} over the control channel and parse it.
 * The command text is the plugin constant; `exec` output is collected by the
 * transport, so a channel dropped mid-flight still yields an exit code (or
 * `null`, which {@link parseRemoteProbe} treats as a failure).
 */
export async function probeRunner(
  connection: RemoteSandboxConnectionFace,
  runnerPath: string = DEFAULT_REMOTE_RUNNER_PATH,
  signal?: AbortSignal,
): Promise<ReturnType<typeof parseRemoteProbe>> {
  const outcome: ExecOutcome = await connection.exec(buildRemoteProbeCommand(runnerPath), {
    signal: probeSignalOf(signal),
  })
  const probeOutcome: RemoteProbeOutcome = {
    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    signal: outcome.signal,
  }
  return parseRemoteProbe(probeOutcome)
}

/* ---------------------------------------------------------- the closure */

/** What one fence evaluation returns: the argv to serialize. */
function wrapOf(
  deps: RemoteSandboxDeps,
  input: RemoteSandboxFenceInput,
  machine: RemoteSandboxMachineFace,
  mode: RemoteSandboxConfinementMode,
  runnerPath: string,
): readonly string[] {
  const root = fenceWorkspaceRootOf(input.cwd, machine)
  if (mode === 'workspace-write' && root === undefined) {
    // Fail closed — never degrade to `read-only` behind the operator's back.
    throw deps.unavailable(mode, REMOTE_SANDBOX_MESSAGES.workspaceRootRequired)
  }
  return remoteRunnerArgv(input.argv, {
    mode,
    ...(mode === 'workspace-write' && root !== undefined ? { workspaceRoot: root } : {}),
  }, runnerPath)
}

/**
 * Build the fence closure for one live context — the single place a remote
 * command can become a fenced command. The ordered ladder below is the whole
 * specification of this slice; every "cannot prove it" branch throws.
 *
 * @param ctx - the aggregate row's context.
 * @param options.cache - verdict cache (one per mounted plugin; the default is
 *   a fresh process-local cache).
 * @param options.probe - probe outcome function (tests inject a fake).
 * @param options.deps - faceted deps (tests inject a fake; defaults to `ctx`).
 * @param options.fallbackMode - the mode used when the route has no registry
 *   machine (the subpath runtime, the aggregate transport). Defaults to
 *   `'off'`, i.e. today's behaviour, so an upgrade changes nothing (ADR-0022
 *   §A3 unknown 11 answered: no registry machine ⇒ `off`).
 */
export function createRemoteSandboxFence(
  ctx: Context,
  options: {
    cache?: RemoteSandboxCache
    probe?: RemoteSandboxProbe
    deps?: RemoteSandboxDeps
    fallbackMode?: RemoteSandboxMode
  } = {},
): RemoteSandboxFence {
  const deps = options.deps ?? remoteSandboxDepsOf(ctx)
  const cache = options.cache ?? createRemoteSandboxCache()
  const probe = options.probe ?? probeRunner
  const fallbackMode = normalizeRemoteSandbox(options.fallbackMode)
  /**
   * In-flight deduplication: N spawns racing on a cold cache must produce ONE
   * probe round-trip, not N. Keyed by connection identity like the cache, and
   * cleared as soon as the round-trip settles (a failure is then served from
   * the cache, which holds the negative verdict as well).
   */
  const inFlight = new Map<RemoteSandboxConnectionFace, Promise<void>>()

  const probeOnce = (
    connection: RemoteSandboxConnectionFace,
    runnerPath: string,
    mode: RemoteSandboxConfinementMode,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    const running = inFlight.get(connection)
    if (running !== undefined) return running
    const attempt = ensureRunnerProbed(deps, connection, runnerPath, mode, signal, probe, cache)
      .finally(() => { inFlight.delete(connection) })
    inFlight.set(connection, attempt)
    return attempt
  }

  return async (input: RemoteSandboxFenceInput): Promise<readonly string[]> => {
    const mode = effectiveModeOf(deps, input.connectionId, fallbackMode)
    // 'off' — and every record predating the field: identity argv, zero probes.
    if (!isRemoteSandboxEnabled(mode)) return input.argv
    // `isRemoteSandboxEnabled` is a plain boolean, so TypeScript cannot narrow
    // the union through it; re-derive the tightened type from the already
    // checked value instead of casting.
    const confinement: RemoteSandboxConfinementMode = mode === 'workspace-write' ? 'workspace-write' : 'read-only'
    if (input.connectionId === undefined) {
      // Unreachable via effectiveModeOf unless a fallback mode was configured
      // without a connection: there is no connection to probe, so the only
      // honest answer is refusal.
      throw deps.unavailable(confinement, 'no registry connection is associated with this route')
    }
    const machine = deps.machine(input.connectionId)
    const connection = deps.connection(input.connectionId)
    if (machine === undefined || connection === undefined) {
      throw deps.unavailable(confinement, `machine ${JSON.stringify(input.connectionId)} is not usable as a registry connection`)
    }
    const runnerPath = resolveRemoteRunnerPath(machine.remoteSandboxRunner)
    await probeOnce(connection, runnerPath, confinement, input.signal)
    return wrapOf(deps, input, machine, confinement, runnerPath)
  }
}
