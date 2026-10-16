/**
 * Which sidebar row a remote-status badge belongs to (UX-8 option A).
 *
 * Grouped workspace rows and session rows on 0.1.7+ carry
 * `data-row-key="workspace:<workspaceId>"` or `session:<sessionId>`. Matching
 * that key to the workspace / session feed picks the connection even when a
 * local row shares the title (the C3 same-title guard used to drop both).
 * A key that names a known local row badges nothing — the key is authoritative,
 * so the badge cannot hop to a same-title remote row.
 *
 * 0.1.5 renders the same treeitems without `data-row-key`. Those rows fall
 * back to the title indexes ({@link remoteWorkspaceIndex} /
 * {@link remoteSessionIndex}), which keep the same-title skip.
 *
 * Session-row slot migration (option B) is not this module. Grouped session
 * children with no key still inherit their group row.
 *
 * @module dsh-workspace-enhancement/client/row-match
 */

import { routeIdOf } from './route-id.ts'

/** DOM attribute the 0.1.7+ workspace browser stamps on a row. */
export const ROW_KEY_ATTR = 'data-row-key'

/** One workspace registry row (title + path, plus the host id when present). */
export interface RemoteWorkspaceRow {
  title: string
  path: string
  /** Host `workspaceId` (the `workspace:` half of `data-row-key`). */
  workspaceId?: string
}

/** One session list row (display title + cwd, plus the host id when present). */
export interface RemoteSessionRow {
  title: string
  cwd?: string
  /** Host session id (the `session:` half of `data-row-key`). */
  sessionId?: string
}

/** The bits of a rendered row the matcher reads. */
export interface RowAnchor {
  /** `data-row-key` value, or null when this host build does not stamp one. */
  rowKey: string | null
  /** Display title, or null when the row text cannot be read. */
  title: string | null
}

/** `workspace:<id>` / `session:<id>`, or null for an absent or foreign key. */
export function parseRowKey(value: string | null | undefined): { kind: 'workspace' | 'session'; id: string } | null {
  if (value === null || value === undefined) return null
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  const kind = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if (id === '') return null
  if (kind !== 'workspace' && kind !== 'session') return null
  return { kind, id }
}

/**
 * The feed field the host's `buildGroup(workspace.workspaceId, …)` writes
 * into `data-row-key`. Absent on older snapshots — callers then keep the
 * title fallback.
 */
export function workspaceIdOf(item: { workspaceId?: unknown }): string | undefined {
  return typeof item.workspaceId === 'string' && item.workspaceId !== '' ? item.workspaceId : undefined
}

/** One connection id, or undefined when the set is empty or disagrees. */
function uniqueConn(ids: readonly string[]): string | undefined {
  const found = new Set(ids)
  if (found.size !== 1) return undefined
  return [...found][0]
}

/**
 * Grouped-view index — remote workspace title → connection id.
 *
 * A workspace is remote when its path carries a route placeholder root.
 * Every other title forms the local-title set, and a remote title that also
 * exists there is dropped: a local workspace named like a remote one must
 * never be decorated from the title alone. Remote↔remote ambiguity stays
 * skipped. Key matching ({@link connIdForWorkspaceRow}) is what still badges
 * the remote row in that collision.
 * @param workspaces - the full workspace projection (local + remote rows).
 * @returns title → connId (only unambiguous, non-colliding remote titles).
 */
export function remoteWorkspaceIndex(
  workspaces: readonly RemoteWorkspaceRow[],
): Map<string, string> {
  const localTitles = new Set<string>()
  const byTitle = new Map<string, string[]>()
  for (const workspace of workspaces) {
    if (workspace.title === '') continue
    const connId = routeIdOf(workspace.path)
    if (connId === undefined) {
      localTitles.add(workspace.title)
      continue
    }
    byTitle.set(workspace.title, [...(byTitle.get(workspace.title) ?? []), connId])
  }
  const index = new Map<string, string>()
  for (const [title, ids] of byTitle) {
    if (localTitles.has(title)) continue
    const connId = uniqueConn(ids)
    if (connId !== undefined) index.set(title, connId)
  }
  return index
}

