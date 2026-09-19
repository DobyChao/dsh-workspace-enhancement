/**
 * REQ-I9 / ADR-0022: the remote sandbox fence — pure logic half.
 *
 * A per-machine axis `remoteSandbox: 'off' | 'read-only' | 'workspace-write'`
 * (default `'off'` ⇒ zero migration) asks the mixed subprocess seam's remote
 * branch to wrap every spawned command as
 * `<runner> <bwrap profile args> -- <original argv>` before it is serialised
 * into the single SSH exec string. This module owns the whole *decision* and
 * *shape* surface of that wrap; the wiring (the `resolveArgv` startup stage of
 * `SshSubprocessHandle`, the registry field, the settings form) lives in the
 * other halves and is deliberately absent here, so everything below is
 * unit-testable without a host — the same split AUDIT-6 uses (ADR-0014, and
 * see {@link module:dsh-workspace-enhancement/remote-approval-gate}).
 *
 * ## Provenance of the profile vector (this is the drift risk)
 *
 * The tokens below are a LOCAL RE-DERIVATION of `bwrapProfileArgs(policy)` from
 * the deployed upstream provider `@deepseek-ai/dsh-sandbox-local` (read on
 * 2026-09-13 from `…/profiles/node_modules/@deepseek-ai/dsh-sandbox-local/lib/
 * index.js`, bundle region `lib/types/profiles.js`, version `0.1.5-rc.2`; see
 * `.tmp/recon/A3-remote-runner.md` §Q1(c)). It cannot be imported:
 *
 *  - `bwrapProfileArgs` is **not exported** (the package's `exports` map has
 *    only `.`, `./src/*` and `./package.json`), and
 *  - `@deepseek-ai/dsh-sandbox-local` is **not a dependency of this repo** and
 *    has no `package-lock.json` entry — adding one would desynchronise `npm ci`
 *    (the same hazard recorded for `dsh-user-approval` in the R22 report).
 *
 * The re-derivation is pinned by `test/remote-sandbox-drift.test.ts`, which
 * reads that deployed file when it exists on the machine and asserts the token
 * arrays match; on a machine without it (CI) that test reports SKIP instead of
 * failing. Upstream changing the profile is therefore a visible red on the
 * machine that has the package, never a silent divergence.
 *
 * ## Fail-closed rules encoded here (ADR-0022 §2.3)
 *
 * The fence's failure mode is "refuse", never "run it anyway":
 *
 *  - a mode other than `'off'` without a *positive* probe verdict must be
 *    refused by the wiring ({@link REMOTE_SANDBOX_UNAVAILABLE}, and
 *    {@link REMOTE_SANDBOX_MESSAGES} carries the texts);
 *  - `workspace-write` without a usable absolute remote workspace root throws
 *    here, at argv-construction time, rather than degrading to `read-only`
 *    (a silent downgrade would be a lie: the user asked for a writable
 *    workspace and would get a command that cannot write);
 *  - the probe is **functional** — {@link buildRemoteProbeCommand} runs the
 *    real `read-only` profile around `true` and requires exit 0. A missing
 *    remote `bwrap` reports `env: 'bwrap': No such file or directory` (exit
 *    127) — which does NOT match upstream's `RUNNER_FAILURE_RULES.bwrap`
 *    (`'bwrap: '`), so post-hoc stderr matching cannot carry the remote case
 *    and is **not** the mechanism (A3 §Q2 finding 1).
 *
 * ## Honest boundaries (ADR-0022 §2.7)
 *
 *  - **File tools share the core jail when fenced** (REQ-I5). `off` still uses
 *    host-side SFTP. Interactive terminals stay refused. This is reported
 *    truthfully by {@link remoteSandboxFactsOf}.
 *  - The profile is **file effects only**: no network namespace, no
 *    `--clearenv`, no `--chdir`, no syscall filtering, no process visibility
 *    outside the PID namespace.
 *  - {@link REMOTE_DENIAL_SIGNATURES} is an in-band STDERR dialect with no
 *    typed denial channel: **second-line evidence for reporting only, never
 *    enforcement.** Enforcement is the wrapped argv plus the probe.
 *
 * @module dsh-workspace-enhancement/remote-sandbox
 */

