/**
 * REQ-I19 / ADR-0028: which tool owns which world, and the cwd that decision
 * implies. Model-facing refusals are English constants (ADR-0014), not locale
 * strings — a Chinese UI must not change what the model is told to retry with.
 *
 * @module dsh-workspace-enhancement/region-exec
 */

import { homedir } from 'node:os'
import { parseSshRoute } from './registry.ts'
import { remoteRouteFromCwd } from './transport.ts'

/** Reserved machine id. `sw_exec(server: "local")` is not a registry row. */
export const LOCAL_SERVER_ID = 'local'

export const SW_EXEC_USE_BASH =
  'sw_exec: this session\'s remote workspace uses the bash tool. Retry with bash, not sw_exec.'

export const SW_EXEC_USE_PWSH =
  'sw_exec: local commands use the pwsh tool. Retry with pwsh, not sw_exec.'

export const SW_EXEC_USE_LOCAL_BASH =
  'sw_exec: local commands use the bash tool. Retry with bash, not sw_exec.'

export const SW_EXEC_WORLD_CONFLICT =
  'sw_exec: server and workdir name different worlds. Use a remote workdir with a remote server, or server "local" with a local absolute path.'

export const SW_EXEC_LOCAL_WORKDIR =
  'sw_exec: a local workdir must be an absolute path on this host.'

export const SW_EXEC_LOCAL_SHELL_MISSING =
  'sw_exec: local execution needs the host bash shell, which is not mounted.'

export const BASH_USE_SW_EXEC =
  'bash: workdir names another machine. Use sw_exec for that server.'

export const BASH_USE_LOCAL =
  'bash: this tool is pinned to the remote workspace. On Linux, local paths use sw_exec with server "local".'

export const BASH_USE_SW_EXEC_LOCAL_SESSION =
  'bash: this session is local. Remote commands use sw_exec.'

export type SwExecDecision =
  | { action: 'remote' }
  | { action: 'local' }
  | { action: 'refuse'; message: string }

export interface SwExecDecisionInput {
  platform: NodeJS.Platform
  /** Machine of the session's main workspace, when that workspace is remote. */
  sessionMachineId: string | undefined
  /** Trimmed `server` argument, or `undefined` when the model omitted it. */
  requestedServer: string | undefined
  /** Raw `workdir` argument, before remote normalization. */
  workdir: string | undefined
}

/** Whether `id` is the reserved local sentinel (must not be stored as a machine). */
export function isReservedLocalServer(id: string | undefined): boolean {
  return id === LOCAL_SERVER_ID
}

/**
 * Cwd for `pwsh` and `sw_exec(server: "local")` when the main workspace is
 * remote. Exactly one local side root wins; zero or many use the home
 * directory. This does not add that root to the sandbox writable set.
 */
export function sessionLocalCwd(localSideRoots: readonly string[], home: string = homedir()): string {
  const unique: string[] = []
  for (const root of localSideRoots) {
    if (root.trim() === '' || unique.includes(root)) continue
    unique.push(root)
  }
  return unique.length === 1 ? unique[0]! : home
}

/**
 * A workdir the model spelled as this host's filesystem, not a remote route.
 * Relative paths are neither: they follow the session workspace.
 */
export function isLocalWorkdirSpelling(workdir: string | undefined, platform: NodeJS.Platform): boolean {
  if (workdir === undefined) return false
  const value = workdir.trim()
  if (value === '' || value.startsWith('ssh://')) return false
  if (remoteRouteFromCwd(value) !== null) return false
  if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')) return true
  if (platform === 'win32' && value.startsWith('/') && !value.startsWith('//')) return false
  return value.startsWith('/')
}

/**
 * Route one `sw_exec` call. Refusals name the tool the model should retry
 * with. They do not rewrite the call into that tool.
 */
export function decideSwExec(input: SwExecDecisionInput): SwExecDecision {
  const requested = input.requestedServer
  const localWorkdir = isLocalWorkdirSpelling(input.workdir, input.platform)
  const wantsLocal = requested === LOCAL_SERVER_ID || localWorkdir
  const workdirRoute = input.workdir !== undefined && input.workdir.startsWith('ssh://')
    ? parseSshRoute(input.workdir)
    : null
  if (wantsLocal && requested !== undefined && requested !== LOCAL_SERVER_ID) {
    return { action: 'refuse', message: SW_EXEC_WORLD_CONFLICT }
  }
  if (requested === LOCAL_SERVER_ID && workdirRoute !== null) {
    return { action: 'refuse', message: SW_EXEC_WORLD_CONFLICT }
  }
  if (wantsLocal) {
    if (input.platform === 'win32') return { action: 'refuse', message: SW_EXEC_USE_PWSH }
    if (input.sessionMachineId === undefined) return { action: 'refuse', message: SW_EXEC_USE_LOCAL_BASH }
    return { action: 'local' }
  }
  const targetId = workdirRoute?.id ?? requested
  if (input.sessionMachineId !== undefined && (targetId === undefined || targetId === input.sessionMachineId)) {
    return { action: 'refuse', message: SW_EXEC_USE_BASH }
  }
  return { action: 'remote' }
}

/**
 * Official bash on a Linux host. A remote main workspace stays on that
 * machine; a local main workspace stays local. The other world is a refusal,
 * not a silent reroute.
 * @returns the workdir to keep (possibly unchanged).
 */
export function pinBashWorkdir(workdir: string | undefined, sessionCwd: string | undefined): string | undefined {
  if (workdir === undefined) return undefined
  const session = remoteRouteFromCwd(sessionCwd)
  const target = remoteRouteFromCwd(workdir)
  if (session === null) {
    if (target !== null) throw new Error(BASH_USE_SW_EXEC_LOCAL_SESSION)
    return workdir
  }
  if (target !== null) {
    if (target.connectionId !== session.connectionId) throw new Error(BASH_USE_SW_EXEC)
    return workdir
  }
  if (isHostAbsolute(workdir)) throw new Error(BASH_USE_LOCAL)
  return workdir
}

/**
 * Official pwsh on a Windows host. A remote spelling (ssh, placeholder, bare
 * POSIX) is not sent to the remote machine; the call keeps running locally
 * at {@link sessionLocalCwd}.
 */
export function pinPwshWorkdir(workdir: string | undefined, localCwd: string): string | undefined {
  if (workdir === undefined) return undefined
  if (isRemoteSpelling(workdir, 'win32')) return localCwd
  return workdir
}

/** Same remote spellings as `worldOfCwd`, kept here so this module stays a leaf. */
function isRemoteSpelling(cwd: string, platform: NodeJS.Platform): boolean {
  if (remoteRouteFromCwd(cwd) !== null) return true
  if (cwd.startsWith('ssh://') && cwd.slice('ssh://'.length).startsWith('.')) return true
  if (platform === 'win32' && cwd.startsWith('/') && !cwd.startsWith('//')) return true
  return false
}

/** Drive, UNC, or a POSIX absolute path that is not a route placeholder. */
function isHostAbsolute(value: string): boolean {
  if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')) return true
  return value.startsWith('/') && !value.startsWith('//')
}
