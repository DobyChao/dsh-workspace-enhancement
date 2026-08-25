/**
 * R5: per-session attached side-workspace state — plugin-owned records of
 * extra roots (local directories or remote machine directories) a session may
 * operate on, each with its own permission pair (fs: `r`|`rw`, exec: `on`|`off`).
 *
 * The core session model is 1 session → 1 immutable header cwd, so the
 * attachments, the per-root permissions, and the routing index all live HERE:
 * one state file (`<dsh home>/dsw-session-workspaces.json`) with two maps —
 *
 * - `roots`: rootKey → record (rootKey = canonical key: a `resolve()`d local
 *   absolute path, or `ssh://<machineId>/<posix path>`); ONE record per root,
 *   so the permission of a directory is global — two sessions attaching the
 *   same root share its fs/exec pair.
 * - `sessions`: sessionId → ordered rootKey list (the attachment account;
 *   display and prompt order, no core involvement).
 *
 * Consumers: the mixed subprocess/filesystem providers (path→root permissions
 * and routing), the per-session prompt section (the attached list), and the
 * `/dsw` web endpoints (CRUD).
 * @module dsh-workspace-enhancement/session-workspaces
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { dshHome } from './hostkey.ts'
import { parseSshRoute } from './registry.ts'
import { remoteRouteFromCwd } from './transport.ts'

/** The two attachment kinds a side workspace can be. */
export type SideWorkspaceKind = 'local' | 'remote'

/** fs permission: `r` rejects every write through the fs seam, `rw` allows it. */
export type SideFsMode = 'r' | 'rw'

/** exec permission: `off` rejects spawns whose world is the workspace. */
export type SideExecMode = 'on' | 'off'

/** One side workspace record (canonical rootKey + permission pair). */
export interface SideWorkspaceItem {
  /** Stable anchor (uuid-ish string; not the path — a path may be re-rooted). */
  id: string
  kind: SideWorkspaceKind
  /**
   * Canonical root key: a `resolve()`d absolute local path (kind `local`) or
   * `ssh://<machineId>/<absolute posix path>` (kind `remote`).
   */
  rootKey: string
  /** Display label (defaults to the basename at attach time). */
  label: string
  fs: SideFsMode
  exec: SideExecMode
}

/** Attach/update payload (paths in any spelling; canonicalized here). */
export interface SideWorkspaceInput {
  id?: string
  kind: SideWorkspaceKind
  path: string
  label?: string
  fs?: SideFsMode
  exec?: SideExecMode
}

/** The persisted file shape. */
export interface SideWorkspacesFile {
  roots: Record<string, SideWorkspaceItem>
  sessions: Record<string, string[]>
}

/** Default state file path: `<dsh home>/dsw-session-workspaces.json`. */
export function defaultSideWorkspacesFile(dshBase?: string): string {
  return join(dshBase ?? dshHome(), 'dsw-session-workspaces.json')
}

/** The root key of a remote `ssh://<id>/<abs>` route, normalized. */
function normalizeRemoteKey(path: string): string | null {
  const route = parseSshRoute(path)
  if (route === null) return null
  const normalized = posix.normalize(route.path)
  const pathPart = normalized.length > 1 ? normalized.replace(/\/+$/u, '') : normalized
  return `ssh://${route.id}${pathPart.startsWith('/') ? pathPart : `/${pathPart}`}`
}

/**
 * Canonicalize one side-workspace path into a root key, or null when the path
 * cannot name a side root: a `remote` kind requires the `ssh://<id>/<abs>`
 * spelling (any POSIX directory spelled through a machine connection), a
 * `local` kind requires an absolute local path. The remote path is
 * posix-normalized; the local path is `resolve()`d lexically (no realpath —
 * symlink fidelity is the browser/stat layer's job).
 */
export function normalizeSideRootKey(kind: SideWorkspaceKind, path: string): string | null {
  if (typeof path !== 'string' || path.trim() === '') return null
  const value = path.trim()
  if (kind === 'remote') return normalizeRemoteKey(value)
  if (!isAbsolute(value)) return null
  return resolve(value)
}

/** Parse a stored root key back into its kind + canonical path parts. */
export function sideRootKeyOf(rootKey: string): { kind: SideWorkspaceKind; path: string } | null {
  if (rootKey.startsWith('ssh://')) {
    const route = parseSshRoute(rootKey)
    if (route === null) return null
    return { kind: 'remote', path: route.path }
  }
  if (!isAbsolute(rootKey)) return null
  return { kind: 'local', path: resolve(rootKey) }
}

