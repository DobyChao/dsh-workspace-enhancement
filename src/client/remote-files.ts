/**
 * Remote upload/artifact tree and preview routing (REQ-A6 C2).
 *
 * Pure: the panel renders whatever these functions decide. A session-scoped
 * `dsh-resource://file/session/…` address is the host document-preview bridge.
 * `dsh-resource://file/absolute/…` carries no session and the host rejects it,
 * so a remote file never uses that spelling — the panel previews it itself.
 *
 * @module dsh-workspace-enhancement/client/remote-files
 */

import { isClientConnectionId } from './route-id.ts'
import {
  REMOTE_ARTIFACT_DIR,
  REMOTE_UPLOAD_DIR,
  claimsRemoteArtifactPath,
  inWorkspaceExtras,
  lexicalPosix,
  specialDir,
  stripTrailingSlash,
  workspaceRelative,
} from '../remote-layout.ts'

export { REMOTE_ARTIFACT_DIR, REMOTE_UPLOAD_DIR, claimsRemoteArtifactPath, inWorkspaceExtras }

/** Tab type registered with better-sidebar. Never the host `files` kind. */
export const WORKSPACE_TAB_ID = 'dsw:workspaces'

/** Affiliate viewer id. It only claims upload/artifact paths. */
export const REMOTE_VIEWER_ID = 'dsw:remote-preview'

const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** One remote session's workspace, recovered from its cwd spelling. */
export interface RemoteWorkspace {
  connectionId: string
  workspace: string
}

/** The two directories the tree always offers. */
export interface SpecialRoot {
  id: 'uploads' | 'artifacts'
  path: string
}

/** One listed row. `browse.files` marks files and directories. */
export interface ListedEntry {
  name: string
  path: string
  hidden: boolean
  kind: 'file' | 'directory'
}

/** Parsed `browse.list` level. */
export interface ListedLevel {
  path: string
  entries: ListedEntry[]
  truncated: boolean
}

/** Wire preview document (`browse.read`). */
export interface PreviewWire {
  path: string
  name: string
  size: number
  kind: 'text' | 'image' | 'pdf' | 'binary'
  truncated: boolean
  text?: string
  base64?: string
  mediaType?: string
}

/** How a click opens: the host bridge, or the in-plugin preview. */
export type PreviewChoice =
  | { kind: 'host'; address: string }
  | { kind: 'plugin' }

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/**
 * `dsh-resource://file/session/<id>/<path>` — the spelling
 * `fileAddressFor` emits. `:` stays literal so a drive letter round-trips.
 * @param path - workspace-relative, or absolute with its leading slash kept.
 */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const encoded = normalized.split('/').map(encodeSegment).join('/')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encoded}`
}

/**
 * Connection id and remote workspace root for a session cwd.
 * Local cwd spellings return null. `ssh://<id>` with no path returns null:
 * there is no workspace to root the tree on.
 */
export function remoteWorkspaceOf(cwd: string | undefined): RemoteWorkspace | null {
  if (cwd === undefined || cwd === '') return null
  if (cwd.startsWith('ssh://')) {
    const rest = cwd.slice('ssh://'.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) return null
    const id = rest.slice(0, slash)
    if (!isClientConnectionId(id)) return null
    const workspace = stripTrailingSlash(lexicalPosix(rest.slice(slash).replaceAll('\\', '/')))
    if (!workspace.startsWith('/')) return null
    return { connectionId: id, workspace }
  }
  const match = /(?:^|[\\/])(?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)(.*)$/i.exec(cwd)
  if (match === null) return null
  const id = match[1]
  if (id === undefined || !isClientConnectionId(id)) return null
  const rest = (match[2] ?? '').replace(/^[\\/]+/, '').replaceAll('\\', '/')
  const workspace = rest === '' ? '/' : stripTrailingSlash(lexicalPosix(`/${rest}`))
  if (!workspace.startsWith('/')) return null
  return { connectionId: id, workspace }
}

/** Upload and artifact directories under a remote workspace. */
export function specialRoots(workspace: string): SpecialRoot[] {
  return [
    { id: 'uploads', path: specialDir(workspace, REMOTE_UPLOAD_DIR) },
    { id: 'artifacts', path: specialDir(workspace, REMOTE_ARTIFACT_DIR) },
  ]
}

/**
 * Prefer the host document preview when it can read this remote file.
 * The bridge is the session address plus `openResource`. It is used only
 * when `workspaceFiles.read` / `readBytes` is present — that is the host
 * path that reads through the session filesystem. A bare `openResource`
 * with no workspace-files namespace is treated as local-only and skipped.
 * Paths outside the workspace never become an `absolute` resource URL.
 */
export function previewChoice(input: {
  sessionId: string
  workspace: string
  remotePath: string
  openResource: unknown
  workspaceFiles: unknown
}): PreviewChoice {
  if (input.sessionId.trim() === '') return { kind: 'plugin' }
  if (typeof input.openResource !== 'function') return { kind: 'plugin' }
  const files = isRecord(input.workspaceFiles) ? input.workspaceFiles : undefined
  const canRead = typeof files?.read === 'function' || typeof files?.readBytes === 'function'
  if (!canRead) return { kind: 'plugin' }
  const relative = workspaceRelative(input.workspace, input.remotePath)
  if (relative === undefined || relative === '') return { kind: 'plugin' }
  return { kind: 'host', address: sessionFileAddress(input.sessionId, relative) }
}

/** Structural `browse.list` value, or undefined when the payload is not a listing. */
export function listedLevel(value: unknown): ListedLevel | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries)) return undefined
  const entries: ListedEntry[] = []
  for (const entry of value.entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.path !== 'string') continue
    if (entry.name === '' || entry.name === '.' || entry.name === '..') continue
    entries.push({
      name: entry.name,
      path: entry.path,
      hidden: entry.hidden === true,
      kind: entry.kind === 'directory' ? 'directory' : 'file',
    })
  }
  return {
    path: typeof value.path === 'string' ? value.path : '',
    entries,
    truncated: value.truncated === true,
  }
}

/** Structural `browse.read` document. */
export function asPreviewWire(value: unknown): PreviewWire | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.path !== 'string' || typeof value.name !== 'string') return undefined
  if (value.kind !== 'text' && value.kind !== 'image' && value.kind !== 'pdf' && value.kind !== 'binary') return undefined
  const wire: PreviewWire = {
    path: value.path,
    name: value.name,
    size: typeof value.size === 'number' ? value.size : 0,
    kind: value.kind,
    truncated: value.truncated === true,
  }
  if (typeof value.text === 'string') wire.text = value.text
  if (typeof value.base64 === 'string') wire.base64 = value.base64
  if (typeof value.mediaType === 'string') wire.mediaType = value.mediaType
  return wire
}

/** SFTP / core "not there yet" — the upload directory may not have been created. */
export function isMissingListing(message: string): boolean {
  return /no such file|not found|enoent|does not exist/i.test(message)
}

/** `workspaceFiles` off the client `remote` service, if that shape is mounted. */
export function workspaceFilesOf(remote: unknown): unknown {
  if (!isRecord(remote)) return undefined
  return remote.workspaceFiles
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Display name of a remote path. */
export function baseName(path: string): string {
  const parts = path.split('/').filter(part => part !== '')
  return parts[parts.length - 1] ?? path
}
