/**
 * REQ-I5: FileSystemBranch backed by a core RPC session.
 * editText stays host-side (read + patch + fs.write).
 *
 * @module dsh-workspace-enhancement/core-fs
 */

import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'
import { CoreClient, CoreRpcError } from './core-client.ts'
import { CORE_ERROR_NOT_FOUND, CORE_ERROR_READ_ONLY, CORE_METHODS, asRecord } from './core-protocol.ts'
import { RemoteSandboxError } from './remote-sandbox.ts'
import {
  initiatorSessionOf,
  isConfinedSandboxMode,
  resolveRemoteSessionMode,
  sftpFallbackForCoreGap,
} from './remote-policy.ts'
import type { RemoteFsFace } from './remote-policy.ts'
import type { CoreHub } from './core-hub.ts'
import { SshFileSystemEngine } from './filesystem.ts'
import { parseSshTargetKey, resolveSshCwd, resolveSshTargetKey, sshTargetKey } from './transport.ts'
import type { FileSystemBranch } from './mixed.ts'

const BINARY_SAMPLE_BYTES = 8192

function assertNotAborted(signal: AbortSignal | undefined, operation: string): void {
  if (signal?.aborted === true) throw new FsError(`${operation} aborted`, 'FS_ABORTED')
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

function detectsCrlf(value: string): boolean {
  const sample = value.slice(0, 4096)
  const crlf = sample.split('\r\n').length - 1
  const lf = sample.split('\n').length - 1 - crlf
  return crlf > lf
}

function restoreLineEndings(value: string, crlf: boolean): string {
  return crlf ? normalizeLineEndings(value).replaceAll('\n', '\r\n') : value
}

function decodeText(bytes: Uint8Array, displayPath: string): string {
  if (bytes.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) {
    throw new FsError(`cannot read "${displayPath}": binary file`, 'FS_NOT_TEXT')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new FsError(`cannot read "${displayPath}": invalid UTF-8 text`, 'FS_NOT_TEXT', { cause: error })
  }
}

function literalEdit(content: string, request: FsEditRequest, displayPath: string): string {
  const oldString = normalizeLineEndings(request.oldString)
  const newString = normalizeLineEndings(request.newString)
  if (oldString.length === 0) {
    throw new FsError(`cannot edit "${displayPath}": old_string must be non-empty`, 'FS_EDIT_NOT_FOUND')
  }
  let matches = 0
  let offset = 0
  while (true) {
    const found = content.indexOf(oldString, offset)
    if (found < 0) break
    matches += 1
    offset = found + oldString.length
  }
  if (matches === 0) throw new FsError(`cannot edit "${displayPath}": old_string was not found`, 'FS_EDIT_NOT_FOUND')
  if (!request.replaceAll && matches !== 1) {
    throw new FsError(`cannot edit "${displayPath}": old_string matched ${matches} times`, 'FS_AMBIGUOUS_EDIT')
  }
  return request.replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
}

function sandboxDenied(operation: string, displayPath: string, mode: SandboxMode, cause?: unknown): FsError {
  const marker = sandboxDenialMarker(mode)
  const message = `cannot ${operation} "${displayPath}": file access denied under ${mode} mode ${marker}`
  if (cause !== undefined) return new FsError(message, 'FS_SANDBOX_DENIED', { cause })
  return new FsError(message, 'FS_SANDBOX_DENIED')
}

function mapRpc(
  error: unknown,
  operation: string,
  displayPath: string,
  signal?: AbortSignal,
  mode: SandboxMode = 'workspace-write',
): FsError {
  if (error instanceof FsError) return error
  if (signal?.aborted === true) return new FsError(`${operation} aborted`, 'FS_ABORTED', { cause: error })
  if (error instanceof RemoteSandboxError) {
    return new FsError(error.message, 'FS_SANDBOX_DENIED', { cause: error })
  }
  const code = error instanceof CoreRpcError ? error.code : ''
  const message = error instanceof Error ? error.message : String(error)
  if (code === CORE_ERROR_NOT_FOUND || /ENOENT|not found/i.test(message)) {
    return new FsError(`cannot ${operation} "${displayPath}": not found`, 'FS_NOT_FOUND', { cause: error })
  }
  if (code === CORE_ERROR_READ_ONLY || /EROFS|read-only/i.test(message)) {
    return sandboxDenied(operation, displayPath, mode, error)
  }
  if (/EACCES|permission denied/i.test(`${code} ${message}`)) {
    if (isConfinedSandboxMode(mode)) return sandboxDenied(operation, displayPath, mode, error)
    return new FsError(`cannot ${operation} "${displayPath}": permission denied`, 'FS_PERMISSION_DENIED', { cause: error })
  }
  return new FsError(`cannot ${operation} "${displayPath}": ${message}`, 'FS_IO_ERROR', { cause: error })
}

function isMissingRpc(error: unknown): boolean {
  const code = error instanceof CoreRpcError ? error.code : ''
  const message = error instanceof Error ? error.message : String(error)
  return code === CORE_ERROR_NOT_FOUND || /ENOENT|not found/i.test(message)
}

/**
 * Official Write resolves a path before the file exists. Local dsh-fs-local
 * realpaths the nearest existing ancestor; deployed cores that still
 * EvalSymlinks the leaf need the same walk on this side.
 */
export async function realpathAllowMissing(
  lookup: (path: string, signal?: AbortSignal) => Promise<string>,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await lookup(path, signal)
  } catch (error) {
    if (!isMissingRpc(error)) throw error
  }
  const leaf = posix.basename(path)
  const missing: string[] = leaf === '' || leaf === '/' ? [] : [leaf]
  let ancestor = posix.dirname(path)
  while (true) {
    try {
      const realAncestor = await lookup(ancestor, signal)
      return missing.length === 0 ? realAncestor : posix.join(realAncestor, ...missing)
    } catch (error) {
      if (!isMissingRpc(error)) throw error
      const parent = posix.dirname(ancestor)
      if (parent === ancestor) return path
      const base = posix.basename(ancestor)
      if (base !== '') missing.unshift(base)
      ancestor = parent
    }
  }
}

