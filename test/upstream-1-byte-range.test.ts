/**
 * UPSTREAM-1：0.1.5 线给 `FileSystem` 加了第 14 个接缝方法 `readByteRange`，宿主
 * 同样经 `ctx.get('fs')` 取值 —— 所以 SSH 引擎与 `MixedFileSystem` 门面都必须
 * 实现它；漏了不是编译错误，而是运行时 `TypeError`（BUG-2 的重演）。
 *
 * 覆盖边界（诚实标注，三条跑在不同的条件下）：
 * 1. 路由 / 老宿主守卫 / 引擎调用形状：**任何家族**都跑（纯替身，不依赖上游版本）。
 * 2. 引擎窗口参数：假 SFTP 断言 `{start, end}` —— end 是**闭区间**（ssh2 语义）、
 *    只取窗口、绝不 `readFile` 整读。
 * 3. 真实后端语义（窗口内 / 越过 EOF 变短 / offset 越界为空 / length 0 为空）：
 *    需要 0.1.5 线的 `dsh-fs`，老家族**自动跳过**；CI 的 drift 哨兵用新家族跑它。
 * @module test/upstream-1-byte-range
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { FsError, FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SshFileSystemEngine } from '../src/filesystem.ts'
import { MixedFileSystem } from '../src/mixed.ts'
import type { FileSystemBranch } from '../src/mixed.ts'
import type { SshTransport } from '../src/transport.ts'

/** 远程目标（走 `ssh://` targetKey → remote 世界）。 */
function remoteTarget(path = '/srv/data.bin'): FsTarget {
  return { targetKey: FsTargetKey(`ssh://c1${path}`), displayPath: `ssh://c1${path}` }
}

/** 本地目标（真实路径 → local 世界）。 */
function localTarget(path = '/tmp/dsw-window.bin'): FsTarget {
  return { targetKey: FsTargetKey(path), displayPath: path }
}

/** 假 SFTP：只实现引擎窗口读会走到的调用，并记录 `createReadStream` 的参数。 */
function fakeSftp(options: { type?: 'file' | 'directory'; chunks?: Buffer[]; size?: number } = {}): {
  streams: { path: string; options: { start?: number; end?: number } | undefined }[]
  readFileCalls: number
  stat(path: string, callback: (error: Error | undefined, value: unknown) => void): void
  readFile(path: string, callback: (error: Error | undefined, value: Buffer) => void): void
  createReadStream(path: string, streamOptions?: { start?: number; end?: number }): AsyncIterable<Buffer>
} {
  const type = options.type ?? 'file'
  const chunks = options.chunks ?? [Buffer.from([0, 1, 2, 3, 4])]
  const streams: { path: string; options: { start?: number; end?: number } | undefined }[] = []
  const stats = {
    size: options.size ?? 64,
    mtime: 1_700_000_000,
    mode: 0o100644,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => false,
  }
  const sftp = {
    streams,
    readFileCalls: 0,
    stat: (_path: string, callback: (error: Error | undefined, value: unknown) => void) => callback(undefined, stats),
    readFile: (_path: string, callback: (error: Error | undefined, value: Buffer) => void) => {
      sftp.readFileCalls += 1
      callback(undefined, Buffer.alloc(0))
    },
    createReadStream: (path: string, streamOptions?: { start?: number; end?: number }) => {
      streams.push({ path, options: streamOptions })
      // ssh2 ends the stream when a read returns 0 bytes (past EOF): an empty
      // chunk list is exactly that case, with no error.
      return (async function* () { for (const chunk of chunks) yield chunk })()
    },
  }
  return sftp
}

/** 一个只挂 registry + ssh 的引擎（路由 c1 → 假 transport）。 */
function engineWith(sftp: ReturnType<typeof fakeSftp>): SshFileSystemEngine {
  const transport = {
    endpoint: 'u@h',
    cwd: '/root',
    getClient: async () => ({}) as never,
    getSftp: async () => sftp as never,
    getRemoteEnvironment: async () => ({}),
    exec: async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' }),
    resolveRemoteCwd: (cwd?: string) => cwd ?? '/root',
  } as unknown as SshTransport
  const ctx = new Context()
  ctx.provide('ssh', transport)
  ctx.provide('sshRegistry', { get: (id: string) => (id === 'c1' ? transport : undefined) })
  return new SshFileSystemEngine(ctx)
}

/** 远程分支替身：local 世界的断言里任何一次远程委派都是缺陷。 */
function explodingRemote(): SshFileSystemEngine {
  const boom = (): never => {
    throw new Error('UPSTREAM-1: the remote world must never be consulted for a host path')
  }
  return new Proxy({}, { get: () => boom }) as unknown as SshFileSystemEngine
}

/**
 * local 委托替身；`withRange: false` 模拟 0.1.2 家族的宿主后端（没有该方法）。
 */
function stubLocal(withRange: boolean): FileSystemBranch & { calls: string[] } {
  const calls: string[] = []
  const branch: FileSystemBranch & { calls: string[] } = {
    calls,
    sandboxMode: 'workspace-write',
    async resolve(path: string): Promise<FsTarget> {
      return { targetKey: FsTargetKey(path), displayPath: path }
    },
    processPath: (target: FsTarget): string => String(target.targetKey),
    processPathFromHostPath: (): undefined => undefined,
    fileUrl: (target: FsTarget): string => `file://${String(target.targetKey)}`,
    contains: (): boolean => true,
    async stat(): Promise<undefined> {
      return undefined
    },
    async lstat(): Promise<undefined> {
      return undefined
    },
    async readText(): Promise<string> {
      return ''
    },
    async streamText(): Promise<AsyncIterable<string>> {
      return (async function* () {})()
    },
    async readBytes(): Promise<Uint8Array> {
      return new Uint8Array()
    },
    async listDir(): Promise<never[]> {
      return []
    },
    async writeText(): Promise<never> {
      throw new Error('unexpected write on stub')
    },
    async editText(): Promise<never> {
      throw new Error('unexpected edit on stub')
    },
  }
  if (withRange) {
    branch.readByteRange = async (target, range) => {
      calls.push(`readByteRange:${target.displayPath}:${range.offset}:${range.length}`)
      return Uint8Array.from([9, 8, 7])
    }
  }
  return branch
}

