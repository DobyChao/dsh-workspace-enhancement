/**
 * REQ-I13 / ADR-0025: wrap `ctx.sandbox.confine` so a remote initiator cwd
 * does not get a *local* bwrap/landlock runner stuffed into argv.
 *
 * Official bash/fs escalation happens *before* confine. This passthrough only
 * skips host wrapping; it does not skip the approval card.
 *
 * @module dsh-workspace-enhancement/remote-confine
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { initiatorSessionOf } from './remote-policy.ts'
import { isHostLocalShellExec } from './remote-spawn-policy.ts'
import { remoteRouteFromCwd } from './transport.ts'

interface ConfineHost {
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
}

const patched = new WeakSet<object>()

/**
 * Remote core jail is bubblewrap. Official bash classifies a denial only when
 * `confine` advertises this dialect (`Read-only file system` on stderr).
 */
export const REMOTE_CORE_DENIAL_SIGNATURE = 'read-only file system'

/** Non-zero exit whose stderr matches the remote bwrap denial dialect. */
export function isRemoteCommandDenial(exitCode: number | null, stderr: string): boolean {
  if (exitCode === null || exitCode === 0) return false
  return stderr.toLowerCase().includes(REMOTE_CORE_DENIAL_SIGNATURE)
}

/**
 * Identity argv for a remote session: the host runner must not wrap the
 * command, but the denial dialect stays the remote core's bwrap text so
 * official bash/pwsh still append the escalation hint.
 */
export function passthroughConfinedArgv(argv: readonly string[]): ConfinedArgv {
  return {
    argv: [...argv],
    enforcement: 'full',
    denialSignatures: [REMOTE_CORE_DENIAL_SIGNATURE],
    runnerFailureRules: [{ fatalSignatures: ['bwrap: '] }],
  }
}

/**
 * True when the current initiator session's cwd is a remote route (`ssh://`
 * or a placeholder tree). Missing initiator → false (local is the safe default).
 */
export function shouldPassthroughRemoteConfine(ctx: Context): boolean {
  if (isHostLocalShellExec()) return false
  const cwd = initiatorSessionOf(ctx)?.header?.cwd
  return remoteRouteFromCwd(cwd) !== null
}

function patchSandbox(owner: Context): void {
  if (typeof owner.get !== 'function') return
  const sandbox = owner.get('sandbox', false) as ConfineHost | undefined
  if (sandbox === undefined || typeof sandbox.confine !== 'function') return
  if (patched.has(sandbox)) return
  patched.add(sandbox)
  const original = sandbox.confine.bind(sandbox)
  sandbox.confine = (argv, policy) => {
    if (shouldPassthroughRemoteConfine(owner)) return passthroughConfinedArgv(argv)
    return original(argv, policy)
  }
}

/**
 * Install the remote-cwd confine short-circuit on the live `sandbox` service.
 * Safe to call when the name is not yet provided (`inject` waits).
 */
export function installRemoteConfinePassthrough(ctx: Context): void {
  patchSandbox(ctx)
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['sandbox'], (owner) => { patchSandbox(owner) })
}
