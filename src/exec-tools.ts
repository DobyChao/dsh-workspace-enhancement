/**
 * S1+S2 of drafts/sw-exec-requirement.md: the `sw_exec` cross-server execution
 * tool and the win32-host `bash` seam tool.
 *
 * - `sw_exec`: bash/pwsh-tool-aligned command execution ON A NAMED SERVER — a
 *   registry machine id (`c1`, …) that is CONNECTED TO THIS SESSION
 *   (REQ-I11 / ADR-0021: the stored `sessionConnections` set ∪ the implicit
 *   main machine) — with a `server` parameter plus an optional workdir. The
 *   target server's OS is probed once per connection (`uname -s`, falling
 *   back to `cmd /c ver`, then `unknown`) and selects the shell:
 *   `bash -c` (POSIX / unknown) or `pwsh -Command` (win32). Execution goes
 *   through the MIXED subprocess provider with an `ssh://<id>/<path>` cwd, so
 *   the machine routing is the same one every other spawn uses. Non-zero exits
 *   are reported, not errored.
 * - win32 bash (REQ-I16): on a Windows host the official bash executor is
 *   absent. The tool is **not** registered globally. `agent/created` injects
 *   it onto `agent.ctx` when the session cwd is a remote (Linux) workspace.
 *   A local Windows session never sees `bash` in the tool list (use pwsh /
 *   `sw_exec`). Execute-time still refuses a local workdir if the scoped tool
 *   is called with one.
 *
 * Everything testable is a pure function or takes a small faceted env
 * (`SwExecEnv`) so unit tests never touch the network.
 * @module dsh-workspace-enhancement/exec-tools
 */

import { isAbsolute, posix, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED, defineTool, parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { remoteRouteFromCwd } from './transport.ts'
import { parseSshRoute } from './registry.ts'
import type { SshRegistry } from './registry.ts'
import type { SshConnectionSpec } from './connection.ts'
import type { ExecOutcome } from './ssh-core.ts'
import { worldOfCwd } from './mixed.ts'
import { lookup, type DswKey, type TranslateFn } from './locale/index.ts'
import { hostLocaleOf } from './locale/host.ts'
import { modelPrompt } from './model-prompts.ts'
import { hasRemoteSessionContext, hasRemoteWorkspaceContext, sessionIdOf } from './session-remote-context.ts'
import type { SessionConnectionsFace } from './session-remote-context.ts'
import type { SessionSideWorkspaceStore } from './session-workspaces.ts'

/**
 * Fixed-EN translator — the legacy default of the tool-face pure functions:
 * their pre-i18n copy was English (and the existing tests pin that output).
 * The tool registration paths pass the live host-language translator instead.
 */
const EN_T: TranslateFn = (key, params) => lookup('en', key, params)

/**
 * Fixed-ZH translator — the baseline compiled into `defineTool` at
 * registration (the validation closure keeps the ZH-spelled descriptions;
 * description fields carry no validation meaning, so the baseline language is
 * irrelevant to checking — ZH key set is the source of truth).
 */
const ZH_T: TranslateFn = (key, params) => lookup('zh', key, params)

/** The operating-system fact a probed server gets. */
export type RemoteOs = 'linux' | 'win32' | 'unknown'

/** Foreground run budget applied when the model omits `timeoutMs` (executor default, dsh-bash-local config). */
export const SW_EXEC_DEFAULT_TIMEOUT_MS = 120_000

/** Upper bound for a per-call `timeoutMs` override (dsh-bash-local maxTimeoutMs). */
export const SW_EXEC_MAX_TIMEOUT_MS = 600_000

/** Kill-escalation grace of the spawn spec (SIGTERM → SIGKILL / drain bound) — NOT the run timeout. */
export const SW_EXEC_KILL_GRACE_MS = 60_000

/** In-memory output cap per stream (tail kept; overflow spilled). */
export const SW_EXEC_OUTPUT_MAX_BYTES = 1024 * 1024

/** Whole-stream spill cap per stream (path reported to the model). */
export const SW_EXEC_OUTPUT_SPILL_MAX_BYTES = 8 * 1024 * 1024

/** Background job kind used with `ctx.jobs` (opaque namespace, no validation). */
export const SW_EXEC_JOB_KIND = 'sw-exec'

/** Minimal connection face: registry connections and temp connections satisfy it. */
export interface SwExecConnection {
  readonly id: string
  readonly endpoint: string
  readonly spec: SshConnectionSpec
  exec(command: string, opts?: { signal?: AbortSignal }): Promise<ExecOutcome>
}

/** The server-selection face `swExecCore` needs (registry + temp + config fallback). */
export interface SwExecEnv {
  get(id: string): SwExecConnection | undefined
  getActive(): { spec: SshConnectionSpec; connection: SwExecConnection } | null
  listMachines(): { machines: readonly { id: string }[] }
  /** The mixed subprocess provider: routes by the spec's cwd (`ssh://…` → machine). */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

/** The canonical foreground value of sw_exec (bash-aligned + server/os facts). */
export interface SwExecForeground {
  kind: 'foreground'
  server: string
  endpoint: string
  os: RemoteOs
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  timeoutMs: number
  stdout: SwExecStream
  stderr: SwExecStream
}

/** One collected stream: tail text plus truncation facts. */
export interface SwExecStream {
  text: string
  truncated: boolean
  spillPath?: string
}

/** The canonical background value of sw_exec (job id returned immediately). */
export interface SwExecBackground {
  kind: 'background'
  jobId: string
  server: string
  endpoint: string
}

/** The canonical foreground value of the win32 bash tool (bash-tool-aligned). */
export interface BashForeground {
  kind: 'foreground'
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  timeoutMs: number
  stdout: SwExecStream
  stderr: SwExecStream
}

/** The canonical background value of the win32 bash tool. */
export interface BashBackground {
  kind: 'background'
  jobId: string
}

/** The parameter face of the sw_exec tool. */
export interface SwExecArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  server?: string
  run_in_background?: boolean
}

/** The parameter face of the win32 bash tool (official bash parameters, no escalation). */
export interface Win32BashArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
}

/* ------------------------------------------------------------------ OS probe */

/**
 * Classify a `uname -s` result (sync despite the Async suffix — the name is
 * fixed by the S1 spec). `null` means "no usable POSIX answer": the caller
 * falls through to the Windows probe. Git-Bash/MSYS/Cygwin report a Windows
 * kernel here and must NOT get bash semantics; every other non-empty POSIX
 * family name reads as `linux` (bash -c is the honest best effort).
 */
export function parseUnameAsync(exitCode: number | null, output: string): RemoteOs | null {
  if (exitCode !== 0) return null
  const text = output.trim()
  if (text === '') return null
  if (/mingw|msys|cygwin/i.test(text)) return 'win32'
  return 'linux'
}

