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

/**
 * Effective sandbox mode for one remote capability call.
 *
 * Order: explicit per-call policy (escalation overlay) → `ctx.sandboxPolicy`
 * with the initiator session → fail-safe `read-only` (confined, so a missing
 * core refuses instead of opening SFTP).
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