import { posix } from 'node:path'
import { BWRAP_VENDOR } from './core-vendor-pins.ts'
import { quoteShellArg } from './ssh-core.ts'

/* ------------------------------------------------------------------ mode */

/**
 * Per-machine fence mode (ADR-0022 D1). After ADR-0025 this field is leftover:
 * session `/permission` is the permission axis. The value is still normalized
 * on read so old machines.json round-trips, but routing ignores it.
 */
export type RemoteSandboxMode = 'off' | 'read-only' | 'workspace-write'

/** The subset of {@link RemoteSandboxMode} that actually builds a profile. */
export type RemoteSandboxConfinementMode = Exclude<RemoteSandboxMode, 'off'>

/**
 * Normalize an untrusted mode value onto {@link RemoteSandboxMode}. Missing,
 * `undefined`, `null`, a wrong type, a wrong string, and even a
 * correctly-spelled-but-miscased value all normalize to `'off'` — the same
 * strictness as `normalizeRemoteApproval`, so an upgrade changes nothing until
 * a machine explicitly opts in.
 *
 * @param raw - any value read from a machine record, RPC payload or form.
 * @returns the mode to use; never throws.
 */
export function normalizeRemoteSandbox(raw: unknown): RemoteSandboxMode {
  return raw === 'read-only' || raw === 'workspace-write' ? raw : 'off'
}

/** Whether this mode asks for a fence at all (the default of `'off'`). */
export function isRemoteSandboxEnabled(mode: RemoteSandboxMode): boolean {
  return mode !== 'off'
}

/* --------------------------------------------------------- profile vector */

/**
 * One file-effect policy, mirroring upstream `SandboxPolicy`'s shape as the
 * bwrap profile builder reads it (mode + workspace root).
 */
export interface RemoteSandboxPolicy {
  /** `'read-only'` or `'workspace-write'` (never `'off'` — no profile then). */
  mode: RemoteSandboxConfinementMode
  /**
   * Absolute POSIX path bound read-write in `workspace-write` mode. Required
   * there and unused in `read-only` mode. Taken from the remote cwd of the
   * spawn, matching `sw_exec`'s workdir semantics (ADR-0022 §2.5).
   */
  workspaceRoot?: string
}

/**
 * The `read-only` profile vector, byte-for-byte the tokens upstream
 * `bwrapProfileArgs({mode:'read-only'})` emits (see the module doc for
 * provenance): a read-only bind of the whole filesystem, a fresh `/dev`, a
 * private PID namespace, a `/proc` mount, and `--die-with-parent`.
 *
 * Deliberately absent (and they must not be "helpfully" added): `--unshare-net`
 * / `--unshare-all`, `--clearenv`, `--chdir`, `--new-session`, seccomp. The
 * vocabulary is file effects only, and the command's cwd/env are passed
 * through by the seam's own `cd -- … && exec env -i …` serialisation.
 */
export const REMOTE_BWRAP_PROFILE_READ_ONLY: readonly string[] = Object.freeze([
  '--ro-bind', '/', '/',
  '--dev', '/dev',
  '--unshare-pid',
  '--proc', '/proc',
  '--die-with-parent',
])

/**
 * The extra tokens `workspace-write` appends after the read-only prefix: a
 * fresh writable `/tmp`, then a read-write bind of the workspace root. Order
 * matters (upstream pushes `--tmpfs` first) and is pinned by the tests.
 */
export const REMOTE_BWRAP_PROFILE_WRITE_EXTRA: readonly string[] = Object.freeze([
  '--tmpfs', '/tmp',
])

/** The literal the reporting shape shows in place of a per-spawn workspace root. */
export const WORKSPACE_ROOT_PLACEHOLDER = '<workspace-root>'

/* ------------------------------------------------------- workspace root */

/**
 * Whether one candidate is usable as a `--bind` source for the remote fence:
 * a non-empty, NUL-free, newline-free, `/`-rooted POSIX path. A relative path
 * is rejected because the profile is evaluated by the remote shell inside the
 * spawn's cwd — the same string would mean different mounts on different hosts.
 *
 * This is a shape guard, not a security boundary (the result still goes through
 * {@link quoteShellArg} when it reaches a shell); it exists so a `--bind` can
 * never be built from junk that would make bwrap fail with a confusing message.
 *
 * @param value - candidate remote path from the registry/route.
 */