/** Classify a `cmd /c ver` result: exit 0 confirms Windows. */
export function parseVerProbe(exitCode: number | null, output: string): 'win32' | null {
  if (exitCode !== 0) return null
  return output.trim() === '' ? null : 'win32'
}

/** The one process-local OS cache: keyed by id, invalidated when the connection rebuilds. */
export interface RemoteOsCache {
  get(connection: SwExecConnection): RemoteOs | undefined
  set(connection: SwExecConnection, os: RemoteOs): void
}

/** Create a process-local OS cache (per-registration instance). */
export function createRemoteOsCache(): RemoteOsCache {
  const store = new Map<string, { connection: SwExecConnection; os: RemoteOs }>()
  return {
    get(connection) {
      const entry = store.get(connection.id)
      return entry !== undefined && entry.connection === connection ? entry.os : undefined
    },
    set(connection, os) {
      store.set(connection.id, { connection, os })
    },
  }
}

/**
 * Probe the target's OS with one `uname -s` round-trip, falling back to
 * `cmd /c ver` and then `unknown` (S1 semantics). Probe exit-code failures
 * fall through; thrown errors (a broken/disposed connection) propagate as
 * infrastructure failures instead of silently reporting `unknown`.
 * @param connection - the live connection.
 * @param signal - optional abort bound for both probes.
 * @param cache - the process-local OS cache.
 */
export async function resolveRemoteOs(
  connection: SwExecConnection,
  signal: AbortSignal | undefined,
  cache: RemoteOsCache,
): Promise<RemoteOs> {
  const cached = cache.get(connection)
  if (cached !== undefined) return cached
  let os: RemoteOs
  const uname = await connection.exec('uname -s', signal !== undefined ? { signal } : undefined)
  const fromUname = parseUnameAsync(uname.exitCode, uname.stdout)
  if (fromUname !== null) {
    os = fromUname
  } else {
    const ver = await connection.exec('cmd /c ver', signal !== undefined ? { signal } : undefined)
    os = parseVerProbe(ver.exitCode, ver.stdout) ?? 'unknown'
  }
  cache.set(connection, os)
  return os
}

/** Build the shell argv for one OS: POSIX/unknown → `bash -c`, win32 → `pwsh -Command`. */
export function buildShellArgv(os: RemoteOs, command: string): string[] {
  return os === 'win32' ? ['pwsh', '-Command', command] : ['bash', '-c', command]
}

/* ------------------------------------------------------------- workdir rules */

/** The machine's primary remote directory: `workspace` wins, then `cwd`, then `/`. */
export function defaultRemoteDir(spec: SshConnectionSpec): string {
  return ensurePosixAbsolute(spec.workspace ?? spec.cwd ?? '/')
}

/** Coerce a machine default directory to the `/`-rooted POSIX spelling routes need. */
function ensurePosixAbsolute(value: string): string {
  return posix.isAbsolute(value) ? value : '/'
}

/**
 * Normalize the model-supplied workdir for sw_exec (S1 workdir column):
 * - undefined → `undefined` (the core defaults to the target server's primary
 *   workspace);
 * - `ssh://<id>/<path>` → verbatim — it names a machine and a directory;
 * - POSIX absolute → verbatim (interpreted on the `server` machine);
 * - relative → resolved against the session workspace (official bash
 *   semantics; a relative workdir REQUIRES a remote session cwd).
 * Windows drive/UNC spellings are rejected: the remote world is POSIX.
 */
export function normalizeSwExecWorkdir(
  workdir: string | undefined,
  sessionRoute: { id: string; path: string } | null,
  tr: TranslateFn = EN_T,
): string | undefined {
  if (workdir === undefined) return undefined
  if (workdir.trim() === '') throw new Error(tr('tool.sw_exec.error.workdirEmpty'))
  if (workdir.startsWith('ssh://')) {
    if (parseSshRoute(workdir) === null) {
      throw new Error(tr('tool.sw_exec.error.invalidWorkdir', { dir: JSON.stringify(workdir) }))
    }
    return workdir
  }
  if (posix.isAbsolute(workdir)) return workdir
  if (/^[A-Za-z]:[\\/]/.test(workdir) || workdir.startsWith('\\\\')) {
    throw new Error(tr('tool.sw_exec.error.workdirShape'))
  }
  if (sessionRoute === null) throw new Error(tr('tool.sw_exec.error.relativeNoCwd'))
  return posix.resolve(sessionRoute.path, workdir)
}

/**
 * Resolve the final spawn working directory and its effective machine:
 * `ssh://<server>/<dir>` for default/absolute workdirs, the explicit
 * `ssh://<id>/<path>` verbatim when one is given (the ID names the machine —
 * OS detection and the report header follow it, since the mixed provider
 * routes the spawn by this exact cwd anyway).
 */
export function resolveSwExecCwd(
  workdir: string | undefined,
  serverId: string,
  machineDefault: string,
  tr: TranslateFn = EN_T,
): { cwd: string; machineId: string } {
  if (workdir === undefined) {
    return { cwd: `ssh://${serverId}${ensurePosixAbsolute(machineDefault)}`, machineId: serverId }
  }
  if (workdir.startsWith('ssh://')) {
    const route = parseSshRoute(workdir)
    if (route === null) throw new Error(tr('tool.sw_exec.error.invalidWorkdir', { dir: JSON.stringify(workdir) }))
    return { cwd: workdir, machineId: route.id }
  }
  if (!posix.isAbsolute(workdir)) {
    throw new Error(tr('tool.sw_exec.error.absoluteShape'))
  }
  return { cwd: `ssh://${serverId}${workdir}`, machineId: serverId }
}

/* ------------------------------------------------------------- server lookup */

/**
 * Resolve the target server: a registry id, then the active machine for an
 * omitted id. Unknown ids fail with the known-id list (S1: unknown server
 * error). Temporary ids are gone with `sw_connect save:false` (ADR-0021 §1/§5),
 * and the per-session connection gate runs BEFORE this resolver — by the time
 * it is called, the id is either connected or the implicit main machine.
 * v1 has no local server: the local world belongs to bash/pwsh.
 */
export function resolveSwExecServer(
  env: SwExecEnv,
  serverId: string | undefined,
  tr: TranslateFn = EN_T,
): { connection: SwExecConnection; spec: SshConnectionSpec } {
  if (serverId === undefined) {
    const active = env.getActive()
    if (active === null) throw new Error(tr('tool.sw_exec.error.noActive'))
    return { connection: active.connection, spec: active.spec }
  }
  const connection = env.get(serverId)
  if (connection !== undefined) return { connection, spec: connection.spec }
  const active = env.getActive()
  if (active !== null && active.connection.id === serverId) {
    return { connection: active.connection, spec: active.spec }
  }
  const known = env.listMachines().machines.map(machine => machine.id)
  throw new Error(
    tr('tool.sw_exec.error.unknownServer', { id: serverId })
    + (known.length > 0 ? ` — known: ${known.join(', ')}` : ''),
  )
}

