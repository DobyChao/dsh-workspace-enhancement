/**
 * Model-facing prompt text — ENGLISH ONLY, deliberately outside the `dsw`
 * locale dictionary.
 *
 * These strings are read by the MODEL, not by a human reader: the system-prompt
 * workspace sections (`sw-remote`, `tool:sw-exec`, `tool:bash`) and the remote
 * tool-output hint of `sw_status`. A model has no locale preference, and the
 * same session is frequently served to both a Chinese-UI and an English-UI
 * operator; making the prompt follow the UI language would change the model's
 * instructions with the operator's display setting and would mix languages in
 * one conversation.
 *
 * Hence the split this module encodes (see `docs/decisions/ADR-0014`):
 * - human-facing copy (client UI, and host messages a user reads) → `src/locale/`
 *   (`dsw` namespace, zh + en, key sets kept strictly equal by the static gate);
 * - model-facing copy (system-prompt sections and model tool output) → here,
 *   one English value, no `t()` lookup, no per-language variant.
 *
 * Template parameters use the same `{name}` placeholders as the dictionary and
 * are interpolated by {@link interpolate} (a placeholder whose name is absent
 * from `params` is kept verbatim, matching the framework's rule). Values carry
 * leaf facts only — never secrets.
 * @module dsh-workspace-enhancement/model-prompts
 */

/** The English prompt copy this plugin injects into a model's system prompt. */
export const MODEL_PROMPTS = {
  /** R4 remote emphasis paragraph (`sw-remote` section, order 90). */
  remoteEmphasis:
    '⚠ Your current workspace is a **remote SSH workspace**: `{endpoint}:{displayPath}` (routed through the local placeholder path `{placeholderRoot}\\{connectionId}\\…`; the placeholder path you see is only a routing alias — **all commands and file operations truly happen on the remote server**, and the working directory is a POSIX absolute path).',
  /** One side-workspace line (REQ-I7: declaration only, no permission marks). */
  sideItem: '- Side workspace **{label}**: `{rootKey}`',
  /** Side-workspace list heading (R5). */
  sideHeading: '**Extra workspaces linked to this session (side directories the model can operate on directly)**:',
  /** Side-workspace boundary note, tier-free since REQ-I7 (ADR-0019). */
  sideNote:
    'A side workspace is an extra directory this session can operate on directly. Commands run in the main workspace by default; to run a command on another server use `sw_exec(server, command)`.',
  /**
   * REQ-I11: heading of the per-session CONNECTED-MACHINE list (`sw-remote`
   * section). The list is the session's coarse gate made visible: the store
   * holds exactly the registry ids `sw_connect` (or the panel) switched on.
   */
  connectedHeading: '**Machines connected to this session (`sw_exec` targets)**:',
  /** REQ-I11: one connected-machine line — id, endpoint, honest reachability. */
  connectedItem: '- `{id}` — {endpoint}{note}',
  /** REQ-I11: the note appended to a machine that did not answer its ping. */
  connectedUnreachable: ' (was unreachable at connect time)',
  /** `sw_status` remote-toolbox report heading. */
  envHeading: 'Remote environment:',
  /** `sw_status` hint when the remote toolbox is incomplete (never auto-installs). */
  envMissing:
    'Hint: the remote is missing {missing}. Interactive terminals still need bash or pwsh on the host. Search/glob on a fenced machine uses the bundled rg inside the core — deploy the core from Settings (core.deploy); do not apt-get install ripgrep for that path.',
  envCore:
    'Remote environment:\n  core: {version} ({arch})\n  caps: {caps}',
  envCoreMissing:
    'Remote environment:\n  core: not installed ({detail})\n  Deploy the fenced core from Settings (core.deploy) before using a fenced machine.',
  /**
   * `tool:sw-exec` section (order 105) — injected only in a remote-context
   * session. REQ-I11 adds the session gate: `sw_exec` names a machine that is
   * CONNECTED to this session (or the session's main-workspace machine), so the
   * copy states the precondition instead of leaving the model to discover it.
   */
  sectionSwExec:
    "sw_exec executes a command on the specified server. The server must be connected to this session: use an id from the connected-machine list, or call sw_connect first. workdir defaults to that server's primary workspace. Check the [exit code: N] marker of each result; investigate non-zero exits before continuing.",
  /** `tool:bash` section (order 105, win32 hosts) — injected only in a remote-context session. */
  sectionWin32Bash:
    'The bash tool targets remote Linux workspaces; use pwsh for local (Windows) sessions. Check the [exit code: N] marker of each result.',
  /**
   * AUDIT-6 route-D honesty sentence (`sw-remote` section): injected in EVERY
   * remote-main-workspace session. Remote commands are not confined by the
   * local sandbox — `forceRemoteSandboxMode` pinning remote sessions to
   * full access is same-world contract behavior, stated to the model as-is
   * (ADR-0020 D6).
   */
  remoteNoSandbox:
    'Remote execution is not confined by the local sandbox: commands run with the remote OS account\'s permissions only.',
  /**
   * AUDIT-6 gate-expectation sentence (`sw-remote` section): injected only
   * when the session's main-workspace machine has `remoteApproval !== 'off'`.
   * Manages the model's expectation of denials so a rejected command is not
   * retried unchanged (ADR-0020 D6).
   */
  remoteGateActive:
    'Commands on this machine additionally require an approval decision before they run; do not retry a rejected command unchanged.',
  /**
   * REQ-I5 fence sentence (`sw-remote` section): injected only when the routed
   * machine has `remoteSandbox !== 'off'`. Commands AND file tools share one
   * jailed core; a missing core fails closed (`SANDBOX_UNAVAILABLE`) instead of
   * falling back to SFTP.
   */
  remoteFenced:
    'Additionally, this machine runs commands and file tools inside a remote sandbox fence (`{mode}`): writes outside the allowed roots are refused by the core, and if that core is missing or unusable both file tools and commands FAIL (`SANDBOX_UNAVAILABLE`) instead of running unfenced. Interactive terminals stay refused while the fence is on.',
  /** REQ-I9: the per-machine note appended to a connected machine that is fenced. */
  connectedFenced: ' (commands and file tools fenced: {mode})',
} as const

/** A key of {@link MODEL_PROMPTS}. */
export type ModelPromptKey = keyof typeof MODEL_PROMPTS

/**
 * Interpolate `{name}` placeholders of one {@link MODEL_PROMPTS} value.
 * Same rule as the locale `lookup()`: a name present in `params` is replaced
 * by `String(value)`; anything else keeps the literal placeholder.
 * @param key - the prompt constant to render.
 * @param params - leaf template values only; never secrets.
 */
export function modelPrompt(key: ModelPromptKey, params?: Record<string, unknown>): string {
  const template: string = MODEL_PROMPTS[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}
