/**
 * REQ-I27 / ADR-0031 §3.2: the in-process registry that carries a confine
 * product's policy to `subprocess.spawn` — by argv OBJECT IDENTITY, never by
 * string prefix.
 *
 * Why identity: the model can type any argv text, so a prefix protocol would
 * be forgeable. Official consumers pass `confined.argv` into the spawn spec
 * BY REFERENCE (dsh-bash-sandbox `SandboxBashExecutor.confine` /
 * dsh-pwsh-sandbox / dsh-terminal-bash `spawnArgv` / dsh-ptc-runtime-node —
 * ADR-0031 §1.1), so the exact array `ctx.sandbox.confine` returned is the
 * key. A copied array intentionally loses the mark: spawn then treats it as
 * unmarked (`--sandbox off`, ADR-0031 §3.1) — no escape gain, just no fence.
 *
 * The registry is the ONLY policy channel into the remote spawn path; the
 * retired `remote-spawn-policy` ALS store existed because
 * `SubprocessSpawnSpec` has no policy field and a danger grant never calls
 * `confine` (ADR-0031 §1.3).
 *
 * @module dsh-workspace-enhancement/remote-confine-policy
 */

import type { ConfinedArgv } from '@deepseek-ai/dsh-sandbox'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

/** What a registered confine product records for the spawn side. */
export interface ConfinedSpawnMark {
  /** The `--sandbox` token the remote component must enforce. */
  readonly mode: SandboxMode
}

/**
 * Registered confine products. Weak so a dropped argv array releases its
 * mark; object-keyed so only the exact array we returned ever matches.
 */
const marks = new WeakMap<readonly string[], ConfinedSpawnMark>()

/** The remote core jail dialect (`bwrap`), kept for denial classification. */
export const REMOTE_CORE_DENIAL_SIGNATURE = 'read-only file system'

/** Non-zero exit whose stderr matches the remote core bwrap denial dialect. */
export function isRemoteCommandDenial(exitCode: number | null, stderr: string): boolean {
  if (exitCode === null || exitCode === 0) return false
  return stderr.toLowerCase().includes(REMOTE_CORE_DENIAL_SIGNATURE)
}

/**
 * Build this remote route's `ConfinedArgv` and REGISTER it: the returned
 * array is the mark (ADR-0031 §3.1 — the policy rides the object, not the
 * argv text, so the approval card still previews what the caller wrote).
 */
export function markConfinedArgv(
  argv: readonly string[],
  mark: ConfinedSpawnMark,
): ConfinedArgv {
  const product: ConfinedArgv = {
    argv: [...argv],
    enforcement: 'full',
    denialSignatures: [REMOTE_CORE_DENIAL_SIGNATURE],
    runnerFailureRules: [{ fatalSignatures: ['bwrap: '] }],
  }
  marks.set(product.argv, mark)
  return product
}

/**
 * The mark carried by one spawn's argv, or `undefined` when the argv never
 * went through {@link markConfinedArgv} — an identical-looking NEW array
 * never matches (anti-forgery, ADR-0031 §3.2).
 */
export function confinedSpawnMarkOf(argv: readonly string[] | undefined): ConfinedSpawnMark | undefined {
  if (argv === undefined) return undefined
  return marks.get(argv)
}