export function isUsableRemoteWorkspaceRoot(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && value.length > 1
    && !value.includes('\0')
    && !value.includes('\n')
    && !value.includes('\r')
}

/**
 * Resolve the first usable candidate as the remote workspace root, else
 * `undefined`. The wiring calls this with the remote cwd candidates of one
 * spawn; the fence then throws
 * {@link REMOTE_SANDBOX_UNAVAILABLE} rather than running unwritable.
 *
 * @param candidates - remote path candidates in priority order.
 */
export function resolveRemoteWorkspaceRoot(
  ...candidates: readonly (string | undefined)[]
): string | undefined {
  return candidates.find(isUsableRemoteWorkspaceRoot)
}

/**
 * Resolve the runner path from a machine record: a usable absolute path, or the
 * bare default. A non-absolute value cannot be honoured (the remote login shell
 * would resolve it against a `PATH` the plugin does not control), so it falls
 * back to `bwrap` — which the probe then either resolves or fails closed on.
 *
 * Note the shared shape guard: `..` segments are NOT rejected, because a
 * workspace routinely reaches its root through them; the value is quoted when
 * it reaches the shell and a wrong path fails the probe (never silently).
 *
 * @param raw - untrusted runner value (a machine-record field).
 * @param fallback - the runner to assume; defaults to
 *   {@link DEFAULT_REMOTE_RUNNER_PATH}.
 */
export function resolveRemoteRunnerPath(
  raw: unknown,
  fallback: string = DEFAULT_REMOTE_RUNNER_PATH,
): string {
  return isUsableRemoteWorkspaceRoot(raw) ? raw : fallback
}

/* ------------------------------------------------------------- argv stage */

/**
 * Build the bwrap profile vector for one policy — the local re-derivation of
 * upstream `bwrapProfileArgs(policy)` documented in the module docstring.
 *
 *  - `read-only` ⇒ {@link REMOTE_BWRAP_PROFILE_READ_ONLY};
 *  - `workspace-write` ⇒ that prefix, `--tmpfs /tmp`, then
 *    `--bind <root> <root>`.
 *
 * @param policy - the confinement mode and, for `workspace-write`, the remote
 *   workspace root.
 * @returns a fresh mutable token array (callers may concat it freely).
 * @throws {RemoteSandboxPolicyError} when `workspace-write` has no usable root
 *   — fail closed instead of silently degrading to a read-only fence.
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

/**
 * Wrap one remote argv as `<runnerPath> <profile args> -- <original argv>`.
 *
 * Shape guarantees the wiring and the approval gate depend on:
 *  - the ORIGINAL argv is preserved verbatim after the `--` terminator, in
 *    order, with nothing inserted into it (the `--` is bwrap's own
 *    end-of-options separator, so an original argv token that begins with `-`
 *    cannot be mistaken for a runner flag);
 *  - `argv[0]` of the result is the runner, exactly like upstream
 *    `ConfinedArgv.argv` (A3 §Q1a);
 *  - the result is executed by the seam's existing serialiser
 *    (`spec.argv.map(quoteShellArg).join(' ')`, `src/process.ts`
 *    `buildCommand`), so every token — including the workspace root — is
 *    POSIX single-quote escaped at the single place that already does it
 *    (AGENTS.md §5.6). This function therefore performs NO quoting itself and
 *    must never be handed to a shell directly.
 *
 * @param argv - the final remote argv, BEFORE any wrapping (the approval gate
 *   keeps seeing this one, ADR-0022 §2.2).
 * @param policy - the confinement mode + workspace root.
 * @param runnerPath - remote runner program (`bwrap`, or an explicit path).
 * @throws {RemoteSandboxPolicyError} (via {@link remoteProfileArgs}) when
 *   `workspace-write` has no usable workspace root.
 */
export function remoteRunnerArgv(
  argv: readonly string[],
  policy: RemoteSandboxPolicy,
  runnerPath: string,
): string[] {
  return [runnerPath, ...remoteProfileArgs(policy), '--', ...argv]
}

