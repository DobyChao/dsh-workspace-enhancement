/**
 * REQ-I5: in-process core server used by tests. Speaks the same framed JSON
 * as the Go binary, against a local directory tree that stands in for the
 * remote filesystem. Spawn is simulated (no real child) unless `liveSpawn`
 * is set — agent sandboxes cannot pipe-spawn.
 *
 * @module dsh-workspace-enhancement/core-fake
 */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync, lstatSync, existsSync, type Stats } from 'node:fs'
import { dirname, join, posix, resolve, sep } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import {
  CORE_ARTIFACT_VERSION,
  CORE_CAPS,
  CORE_ERROR_EXISTS,
  CORE_ERROR_IO,
  CORE_ERROR_NOT_DIR,
  CORE_ERROR_NOT_FOUND,
  CORE_ERROR_PERMISSION,
  CORE_ERROR_READ_ONLY,
  CORE_ERROR_UNIMPLEMENTED,
  CORE_EVENTS,
  CORE_METHODS,
  CORE_PROTO,
  asRecord,
  decodeFrames,
  encodeFrame,
  methodAllowed,
  type CoreMessage,
  type CoreStatOk,
} from './core-protocol.ts'
import { fileContentVersion } from './fs-version.ts'

export interface FakeCoreOptions {
  /** Host directory that maps onto POSIX `/`. */
  root: string
  sandbox: 'read-only' | 'workspace-write' | 'off'
  /** Absolute POSIX path bound writable in workspace-write (optional). */
  workspace?: string
  /** Capability set advertised by hello (default: all v1 caps). */
  caps?: readonly string[]
}

function hostPath(root: string, posixPath: string): string {
  const trimmed = posixPath.replace(/^\/+/, '')
  const parts = trimmed.split('/').filter(part => part !== '' && part !== '.')
  if (parts.some(part => part === '..')) {
    throw Object.assign(new Error('path escapes root'), { code: CORE_ERROR_PERMISSION })
  }
  return resolve(root, ...parts)
}

function posixOfHost(root: string, host: string, fallback: string): string {
  const base = resolve(root)
  const real = resolve(host)
  if (!real.startsWith(base)) return fallback.startsWith('/') ? fallback : `/${fallback}`
  const rel = real.slice(base.length).split(sep).join('/')
  return rel.startsWith('/') ? rel : `/${rel}`
}

/** Missing-leaf realpath: existing parent + basename (same as Go fsRealpath / dsh-fs-local). */
function realpathAllowMissingHost(root: string, posixPath: string): string {
  const tryExisting = (path: string): string | undefined => {
    const host = hostPath(root, path)
    if (!existsSync(host)) return undefined
    return posixOfHost(root, host, path)
  }
  const hit = tryExisting(posixPath)
  if (hit !== undefined) return hit
  const leaf = posix.basename(posixPath)
  const missing: string[] = leaf === '' || leaf === '/' ? [] : [leaf]
  let ancestor = posix.dirname(posixPath)
  while (true) {
    const realAnc = tryExisting(ancestor)
    if (realAnc !== undefined) return missing.length === 0 ? realAnc : posix.join(realAnc, ...missing)
    const parent = posix.dirname(ancestor)
    if (parent === ancestor) return posixPath.startsWith('/') ? posixPath : `/${posixPath}`
    const base = posix.basename(ancestor)
    if (base !== '') missing.unshift(base)
    ancestor = parent
  }
}


function writable(options: FakeCoreOptions, posixPath: string): boolean {
  if (options.sandbox === 'off' || options.sandbox === undefined) return true
  if (options.sandbox === 'read-only') return false
  const ws = options.workspace
  if (ws === undefined || ws === '') return false
  const rel = posix.relative(ws, posixPath)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !posix.isAbsolute(rel))
}

function statOk(posixPath: string, stats: Stats, extra?: { symlink?: boolean }): CoreStatOk {
  const size = Number(stats.size)
  const mtimeMs = Number(stats.mtimeMs)
  const mode = Number(stats.mode)
  const type: CoreStatOk['type'] = extra?.symlink === true
    ? 'symlink'
    : stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other'
  const ok: CoreStatOk = {
    type,
    mode,
    mtimeMs,
    version: fileContentVersion(posixPath, size, mtimeMs),
  }
  if (stats.isFile()) ok.size = size
  return ok
}

/**
 * Serve the core protocol on a duplex until stdin ends.
 */
