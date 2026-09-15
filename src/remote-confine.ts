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
import { remoteRouteFromCwd } from './transport.ts'

interface ConfineHost {
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
}

const patched = new WeakSet<object>()

/** Identity confine result: the caller's argv, claimed as fully enforced. */
export function passthroughConfinedArgv(argv: readonly string[]): ConfinedArgv {
  return {
    argv: [...argv],
    enforcement: 'full',
    denialSignatures: [],
    runnerFailureRules: [],
  }
}

/**
 * True when the current initiator session's cwd is a remote route (`ssh://`
 * or a placeholder tree). Missing initiator → false (local is the safe default).
 */
export function shouldPassthroughRemoteConfine(ctx: Context): boolean {
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
