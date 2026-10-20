/**
 * Directory-picker chrome judgments (UX-14). The flow renders these; the
 * sandbox runner never executes the `.tsx`, so the path commit, the split
 * clamp, and the truncated-server hover live here.
 * @module dsh-workspace-enhancement/client/browse-path
 */

/** Default sidebar width, matching the picker's CSS before a drag. */
export const SPLIT_DEFAULT = 268

/** Narrowest the connection list stays readable. */
export const SPLIT_MIN = 180

/** Widest the file list still has room beside it. */
export const SPLIT_MAX = 480

/** Keyboard step for the separator. */
export const SPLIT_STEP = 16

/** sessionStorage key. A width, not a secret. */
export const SPLIT_STORAGE_KEY = 'dsw.flow.sidebarWidth'

/** Clamp a dragged or stored width onto the separator's range. */
export function clampSplitWidth(width: number): number {
  if (!Number.isFinite(width)) return SPLIT_DEFAULT
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(width)))
}

/** The width to open with. Empty or garbage storage falls back to the default. */
export function readSplitWidth(stored: string | null | undefined): number {
  if (stored === null || stored === undefined || stored.trim() === '') return SPLIT_DEFAULT
  return clampSplitWidth(Number(stored))
}

/**
 * A typed directory the browse flow may navigate to, or null when the draft
 * is blank. Remote drafts become a POSIX absolute path (backslashes flip,
 * a missing leading slash is added, a trailing slash other than `/` drops).
 * Local drafts keep the operator's spelling, including a Windows drive.
 */
export function browsePathDraft(kind: 'local' | 'remote', raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (kind === 'local') return trimmed
  const collapsed = trimmed.replaceAll('\\', '/').replace(/\/{2,}/g, '/')
  const absolute = collapsed.startsWith('/') ? collapsed : `/${collapsed}`
  if (absolute === '/') return '/'
  return absolute.endsWith('/') ? absolute.slice(0, -1) : absolute
}

/** The fields a saved-connection row can show in full on hover. */
export interface ConnectionHoverFields {
  label: string
  username: string
  host: string
  port: number
}

/** `user@host:port`, the untruncated endpoint under the row label. */
export function connectionEndpoint(connection: ConnectionHoverFields): string {
  return `${connection.username}@${connection.host}:${connection.port}`
}

/**
 * Tooltip for a connection row whose label and endpoint ellipsize.
 * A label that is just the endpoint (with or without the port) collapses to
 * the endpoint; a nickname stays on its own line above it.
 */
export function connectionHoverTitle(connection: ConnectionHoverFields): string {
  const endpoint = connectionEndpoint(connection)
  const label = connection.label.trim()
  const bare = `${connection.username}@${connection.host}`
  if (label === '' || label === endpoint || label === bare) return endpoint
  return `${label}\n${endpoint}`
}