/* ------------------------------------------------------------- reachability */

/**
 * The registry slice a reachability probe needs: one live connection per
 * registry id. `SshRegistry` satisfies it structurally (its `get` returns a
 * live `SshConnection`), which keeps the probe testable without a registry.
 */
export interface ProbeRegistryFace {
  get(id: string): { exec(command: string, opts?: { signal?: AbortSignal }): Promise<ExecOutcome> } | undefined
}

/** One machine's reachability outcome (plain data — no live objects). */
export interface MachineProbeResult {
  id: string
  /** Whether `echo ok` came back with exit code 0 inside the budget. */
  ok: boolean
  latencyMs: number
  /** Failure reason (model/user-visible); `''` when reachable. */
  detail: string
}

/** Reachability budget of one machine (mirrors the registry's PROBE_TIMEOUT_MS). */
export const MACHINE_PROBE_TIMEOUT_MS = 8_000

/**
 * Probe ONE registry machine with the `echo ok` contract every `sw_*`
 * connectivity check uses, inside a hard budget. A failed command, a thrown
 * error (dead/poisoned chain), an unknown id and a timeout are all reported as
 * `ok: false` + detail — the caller decides whether that is fatal.
 * @param registry - the registry slice (live connection lookup).
 * @param id - registry machine id.
 * @param budgetMs - probe budget (defaults to {@link MACHINE_PROBE_TIMEOUT_MS}).
 */
export async function probeMachine(
  registry: ProbeRegistryFace,
  id: string,
  budgetMs: number = MACHINE_PROBE_TIMEOUT_MS,
): Promise<MachineProbeResult> {
  const started = Date.now()
  let connection: ReturnType<ProbeRegistryFace['get']>
  try {
    connection = registry.get(id)
  } catch (error) {
    return { id, ok: false, latencyMs: 0, detail: error instanceof Error ? error.message : String(error) }
  }
  if (connection === undefined) {
    return { id, ok: false, latencyMs: 0, detail: `unknown machine id "${id}"` }
  }
  try {
    const outcome = await connection.exec('echo ok', { signal: AbortSignal.timeout(budgetMs) })
    const latencyMs = Date.now() - started
    if (outcome.exitCode === 0) return { id, ok: true, latencyMs, detail: '' }
    return {
      id,
      ok: false,
      latencyMs,
      detail: (outcome.stderr || outcome.stdout || `exit ${String(outcome.exitCode)}`).trim(),
    }
  } catch (error) {
    return { id, ok: false, latencyMs: Date.now() - started, detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Probe several machines, preserving the requested order (sequential, bounded each). */
export async function probeMachines(
  registry: ProbeRegistryFace,
  ids: readonly string[],
  budgetMs: number = MACHINE_PROBE_TIMEOUT_MS,
): Promise<MachineProbeResult[]> {
  const results: MachineProbeResult[] = []
  for (const id of ids) results.push(await probeMachine(registry, id, budgetMs))
  return results
}

/* --------------------------------------------------------- session gate */

/**
 * The per-session connection facts `sw_exec` gates on (ADR-0021 §2.4/§2.5):
 * the STORED connected set plus the implicit main machine the session's header
 * cwd routes to. The implicit machine is a read-time union — it is never
 * written back, so a remote session does not manufacture persisted state just
 * by running a command.
 */
export interface ConnectedMachines {
  /** The session id the gate ran for (`null` ⇒ unresolvable ⇒ fail closed). */
  sessionId: string | null
  /** Stored ∪ implicit, in that order, deduped. */
  ids: string[]
  /** The main-workspace machine id when the cwd routes remote. */
  implicit: string | null
}

/**
 * Merge the session's stored connections with the implicit main machine
 * (ADR-0021 §2.4). Pure and synchronous: the cwd route comes from the header,
 * the stored set from the `sessionConnections` service.
 * @param sessionCwd - `session.header.cwd` (any route spelling), if any.
 * @param sessionId - `session.header.id`, if the carrier exposes it.
 * @param listFor - the store's `listFor` (absent ⇒ no stored connections).
 * @param registry - the registry slice used to validate the implicit id.
 */
export function connectedMachinesOf(
  sessionCwd: string | undefined,
  sessionId: string | undefined,
  listFor: ((sessionId: string) => readonly string[]) | undefined,
  registry: ProbeRegistryFace,
): ConnectedMachines {
  const route = remoteRouteFromCwd(sessionCwd)
  const implicit = route !== null && registry.get(route.connectionId) !== undefined ? route.connectionId : null
  const stored = sessionId !== undefined ? [...(listFor?.(sessionId) ?? [])] : []
  const ids: string[] = []
  if (implicit !== null) ids.push(implicit)
  for (const id of stored) {
    if (!ids.includes(id)) ids.push(id)
  }
  return { sessionId: sessionId ?? null, ids, implicit }
}

/**
 * REQ-I11 / ADR-0021 §2.5 — the `sw_exec` server gate. The tool stays GLOBALLY
 * registered (ADR-0021 §3 rejects every scoped/preset alternative for lack of
 * a per-session scope handle), so the refusal lives here:
 *
 * 1. an unresolvable session id → fail closed (A1 unknown #8: never fail open);
 * 2. no connection at all → "call `sw_connect` first";
 * 3. a KNOWN registry machine that is not connected to this session → the
 *    connected ids are listed;
 * 4. an id the registry does not know → the registry's own "unknown server"
 *    error with the known-id list (unchanged wording).
 *
 * The caller has already resolved `requested` (explicit `server`, else the
 * implicit main machine), so an untouched explicit id is checked by name.
 * @param connected - the merged per-session facts.
 * @param requested - the machine the call names, or `undefined` when it names none.
 * @param registered - every registry machine id (the known-id list).
 * @param tr - translator for the refusal messages (host language).
 */
export function requireConnectedServer(
  connected: ConnectedMachines,
  requested: string | undefined,
  registered: readonly string[],
  tr: TranslateFn = EN_T,
): void {
  if (connected.sessionId === null) throw new Error(tr('tool.sw_exec.error.noSession'))
  if (connected.ids.length === 0) throw new Error(tr('tool.sw_exec.error.notConnectedNone'))
  if (requested === undefined) return
  if (connected.ids.includes(requested)) return
  if (registered.includes(requested)) {
    throw new Error(tr('tool.sw_exec.error.notConnected', { id: requested, ids: connected.ids.join(', ') }))
  }
  throw new Error(
    tr('tool.sw_exec.error.unknownServer', { id: requested })
    + (registered.length > 0 ? ` — known: ${registered.join(', ')}` : ''),
  )
}

/* ---------------------------------------------------------------- deadline */

/** A caller-signal + timeout deadline merged into ONE spawn abort signal. */
export interface SwExecDeadline {
  signal: AbortSignal
  timedOut(): boolean
  dispose(): void
}

/**
 * Merge the tool-call abort signal with an optional run timeout (the spawn
 * spec's `signal` starts the terminate escalation on either). Timers are
 * cleared on dispose; a caller abort propagates its reason.
 */
export function makeSwExecDeadline(timeoutMs: number | undefined, caller: AbortSignal | undefined): SwExecDeadline {
  const controller = new AbortController()
  let timedOut = false
  const onCallerAbort = (): void => {
    controller.abort(caller?.reason ?? new Error('tool call aborted'))
  }
  if (caller?.aborted === true) onCallerAbort()
  else caller?.addEventListener('abort', onCallerAbort, { once: true })
  let timer: NodeJS.Timeout | undefined
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error(`timeout after ${timeoutMs}ms`))
    }, timeoutMs)
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      caller?.removeEventListener('abort', onCallerAbort)
    },
  }
}