/* ------------------------------------- 1) 引擎：窗口参数与语义 */

test('engine: readByteRange asks for exactly the window and never reads the whole file', async () => {
  const sftp = fakeSftp({ chunks: [Buffer.from([0, 1, 2, 3, 4])] })
  const engine = engineWith(sftp)
  const bytes = await engine.readByteRange(remoteTarget(), { offset: 5, length: 5 })
  assert.deepEqual([...bytes], [0, 1, 2, 3, 4])
  // end 是闭区间（ssh2: toRead = end - pos + 1）——写成开区间会多读一个字节。
  assert.deepEqual(sftp.streams, [{ path: '/srv/data.bin', options: { start: 5, end: 9 } }])
  assert.equal(sftp.readFileCalls, 0, 'the window must not come from a whole-file read')
})

test('engine: a window at or past EOF is empty, not an error', async () => {
  const sftp = fakeSftp({ chunks: [] })
  const engine = engineWith(sftp)
  const bytes = await engine.readByteRange(remoteTarget(), { offset: 4096, length: 16 })
  assert.equal(bytes.length, 0)
  assert.equal(sftp.readFileCalls, 0)
})

test('engine: length 0 is empty without opening a window', async () => {
  const sftp = fakeSftp()
  const engine = engineWith(sftp)
  const bytes = await engine.readByteRange(remoteTarget(), { offset: 12, length: 0 })
  assert.equal(bytes.length, 0)
  assert.deepEqual(sftp.streams, [])
})

test('engine: a non-regular target is refused before any window opens', async () => {
  const sftp = fakeSftp({ type: 'directory' })
  const engine = engineWith(sftp)
  await assert.rejects(
    () => engine.readByteRange(remoteTarget(), { offset: 0, length: 8 }),
    (error: unknown) => error instanceof FsError && error.code === 'FS_NOT_REGULAR_FILE',
  )
  assert.deepEqual(sftp.streams, [])
})

test('engine: an aborted read is FS_ABORTED, not an IO error', async () => {
  const controller = new AbortController()
  controller.abort()
  const engine = engineWith(fakeSftp())
  await assert.rejects(
    () => engine.readByteRange(remoteTarget(), { offset: 0, length: 4 }, controller.signal),
    (error: unknown) => error instanceof FsError && error.code === 'FS_ABORTED',
  )
})

/* ------------------------------------- 2) 门面：路由与老宿主守卫 */

test('facade: readByteRange routes remote to the engine and local to the delegate', async () => {
  const local = stubLocal(true)
  const mixed = new MixedFileSystem(local, explodingRemote())
  assert.deepEqual([...(await mixed.readByteRange(localTarget(), { offset: 2, length: 3 }))], [9, 8, 7])
  assert.deepEqual(local.calls, ['readByteRange:/tmp/dsw-window.bin:2:3'])
  // 宿主路径永远属于 local 世界：远程世界被碰一下就抛（explodingRemote）。
  await assert.rejects(() => mixed.readByteRange(remoteTarget(), { offset: 0, length: 4 }), /must never be consulted/)
})

test('facade: a pre-0.1.5 local delegate fails with a clear FsError, never a TypeError', async () => {
  // 这正是「修完之后 0.1.2-rc.1 还能不能用」的那条路径：老家族的宿主后端没有
  // 这个方法（上游 0.1.2 线也没有调用方），所以它必须是**显式失败**，
  // 而且不能退化成"整读再切片"（接缝明确禁止整文件缓冲）。
  const local = stubLocal(false)
  const mixed = new MixedFileSystem(local, explodingRemote())
  await assert.rejects(
    () => mixed.readByteRange(localTarget(), { offset: 0, length: 4 }),
    (error: unknown) => error instanceof FsError
      && error.code === 'FS_IO_ERROR'
      && /does not support windowed reads/.test(error.message),
  )
  assert.deepEqual(local.calls, [])
})

/* ------------------------------------- 3) 真实后端语义（只在 0.1.5 线家族上跑） */

const LOCAL_HAS_RANGE = typeof (LocalFileSystem.prototype as unknown as Record<string, unknown>).readByteRange === 'function'

test('real local backend: window semantics match the seam (inside / past EOF / past end / empty)', {
  skip: LOCAL_HAS_RANGE ? false : 'the installed dsh-fs predates readByteRange (0.1.5 line)',
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsw-range-'))
  try {
    const file = join(dir, 'data.bin')
    await writeFile(file, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
    const local = new LocalFileSystem(new Context(), { cwd: dir, diffBasisMaxBytes: 1024 * 1024 })
    const mixed = new MixedFileSystem(local as unknown as FileSystemBranch, explodingRemote())
    const target: FsTarget = { targetKey: FsTargetKey(file), displayPath: file }
    assert.deepEqual([...(await mixed.readByteRange(target, { offset: 3, length: 4 }))], [3, 4, 5, 6])
    assert.deepEqual([...(await mixed.readByteRange(target, { offset: 8, length: 8 }))], [8, 9], 'a window past EOF comes back short')
    assert.equal((await mixed.readByteRange(target, { offset: 99, length: 4 })).length, 0, 'a window past the end is empty')
    assert.equal((await mixed.readByteRange(target, { offset: 0, length: 0 })).length, 0, 'length 0 is empty')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
