/**
 * Web-facing RPC channel of dsh-workspace-enhancement: mounts the connection
 * registry and registers the `/dsw` unary channel on the shared web transport
 * with the loopback trust fence. The client half drives connection management
 * and remote directory browsing through it; endpoints are plain JSON. Remote
 * listing shares one level walk with the directory-picker backend
 * ({@link module:dsh-workspace-enhancement/listing}).
 * @module dsh-workspace-enhancement/web
 */

import { mkdir, rm } from 'node:fs/promises'
import { posix } from 'node:path'
import type { Stats } from 'ssh2'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { pickNativeDirectory } from '@deepseek-ai/dsh-host-directory-picker-native'
import SshRegistry from './registry.ts'
import type { ConnectionInput, MachineInput, RegistryConfig } from './registry.ts'
import type { SshConnection } from './connection.ts'
import type { HostKeyMode } from './hostkey.ts'
import { registerWorkspaceTools } from './tools.ts'
import { sshRoutePlaceholder } from './transport.ts'
import { listRemoteLevel, remoteHome as sharedRemoteHome } from './listing.ts'

/** Channel config. */
export interface WebChannelConfig extends RegistryConfig {
  /** Complete-result bound of one remote listing level. */
  maxEntries?: number
}

/** The unary RPC result shape the shared transport expects. */
export type ChannelResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }

/** One wire directory row / crumb. */
interface WireEntry {
  name: string
  path: string
  hidden: boolean
}

/** One remote listing level for the client browser. */
interface WireListing {
  path: string
  home: string
  crumbs: WireEntry[]
  entries: WireEntry[]
  truncated: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host connection transport; the shared RPC channel registry lives here. */
    connection: {
      rpc: {
        handle(
          channel: string,
          handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ChannelResult>,
          options: { authority: 'loopback' | 'trusted-host' },
        ): () => Promise<void>
      }
    }
  }
}

/** Required host services: the web transport + the tools/system-prompt registry. */
export const inject = ['connection', 'tools', 'systemPrompt']

