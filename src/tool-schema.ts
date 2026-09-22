/**
 * Model-facing tool schemas — ENGLISH ONLY (UX-6 / ADR-0014).
 *
 * Official bash/pwsh schemas are hardcoded English. These descriptions and
 * parameter texts match that: they do not follow the settings Language row.
 * Execution errors and rendered tool output stay in `src/locale/`.
 *
 * @module dsh-workspace-enhancement/tool-schema
 */

import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

const ESCALATION_SENTENCE = 'Attempting a command the sandbox may deny is safe and expected: run it and read the marker rather than assuming the denial. When a command is denied and a wider mode would let it succeed, escalate immediately in the same turn — the one sanctioned exception to a denial: retry the exact same command once with `sandbox_permissions` (the narrowest wider mode that suffices) plus a one-sentence `justification`. Do not detour through chat to ask permission first — the approval prompt raised by that retry is how the user consents. If the session states approval prompts are disabled, there is no exception: a denial is final — do not set `sandbox_permissions`. Never escalate speculatively: ground the request in a real denial — normally the one this command just hit; escalating up front is fine only when this session already denied the same access. A rejected escalation is final for that command — stop and explain, never work around it — but it does not forbid attempting or escalating other commands later.'

const BACKGROUND_SENTENCE = 'Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.'

const BACKGROUND_UNAVAILABLE = 'Background execution is not available; long-running commands must finish within the timeout.'

const DENIAL_SENTENCE = 'A blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way.'

function withBackground(base: string, backgroundEnabled: boolean): string {
  const background = backgroundEnabled ? BACKGROUND_SENTENCE : BACKGROUND_UNAVAILABLE
  return `${base} ${DENIAL_SENTENCE} ${background} ${ESCALATION_SENTENCE}`
}

export const SW_STATUS_DESCRIPTION = 'Show the current remote machine (host/user/port), connection health (ping), the current remote workspace (from the session cwd / machine record, not a model tool), and the host-key policy/state. Call this first to orient, or when an sw_* call fails to check connectivity.'

export const SW_CONNECT_DESCRIPTION = 'Set which registered machines this session may connect to and run commands on. Every call REPLACES the whole set (it is not a union): `machines: []` disconnects everything. Does not choose a workspace directory (that is the session cwd / add-workspace flow). Machines must be ids of registered machines; an unknown id errors with the known list. Each requested machine is then pinged within a bounded budget: reachable ones are recorded as connected, unreachable ones are reported honestly and left out; when none is reachable the call fails and the existing connections stay unchanged.'

const SW_EXEC_DESCRIPTION = 'Execute a command on a registered SSH server connected to this session and return its stdout/stderr. The `server` id selects the machine — it must be a registry id connected to this session (see the connection line of sw_status, or call sw_connect first); it defaults to the machine of this session\'s main workspace. The target OS is probed once per connection and reported in the first line: POSIX runs `bash -c`, Windows runs `pwsh -Command`, unknown runs bash honestly. Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]` — investigate failures before moving on. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available.'

const BASH_DESCRIPTION = 'Execute a bash command (`bash -c`) on the session\'s remote Linux workspace and return its stdout/stderr. Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]` — investigate failures before moving on. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available.'

export function swExecDescription(backgroundEnabled: boolean): string {
  return withBackground(SW_EXEC_DESCRIPTION, backgroundEnabled)
}

export function bashDescription(backgroundEnabled: boolean): string {
  return withBackground(BASH_DESCRIPTION, backgroundEnabled)
}

const COMMAND_PARAM = 'The command to execute on the target server.'

const DESCRIPTION_PARAM = 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; "git status" → "Show working tree status"; "npm install" → "Install package dependencies".'

const TIMEOUT_PARAM = 'Timeout in milliseconds (executor default 120s, cap 600s — overrides are clamped). The tool kills the command on expiry and reports [timed out after Nms].'

const RUN_IN_BACKGROUND_PARAM = 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.'

const SANDBOX_PERMISSIONS_PARAM = 'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.'

const JUSTIFICATION_PARAM = 'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.'

/** Shared escalation fields. Advertised whenever the tool can confine a remote command. */
export function escalationParams() {
  return {
    sandbox_permissions: {
      type: 'string' as const,
      enum: ['workspace-write', 'danger-full-access'] as const,
      description: SANDBOX_PERMISSIONS_PARAM,
    },
    justification: {
      type: 'string' as const,
      description: JUSTIFICATION_PARAM,
    },
  } as const
}

export const SW_CONNECT_PARAMS: ParameterSchemaSpec = {
  machines: {
    type: 'array',
    items: { type: 'string' },
    required: true,
    description: 'Array of registered machine ids to connect. An empty array disconnects every machine from this session.',
  },
}

export function swExecParams(backgroundEnabled: boolean) {
  return {
    command: { type: 'string' as const, required: true as const, description: COMMAND_PARAM },
    description: { type: 'string' as const, required: true as const, description: DESCRIPTION_PARAM },
    timeoutMs: { type: 'number' as const, description: TIMEOUT_PARAM },
    workdir: {
      type: 'string' as const,
      description: 'Working directory on the target server. Defaults to that server\'s primary workspace; a relative path is resolved against the session workspace; `ssh://<id>/<path>` names a machine and directory explicitly.',
    },
    server: {
      type: 'string' as const,
      description: 'Target server id: a registry machine id (c1, c2, …) connected to this session. Defaults to the machine of this session\'s main workspace. A registered id that is not connected to this session errors with the connected ids; an unknown id errors with the known list.',
    },
    ...(backgroundEnabled ? { run_in_background: { type: 'boolean' as const, description: RUN_IN_BACKGROUND_PARAM } } : {}),
    ...escalationParams(),
  }
}

export function bashParams(backgroundEnabled: boolean) {
  return {
    command: { type: 'string' as const, required: true as const, description: COMMAND_PARAM },
    description: { type: 'string' as const, required: true as const, description: DESCRIPTION_PARAM },
    timeoutMs: { type: 'number' as const, description: TIMEOUT_PARAM },
    workdir: {
      type: 'string' as const,
      description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it; `ssh://<id>/<path>` names a machine and directory explicitly.',
    },
    ...(backgroundEnabled ? { run_in_background: { type: 'boolean' as const, description: RUN_IN_BACKGROUND_PARAM } } : {}),
    ...escalationParams(),
  }
}
