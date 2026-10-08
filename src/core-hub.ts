/**
 * REQ-I5 / ADR-0024: live `dsh-core serve` cache.
 *
 * Key is `(machineId, confinementMode, workspaceRoot?)` — not "one process
 * per SSH connection". `off` (session danger-full-access) is one unjailed
 * serve per machine. A dead session is fail-closed for confined **writes and
 * spawn**; REQ-I15 lets confined **reads** fall back to SFTP. danger may fall
 * back to SFTP via {@link CoreMissingError}.
 *
 * @module dsh-workspace-enhancement/core-hub
 */

import type { Context } from '@deepseek-ai/cordis'
import { CoreClient } from './core-client.ts'
import {
  CORE_ARTIFACT_ARCH,
  CORE_ARTIFACT_VERSION,
  CORE_CAPS,
  CORE_COMPAT_HASHES,
  coreVersionAccepted,
  CORE_ERROR_SANDBOX,
  CORE_PROTO,
  CORE_REMOTE_HOME,
} from './core-protocol.ts'
import { CoreRpcError } from './core-client.ts'
import {
  CORE_IDLE_MS,
  coreSessionKey,
  resolveCoreWorkspace,
  uniquePosixRoots,
} from './core-session.ts'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { parseSshRoute } from './registry.ts'
import { createCoreGapAsker } from './core-provision.ts'
import { quoteShellArg, startExec } from './ssh-core.ts'
import type { ExecOutcome } from './ssh-core.ts'
import { remoteRouteFromCwd } from './transport.ts'
import { remoteSandboxDepsOf, remoteSandboxUnavailable } from './remote-sandbox-fence.ts'
import type { RemoteSandboxDeps } from './remote-sandbox-fence.ts'
import {
  CoreMissingError,
  coreServeSandboxOf,
  initiatorSessionOf,
  isConfinedSandboxMode,
  resolveRemoteSessionMode,
} from './remote-policy.ts'
import type { CoreServeSandbox } from './remote-policy.ts'
import {
  REMOTE_SANDBOX_MESSAGES,
  RemoteSandboxError,
  interpolate,
} from './remote-sandbox.ts'
import type { SshTransport } from './transport.ts'

export interface CoreStatusView {
  ok: boolean
  version?: string | undefined
  arch?: string | undefined
  proto?: number | undefined
  caps?: readonly string[] | undefined
  detail?: string | undefined
}

export interface CoreOpenRequest {
  connectionId: string
  mode: CoreServeSandbox
  workspace?: string | undefined
  signal?: AbortSignal | undefined
  transport: SshTransport
}

export type CoreSessionOpener = (request: CoreOpenRequest) => Promise<CoreClient>

/**
 * REQ-I14 first-use approval: the hub asks this once when a **confined** open
 * fails and the ON-DISK artifact is verifiably missing or stale. Resolving
 * `true` means "the matching core is deployed now; retry the open" — the hub
 * then re-execs `current` exactly once. Any other ending (no approval service,
 * denied, deploy failed) falls through to the original fail-closed error.
 */
export type CoreGapResolver = (connectionId: string, facts: {
  /** Disk-reported core version; `undefined` when no core answered. */
  found: string | undefined
  /** The version this plugin ships and requires. */
  expected: string
  /** Cancellation lifetime of the blocked operation, when one exists. */
  signal?: AbortSignal | undefined
}) => Promise<boolean>

export interface CoreRequireOpts {
  /** Session / spawn cwd — may mint a sibling workspace-write jail. */
  cwd?: string | undefined
  /** Operation path (fs target, browse listing) — match only, never mint. */
  path?: string | undefined
  signal?: AbortSignal | undefined
  /** Session `/permission` (or escalation overlay). Absent → resolve from ctx. */
  policy?: SandboxMode | undefined
}

export interface CoreHub {
  require(connectionId: string, opts?: CoreRequireOpts): Promise<CoreClient>
  peek(connectionId: string, opts?: CoreRequireOpts): CoreClient | undefined
  /** Keep the matching serve off the idle timer until the disposer runs (spawn jobs). */
  hold(connectionId: string, opts?: CoreRequireOpts): () => void
  status(connectionId: string, signal?: AbortSignal): Promise<CoreStatusView>
  close(connectionId: string): void
}

interface LiveSession {
  key: string
  connectionId: string
  workspace: string | undefined
  client: CoreClient
  busy: number
  idle: ReturnType<typeof setTimeout> | undefined
  unsubClose: () => void
  unsubActivity: () => void
}