/** Canonicalize one persisted rootKey spelling exactly like an attach would. */
function canonicalStoredKey(entry: string): string | null {
  if (entry.startsWith('ssh://')) return normalizeRemoteKey(entry)
  if (!isAbsolute(entry)) return null
  return resolve(entry)
}

/** The path separator a stored root key canonically uses. */
function separatorOf(rootKey: string): string {
  return rootKey.startsWith('ssh://') ? '/' : (rootKey.includes('\\') ? '\\' : '/')
}

/**
 * Whether `candidate` equals `root` or lives strictly BELOW it (separator
 * boundary). A root that ALREADY ends with its separator (`C:\`, `ssh://c1/`)
 * matches by plain prefix — appending another separator would double it and
 * miss every child. `insensitive` is the win32 local-family comparison.
 */
function isUnderRoot(root: string, candidate: string, insensitive: boolean): boolean {
  const r = insensitive ? root.toLowerCase() : root
  const c = insensitive ? candidate.toLowerCase() : candidate
  if (c === r) return true
  const sep = separatorOf(root)
  if (r.endsWith(sep)) return c.startsWith(r)
  return c.startsWith(r + sep)
}

/** The longest root whose predicate holds (insertion order breaks ties). */
function bestMatchingRoot(
  roots: ReadonlyMap<string, SideWorkspaceItem>,
  matches: (rootKey: string) => boolean,
): SideWorkspaceItem | undefined {
  let best: SideWorkspaceItem | undefined
  let bestLength = -1
  for (const item of roots.values()) {
    if (!matches(item.rootKey)) continue
    if (item.rootKey.length > bestLength) {
      best = item
      bestLength = item.rootKey.length
    }
  }
  return best
}

/**
 * Match one operation path against a root map: the LONGEST owning root, with
 * every real-world spelling canonicalized FIRST:
 *
 * - remote routes: `ssh://<id>/<path>` AND the local placeholder trees
 *   (`dsw-routes/<id>/…`, legacy `dsh-ssh-routes/<id>/…`) — a remote session's
 *   spawn cwd is a placeholder, so the exec gate must see the same root;
 * - absolute local paths (win32: case-insensitive comparison, NTFS-realpath
 *   targetKeys vs lexical attach spellings);
 * - win32 bare POSIX-absolute paths: remote-by-spelling (the R4 worldOfCwd
 *   rule) — matched against remote roots by path part, machine-agnostic.
 *
 * Relative paths stay unmatched (they resolve against the session cwd world).
 */
export function sideWorkspaceOf(
  roots: ReadonlyMap<string, SideWorkspaceItem>,
  path: string,
): SideWorkspaceItem | undefined {
  if (typeof path !== 'string' || path.trim() === '') return undefined
  const value = path.trim()
  const remote = remoteRouteFromCwd(value) // ssh:// + both placeholder trees
  if (remote !== null) {
    const key = normalizeRemoteKey(`ssh://${remote.connectionId}${remote.path}`)
    if (key === null) return undefined
    return bestMatchingRoot(roots, root => root.startsWith('ssh://') && isUnderRoot(root, key, false))
  }
  // R4 rule (worldOfCwd): a POSIX-absolute value on win32 is a REMOTE spelling
  // (its only sources are remote routes / remote workspace values). This MUST
  // run BEFORE the local-absolute branch: `path.win32.isAbsolute('/a/b')` is
  // true (rooted), so a bare POSIX value would otherwise be `resolve()`d onto
  // the local drive and fall into the local family.
  if (process.platform === 'win32' && value.startsWith('/') && !value.startsWith('//')) {
    const normalized = posix.normalize(value)
    let best: SideWorkspaceItem | undefined
    let bestLength = -1
    for (const item of roots.values()) {
      const root = item.rootKey
      if (!root.startsWith('ssh://')) continue
      const parsed = sideRootKeyOf(root)
      if (parsed === null || parsed.kind !== 'remote') continue
      // Longest by PATH part: the machine id length must not decide the winner.
      if (!isUnderRoot(parsed.path, normalized, false)) continue
      if (parsed.path.length > bestLength) {
        best = item
        bestLength = parsed.path.length
      }
    }
    return best
  }
  if (isAbsolute(value)) {
    const key = resolve(value)
    const insensitive = process.platform === 'win32'
    return bestMatchingRoot(roots, root => !root.startsWith('ssh://') && isUnderRoot(root, key, insensitive))
  }
  return undefined
}