/**
 * Resolve a per-call `timeoutMs` the way the official bash executor does
 * (`dsh-bash-local` resolve): an omitted value gets the executor default
 * (120s), an override above the cap is clamped (600s). Validation rejects
 * non-positive/non-finite values before this runs.
 */
export function resolveSwExecTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return SW_EXEC_DEFAULT_TIMEOUT_MS
  return Math.min(timeoutMs, SW_EXEC_MAX_TIMEOUT_MS)
}

/**
 * The canonical tool-call-aborted error (official bash tool contract):
 * a `HarnessError` with code `ABORTED` and `name: 'AbortError'` — the tools
 * pipeline recognizes HarnessError errorInfo, so a plain Error would lose the
 * ABORTED classification.
 */
export function toolAbortError(): HarnessError {
  const error = new HarnessError('tool call aborted', TOOL_ABORTED)
  error.name = 'AbortError'
  return error
}

/* ------------------------------------------------- BUG-9: stop the waiting */

/** How long a terminated subprocess may take to settle `done` before the tool
 * call stops waiting: TERM→KILL grace + close-fallback + round-trip slack. */
export const STOP_SETTLE_WINDOW_MS = SW_EXEC_KILL_GRACE_MS + 5_000

/** Marker rejection: the handle ignored TERM/KILL and never settled (BUG-9). */
export class UnsettledStopError extends Error {
  constructor() {
    super('subprocess did not settle after termination')
    this.name = 'UnsettledStopError'
  }
}

/**
 * Await a handle's outcome, but never forever. Once the merged deadline signal
 * aborts (caller stop or timeout), the handle gets {@link STOP_SETTLE_WINDOW_MS}
 * to settle; only then does this reject with {@link UnsettledStopError} so the
 * tool call surfaces a failure instead of hanging on a remote that swallowed
 * both the signal request and the kill channel (BUG-9: the old code awaited
 * `handle.done` with no escape — one unresponsive server hung the tool call).
 * @param done - the subprocess outcome promise.
 * @param signal - the merged spawn signal (caller abort + timeout).
 * @param windowMs - settle window after the abort (tests shrink it).
 */
