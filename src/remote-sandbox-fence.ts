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
 * stages of spawn: the gate ("may this run?") sees the **unwrapped** argv
 * first; the fence then either (REQ-I5) ensures a core session is alive and
 * returns the same argv, or (legacy tests without a hub) wraps it as
 * `bwrap … -- argv`. Wrapping earlier would make `bwrap` the gate's `argv[0]`.
 *
 * ## Honest boundaries after REQ-I5
 *
 * With a live core hub, fenced machines confine **spawn and file tools** in
 * the same jail. Interactive terminals are still refused (ADR-0022 §2.4).
 * `remoteSandbox: off` keeps today's SFTP + bare exec.
 *
 * @module dsh-workspace-enhancement/remote-sandbox-fence
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteSpawnGate } from './remote-approval-gate.ts'
import {
  DEFAULT_REMOTE_RUNNER_PATH,
  REMOTE_SANDBOX_MESSAGES,
  RemoteSandboxError,
  buildRemoteProbeCommand,  createRemoteSandboxCache,
  isRemoteSandboxEnabled,
  normalizeRemoteSandbox,
  parseRemoteProbe,
  remoteRunnerArgv,
  remoteSandboxUnavailableError,
  resolveRemoteWorkspaceRoot,
} from './remote-sandbox.ts'
import type {
  RemoteProbeOutcome,
  RemoteSandboxCache,
  RemoteSandboxConfinementMode,
  RemoteSandboxMode,
} from './remote-sandbox.ts'
import type { ExecOutcome } from './ssh-core.ts'
import type { CoreHub } from './core-hub.ts'
import {
  isConfinedSandboxMode,
  isCoreMissingError,
  resolveRemoteSessionMode,
} from './remote-policy.ts'

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
 * the fence needs the mode and the two configured remote directory spellings
 * used as workspace-root fallbacks. The runner path is no longer a machine
 * field (REQ-I12 ④ / REQ-I5): the core resolves `bwrap` itself — first an
 * explicit override, then a copy deployed beside it, then the remote's own
 * PATH (INFRA-15: bubblewrap is never redistributed by this repository).
 */