/** Shell command that execs the installed core in the login user's home. */
export function coreServeCommand(mode: CoreServeSandbox, workspace?: string): string {
  const bin = '"$HOME"/.dsh-core/current/dsh-core'
  const parts = [bin, 'serve', '--sandbox', quoteShellArg(mode)]
  if (mode !== 'off' && workspace !== undefined && workspace !== '') {
    parts.push('--workspace', quoteShellArg(workspace))
  }
  return parts.join(' ')
}

export function coreVersionCommand(): string {
  return '"$HOME"/.dsh-core/current/dsh-core version'
}

/** On-disk binary hash probe for the REQ-I17 provenance gate. */
export function coreBinaryHashCommand(): string {
  return 'sha256sum -- "$HOME"/.dsh-core/current/dsh-core'
}

/** Whether a hashed binary is one this plugin shipped (the compat list). */
export function isKnownCoreBinary(hash: string | undefined): boolean {
  return hash !== undefined && (CORE_COMPAT_HASHES as readonly string[]).includes(hash.toLowerCase())
}

export function coreArtifactName(): string {
  return `dsh-core-${CORE_ARTIFACT_VERSION}-${CORE_ARTIFACT_ARCH}.tar.gz`
}

async function openOverSsh(request: CoreOpenRequest): Promise<CoreClient> {
  const client = await request.transport.getClient(request.signal)
  const command = coreServeCommand(request.mode, request.workspace)
  const stderrChunks: Buffer[] = []
  const channel = await startExec(
    client,
    command,
    {
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
      onStderr: (chunk) => { stderrChunks.push(chunk) },
    },
  )
  return new CoreClient(channel, channel, {
    stderrOf: () => Buffer.concat(stderrChunks).toString('utf8'),
  })
}

function sideRootsOf(ctx: Context, connectionId: string): string[] {
  if (typeof ctx.get !== 'function') return []
  const store = ctx.get('sideWorkspaces', false) as { list?: () => readonly { kind: string; rootKey: string }[] } | undefined
  if (store === undefined || typeof store.list !== 'function') return []
  const out: string[] = []
  for (const item of store.list()) {
    if (item.kind !== 'remote') continue
    const route = parseSshRoute(item.rootKey)
    if (route === null || route.id !== connectionId) continue
    out.push(route.path)
  }
  return uniquePosixRoots(out)
}

/**
 * Build the hub. Tests inject `open` (a fake client); production uses SSH exec.
 * `idleMs: 0` disables idle-kill (unit tests that would otherwise pin the event loop).
 */
