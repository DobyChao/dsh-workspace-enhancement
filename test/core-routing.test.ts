/**
 * REQ-I5: fenced remote fs routes to core RPC; `off` stays SFTP; a down core
 * fails closed on writes (REQ-I15: reads may fall back to SFTP).
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
import { coreServeCommand } from '../src/core-hub.ts'
import { SshFileSystemEngine } from '../src/filesystem.ts'
import { MixedFileSystem } from '../src/mixed.ts'
import { REMOTE_SANDBOX_MESSAGES, REMOTE_SANDBOX_UNAVAILABLE, RemoteSandboxError } from '../src/remote-sandbox.ts'
import { createRemoteSandboxFence } from '../src/remote-sandbox-fence.ts'
import type { RemoteSandboxDeps, RemoteSandboxMachineFace } from '../src/remote-sandbox-fence.ts'
import { isSandboxUnavailableError, sftpFallbackForCoreGap, CoreMissingError } from '../src/remote-policy.ts'
import { sshRoutesRoot, type SshTransport } from '../src/transport.ts'

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

function trackingSftp(): {
  sftp: Record<string, unknown>
  reads: string[]
  writes: string[]
} {
  const reads: string[] = []
  const writes: string[] = []
  const sftp = {
    processPathFromHostPath: () => undefined,
    processPath: (item: FsTarget) => String(item.targetKey),
    fileUrl: () => 'file:///',
    contains: () => true,
    resolve: async () => {
      reads.push('resolve')
      return target()
    },
    stat: async () => {
      reads.push('stat')
      return { type: 'file' as const, size: 1, version: 'sftp' }
    },
    lstat: async () => undefined,
    readText: async () => {
      reads.push('readText')
      return 'from-sftp'
    },
    streamText: async () => (async function* () { yield '' })(),
    readBytes: async () => new Uint8Array(),
    listDir: async () => [],
    writeText: async () => {
      writes.push('writeText')
      return { operation: 'create', version: 'sftp', before: null, after: 'x' }
    },
    editText: async () => {
      writes.push('editText')
      return { version: 'sftp', before: '', after: '' }
    },
  }
  return { sftp, reads, writes }
}

test('sftpFallbackForCoreGap: confined reads on SANDBOX_UNAVAILABLE; writes never', () => {
  const unavailable = new RemoteSandboxError('no core', REMOTE_SANDBOX_UNAVAILABLE)
  assert.equal(sftpFallbackForCoreGap('workspace-write', 'read', unavailable), true)
  assert.equal(sftpFallbackForCoreGap('read-only', 'write', unavailable), false)
  assert.equal(sftpFallbackForCoreGap('danger-full-access', 'write', unavailable), false)
  assert.equal(sftpFallbackForCoreGap('danger-full-access', 'write', new CoreMissingError('gone')), true)
  assert.equal(sftpFallbackForCoreGap('workspace-write', 'read', new CoreMissingError('gone')), false)
  assert.equal(isSandboxUnavailableError(unavailable), true)
})

test('CoreRoutingFileSystem: danger-full-access with no core delegates writes to SFTP', async () => {
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
  await fs.writeText(target(), 'hello', undefined, undefined, { mode: 'danger-full-access' })
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
    () => fs.writeText(target('/etc-hostname'), 'nope', undefined, undefined, { mode: 'read-only' }),
    (error: unknown) => error instanceof FsError
      && error.code === 'FS_SANDBOX_DENIED'
      && error.message.includes('[sandbox: file access denied under read-only mode]'),
  )
  client.close()
})

test('REQ-I15: fenced + dead core reads via SFTP; writes stay fail-closed', async () => {
  const t = transport()
  const ctx = ctxWith(t)
  let opens = 0
  const hub = createCoreHub(ctx, {
    deps: deps('workspace-write', t),
    open: async () => {
      opens += 1
      throw new Error('core binary missing')
    },
  })
  const tracked = trackingSftp()
  const fs = new CoreRoutingFileSystem(ctx, tracked.sftp as unknown as SshFileSystemEngine, hub)
  const info = await fs.stat(target('/work/a.txt'))
  assert.equal(info?.type, 'file')
  const afterStat = opens
  assert.equal(await fs.readText(target('/work/a.txt')), 'from-sftp')
  assert.equal(opens, afterStat, 'second read uses the blocked-core cache')
  assert.deepEqual(tracked.reads, ['stat', 'readText'])
  await assert.rejects(
    () => fs.writeText(target('/work/a.txt'), 'nope', undefined, undefined, { mode: 'workspace-write' }),
    (error: unknown) => error instanceof FsError && error.code === 'FS_SANDBOX_DENIED',
  )
  assert.deepEqual(tracked.writes, [])
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

test('createCoreHub: workspace-write sibling cwds open two serves', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-sib-'))
  const t = transport()
  const opened: Array<string | undefined> = []
  const clients: CoreClient[] = []
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 0,
    deps: deps('workspace-write', t),
    open: async (request) => {
      opened.push(request.workspace)
      const client = pair(root, 'workspace-write', request.workspace)
      clients.push(client)
      return client
    },
  })
  const a = await hub.require('c1', { cwd: '/a', policy: 'workspace-write' })
  const b = await hub.require('c1', { cwd: '/b', policy: 'workspace-write' })
  assert.notEqual(a, b)
  assert.deepEqual(opened, ['/a', '/b'])
  hub.close('c1')
  for (const client of clients) client.close()
})

test('createCoreHub: nested cwd shares the ancestor jail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-nest-'))
  const t = transport()
  const opened: Array<string | undefined> = []
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 0,
    deps: deps('workspace-write', t),
    open: async (request) => {
      opened.push(request.workspace)
      return pair(root, 'workspace-write', request.workspace)
    },
  })
  const parent = await hub.require('c1', { cwd: '/work', policy: 'workspace-write' })
  const nested = await hub.require('c1', { cwd: '/work/sub', policy: 'workspace-write' })
  assert.equal(parent, nested)
  assert.deepEqual(opened, ['/work'])
  parent.close()
})

test('createCoreHub: browse path does not mint a workspace-write jail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-browse-'))
  const t = transport()
  const opened: Array<string | undefined> = []
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 0,
    deps: deps('workspace-write', t),
    open: async (request) => {
      opened.push(request.workspace)
      return pair(root, 'workspace-write', request.workspace)
    },
  })
  await hub.require('c1', { path: '/tmp', policy: 'workspace-write' })
  assert.deepEqual(opened, ['/work'])
  hub.peek('c1')?.close()
})

test('BUG-4: the silent project-root probe never mints an ancestor jail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-bug4-probe-'))
  mkdirSync(join(root, 'work'), { recursive: true })
  const t = transport()
  const ctx = ctxWith(t)
  // A confined session: this is the mode whose `resolveCoreWorkspace` call mints
  // a jail root when it is handed a cwd outside every declared root.
  ctx.provide('sandboxPolicy', { resolve: () => 'workspace-write' })
  const opened: Array<string | undefined> = []
  const clients: CoreClient[] = []
  const hub = createCoreHub(ctx, {
    idleMs: 0,
    deps: deps('workspace-write', t),
    open: async (request) => {
      opened.push(request.workspace)
      const client = pair(root, 'workspace-write', request.workspace)
      clients.push(client)
      return client
    },
  })
  const exploding = new Proxy({}, {
    get: () => () => { throw new Error('SFTP consulted on a fenced path') },
  }) as unknown as SshFileSystemEngine
  const routing = new CoreRoutingFileSystem(ctx, exploding, hub)
  const mixed = new MixedFileSystem(exploding, routing, () => undefined)

  // `dsh-agent-instructions` / `dsh-skill-filesystem` walk up from the session
  // cwd asking about `<dir>/.git` and pass NO cwd (docs/notes/host-silent-fs.md §1).
  // Routing that probe target through `cwd` used to mint a workspace-write jail
  // for every ancestor (`/home/uuz`, `/home`, …); it must stay a `path`.
  // Two spellings matter: the `ssh://` one and — the shape the real probe
  // actually produces — the local PLACEHOLDER path of the session route.
  for (const probe of ['/home/uuz/ssh-test-lab/.git', '/home/uuz/.git', '/home/.git', '/.git']) {
    await mixed.resolve(`ssh://c1${probe}`).catch(() => undefined)
    await mixed.lstat(`ssh://c1${probe}`).catch(() => undefined)
  }
  const placeholderRoot = join(sshRoutesRoot(), 'c1', 'home', 'uuz')
  for (const probe of [
    join(placeholderRoot, 'ssh-test-lab', '.git'),
    join(placeholderRoot, '.git'),
    join(sshRoutesRoot(), 'c1', 'home', '.git'),
    join(sshRoutesRoot(), 'c1', '.git'),
  ]) {
    await mixed.resolve(probe).catch(() => undefined)
    await mixed.lstat(probe).catch(() => undefined)
  }
  assert.deepEqual([...new Set(opened)], ['/work'],
    'only declared roots (machine workspace / session cwd) may be bound')
  for (const client of clients) client.close()
})

test('createCoreHub: read-only is one serve regardless of cwd', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-ro-'))
  const t = transport()
  let opens = 0
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 0,
    deps: deps('read-only', t),
    open: async () => {
      opens += 1
      return pair(root, 'read-only')
    },
  })
  const a = await hub.require('c1', { cwd: '/a' })
  const b = await hub.require('c1', { cwd: '/b' })
  assert.equal(a, b)
  assert.equal(opens, 1)
  a.close()
})

test('createCoreHub: channel death evicts; next require reopens', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-die-'))
  const t = transport()
  let opens = 0
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 0,
    deps: deps('read-only', t),
    open: async () => {
      opens += 1
      return pair(root, 'read-only')
    },
  })
  const first = await hub.require('c1')
  first.close()
  assert.equal(hub.peek('c1'), undefined)
  await hub.require('c1')
  assert.equal(opens, 2)
  hub.peek('c1')?.close()
})

test('createCoreHub: idle kill then reopen', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-idle-'))
  const t = transport()
  let opens = 0
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 40,
    deps: deps('read-only', t),
    open: async () => {
      opens += 1
      return pair(root, 'read-only')
    },
  })
  await hub.require('c1')
  assert.equal(opens, 1)
  await delay(90)
  assert.equal(hub.peek('c1'), undefined)
  await hub.require('c1')
  assert.equal(opens, 2)
  hub.peek('c1')?.close()
})

test('createCoreHub: hold keeps the serve off the idle timer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-hold-'))
  const t = transport()
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 40,
    deps: deps('read-only', t),
    open: async () => pair(root, 'read-only'),
  })
  await hub.require('c1')
  const release = hub.hold('c1')
  await delay(90)
  assert.notEqual(hub.peek('c1'), undefined)
  release()
  await delay(90)
  assert.equal(hub.peek('c1'), undefined)
  hub.peek('c1')?.close()
})

test('createCoreHub.require: danger-full-access opens --sandbox off', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-off-'))
  const t = transport()
  const opened: string[] = []
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 0,
    deps: deps('off', t),
    open: async (request) => {
      opened.push(request.mode)
      return pair(root, 'off')
    },
  })
  await hub.require('c1', { policy: 'danger-full-access' })
  assert.deepEqual(opened, ['off'])
  assert.equal(coreServeCommand('off').includes("--sandbox 'off'"), true)
  hub.peek('c1')?.close()
})

test('CoreRoutingFileSystem: confined + dead core never touches SFTP', async () => {
  const t = transport()
  const ctx = ctxWith(t)
  const hub = createCoreHub(ctx, {
    deps: deps('off', t),
    open: async () => {
      throw new Error('core binary missing')
    },
  })
  const exploding = new Proxy({}, { get: () => () => { throw new Error('SFTP fallback is forbidden') } }) as unknown as SshFileSystemEngine
  const fs = new CoreRoutingFileSystem(ctx, exploding, hub)
  await assert.rejects(
    () => fs.writeText(target(), 'x', undefined, undefined, { mode: 'workspace-write' }),
    (error: unknown) => error instanceof FsError && error.code === 'FS_SANDBOX_DENIED',
  )
})

test('coreServeCommand: workspace-write without a root omits --workspace', () => {
  assert.equal(coreServeCommand('workspace-write').includes('--workspace'), false)
  assert.equal(coreServeCommand('workspace-write', '/home/uuz/ws').includes("--workspace '/home/uuz/ws'"), true)
})

test('createCoreHub: workspace-write with no usable root does not open serve', async () => {
  const t = transport()
  const opened: string[] = []
  const machine: RemoteSandboxMachineFace = { id: 'c1', remoteSandbox: 'workspace-write' }
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 0,
    deps: {
      machine: (id) => (id === 'c1' ? machine : undefined),
      connection: (id) => (id === 'c1' ? t : undefined),
      unavailable: (confinement, detail) => new RemoteSandboxError(`${confinement}: ${detail}`, REMOTE_SANDBOX_UNAVAILABLE),
    },
    open: async () => {
      opened.push('opened')
      throw new Error('must not open')
    },
  })
  await assert.rejects(
    () => hub.require('c1', { policy: 'workspace-write' }),
    (error: unknown) => error instanceof RemoteSandboxError
      && error.message.includes(REMOTE_SANDBOX_MESSAGES.workspaceRootRequired),
  )
  assert.deepEqual(opened, [])
})

test('createCoreHub: placeholder cwd mints a POSIX workspace-write jail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-ph-'))
  const t = transport()
  const opened: Array<string | undefined> = []
  const hub = createCoreHub(ctxWith(t), {
    idleMs: 0,
    deps: deps('workspace-write', t),
    open: async (request) => {
      opened.push(request.workspace)
      const client = pair(root, 'workspace-write', request.workspace)
      return client
    },
  })
  const placeholder = join(sshRoutesRoot(), 'c1', 'home', 'uuz', 'ssh-test-lab')
  await hub.require('c1', { cwd: placeholder, policy: 'workspace-write' })
  assert.deepEqual(opened, ['/home/uuz/ssh-test-lab'])
  hub.close('c1')
})

test('BUG-6: core.status answers from the artifact, never from a live session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-bug6-'))
  const base = transport()
  // The artifact probe (`~/.dsh-core/current/dsh-core version`) is driven per call.
  let probe: { exitCode: number; signal: null; stdout: string; stderr: string } = {
    exitCode: 0,
    signal: null,
    stdout: '{"version":"0.2.0-dev","arch":"linux-x86_64","proto":1,"caps":["fs"]}',
    stderr: '',
  }
  const probing = { ...base, exec: async () => probe } as unknown as SshTransport
  const hub = createCoreHub(ctxWith(probing), {
    idleMs: 0,
    deps: deps('workspace-write', probing),
    open: async () => pair(root, 'workspace-write', '/work'),
  })
  const live = await hub.require('c1', { cwd: '/work', policy: 'workspace-write' })
  const installed = await hub.status('c1')
  assert.equal(installed.ok, true)
  assert.equal(installed.sandbox, 'workspace-write')

  // The operator deletes `~/.dsh-core/<version>/` while the exec'd serve is
  // still alive (it outlives its own directory until the idle kill).
  probe = {
    exitCode: 127,
    signal: null,
    stdout: '',
    stderr: 'bash: /home/uuz/.dsh-core/current/dsh-core: No such file or directory',
  }
  const after = await hub.status('c1')
  assert.equal(after.ok, false, 'a cached serve must not report a deleted artifact as installed')
  assert.match(String(after.detail), /No such file or directory/)
  assert.match(String(after.detail), /cached core session is still running/)
  live.close()
})