function asStat(raw: unknown): { type: FsInfo['type']; size?: number; version: ReturnType<typeof FsVersion> } | undefined {
  const rec = asRecord(raw)
  if (rec === undefined) return undefined
  const type = rec.type === 'file' || rec.type === 'directory' || rec.type === 'other'
    ? rec.type
    : rec.type === 'symlink' ? 'other' : 'other'
  const version = FsVersion(typeof rec.version === 'string' ? rec.version : 'core:unknown')
  if (type === 'file' && typeof rec.size === 'number') return { type, version, size: rec.size }
  return { type, version }
}

export class CoreFileSystem implements FileSystemBranch {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly ctx: Context,
    private readonly client: CoreClient,
    private readonly mode: SandboxMode = 'workspace-write',
  ) {}

  processPathFromHostPath(_hostPath: string): string | undefined {
    return undefined
  }

  processPath(target: FsTarget): string {
    return resolveSshTargetKey(this.ctx, String(target.targetKey)).path
  }

  fileUrl(target: FsTarget): string {
    const path = this.processPath(target)
    return `file://${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    const parentRoute = parseSshTargetKey(String(parent.targetKey))
    const childRoute = parseSshTargetKey(String(child.targetKey))
    if (parentRoute.connectionId !== childRoute.connectionId) return false
    const relative = posix.relative(parentRoute.path, childRoute.path)
    return relative === '' || (relative !== '..' && !relative.startsWith('../') && !posix.isAbsolute(relative))
  }

  async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    assertNotAborted(opts?.signal, 'resolve')
    if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
    const route = resolveSshCwd(this.ctx, opts?.cwd)
    const remotePath = posix.resolve(route.cwd, path)
    const displayPath = route.connectionId === undefined ? remotePath : sshTargetKey(route.connectionId, remotePath)
    try {
      const canonical = await realpathAllowMissing(async (probe, signal) => {
        const ok = asRecord(await this.client.call(CORE_METHODS.fsRealpath, { path: probe }, signal))
        return typeof ok?.path === 'string' ? ok.path : probe
      }, remotePath, opts?.signal)
      const targetKey = route.connectionId === undefined ? canonical : sshTargetKey(route.connectionId, canonical)
      return { targetKey: FsTargetKey(targetKey), displayPath }
    } catch (error: unknown) {
      throw mapRpc(error, 'resolve', displayPath, opts?.signal, this.mode)
    }
  }

  async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    assertNotAborted(signal, 'stat')
    const route = resolveSshTargetKey(this.ctx, String(target.targetKey))
    try {
      const raw = await this.client.call(CORE_METHODS.fsStat, { path: route.path }, signal)
      const st = asStat(raw)
      if (st === undefined) return undefined
      return { version: st.version, type: st.type, ...(st.size !== undefined ? { size: st.size } : {}) }
    } catch (error: unknown) {
      throw mapRpc(error, 'stat', target.displayPath, signal, this.mode)
    }
  }

  async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    assertNotAborted(signal, 'lstat')
    const route = resolveSshCwd(this.ctx, opts?.cwd)
    const remotePath = posix.resolve(route.cwd, path)
    const displayPath = route.connectionId === undefined ? remotePath : sshTargetKey(route.connectionId, remotePath)
    try {
      const raw = await this.client.call(CORE_METHODS.fsLstat, { path: remotePath }, signal)
      const st = asStat(raw)
      if (st === undefined) return undefined
      return { version: st.version, type: st.type, ...(st.size !== undefined ? { size: st.size } : {}) }
    } catch (error: unknown) {
      throw mapRpc(error, 'lstat', displayPath, signal, this.mode)
    }
  }

  async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    const bytes = await this.readBytes(target, signal, Number.POSITIVE_INFINITY)
    return decodeText(bytes, target.displayPath)
  }

  async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const info = await this.stat(target, signal)
    if (info === undefined) throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    if (info.type !== 'file') throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
    if (info.size !== undefined && info.size > maxBytes) {
      throw new FsError(`cannot read "${target.displayPath}": ${info.size} bytes exceeds the ${maxBytes}-byte limit`, 'FS_TOO_LARGE')
    }
    const route = resolveSshTargetKey(this.ctx, String(target.targetKey))
    try {
      const rec = asRecord(await this.client.call(CORE_METHODS.fsRead, { path: route.path }, signal))
      const bytes = Buffer.from(String(rec?.b64 ?? ''), 'base64')
      if (bytes.length > maxBytes) {
        throw new FsError(`cannot read "${target.displayPath}": ${bytes.length} bytes exceeds the ${maxBytes}-byte limit`, 'FS_TOO_LARGE')
      }
      return bytes
    } catch (error: unknown) {
      throw mapRpc(error, 'read', target.displayPath, signal, this.mode)
    }
  }

  async readByteRange(
    target: FsTarget,
    range: { offset: number; length: number },
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (range.length === 0) return new Uint8Array(0)
    const route = resolveSshTargetKey(this.ctx, String(target.targetKey))
    try {
      const rec = asRecord(await this.client.call(CORE_METHODS.fsReadRange, {
        path: route.path,
        offset: range.offset,
        length: range.length,
      }, signal))
      return Buffer.from(String(rec?.b64 ?? ''), 'base64')
    } catch (error: unknown) {
      throw mapRpc(error, 'read', target.displayPath, signal, this.mode)
    }
  }

  async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const text = await this.readText(target, signal)
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        yield text
      },
    }
  }

  async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const info = await this.stat(target, signal)
    if (info === undefined) throw new FsError(`cannot list "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    if (info.type !== 'directory') throw new FsError(`cannot list "${target.displayPath}": not a directory`, 'FS_NOT_DIRECTORY')
    const route = resolveSshTargetKey(this.ctx, String(target.targetKey))
    try {
      const rec = asRecord(await this.client.call(CORE_METHODS.fsListDir, { path: route.path }, signal))
      const entries = Array.isArray(rec?.entries) ? rec.entries : []
      const out: FsDirEntry[] = []
      for (const item of entries) {
        const row = asRecord(item)
        if (row === undefined || typeof row.name !== 'string') continue
        const childRemote = posix.join(route.path, row.name)
        const st = asStat(row)
        const childKey = route.connectionId === undefined ? childRemote : sshTargetKey(route.connectionId, childRemote)
        const childDisplay = route.connectionId === undefined ? childRemote : sshTargetKey(route.connectionId, childRemote)
        out.push({
          name: row.name,
          type: st?.type ?? 'other',
          target: { targetKey: FsTargetKey(childKey), displayPath: childDisplay },
          version: st?.version ?? FsVersion('core:unknown'),
          ...(st?.size !== undefined ? { size: st.size } : {}),
        })
      }
      return out.sort((left, right) => left.name.localeCompare(right.name))
    } catch (error: unknown) {
      throw mapRpc(error, 'list', target.displayPath, signal, this.mode)
    }
  }

  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    return this.withLock(String(target.targetKey), async () => {
      const existing = await this.stat(target, signal)
      if (existing !== undefined && existing.type !== 'file') {
        throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
        throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
      }
      if (expected?.kind === 'replaceIfVersion' && existing !== undefined && existing.version !== expected.version) {
        throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }
      const before = existing === undefined ? null : normalizeLineEndings(await this.readText(target, signal).catch(() => ''))
      return this.writeUnlocked(target, content, expected?.kind === 'createIfAbsent', existing === undefined, before, signal)
    })
  }

  async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: ReturnType<typeof FsVersion> },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    return this.withLock(String(target.targetKey), async () => {
      const existing = await this.stat(target, signal)
      if (existing === undefined) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }
      if (existing.type !== 'file') {
        throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      if (expected !== undefined && existing.version !== expected.version) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }
      const raw = await this.readText(target, signal)
      const before = normalizeLineEndings(raw)
      const after = literalEdit(before, edit, target.displayPath)
      const storage = restoreLineEndings(after, detectsCrlf(raw))
      const written = await this.writeUnlocked(target, storage, false, false, before, signal)
      return { version: written.version, before, after }
    })
  }

  private async writeUnlocked(
    target: FsTarget,
    content: string,
    createIfAbsent: boolean,
    created: boolean,
    before: string | null,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    const route = resolveSshTargetKey(this.ctx, String(target.targetKey))
    try {
      const raw = await this.client.call(CORE_METHODS.fsWrite, {
        path: route.path,
        b64: Buffer.from(content, 'utf8').toString('base64'),
        createIfAbsent,
      }, signal)
      const st = asStat(raw)
      return {
        operation: created ? 'create' : 'update',
        version: st?.version ?? FsVersion('core:unknown'),
        before,
        after: normalizeLineEndings(content),
      }
    } catch (error: unknown) {
      throw mapRpc(error, 'write', target.displayPath, signal, this.mode)
    }
  }

  private async withLock<T>(targetKey: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(targetKey) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.locks.set(targetKey, tail)
    try {
      return await run
    } finally {
      if (this.locks.get(targetKey) === tail) this.locks.delete(targetKey)
    }
  }
}