/* ---------------------------------------------------------------- probe */

/**
 * The runner program the fence assumes when a machine does not name one. The
 * upstream provider also defaults to the bare name `bwrap` and resolves it
 * through the remote login shell's `PATH`.
 */
export const DEFAULT_REMOTE_RUNNER_PATH = 'bwrap'

/**
 * Build the POSITIVE functional probe command (ADR-0022 §2.3, A3 §Q4).
 *
 * It is run through the transport's **control channel** (`connection.exec`),
 * exactly like the existing fixed probes (`uname -s`, `cmd /c ver`) — its text
 * is a plugin constant, which is the same carve-out ADR-0020 D1 grants those
 * probes; it is NOT routed through the sandboxed spawn seam.
 *
 * One login shell, four steps:
 *  1. `command -v '<runner>'` — is it resolvable at all (this answers the
 *     "installed" question only, which is explicitly NOT sufficient);
 *  2. `'<runner>' --version` — the version/health fact, tolerated to fail;
 *  3. `'<runner>' <read-only profile> -- true` — the functional check: the
 *     REAL profile around `true`, which is what upstream `defaultProbeBwrap`
 *     does. This is the step that separates "present" from "usable" (no
 *     unprivileged user namespaces, seccomp/AppArmor blocking
 *     `clone(CLONE_NEWUSER)`, a denied `--proc`, …). It must exit 0.
 *
 * Exit status is the LAST step's: a runnable runner that cannot confine exits
 * non-zero. Deliberately NOT done: redirecting that failure to stderr. sshd
 * folds stderr into the channel's extended-data stream but `ExecOutcome`
 * collects it separately from stdout, and a channel dropped mid-flight can
 * lose it — the exit code is the part that cannot be lost. The explanatory
 * text is present when it survives, and {@link parseRemoteProbe} says so when
 * it did not.
 *
 * Injection posture: the only caller-supplied value is `runnerPath`, and it is
 * quoted with the repo's POSIX quoting helper at every one of its three
 * occurrences — no interpolation path reaches the shell unquoted. The profile
 * and `command -v`/`--version`/`true` are fixed tokens. The `--` terminator
 * keeps the runner from reading `--ro-bind` as its own option.
 *
 * **The functional step quotes each argv WORD SEPARATELY, never the joined
 * vector.** Joining first and quoting the result hands the shell ONE word, so a
 * perfectly healthy host tries to exec a program literally named
 * `bwrap --ro-bind / / … -- true` and exits 127 — and because every non-zero
 * exit reads as "runner unusable", fail-closed turns that into a fence that
 * refuses every command on every host, forever. `test/remote-sandbox.test.ts`
 * tokenizes this step back into the runner argv precisely so the two cannot
 * drift apart again (self-reviewer catch, 2026-09-13).
 *
 * @param runnerPath - remote runner program; defaults to
 *   {@link DEFAULT_REMOTE_RUNNER_PATH}.
 * @returns one POSIX shell command string requiring exit 0 for a usable fence.
 */
export function buildRemoteProbeCommand(runnerPath: string = DEFAULT_REMOTE_RUNNER_PATH): string {
  const runner = quoteShellArg(runnerPath)
  const functional = remoteRunnerArgv(['true'], { mode: 'read-only' }, runnerPath)
    .map(word => quoteShellArg(word))
    .join(' ')
  return `command -v ${runner} && ${runner} --version; `
    + `command -v ${runner} > /dev/null && ${functional}`
}

/** What one probe round-trip reported. */
export interface RemoteProbeOutcome {
  /** Exit code of the probe command; `null` when it died from a signal. */
  exitCode: number | null
  /** Collected standard output. */
  stdout: string
  /** Collected standard error. */
  stderr: string
  /** Terminating signal, when the transport reports one (`ExecOutcome` has it). */
  signal?: string | null
}

/** The verdict of {@link parseRemoteProbe}. */
export interface RemoteProbeVerdict {
  /** `true` ONLY on exit 0 — the runnable verdict. Everything else fails closed. */
  ok: boolean
  /** The runner's version text, when it was readable. */
  version?: string
  /** Diagnostic detail (never a success signal; display/audit only). */
  detail?: string
}