/** Validated channel config. */
export const Config: z<WebChannelConfig> = z.object({
  stateFile: z.string(),
  maxEntries: z.number().min(1).default(1000),
})

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Await a value, failing with a `bad-request` error when the guard rejects. */
function requirePayload<T>(payload: unknown, guard: (value: unknown) => value is T, what: string): T {
  if (!guard(payload)) {
    throw new Error(`bad-request: ${what} payload is invalid`)
  }
  return payload
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

/** `ssh://<id>` route payload. */
function isIdPayload(value: unknown): value is { id: string } {
  return isRecord(value) && isString(value.id) && value.id.trim() !== ''
}

/** Browse payload: `{ id, path? }`. */
function isBrowsePayload(value: unknown): value is { id: string; path?: string } {
  return isRecord(value) && isString(value.id) && value.id.trim() !== ''
    && (value.path === undefined || isString(value.path))
}

/** Session-route payload: `{ id, path }` with an absolute POSIX remote path. */
function isSessionRoutePayload(value: unknown): value is { id: string; path: string } {
  return isRecord(value) && isString(value.id) && value.id.trim() !== ''
    && isString(value.path) && posix.isAbsolute(value.path)
}

/** Connection input payload (subset keys, all strings/numbers/arrays). */
function isConnectionInput(value: unknown): value is ConnectionInput {
  if (!isRecord(value)) return false
  if (!isString(value.host) || value.host.trim() === '') return false
  for (const key of ['label', 'username', 'password', 'privateKeyPath', 'passphrase', 'agent', 'cwd']) {
    const field = value[key]
    if (field !== undefined && !isString(field)) return false
  }
  if (value.port !== undefined && (typeof value.port !== 'number' || !Number.isInteger(value.port))) return false
  if (value.jump !== undefined) {
    if (!Array.isArray(value.jump)) return false
    for (const hop of value.jump) {
      if (!isRecord(hop) || !isString(hop.host) || hop.host.trim() === '') return false
      if (hop.port !== undefined && (typeof hop.port !== 'number' || !Number.isInteger(hop.port))) return false
      for (const key of ['username', 'privateKeyPath', 'agent']) {
        if (hop[key] !== undefined && !isString(hop[key])) return false
      }
    }
  }
  if (value.strictHostKeyChecking !== undefined && typeof value.strictHostKeyChecking !== 'boolean') return false
  if (value.hostKeyMode !== undefined && !isHostKeyMode(value.hostKeyMode)) return false
  if (value.knownHosts !== undefined) {
    if (!Array.isArray(value.knownHosts)) return false
    for (const entry of value.knownHosts) {
      if (!isString(entry)) return false
    }
  }
  return true
}

const isHostKeyMode = (value: unknown): value is HostKeyMode =>
  value === 'accept-new' || value === 'verify' || value === 'off'

/** Machine add payload (legacy connection input + dsh-remote machine fields). */function isMachineInput(value: unknown): value is MachineInput {
  if (!isConnectionInput(value)) return false
  if (!isRecord(value)) return false
  if (value.id !== undefined && !isString(value.id)) return false
  if (value.name !== undefined && !isString(value.name)) return false
  if (value.workspace !== undefined && !isString(value.workspace)) return false
  if (value.encryptPassword !== undefined && typeof value.encryptPassword !== 'boolean') return false
  if (value.credentialBackend !== undefined
    && value.credentialBackend !== 'plain' && value.credentialBackend !== 'keychain'
    && value.credentialBackend !== 'windows' && value.credentialBackend !== 'secret') return false
  return true
}

/** Host-key forget payload: `{ id }` (machine) or `{ host, port }`. */
function isHostKeyForgetPayload(value: unknown): value is { id?: string; host?: string; port?: number } {
  if (!isRecord(value)) return false
  if (value.id !== undefined && (!isString(value.id) || value.id.trim() === '')) return false
  if (value.host !== undefined && !isString(value.host)) return false
  if (value.port !== undefined && (typeof value.port !== 'number' || !Number.isInteger(value.port))) return false
  return value.id !== undefined || value.host !== undefined
}

/**
 * Map a channel failure onto the HOST's closed rpc error vocabulary — the
 * client transport validates `code` against its discriminated union and
 * per-code `details` shapes, so an off-vocabulary code surfaces as a raw zod
 * dump instead of the business message.
 */
const wireError = (code: string, message: string): ChannelResult => {
  if (code === 'bad-request') {
    return { ok: false, error: { code, message, details: { issues: [] } } }
  }
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/**
 * Mount the connection registry and the `/dsw` channel.
 * @param ctx - the mounting Cordis context.
 * @param config - state file and listing bound.
 */
export function apply(ctx: Context, config: WebChannelConfig): void {
  ctx.plugin(SshRegistry, { ...(config.stateFile !== undefined ? { stateFile: config.stateFile } : {}) })
  const maxEntries = config.maxEntries ?? 1000
  const registry = (): SshRegistry => {
    const value = ctx.get('sshRegistry')
    if (value === undefined) throw new Error('dsw: the connection registry is not mounted')
    return value
  }
  const requireConnection = (id: string): SshConnection => {
    const connection = registry().get(id)
    if (connection === undefined) throw new Error(`dsw: unknown connection id ${JSON.stringify(id)}`)
    return connection
  }

  /** The remote home directory: the login environment's HOME, else the spec cwd. */
  const remoteHome = async (id: string, signal?: AbortSignal): Promise<string> => {
    return sharedRemoteHome(requireConnection(id), signal)
  }

  /** List one remote level over the connection's shared SFTP channel. */
  const listRemote = async (id: string, target: string | undefined, signal?: AbortSignal): Promise<WireListing> => {
    const connection = requireConnection(id)
    const resolvedTarget = target ?? await sharedRemoteHome(connection, signal)
    if (!posix.isAbsolute(resolvedTarget)) {
      throw new Error(`dsw: cannot list ${resolvedTarget}: not a fully qualified path`)
    }
    return listRemoteLevel(connection, resolvedTarget, maxEntries, {
      signal,
      home: await sharedRemoteHome(connection, signal),
    })
  }

  /** Create one child directory on the remote host (SFTP mkdir, non-recursive). */
  const createRemoteDirectory = async (id: string, path: string, name: string, signal?: AbortSignal): Promise<string> => {
    if (!posix.isAbsolute(path)) throw new Error(`dsw: cannot create under ${JSON.stringify(path)}: not a fully qualified path`)
    if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
      throw new Error(`dsw: ${JSON.stringify(name)} is not a single path segment`)
    }
    const target = posix.join(path, name)
    const connection = requireConnection(id)
    const sftp = await connection.getSftp(signal)
    const existing = await new Promise<Stats | undefined>((resolvePromise) => {
      sftp.lstat(target, (error, value) => { resolvePromise(error === undefined ? value : undefined) })
    })
    if (existing !== undefined) throw new Error(`dsw: ${target} already exists`)
    await new Promise<void>((resolvePromise, reject) => {
      sftp.mkdir(target, (error) => { if (error !== undefined) reject(error); else resolvePromise() })
    })
    return target
  }

  const dispatch = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<ChannelResult> => {
    try {
      switch (endpoint) {
        case 'connections.list': return { ok: true, value: registry().list() }
        case 'config.hosts': {
          // Re-reads ~/.ssh/config on every call; wildcards stay hidden.
          return { ok: true, value: registry().listConfigHosts() }
        }
        case 'connections.resolve': {
          const input = requirePayload(payload, isRecord, 'connections.resolve')
          const host = input.host
          if (!isString(host) || host.trim() === '') throw new Error('bad-request: host must be a non-empty string')
          const resolved = registry().resolveSshConfig(host.trim())
          return { ok: true, value: { ...resolved, alias: host.trim() } }
        }
        case 'connections.add': {
          const input = requirePayload(payload, isConnectionInput, 'connections.add')
          const added = registry().add(input)
          return { ok: true, value: added }
        }
        case 'connections.remove': {
          const input = requirePayload(payload, isIdPayload, 'connections.remove')
          const removed = registry().remove(input.id.trim())
          if (removed) {
            // Drop the connection's local route placeholders; stale ones would
            // route to a dead registry id on the next session resume.
            void rm(sshRoutePlaceholder(input.id.trim(), '/'), { recursive: true, force: true })
              .catch(() => undefined)
          }
          return { ok: true, value: { removed } }
        }
        case 'connections.test': {
          const input = requirePayload(payload, isConnectionInput, 'connections.test')
          const outcome = await registry().test(input)
          return outcome.ok ? { ok: true, value: { ok: true } } : wireError('connection-failed', outcome.message)
        }
        case 'machines.list': {
          const state = registry().listMachines()
          return { ok: true, value: state }
        }
        case 'machines.current': {
          const status = registry().status()
          const active = registry().getActive()
          return {
            ok: true,
            value: {
              currentId: status.currentId,
              activeSource: status.activeSource,
              machine: active === null ? null : registry().listMachines().machines.find(machine => machine.id === active.spec.id) ?? null,
            },
          }
        }
        case 'machines.setCurrent': {
          const input = requirePayload(payload, isIdPayload, 'machines.setCurrent')
          const okSet = registry().setCurrent(input.id.trim())
          if (!okSet) throw new Error('bad-request: machine not found')
          return { ok: true, value: { ok: true, ...registry().listMachines() } }
        }
        case 'machines.add': {
          const input = requirePayload(payload, isMachineInput, 'machines.add')
          const view = await registry().saveMachine(input)
          return { ok: true, value: { ok: true, machine: view, ...registry().listMachines() } }
        }
        case 'machines.remove': {
          const input = requirePayload(payload, isIdPayload, 'machines.remove')
          const removed = registry().remove(input.id.trim())
          if (removed) {
            // Drop the connection's local route placeholders; stale ones would
            // route to a dead registry id on the next session resume.
            void rm(sshRoutePlaceholder(input.id.trim(), '/'), { recursive: true, force: true })
              .catch(() => undefined)
          }
          return { ok: true, value: { ok: true, removed, ...registry().listMachines() } }
        }
        case 'machines.test': {
          const input = requirePayload(payload, isMachineInput, 'machines.test')
          const outcome = await registry().test(input)
          return outcome.ok ? { ok: true, value: { ok: true } } : wireError('connection-failed', outcome.message)
        }
        case 'hostkey.forget': {
          const input = requirePayload(payload, isHostKeyForgetPayload, 'hostkey.forget')
          let host = input.host
          let port = input.port
          if (host === undefined && input.id !== undefined) {
            const spec = registry().listMachines().machines.find(machine => machine.id === input.id)
            if (spec === undefined) throw new Error('bad-request: unknown machine id')
            host = spec.host
            port = spec.port
          }
          if (host === undefined || host.trim() === '') throw new Error('bad-request: host is required')
          const targetPort = port ?? 22
          const forgot = registry().forgetHostKey(host.trim(), targetPort)
          return { ok: true, value: { ok: true, forgot, host: host.trim(), port: targetPort } }
        }
        case 'status': {
          return { ok: true, value: registry().status() }
        }
        case 'conn.status': {
          // Tri-state snapshot (unknown/active/offline), served from the probe
          // cache or the live chain — never a network call itself.
          const input = requirePayload(payload, isIdPayload, 'conn.status')
          const status = registry().statusOf(input.id.trim())
          if (status === undefined) throw new Error('bad-request: unknown connection id')
          return { ok: true, value: status }
        }
        case 'conn.probe': {
          // Active verification: `echo ok` over the entry's live chain within a
          // bounded budget. A failure is an offline status, not an RPC error.
          const input = requirePayload(payload, isIdPayload, 'conn.probe')
          const status = await registry().probe(input.id.trim(), signal)
          if (status === undefined) throw new Error('bad-request: unknown connection id')
          return { ok: true, value: status }
        }
        case 'conn.reconnect': {
          // Failed-connection-cache root fix: dispose the poisoned live chain,
          // rebuild a fresh one, and probe it. A failure is an offline status,
          // not an RPC error.
          const input = requirePayload(payload, isIdPayload, 'conn.reconnect')
          const status = await registry().reconnect(input.id.trim(), signal)
          if (status === undefined) throw new Error('bad-request: unknown connection id')
          return { ok: true, value: status }
        }
        case 'browse.home': {
          const input = requirePayload(payload, isIdPayload, 'browse.home')
          return { ok: true, value: { path: await remoteHome(input.id.trim(), signal) } }
        }
        case 'browse.list': {
          const input = requirePayload(payload, isBrowsePayload, 'browse.list')
          return { ok: true, value: await listRemote(input.id.trim(), input.path, signal) }
        }
        case 'browse.mkdir': {
          const input = requirePayload(payload, isRecord, 'browse.mkdir')
          if (!isString(input.id) || !isString(input.path) || !isString(input.name)) {
            throw new Error('bad-request: browse.mkdir needs id, path, and name')
          }
          const created = await createRemoteDirectory(input.id.trim(), input.path, input.name, signal)
          return { ok: true, value: { path: created } }
        }
        case 'session.route': {
          // The host's session service `mkdir`s the project directory through
          // `node:fs`, so an `ssh://` cwd can never pass; hand the client a
          // LOCAL placeholder instead, which both sides translate back into
          // the registry route (see transport.ts).
          const input = requirePayload(payload, isSessionRoutePayload, 'session.route')
          requireConnection(input.id.trim())
          const placeholder = sshRoutePlaceholder(input.id.trim(), input.path)
          await mkdir(placeholder, { recursive: true })
          // R4 flow write-back: the picked remote directory becomes the
          // machine's workspace, so the per-session prompt shows the
          // SELECTION rather than the session's default remote cwd. Called on
          // the exact connection id (not the active machine): the picked
          // connection may not be current, and setActiveWorkspace would write
          // onto the wrong record.
          registry().setMachineWorkspace(input.id.trim(), input.path)
          return { ok: true, value: { cwd: placeholder } }
        }
        case 'local.pickNative': {
          // One OS folder chooser on the host display — faster than walking
          // the browse list for local workspaces. Null means the operator
          // cancelled.
          const path = await pickNativeDirectory(signal)
          return { ok: true, value: { path } }
        }
        default:
          throw new Error(`bad-request: unknown endpoint ${JSON.stringify(endpoint)}`)
      }
    } catch (error) {
      const message = messageOf(error)
      const code = message.startsWith('bad-request:') ? 'bad-request' : 'connection-failed'
      return wireError(code, message.replace(/^bad-request: /u, ''))
    }
  }

  const dispose = ctx.connection.rpc.handle('/dsw', dispatch, { authority: 'loopback' })
  ctx.effect(() => dispose, 'dsw: /dsw rpc channel')
  registerWorkspaceTools(ctx, registry)
}