/**
 * Remote-world filesystem: core RPC when a Linux core is up.
 * REQ-I15: confined + missing core → **reads** fall back to SFTP (so host
 * project-root probes and official Read still work); writes stay fail-closed.
 * danger-full-access with no core stays today's SFTP for every face.
 */
export class CoreRoutingFileSystem implements FileSystemBranch {
  constructor(
    private readonly ctx: Context,
    private readonly sftp: SshFileSystemEngine,
    private readonly hub: CoreHub,
  ) {}

  processPathFromHostPath(_hostPath: string): string | undefined {
    return undefined
  }

  private async delegate(
    connectionId: string | undefined,
    opts?: { signal?: AbortSignal; path?: string; cwd?: string; sandboxPolicy?: unknown },
    face: RemoteFsFace = 'read',
  ): Promise<FileSystemBranch> {
    const policy = resolveRemoteSessionMode(this.ctx, opts?.sandboxPolicy)
    if (connectionId === undefined) return this.sftp
    const sessionCwd = opts?.cwd ?? initiatorSessionOf(this.ctx)?.header?.cwd
    try {
      const client = await this.hub.require(connectionId, {
        policy,
        ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
        ...(opts?.path !== undefined ? { path: opts.path } : {}),
        ...(sessionCwd !== undefined ? { cwd: sessionCwd } : {}),
      })
      return new CoreFileSystem(this.ctx, client, policy)
    } catch (error) {
      if (sftpFallbackForCoreGap(policy, face, error)) return this.sftp
      throw mapRpc(error, 'use fenced core', connectionId, opts?.signal, policy)
    }
  }