export async function awaitOutcomeOrStop(
  done: Promise<SubprocessOutcome>,
  signal: AbortSignal | undefined,
  windowMs: number = STOP_SETTLE_WINDOW_MS,
): Promise<SubprocessOutcome> {
  if (signal === undefined) return done
  return new Promise<SubprocessOutcome>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
      if (timer !== undefined) clearTimeout(timer)
    }
    const onAbort = (): void => {
      timer = setTimeout(() => {
        cleanup()
        reject(new UnsettledStopError())
      }, windowMs)
    }
    if (signal.aborted === true) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    void done.then(
      (outcome) => { cleanup(); resolve(outcome) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

/* ------------------------------------------------------------------- spawn */

/** Read one collected stream after settlement (batch result; lossy = truncated). */
function streamOf(reader: SubprocessOutputReader | undefined): SwExecStream {
  if (reader === undefined) return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...(read.spillPath !== undefined ? { spillPath: read.spillPath } : {}),
  }
}

/** The collect stdio the tools use: 1 MiB tail + 8 MiB spill (path to the model). */
const COLLECT_STDIO = {
  stdin: 'ignore',
  stdout: { maxBytes: SW_EXEC_OUTPUT_MAX_BYTES, spill: { maxBytes: SW_EXEC_OUTPUT_SPILL_MAX_BYTES } },
  stderr: { maxBytes: SW_EXEC_OUTPUT_MAX_BYTES, spill: { maxBytes: SW_EXEC_OUTPUT_SPILL_MAX_BYTES } },
} as const

/**
 * The sw_exec core: resolve the server, probe its OS, build the shell argv,
 * and run the command through the mixed provider with an `ssh://` cwd.
 * Unit tests and E2E scripts call this directly with a faceted env; the tool
 * wraps it.
 * @param env - server lookup + spawner (the tool builds it from the registry
 *   and `ctx.subprocess`).
 * @param server - registry machine id; `undefined` → the active machine.
 * @param command - the command text to execute (validated non-empty).
 * @param workdir - already-normalized: `ssh://` verbatim, a POSIX absolute
 *   path (interpreted on `server`), or `undefined` for the server's primary
 *   workspace. Relative values are rejected here (the tool layer resolves
 *   them against the session cwd).
 * @param timeoutMs - optional run bound overrides; omitted applies the
 *   executor default ({@link SW_EXEC_DEFAULT_TIMEOUT_MS}) and an override is
 *   clamped at {@link SW_EXEC_MAX_TIMEOUT_MS} (official bash executor
 *   semantics). Background jobs carry no timeout.
 * @param signal - the tool-call cancellation signal.
 * @param osCache - the process-local OS cache (per-registration instance).
 * @returns the canonical foreground result (non-zero exits are reported, not errored).
 */
export async function swExecCore(
  env: SwExecEnv,
  server: string | undefined,
  command: string,
  workdir: string | undefined,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  osCache: RemoteOsCache,
  tr: TranslateFn = EN_T,
): Promise<SwExecForeground> {
  if (command.trim() === '') throw new Error(tr('tool.param.error.commandEmpty'))
  const target = resolveSwExecServer(env, server, tr)
  const { cwd, machineId } = resolveSwExecCwd(workdir, target.connection.id, defaultRemoteDir(target.spec), tr)
  let connection = target.connection
  if (machineId !== target.connection.id) {
    // An explicit `ssh://<other>/…` workdir names its machine: the spawn cwd
    // routes there, so OS detection and the report header must follow it.
    connection = resolveSwExecServer(env, machineId, tr).connection
  }
  const os = await resolveRemoteOs(connection, signal, osCache)
  const argv = buildShellArgv(os, command)
  const effectiveTimeoutMs = resolveSwExecTimeout(timeoutMs)
  const deadline = makeSwExecDeadline(effectiveTimeoutMs, signal)
  let handle: SubprocessHandle
  try {
    handle = env.spawn({
      argv,
      cwd,
      stdio: COLLECT_STDIO,
      graceMs: SW_EXEC_KILL_GRACE_MS,
      signal: deadline.signal,
    })
  } catch (error) {
    deadline.dispose()
    throw error
  }
  let outcome: SubprocessOutcome
  try {
    // BUG-9: never await a remote handle unboundedly — a server that ignores
    // the whole stop chain must fail the call, not hang it.
    outcome = await awaitOutcomeOrStop(handle.done, deadline.signal)
  } catch (error) {
    deadline.dispose()
    if (error instanceof UnsettledStopError) {
      if (signal?.aborted === true) throw toolAbortError()
      throw new Error(tr('tool.error.stopFailed'))
    }
    throw new Error(tr('tool.sw_exec.error.spawnFailed', { detail: error instanceof Error ? error.message : String(error) }))
  }
  const stdout = streamOf(handle.collected?.stdout)
  const stderr = streamOf(handle.collected?.stderr)
  const timedOut = deadline.timedOut()
  deadline.dispose()
  return {
    kind: 'foreground',
    server: connection.id,
    endpoint: connection.endpoint,
    os,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut,
    aborted: false, // a caller abort throws at the tool layer (schema parity)
    timeoutMs: effectiveTimeoutMs,
    stdout,
    stderr,
  }
}

/* ------------------------------------------------------------------ jobs */

/** The minimal `ctx.jobs` face (dsh-jobs `start` contract, verified on disk). */
export interface BackgroundJobs {
  start(spec: {
    kind: string
    label: string
    owner?: unknown
    run(): { cancel(reason?: string): void; done: Promise<unknown>; readOutput?(): string }
  }): string
}

/** Map one settled subprocess outcome onto the job-outcome vocabulary. */
function jobOutcomeOf(outcome: SubprocessOutcome, tr: TranslateFn = EN_T): { status: 'completed' | 'killed'; detail: string } {
  if (outcome.signal !== null || outcome.exitCode === null) {
    return {
      status: 'killed',
      detail: outcome.signal !== null ? tr('tool.job.detail.signal', { sig: outcome.signal }) : tr('tool.job.detail.killed'),
    }
  }
  return { status: 'completed', detail: tr('tool.job.detail.exit', { code: outcome.exitCode }) }
}

/** The incremental readOutput hook: two cursors over the collect readers. */
function incrementalRead(handle: SubprocessHandle, tr: TranslateFn = EN_T): () => string {
  let stdoutOffset = 0
  let stderrOffset = 0
  return () => {
    const out = handle.collected?.stdout?.readFrom(stdoutOffset)
    const err = handle.collected?.stderr?.readFrom(stderrOffset)
    const parts: string[] = []
    if (out !== undefined) {
      stdoutOffset = out.nextOffset
      if (out.text.length > 0) parts.push(out.text)
      if (out.lossy) parts.push(tr('tool.output.dropped', { path: out.spillPath ?? '(unavailable)' }))
    }
    if (err !== undefined) {
      stderrOffset = err.nextOffset
      if (err.text.length > 0) parts.push(`${tr('tool.output.stderrMarker')}\n${err.text}`)
      if (err.lossy) parts.push(tr('tool.output.dropped', { path: err.spillPath ?? '(unavailable)' }))
    }
    return parts.join('\n')
  }
}

/* ------------------------------------------------------------------ render */

/** Render the shared body: stdout, marked stderr, then timeout/signal/exit markers. */
export function renderStreamBody(parts: {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  timeoutMs: number
  stdout: SwExecStream
  stderr: SwExecStream
}, tr: TranslateFn = EN_T): string {
  const streamText = (stream: SwExecStream): string =>
    stream.truncated
      ? `${stream.text}\n${tr('tool.output.truncated', { path: stream.spillPath ?? '(unavailable)' })}`
      : stream.text
  const out = streamText(parts.stdout)
  const err = streamText(parts.stderr)
  let body = out
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `${tr('tool.output.stderrMarker')}\n${err}`
  }
  if (body.length === 0) body = tr('tool.output.empty')
  const markers: string[] = []
  if (parts.timedOut) markers.push(tr('tool.output.timedOut', { ms: parts.timeoutMs }))
  if (parts.signal !== null) markers.push(tr('tool.output.killedSignal', { sig: parts.signal }))
  else if (parts.exitCode !== 0) markers.push(tr('tool.output.exitCode', { code: parts.exitCode }))
  if (markers.length === 0) return body
  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/** sw_exec foreground render: the honest `server/OS` header line first. */
export function renderSwExecForeground(value: SwExecForeground, tr: TranslateFn = EN_T): string {
  return `${tr('tool.sw_exec.output.header', { id: value.server, endpoint: value.endpoint, os: value.os })}\n${renderStreamBody(value, tr)}`
}

/* ------------------------------------------------------------------ schema */

const streamSchema = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    spillPath: { type: 'string' },
  },
} as const

const backgroundSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'background' },
    jobId: { type: 'string', required: true },
    server: { type: 'string', required: true },
    endpoint: { type: 'string', required: true },
  },
} as const

const foregroundSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'foreground' },
    server: { type: 'string', required: true },
    endpoint: { type: 'string', required: true },
    os: { type: 'string', required: true, enum: ['linux', 'win32', 'unknown'] },
    exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
    signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    timedOut: { type: 'boolean', required: true },
    aborted: { type: 'boolean', required: true },
    timeoutMs: { type: 'number', required: true },
    stdout: streamSchema,
    stderr: streamSchema,
  },
} as const

const swExecOutputSchema = { oneOf: [backgroundSchema, foregroundSchema] } as const

const bashBackgroundSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'background' },
    jobId: { type: 'string', required: true },
  },
} as const

const bashForegroundSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'foreground' },
    exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
    signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    timedOut: { type: 'boolean', required: true },
    aborted: { type: 'boolean', required: true },
    timeoutMs: { type: 'number', required: true },
    stdout: streamSchema,
    stderr: streamSchema,
  },
} as const

const bashOutputSchema = { oneOf: [bashBackgroundSchema, bashForegroundSchema] } as const

/** sw_exec parameter spec builder (descriptions localized per language). */
const swExecParams = (tr: TranslateFn, backgroundEnabled: boolean): ParameterSchemaSpec => ({
  command: { type: 'string', required: true, description: tr('tool.param.command') },
  description: { type: 'string', required: true, description: tr('tool.param.description') },
  timeoutMs: { type: 'number', description: tr('tool.param.timeout') },
  workdir: { type: 'string', description: tr('tool.sw_exec.param.workdir') },
  server: { type: 'string', description: tr('tool.sw_exec.param.server') },
  ...(backgroundEnabled ? { run_in_background: { type: 'boolean', description: tr('tool.param.runInBackground') } } : {}),
})

