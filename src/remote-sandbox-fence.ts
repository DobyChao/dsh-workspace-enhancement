/**
 * REQ-I9 / ADR-0022 → ADR-0025 → ADR-0031: the remote sandbox fence — WIRING.
 *
 * One rule: the confine MARK on this argv decides, not the session mode.
 * A marked argv opens `dsh-core serve --sandbox <mode>`. An unmarked argv is
 * `--sandbox off` (a danger grant skips confine on purpose). When the core
 * is missing, a confined mark fails closed; an unmarked argv falls back to
 * today's SSH exec.
 *
 * The approval gate still runs FIRST and sees the unwrapped argv (ADR-0022
 * §2.2). Terminals are decided in `spawnTerminal`: a marked argv is the
 * model's persistent shell and is refused while confined; an unmarked argv
 * is the human's browser terminal and opens.
 *
 * There is no host-side bwrap wrap and no per-machine `remoteSandbox` field
 * (AUDIT-7).
 *
 * @module dsh-workspace-enhancement/remote-sandbox-fence
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { REMOTE_SANDBOX_MESSAGES, remoteSandboxUnavailableError } from './remote-sandbox.ts'
import type { RemoteSandboxConfinementMode } from './remote-sandbox.ts'
import type { ExecOutcome } from './ssh-core.ts'
import type { CoreHub } from './core-hub.ts'
import { isConfinedSandboxMode, isCoreMissingError } from './remote-policy.ts'
import { confinedSpawnMarkOf } from './remote-confine-policy.ts'

/* --------------------------------------------------------------- surfaces */

/** The live connection face of one registry entry (core deploy / open transport). */
export interface RemoteSandboxConnectionFace {
  exec(command: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<ExecOutcome>
}

/**
 * The machine slice the hub reads: the two configured remote directory
 * spellings used as workspace-root fallbacks.
 */
export interface RemoteSandboxMachineFace {
  readonly id: string
  /** Configured default remote directory (dsh-remote canonical spelling). */
  readonly workspace?: string
  /** Configured default remote directory (legacy spelling). */
  readonly cwd?: string
}

/** The registry slice read here (secret-free views only). */
export interface RemoteSandboxRegistryFace {
  listMachines(): { machines: readonly RemoteSandboxMachineFace[] }
  get(id: string): RemoteSandboxConnectionFace | undefined
}

/** Faceted deps, injectable in tests. */
export interface RemoteSandboxDeps {
  /** The machine view of one route, or `undefined` for unknown targets. */
  machine(id: string): RemoteSandboxMachineFace | undefined
  /** The live connection of one route, or `undefined` when it cannot be built. */
  connection(id: string): RemoteSandboxConnectionFace | undefined
  /**
   * The refusal builder. Production passes {@link remoteSandboxUnavailable}
   * so the `SANDBOX_UNAVAILABLE` code also travels the structured channel.
   */
  unavailable(mode: RemoteSandboxConfinementMode, detail?: string): Error
  /** Optional diagnostic sink (never gates anything). */
  warn?(text: string): void
}

/** One fence request: the route plus the argv the seam is about to execute. */
export interface RemoteSandboxFenceInput {
  /** Registry connection id of the route; `undefined` = aggregate transport. */
  connectionId: string | undefined
  /** The remote working directory of this spawn (the jail root candidate). */
  cwd?: string
  /** The argv about to execute (returned unchanged when allowed). */
  argv?: readonly string[]
  /** Cancellation lifetime of the spawn. */
  signal?: AbortSignal
}

/** The fence closure: resolves the argv to serialize, or throws. */
export type RemoteSandboxFence = (input: RemoteSandboxFenceInput) => Promise<readonly string[]>

/* -------------------------------------------------------- host wiring */

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

/** The default refusal builder (one error shape for production and tests). */
export const remoteSandboxUnavailable: RemoteSandboxDeps['unavailable'] = (mode, detail) =>
  remoteSandboxUnavailableError(mode, detail)

/**
 * REQ-I27 / ADR-0031 §4 retired the session-mode terminal guard: terminals
 * key off the confine MARK in `spawnTerminal` (marked = model-side = refuse;
 * unmarked = the human's browser terminal = opens unfenced).
 */

/** The `coreHub` service by name (no import cycle with `core-hub.ts`). */
function coreHubOf(ctx: Context): CoreHub | undefined {
  if (typeof ctx.get !== 'function') return undefined
  return ctx.get('coreHub', false) as CoreHub | undefined
}

/**
 * Build the fence closure for one live context.
 * @param ctx - the mounting context (session mode, registry, `coreHub`).
 * @param options.deps - faceted deps (tests inject a fake; defaults to `ctx`).
 * @param options.hub - defaults to the process-wide `coreHub` service.
 */
export function createRemoteSandboxFence(
  ctx: Context,
  options: {
    deps?: RemoteSandboxDeps
    hub?: CoreHub
  } = {},
): RemoteSandboxFence {
  const deps = options.deps ?? remoteSandboxDepsOf(ctx)
  return async (input: RemoteSandboxFenceInput): Promise<readonly string[]> => {
    // REQ-I27 / ADR-0031 §3.1: the confine mark — not the session mode —
    // decides. Unmarked argv is unfenced by design (owner-accepted).
    const policy: SandboxMode = confinedSpawnMarkOf(input.argv)?.mode ?? 'danger-full-access'
    const confined = isConfinedSandboxMode(policy)
    const refuseMode = policy === 'workspace-write' ? 'workspace-write' : 'read-only'
    const connectionId = input.connectionId
    if (connectionId === undefined) {
      if (!confined) return input.argv ?? []
      throw deps.unavailable(refuseMode, 'no registry connection is associated with this route')
    }
    const hub = options.hub ?? coreHubOf(ctx)
    if (hub === undefined) {
      if (!confined) return input.argv ?? []
      throw deps.unavailable(refuseMode, 'the remote component hub is not mounted in this composition')
    }
    try {
      await hub.require(connectionId, {
        policy,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      })
      return input.argv ?? []
    } catch (error) {
      if (!confined && isCoreMissingError(error)) return input.argv ?? []
      throw error
    }
  }
}