export interface RemoteSandboxMachineFace {
  readonly id: string
  /** Raw stored mode; `undefined` on every pre-REQ-I9 record ⇒ `'off'`. */
  readonly remoteSandbox?: RemoteSandboxMode
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
  /**
   * The remote working directory of this spawn (the `--bind` root candidate).
   * Optional because a degraded composition that only arms the refusal
   * ({@link composeFencedGate} on the install-failure fallback) may have the
   * argv but not the route's cwd; `workspace-write` then falls back to the
   * machine's configured directory, or refuses.
   */
  cwd?: string
  /**
   * The final remote argv, BEFORE any wrapping. Optional for the same reason:
   * the refusal arm never inspects it.
   */
  argv?: readonly string[]
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
  return (connectionId, fallbackMode) => {
    if (typeof ctx.get === 'function' && ctx.get('sandboxPolicy', false) !== undefined) {
      const mode = resolveRemoteSessionMode(ctx)
      if (!isConfinedSandboxMode(mode)) return undefined
      return REMOTE_SANDBOX_MESSAGES.terminalUnsupported.replace('{mode}', mode)
    }
    return terminalRefusalOf(deps, connectionId, fallbackMode)
  }
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

/* ------------------------------------------------- degraded-composition arms */

/**
 * REQ-I9 fail-closed for a composition that cannot receive the fence as its own
 * dep (`plugin.ts`'s install-failure fallback, ADR-0022 §2.3): the fence runs as
 * the **second half of the gate closure**, so the mount path that only takes one
 * non-context argument still arms it.
 *
 * Semantics are exactly the seam's own ladder, in the seam's own order:
 *  1. the gate decides (`allowed-once` or nothing gets past it),
 *  2. the fence decides the route or **throws** (fail closed),
 *  3. the argv the fence returns is discarded on purpose — the fence here is
 *     {@link refuseFencedCommands}, whose only effect is the refusal, and the
 *     fallback engine's `resolveArgv` stays `undefined`, so the command that
 *     eventually serializes is the ORIGINAL argv (no double wrapping). A fence
 *     that actually WRAPS is rejected by the guard below, because composing one
 *     here would silently discard the wrap.
 *
 * The order is not negotiable: fencing before the approval decision would mean
 * probing a host on behalf of a command that may never be approved.
 *
 * @param gate - the approval gate of that composition.
 * @param fence - a configuration-deciding fence ({@link refuseFencedCommands}).
 * @throws {Error} when `fence` is a wrapping (probe-backed) fence — see above.
 */
export function composeFencedGate(
  gate: RemoteSpawnGate,
  fence: RemoteSandboxFence,
): RemoteSpawnGate {
  // Landmine guard: this composition DISCARDS the argv the fence resolves, so a
  // wrapping fence would report "fenced" while the unwrapped command ran — the
  // exact lie ADR-0022 exists to prevent. Only a configuration-deciding fence
  // (whose purpose is refusal) may be composed here.
  if (!isConfigDecidingFence(fence)) {
    throw new Error('dsw: composeFencedGate requires a configuration-deciding fence; mount a wrapping fence as the seam\'s own dep instead')
  }
  return async (input) => {
    await gate(input)
    // `terminal: true` (ADR-0022 §2.4): a fenced route must not open a PTY at
    // all. The refusal must fire HERE when the armed fence can decide it from
    // configuration (the marker), because the seam's own terminal guard is a
    // separate dep this composition cannot receive; a probe-backed fence is not
    // marked, so no probe is ever run for a terminal request.
    if (input.terminal === true) {
      const refusal = (fence as MarkedFence).terminalRefusal?.(input.connectionId)
      if (refusal !== undefined) throw new RemoteSandboxError(refusal)
      return
    }
    // No `cwd`: the approval input carries the argv only, and the fence input's
    // `cwd` is the per-spawn remote directory. For the refusal arm that is
    // irrelevant (it throws before any profile is built); a probe-backed fence
    // must therefore be mounted as the seam's own dep, where the resolved route
    // supplies the real cwd.
    await fence({
      connectionId: input.connectionId,
      argv: input.argv.filter((value: string | undefined): value is string => value !== undefined),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    })
  }
}

/**
 * Marker one fence variant carries so {@link composeFencedGate} knows it can
 * answer **both** an argv request and a terminal request from configuration
 * alone. {@link refuseFencedCommands} carries it; a probe-backed fence does
 * NOT, because it cannot answer for a PTY (ADR-0022 §2.4 refuses fenced
 * terminals rather than probing them).
 */
const CONFIG_DECIDING_FENCE = Symbol('dsw.config-deciding-sandbox-fence')

type MarkedFence = RemoteSandboxFence & {
  [CONFIG_DECIDING_FENCE]?: true
  /**
   * The optional terminal arm of a configuration-deciding fence: the refusal
   * message for one route, or `undefined` when a terminal may open as before.
   * Set by {@link refuseFencedCommands}; absent on a probe-backed fence.
   */
  terminalRefusal?(connectionId: string | undefined): string | undefined
}

/** Whether one fence decides from configuration alone (spawn AND terminal). */
export function isConfigDecidingFence(fence: RemoteSandboxFence): boolean {
  return (fence as MarkedFence)[CONFIG_DECIDING_FENCE] === true
}

/**
 * A fence that proves nothing and therefore never WRAPS a fenced-route command
 * — it refuses it. This is the fail-closed arm for a composition that cannot
 * run the remote runner probe (the install-failure fallback: the machine view
 * may be strictly narrower than a live connection), and it is a plain
 * configuration read, so it is synchronous, offline and unspoofable by a
 * hostile remote host.
 *
 * It reads the machine view it is given, which keeps the two required
 * behaviours apart:
 *  - a machine whose `remoteSandbox` is not `'off'` ⇒ throw
 *    `SANDBOX_UNAVAILABLE` (the operator asked for a fence; it cannot be proven
 *    here, so the command must not run);
 *  - an `'off'` machine — and every pre-REQ-I9 record — ⇒ identity argv, i.e.
 *    today's byte-for-byte behaviour.
 *
 * The fallback composition passes {@link remoteSandboxDepsOf} (the same machine
 * view the shipping path uses), so "off" is decided by the same rule in both
 * compositions. When that view cannot reach the registry at all, a route with a
 * connection id still exists (the `ssh://` resolution reached the registry
 * first) and the unknown machine reads as `'off'`-by-fallback — the honest
 * limit of a composition that has no other registry face.
 *
 * @param deps - at minimum the machine view the mode is read from.
 * @param fallbackMode - mode used when the route names no registry machine.
 */
export function refuseFencedCommands(
  deps: Pick<RemoteSandboxDeps, 'machine'> & Partial<Pick<RemoteSandboxDeps, 'unavailable'>>,
  fallbackMode: RemoteSandboxMode = 'off',
): RemoteSandboxFence {
  const unavailable = deps.unavailable ?? remoteSandboxUnavailable
  const fence: MarkedFence = async (input) => {
    const mode = effectiveModeOf(deps, input.connectionId, fallbackMode)
    if (!isRemoteSandboxEnabled(mode)) return input.argv ?? []
    throw unavailable(
      mode === 'workspace-write' ? 'workspace-write' : 'read-only',
      'this composition cannot run the remote runner probe, so the requested fence cannot be proven; refusing to run the command unconfined.',
    )
  }
  fence[CONFIG_DECIDING_FENCE] = true
  // The terminal arm reads the SAME configuration rule, so a fenced machine is
  // refused before any PTY opens and an 'off' machine is untouched.
  fence.terminalRefusal = (connectionId: string | undefined) => terminalRefusalOf(deps, connectionId, fallbackMode)
  return fence
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
  return remoteRunnerArgv(input.argv ?? [], {
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
    /** REQ-I5: when present, fenced machines ensure a core session instead of wrapping argv. */
    hub?: CoreHub
  } = {},
): RemoteSandboxFence {
  const deps = options.deps ?? remoteSandboxDepsOf(ctx)
  const cache = options.cache ?? createRemoteSandboxCache()
  const probe = options.probe ?? probeRunner
  const fallbackMode = normalizeRemoteSandbox(options.fallbackMode)
  const hub = options.hub
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
    if (hub !== undefined) {
      const policy = resolveRemoteSessionMode(ctx)
      const connectionId = input.connectionId
      if (connectionId === undefined) {
        if (!isConfinedSandboxMode(policy)) return input.argv ?? []
        throw deps.unavailable(
          policy === 'workspace-write' ? 'workspace-write' : 'read-only',
          'no registry connection is associated with this route',
        )
      }
      try {
        await hub.require(connectionId, {
          policy,
          ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
        })
        return input.argv ?? []
      } catch (error) {
        if (!isConfinedSandboxMode(policy) && isCoreMissingError(error)) return input.argv ?? []
        throw error
      }
    }
    const mode = effectiveModeOf(deps, input.connectionId, fallbackMode)
    // 'off' — and every record predating the field: identity argv, zero probes.
    if (!isRemoteSandboxEnabled(mode)) return input.argv ?? []
    const confinement: RemoteSandboxConfinementMode = mode === 'workspace-write' ? 'workspace-write' : 'read-only'
    if (input.connectionId === undefined) {
      throw deps.unavailable(confinement, 'no registry connection is associated with this route')
    }
    const machine = deps.machine(input.connectionId)
    const connection = deps.connection(input.connectionId)
    if (machine === undefined || connection === undefined) {
      throw deps.unavailable(confinement, `machine ${JSON.stringify(input.connectionId)} is not usable as a registry connection`)
    }
    const runnerPath = DEFAULT_REMOTE_RUNNER_PATH
    await probeOnce(connection, runnerPath, confinement, input.signal)
    return wrapOf(deps, input, machine, confinement, runnerPath)
  }
}