/** win32 bash parameter spec builder (descriptions localized per language). */
const bashParams = (tr: TranslateFn, backgroundEnabled: boolean): ParameterSchemaSpec => ({
  command: { type: 'string', required: true, description: tr('tool.param.command') },
  description: { type: 'string', required: true, description: tr('tool.param.description') },
  timeoutMs: { type: 'number', description: tr('tool.param.timeout') },
  workdir: { type: 'string', description: tr('tool.bash.param.workdir') },
  ...(backgroundEnabled ? { run_in_background: { type: 'boolean', description: tr('tool.param.runInBackground') } } : {}),
})

/* --------------------------------------------------------------- validation */

/** S1 arg validation, mirroring the official bash tool's validateBashArgs. */
export function validateSwExecArgs(args: SwExecArgs, tr: TranslateFn = EN_T): void {
  if (args.command.trim().length === 0) throw new Error(tr('tool.param.error.commandEmpty'))
  if (args.description.trim().length === 0) throw new Error(tr('tool.param.error.descriptionEmpty'))
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(tr('tool.param.error.timeoutInvalid', { v: JSON.stringify(args.timeoutMs) }))
  }
}

/** The win32 bash tool mirrors the official bash validation (no escalation args). */
export function validateBashToolArgs(args: Win32BashArgs, tr: TranslateFn = EN_T): void {
  if (args.command.trim().length === 0) throw new Error(tr('tool.param.error.commandEmpty'))
  if (args.description.trim().length === 0) throw new Error(tr('tool.param.error.descriptionEmpty'))
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(tr('tool.param.error.timeoutInvalid', { v: JSON.stringify(args.timeoutMs) }))
  }
}

/** The session cwd the tools need for server derivation and relative workdirs. */
function sessionCwdOf(exec: ToolRunContext): string | undefined {
  const agent = exec.agent as { readonly session?: { readonly header?: { readonly cwd?: string } } } | undefined
  return agent?.session?.header?.cwd
}

/** Resolve `ctx.subprocess` lazily (mixed provider; a missing seam is honest). */
function spawnerOf(ctx: Context, tr: TranslateFn = EN_T): { spawn(spec: SubprocessSpawnSpec): SubprocessHandle } {
  const value = ctx.get('subprocess', false) as { spawn(spec: SubprocessSpawnSpec): SubprocessHandle } | undefined
  if (value === undefined) {
    throw new Error(tr('tool.error.subprocessMissing'))
  }
  return value
}

/** The env face the tool builds from the registry accessor and `ctx.subprocess`. */
function swExecEnvOf(ctx: Context, registry: () => SshRegistry, tr: TranslateFn = EN_T): SwExecEnv {
  return {
    get: id => registry().get(id),
    getActive: () => registry().getActive(),
    listMachines: () => registry().listMachines(),
    spawn: spec => spawnerOf(ctx, tr).spawn(spec),
  }
}

/** Require the job registry with the same wording as the official bash tool. */
function jobsOf(ctx: Context, tr: TranslateFn = EN_T): BackgroundJobs {
  const jobs = ctx.get('jobs', false) as BackgroundJobs | undefined
  if (jobs === undefined) {
    throw new Error(tr('tool.error.jobsUnavailable'))
  }
  return jobs
}

/* --------------------------------------------------------- tool registration */

/**
 * Register the `sw_exec` tool plus its `tool:sw-exec` prompt section (S1).
 * The tool is registered on every platform — the server makes it remote-only.
 * All side effects are effect-bound (unmount removes the tool + section).
 * @param ctx - the mounting context.
 * @param registry - the machine registry accessor (server id lookup).
 * @param opts - `enableRunInBackground` mirrors the official bash flag
 *   (`?? true`); background requires `ctx.jobs` and errors honestly when absent.
 *   `sides` is the side-workspace store accessor and `connections` the
 *   connected-machine store accessor: together with the session cwd route they
 *   decide (a) whether the model-facing section is injected at all
 *   (REQ-I6 ② + REQ-I11: a local session with no attachments AND no connected
 *   machine gets zero prompt text) and (b) which servers this session may
 *   execute on (ADR-0021 §2.5).
 */
