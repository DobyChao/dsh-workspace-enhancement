/**
 * Connection status UI shared by every machine surface (settings rows, the
 * add-workspace flow sidebar, the DOM row layer): the `/dsw/conn.*` wire
 * contract, a small TTL + in-flight dedupe status center, the `useConnStatus`
 * hook, and the tri-state badge component (◇ unknown / ● active / ● offline)
 * with the "re-check and try to connect" affordance.
 *
 * The wire contract mirrors the host's ConnectionStatusView (registry.ts);
 * unknown fields are tolerated. No new dependencies.
 * @module dsh-workspace-enhancement/client/status
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { WireResult } from './index.ts'

/** Tri-state connection state as wired by `/dsw/conn.*`. */
export type ConnState = 'unknown' | 'active' | 'offline'

/** One `/dsw/conn.status` row (structural; unknown fields tolerated). */
export interface ConnStatusView {
  id: string
  state: ConnState
  connected: boolean
  label: string
  host: string
  port: number
  username: string
  hostKeyKnown: boolean
  lastProbeAt?: string
  lastProbeLatencyMs?: number | null
  message?: string
}

/** The `/dsw` RPC face (same channel shape as the settings/flow inject). */
export type RpcCall = (endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<WireResult>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Structural check of one conn.status row. */
export function asConnStatus(value: unknown): ConnStatusView | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.host !== 'string' || typeof value.username !== 'string') return null
  const state: ConnState = value.state === 'active' || value.state === 'offline' ? value.state : 'unknown'
  const view: ConnStatusView = {
    id: value.id,
    state,
    connected: value.connected === true,
    label: typeof value.label === 'string' ? value.label : value.host,
    host: value.host,
    port: typeof value.port === 'number' ? value.port : 22,
    username: value.username,
    hostKeyKnown: value.hostKeyKnown === true,
  }
  if (typeof value.lastProbeAt === 'string') view.lastProbeAt = value.lastProbeAt
  if (typeof value.lastProbeLatencyMs === 'number') view.lastProbeLatencyMs = value.lastProbeLatencyMs
  if (typeof value.message === 'string') view.message = value.message
  return view
}

/** Unwrap a wire result into its value (throws the business message). */
function unwrap(result: WireResult): unknown {
  if (!result.ok) throw new Error(result.error.message || 'dsw rpc 失败')
  return result.value
}

/** Per-id async status handle: TTL cache + in-flight dedupe. */
export interface StatusCenter {
  /** Cached view without touching the wire (null when absent/expired). */
  peek(id: string): ConnStatusView | null
  /** Resolve the current status (cache-first; the wire only on expiry). */
  get(id: string): Promise<ConnStatusView | null>
  /** Force a live probe (network; replaces the cache entry). */
  probe(id: string): Promise<ConnStatusView | null>
  /** Dispose + rebuild + probe (network; the failed-cache root fix). */
  reconnect(id: string): Promise<ConnStatusView | null>
}

interface CacheEntry { view: ConnStatusView; at: number }
type WireFn = (id: string) => Promise<ConnStatusView | null>
/** In-flight dedupe key: endpoint + id (P2-① — see {@link networked}). */
type InflightKey = `${'conn.status' | 'conn.probe' | 'conn.reconnect'}:${string}`

const DEFAULT_NETWORK_TTL_MS = 10_000
const DEFAULT_PROBE_TTL_MS = 4_000

/** Create a status center backed by one `/dsw` RPC channel. */
export function createStatusCenter(
  rpc: RpcCall,
  statusTtlMs = DEFAULT_NETWORK_TTL_MS,
  probeTtlMs = DEFAULT_PROBE_TTL_MS,
): StatusCenter {
  const cache = new Map<string, CacheEntry>()
  const inflight = new Map<InflightKey, Promise<ConnStatusView | null>>()

  const fresh = (id: string, ttl: number): ConnStatusView | null => {
    const entry = cache.get(id)
    if (entry === undefined) return null
    return Date.now() - entry.at < ttl ? entry.view : null
  }
  const put = (view: ConnStatusView): ConnStatusView => {
    cache.set(view.id, { view, at: Date.now() })
    return view
  }
  /**
   * P2-①: dedupe keyed by `endpoint:id`, never by id alone. `conn.status`
   * (cache-first read), `conn.probe` (live echo), and `conn.reconnect`
   * (dispose + rebuild + probe) have different semantics and different
   * TTLs — sharing one id slot made a reconnect return a stale probe or a
   * status read latch onto a pending probe and never issue its own request.
   * Each endpoint keeps its own in-flight slot per id; the TTL cache stays
   * per id (the latest view of the entry).
   * (t8: this used to take a per-call `ttl` that nothing consumed — expiry
   * is honored at read time by {@link StatusCenter.peek} / `get` via
   * {@link fresh}; the dead parameter is gone.)
   */
  const networked = (id: string, endpoint: 'conn.status' | 'conn.probe' | 'conn.reconnect'): Promise<ConnStatusView | null> => {
    const key: InflightKey = `${endpoint}:${id}`
    const pending = inflight.get(key)
    if (pending !== undefined) return pending
    const call = rpc(endpoint, { id })
      .then(result => { const view = asConnStatus(unwrap(result)); return view === null ? null : put(view) })
      .catch(() => null)
      .finally(() => { inflight.delete(key) })
    inflight.set(key, call)
    return call
  }

  return {
    peek: id => fresh(id, Math.max(statusTtlMs, probeTtlMs)),
    get: id => {
      const cached = fresh(id, statusTtlMs)
      if (cached !== null) return Promise.resolve(cached)
      return networked(id, 'conn.status')
    },
    probe: id => networked(id, 'conn.probe'),
    reconnect: id => networked(id, 'conn.reconnect'),
  }
}