/** Pure validation/normalization of one record (persisted-file safety net). */
export function normalizeSideWorkspaceRecord(raw: unknown): SideWorkspaceItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id === '') return null
  if (record.kind !== 'local' && record.kind !== 'remote') return null
  if (typeof record.rootKey !== 'string') return null
  // Re-canonicalize on load: a hand-edited or old spelling (`C:\a\..\b`,
  // `ssh://c1//a//b/`) must resolve onto the same key an attach would store,
  // otherwise the record can never match again.
  const rootKey = normalizeSideRootKey(record.kind, record.rootKey)
  if (rootKey === null) return null
  const parsed = sideRootKeyOf(rootKey)
  if (parsed === null || parsed.kind !== record.kind) return null
  const label = typeof record.label === 'string' && record.label.trim() !== '' ? record.label.trim() : basenameLabel(record.kind, parsed.path)
  const fs: SideFsMode = record.fs === 'r' ? 'r' : 'rw'
  const exec: SideExecMode = record.exec === 'off' ? 'off' : 'on'
  return { id: record.id, kind: record.kind, rootKey, label, fs, exec }
}

/** Default display label for a root (last path segment, remote uses the POSIX part). */
export function basenameLabel(kind: SideWorkspaceKind, path: string): string {
  if (kind === 'remote') return posix.basename(path) || path
  return basename(path) || path
}