export function registerSwExec(
  ctx: Context,
  registry: () => SshRegistry,
  opts: {
    enableRunInBackground?: boolean
    sides?: () => SessionSideWorkspaceStore | undefined
    connections?: () => SessionConnectionsFace | undefined
  } = {},
): void {
  const backgroundEnabled = opts.enableRunInBackground ?? true
  const locale = hostLocaleOf(ctx)
  const t = locale.t
  const osCache = createRemoteOsCache()
  const backgroundSentenceKey: DswKey = backgroundEnabled ? 'tool.common.backgroundSentence' : 'tool.common.backgroundUnavailable'
  const describe = (tr: TranslateFn): string => `${tr('tool.sw_exec.description')} ${tr(backgroundSentenceKey)}`
  const tool = defineTool({
    name: 'sw_exec',
    description: describe(ZH_T),
    // Baseline parameter spec (ZH descriptions): inline so defineTool's
    // precise generic inference (args typing + validation closure) is
    // preserved; the localized spec lives in the `parameters` getter below.
    parameters: {
      command: { type: 'string', required: true, description: ZH_T('tool.param.command') },
      description: { type: 'string', required: true, description: ZH_T('tool.param.description') },
      timeoutMs: { type: 'number', description: ZH_T('tool.param.timeout') },
      workdir: { type: 'string', description: ZH_T('tool.sw_exec.param.workdir') },
      server: { type: 'string', description: ZH_T('tool.sw_exec.param.server') },
      ...(backgroundEnabled ? { run_in_background: { type: 'boolean', description: ZH_T('tool.param.runInBackground') } } : {}),
    },
    output: {
      schema: swExecOutputSchema,
      render: (_args, value) => {
        const record = value as { kind?: string; jobId?: string; server?: string; endpoint?: string }
        const text = record.kind === 'background'
          ? t('tool.sw_exec.output.background', {
            jobId: String(record.jobId),
            server: String(record.server),
            endpoint: String(record.endpoint),
          })
          : renderSwExecForeground(value as SwExecForeground, t)
        return [{ type: 'text', text }]
      },
    },
    async execute(args, exec: ToolRunContext): Promise<SwExecBackground | SwExecForeground> {
      validateSwExecArgs(args, t)
      const env = swExecEnvOf(ctx, registry, t)
      const sessionCwd = sessionCwdOf(exec)
      const route = remoteRouteFromCwd(sessionCwd)
      // REQ-I11 / ADR-0021 §2.5: the session gate runs FIRST and fails closed.
      // The store accessor is OPTIONAL only for compositions that never mount
      // it (the tool then behaves as it did before REQ-I11).
      const connections = opts.connections
      let connected: ConnectedMachines | null = null
      if (connections !== undefined) {
        connected = connectedMachinesOf(
          sessionCwd,
          sessionIdOf({ ...(exec.agent !== undefined ? { scope: exec.agent as object } : {}) }),
          sessionId => connections()?.listFor(sessionId) ?? [],
          registry(),
        )
      }
      const requested = args.server !== undefined && args.server.trim() !== '' ? args.server.trim() : undefined
      const serverId = requested ?? route?.connectionId
      if (connected !== null) {
        requireConnectedServer(connected, requested, env.listMachines().machines.map(machine => machine.id), t)
      }
      if (serverId === undefined) {
        throw new Error(t('tool.sw_exec.error.serverRequired'))
      }
      const workdir = normalizeSwExecWorkdir(args.workdir, route !== null ? { id: route.connectionId, path: route.path } : null, t)
      // A `ssh://<other>/…` workdir names a machine of its own; it must be
      // connected to this session too, or the gate would be bypassable by
      // moving the machine id from `server` into `workdir`.
      if (connected !== null && workdir !== undefined && workdir.startsWith('ssh://')) {
        const workdirRoute = parseSshRoute(workdir)
        if (workdirRoute !== null) {
          requireConnectedServer(connected, workdirRoute.id, env.listMachines().machines.map(machine => machine.id), t)
        }
      }
      if (args.run_in_background === true) {
        if (!backgroundEnabled) throw new Error(t('tool.error.backgroundDisabled'))
        const jobs = jobsOf(ctx, t)
        // Official bash contract: an already-cancelled call must never register
        // an orphan background job.
        if (exec.signal.aborted === true) throw toolAbortError()
        const target = resolveSwExecServer(env, serverId, t)
        const { cwd, machineId } = resolveSwExecCwd(workdir, target.connection.id, defaultRemoteDir(target.spec), t)
        const connection = machineId === target.connection.id
          ? target.connection
          : resolveSwExecServer(env, machineId, t).connection
        // The OS probe is async and the job hook `run` is synchronous — probe
        // BEFORE registering, then the hook waits on nothing but the spawn.
        const os = await resolveRemoteOs(connection, exec.signal, osCache)
        const argv = buildShellArgv(os, args.command)
        const jobId = jobs.start({
          kind: SW_EXEC_JOB_KIND,
          label: `${connection.id}: ${args.command}`,
          ...(exec.agent !== undefined ? { owner: exec.agent } : {}),
          run: () => {
            const handle = env.spawn({
              argv,
              cwd,
              stdio: COLLECT_STDIO,
              graceMs: SW_EXEC_KILL_GRACE_MS,
            })
            const readOutput = incrementalRead(handle, t)
            return {
              cancel: () => handle.terminate(),
              done: handle.done.then(jobOutcomeOf, error =>
                ({ status: 'failed' as const, detail: error instanceof Error ? error.message : String(error) })),
              readOutput,
            }
          },
        })
        return { kind: 'background', jobId, server: connection.id, endpoint: connection.endpoint }
      }
      const foreground = await swExecCore(env, serverId, args.command, workdir, args.timeoutMs, exec.signal, osCache, t)
      if (exec.signal.aborted === true) throw toolAbortError()
      return foreground
    },
  })
  // Route-B localization (drafts/i18n-design.md §6.2): the description is
  // composed (base + background sentence) and both properties re-read the
  // host language on every schemas() projection — see note on localizeTool.
  Object.defineProperty(tool, 'description', {
    get: () => describe(locale.t),
  })
  Object.defineProperty(tool, 'parameters', {
    get: () => parameterSchemaSpecToJsonSchema(swExecParams(locale.t, backgroundEnabled)) as unknown as Record<string, unknown>,
  })
  const disposer = ctx.tools.register(tool)
  ctx.effect(() => disposer, 'sw-exec tool')
  const sectionDisposer = ctx.systemPrompt.section({
    name: 'tool:sw-exec',
    order: 105,
    // REQ-I6 ② + REQ-I11 (ADR-0021 §2.8): model-facing, ENGLISH ONLY
    // (ADR-0014), injected when the session is in the remote workspace world —
    // a remote cwd route, a side workspace, or at least one connected machine.
    // A plain local session with zero connections sees no sw_exec prompt text
    // at all, even though the tool stays globally registered.
    text: (context) => (hasRemoteSessionContext(context, opts.sides, opts.connections) ? modelPrompt('sectionSwExec') : ''),
  })
  ctx.effect(() => sectionDisposer, 'tool:sw-exec system prompt section')
}

/**
 * Resolve the win32 bash tool's cwd with the official resolveWorkdir
 * semantics: an explicit absolute path wins, a relative one is
 * session-cwd-relative, an explicit `ssh://` route is used verbatim (a route
 * is not a host path), and an omitted workdir is the session cwd.
 */
export function resolveWin32BashWorkdir(modelWorkdir: string | undefined, sessionCwd: string | undefined): string | undefined {
  if (modelWorkdir === undefined) return sessionCwd
  if (modelWorkdir.startsWith('ssh://')) return modelWorkdir
  if (sessionCwd !== undefined && !isAbsolute(modelWorkdir)) return resolve(sessionCwd, modelWorkdir)
  return modelWorkdir
}

/**
 * Register the win32 bash seam plus its `tool:bash` prompt section (S2 / REQ-I16).
 * NO-OP on POSIX hosts — the official bash tool owns the `bash` name and the
 * `tool:bash` section there. On Windows the section is global (empty unless the
 * session has a remote workspace). The **tool** is injected per agent when
 * `agent/created` reports a remote cwd — local Windows sessions do not see it.
 * @param ctx - the mounting context.
 * @param registry - reserved: routing is cwd-based; the accessor keeps the
 *   calling convention uniform with `registerSwExec`.
 * @param options - `platform` injectable for tests; `enableRunInBackground`
 *   mirrors the official bash flag (`?? true`); `sides` is the side-workspace
 *   store accessor used by the REQ-I6 ② injection decision; `forceRegister`
 *   is the test harness that binds the tool on `ctx` immediately.
 */
