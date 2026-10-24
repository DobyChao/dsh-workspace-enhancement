/**
 * BUG-20: canonicalizing a path must not open an SSH session.
 * OpenSSH's default MaxSessions is 10. A parent workspace that contains
 * nested workspaces resolves many children at once; one exec per path fills
 * that table and the sidebar terminal fails with
 * `(SSH) Channel open failure: open failed`.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { SshFileSystemEngine } from '../src/filesystem.ts'
import { remoteRouteFromCwd, type SshTransport } from '../src/transport.ts'

function directoryTarget(): FsTarget {
  return { targetKey: FsTargetKey('ssh://c1/home/uuz'), displayPath: 'ssh://c1/home/uuz' }
}

function attrs(directory: boolean): {
  size: number
  mtime: number
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
} {
  return {
    size: directory ? 0 : 4,
    mtime: 1_700_000_000,
    isFile: () => !directory,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  }
}

test('BUG-20: listing a parent workspace does not open an SSH session per child', async () => {
  const realpathCalls: string[] = []
  let execs = 0
  const names = ['eee', ...Array.from({ length: 11 }, (_, index) => `child-${index}`)]
  const sftp = {
    stat: (_path: string, callback: (error: Error | undefined, value: unknown) => void) => {
      callback(undefined, attrs(true))
    },
    readdir: (_path: string, callback: (error: Error | undefined, value: unknown) => void) => {
      callback(undefined, names.map(filename => ({ filename, attrs: attrs(filename === 'eee') })))
    },
    realpath: (path: string, callback: (error: Error | undefined, value?: string) => void) => {
      realpathCalls.push(path)
      callback(undefined, path === '/home/uuz/eee' ? '/data/eee' : path)
    },
  }
  const transport = {
    endpoint: 'u@h',
    cwd: '/home/uuz',
    getClient: async () => ({}) as never,
    getSftp: async () => sftp as never,
    getRemoteEnvironment: async () => ({}),
    exec: async () => {
      execs += 1
      throw new Error('BUG-20: canonicalize must not exec')
    },
    resolveRemoteCwd: (cwd?: string) => cwd ?? '/home/uuz',
  } as unknown as SshTransport
  const ctx = new Context()
  ctx.provide('ssh', transport)
  ctx.provide('sshRegistry', { get: (id: string) => (id === 'c1' ? transport : undefined) })
  const engine = new SshFileSystemEngine(ctx)

  const entries = await engine.listDir(directoryTarget())
  assert.equal(execs, 0)
  assert.deepEqual(realpathCalls, names.map(name => `/home/uuz/${name}`))
  const nested = entries.find(entry => entry.name === 'eee')
  assert.equal(String(nested?.target.targetKey), 'ssh://c1/data/eee')

  realpathCalls.length = 0
  sftp.realpath = (path: string, callback: (error: Error | undefined, value?: string) => void) => {
    realpathCalls.push(path)
    if (path === '/home/uuz/new.txt') callback(Object.assign(new Error('No such file'), { code: 2 }))
    else callback(undefined, path)
  }
  const created = await engine.resolve('new.txt', { cwd: 'ssh://c1/home/uuz' })
  assert.equal(execs, 0)
  assert.equal(String(created.targetKey), 'ssh://c1/home/uuz/new.txt')
  assert.deepEqual(realpathCalls, ['/home/uuz/new.txt', '/home/uuz'])
})

test('BUG-22: processPath returns a routable placeholder and fileUrl stays POSIX', () => {
  const transport = {
    endpoint: 'u@h',
    cwd: '/home/uuz',
    getClient: async () => ({}) as never,
    getSftp: async () => ({}) as never,
    getRemoteEnvironment: async () => ({}),
    exec: async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' }),
    resolveRemoteCwd: (cwd?: string) => cwd ?? '/home/uuz',
  } as unknown as SshTransport
  const ctx = new Context()
  ctx.provide('ssh', transport)
  ctx.provide('sshRegistry', { get: (id: string) => (id === 'c1' ? transport : undefined) })
  const engine = new SshFileSystemEngine(ctx)
  const target: FsTarget = { targetKey: FsTargetKey('ssh://c1/home/uuz/eee'), displayPath: '/home/uuz/eee' }
  const processed = engine.processPath(target)
  assert.equal(remoteRouteFromCwd(processed)?.connectionId, 'c1')
  assert.equal(remoteRouteFromCwd(processed)?.path, '/home/uuz/eee')
  assert.equal(engine.fileUrl(target), 'file:///home/uuz/eee')
})