  private idOfTarget(target: FsTarget): string | undefined {
    return parseSshTargetKey(String(target.targetKey)).connectionId
  }

  private pathOf(target: FsTarget): string {
    return parseSshTargetKey(String(target.targetKey)).path
  }

  private targetOpts(
    target: FsTarget,
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): { path: string; signal?: AbortSignal; sandboxPolicy?: unknown } {
    return {
      path: this.pathOf(target),
      ...(signal !== undefined ? { signal } : {}),
      ...(sandboxPolicy !== undefined ? { sandboxPolicy } : {}),
    }
  }

  processPath(target: FsTarget): string {
    return this.sftp.processPath(target)
  }

  fileUrl(target: FsTarget): string {
    return this.sftp.fileUrl(target)
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    return this.sftp.contains(parent, child)
  }

  async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const route = resolveSshCwd(this.ctx, opts?.cwd)
    // BUG-4: a probe offers the TARGET as `path`, never as `cwd`. A cwd that is
    // not an already-declared root mints a sibling workspace-write jail
    // (`resolveCoreWorkspace`), so routing the silent project-root probe's own
    // path through `cwd` turned every ancestor into its own `--workspace` bind
    // (`/home/uuz`, `/home`, …). `path` only ever matches a declared root.
    return (await this.delegate(route.connectionId, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      path: posix.resolve(route.cwd, path),
    })).resolve(path, opts)
  }

  async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).stat(target, signal)
  }

  async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    const route = resolveSshCwd(this.ctx, opts?.cwd)
    // BUG-4: same rule as `resolve` — the probe target is a `path`, and the
    // delegate falls back to the initiator session's cwd for the jail.
    return (await this.delegate(route.connectionId, {
      ...(signal !== undefined ? { signal } : {}),
      path: posix.resolve(route.cwd, path),
    })).lstat(path, opts, signal)
  }

  async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).readText(target, signal)
  }

  async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).streamText(target, signal)
  }

  async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).readBytes(target, signal, maxBytes)
  }

  async readByteRange(
    target: FsTarget,
    range: { offset: number; length: number },
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const branch = await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))
    if (branch.readByteRange === undefined) {
      throw new FsError(`cannot read "${target.displayPath}": windowed reads are unavailable`, 'FS_IO_ERROR')
    }
    return branch.readByteRange(target, range, signal)
  }

  async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).listDir(target, signal)
  }

  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<FsWriteOutcome> {
    const branch = await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal, sandboxPolicy), 'write')
    return branch.writeText(target, content, expected, signal, sandboxPolicy)
  }

  async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: ReturnType<typeof FsVersion> },
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<FsEditOutcome> {
    const branch = await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal, sandboxPolicy), 'write')
    return branch.editText(target, edit, expected, signal, sandboxPolicy)
  }
}
