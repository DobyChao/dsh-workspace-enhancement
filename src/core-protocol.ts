/**
 * REQ-I5 / ADR-0024: framed JSON protocol for the remote core.
 *
 * Pure codec + constants. No SSH, no filesystem, no Go — so the plugin and
 * the fake in-process core share one encoder, and tests can pin golden frames
 * without a live binary.
 *
 * Frame layout: 4-byte big-endian length + UTF-8 JSON. Unknown JSON keys are
 * ignored by construction (we only read named fields). Unknown methods are a
 * server concern (`UNIMPLEMENTED`).
 *
 * @module dsh-workspace-enhancement/core-protocol
 */

export const CORE_PROTO = 1

/** Single-frame payload cap (bytes of JSON, not including the length prefix). */
export const CORE_MAX_FRAME = 16 * 1024 * 1024

/**
 * Artifact / hello version. Keep in lockstep with `core/artifact.json`.
 *
 * Single source of truth is `core/artifact.json`; `src/core-artifact.ts` is
 * generated from it by `npm run sync:core-manifest`, and `npm run check:static`
 * fails when that projection is stale (INFRA-15 drift guard). The Go const
 * `coreArtifactVersion` in `core/protocol.go` must match (hello / `dsh-core
 * version`). Re-exported here so every consumer keeps importing it from the
 * protocol module.
 */
export { CORE_ARTIFACT_ARCH, CORE_ARTIFACT_VERSION } from './core-artifact.ts'

/** v1 capability names advertised by `hello`. */
export const CORE_CAPS = ['fs', 'spawn', 'rg'] as const

export type CoreCap = (typeof CORE_CAPS)[number]

export const CORE_ERROR_UNIMPLEMENTED = 'UNIMPLEMENTED'
export const CORE_ERROR_SANDBOX = 'SANDBOX_UNAVAILABLE'
export const CORE_ERROR_BAD_REQUEST = 'BAD_REQUEST'
export const CORE_ERROR_IO = 'EIO'
export const CORE_ERROR_NOT_FOUND = 'ENOENT'
export const CORE_ERROR_PERMISSION = 'EACCES'
export const CORE_ERROR_READ_ONLY = 'EROFS'
export const CORE_ERROR_EXISTS = 'EEXIST'
export const CORE_ERROR_NOT_DIR = 'ENOTDIR'
export const CORE_ERROR_IS_DIR = 'EISDIR'

/** Remote install prefix (login-user writable, no root). */
export const CORE_REMOTE_HOME = '~/.dsh-core'

export const CORE_METHODS = {
  hello: 'hello',
  fsRealpath: 'fs.realpath',
  fsStat: 'fs.stat',
  fsLstat: 'fs.lstat',
  fsRead: 'fs.read',
  fsReadRange: 'fs.readRange',
  fsListDir: 'fs.listDir',
  fsWrite: 'fs.write',
  fsMkdir: 'fs.mkdir',
  spawnStart: 'spawn.start',
  spawnStdin: 'spawn.stdin',
  spawnTerminate: 'spawn.terminate',
} as const

export const CORE_EVENTS = {
  spawnStdout: 'spawn.stdout',
  spawnStderr: 'spawn.stderr',
  spawnExit: 'spawn.exit',
} as const

/** One protocol message (request, response, or event). Extra JSON keys tolerated. */
export interface CoreMessage {
  proto: number
  id: number
  m?: string
  p?: unknown
  ok?: unknown
  err?: CoreErrorBody
}

export interface CoreErrorBody {
  code: string
  message: string
}

export interface CoreHelloOk {
  proto: number
  version: string
  arch: string
  caps: readonly string[]
  sandbox: 'read-only' | 'workspace-write' | 'off'
}

export interface CoreStatOk {
  type: 'file' | 'directory' | 'symlink' | 'other'
  size?: number
  mode: number
  mtimeMs: number
  /** Opaque version token the host echoes back on write/edit. */
  version: string
}

export interface CoreListEntry {
  name: string
  type: CoreStatOk['type']
  size?: number
  version: string
}

/**
 * Encode one message as a length-prefixed frame.
 * @param message - protocol object; `proto` is filled with {@link CORE_PROTO} when omitted.
 */
export function encodeFrame(message: Omit<CoreMessage, 'proto'> & { proto?: number }): Buffer {
  const body: CoreMessage = { proto: message.proto ?? CORE_PROTO, id: message.id }
  if (message.m !== undefined) body.m = message.m
  if (message.p !== undefined) body.p = message.p
  if (message.ok !== undefined) body.ok = message.ok
  if (message.err !== undefined) body.err = message.err
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  if (json.length > CORE_MAX_FRAME) {
    throw new Error(`core: frame exceeds ${CORE_MAX_FRAME} bytes`)
  }
  const header = Buffer.alloc(4)
  header.writeUInt32BE(json.length)
  return Buffer.concat([header, json])
}

/**
 * Pull complete frames off a buffer. Incomplete trailing bytes stay in `rest`.
 * A declared length above {@link CORE_MAX_FRAME} throws (fail closed: the
 * stream is hostile or corrupt).
 */
export function decodeFrames(buffer: Buffer): { messages: CoreMessage[]; rest: Buffer<ArrayBufferLike> } {
  const messages: CoreMessage[] = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const size = buffer.readUInt32BE(offset)
    if (size > CORE_MAX_FRAME) {
      throw new Error(`core: frame length ${size} exceeds ${CORE_MAX_FRAME}`)
    }
    if (offset + 4 + size > buffer.length) break
    const json = buffer.subarray(offset + 4, offset + 4 + size).toString('utf8')
    const parsed: unknown = JSON.parse(json)
    messages.push(asCoreMessage(parsed))
    offset += 4 + size
  }
  return { messages, rest: buffer.subarray(offset) }
}

/** Structural parse: missing `id`/`proto` become 0 so a junk frame is still typed. */
export function asCoreMessage(value: unknown): CoreMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { proto: 0, id: 0, err: { code: CORE_ERROR_BAD_REQUEST, message: 'frame is not an object' } }
  }
  const rec = value as Record<string, unknown>
  const message: CoreMessage = {
    proto: typeof rec.proto === 'number' ? rec.proto : 0,
    id: typeof rec.id === 'number' ? rec.id : 0,
  }
  if (typeof rec.m === 'string') message.m = rec.m
  if ('p' in rec) message.p = rec.p
  if ('ok' in rec) message.ok = rec.ok
  if (typeof rec.err === 'object' && rec.err !== null && !Array.isArray(rec.err)) {
    const err = rec.err as Record<string, unknown>
    message.err = {
      code: typeof err.code === 'string' ? err.code : CORE_ERROR_IO,
      message: typeof err.message === 'string' ? err.message : 'core error',
    }
  }
  return message
}

/** Whether this capability set covers one method (hello is always allowed). */
export function methodAllowed(method: string, caps: readonly string[]): boolean {
  if (method === CORE_METHODS.hello) return true
  if (method.startsWith('fs.')) return caps.includes('fs')
  if (method.startsWith('spawn.')) return caps.includes('spawn')
  return false
}

/** Record shape guard used by callers that received `ok`. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