/**
 * bwrap's `--version` line, e.g. `bubblewrap 0.8.0`. Strict on purpose: the
 * version is a REPORTING fact, and a garbage capture must not be reported as a
 * version.
 */
const BWRAP_VERSION = /\bbubblewrap\s+v?(\d+\.\d+(?:\.\d+)?)/i

/** Any semver-looking token — the fallback when stderr/stdout interleaved. */
const LOOSE_VERSION = /\bv?(\d+\.\d+(?:\.\d+)?)\b/

/** Cap of the diagnostic detail a verdict carries (audit-friendly, short). */
export const REMOTE_PROBE_DETAIL_MAX_CHARS = 240

/** Collapse whitespace and cap one diagnostic string. */
function condense(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= REMOTE_PROBE_DETAIL_MAX_CHARS
    ? collapsed
    : `${collapsed.slice(0, REMOTE_PROBE_DETAIL_MAX_CHARS)}…`
}

/**
 * Parse one probe round-trip into a verdict. **Exit status is the only success
 * signal** — output is never trusted to say "usable" (a page of help text on a
 * non-zero exit is still a failure). Fail-closed in every direction:
 *
 * | outcome                      | verdict                       |
 * |------------------------------|-------------------------------|
 * | `exitCode === 0`             | `ok` (+ `version` if readable) |
 * | non-zero exit, any output    | `!ok`, `detail` from stderr, else stdout |
 * | `exitCode === null` (signal) | `!ok`, detail names the signal/death |
 * | empty output on failure      | `!ok` with an explicit "no diagnostic" note |
 *
 * A readable `version` is attached to a FAILING verdict too — "bwrap 0.8.0 is
 * installed but cannot create a namespace" is exactly the fact an operator
 * needs. The version is read from stderr first on a non-zero exit (bwrap
 * diagnoses on stderr), so an unrelated version-shaped token on stdout cannot
 * masquerade as the runner's version.
 *
 * @param outcome - the control-channel result for
 *   {@link buildRemoteProbeCommand}.
 */
export function parseRemoteProbe(outcome: RemoteProbeOutcome): RemoteProbeVerdict {
  const stdout = outcome.stdout ?? ''
  const stderr = outcome.stderr ?? ''
  if (outcome.exitCode === 0) {
    const version = remoteRunnerVersionOf(stdout, stderr)
    return version !== undefined ? { ok: true, version } : { ok: true }
  }
  const detail = condense(stderr) || condense(stdout)
  // On a non-zero exit only the argument ORDER changes: bwrap's diagnostics go
  // to stderr and a non-zero exit has nothing useful on stdout, so stderr is
  // examined first — otherwise an unrelated version-shaped token on stdout
  // ("0.1" inside a path) would be reported as a version for a runner that
  // just failed.
  const version = outcome.exitCode === null ? undefined : remoteRunnerVersionOf(stderr, stdout)
  if (detail === '') {
    const ending = outcome.exitCode === null
      ? `probe did not complete (signal: ${outcome.signal ?? 'unknown'})`
      : `probe exited ${outcome.exitCode} with no diagnostic output`
    return version !== undefined ? { ok: false, version, detail: ending } : { ok: false, detail: ending }
  }
  return version !== undefined ? { ok: false, version, detail } : { ok: false, detail }
}

/**
 * The version stdout/stderr reported for the runner, if readable. bwrap's own
 * wording wins; a lone semver token in output that did not match it is
 * accepted as a fallback because stdout and stderr share one exec channel and
 * can interleave. Returns `undefined` rather than a guess.
 */
export function remoteRunnerVersionOf(stdout: string, stderr: string): string | undefined {
  for (const text of [stdout, stderr]) {
    const strict = BWRAP_VERSION.exec(text)
    if (strict?.[1] !== undefined) return strict[1]
  }
  for (const text of [stdout, stderr]) {
    const loose = LOOSE_VERSION.exec(text)
    if (loose?.[1] !== undefined) return loose[1]
  }
  return undefined
}

/* ----------------------------------------------------------------- cache */

