/**
 * Bounded remote preview read (REQ-A6 C2).
 *
 * The host document preview speaks `dsh-resource://` and reads through the
 * session filesystem. That works for in-workspace remote paths when the
 * client actually has `workspaceFiles`. When it does not — a local-only
 * resource URL cannot name a remote file — the panel reads bytes here and
 * renders text, images, and PDFs itself.
 *
 * @module dsh-workspace-enhancement/remote-preview
 */

import type { Context } from '@deepseek-ai/cordis'
import { remoteRouteFromCwd } from './transport.ts'
import { workspaceRelative } from './remote-layout.ts'

/** BUG-16: ordinary workspace previews require an explicit matching remote session. */
export function workspacePreviewAllowed(cwd: string | undefined, connectionId: string, path: string): boolean {
  const route = remoteRouteFromCwd(cwd)
  if (route === null || route.connectionId !== connectionId) return false
  const relative = workspaceRelative(route.path, path)
  return relative !== undefined && relative !== ''
}

/** Preview transfer cap. Larger images and PDFs are refused; text is cut. */
export const PREVIEW_MAX_BYTES = 1_572_864

/** Wire document the client renders. Bytes ride as base64 only for media. */
export interface RemotePreviewDocument {
  path: string
  name: string
  size: number
  kind: 'text' | 'image' | 'pdf' | 'binary'
  truncated: boolean
  text?: string
  base64?: string
  mediaType?: string
}

/** The slice of SFTP this reader uses (ssh2's wrapper satisfies it). */
export interface PreviewSftp {
  stat(path: string, callback: (error: Error | null | undefined, stats?: PreviewStat) => void): void
  open(path: string, flags: string, callback: (error: Error | null | undefined, handle?: Buffer) => void): void
  read(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error: Error | null | undefined, bytesRead: number) => void,
  ): void
  close(handle: Buffer, callback: (error?: Error | null) => void): void
}

/** Stat fields the preview cares about. */
export interface PreviewStat {
  size: number
  isFile(): boolean
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'log',
  'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
  'cs', 'php', 'sql', 'csv', 'tsv', 'vue', 'svelte', 'env', 'gitignore',
])

/** File name's lowercase extension, without the dot. */
export function extensionOf(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** Classify a file from its name, then from a UTF-8 sniff of the bytes. */
export function previewKindOf(name: string, bytes: Uint8Array): 'text' | 'image' | 'pdf' | 'binary' {
  const ext = extensionOf(name)
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_TYPES[ext] !== undefined) return 'image'
  if (TEXT_EXTENSIONS.has(ext) || ext === '') {
    if (bytes.byteLength === 0 || looksLikeText(bytes)) return 'text'
    return ext === '' ? 'binary' : 'text'
  }
  if (looksLikeText(bytes)) return 'text'
  return 'binary'
}

/** Media type for an image or PDF; undefined for text and other binaries. */
export function mediaTypeOf(name: string, kind: RemotePreviewDocument['kind']): string | undefined {
  if (kind === 'pdf') return 'application/pdf'
  if (kind === 'image') return IMAGE_TYPES[extensionOf(name)]
  return undefined
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Build the wire document from bytes already read.
 * Oversized images and PDFs carry no payload; oversized text keeps the prefix.
 */
export function previewDocument(
  remotePath: string,
  read: { size: number; bytes: Uint8Array; truncated: boolean },
): RemotePreviewDocument {
  const name = remotePath.split('/').pop() || remotePath
  const kind = previewKindOf(name, read.bytes)
  const mediaType = mediaTypeOf(name, kind)
  const doc: RemotePreviewDocument = {
    path: remotePath,
    name,
    size: read.size,
    kind,
    truncated: read.truncated,
  }
  if (kind === 'text') {
    doc.text = new TextDecoder('utf-8', { fatal: false }).decode(read.bytes)
    return doc
  }
  if ((kind === 'image' || kind === 'pdf') && !read.truncated && mediaType !== undefined) {
    doc.base64 = Buffer.from(read.bytes).toString('base64')
    doc.mediaType = mediaType
  }
  return doc
}

function statOf(sftp: PreviewSftp, path: string): Promise<PreviewStat> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (error, stats) => {
      if (error != null || stats === undefined) reject(error ?? new Error('stat failed'))
      else resolve(stats)
    })
  })
}

function openHandle(sftp: PreviewSftp, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(path, 'r', (error, handle) => {
      if (error != null || handle === undefined) reject(error ?? new Error('open failed'))
      else resolve(handle)
    })
  })
}

function readChunk(sftp: PreviewSftp, handle: Buffer, length: number, position: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.alloc(length)
    sftp.read(handle, buffer, 0, length, position, (error, bytesRead) => {
      if (error != null) reject(error)
      else resolve(buffer.subarray(0, bytesRead))
    })
  })
}

function closeHandle(sftp: PreviewSftp, handle: Buffer): Promise<void> {
  return new Promise((resolve) => {
    sftp.close(handle, () => resolve())
  })
}

/**
 * Read at most `maxBytes` of one remote file. A directory is reported with
 * `isFile: false` and no bytes. The size is the remote stat, so the caller
 * can tell a cut text file from a short one.
 */
export async function readRemotePreviewFile(
  sftp: PreviewSftp,
  remotePath: string,
  maxBytes: number = PREVIEW_MAX_BYTES,
): Promise<{ size: number; bytes: Uint8Array; truncated: boolean; isFile: boolean }> {
  const stats = await statOf(sftp, remotePath)
  if (!stats.isFile()) return { size: stats.size, bytes: new Uint8Array(), truncated: false, isFile: false }
  const want = Math.min(Math.max(stats.size, 0), maxBytes)
  const truncated = stats.size > maxBytes
  if (want === 0) return { size: stats.size, bytes: new Uint8Array(), truncated, isFile: true }
  const handle = await openHandle(sftp, remotePath)
  try {
    const chunks: Buffer[] = []
    let position = 0
    while (position < want) {
      const length = Math.min(65_536, want - position)
      const chunk = await readChunk(sftp, handle, length, position)
      if (chunk.length === 0) break
      chunks.push(chunk)
      position += chunk.length
    }
    return {
      size: stats.size,
      bytes: new Uint8Array(Buffer.concat(chunks)),
      truncated: truncated || position < stats.size,
      isFile: true,
    }
  } finally {
    await closeHandle(sftp, handle)
  }
}

/**
 * The session cwd's remote workspace, when this session routes to `connectionId`.
 * A local session, or a cwd that names a different machine, returns undefined.
 */
export function sessionWorkspaceFor(
  ctx: Context,
  sessionId: string,
  connectionId: string,
): string | undefined {
  if (typeof ctx.get !== 'function' || sessionId === '') return undefined
  const agents = ctx.get('agents', false) as {
    get?: (id: string) => { session?: { header?: { cwd?: string } } } | undefined
  } | undefined
  const cwd = agents?.get?.(sessionId)?.session?.header?.cwd
  const route = remoteRouteFromCwd(typeof cwd === 'string' ? cwd : undefined)
  if (route === null || route.connectionId !== connectionId) return undefined
  return route.path
}
