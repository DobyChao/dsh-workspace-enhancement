/**
 * R4-I2（t4）混合 provider 单测：路由判定纯函数（本地/远程世界）、子进程与
 * 文件系统门面的分支委派（fake 分支断言），以及一条进程级探测——真实
 * LocalSubprocessRuntime 作为本地分支，经 MixedSubprocessRuntime.spawn 以
 * 本地 cwd 直接执行 node 并读到输出（证明本地世界未被 SSH 误路由）。
 * @module test/mixed-routing
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import { sshRoutesRoot } from '../src/transport.ts'
import { MixedFileSystem, MixedSubprocessRuntime, remoteArgvOf, worldOfCwd, worldOfTargetKey } from '../src/mixed.ts'
import type { FileSystemBranch, SubprocessBranch } from '../src/mixed.ts'

const REMOTE_CWD = join(sshRoutesRoot(), 'c1', 'srv', 'work')
const LOCAL_CWD = join(tmpdir(), 'dsw-mixed-local')

/** A remote-cwd placeholder path (independent of the machine's actual DSH_HOME). */
function remotePlaceholder(): string {
  return REMOTE_CWD
}

/* ------------------------------------------------------- 1) 路由判定 */

test('worldOfCwd: remote cwd spellings resolve remote; local/absent resolve local', () => {
  assert.equal(worldOfCwd(undefined), 'local')
  assert.equal(worldOfCwd(join(LOCAL_CWD, 'proj')), 'local')
  assert.equal(worldOfCwd('C:\\Users\\me\\proj'), 'local')
  assert.equal(worldOfCwd('ssh://c1/srv/work'), 'remote')
  assert.equal(worldOfCwd(remotePlaceholder()), 'remote')
  assert.equal(worldOfCwd(remotePlaceholder().replace(/[\\/]dsw-routes$/u, `${'\\'}dsh-ssh-routes`)), 'remote')
})

test('worldOfTargetKey: ssh:// keys are remote; realpath keys are local', () => {
  assert.equal(worldOfTargetKey('ssh://c1/srv/work'), 'remote')
  assert.equal(worldOfTargetKey('ssh://c1/'), 'remote')
  assert.equal(worldOfTargetKey(String(FsTargetKey(join(LOCAL_CWD, 'a.txt')))), 'local')
})

test('t6: worldOfCwd — a POSIX-absolute cwd on win32 is remote; UNC/drive stay local', () => {
  assert.equal(worldOfCwd('/home/uuz/r4-verify', 'win32'), 'remote')
  assert.equal(worldOfCwd('/home/uuz', 'win32'), 'remote')
  assert.equal(worldOfCwd('//server/share/proj', 'win32'), 'local')
  assert.equal(worldOfCwd('C:\\Users\\me\\proj', 'win32'), 'local')
  assert.equal(worldOfCwd('proj', 'win32'), 'local')
  // On a POSIX host the same cwd is genuinely local (POSIX is the local world).
  assert.equal(worldOfCwd('/home/uuz/proj', 'linux'), 'local')
})

test('t6: remoteArgvOf rewrites Windows argv[0] to a bare POSIX command name', () => {
  assert.deepEqual(remoteArgvOf([String.raw`C:\Program Files\nodejs\node.exe`, '-e', 'x']), ['node', '-e', 'x'])
  assert.deepEqual(remoteArgvOf([String.raw`C:\Users\me\...\bin\rg.exe`, '--path', '.']), ['rg', '--path', '.'])
  assert.deepEqual(remoteArgvOf([String.raw`\\server\share\rg.exe`, 'a']), ['rg', 'a'])
  assert.deepEqual(remoteArgvOf(['rg', '--path', '.']), ['rg', '--path', '.'])
  assert.deepEqual(remoteArgvOf(['/usr/bin/rg', 'a']), ['/usr/bin/rg', 'a'])
  assert.deepEqual(remoteArgvOf(['bash', '-c', 'echo']), ['bash', '-c', 'echo'])
})

/* ------------------------------------------------ 2) 子进程门面分支委派 */

