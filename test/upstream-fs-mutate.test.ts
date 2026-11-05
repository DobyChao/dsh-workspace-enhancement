/**
 * UPSTREAM-14: `patchText` / `deleteFile` / `moveFile` on the SSH engine and
 * the mixed facade. Confined routing is covered beside the existing write
 * tests (`remote-sandbox-wiring`, `core-routing`).
 * @module test/upstream-fs-mutate
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { CoreClient } from '../src/core-client.ts'
import { serveFakeCore } from '../src/core-fake.ts'
import { CoreFileSystem } from '../src/core-fs.ts'
import { SshFileSystemEngine } from '../src/filesystem.ts'
import type { PatchHunk } from '../src/fs-patch.ts'
import { MixedFileSystem } from '../src/mixed.ts'
import type { FileSystemBranch } from '../src/mixed.ts'
import type { SshTransport } from '../src/transport.ts'
import { PassThrough } from 'node:stream'

interface Rec {
  bytes: Buffer
  mode: number
  directory: boolean
  mtime: number
}

function remoteTarget(path: string): FsTarget {
  return { targetKey: FsTargetKey(`ssh://c1${path}`), displayPath: path }
}

function memoryEngine(initial: Record<string, { text: string; mode?: number; directory?: boolean }>, opts?: { unlinkError?: Error }): {
  engine: SshFileSystemEngine
  text: (path: string) => string | undefined
  calls: string[]
  modeOf: (path: string) => number | undefined
} {
  const files = new Map<string, Rec>()
  for (const [path, file] of Object.entries(initial)) {
    files.set(path, {
      bytes: Buffer.from(file.text),
      mode: file.mode ?? 0o100644,
      directory: file.directory === true,
      mtime: 1_700_000_000,
    })
  }
  const calls: string[] = []
  const statsOf = (rec: Rec) => ({
    size: rec.bytes.length,
    mtime: rec.mtime,
    mode: rec.mode,
    isFile: () => !rec.directory,
    isDirectory: () => rec.directory,
    isSymbolicLink: () => false,
  })
  const sftp = {
    stat: (path: string, callback: (error: Error | undefined, value?: unknown) => void) => {
      calls.push(`stat:${path}`)
      const rec = files.get(path)
      if (rec === undefined) callback(Object.assign(new Error('No such file'), { code: 'NO_SUCH_FILE' }))
      else callback(undefined, statsOf(rec))
    },
    readFile: (path: string, callback: (error: Error | undefined, value: Buffer) => void) => {
      calls.push(`read:${path}`)
      const rec = files.get(path)
      if (rec === undefined) callback(Object.assign(new Error('No such file'), { code: 'NO_SUCH_FILE' }), Buffer.alloc(0))
      else callback(undefined, rec.bytes)
    },
    mkdir: (path: string, callback: (error?: Error) => void) => {
      calls.push(`mkdir:${path}`)
      files.set(path, { bytes: Buffer.alloc(0), mode: 0o040755, directory: true, mtime: 1 })
      callback()
    },
    writeFile: (path: string, data: Buffer | string, callback: (error?: Error) => void) => {
      calls.push(`write:${path}`)
      files.set(path, { bytes: Buffer.from(data), mode: 0o100600, directory: false, mtime: 2 })
      callback()
    },
    unlink: (path: string, callback: (error?: Error) => void) => {
      calls.push(`unlink:${path}`)
      if (opts?.unlinkError !== undefined) {
        callback(opts.unlinkError)
        return
      }
      if (!files.has(path)) callback(Object.assign(new Error('No such file'), { code: 'NO_SUCH_FILE' }))
      else {
        files.delete(path)
        callback()
      }
    },
    ext_openssh_rename: (from: string, to: string, callback: (error?: Error) => void) => {
      calls.push(`rename:${from}->${to}`)
      const rec = files.get(from)
      if (rec === undefined) {
        callback(new Error('missing temp'))
        return
      }
      const prev = files.get(to)
      files.set(to, { ...rec, directory: false, mtime: (prev?.mtime ?? 1) + 1 })
      files.delete(from)
      callback()
    },
  }
  const transport = {
    endpoint: 'u@h',
    cwd: '/srv',
    getClient: async () => ({}) as never,
    getSftp: async () => sftp as never,
    getRemoteEnvironment: async () => ({}),
    exec: async (command: string) => {
      calls.push(`exec:${command}`)
      const match = /^chmod\s+([0-7]+)\s+--\s+'([^']*)'/.exec(command)
      if (match !== null) {
        const mode = Number.parseInt(match[1] ?? '', 8)
        const path = match[2] ?? ''
        const rec = files.get(path)
        if (rec !== undefined) rec.mode = 0o100000 | mode
      }
      return { exitCode: 0, signal: null, stdout: '', stderr: '' }
    },
    resolveRemoteCwd: (cwd?: string) => cwd ?? '/srv',
  } as unknown as SshTransport
  const ctx = new Context()
  ctx.provide('ssh', transport)
  ctx.provide('sshRegistry', { get: (id: string) => (id === 'c1' ? transport : undefined) })
  return {
    engine: new SshFileSystemEngine(ctx),
    calls,
    text: (path: string) => files.get(path)?.bytes.toString('utf8'),
    modeOf: (path: string) => files.get(path)?.mode,
  }
}

const REPLACE_BETA: PatchHunk = { lineNumber: 1, oldLines: ['beta'], newLines: ['gamma'], isEndOfFile: false }

test('engine: patchText rewrites the matched line and refuses a miss without writing', async () => {
  const mem = memoryEngine({ '/srv/a.txt': { text: 'alpha\nbeta\n' } })
  const patched = await mem.engine.patchText(remoteTarget('/srv/a.txt'), [REPLACE_BETA])
  assert.equal(patched.before, 'alpha\nbeta\n')
  assert.equal(patched.after, 'alpha\ngamma\n')
  assert.equal(mem.text('/srv/a.txt'), 'alpha\ngamma\n')

  const missed = memoryEngine({ '/srv/a.txt': { text: 'alpha\nbeta\n' } })
  const miss: PatchHunk = { lineNumber: 3, oldLines: ['nope'], newLines: ['x'], isEndOfFile: false }
  await assert.rejects(
    () => missed.engine.patchText(remoteTarget('/srv/a.txt'), [miss]),
    (error: unknown) => error instanceof FsError && error.code === 'FS_PATCH_MISMATCH',
  )
  assert.equal(missed.calls.some(call => call.startsWith('write:')), false)
  assert.equal(missed.text('/srv/a.txt'), 'alpha\nbeta\n')
})

test('engine: patchText and deleteFile reject a directory, a stale version, and a missing file', async () => {
  const mem = memoryEngine({
    '/srv/dir': { text: '', directory: true },
    '/srv/a.txt': { text: 'alpha\n' },
  })
  await assert.rejects(
    () => mem.engine.deleteFile(remoteTarget('/srv/dir')),
    (error: unknown) => error instanceof FsError && error.code === 'FS_NOT_REGULAR_FILE',
  )
  await assert.rejects(
    () => mem.engine.patchText(remoteTarget('/srv/missing.txt'), [REPLACE_BETA]),
    (error: unknown) => error instanceof FsError && error.code === 'FS_STALE_VERSION',
  )
  await assert.rejects(
    () => mem.engine.deleteFile(remoteTarget('/srv/a.txt'), { version: FsVersion('stale') }),
    (error: unknown) => error instanceof FsError && error.code === 'FS_STALE_VERSION',
  )
  assert.equal(mem.text('/srv/a.txt'), 'alpha\n')
  assert.equal(mem.calls.some(call => call.startsWith('unlink:')), false)
})

test('engine: deleteFile unlinks only that file and returns the LF basis', async () => {
  const mem = memoryEngine({
    '/srv/a.txt': { text: 'alpha\r\nbeta\r\n' },
    '/srv/keep.txt': { text: 'stay\n' },
  })
  const removed = await mem.engine.deleteFile(remoteTarget('/srv/a.txt'))
  assert.equal(removed.before, 'alpha\nbeta\n')
  assert.equal(mem.text('/srv/a.txt'), undefined)
  assert.equal(mem.text('/srv/keep.txt'), 'stay\n')
  assert.equal(mem.calls.filter(call => call.startsWith('unlink:')).join(','), 'unlink:/srv/a.txt')
})

test('engine: deleteFile maps a permission failure and does not remove the file', async () => {
  const mem = memoryEngine(
    { '/srv/a.txt': { text: 'alpha\n' } },
    { unlinkError: Object.assign(new Error('permission denied'), { code: 'PERMISSION_DENIED' }) },
  )
  await assert.rejects(
    () => mem.engine.deleteFile(remoteTarget('/srv/a.txt')),
    (error: unknown) => error instanceof FsError && error.code === 'FS_PERMISSION_DENIED',
  )
  assert.equal(mem.text('/srv/a.txt'), 'alpha\n')
})

test('engine: moveFile publishes the source, carries its mode, then removes it', async () => {
  const mem = memoryEngine({
    '/srv/a.txt': { text: 'alpha\nbeta\n', mode: 0o100640 },
  })
  const moved = await mem.engine.moveFile(remoteTarget('/srv/a.txt'), remoteTarget('/srv/b.txt'), {
    hunks: [REPLACE_BETA],
  })
  assert.equal(moved.sourceDeleted, true)
  if (moved.sourceDeleted) {
    assert.equal(moved.sourceBefore, 'alpha\nbeta\n')
    assert.equal(moved.destination.operation, 'create')
    assert.equal(moved.destination.after, 'alpha\ngamma\n')
  }
  assert.equal(mem.text('/srv/a.txt'), undefined)
  assert.equal(mem.text('/srv/b.txt'), 'alpha\ngamma\n')
  assert.equal(mem.modeOf('/srv/b.txt'), 0o100640)
  assert.equal(mem.calls.some(call => call.includes('chmod 640 ')), true)
})

test('engine: moveFile to the same target is FS_SAME_TARGET and a failed source removal keeps the destination', async () => {
  const same = memoryEngine({ '/srv/a.txt': { text: 'alpha\n' } })
  await assert.rejects(
    () => same.engine.moveFile(remoteTarget('/srv/a.txt'), remoteTarget('/srv/a.txt'), {}),
    (error: unknown) => error instanceof FsError && error.code === 'FS_SAME_TARGET',
  )
  assert.equal(same.calls.length, 0)

  const mem = memoryEngine(
    { '/srv/a.txt': { text: 'alpha\n' } },
    { unlinkError: Object.assign(new Error('permission denied'), { code: 'PERMISSION_DENIED' }) },
  )
  const moved = await mem.engine.moveFile(remoteTarget('/srv/a.txt'), remoteTarget('/srv/b.txt'), {})
  assert.equal(moved.sourceDeleted, false)
  if (!moved.sourceDeleted) assert.equal(moved.sourceFailure.code, 'FS_PERMISSION_DENIED')
  assert.equal(mem.text('/srv/a.txt'), 'alpha\n')
  assert.equal(mem.text('/srv/b.txt'), 'alpha\n')
})

test('engine: moveFile createIfAbsent refuses an existing destination', async () => {
  const mem = memoryEngine({
    '/srv/a.txt': { text: 'from-source\n' },
    '/srv/b.txt': { text: 'already\n' },
  })
  await assert.rejects(
    () => mem.engine.moveFile(remoteTarget('/srv/a.txt'), remoteTarget('/srv/b.txt'), {
      expectedDestination: { kind: 'createIfAbsent' },
    }),
    (error: unknown) => error instanceof FsError && error.code === 'FS_NOT_OBSERVED',
  )
  assert.equal(mem.text('/srv/b.txt'), 'already\n')
  assert.equal(mem.calls.some(call => call.startsWith('unlink:')), false)
})

function recordingBranch(label: string, calls: string[], implemented: boolean): FileSystemBranch {
  const boom = async (): Promise<never> => {
    throw new Error(`unexpected ${label}`)
  }
  const branch: FileSystemBranch = {
    resolve: boom,
    processPath: () => '',
    processPathFromHostPath: () => undefined,
    fileUrl: () => 'file:///',
    contains: () => false,
    stat: async () => undefined,
    lstat: async () => undefined,
    readText: boom,
    streamText: boom,
    readBytes: boom,
    listDir: boom,
    writeText: boom,
    editText: boom,
  }
  if (implemented) {
    branch.patchText = async (target) => {
      calls.push(`patch:${label}:${target.displayPath}`)
      return { version: FsVersion('v'), before: 'a', after: 'b' }
    }
    branch.deleteFile = async (target) => {
      calls.push(`delete:${label}:${target.displayPath}`)
      return { before: 'a' }
    }
    branch.moveFile = async (source, destination) => {
      calls.push(`move:${label}:${source.displayPath}->${destination.displayPath}`)
      return {
        sourceBefore: 'a',
        destination: { operation: 'create', version: FsVersion('v'), before: null, after: 'a' },
        sourceDeleted: true,
      }
    }
  }
  return branch
}

test('facade: patch/delete/move follow the target world and refuse a cross-world move', async () => {
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(
    recordingBranch('local', localCalls, true),
    recordingBranch('remote', remoteCalls, true),
  )
  const local = { targetKey: FsTargetKey('/tmp/a.txt'), displayPath: '/tmp/a.txt' }
  const remote = remoteTarget('/srv/a.txt')
  const remoteDest = remoteTarget('/srv/b.txt')
  await mixed.patchText(remote, [REPLACE_BETA])
  await mixed.deleteFile(local)
  await mixed.moveFile(remote, remoteDest, {})
  assert.deepEqual(remoteCalls, ['patch:remote:/srv/a.txt', 'move:remote:/srv/a.txt->/srv/b.txt'])
  assert.deepEqual(localCalls, ['delete:local:/tmp/a.txt'])
  await assert.rejects(
    () => mixed.moveFile(local, remote, {}),
    (error: unknown) => error instanceof FsError && error.code === 'FS_IO_ERROR' && /different filesystem worlds/.test(error.message),
  )
})

test('facade: a pre-0.2.2 local delegate fails honestly', async () => {
  const mixed = new MixedFileSystem(
    recordingBranch('local', [], false),
    recordingBranch('remote', [], true),
  )
  const local = { targetKey: FsTargetKey('/tmp/a.txt'), displayPath: '/tmp/a.txt' }
  await assert.rejects(
    () => mixed.patchText(local, [REPLACE_BETA]),
    (error: unknown) => error instanceof FsError && error.code === 'FS_IO_ERROR' && /before the 0.2.2 line/.test(error.message),
  )
})

test('core: deleteFile and moveFile stay inside the jail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-fs-mutate-'))
  try {
    const work = join(root, 'work')
    mkdirSync(work)
    writeFileSync(join(work, 'a.txt'), 'alpha\nbeta\n')
    const sourceMode = statSync(join(work, 'a.txt')).mode & 0o777
    const toServer = new PassThrough()
    const toClient = new PassThrough()
    serveFakeCore(toServer, toClient, { root, sandbox: 'workspace-write', workspace: '/work' })
    const transport = {
      endpoint: 'u@h',
      cwd: '/work',
      getSftp: async () => { throw new Error('SFTP must not run') },
      exec: async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' }),
      resolveRemoteCwd: (cwd?: string) => cwd ?? '/work',
    }
    const ctx = new Context()
    ctx.provide('ssh', transport)
    ctx.provide('sshRegistry', { get: (id: string) => (id === 'c1' ? transport : undefined) })
    const fs = new CoreFileSystem(ctx, new CoreClient(toServer, toClient), 'workspace-write')
    const source = { targetKey: FsTargetKey('ssh://c1/work/a.txt'), displayPath: '/work/a.txt' }
    const dest = { targetKey: FsTargetKey('ssh://c1/work/b.txt'), displayPath: '/work/b.txt' }
    const moved = await fs.moveFile(source, dest, { hunks: [REPLACE_BETA] })
    assert.equal(moved.sourceDeleted, true)
    assert.equal(readFileSync(join(work, 'b.txt'), 'utf8'), 'alpha\ngamma\n')
    assert.equal(statSync(join(work, 'b.txt')).mode & 0o777, sourceMode)
    assert.throws(() => statSync(join(work, 'a.txt')))
    writeFileSync(join(work, 'c.txt'), 'gone\n')
    const removed = await fs.deleteFile({ targetKey: FsTargetKey('ssh://c1/work/c.txt'), displayPath: '/work/c.txt' })
    assert.equal(removed.before, 'gone\n')
    assert.throws(() => statSync(join(work, 'c.txt')))
    mkdirSync(join(root, 'etc'))
    writeFileSync(join(root, 'etc', 'passwd'), 'secret\n')
    await assert.rejects(
      () => fs.deleteFile({ targetKey: FsTargetKey('ssh://c1/etc/passwd'), displayPath: '/etc/passwd' }),
      (error: unknown) => error instanceof FsError && error.code === 'FS_SANDBOX_DENIED',
    )
    assert.equal(readFileSync(join(root, 'etc', 'passwd'), 'utf8'), 'secret\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