/** Load the persisted file (missing → empty; corrupt → warn + empty). */
export function loadSideWorkspaces(file: string, warn: (message: string) => void): { roots: Map<string, SideWorkspaceItem>; sessions: Map<string, string[]> } {
  const roots = new Map<string, SideWorkspaceItem>()
  const sessions = new Map<string, string[]>()
  if (!existsSync(file)) return { roots, sessions }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SideWorkspacesFile>
    if (typeof parsed.roots === 'object' && parsed.roots !== null) {
      for (const record of Object.values(parsed.roots)) {
        const item = normalizeSideWorkspaceRecord(record)
        if (item !== null && !roots.has(item.rootKey)) roots.set(item.rootKey, item)
      }
    }
    if (typeof parsed.sessions === 'object' && parsed.sessions !== null) {
      for (const [sessionId, list] of Object.entries(parsed.sessions)) {
        if (typeof sessionId !== 'string' || sessionId === '' || !Array.isArray(list)) continue
        // Re-canonicalize every reference exactly like the roots map was (a
        // hand-edited/old spelling must resolve onto the loaded record), and
        // drop emptied accounts so the next persist writes them back clean.
        const keys: string[] = []
        for (const entry of list) {
          if (typeof entry !== 'string') continue
          const canonical = canonicalStoredKey(entry)
          if (canonical === null || !roots.has(canonical) || keys.includes(canonical)) continue
          keys.push(canonical)
        }
        if (keys.length > 0) sessions.set(sessionId.trim(), keys)
      }
    }
  } catch (error) {
    warn(`dsw: cannot read side-workspace state ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { roots, sessions }
}

/** New stable side-workspace id (timestamp + random, like the temp machine ids). */
export function allocateSideId(): string {
  return `sw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Session-attached side workspace store (cordis service `sideWorkspaces`).
 * Owns the durable attachment state; pure path matching lives in the exported
 * helpers so the mixed providers can gate without touching this class.
 */
export class SessionSideWorkspaceStore extends Service {
  private readonly file: string
  private readonly roots = new Map<string, SideWorkspaceItem>()
  private readonly sessions = new Map<string, string[]>()

  constructor(ctx: Context, opts?: { file?: string }) {
    super(ctx, 'sideWorkspaces')
    this.file = opts?.file ?? defaultSideWorkspacesFile()
    const state = loadSideWorkspaces(this.file, message => this.ctx.logger.warn(message))
    for (const [key, item] of state.roots) this.roots.set(key, item)
    for (const [sessionId, keys] of state.sessions) this.sessions.set(sessionId, keys)
  }

  /** The physical state file (tests/displays). */
  get statePath(): string {
    return this.file
  }

  /** All side workspaces (canonical records), insertion order. */
  list(): SideWorkspaceItem[] {
    return [...this.roots.values()]
  }

  /** The attachment account of one session, in order (roots only). */
  listFor(sessionId: string): SideWorkspaceItem[] {
    const keys = this.sessions.get(sessionId.trim()) ?? []
    const seen = new Set<string>()
    const items: SideWorkspaceItem[] = []
    for (const key of keys) {
      const item = this.roots.get(key)
      if (item === undefined || seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
    return items
  }

  /** One record by canonical root key. */
  get(rootKey: string): SideWorkspaceItem | undefined {
    return this.roots.get(rootKey)
  }

  /** The longest owning record of one operation path (routing/permission). */
  match(path: string): SideWorkspaceItem | undefined {
    return sideWorkspaceOf(this.roots, path)
  }

  /**
   * Attach one side workspace to a session (idempotent per rootKey: an
   * existing root updates record + moves it to the end of the session's
   * account; a new root is canonicalized and appended). Rejects with a `dsw:`
   * error when the path cannot name a side root.
   * @returns the stored record.
   */
  attach(sessionId: string, input: SideWorkspaceInput): SideWorkspaceItem {
    const id = (input.id ?? '').trim()
    if (id === '') throw new Error('dsw: side workspace id must be a non-empty string')
    if (sessionId.trim() === '') throw new Error('dsw: session id must be a non-empty string')
    const rootKey = normalizeSideRootKey(input.kind, input.path)
    if (rootKey === null) {
      throw new Error(`dsw: side workspace path must be an ${input.kind === 'remote' ? 'ssh://<id>/<absolute posix path>' : 'absolute local path'}: ${JSON.stringify(input.path)}`)
    }
    const existing = this.roots.get(rootKey)
    const parsed = sideRootKeyOf(rootKey)
    const labelValue = (input.label ?? '').trim()
    const item: SideWorkspaceItem = existing !== undefined
      ? {
          ...existing,
          ...(labelValue !== '' ? { label: labelValue } : {}),
          ...(input.fs !== undefined ? { fs: input.fs } : {}),
          ...(input.exec !== undefined ? { exec: input.exec } : {}),
        }
      : {
          id,
          kind: input.kind,
          rootKey,
          label: labelValue !== '' ? labelValue : (parsed !== null ? basenameLabel(input.kind, parsed.path) : id),
          fs: input.fs ?? 'rw',
          exec: input.exec ?? 'on',
        }
    this.roots.set(rootKey, item)
    const sid = sessionId.trim()
    const list = (this.sessions.get(sid) ?? []).filter(key => key !== rootKey)
    list.push(rootKey)
    this.sessions.set(sid, list)
    void this.persist()
    return item
  }

  /** Detach one root from a session; drops the root record when nothing references it. */
  detach(sessionId: string, rootKey: string): boolean {
    const sid = sessionId.trim()
    const list = this.sessions.get(sid)
    if (list === undefined || !list.includes(rootKey)) return false
    const remaining = list.filter(key => key !== rootKey)
    // Prune the empty session account: a detached-to-empty session must not
    // leave a dangling `"<id>": []` key behind in the state file.
    if (remaining.length === 0) this.sessions.delete(sid)
    else this.sessions.set(sid, remaining)
    const stillReferenced = [...this.sessions.values()].some(keys => keys.includes(rootKey))
    if (!stillReferenced) this.roots.delete(rootKey)
    void this.persist()
    return true
  }

  /** Update a root's presentation/permission fields (undefined keeps the value). */
  update(rootKey: string, patch: { label?: string; fs?: SideFsMode; exec?: SideExecMode }): boolean {
    const item = this.roots.get(rootKey)
    if (item === undefined) return false
    this.roots.set(rootKey, {
      ...item,
      ...(patch.label !== undefined && patch.label.trim() !== '' ? { label: patch.label.trim() } : {}),
      ...(patch.fs !== undefined ? { fs: patch.fs } : {}),
      ...(patch.exec !== undefined ? { exec: patch.exec } : {}),
    })
    void this.persist()
    return true
  }

  /** Persist (mkdir -p first; a failed write warns and never crashes the caller). */
  persist(): void {
    const roots: Record<string, SideWorkspaceItem> = {}
    for (const [key, item] of this.roots) roots[key] = item
    const sessions: Record<string, string[]> = {}
    for (const [sessionId, keys] of this.sessions) sessions[sessionId] = keys
    try {
      mkdirSync(dirname(this.file), { recursive: true })
    } catch {
      // A read-only home must not crash the session; the write below surfaces it.
    }
    try {
      writeFileSync(this.file, JSON.stringify({ roots, sessions }, null, 2) + '\n', 'utf8')
    } catch (error) {
      // Honest surface: log the failure, keep the in-memory state authoritative.
      this.ctx.logger.warn(`dsw: cannot persist side-workspace state ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sideWorkspaces: SessionSideWorkspaceStore
  }
}

/** Convenience: the default file path without touching the service. */
export const sessionWorkspacesFilePath = (dshBase?: string): string => defaultSideWorkspacesFile(dshBase)
