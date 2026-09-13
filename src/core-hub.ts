/**
 * REQ-I5 / ADR-0024: per-connection core RPC session cache.
 *
 * Fenced machines get one long-lived `dsh-core serve` over SSH exec.
 * `off` never opens a session. A dead session is fail-closed — callers must
 * not fall back to SFTP.
 *
 * @module dsh-workspace-enhancement/core-hub
 */

import type { Context } from '@deepseek-ai/cordis'
import { CoreClient } from './core-client.ts'
import {
  CORE_ARTIFACT_VERSION,
  CORE_CAPS,
  CORE_ERROR_SANDBOX,
  CORE_PROTO,
  CORE_REMOTE_HOME,
} from './core-protocol.ts'
import { CoreRpcError } from './core-client.ts'
import { quoteShellArg, startExec } from './ssh-core.ts'
import {
  effectiveModeOf,
  remoteSandboxDepsOf,
  remoteSandboxUnavailable,
} from './remote-sandbox-fence.ts'
import type { RemoteSandboxDeps } from './remote-sandbox-fence.ts'
import {
  isRemoteSandboxEnabled,
  normalizeRemoteSandbox,
  RemoteSandboxError,
  REMOTE_SANDBOX_UNAVAILABLE,
} from './remote-sandbox.ts'
import type { RemoteSandboxConfinementMode, RemoteSandboxMode } from './remote-sandbox.ts'
import type { SshTransport } from './transport.ts'

export interface CoreStatusView {
  ok: boolean
  version?: string | undefined
  arch?: string | undefined
  proto?: number | undefined
  caps?: readonly string[] | undefined
  sandbox?: RemoteSandboxMode | undefined
  detail?: string | undefined
}

export interface CoreOpenRequest {
  connectionId: string
  mode: RemoteSandboxConfinementMode
  workspace?: string | undefined
  signal?: AbortSignal | undefined
  transport: SshTransport
}

export type CoreSessionOpener = (request: CoreOpenRequest) => Promise<CoreClient>

export interface CoreHub {
  modeOf(connectionId: string | undefined): RemoteSandboxMode
  require(connectionId: string, opts?: { cwd?: string | undefined; signal?: AbortSignal | undefined }): Promise<CoreClient>
  peek(connectionId: string): CoreClient | undefined
  status(connectionId: string, signal?: AbortSignal): Promise<CoreStatusView>
  close(connectionId: string): void
}

/** Shell command that execs the installed core in the login user's home. */
export function coreServeCommand(mode: RemoteSandboxConfinementMode, workspace?: string): string {
  const bin = '"$HOME"/.dsh-core/current/dsh-core'
  const parts = [bin, 'serve', '--sandbox', quoteShellArg(mode)]
  if (workspace !== undefined && workspace !== '') {
    parts.push('--workspace', quoteShellArg(workspace))
  }
  return parts.join(' ')
}

export function coreVersionCommand(): string {
  return '"$HOME"/.dsh-core/current/dsh-core version'
}

export function coreArtifactName(): string {
  return `dsh-core-${CORE_ARTIFACT_VERSION}-linux-x64.tar.gz`
}

async function openOverSsh(request: CoreOpenRequest): Promise<CoreClient> {
  const client = await request.transport.getClient(request.signal)
  const command = coreServeCommand(request.mode, request.workspace)
  const channel = await startExec(
    client,
    command,
    request.signal !== undefined ? { signal: request.signal } : undefined,
  )
  return new CoreClient(channel, channel)
}

/**
 * Build the hub. Tests inject `open` (a fake client); production uses SSH exec.
 */
export function createCoreHub(
  ctx: Context,
  options: {
    deps?: RemoteSandboxDeps
    open?: CoreSessionOpener
    statusOf?: (connectionId: string, signal?: AbortSignal) => Promise<CoreStatusView>
  } = {},
): CoreHub {
  const deps = options.deps ?? remoteSandboxDepsOf(ctx)
  const open = options.open ?? openOverSsh
  const live = new Map<string, CoreClient>()

  const modeOf = (connectionId: string | undefined): RemoteSandboxMode =>
    effectiveModeOf(deps, connectionId)

  const requireSession = async (
    connectionId: string,
    opts?: { cwd?: string | undefined; signal?: AbortSignal | undefined },
  ): Promise<CoreClient> => {
    const mode = modeOf(connectionId)
    if (!isRemoteSandboxEnabled(mode)) {
      throw new RemoteSandboxError(
        'core session requested for an unfenced machine',
        REMOTE_SANDBOX_UNAVAILABLE,
      )
    }
    const confinement: RemoteSandboxConfinementMode = mode === 'workspace-write' ? 'workspace-write' : 'read-only'
    const existing = live.get(connectionId)
    if (existing !== undefined) return existing
    const connection = deps.connection(connectionId)
    const machine = deps.machine(connectionId)
    if (connection === undefined || machine === undefined) {
      throw remoteSandboxUnavailable(confinement, `machine ${JSON.stringify(connectionId)} is not usable`)
    }
    const workspace = confinement === 'workspace-write'
      ? (opts?.cwd ?? machine.workspace ?? machine.cwd)
      : undefined
    let client: CoreClient
    try {
      client = await open({
        connectionId,
        mode: confinement,
        transport: connection as unknown as SshTransport,
        ...(workspace !== undefined ? { workspace } : {}),
        ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      })
      const hello = await client.hello(opts?.signal)
      if (hello.proto !== CORE_PROTO) {
        client.close()
        throw remoteSandboxUnavailable(confinement, `core proto ${String(hello.proto)} is not ${CORE_PROTO}`)
      }
      for (const cap of CORE_CAPS) {
        if (!hello.caps.includes(cap)) {
          client.close()
          throw remoteSandboxUnavailable(confinement, `core is missing cap ${cap}`)
        }
      }
    } catch (error) {
      if (error instanceof RemoteSandboxError) throw error
      const detail = error instanceof Error ? error.message : String(error)
      throw remoteSandboxUnavailable(confinement, detail)
    }
    live.set(connectionId, client)
    return client
  }

  return {
    modeOf,
    require: requireSession,
    peek: (id) => live.get(id),
    status: async (connectionId, signal) => {
      if (options.statusOf !== undefined) return options.statusOf(connectionId, signal)
      const cached = live.get(connectionId)
      if (cached !== undefined) {
        try {
          const hello = await cached.hello(signal)
          return {
            ok: true,
            version: hello.version,
            arch: hello.arch,
            proto: hello.proto,
            caps: hello.caps,
            sandbox: normalizeRemoteSandbox(hello.sandbox),
          }
        } catch (error) {
          return { ok: false, detail: error instanceof Error ? error.message : String(error) }
        }
      }
      const connection = deps.connection(connectionId)
      if (connection === undefined) return { ok: false, detail: 'unknown machine' }
      try {
        const outcome = await connection.exec(coreVersionCommand(), signal !== undefined ? { signal } : undefined)
        if (outcome.exitCode !== 0) {
          return { ok: false, detail: (outcome.stderr || outcome.stdout || 'core not installed').trim() }
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
    close: (id) => {
      const client = live.get(id)
      live.delete(id)
      client?.close()
    },
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
 */
export function ensureCoreHub(ctx: Context): CoreHub {
  const existing = coreHubOf(ctx)
  if (existing !== undefined) return existing
  const hub = createCoreHub(ctx)
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

export { CORE_REMOTE_HOME }