export function serveFakeCore(stdin: Readable, stdout: Writable, options: FakeCoreOptions): void {
  const caps = options.caps ?? CORE_CAPS
  let rest: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let nextJob = 1

  const reply = (message: Omit<CoreMessage, 'proto'> & { proto?: number }): void => {
    stdout.write(encodeFrame(message))
  }

  const fail = (id: number, code: string, message: string): void => {
    reply({ id, err: { code, message } })
  }

  const dispatch = (message: CoreMessage): void => {
    const id = message.id
    const method = message.m ?? ''
    if (method === '') {
      fail(id, CORE_ERROR_UNIMPLEMENTED, 'missing method')
      return
    }
    if (!methodAllowed(method, caps)) {
      fail(id, CORE_ERROR_UNIMPLEMENTED, `capability missing for ${method}`)
      return
    }
    try {
      const ok = handle(method, message.p)
      reply({ id, ok: ok ?? null })
    } catch (error) {
      const code = typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code)
        : CORE_ERROR_IO
      fail(id, code, error instanceof Error ? error.message : String(error))
    }
  }

  const handle = (method: string, raw: unknown): unknown => {
    const p = asRecord(raw) ?? {}
    switch (method) {
      case CORE_METHODS.hello:
        return {
          proto: CORE_PROTO,
          version: CORE_ARTIFACT_VERSION,
          arch: 'x86_64',
          caps: [...caps],
          sandbox: options.sandbox,
        }
      case CORE_METHODS.fsRealpath: {
        const path = String(p.path ?? '')
        return { path: realpathAllowMissingHost(options.root, path) }
      }
      case CORE_METHODS.fsStat:
      case CORE_METHODS.fsLstat: {
        const path = String(p.path ?? '')
        const host = hostPath(options.root, path)
        try {
          const stats = method === CORE_METHODS.fsLstat ? lstatSync(host) : statSync(host)
          return statOk(path, stats, { symlink: method === CORE_METHODS.fsLstat && stats.isSymbolicLink() })
        } catch (error) {
          const code = (error as { code?: string }).code
          if (code === 'ENOENT') return undefined
          throw error
        }
      }
      case CORE_METHODS.fsRead: {
        const path = String(p.path ?? '')
        const host = hostPath(options.root, path)
        const bytes = readFileSync(host)
        return { b64: bytes.toString('base64') }
      }
      case CORE_METHODS.fsReadRange: {
        const path = String(p.path ?? '')
        const offset = Number(p.offset ?? 0)
        const length = Number(p.length ?? 0)
        if (length === 0) return { b64: '' }
        const host = hostPath(options.root, path)
        const bytes = readFileSync(host)
        const slice = bytes.subarray(offset, offset + length)
        return { b64: Buffer.from(slice).toString('base64') }
      }
      case CORE_METHODS.fsListDir: {
        const path = String(p.path ?? '')
        const host = hostPath(options.root, path)
        const stats = statSync(host)
        if (!stats.isDirectory()) {
          throw Object.assign(new Error('not a directory'), { code: CORE_ERROR_NOT_DIR })
        }
        const names = readdirSync(host)
        const entries = names.map((name) => {
          const childPosix = posix.join(path === '/' ? '' : path, name)
          const childHost = join(host, name)
          const childStats = lstatSync(childHost)
          return { name, ...statOk(childPosix.startsWith('/') ? childPosix : `/${childPosix}`, childStats, { symlink: childStats.isSymbolicLink() }) }
        })
        return { entries }
      }
      case CORE_METHODS.fsWrite: {
        const path = String(p.path ?? '')
        if (!writable(options, path)) {
          throw Object.assign(new Error('read-only file system'), { code: CORE_ERROR_READ_ONLY })
        }
        const host = hostPath(options.root, path)
        mkdirSync(dirname(host), { recursive: true })
        const bytes = Buffer.from(String(p.b64 ?? ''), 'base64')
        const createIfAbsent = p.createIfAbsent === true
        if (createIfAbsent && existsSync(host)) {
          throw Object.assign(new Error('exists'), { code: CORE_ERROR_EXISTS })
        }
        writeFileSync(host, bytes)
        const stats = statSync(host)
        return statOk(path, stats)
      }
      case CORE_METHODS.fsMkdir: {
        const path = String(p.path ?? '')
        if (!writable(options, path)) {
          throw Object.assign(new Error('read-only file system'), { code: CORE_ERROR_READ_ONLY })
        }
        const host = hostPath(options.root, path)
        if (existsSync(host)) {
          throw Object.assign(new Error('exists'), { code: CORE_ERROR_EXISTS })
        }
        mkdirSync(host)
        return { path }
      }
      case CORE_METHODS.spawnStart: {
        const job = String(nextJob)
        nextJob += 1
        const argv = Array.isArray(p.argv) ? p.argv.map(String) : []
        queueMicrotask(() => {
          const text = argv.join(' ')
          if (text.length > 0) {
            stdout.write(encodeFrame({
              id: 0,
              m: CORE_EVENTS.spawnStdout,
              p: { job, b64: Buffer.from(text, 'utf8').toString('base64') },
            }))
          }
          stdout.write(encodeFrame({
            id: 0,
            m: CORE_EVENTS.spawnExit,
            p: { job, exitCode: 0, signal: null },
          }))
        })
        return { job }
      }
      case CORE_METHODS.spawnStdin:
      case CORE_METHODS.spawnTerminate:
        return {}
      default:
        throw Object.assign(new Error(`unimplemented ${method}`), { code: CORE_ERROR_UNIMPLEMENTED })
    }
  }

  stdin.on('data', (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const decoded = decodeFrames(Buffer.concat([rest, buf]))
    rest = decoded.rest
    for (const message of decoded.messages) dispatch(message)
  })
}

/** Wipe a fake-core root (tests). */
export function resetFakeRoot(root: string): void {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
}