/**
 * Flat-view index — remote session title → connection id.
 *
 * Sessions are remote when their recorded cwd carries a route placeholder
 * root. A remote title that collides with a local or unjudgeable session is
 * dropped. Remote↔remote ambiguity stays skipped.
 * @param sessions - the full session projection.
 * @returns title → connId (only unambiguous, non-colliding remote titles).
 */
export function remoteSessionIndex(
  sessions: readonly RemoteSessionRow[],
): Map<string, string> {
  const localTitles = new Set<string>()
  const byTitle = new Map<string, string[]>()
  for (const session of sessions) {
    if (session.title === '') continue
    const connId = session.cwd !== undefined ? routeIdOf(session.cwd) : undefined
    if (connId === undefined) {
      localTitles.add(session.title)
      continue
    }
    byTitle.set(session.title, [...(byTitle.get(session.title) ?? []), connId])
  }
  const index = new Map<string, string>()
  for (const [title, ids] of byTitle) {
    if (localTitles.has(title)) continue
    const connId = uniqueConn(ids)
    if (connId !== undefined) index.set(title, connId)
  }
  return index
}

/**
 * Whether one already-marked row still qualifies by title alone.
 * Kept for the title-index contract; the scan path uses
 * {@link connIdForWorkspaceRow} so a `data-row-key` can outvote a title collision.
 * @param connId - the connId the row was marked for.
 * @param title - the row's current display title (null when unreadable).
 * @param index - the current title → connId index.
 */
export function markedRowStillQualifies(
  connId: string,
  title: string | null,
  index: Map<string, string>,
): boolean {
  return title !== null && index.get(title) === connId
}

/**
 * Connection id for a workspace group row.
 *
 * A `workspace:` key that names a feed row is authoritative: a remote path
 * badges that connection (even when a local workspace shares the title), and
 * a local path badges nothing. An unknown key, or no key at all (0.1.5),
 * falls back to the title index.
 */
export function connIdForWorkspaceRow(
  anchor: RowAnchor,
  workspaces: readonly RemoteWorkspaceRow[],
): string | undefined {
  const parsed = parseRowKey(anchor.rowKey)
  if (parsed?.kind === 'workspace') {
    const matches = workspaces.filter(workspace => workspace.workspaceId === parsed.id)
    if (matches.length > 0) {
      return uniqueConn(matches
        .map(workspace => routeIdOf(workspace.path))
        .filter((id): id is string => id !== undefined))
    }
  }
  if (anchor.title === null) return undefined
  return remoteWorkspaceIndex(workspaces).get(anchor.title)
}

/**
 * Connection id for a session row in the flat list.
 *
 * A `session:` key that names a feed row is authoritative. Otherwise the
 * title index applies (0.1.5, or a key the feed does not know yet).
 */
export function connIdForSessionRow(
  anchor: RowAnchor,
  sessions: readonly RemoteSessionRow[],
): string | undefined {
  const parsed = parseRowKey(anchor.rowKey)
  if (parsed?.kind === 'session') {
    const matches = sessions.filter(session => session.sessionId === parsed.id)
    if (matches.length > 0) {
      return uniqueConn(matches
        .map(session => (session.cwd === undefined ? undefined : routeIdOf(session.cwd)))
        .filter((id): id is string => id !== undefined))
    }
  }
  if (anchor.title === null) return undefined
  return remoteSessionIndex(sessions).get(anchor.title)
}

/**
 * Connection id for a session row nested under a workspace group.
 *
 * A known `session:` key wins, including "this session is local" (no badge)
 * so the badge cannot inherit a remote group by mistake. No key, or a key
 * the feed has not caught up with, keeps the group's connection — the 0.1.5
 * behavior, where session children have no anchor of their own.
 * @param inherited - the group row's connection, when that group still qualifies.
 */
export function connIdForGroupedSession(
  anchor: RowAnchor,
  sessions: readonly RemoteSessionRow[],
  inherited: string | undefined,
): string | undefined {
  const parsed = parseRowKey(anchor.rowKey)
  if (parsed?.kind === 'session' && sessions.some(session => session.sessionId === parsed.id)) {
    return connIdForSessionRow(anchor, sessions)
  }
  return inherited
}
