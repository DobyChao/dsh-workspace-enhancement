/**
 * REQ-I5: fenced remote fs routes to core RPC; `off` stays SFTP; a down core
 * fails closed (no SFTP fallback).
 * @module test/core-routing
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { FsError, FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { CoreClient } from '../src/core-client.ts'
import { serveFakeCore } from '../src/core-fake.ts'
import { CoreRoutingFileSystem } from '../src/core-fs.ts'
import { createCoreHub } from '../src/core-hub.ts'
import type { CoreHub } from '../src/core-hub.ts'
import { SshFileSystemEngine } from '../src/filesystem.ts'
import { REMOTE_SANDBOX_UNAVAILABLE, RemoteSandboxError } from '../src/remote-sandbox.ts'
import { createRemoteSandboxFence } from '../src/remote-sandbox-fence.ts'
import type { RemoteSandboxDeps, RemoteSandboxMachineFace } from '../src/remote-sandbox-fence.ts'
import type { SshTransport } from '../src/transport.ts'

function pair(root: string, sandbox: 'read-only' | 'workspace-write' = 'read-only', workspace?: string): CoreClient {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  serveFakeCore(toServer, toClient, { root, sandbox, ...(workspace !== undefined ? { workspace } : {}) })
  return new CoreClient(toServer, toClient)
}

function transport(): SshTransport {
  return {
    endpoint: 'u@h',
    cwd: '/work',
    getClient: async () => ({}) as never,
    getSftp: async () => { throw new Error('SFTP must not run on a fenced machine') },
    getRemoteEnvironment: async () => ({}),
    exec: async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' }),
    resolveRemoteCwd: (cwd?: string) => cwd ?? '/work',
  } as unknown as SshTransport
}

function deps(mode: RemoteSandboxMachineFace['remoteSandbox'], connection = transport()): RemoteSandboxDeps {
  const machine: RemoteSandboxMachineFace = { id: 'c1', remoteSandbox: mode, workspace: '/work', cwd: '/work' }
  return {
    machine: (id) => (id === 'c1' ? machine : undefined),
    connection: (id) => (id === 'c1' ? connection : undefined),
    unavailable: (confinement, detail) => new RemoteSandboxError(`${confinement}: ${detail}`, REMOTE_SANDBOX_UNAVAILABLE),
  }
}

function ctxWith(t: SshTransport): Context {
  const ctx = new Context()
  ctx.provide('ssh', t)
  ctx.provide('sshRegistry', { get: (id: string) => (id === 'c1' ? t : undefined) })
  return ctx
}

function target(path = '/work/a.txt'): FsTarget {
  return { targetKey: FsTargetKey(`ssh://c1${path}`), displayPath: `ssh://c1${path}` }
}

test('CoreRoutingFileSystem: off delegates writes to SFTP and never opens a core', async () => {
  const t = transport()
  let sftpWrites = 0
  const sftp = {
    processPathFromHostPath: () => undefined,
    processPath: (item: FsTarget) => String(item.targetKey),
    fileUrl: () => 'file:///',
    contains: () => true,
    resolve: async () => target(),
    stat: async () => undefined,
    lstat: async () => undefined,
    readText: async () => '',
    streamText: async () => (async function* () { yield '' })(),
    readBytes: async () => new Uint8Array(),
    listDir: async () => [],
    writeText: async () => {
      sftpWrites += 1
      return { operation: 'create', version: 'sftp', before: null, after: 'x' }
    },
    editText: async () => ({ version: 'sftp', before: '', after: '' }),
  }
  const hub = createCoreHub(ctxWith(t), {
    deps: deps('off'),
    open: async () => {
      throw new Error('core must not open for off')
    },
  })
  const fs = new CoreRoutingFileSystem(ctxWith(t), sftp as unknown as SshFileSystemEngine, hub)
  await fs.writeText(target(), 'hello')
  assert.equal(sftpWrites, 1)
})

test('CoreRoutingFileSystem: fenced write uses core RPC (I9-1 dual: outside workspace refused)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-route-'))
  mkdirSync(join(root, 'work'), { recursive: true })
  writeFileSync(join(root, 'etc-hostname'), 'box\n')
  const client = pair(root, 'read-only')
  const t = transport()
  const ctx = ctxWith(t)
  const hub = createCoreHub(ctx, {
    deps: deps('read-only', t),
    open: async () => client,
  })
  const exploding = new Proxy({}, { get: () => () => { throw new Error('SFTP consulted on fenced path') } }) as unknown as SshFileSystemEngine
  const fs = new CoreRoutingFileSystem(ctx, exploding, hub)
  await assert.rejects(
    () => fs.writeText(target('/etc-hostname'), 'nope'),
    (error: unknown) => error instanceof FsError,
  )
  client.close()
})

test('CoreRoutingFileSystem: fenced + dead core refuses fs (no SFTP fallback)', async () => {
  const t = transport()
  const ctx = ctxWith(t)
  const hub = createCoreHub(ctx, {
    deps: deps('workspace-write', t),
    open: async () => {
      throw new Error('core binary missing')
    },
  })
  const exploding = new Proxy({}, { get: () => () => { throw new Error('SFTP fallback is forbidden') } }) as unknown as SshFileSystemEngine
  const fs = new CoreRoutingFileSystem(ctx, exploding, hub)
  await assert.rejects(
    () => fs.stat(target('/work/a.txt')),
    (error: unknown) => error instanceof FsError && error.code === 'FS_SANDBOX_DENIED',
  )
})

test('createCoreHub.require: missing cap is SANDBOX_UNAVAILABLE, not SFTP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-cap-'))
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  serveFakeCore(toServer, toClient, { root, sandbox: 'read-only', caps: ['fs'] })
  const client = new CoreClient(toServer, toClient)
  const t = transport()
  const hub: CoreHub = createCoreHub(ctxWith(t), {
    deps: deps('read-only', t),
    open: async () => client,
  })
  await assert.rejects(
    () => hub.require('c1'),
    (error: unknown) => error instanceof RemoteSandboxError && error.code === REMOTE_SANDBOX_UNAVAILABLE,
  )
  client.close()
})

test('fence with a hub returns the original argv (approval still sees unwrapped)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-fence-'))
  const client = pair(root, 'read-only')
  const t = transport()
  const ctx = ctxWith(t)
  const hub = createCoreHub(ctx, { deps: deps('read-only', t), open: async () => client })
  const fence = createRemoteSandboxFence(ctx, { hub, deps: deps('read-only', t) })
  const argv = await fence({ connectionId: 'c1', cwd: '/work', argv: ['bash', '-c', 'echo hi'] })
  assert.deepEqual([...argv], ['bash', '-c', 'echo hi'])
  client.close()
})