export function registerWin32Bash(
  ctx: Context,
  registry: () => SshRegistry,
  options: {
    platform?: NodeJS.Platform
    enableRunInBackground?: boolean
    sides?: () => SessionSideWorkspaceStore | undefined
    /**
     * REQ-I11: the session connection store, so this tool applies the SAME gate
     * `sw_exec` does. This is the plugin's OWN exec face: without the gate it
     * would be the one exec surface a model could use to reach a registered but
     * unconnected machine (the official `bash`/`pwsh` bypass is documented as
     * structural; ours need not be).
     */
    connections?: () => SessionConnectionsFace | undefined
    /**
     * Test harness: bind the tool on `ctx` immediately. Production injects
     * via `agent/created` onto `agent.ctx` when the session cwd is remote.
     */
    forceRegister?: boolean
  } = {},
): void {
  if ((options.platform ?? process.platform) !== 'win32') return
  const backgroundEnabled = options.enableRunInBackground ?? true
  const locale = hostLocaleOf(ctx)
  const t = locale.t
  const backgroundSentenceKey: DswKey = backgroundEnabled ? 'tool.common.backgroundSentence' : 'tool.common.backgroundUnavailable'
  const describe = (tr: TranslateFn): string => `${tr('tool.bash.description')} ${tr(backgroundSentenceKey)}`
  const tool = defineTool({
    name: 'bash',
    description: describe(ZH_T),
    // Baseline parameter spec (ZH descriptions), see registerSwExec.
    parameters: {
      command: { type: 'string', required: true, description: ZH_T('tool.param.command') },
      description: { type: 'string', required: true, description: ZH_T('tool.param.description') },
      timeoutMs: { type: 'number', description: ZH_T('tool.param.timeout') },
      workdir: { type: 'string', description: ZH_T('tool.bash.param.workdir') },
      ...(backgroundEnabled ? { run_in_background: { type: 'boolean', description: ZH_T('tool.param.runInBackground') } } : {}),
    },
    output: {
      schema: bashOutputSchema,
      render: (_args, value) => {
        const record = value as { kind?: string; jobId?: string }
        const text = record.kind === 'background'
          ? t('tool.bash.output.background', { jobId: String(record.jobId) })
          : renderStreamBody(value as BashForeground, t)
        return [{ type: 'text', text }]
      },
    },
    async execute(args, exec: ToolRunContext): Promise<BashBackground | BashForeground> {
      validateBashToolArgs(args, t)
      const cwd = resolveWin32BashWorkdir(args.workdir, sessionCwdOf(exec))
      if (cwd === undefined || worldOfCwd(cwd) === 'local') {
        // t15-r2 (captain decision F4): the guard follows the SAME host-language
        // rule as every other model-facing message (settings preference ?? en;
        // no preference → en) — a design-rule unification, not a regression.
        // A no-settings composition (tests) therefore sees the EN wording.
        throw new Error(t('tool.bash.error.localSession'))
      }
      // REQ-I11 / ADR-0021 §2.5: OUR exec face carries the session gate too. The
      // cwd decides the route (`resolveWin32BashWorkdir` keeps an explicit
      // `ssh://` workdir verbatim), so an unconnected — or unknown — machine is
      // refused here exactly like `sw_exec` refuses it. A composition without
      // the store keeps the previous behaviour (`sw_exec` has the same rule).
      const connectionStore = options.connections?.()
      const route = remoteRouteFromCwd(cwd)
      if (connectionStore !== undefined && route !== null) {
        const connected = connectedMachinesOf(
          sessionCwdOf(exec),
          sessionIdOf({ ...(exec.agent !== undefined ? { scope: exec.agent as object } : {}) }),
          sessionId => connectionStore.listFor(sessionId),
          registry(),
        )
        requireConnectedServer(connected, route.connectionId, registry().listMachines().machines.map(machine => machine.id), t)
      }
      if (args.run_in_background === true) {
        if (!backgroundEnabled) throw new Error(t('tool.error.backgroundDisabled'))
        const jobs = jobsOf(ctx, t)
        // Official bash contract: an already-cancelled call must never register
        // an orphan background job.
        if (exec.signal.aborted === true) throw toolAbortError()
        const jobId = jobs.start({
          kind: 'bash',
          label: args.command,
          ...(exec.agent !== undefined ? { owner: exec.agent } : {}),
          run: () => {
            const handle = spawnerOf(ctx, t).spawn({
              argv: ['bash', '-c', args.command],
              cwd,
              stdio: COLLECT_STDIO,
              graceMs: SW_EXEC_KILL_GRACE_MS,
            })
            const readOutput = incrementalRead(handle, t)
            return {
              cancel: () => handle.terminate(),
              done: handle.done.then(jobOutcomeOf, error =>
                ({ status: 'failed' as const, detail: error instanceof Error ? error.message : String(error) })),
              readOutput,
            }
          },
        })
        return { kind: 'background', jobId }
      }
      const effectiveTimeoutMs = resolveSwExecTimeout(args.timeoutMs)
      const deadline = makeSwExecDeadline(effectiveTimeoutMs, exec.signal)
      let handle: SubprocessHandle
      try {
        handle = spawnerOf(ctx, t).spawn({
          argv: ['bash', '-c', args.command],
          cwd,
          stdio: COLLECT_STDIO,
          graceMs: SW_EXEC_KILL_GRACE_MS,
          signal: deadline.signal,
        })
      } catch (error) {
        deadline.dispose()
        throw error
      }
      let outcome: SubprocessOutcome
      try {
        // BUG-9: bounded stop window — see swExecCore.
        outcome = await awaitOutcomeOrStop(handle.done, deadline.signal)
      } catch (error) {
        deadline.dispose()
        if (error instanceof UnsettledStopError) {
          if (exec.signal.aborted === true) throw toolAbortError()
          throw new Error(t('tool.error.stopFailed'))
        }
        throw new Error(t('tool.bash.error.spawnFailed', { detail: error instanceof Error ? error.message : String(error) }))
      }
      const stdout = streamOf(handle.collected?.stdout)
      const stderr = streamOf(handle.collected?.stderr)
      const timedOut = deadline.timedOut()
      deadline.dispose()
      if (exec.signal.aborted === true) throw toolAbortError()
      return {
        kind: 'foreground',
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        timedOut,
        aborted: false,
        timeoutMs: effectiveTimeoutMs,
        stdout,
        stderr,
      }
    },
  })
  // Route-B localization (composed description, see registerSwExec).
  Object.defineProperty(tool, 'description', {
    get: () => describe(locale.t),
  })
  Object.defineProperty(tool, 'parameters', {
    get: () => parameterSchemaSpecToJsonSchema(bashParams(locale.t, backgroundEnabled)) as unknown as Record<string, unknown>,
  })
  const inject = (target: Context): void => {
    try {
      const disposer = target.tools.register(tool)
      if (typeof target.effect === 'function') target.effect(() => disposer, 'win32 bash tool')
    } catch {
      // Duplicate name or a disposed agent scope must never veto `agent/created`.
    }
  }
  if (options.forceRegister === true) {
    inject(ctx)
  } else if (typeof ctx.on === 'function' && typeof ctx.effect === 'function') {
    const onCreated = (payload: {
      agent?: { ctx?: Context; session?: { header?: { cwd?: string } } }
    }): void => {
      const cwd = payload.agent?.session?.header?.cwd
      if (cwd === undefined || worldOfCwd(cwd) !== 'remote') return
      const agentCtx = payload.agent?.ctx
      if (agentCtx === undefined) return
      inject(agentCtx)
    }
    ctx.effect(() => ctx.on('agent/created' as never, onCreated as never), 'win32 bash session inject')
  }
  const sectionDisposer = ctx.systemPrompt.section({
    name: 'tool:bash',
    order: 105,
    // REQ-I6 + REQ-I16: English only (ADR-0014). Empty on a local Windows
    // session; the tool itself is also absent there (scoped register).
    text: (context) => (hasRemoteWorkspaceContext(context, options.sides) ? modelPrompt('sectionBash') : ''),
  })
  ctx.effect(() => sectionDisposer, 'tool:bash system prompt section')
}
