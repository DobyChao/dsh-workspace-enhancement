/**
 * REQ-I9 / ADR-0022 → AUDIT-7: the remote sandbox vocabulary — pure half.
 *
 * Confinement on a remote machine is the remote component's (code name core)
 * bubblewrap jail; the session mode picks `--sandbox` (ADR-0025). This module
 * keeps what the host side still needs:
 *
 *  - the bwrap **profile tokens** the component's jail is built from, pinned
 *    against `core/profile.json` (`test/core-profile-drift.test.ts`) and, when a
 *    deployed `@deepseek-ai/dsh-sandbox-local` is on the machine, against
 *    upstream `bwrapProfileArgs` (`test/remote-sandbox-drift.test.ts`);
 *  - the fail-closed refusal: {@link REMOTE_SANDBOX_UNAVAILABLE},
 *    {@link REMOTE_SANDBOX_MESSAGES}, {@link RemoteSandboxError}.
 *
 * The host-side wrap (`bwrap … -- argv` over plain SSH), its probe and the
 * per-machine `remoteSandbox` field were removed in AUDIT-7.
 *
 * Honest boundary: the profile is file effects only — no network namespace,
 * no `--clearenv`, no syscall filtering.
 *
 * @module dsh-workspace-enhancement/remote-sandbox
 */

/* ------------------------------------------------------------------ mode */

/** A fence mode as the refusal texts name it (`off` = unconfined). */
export type RemoteSandboxMode = 'off' | 'read-only' | 'workspace-write'

/** The confined subset of {@link RemoteSandboxMode}. */
export type RemoteSandboxConfinementMode = Exclude<RemoteSandboxMode, 'off'>

/* --------------------------------------------------------- profile vector */

/** One file-effect policy as the bwrap profile builder reads it. */
export interface RemoteSandboxPolicy {
  mode: RemoteSandboxConfinementMode
  /** Absolute POSIX path bound read-write in `workspace-write` mode. */
  workspaceRoot?: string
}

/**
 * The `read-only` profile, byte-for-byte upstream
 * `bwrapProfileArgs({mode:'read-only'})`: a read-only bind of `/`, a fresh
 * `/dev`, a private PID namespace, `/proc`, `--die-with-parent`.
 *
 * Deliberately absent (do not "helpfully" add): `--unshare-net`,
 * `--clearenv`, `--chdir`, `--new-session`, seccomp.
 */
export const REMOTE_BWRAP_PROFILE_READ_ONLY: readonly string[] = Object.freeze([
  '--ro-bind', '/', '/',
  '--dev', '/dev',
  '--unshare-pid',
  '--proc', '/proc',
  '--die-with-parent',
])

/**
 * The tokens `workspace-write` appends after the read-only prefix (before the
 * workspace `--bind`). Order matters and is pinned by the tests.
 */
export const REMOTE_BWRAP_PROFILE_WRITE_EXTRA: readonly string[] = Object.freeze([
  '--tmpfs', '/tmp',
])

/**
 * A non-empty, NUL/newline-free, `/`-rooted POSIX path — the only shape a
 * `--bind` source may take. A shape guard, not a security boundary.
 */
export function isUsableRemoteWorkspaceRoot(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && value.length > 1
    && !value.includes('\0')
    && !value.includes('\n')
    && !value.includes('\r')
}

/** The first usable candidate as the remote workspace root, else `undefined`. */
export function resolveRemoteWorkspaceRoot(
  ...candidates: readonly (string | undefined)[]
): string | undefined {
  return candidates.find(isUsableRemoteWorkspaceRoot)
}

/**
 * The bwrap profile vector for one policy (the drift tests compare it with
 * upstream and with `core/profile.json`).
 * @throws {RemoteSandboxPolicyError} when `workspace-write` has no usable root.
 */
export function remoteProfileArgs(policy: RemoteSandboxPolicy): string[] {
  const args = [...REMOTE_BWRAP_PROFILE_READ_ONLY]
  if (policy.mode !== 'workspace-write') return args
  const root = resolveRemoteWorkspaceRoot(policy.workspaceRoot)
  if (root === undefined) throw new RemoteSandboxPolicyError(REMOTE_SANDBOX_MESSAGES.workspaceRootRequired)
  args.push(...REMOTE_BWRAP_PROFILE_WRITE_EXTRA)
  args.push('--bind', root, root)
  return args
}

/* ----------------------------------------------------------- reporting */