/** A cached probe verdict, keyed by the identity of the connection it probed. */
export interface RemoteSandboxCache {
  /** The verdict for this exact connection object, or `undefined`. */
  get(connection: unknown): RemoteProbeVerdict | undefined
  /** Record a verdict for this exact connection object. */
  set(connection: unknown, verdict: RemoteProbeVerdict): void
}

/**
 * Create a process-local probe cache. Keyed by connection **object identity**
 * (not by id), so a rebuilt connection re-probes — the `createRemoteOsCache`
 * pattern from `src/exec-tools.ts`, which is the established precedent for a
 * capability probe with no persisted field (A3 §Q4).
 *
 * Deliberately not here: the probe **call** itself (it needs the live
 * connection and is async network I/O) and any in-flight deduplication. The
 * wiring slice owns both; this module stays pure.
 */
export function createRemoteSandboxCache(): RemoteSandboxCache {
  const store = new Map<unknown, RemoteProbeVerdict>()
  return {
    get(connection) {
      return store.get(connection)
    },
    set(connection, verdict) {
      store.set(connection, verdict)
    },
  }
}

/* --------------------------------------------------------- denial dialect */

/**
 * The read-only-filesystem denial signatures of the bwrap dialect: the
 * case-insensitive stderr substrings a DENIED file effect produces under the
 * profile above. Mirrors upstream `DENIAL_SIGNATURES.bwrap` exactly
 * (`['read-only file system']`).
 *
 * **Second-line evidence, NOT enforcement** (ADR-0022 D3, A3 §Q4): bwrap has no
 * typed denial channel, so a denial is only ever visible as in-band stderr
 * text. Nothing in this module decides whether a command runs based on this
 * list — the wrapped argv and the positive probe do that. The list exists so
 * the tool layer can report `[sandbox: file access denied under <mode> mode]`
 * honestly instead of showing a bare `EROFS` to the model.
 *
 * Deliberately narrow: the landlock/seatbelt/windows signatures
 * (`'permission denied'`, `'operation not permitted'`, `'access is denied'`) are
 * NOT merged in, because the fence wraps with a single named runner and a wide
 * dialect would mislabel ordinary application errors as sandbox denials.
 */
export const REMOTE_DENIAL_SIGNATURES: readonly string[] = Object.freeze([
  'read-only file system',
])

/**
 * Whether one piece of remote output carries a denial signature. Case
 * insensitive, substring — the same matching rule upstream documents for
 * `ConfinedArgv.denialSignatures`.
 *
 * @param text - the command's stderr (or any output to inspect).
 * @returns `true` when the text looks like a fence denial; `false` is NOT
 *   evidence that the command ran unconfined.
 */
export function isRemoteDenialText(text: string): boolean {
  const lowered = String(text).toLowerCase()
  return REMOTE_DENIAL_SIGNATURES.some(signature => lowered.includes(signature))
}

/* ----------------------------------------------------------- reporting */

/**
 * The fail-closed error code, copied from `@deepseek-ai/dsh-sandbox`
 * (`const SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE"`, carried by
 * `SandboxUnavailableError extends HarnessError`). Copied rather than imported
 * so this module stays host-free and unit-testable; the wiring may raise the
 * real upstream error class with the same code and text.
 */
export const REMOTE_SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE'

/**
 * MODEL-facing English constants (ADR-0014: model text is a constant, not a
 * locale-dictionary entry — it surfaces inside tool results and deliberately
 * does not follow the UI language; human-facing labels belong to
 * `src/locale/**`, which the wiring slice owns).
 */
