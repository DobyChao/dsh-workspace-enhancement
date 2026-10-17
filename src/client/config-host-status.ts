/**
 * Which id an add-workspace 「SSH 配置主机」 row probes (UX-13).
 *
 * A host that already matches a saved connection reuses that id, so the row
 * shares the sidebar's debounce, cache, and backoff. A host that is only in
 * `~/.ssh/config` uses {@link configProbeId} and `config.probe` (no registry
 * write).
 * @module dsh-workspace-enhancement/client/config-host-status
 */

import { configProbeId } from '../config-probe.ts'

/** The fields the match needs from one saved connection. */
export interface SavedConnectionMatch {
  id: string
  host: string
  port: number
}

/** The fields the match needs from one ssh-config host row. */
export interface ConfigHostMatch {
  alias: string
  host: string
  port: number
}

/** What the row's badge should watch. */
export interface ConfigHostProbeTarget {
  /** Shared scheduler id. */
  id: string
  /** `saved` → `conn.probe` / `conn.reconnect`. `config` → `config.probe`. */
  kind: 'saved' | 'config'
  /** The alias sent to `config.probe`. Present only for `kind: 'config'`. */
  alias?: string
}

/** Minimal `/dsw` call the wrapper forwards. */
export interface ConfigHostProbeRpc {
  (endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<unknown>
}

/**
 * Pick the probe target for one ssh-config row.
 * Match is the same rule as the click handler: same port, and the saved
 * host equals the alias or the resolved HostName (case-insensitive).
 */
export function configHostProbeTarget(
  host: ConfigHostMatch,
  connections: readonly SavedConnectionMatch[],
): ConfigHostProbeTarget {
  const alias = host.alias.toLowerCase()
  const hostname = host.host.toLowerCase()
  const saved = connections.find(connection =>
    connection.port === host.port
    && (connection.host.toLowerCase() === alias || connection.host.toLowerCase() === hostname))
  if (saved !== undefined) return { id: saved.id, kind: 'saved' }
  return { id: configProbeId(host.alias), kind: 'config', alias: host.alias }
}

/**
 * RPC the badge's status center should use. Saved machines keep the caller's
 * channel. Config-only hosts send probe, reconnect, and status to
 * `config.probe` with the alias.
 */
export function configHostRpc<T extends ConfigHostProbeRpc>(rpc: T, target: ConfigHostProbeTarget): T {
  if (target.kind === 'saved') return rpc
  const alias = target.alias ?? ''
  const wrapped: ConfigHostProbeRpc = (endpoint, payload, signal) => {
    if (endpoint === 'conn.probe' || endpoint === 'conn.reconnect' || endpoint === 'conn.status') {
      return rpc('config.probe', { alias }, signal)
    }
    return rpc(endpoint, payload, signal)
  }
  return wrapped as T
}