/**
 * The fail-closed error code, copied from `@deepseek-ai/dsh-sandbox`
 * (`SANDBOX_UNAVAILABLE`) so this module stays host-free.
 */
export const REMOTE_SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE'

/**
 * MODEL-facing English constants (ADR-0014: model text is a constant, not a
 * locale entry — it surfaces inside tool results).
 */
export const REMOTE_SANDBOX_MESSAGES = {
  unavailable:
    'sandbox mode "{mode}" is requested but the remote component cannot confine this command; refusing to run it unconfined.',
  /** `{detail}` is the cause (missing component, no registry route, …). */
  detail: 'Cause: {detail}',
  /**
   * Appended when the detail names the component binary: `core-client`
   * reports the remote shell's `…/dsh-core: No such file or directory`.
   */
  coreMissing:
    'The fenced core is not installed on the remote (or its directory was removed) — re-run sw_connect to redeploy it (or use the plugin settings / core.deploy) and retry; a core session that is still running is stale once its directory is gone.',
  /**
   * REQ-I17 version gate: group kill (BUG-9) and the CAS version hash (BUG-7)
   * live in the component, so a stale binary is an unfixed fence.
   */
  coreVersionMismatch:
    'The fenced core on the remote reports version "{found}" but this plugin needs the {expected} line (major.minor must match; patch drift is fine) — re-run sw_connect to redeploy the matching core (or use the plugin settings / core.deploy) and retry.',
  /** REQ-I17 provenance gate: the on-disk sha256 must be one this plugin shipped. */
  coreProvenance:
    'The fenced core binary on the remote (sha256 {found}) is not one this plugin shipped — refusing to trust it as the fence; re-run sw_connect to redeploy the official core, or remove the foreign ~/.dsh-core.',
  /** `workspace-write` without a usable absolute remote workspace root. */
  workspaceRootRequired:
    'remote sandbox refused: mode "workspace-write" requires an absolute remote workspace root to bind, and none was resolved; refusing to run the command unconfined',
  /** ADR-0022 §2.4: a confined session never opens an unfenced PTY. */
  terminalUnsupported:
    'remote sandbox refuses to open an interactive terminal: mode "{mode}" cannot fence a PTY session, and an unfenced terminal would be dishonest',
} as const

/**
 * The fence's refusal, carrying {@link REMOTE_SANDBOX_UNAVAILABLE}. Distinct
 * from the approval gate's `RemoteGateError`: "the policy denied this" and
 * "this host cannot confine the command" are different facts.
 */
export class RemoteSandboxError extends Error {
  /** Always {@link REMOTE_SANDBOX_UNAVAILABLE}. */
  readonly code: string

  constructor(message: string, code: string = REMOTE_SANDBOX_UNAVAILABLE) {
    super(message)
    this.name = 'RemoteSandboxError'
    this.code = code
  }
}

/** A plugin-side policy refusal raised before anything reaches SSH. */
export class RemoteSandboxPolicyError extends RemoteSandboxError {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteSandboxPolicyError'
  }
}

/** Interpolate `{name}` placeholders (same rule as the locale lookup). */
export function interpolate(text: string, params: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/** Stderr shapes that mean "the program is not installed at all". */
const MISSING_PROGRAM_SIGNATURES = [
  'no such file or directory',
  'command not found',
  'not found',
  'exit 127',
  'exit code 127',
  'exited 127',
]

/**
 * The deploy hint when the detail says the component binary is missing;
 * `undefined` otherwise (a wrong hint is worse than none).
 */
export function coreMissingHint(detail: string | undefined): string | undefined {
  if (detail === undefined || detail === '') return undefined
  const lowered = detail.toLowerCase()
  if (!MISSING_PROGRAM_SIGNATURES.some(signature => lowered.includes(signature))) return undefined
  return lowered.includes('dsh-core') ? REMOTE_SANDBOX_MESSAGES.coreMissing : undefined
}

/**
 * The refusal raised when a confined mode cannot be enforced. Fail closed:
 * the caller must not fall back to an unconfined command.
 */
export function remoteSandboxUnavailableError(
  mode: RemoteSandboxConfinementMode,
  detail?: string,
): RemoteSandboxError {
  const parts: string[] = [interpolate(REMOTE_SANDBOX_MESSAGES.unavailable, { mode })]
  if (detail !== undefined && detail !== '') parts.push(interpolate(REMOTE_SANDBOX_MESSAGES.detail, { detail }))
  const hint = coreMissingHint(detail)
  if (hint !== undefined) parts.push(hint)
  return new RemoteSandboxError(parts.join(' '))
}