export const REMOTE_SANDBOX_MESSAGES = {
  /**
   * The `{mode}` line, widened for the remote world: upstream
   * `SandboxUnavailableError` names local backends (bubblewrap on PATH, a
   * Landlock kernel, `sandbox-exec`, the Windows ACL runner), none of which is
   * actionable advice when the missing fence is on the far side of an SSH
   * connection. This module builds its own text; the wiring may instead pass
   * the detail below to the upstream error class and let that one compose.
   */
  unavailable:
    'sandbox mode "{mode}" is requested but no remote sandbox runner is usable on this host; refusing to run the command unconfined.',
  /** Probe failed ⇒ the fence never ran a command. `{detail}` is the stderr. */
  probeFailed:
    'Runner failure: remote sandbox probe failed; no command text was sent — {detail}',
  /**
   * Appended to a probe failure whose stderr says the runner is absent (INFRA-15:
   * bubblewrap is never redistributed — there is no upstream binary release — so
   * the remote must install it from its own package manager). `{hints}` is the
   * per-distro command list; the last clause is the honest escape hatch.
   */
  runnerMissing:
    'The remote has no bubblewrap — install it on that host ({hints}), or re-run this work with sandbox mode "danger-full-access" (the fence is then gone).',
  /**
   * Appended when the detail names OUR OWN binary instead of the runner: a
   * fenced session needs the core, and `core-client` reports the remote shell's
   * `…/dsh-core: No such file or directory` verbatim. That is a deploy problem
   * ("install the core"), never a bubblewrap problem — the first cut of the
   * runner hint matched on the generic not-found phrase and told the operator to
   * apt-get bubblewrap for a core that had simply been deleted (2026-09-17).
   */
  coreMissing:
    'The fenced core is not installed on the remote (or its directory was removed) — deploy it from the plugin settings (core.deploy) and retry; a core session that is still running is stale once its directory is gone.',
  /** `workspace-write` without a usable absolute remote workspace root. */
  workspaceRootRequired:
    'remote sandbox refused: mode "workspace-write" requires an absolute remote workspace root to bind, and none was resolved; refusing to run the command unconfined',
  /**
   * `spawnTerminal` under a fence (ADR-0022 §2.4): the interactive PTY path is
   * refused rather than left unfenced — `/dev/tty` under `--dev /dev` without
   * `--new-session` is unverified (A3 §Q2 caveat 3).
   */
  terminalUnsupported:
    'remote sandbox refuses to open an interactive terminal: mode "{mode}" cannot fence a PTY session, and an unfenced terminal would be dishonest',
  /** The two coverage boundaries, quoted verbatim into tool/status output. */
  boundaryFsWrites:
    'the remote sandbox fences commands and file writes through one jailed core; reads fall back to SFTP when that core is missing (writes and spawn still refuse)',
  boundaryFileEffects:
    'the remote sandbox profile is file effects only: no network isolation, no environment scrubbing, no syscall filtering',
} as const

/**
 * The fence's refusal, carrying {@link REMOTE_SANDBOX_UNAVAILABLE}. Distinct
 * from the approval gate's `RemoteGateError` on purpose: "the approval policy
 * denied this" and "this host cannot confine the command" are different facts
 * for the model and the operator.
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

/**
 * The argv-construction refusal (a plugin-side policy failure, raised before
 * anything reaches SSH). Derived from {@link RemoteSandboxError} so one
 * `instanceof` catches every fence refusal.
 */
export class RemoteSandboxPolicyError extends RemoteSandboxError {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteSandboxPolicyError'
  }
}