/** Record which branch each subprocess call landed on. */
function stubSubprocessBranch(label: 'local' | 'remote'): SubprocessBranch & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async resolveExecutable(command: string): Promise<string> {
      calls.push(`resolve:${label}:${command}`)
      return command
    },
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      calls.push(`spawn:${label}:${spec.cwd}`)
      throw new Error(`unexpected spawn on ${label} branch`)
    },
    async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<never> {
      calls.push(`terminal:${label}:${spec.cwd}`)
      throw new Error(`unexpected terminal on ${label} branch`)
    },
  }
}

test('MixedSubprocessRuntime: spawn routes by spec.cwd (local vs remote branch)', () => {
  const local = stubSubprocessBranch('local')
  const remote = stubSubprocessBranch('remote')
  const mixed = new MixedSubprocessRuntime(local, remote as never)
  const spec = (cwd: string): SubprocessSpawnSpec => ({
    argv: ['true'],
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } },
    graceMs: 1000,
  })
  assert.throws(() => mixed.spawn(spec(LOCAL_CWD)))
  assert.deepEqual(local.calls, [`spawn:local:${LOCAL_CWD}`])
  assert.throws(() => mixed.spawn(spec(remotePlaceholder())))
  assert.deepEqual(remote.calls, [`spawn:remote:${remotePlaceholder()}`])
  assert.equal(local.calls.length, 1)
  assert.equal(remote.calls.length, 1)
})

test('MixedSubprocessRuntime: spawnTerminal routes by spec.cwd; resolveExecutable stays local', async () => {
  const local = stubSubprocessBranch('local')
  const remote = stubSubprocessBranch('remote')
  const mixed = new MixedSubprocessRuntime(local, remote as never)
  const terminalSpec = (cwd: string): SubprocessTerminalSpawnSpec => ({
    argv: ['bash'],
    cwd,
    cols: 80,
    rows: 24,
    graceMs: 1000,
    signal: new AbortController().signal,
  })
  await assert.rejects(() => mixed.spawnTerminal(terminalSpec(LOCAL_CWD)))
  await assert.rejects(() => mixed.spawnTerminal(terminalSpec(remotePlaceholder())))
  assert.deepEqual(local.calls, [`terminal:local:${LOCAL_CWD}`])
  assert.deepEqual(remote.calls, [`terminal:remote:${remotePlaceholder()}`])
  assert.equal(local.calls.length, 1)
  assert.equal(remote.calls.length, 1)
})

test('t6: MixedSubprocessRuntime remote spawn rewrites a Windows argv[0] (rg.exe → rg)', () => {
  const seen: string[] = []
  const local = stubSubprocessBranch('local')
  const remote: SubprocessBranch = {
    async resolveExecutable(command: string): Promise<string> {
      seen.push(`resolve:${command}`)
      return command
    },
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      seen.push(`argv0:${spec.argv[0]}`)
      throw new Error('expected rewrite assertion only')
    },
    async spawnTerminal(): Promise<never> {
      throw new Error('unexpected terminal')
    },
  }
  const mixed = new MixedSubprocessRuntime(local, remote as never)
  assert.throws(() => mixed.spawn({
    argv: [String.raw`C:\...\@vscode\ripgrep-win32-x64\bin\rg.exe`, '--path', '.'],
    cwd: remotePlaceholder(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } },
    graceMs: 1000,
  }))
  assert.deepEqual(seen, ['argv0:rg'])
})

/** 进程级探测：本地 cwd 经混合门面真实执行 node（本地世界，非 SSH 分支）。 */
test('MixedSubprocessRuntime: a local cwd executes on the local branch (process-level)', async () => {
  const ctx = new Context()
  mkdirSync(LOCAL_CWD, { recursive: true })
  const local = new LocalSubprocessRuntime(ctx)
  const seen: string[] = []
  const remote: SubprocessBranch = {
    async resolveExecutable(command: string): Promise<string> {
      seen.push(`resolve:${command}`)
      throw new Error('remote branch must not be reached for a local cwd')
    },
    spawn(): SubprocessHandle {
      seen.push('spawn:remote')
      throw new Error('remote branch must not be reached for a local cwd')
    },
    async spawnTerminal(): Promise<never> {
      seen.push('terminal:remote')
      throw new Error('remote branch must not be reached for a local cwd')
    },
  }
  const mixed = new MixedSubprocessRuntime(local, remote as never)
  const handle = mixed.spawn({
    argv: [process.execPath, '-e', 'console.log("LOCAL_OK")'],
    cwd: LOCAL_CWD,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 1024, spill: { maxBytes: 4096 } },
      stderr: { maxBytes: 1024, spill: { maxBytes: 4096 } },
    },
    graceMs: 2000,
  })
  const outcome = await handle.done
  assert.equal(outcome.exitCode, 0)
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  assert.ok(stdout.includes('LOCAL_OK'), `expected LOCAL_OK in ${JSON.stringify(stdout)}`)
  assert.deepEqual(seen, [])
})

