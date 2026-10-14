/**
 * Remote workspace layout shared by the host preview gate and the client tree.
 *
 * Upload and artifact directories are the REQ-I28 landing zones (ADR-0032).
 * This module stays free of `node:fs` and `ssh2` so the browser bundle can
 * import it. Path checks are lexical: `..` is rejected, never resolved away.
 *
 * @module dsh-workspace-enhancement/remote-layout
 */

/** Directory under the remote workspace that receives user uploads. */
export const REMOTE_UPLOAD_DIR = '.dsh-uploads'

/** Directory under the remote workspace that receives copied host artifacts. */
export const REMOTE_ARTIFACT_DIR = '.dsh-artifacts'

/** Drop a trailing slash, keeping the filesystem root. */
export function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

/**
 * Lexical POSIX normalize. A `..` that would escape an absolute path is kept
 * as a segment so callers can reject it instead of silently walking upward.
 */
export function lexicalPosix(path: string): string {
  const absolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      const top = parts[parts.length - 1]
      if (top !== undefined && top !== '..') parts.pop()
      else parts.push('..')
      continue
    }
    parts.push(part)
  }
  const body = parts.join('/')
  if (absolute) return body === '' ? '/' : `/${body}`
  return body
}

/** True when `path` is absolute and contains no `..` segment. */
export function isSafeAbsolute(path: string): boolean {
  if (path === '' || path.includes('\0') || !path.startsWith('/')) return false
  return !path.split('/').includes('..')
}

/**
 * Path of `remotePath` relative to `workspace`, or undefined when it is not
 * inside that workspace. The workspace root itself is `''`.
 */
export function workspaceRelative(workspace: string, remotePath: string): string | undefined {
  if (!isSafeAbsolute(workspace) || !isSafeAbsolute(remotePath)) return undefined
  const root = stripTrailingSlash(lexicalPosix(workspace))
  const target = lexicalPosix(remotePath)
  if (!isSafeAbsolute(root) || !isSafeAbsolute(target)) return undefined
  if (target === root) return ''
  const prefix = `${root}/`
  if (!target.startsWith(prefix)) return undefined
  return target.slice(prefix.length)
}

/** Absolute remote path of one special directory under a workspace. */
export function specialDir(workspace: string, dir: typeof REMOTE_UPLOAD_DIR | typeof REMOTE_ARTIFACT_DIR): string {
  const root = stripTrailingSlash(lexicalPosix(workspace))
  return `${root === '/' ? '' : root}/${dir}`
}

/** Whether `path` sits in `.dsh-uploads` or `.dsh-artifacts` (any ancestor). */
export function underSpecialDir(workspace: string, path: string): boolean {
  const relative = workspaceRelative(workspace, path)
  if (relative === undefined || relative === '') return false
  const head = relative.split('/')[0]
  return head === REMOTE_UPLOAD_DIR || head === REMOTE_ARTIFACT_DIR
}

/**
 * A remote path the preview may read: inside the workspace, and either under
 * an upload/artifact directory or an exact recorded in-workspace artifact.
 */
export function previewPathAllowed(
  workspace: string,
  path: string,
  recorded: readonly string[],
): boolean {
  const relative = workspaceRelative(workspace, path)
  if (relative === undefined || relative === '') return false
  if (underSpecialDir(workspace, path)) return true
  const target = lexicalPosix(path)
  return recorded.some(item => isSafeAbsolute(item) && lexicalPosix(item) === target)
}

/**
 * Recorded artifact paths that live in the workspace but outside the two
 * special directories — the in-workspace half of REQ-I28.
 */
export function inWorkspaceExtras(workspace: string, paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const extras: string[] = []
  for (const path of paths) {
    if (!previewPathAllowed(workspace, path, [path])) continue
    if (underSpecialDir(workspace, path)) continue
    const target = lexicalPosix(path)
    if (seen.has(target)) continue
    seen.add(target)
    extras.push(target)
  }
  return extras
}

/**
 * Affiliate viewer claim: a path segment is exactly an upload or artifact
 * directory. A look-alike name (`.dsh-uploads-old`) does not match, so this
 * never claims the host's ordinary files.
 */
export function claimsRemoteArtifactPath(path: string): boolean {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts.includes(REMOTE_UPLOAD_DIR) || parts.includes(REMOTE_ARTIFACT_DIR)
}