/** Interpolate `{name}` placeholders (same rule as the locale lookup). */
function interpolate(text: string, params: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/** Stderr shapes that mean "the runner binary is not installed at all". */
const RUNNER_MISSING_SIGNATURES = [
  'no such file or directory',
  'command not found',
  'not found',
  'exit 127',
  'exit code 127',
  'exited 127',
]

/**
 * The actionable hint for a refusal whose detail names a missing program.
 *
 * Two very different remedies share the generic "No such file or directory"
 * phrasing, so the detail decides which one applies: a mention of `dsh-core` is
 * OUR artifact (deploy it), a mention of the runner program is the third-party
 * fence binary (install it on the remote). Anything else gets no hint — a wrong
 * hint is worse than none.
 *
 * @param detail - the probe/refusal detail line.
 * @param runnerPath - the runner program that was probed.
 * @returns the hint sentence, or undefined when the detail names neither.
 */
export function fenceMissingHint(
  detail: string | undefined,
  runnerPath: string = DEFAULT_REMOTE_RUNNER_PATH,
): string | undefined {
  if (detail === undefined || detail === '') return undefined
  const lowered = detail.toLowerCase()
  if (!RUNNER_MISSING_SIGNATURES.some(signature => lowered.includes(signature))) return undefined
  if (lowered.includes('dsh-core')) return REMOTE_SANDBOX_MESSAGES.coreMissing
  const runner = posix.basename(runnerPath).toLowerCase()
  if (runner !== '' && lowered.includes(runner)) {
    return interpolate(REMOTE_SANDBOX_MESSAGES.runnerMissing, {
      hints: BWRAP_VENDOR.installHints.join('; '),
    })
  }
  return undefined
}

/**
 * The refusal the wiring raises when a fenced mode has no positive probe
 * verdict. Fail closed: the caller must not fall back to an unwrapped command.
 *
 * @param mode - the requested confinement mode.
 * @param detail - the probe's stderr/detail line, when there was one.
 */
export function remoteSandboxUnavailableError(
  mode: RemoteSandboxConfinementMode,
  detail?: string,
): RemoteSandboxError {
  const base = interpolate(REMOTE_SANDBOX_MESSAGES.unavailable, { mode })
  const hint = fenceMissingHint(detail)
  const parts = [base]
  if (detail !== undefined && detail !== '') {
    parts.push(interpolate(REMOTE_SANDBOX_MESSAGES.probeFailed, { detail }))
  }
  if (hint !== undefined) parts.push(hint)
  return new RemoteSandboxError(parts.join(' '))
}

/** The tool-layer reporting shape of one mode (`sw_status`-style output). */
export interface RemoteSandboxFacts {
  /** The normalized mode. */
  mode: RemoteSandboxMode
  /** Whether spawned commands get a runner wrapper at all. */
  wrapsSpawn: boolean
  /** The profile tokens, or `[]` for `'off'`. */
  profileArgs: readonly string[]
  /** `'full'` for a wrapped mode (upstream asserts the same), `'none'` for `'off'`. */
  enforcement: 'full' | 'none'
  /**
   * The honest coverage booleans. Every one of these is part of the report so
   * a reader cannot mistake the fence for more than it is.
   */
  covers: {
    /** Model-initiated `spawn` commands. */
    readonly spawnedCommands: boolean
    /** Interactive `spawnTerminal` sessions — refused under a fence in v1. */
    readonly interactiveTerminals: boolean
    /** fs writes — covered by the core RPC jail when the mode is fenced. */
    readonly fsWrites: boolean
    /** Network egress — never covered. */
    readonly network: boolean
    /** The plugin's own fixed probes (control channel). */
    readonly hostProbes: boolean
  }
  /** Denial dialect (second-line reporting only). */
  readonly denialSignatures: readonly string[]
  /** The human-readable boundary notes, ready to print. */
  readonly boundaries: readonly string[]
}

/**
 * Report what one mode does and does not cover. For `'workspace-write'` the
 * report carries the per-spawn `--bind` root as the literal placeholder
 * `<workspace-root>`, so this is a REPORTING shape and never a source of argv
 * — the only argv builder is {@link remoteRunnerArgv}, which refuses to guess a
 * root.
 *
 * @param mode - any normalized {@link RemoteSandboxMode}.
 */
export function remoteSandboxFactsOf(mode: RemoteSandboxMode): RemoteSandboxFacts {
  const enabled = mode !== 'off'
  const profile = enabled
    ? mode === 'workspace-write'
      ? [
          ...remoteProfileArgs({ mode: 'read-only' }),
          ...REMOTE_BWRAP_PROFILE_WRITE_EXTRA,
          '--bind', WORKSPACE_ROOT_PLACEHOLDER, WORKSPACE_ROOT_PLACEHOLDER,
        ]
      : remoteProfileArgs({ mode })
    : []
  return {
    mode,
    wrapsSpawn: enabled,
    profileArgs: profile,
    enforcement: enabled ? 'full' : 'none',
    covers: {
      spawnedCommands: enabled,
      interactiveTerminals: false,
      fsWrites: enabled,
      network: false,
      hostProbes: false,
    },
    denialSignatures: enabled ? REMOTE_DENIAL_SIGNATURES : [],
    boundaries: enabled ? [REMOTE_SANDBOX_MESSAGES.boundaryFsWrites, REMOTE_SANDBOX_MESSAGES.boundaryFileEffects] : [],
  }
}