export function createCoreHub(
  ctx: Context,
  options: {
    deps?: RemoteSandboxDeps
    open?: CoreSessionOpener
    statusOf?: (connectionId: string, signal?: AbortSignal) => Promise<CoreStatusView>
    idleMs?: number
    /** REQ-I14: approval-backed core deploy on a confined open's missing/stale gap. */
    resolveGap?: CoreGapResolver
  } = {},
): CoreHub {
  const deps = options.deps ?? remoteSandboxDepsOf(ctx)
  const open = options.open ?? openOverSsh
  const idleMs = options.idleMs ?? CORE_IDLE_MS
  const resolveGap = options.resolveGap
  const live = new Map<string, LiveSession>()
  const known = new Map<string, Set<string>>()
  const opening = new Map<string, Promise<CoreClient>>()
  /** Confined open failures (missing binary/cap). Cleared by close/deploy. */
  const blocked = new Map<string, Error>()

  const remember = (connectionId: string, workspace: string | undefined): void => {
    if (workspace === undefined || workspace === '/') return
    let set = known.get(connectionId)
    if (set === undefined) {
      set = new Set()
      known.set(connectionId, set)
    }
    set.add(workspace)
  }

  const clearBlocked = (connectionId: string): void => {
    const prefix = `${connectionId}\0`
    for (const key of [...blocked.keys()]) {
      if (key.startsWith(prefix)) blocked.delete(key)
    }
  }

  const knownRootsOf = (connectionId: string): string[] => {
    const machine = deps.machine(connectionId)
    const initiator = remoteRouteFromCwd(initiatorSessionOf(ctx)?.header?.cwd)
    const declared = uniquePosixRoots([
      machine?.workspace,
      machine?.cwd,
      initiator?.connectionId === connectionId ? initiator.path : undefined,
      ...sideRootsOf(ctx, connectionId),
    ])
    const remembered = known.get(connectionId)
    if (remembered === undefined) return declared
    if (declared.length === 0) return uniquePosixRoots([...remembered])
    for (const root of [...remembered]) {
      const stillDeclared = declared.some(item => root === item || root.startsWith(`${item}/`))
      if (!stillDeclared) remembered.delete(root)
    }
    return uniquePosixRoots([...declared, ...remembered])
  }

  const policyOf = (opts?: CoreRequireOpts): SandboxMode =>
    opts?.policy ?? resolveRemoteSessionMode(ctx)

  const workspaceOf = (
    connectionId: string,
    serve: CoreServeSandbox,
    opts?: CoreRequireOpts,
  ): string | undefined => {
    const machine = deps.machine(connectionId)
    const posixOf = (value: string | undefined): string | undefined =>
      remoteRouteFromCwd(value)?.path ?? value
    return resolveCoreWorkspace({
      mode: serve,
      machineWorkspace: machine?.workspace,
      machineCwd: machine?.cwd,
      cwd: posixOf(opts?.cwd),
      path: posixOf(opts?.path),
      knownRoots: knownRootsOf(connectionId),
    })
  }

  const keyOf = (connectionId: string, opts?: CoreRequireOpts): string => {
    const serve = coreServeSandboxOf(policyOf(opts))
    return coreSessionKey(connectionId, serve, workspaceOf(connectionId, serve, opts))
  }

  const clearIdle = (session: LiveSession): void => {
    if (session.idle === undefined) return
    clearTimeout(session.idle)
    session.idle = undefined
  }

  const drop = (session: LiveSession, kill: boolean): void => {
    if (live.get(session.key) !== session) return
    live.delete(session.key)
    clearIdle(session)
    session.unsubActivity()
    session.unsubClose()
    if (kill) session.client.close()
  }

  const scheduleIdle = (session: LiveSession): void => {
    clearIdle(session)
    if (idleMs <= 0 || session.busy > 0 || live.get(session.key) !== session) return
    session.idle = setTimeout(() => { drop(session, true) }, idleMs)
    if (typeof session.idle === 'object' && session.idle !== null && typeof session.idle.unref === 'function') {
      session.idle.unref()
    }
  }

  const attach = (session: LiveSession): void => {
    session.unsubActivity = session.client.onActivity(() => { scheduleIdle(session) })
    session.unsubClose = session.client.onClose(() => { drop(session, false) })
    scheduleIdle(session)
  }

  /** Minimal exec face the on-disk artifact probe needs. */
  interface DiskProbeFace {
    exec(command: string, opts?: { signal?: AbortSignal }): Promise<ExecOutcome>
  }

  /**
   * REQ-I14: what `~/.dsh-core/current/dsh-core version` says on disk. `ok`
   * false means "no usable artifact answered" — the gap the deploy path owns.
   */
  const diskVersionOf = async (
    connection: DiskProbeFace,
    signal: AbortSignal | undefined,
  ): Promise<{ ok: boolean; version: string | undefined }> => {
    try {
      const outcome = await connection.exec(
        coreVersionCommand(),
        signal !== undefined ? { signal } : undefined,
      )
      if (outcome.exitCode !== 0) return { ok: false, version: undefined }
      const parsed = JSON.parse(outcome.stdout) as { version?: unknown }
      return {
        ok: true,
        version: typeof parsed.version === 'string' ? parsed.version : undefined,
      }
    } catch {
      return { ok: false, version: undefined }
    }
  }

  /**
   * REQ-I17 provenance gate: hash the on-disk binary the serve was exec'd
   * from (`current`) over the control channel — the version string is
   * self-reported, the sha256 of the file is not. A live serve stays trusted
   * without re-checks: the running process was vetted at ITS open, and a later
   * file swap cannot change an already-running inode.
   */
  const coreBinaryHashOf = async (
    connection: DiskProbeFace,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> => {
    try {
      const outcome = await connection.exec(
        coreBinaryHashCommand(),
        signal !== undefined ? { signal } : undefined,
      )
      if (outcome.exitCode !== 0) return undefined
      return /^([0-9a-f]{64})\b/u.exec(outcome.stdout.trim().toLowerCase())?.[1]
    } catch {
      return undefined
    }
  }

  const requireSession = async (
    connectionId: string,
    opts?: CoreRequireOpts,
  ): Promise<CoreClient> => {
    const policy = policyOf(opts)
    const serve = coreServeSandboxOf(policy)
    const confined = isConfinedSandboxMode(policy)
    const workspace = workspaceOf(connectionId, serve, opts)
    const key = coreSessionKey(connectionId, serve, workspace)
    const existing = live.get(key)
    if (existing !== undefined) {
      // REQ-I17: a live serve that outlived a `current` flip is a stale fence.
      // The cached hello names the binary the serve was exec'd from, so this
      // reuse check is one cache read — never an RPC.
      const cachedHello = await existing.client.hello().catch(() => undefined)
      if (cachedHello === undefined || coreVersionAccepted(cachedHello.version)) {
        scheduleIdle(existing)
        return existing.client
      }
      drop(existing, true)
    }
    const cached = blocked.get(key)
    if (cached !== undefined) throw cached
    const pending = opening.get(key)
    if (pending !== undefined) return pending

    const attempt = (async (): Promise<CoreClient> => {
      const connection = deps.connection(connectionId)
      const machine = deps.machine(connectionId)
      const refuseMode = serve === 'off' ? 'read-only' : serve
      if (connection === undefined || machine === undefined) {
        throw remoteSandboxUnavailable(refuseMode, `machine ${JSON.stringify(connectionId)} is not usable`)
      }
      if (serve === 'workspace-write' && (workspace === undefined || workspace === '' || workspace === '/')) {
        throw remoteSandboxUnavailable(refuseMode, REMOTE_SANDBOX_MESSAGES.workspaceRootRequired)
      }

      const openOnce = async (): Promise<CoreClient> => {
        let client: CoreClient | undefined
        try {
          client = await open({
            connectionId,
            mode: serve,
            transport: connection as unknown as SshTransport,
            ...(workspace !== undefined ? { workspace } : {}),
            ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
          })
          // Hello is the serve's birth certificate (ADR-0024). Do not tie it to
          // the first tool's AbortSignal — that signal aborting used to kill the
          // channel (`core stdout closed`) and fail the whole turn.
          const hello = await client.hello()
          if (hello.proto !== CORE_PROTO) {
            throw remoteSandboxUnavailable(refuseMode, `core proto ${String(hello.proto)} is not ${CORE_PROTO}`)
          }
          for (const cap of CORE_CAPS) {
            if (!hello.caps.includes(cap)) {
              throw remoteSandboxUnavailable(refuseMode, `core is missing cap ${cap}`)
            }
          }
          // REQ-I17 version gate (width relaxed 2026-09-30): confined work
          // runs cores of the SHIPPED major.minor — patch drift is
          // dependency-style compatible; a minor/major step refuses.
          // danger/off degrade to SFTP through CoreMissingError —
          // the ADR's "danger/off 不挡" — instead of an out-of-range binary.
          if (!coreVersionAccepted(hello.version)) {
            const detail = interpolate(REMOTE_SANDBOX_MESSAGES.coreVersionMismatch, {
              found: hello.version,
              expected: CORE_ARTIFACT_VERSION,
            })
            if (!confined) throw new CoreMissingError(detail)
            throw remoteSandboxUnavailable(refuseMode, detail)
          }
          // REQ-I17 provenance gate: same refusal ladder as the version gate —
          // confined refuses, danger falls back to SFTP (never runs the
          // untrusted binary either way).
          const binaryHash = await coreBinaryHashOf(connection, opts?.signal)
          if (!isKnownCoreBinary(binaryHash)) {
            const detail = interpolate(REMOTE_SANDBOX_MESSAGES.coreProvenance, {
              found: binaryHash ?? 'unreadable',
            })
            if (!confined) throw new CoreMissingError(detail)
            throw remoteSandboxUnavailable(refuseMode, detail)
          }
          if (client === undefined) {
            throw remoteSandboxUnavailable(refuseMode, 'core session opened without a client')
          }
          return client
        } catch (error) {
          client?.close()
          throw error
        }
      }

      const mapOpenError = (error: unknown): Error => {
        if (error instanceof RemoteSandboxError) {
          if (confined) blocked.set(key, error)
          return error
        }
        const detail = error instanceof Error ? error.message : String(error)
        if (!confined) return new CoreMissingError(detail)
        const refusal = remoteSandboxUnavailable(refuseMode, detail)
        blocked.set(key, refusal)
        return refusal
      }

      let client: CoreClient
      try {
        client = await openOnce()
      } catch (error) {
        // REQ-I14 first-use approval: only when the DISK artifact is verifiably
        // missing/stale (a bwrap-less host or a dead network is not a deploy
        // gap), only once per attempt, and only for confined callers.
        if (!confined || resolveGap === undefined) throw mapOpenError(error)
        const disk = await diskVersionOf(connection, opts?.signal)
        if (disk.ok && coreVersionAccepted(disk.version ?? '')) throw mapOpenError(error)
        let resolved = false
        try {
          resolved = await resolveGap(connectionId, {
            found: disk.version,
            expected: CORE_ARTIFACT_VERSION,
            ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
          })
        } catch {
          resolved = false
        }
        if (!resolved) throw mapOpenError(error)
        try {
          client = await openOnce()
        } catch (retryError) {
          throw mapOpenError(retryError)
        }
      }
      remember(connectionId, workspace)
      blocked.delete(key)
      const session: LiveSession = {
        key,
        connectionId,
        workspace,
        client,
        busy: 0,
        idle: undefined,
        unsubClose: () => {},
        unsubActivity: () => {},
      }
      live.set(key, session)
      attach(session)
      return client
    })().finally(() => { opening.delete(key) })

    opening.set(key, attempt)
    return attempt
  }

  const peek = (connectionId: string, opts?: CoreRequireOpts): CoreClient | undefined => {
    if (opts !== undefined) {
      return live.get(keyOf(connectionId, opts))?.client
    }
    for (const session of live.values()) {
      if (session.connectionId === connectionId) return session.client
    }
    return undefined
  }

  const hold = (connectionId: string, opts?: CoreRequireOpts): () => void => {
    const session = live.get(keyOf(connectionId, opts))
    if (session === undefined) return () => {}
    session.busy += 1
    clearIdle(session)
    let released = false
    return () => {
      if (released) return
      released = true
      session.busy = Math.max(0, session.busy - 1)
      scheduleIdle(session)
    }
  }

  const close = (connectionId: string): void => {
    for (const session of [...live.values()]) {
      if (session.connectionId === connectionId) drop(session, true)
    }
    known.delete(connectionId)
    clearBlocked(connectionId)
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const session of [...live.values()]) drop(session, true)
      known.clear()
      blocked.clear()
    }, 'dsw core hub sessions')
  }

  return {
    require: requireSession,
    peek,
    hold,
    status: async (connectionId, signal) => {
      if (options.statusOf !== undefined) return options.statusOf(connectionId, signal)
      const connection = deps.connection(connectionId)
      if (connection === undefined) return { ok: false, detail: 'unknown machine' }
      // BUG-6: answer from the ON-DISK artifact, never from a running serve. A
      // cached `dsh-core serve` outlives the directory it was exec'd from, so
      // asking it made the panel report "installed" after the operator deleted
      // `~/.dsh-core/<version>/` — until the idle kill. One exec cannot lie.
      const sessionLive = peek(connectionId) !== undefined
      try {
        const outcome = await connection.exec(coreVersionCommand(), signal !== undefined ? { signal } : undefined)
        if (outcome.exitCode !== 0) {
          const detail = (outcome.stderr || outcome.stdout || 'core not installed').trim()
          return {
            ok: false,
            detail: sessionLive
              ? `${detail} (a cached core session is still running; it exits on idle)`
              : detail,
          }
        }
        const parsed = JSON.parse(outcome.stdout) as {
          version?: string
          arch?: string
          proto?: number
          caps?: string[]
        }
        return {
          ok: true,
          version: parsed.version ?? CORE_ARTIFACT_VERSION,
          arch: parsed.arch,
          proto: parsed.proto,
          caps: parsed.caps,
        }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
    close,
  }
}

export function coreUnavailable(detail: string): never {
  throw new CoreRpcError({ code: CORE_ERROR_SANDBOX, message: detail })
}

/**
 * Return the process-wide hub when the plugin fiber has provided it.
 * Callers that must not create a service (picker tests, tool stubs) use this.
 */
export function coreHubOf(ctx: Context): CoreHub | undefined {
  if (typeof ctx.get !== 'function') return undefined
  return ctx.get('coreHub', false) as CoreHub | undefined
}

/**
 * Return the process-wide hub, creating and `ctx.provide`-ing it on first use
 * so the aggregate row, the web channel, and the directory picker share one
 * session cache. Effect-bound: unloading the row drops the name.
 *
 * The production hub carries the REQ-I14 first-use approval resolver (ask the
 * platform approval service, deploy, retry once); tests that build their own
 * hub via {@link createCoreHub} stay resolver-free.
 */
export function ensureCoreHub(ctx: Context): CoreHub {
  const existing = coreHubOf(ctx)
  if (existing !== undefined) return existing
  let created: CoreHub | undefined
  const resolveGap = createCoreGapAsker(ctx, () => created)
  const hub = createCoreHub(ctx, { resolveGap })
  created = hub
  if (typeof ctx.provide !== 'function') return hub
  try {
    ctx.provide('coreHub', hub)
  } catch {
    const raced = coreHubOf(ctx)
    if (raced !== undefined) return raced
    throw new Error('dsw: coreHub service is already owned by another fiber')
  }
  return hub
}

export { CORE_REMOTE_HOME, CORE_IDLE_MS }
