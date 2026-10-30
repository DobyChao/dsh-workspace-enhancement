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
    'A side workspace is an extra directory this session can operate on directly. Commands run in the main workspace by default. When the main workspace is remote, bash runs there; sw_exec is for a different server. Local commands use pwsh on Windows, or sw_exec with server "local" on Linux.',
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
    'Hint: the remote is missing {missing}. Interactive terminals still need bash or pwsh on the host. A fenced machine searches with the remote\'s own rg when it has one; otherwise the core is deployed together with a verified official ripgrep build (Settings → core.deploy), and installing ripgrep on the remote also works. bubblewrap is never shipped: a fenced machine needs it installed on the remote itself (apt/dnf/pacman/zypper), or the work runs with sandbox `danger-full-access`.',
  envCore:
    'Remote environment:\n  core: {version} ({arch})\n  caps: {caps}',
  envCoreMissing:
    'Remote environment:\n  core: not installed ({detail})\n  Reads still use SFTP. Writes and bash refuse until you deploy the fenced core from Settings (core.deploy), or switch the session to danger-full-access.',
  /**
   * `tool:sw-exec` section (order 105) — injected only in a remote-context
   * session. REQ-I11 adds the session gate: `sw_exec` names a machine that is
   * CONNECTED to this session (or the session's main-workspace machine), so the
   * copy states the precondition instead of leaving the model to discover it.
   */
  sectionSwExec:
    'sw_exec executes a command on the specified server. The server must be connected to this session: use an id from the connected-machine list, or call sw_connect first. If this session\'s main workspace is already that server, use bash instead. On Windows, local paths use pwsh, not sw_exec. On Linux, server "local" runs on this host only while the main workspace is remote. workdir defaults to that server\'s primary workspace. Check the [exit code: N] marker of each result; investigate non-zero exits before continuing.',
  /** `tool:bash` section (order 105, win32 hosts) — empty unless this session has a remote workspace. */
  sectionBash:
    'The bash tool runs `bash -c` on this session\'s remote Linux workspace. It does not run on the local machine or on a different server: use pwsh for local Windows commands and sw_exec for another server. Check the [exit code: N] marker of each result.',
  /**
   * REQ-I13 / ADR-0025: remote fs/spawn follow this session's `/permission`
   * (and official `sandbox_permissions` escalation) via the Linux core.
   * Missing core + confined mode fails closed; danger keeps SFTP/SSH.
   */
  remoteNoSandbox:
    'Remote commands and file tools follow this session\'s /permission sandbox (workspace-write, read-only, or danger-full-access), enforced by the Linux core when it is deployed. Confined writes and bash FAIL CLOSED if that core is missing. Reads then fall back to unfenced SFTP so chat and official Read still work (visible: the write/bash refusal names the missing core, or the fence tier the remote cannot enforce — bubblewrap install hints, the Landlock fallback tier, or sandbox-off). danger-full-access (including a one-shot sandbox_permissions grant) uses `dsh-core serve --sandbox off`, or today\'s SFTP and SSH when no core is installed. Interactive terminals stay refused while the session is confined. Escalation uses the same official card as local writes.',
  /**
   * AUDIT-6 gate-expectation sentence (`sw-remote` section): injected only
   * when the session's main-workspace machine has `remoteApproval !== 'off'`.
   * Manages the model's expectation of denials so a rejected command is not
   * retried unchanged (ADR-0020 D6).
   */
  remoteGateActive:
    'Commands on this machine additionally require an approval decision before they run; do not retry a rejected command unchanged. If the approval gate and sandbox escalation are both on, the operator sees two cards.',
  /**
   * REQ-I28: stable sentence for a remote main workspace. Uploads are copied
   * into `{dir}` on the remote before the turn starts.
   */
  remoteUploads:
    'Files the user uploads into this remote session are copied into `{dir}` in the remote workspace before the turn starts. Read and edit those copies with the remote file tools; the local attachment path is not on this machine.',
  /** REQ-I28: heading for the volatile list of copied remote paths. */
  remoteFilesHeading: '**Files copied into this remote workspace for this session**:',
  /** REQ-I28: one copied remote path. */
  remoteFileItem: '- `{path}`',
  /**
   * Volatile runtime-context heading: one line per connected machine says
   * whether `dsh-core` is actually in effect. The heading states the
   * consequence once; each line is only the fact.
   */
  remoteComponentHeading:
    '**Remote component (dsh-core) on this session\'s machines**: "in effect" means file tools and commands on that machine go through it, including danger-full-access (`dsh-core serve --sandbox off`). "Not in effect" means confined writes and bash refuse, and danger-full-access falls back to SFTP and SSH. A missing, cross-line, or unknown binary is replaced by the next `sw_connect` or the first confined use.',
  /** Same major.minor and a known (or unhashed) binary. */
  remoteComponentActive: '- `{id}`: in effect ({version}).',
  /** No artifact on disk. */
  remoteComponentMissing: '- `{id}`: not in effect (not installed).',
  /** On this line, but the sha256 is not one this plugin shipped. */
  remoteComponentUntrusted: '- `{id}`: not in effect ({version}; sha256 is not a binary this plugin shipped).',
  /** On this line, but the probe could not read a sha256. */
  remoteComponentUnreadable: '- `{id}`: not in effect ({version}; sha256 could not be read).',
  /** A different major.minor than the binary this plugin ships. */
  remoteComponentMismatch: '- `{id}`: not in effect ({found}; this plugin ships {expected}).',
  /** Probe failed, or the machine is not in the registry. */
  remoteComponentError: '- `{id}`: not in effect ({detail}).',
  /**
   * Kept for older tests/callers; the session-sandbox sentence above now
   * covers the fence. Empty so a leftover inject is a no-op.
   */
  remoteFenced: '',
  /** REQ-I9: leftover connected-machine fence note; unused after ADR-0025. */
  connectedFenced: '',
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
