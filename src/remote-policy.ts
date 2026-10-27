/**
 * REQ-I13 / ADR-0025: session `/permission` → core `--sandbox`, and the
 * transport fallback when a Linux core is missing.
 *
 * Machine `remoteSandbox` is not consulted here. The effective mode is the
 * per-call `sandboxPolicy` (escalation overlay) or `ctx.sandboxPolicy.resolve()`.
 *
 * @module dsh-workspace-enhancement/remote-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { CORE_ERROR_SANDBOX } from './core-protocol.ts'

/** `dsh-core serve --sandbox` tokens, including unjailed `off`. */
export type CoreServeSandbox = 'off' | 'read-only' | 'workspace-write'

/** Thrown when danger-full-access may fall back to SFTP/SSH because no core opened. */
export const CORE_MISSING = 'CORE_MISSING'

export class CoreMissingError extends Error {
  readonly code = CORE_MISSING
  constructor(detail: string) {
    super(detail)
    this.name = 'CoreMissingError'
  }
}

export function isCoreMissingError(error: unknown): boolean {
  return error instanceof CoreMissingError
    || (error instanceof Error && (error as { code?: string }).code === CORE_MISSING)
}

export function isSandboxMode(raw: unknown): raw is SandboxMode {
  return raw === 'read-only' || raw === 'workspace-write' || raw === 'danger-full-access'
}

/** Confined session modes fail closed when the core is missing. */
export function isConfinedSandboxMode(mode: SandboxMode): boolean {
  return mode !== 'danger-full-access'
}

/** One remote `ctx.fs` call is either a read face or a mutating write face (REQ-I15). */
export type RemoteFsFace = 'read' | 'write'

/** Fence / core refusals carry `SANDBOX_UNAVAILABLE` (RemoteSandboxError, CoreRpcError). */
export function isSandboxUnavailableError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === CORE_ERROR_SANDBOX
}

/**
 * REQ-I15: when the Linux core cannot open, which fs face may use SFTP.
 *
 * - danger-full-access: every face, on {@link CoreMissingError} (today's SFTP).
 * - confined: **reads only**, and only on `SANDBOX_UNAVAILABLE`. Writes stay
 *   fail-closed so a missing bwrap/core cannot silently mutate the remote.
 */
export function sftpFallbackForCoreGap(
  mode: SandboxMode,
  face: RemoteFsFace,
  error: unknown,
): boolean {
  if (!isConfinedSandboxMode(mode)) return isCoreMissingError(error)
  return face === 'read' && isSandboxUnavailableError(error)
}

/** Local `danger-full-access` is remote `--sandbox off` (same RPC, no bwrap). */
export function coreServeSandboxOf(mode: SandboxMode): CoreServeSandbox {
  return mode === 'danger-full-access' ? 'off' : mode
}

/**
 * Pull `mode` off a `SandboxExecutionPolicy` object, a bare mode string, or
 * `undefined`.
 */
export function sandboxModeFromPolicy(policy: unknown): SandboxMode | undefined {
  if (isSandboxMode(policy)) return policy
  if (policy !== null && typeof policy === 'object' && isSandboxMode((policy as { mode?: unknown }).mode)) {
    return (policy as { mode: SandboxMode }).mode
  }
  return undefined
}

/** Calling session of the current agent initiator, when one exists. */
export function initiatorSessionOf(ctx: Context): { header?: { cwd?: string } } | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const agents = ctx.get('agents', false) as {
    currentInitiator?: () => { session?: { header?: { cwd?: string } } } | undefined
  } | undefined
  return agents?.currentInitiator?.()?.session
}

/** The optional host `sessionProjections` face the effective-cwd seam reads (0.2.1 family). */
export interface SessionProjectionsFace {
  stateOf(session: unknown, key: string): unknown
}

/** Optional lookup of the host `sessionProjections` service (absent pre-0.2.1). */
export function sessionProjectionsOf(ctx: Context): SessionProjectionsFace | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get('sessionProjections', false) as SessionProjectionsFace | undefined
  return value !== undefined && typeof value.stateOf === 'function' ? value : undefined
}

/**
 * The host `workingDirectory` service face `sw_use_machine` needs (0.2.1
 * family): `set` validates the target through `ctx.fs` (our remote provider)
 * and commits the durable `working-directory/change` event; `get` reads the
 * committed value (the tool captures it pre-switch so a mis-commit can be
 * rolled back). Absent on older families, where the experimental tool does
 * not register at all.
 */
export interface WorkingDirectoryFace {
  get(session: unknown): string
  set(agent: unknown, path: string, signal?: AbortSignal): Promise<string>
}

/** Optional lookup of the host `workingDirectory` service (absent pre-0.2.1). */
export function workingDirectoryOf(ctx: Context): WorkingDirectoryFace | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get('workingDirectory', false) as WorkingDirectoryFace | undefined
  return value !== undefined && typeof value.get === 'function' && typeof value.set === 'function'
    ? value
    : undefined
}

/**
 * REQ-I31: one session's EFFECTIVE working directory — the `workingDirectory`
 * projection first, the immutable creation `header.cwd` as the fallback.
 *
 * On 0.2.1-family hosts the projection is the truth: `workingDirectory.set`
 * commits `working-directory/change` events (the header keeps the original
 * project forever), and every host consumer (fs tools, skills, terminal,
 * subagents) already reads it. Pre-0.2.1 families have no projection at all,
 * so the lookup is optional and the header stays the only cwd source.
 *
 * `stateOf` drives the fallback: a string is the committed value
 * (header-initialized, `set`-replaced); `null` means the session never had a
 * cwd — and because the unit's `init` folds `header.cwd ?? null`, a null
 * state can never hide a header value; `undefined` means the key is not
 * registered (old family). Both non-string cases fall back to the header.
 */
export function effectiveCwdOf(
  projections: SessionProjectionsFace | undefined,
  session: unknown,
  headerCwd: string | undefined,
): string | undefined {
  if (projections !== undefined && session !== undefined) {
    const state = projections.stateOf(session, 'workingDirectory')
    if (typeof state === 'string') return state
  }
  return headerCwd
}

/** The initiator session's effective cwd (projection first, header fallback). */
export function initiatorEffectiveCwdOf(ctx: Context): string | undefined {
  const session = initiatorSessionOf(ctx)
  return effectiveCwdOf(sessionProjectionsOf(ctx), session, session?.header?.cwd)
}

/**
 * Effective sandbox mode for one remote capability call.
 *
 * Order: explicit per-call policy (escalation overlay) → `ctx.sandboxPolicy`
 * with the initiator session → fail-safe `read-only` (confined, so a missing
 * core refuses writes/spawn instead of opening SFTP; REQ-I15 still lets reads
 * degrade).
 */
export function resolveRemoteSessionMode(ctx: Context, explicit?: unknown): SandboxMode {
  const fromExplicit = sandboxModeFromPolicy(explicit)
  if (fromExplicit !== undefined) return fromExplicit
  if (typeof ctx.get === 'function') {
    const policy = ctx.get('sandboxPolicy', false) as {
      resolve?: (request?: { session?: unknown }) => unknown
    } | undefined
    if (policy !== undefined && typeof policy.resolve === 'function') {
      const session = initiatorSessionOf(ctx)
      const resolved = policy.resolve(session !== undefined ? { session } : {})
      const mode = sandboxModeFromPolicy(resolved)
      if (mode !== undefined) return mode
    }
  }
  return 'read-only'
}
