/**
 * REQ-I13 / ADR-0025 → REQ-I27 / ADR-0031 §3: on a remote initiator cwd,
 * `confine` becomes the POLICY CARRIER — it registers its product in the
 * in-process registry (`remote-confine-policy.ts`) and returns the argv
 * unchanged (the remote component's jail enforces the mode, not a host
 * wrapper). `spawn` then reads the mark by argv identity; an unmarked argv
 * runs `--sandbox off` (ADR-0031 §3.1, owner-accepted narrowing).
 *
 * Official bash/fs escalation happens *before* confine; a danger grant skips
 * confine entirely, which is exactly why the mark — not the session mode —
 * is the spawn-side truth (BUG-12's root cause retires with this).
 *
 * @module dsh-workspace-enhancement/remote-confine
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { initiatorEffectiveCwdOf, resolveRemoteSessionMode, sandboxModeFromPolicy } from './remote-policy.ts'
import { currentShellWorkdir, isHostLocalShellExec } from './remote-spawn-policy.ts'
import { widenPolicyToSideRoot } from './side-root-policy.ts'
import { remoteRouteFromCwd } from './transport.ts'
import { markConfinedArgv, REMOTE_CORE_DENIAL_SIGNATURE, isRemoteCommandDenial } from './remote-confine-policy.ts'

export { REMOTE_CORE_DENIAL_SIGNATURE, isRemoteCommandDenial }

interface ConfineHost {
  confine(argv: readonly string[], policy: SandboxPolicy, ...rest: unknown[]): ConfinedArgv
}

const patched = new WeakSet<object>()

/**
 * True when the current initiator session's cwd is a remote route (`ssh://`
 * or a placeholder tree). Missing initiator → false (local is the safe default).
 */
export function shouldPassthroughRemoteConfine(ctx: Context): boolean {
  if (isHostLocalShellExec()) return false
  const cwd = initiatorEffectiveCwdOf(ctx)
  return remoteRouteFromCwd(cwd) !== null
}

function patchSandbox(owner: Context): void {
  if (typeof owner.get !== 'function') return
  const sandbox = owner.get('sandbox', false) as ConfineHost | undefined
  if (sandbox === undefined || typeof sandbox.confine !== 'function') return
  if (patched.has(sandbox)) return
  patched.add(sandbox)
  const original = sandbox.confine.bind(sandbox)
  sandbox.confine = (argv, policy, ...rest) => {
    if (shouldPassthroughRemoteConfine(owner)) {
      // REQ-I27: the mark IS the policy channel. The call's policy (session
      // mode + any one-shot grant, merged by the official consumer) names the
      // mode the remote component will enforce.
      const mode = sandboxModeFromPolicy(policy) ?? resolveRemoteSessionMode(owner)
      return markConfinedArgv(argv, { mode })
    }
    // REQ-I24: a command whose cwd is in a local side root gets that root.
    return original(argv, widenPolicyToSideRoot(owner, policy, currentShellWorkdir()), ...rest)
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
