/**
 * REQ-I28: files uploaded into a remote session land in that session's remote
 * workspace, and presented host files outside the workspace are copied beside
 * them. Local sessions stay local. A remote copy that fails rejects the upload.
 *
 * @module dsh-workspace-enhancement/session-uploads
 */

import type { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { modelPrompt } from './model-prompts.ts'
import { quoteShellArg } from './ssh-core.ts'
import { remoteRouteFromCwd } from './transport.ts'
import type { SshTransport } from './transport.ts'

/** Directory under the remote workspace that receives user uploads. */
export const REMOTE_UPLOAD_DIR = '.dsh-uploads'

/** Directory under the remote workspace that receives copied host artifacts. */
export const REMOTE_ARTIFACT_DIR = '.dsh-artifacts'

const mirrored = new Map<string, string>()
const presented = new Map<string, string[]>()

/** Drop in-memory upload/artifact records (tests). */
export function resetSessionUploadsForTests(): void {
  mirrored.clear()
  presented.clear()
}

/**
 * A single path segment safe to place under the remote workspace.
 * @param name - the display name from the upload or artifact.
 */
export function safeUploadLeaf(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = base.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file'
  return cleaned.slice(0, 120)
}

/**
 * Where one upload goes when the session cwd is a remote workspace.
 * @returns null for a local (or unroutable) cwd.
 */
export function planRemoteUpload(
  cwd: string | undefined,
  name: string,
  attachmentId: string,
): { machineId: string; remotePath: string; leaf: string } | null {
  const route = remoteRouteFromCwd(cwd)
  if (route === null || route.path === '') return null
  const hex = attachmentId.replace(/^sha256:/, '').replace(/[^0-9a-f]/gi, '').slice(0, 8)
  const tag = hex === '' ? 'upload' : hex
  const leaf = `${tag}-${safeUploadLeaf(name)}`
  return {
    machineId: route.connectionId,
    remotePath: posix.join(route.path, REMOTE_UPLOAD_DIR, leaf),
    leaf,
  }
}

/** Uploads already copied for one session, in insertion order. */
export function sessionUploadsFor(sessionId: string): readonly { attachmentId: string; remotePath: string }[] {
  const prefix = `${sessionId}\0`
  const rows: { attachmentId: string; remotePath: string }[] = []
  for (const [key, remotePath] of mirrored) {
    if (!key.startsWith(prefix)) continue
    rows.push({ attachmentId: key.slice(prefix.length), remotePath })
  }
  return rows
}

/** Presented paths already recorded for one session. */
export function sessionPresentedFor(sessionId: string): readonly string[] {
  return presented.get(sessionId) ?? []
}

/** Remember one remote path so the runtime context can name it. */
export function recordPresented(sessionId: string, remotePath: string): void {
  const list = presented.get(sessionId) ?? []
  if (!list.includes(remotePath)) {
    list.push(remotePath)
    presented.set(sessionId, list)
  }
}

/**
 * Model-facing lines naming files already copied into the remote workspace.
 * Empty when this session has none (a local session injects nothing).
 */
export function renderRemoteFileLines(sessionId: string | undefined): string {
  if (sessionId === undefined || sessionId === '') return ''
  const paths = [
    ...sessionUploadsFor(sessionId).map(row => row.remotePath),
    ...sessionPresentedFor(sessionId),
  ]
  if (paths.length === 0) return ''
  return [modelPrompt('remoteFilesHeading'), ...paths.map(path => modelPrompt('remoteFileItem', { path }))].join('\n')
}

/** Minimal transport face used to mkdir + SFTP-write one remote file. */
export interface RemoteFileWriter {
  exec: SshTransport['exec']
  getSftp: SshTransport['getSftp']
}

/**
 * Write `data` to an absolute remote path, creating the parent directory.
 * @throws when mkdir fails or SFTP rejects the write.
 */
export async function writeRemoteWorkspaceFile(
  transport: RemoteFileWriter,
  remotePath: string,
  data: Buffer,
): Promise<void> {
  const dir = posix.dirname(remotePath)
  const made = await transport.exec(`mkdir -p -- ${quoteShellArg(dir)}`)
  if (made.exitCode !== 0) {
    const detail = (made.stderr || made.stdout || 'mkdir failed').trim()
    throw new Error(`remote workspace upload failed: ${detail}`)
  }
  const sftp = await transport.getSftp()
  await new Promise<void>((resolve, reject) => {
    sftp.writeFile(remotePath, data, (error?: Error | null) => {
      if (error != null) reject(error)
      else resolve()
    })
  })
}

/** Attachment store face (host `ctx.attachments`). */
export interface AttachmentByteSource {
  fileHostPath?: (ref: unknown) => unknown
  readFileStream?: (ref: unknown) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>
}

/**
 * Read one attachment's bytes from the host store.
 * @throws when neither a host path nor a stream is available.
 */
export async function readAttachmentBytes(store: AttachmentByteSource, ref: unknown): Promise<Buffer> {
  if (typeof store.fileHostPath === 'function') {
    const hostPath = store.fileHostPath(ref)
    if (typeof hostPath === 'string' && hostPath !== '') return readFileSync(hostPath)
  }
  if (typeof store.readFileStream === 'function') {
    const stream = await store.readFileStream(ref)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  throw new Error('remote workspace upload failed: attachment bytes unavailable')
}

/**
 * Copy one uploaded file into the remote workspace when the cwd routes remote.
 * A local cwd returns null. A remote write error propagates.
 */
export async function mirrorUploadedFile(input: {
  cwd: string | undefined
  sessionId: string
  file: { attachmentId?: string; name?: string }
  read: () => Promise<Buffer>
  write: (remotePath: string, data: Buffer) => Promise<void>
}): Promise<{ remotePath: string } | null> {
  const attachmentId = input.file.attachmentId ?? ''
  const plan = planRemoteUpload(input.cwd, input.file.name ?? 'file', attachmentId)
  if (plan === null) return null
  const key = `${input.sessionId}\0${attachmentId}`
  const existing = mirrored.get(key)
  if (existing !== undefined) return { remotePath: existing }
  const data = await input.read()
  await input.write(plan.remotePath, data)
  mirrored.set(key, plan.remotePath)
  return { remotePath: plan.remotePath }
}

/** One presented path: already remote, or a host file that should be copied. */
export interface ArtifactAction {
  remotePath: string
  name: string
  copyHostPath?: string
}

/**
 * Classify presented paths against a remote workspace root.
 * Relative and in-workspace paths are recorded. Host-absolute paths outside
 * the workspace are copied only when they exist on this machine. `ssh://`
 * routes and `..` segments are ignored.
 */
export function artifactActions(workspace: string, paths: readonly string[]): ArtifactAction[] {
  const root = workspace.endsWith('/') && workspace.length > 1 ? workspace.slice(0, -1) : workspace
  const actions: ArtifactAction[] = []
  for (const raw of paths) {
    if (raw.startsWith('ssh://') || raw.split('/').includes('..')) continue
    if (!raw.startsWith('/')) {
      const remotePath = posix.normalize(posix.join(root, raw))
      actions.push({ remotePath, name: posix.basename(remotePath) })
      continue
    }
    if (raw === root || raw.startsWith(`${root}/`)) {
      actions.push({ remotePath: raw, name: posix.basename(raw) })
      continue
    }
    const name = safeUploadLeaf(posix.basename(raw))
    actions.push({
      remotePath: posix.join(root, REMOTE_ARTIFACT_DIR, name),
      name,
      copyHostPath: raw,
    })
  }
  return actions
}

interface FileUploadsFace {
  upload?: (agent: unknown, request: unknown) => Promise<unknown>
  uploadStream?: (request: unknown) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sessionIdFrom(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.sessionId === 'string' && value.sessionId !== '') return value.sessionId
  const agent = isRecord(value.agent) ? value.agent : value
  const session = isRecord(agent.session) ? agent.session : undefined
  const header = session !== undefined && isRecord(session.header) ? session.header : undefined
  return typeof header?.id === 'string' && header.id !== '' ? header.id : undefined
}

function cwdFrom(ctx: Context, value: unknown, sessionId: string | undefined): string | undefined {
  if (isRecord(value)) {
    const agent = isRecord(value.agent) ? value.agent : undefined
    const direct = agent !== undefined && isRecord(agent.session) && isRecord(agent.session.header)
      ? agent.session.header.cwd
      : undefined
    if (typeof direct === 'string' && direct !== '') return direct
  }
  if (sessionId === undefined || typeof ctx.get !== 'function') return undefined
  const agents = ctx.get('agents', false) as {
    get?: (id: string) => { session?: { header?: { cwd?: string } } } | undefined
  } | undefined
  const cwd = agents?.get?.(sessionId)?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

async function mirrorAfter(ctx: Context, requestLike: unknown, result: unknown): Promise<void> {
  const file = isRecord(result) && isRecord(result.file) ? result.file : {}
  const attachmentId = typeof file.attachmentId === 'string' ? file.attachmentId : ''
  const name = typeof file.name === 'string' ? file.name : 'file'
  const sessionId = sessionIdFrom(requestLike) ?? ''
  const cwd = cwdFrom(ctx, requestLike, sessionId === '' ? undefined : sessionId)
  if (cwd === undefined || remoteRouteFromCwd(cwd) === null) return
  const registry = typeof ctx.get === 'function'
    ? ctx.get('sshRegistry', false) as { get?: (id: string) => RemoteFileWriter | undefined } | undefined
    : undefined
  const attachments = typeof ctx.get === 'function'
    ? ctx.get('attachments', false) as AttachmentByteSource | undefined
    : undefined
  await mirrorUploadedFile({
    cwd,
    sessionId,
    file: { attachmentId, name },
    read: async () => {
      if (attachments === undefined) throw new Error('remote workspace upload failed: attachments unavailable')
      return readAttachmentBytes(attachments, file.attachmentId !== undefined ? file : attachmentId)
    },
    write: async (remotePath, data) => {
      const route = remoteRouteFromCwd(cwd)
      const connection = route === null ? undefined : registry?.get?.(route.connectionId)
      if (connection === undefined) throw new Error('remote workspace upload failed: machine is not connected')
      await writeRemoteWorkspaceFile(connection, remotePath, data)
    },
  })
}

async function onPresented(ctx: Context, event: unknown): Promise<void> {
  if (!isRecord(event)) return
  const type = typeof event.type === 'string'
    ? event.type
    : (isRecord(event.data) && typeof event.data.type === 'string' ? event.data.type : '')
  if (type !== 'deliverables/presented') return
  const body = isRecord(event.data) ? event.data : event
  const files = Array.isArray(body.files) ? body.files : []
  const paths = files
    .map(file => (isRecord(file) && typeof file.path === 'string' ? file.path : ''))
    .filter(path => path !== '')
  const sessionId = sessionIdFrom(event) ?? sessionIdFrom(body)
  const cwd = cwdFrom(ctx, event, sessionId)
  const route = remoteRouteFromCwd(cwd)
  if (route === null || sessionId === undefined) return
  const registry = typeof ctx.get === 'function'
    ? ctx.get('sshRegistry', false) as { get?: (id: string) => RemoteFileWriter | undefined } | undefined
    : undefined
  for (const action of artifactActions(route.path, paths)) {
    if (action.copyHostPath !== undefined) {
      if (!existsSync(action.copyHostPath)) continue
      const connection = registry?.get?.(route.connectionId)
      if (connection === undefined) continue
      await writeRemoteWorkspaceFile(connection, action.remotePath, readFileSync(action.copyHostPath))
    }
    recordPresented(sessionId, action.remotePath)
  }
}

/**
 * Wrap host file uploads so a remote session cwd copies the file into the
 * remote workspace before the upload promise resolves. No-op when the host
 * has no `fileUploads` service (boot-smoke). Effect-bound, so unload restores
 * the original methods.
 */
export function installRemoteSessionUploads(ctx: Context): void {
  if (typeof ctx.get !== 'function') return
  const uploads = ctx.get('fileUploads' as 'agents', false) as unknown as FileUploadsFace | undefined
  if (uploads === undefined || (typeof uploads.upload !== 'function' && typeof uploads.uploadStream !== 'function')) return
  const originalUpload = typeof uploads.upload === 'function' ? uploads.upload.bind(uploads) : undefined
  const originalStream = typeof uploads.uploadStream === 'function' ? uploads.uploadStream.bind(uploads) : undefined
  if (originalStream !== undefined) {
    uploads.uploadStream = async (request: unknown) => {
      const result = await originalStream(request)
      await mirrorAfter(ctx, request, result)
      return result
    }
  }
  if (originalUpload !== undefined) {
    uploads.upload = async (agent: unknown, request: unknown) => {
      const result = await originalUpload(agent, request)
      const carrier = isRecord(request) ? { ...request, agent } : { agent, request }
      await mirrorAfter(ctx, carrier, result)
      return result
    }
  }
  ctx.effect(() => () => {
    if (originalUpload !== undefined) uploads.upload = originalUpload
    if (originalStream !== undefined) uploads.uploadStream = originalStream
  }, 'dsw remote session uploads')
  ctx.effect(() => ctx.on('session/event' as 'agent/created', ((event: unknown) => {
    void onPresented(ctx, event).catch(() => undefined)
  }) as never), 'dsw remote presented artifacts')
}