/* ------------------------------------------------- 3) 文件系统门面分支委派 */

function stubFileSystemBranch(label: 'local' | 'remote'): FileSystemBranch & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    ...(label === 'local' ? { sandboxMode: 'workspace-write' } : {}),
    async resolve(path: string): Promise<FsTarget> {
      calls.push(`resolve:${label}:${path}`)
      const key = label === 'remote' ? `ssh://c1/${path}` : `key-${label}`
      return { targetKey: FsTargetKey(key), displayPath: path }
    },
    processPath(target: FsTarget): string {
      calls.push(`processPath:${label}:${String(target.targetKey)}`)
      return `/world/${label}`
    },
    fileUrl(target: FsTarget): string {
      calls.push(`fileUrl:${label}:${String(target.targetKey)}`)
      return `file:///world/${label}`
    },
    contains(): boolean {
      calls.push(`contains:${label}`)
      return true
    },
    async stat(): Promise<undefined> {
      calls.push(`stat:${label}`)
      return undefined
    },
    async lstat(): Promise<undefined> {
      calls.push(`lstat:${label}`)
      return undefined
    },
    async readText(): Promise<string> {
      calls.push(`readText:${label}`)
      return ''
    },
    async streamText(): Promise<AsyncIterable<string>> {
      calls.push(`streamText:${label}`)
      return (async function* () {})()
    },
    async readBytes(): Promise<Uint8Array> {
      calls.push(`readBytes:${label}`)
      return new Uint8Array()
    },
    async listDir(): Promise<never[]> {
      calls.push(`listDir:${label}`)
      return []
    },
    async writeText(): Promise<never> {
      calls.push(`writeText:${label}`)
      throw new Error('unexpected write on stub')
    },
    async editText(): Promise<never> {
      calls.push(`editText:${label}`)
      throw new Error('unexpected edit on stub')
    },
  }
}

test('MixedFileSystem: resolve/lstat route by cwd; target ops route by target key', async () => {
  const local = stubFileSystemBranch('local')
  const remote = stubFileSystemBranch('remote')
  const mixed = new MixedFileSystem(local, remote as never)

  const localTarget = await mixed.resolve('proj/file.txt', { cwd: LOCAL_CWD })
  assert.deepEqual(local.calls, ['resolve:local:proj/file.txt'])
  assert.equal(String(localTarget.targetKey), 'key-local')
  const remoteTarget = await mixed.resolve('srv/work', { cwd: remotePlaceholder() })
  assert.deepEqual(remote.calls, ['resolve:remote:srv/work'])
  assert.equal(String(remoteTarget.targetKey), 'ssh://c1/srv/work')

  await mixed.stat(localTarget)
  await mixed.stat(remoteTarget)
  assert.deepEqual(local.calls.slice(1), ['stat:local'])
  assert.deepEqual(remote.calls.slice(1), ['stat:remote'])

  // processPath/fileUrl/readText/readBytes/listDir: key-routed.
  mixed.processPath(remoteTarget)
  mixed.fileUrl(localTarget)
  await mixed.readText(localTarget)
  await mixed.readBytes(remoteTarget, undefined, 100)
  await mixed.listDir(remoteTarget)
  assert.deepEqual(remote.calls.slice(2), ['processPath:remote:ssh://c1/srv/work', 'readBytes:remote', 'listDir:remote'])
  assert.deepEqual(local.calls.slice(2), ['fileUrl:local:key-local', 'readText:local'])
})

test('MixedFileSystem: cross-world contains is false; sandboxMode delegates to the local backend', () => {
  const local = stubFileSystemBranch('local')
  const remote = stubFileSystemBranch('remote')
  const mixed = new MixedFileSystem(local, remote as never)
  const t = (key: string): FsTarget => ({ targetKey: FsTargetKey(key), displayPath: key })
  assert.equal(mixed.contains(t('ssh://c1/home'), t('key-local')), false)
  assert.equal(mixed.sandboxMode, 'workspace-write')
  assert.deepEqual(local.calls, [])
  assert.deepEqual(remote.calls, [])
})