let sharedCenter: StatusCenter | null = null

/** The app-wide center (one `/dsw` channel in the client bundle). */
export function getStatusCenter(rpc: RpcCall): StatusCenter {
  sharedCenter ??= createStatusCenter(rpc)
  return sharedCenter
}

/** Bind one entry's status to a component (auto-fetch + refresh actions). */
export function useConnStatus(center: StatusCenter | null, id: string | undefined): {
  view: ConnStatusView | null
  busy: boolean
  refresh: () => Promise<ConnStatusView | null>
  reconnect: () => Promise<ConnStatusView | null>
} {
  const [view, setView] = useState<ConnStatusView | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (center === null || id === undefined) return
    let alive = true
    setView(center.peek(id))
    void center.get(id).then(found => { if (alive) setView(found) })
    return () => { alive = false }
  }, [center, id])
  const run = (fn: () => Promise<ConnStatusView | null>): (() => Promise<ConnStatusView | null>) => {
    return async () => {
      if (center === null || id === undefined) return null
      setBusy(true)
      try {
        const found = await fn()
        setView(found)
        return found
      } catch {
        return null
      } finally {
        setBusy(false)
      }
    }
  }
  // Stable per (center, id); rebuild only when identity changes.
  return useMemo(() => ({
    view,
    busy,
    refresh: run(() => center !== null && id !== undefined ? center.get(id) : Promise.resolve(null)),
    reconnect: run(() => center !== null && id !== undefined ? center.reconnect(id) : Promise.resolve(null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [center, id, busy, view])
}

export const CONN_STATE_LABEL: Record<ConnState, string> = {
  unknown: '未检测',
  active: '已连接',
  offline: '离线',
}

export const CONN_STATE_COLOR: Record<ConnState, string> = {
  unknown: '#8a8f98',
  active: '#98c379',
  offline: '#e06c75',
}

/**
 * The tri-state badge: colored dot + label, and (unless `compact`) the
 * "re-check and try to connect" button shown for unknown/offline entries.
 */
export function ConnStatusBadge({
  id, rpc, center, compact = false,
}: {
  id: string
  rpc: RpcCall
  center?: StatusCenter | null
  compact?: boolean
}): ReactNode {
  const resolved: StatusCenter | null = center !== undefined ? center : getStatusCenter(rpc)
  const { view, busy, reconnect } = useConnStatus(resolved, id)
  const state = view?.state ?? 'unknown'
  const label = busy ? '检测中…' : CONN_STATE_LABEL[state]
  const actionTitle = '重新检测并尝试连接'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
      <span
        title={view?.message !== undefined && view.message !== '' ? view.message : CONN_STATE_LABEL[state]}
        style={{ width: 8, height: 8, borderRadius: '50%', background: CONN_STATE_COLOR[state], display: 'inline-block', flexShrink: 0 }}
      />
      <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: 'nowrap' }}>{label}</span>
      {state !== 'active' && (
        <button
          type="button"
          title={actionTitle}
          disabled={busy}
          onClick={() => { void reconnect() }}
          style={{
            padding: compact ? '1px 5px' : '2px 6px',
            borderRadius: 6,
            border: '1px solid rgba(128,128,128,0.35)',
            background: 'rgba(128,128,128,0.08)',
            color: 'inherit',
            cursor: busy ? 'default' : 'pointer',
            fontSize: compact ? 10 : 11,
            whiteSpace: 'nowrap',
          }}
        >{compact ? '重连' : '重新检测并尝试连接'}</button>
      )}
    </span>
  )
}