test('MixedFileSystem: writeText/editText forward the policy to LOCAL only; remote drops it', async () => {
  const local = stubFileSystemBranch('local')
  const remote = stubFileSystemBranch('remote')
  const mixed = new MixedFileSystem(local, remote as never)
  const remoteTarget: FsTarget = { targetKey: FsTargetKey('ssh://c1/etc/f'), displayPath: 'ssh://c1/etc/f' }
  const localTarget: FsTarget = { targetKey: FsTargetKey(String(FsTargetKey(join(LOCAL_CWD, 'f')))), displayPath: join(LOCAL_CWD, 'f') }
  const intent = { kind: 'replaceIfVersion', version: FsVersion('1') as FsVersion }
  await assert.rejects(() => mixed.writeText(remoteTarget, 'x', intent, undefined, { mode: 'read-only' }))
  await assert.rejects(() => mixed.writeText(localTarget, 'x', intent, undefined, { mode: 'read-only' }))
  await assert.rejects(() => mixed.editText(remoteTarget, { oldString: 'a', newString: 'b' }, undefined, undefined, { mode: 'read-only' }))
  await assert.rejects(() => mixed.editText(localTarget, { oldString: 'a', newString: 'b' }, undefined, undefined, { mode: 'read-only' }))
  assert.deepEqual(remote.calls, ['writeText:remote', 'editText:remote'])
  assert.deepEqual(local.calls, ['writeText:local', 'editText:local'])
})

/* ---------------------------------------------- 4) 本地委托冒烟（不劣化） */

/** 本地 f/s 冒烟：经混合门面的本地分支真实读/写/列表（官方 LocalFileSystem 原实现）。 */
test('MixedFileSystem: local cwd reads/writes/lists through the real local backend (process-level)', async () => {
  const ctx = new Context()
  const fs = new LocalFileSystem(ctx, { cwd: LOCAL_CWD, diffBasisMaxBytes: 10 * 1024 * 1024 })
  const remote: FileSystemBranch = {
    async resolve(): Promise<FsTarget> {
      throw new Error('remote branch must not be reached for local targets')
    },
    processPath(): string {
      throw new Error('remote branch must not be reached for local targets')
    },
    fileUrl(): string {
      throw new Error('remote branch must not be reached for local targets')
    },
    contains(): boolean {
      throw new Error('remote branch must not be reached for local targets')
    },
    stat(): Promise<never> {
      throw new Error('remote branch must not be reached for local targets')
    },
    lstat(): Promise<never> {
      throw new Error('remote branch must not be reached for local targets')
    },
    readText(): Promise<never> {
      throw new Error('remote branch must not be reached for local targets')
    },
    streamText(): Promise<never> {
      throw new Error('remote branch must not be reached for local targets')
    },
    readBytes(): Promise<never> {
      throw new Error('remote branch must not be reached for local targets')
    },
    listDir(): Promise<never> {
      throw new Error('remote branch must not be reached for local targets')
    },
    writeText(): Promise<never> {
      throw new Error('remote branch must not be reached for local targets')
    },
    editText(): Promise<never> {
      throw new Error('remote branch must not be reached for local targets')
    },
  }
  const mixed = new MixedFileSystem(fs, remote as never)
  mkdirSync(LOCAL_CWD, { recursive: true })

  // write → read back → stat → listDir, all on the local world.
  const target = await mixed.resolve('smoke.txt', { cwd: LOCAL_CWD })
  assert.equal(String(target.targetKey).includes('smoke.txt'), true)
  const outcome = await mixed.writeText(target, 'hello 本地', undefined, undefined, { mode: 'danger-full-access' })
  assert.equal(outcome.version !== undefined, true)
  const info = await mixed.stat(target)
  assert.equal(info?.type, 'file')
  const text = await mixed.readText(target)
  assert.equal(text, 'hello 本地')
  const dirTarget = await mixed.resolve('.', { cwd: LOCAL_CWD })
  const entries = await mixed.listDir(dirTarget)
  assert.ok(entries.some(entry => entry.name === 'smoke.txt'), 'listDir must observe the written file')
})
