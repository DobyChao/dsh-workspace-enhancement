/**
 * BUG-2 / UPSTREAM-1 契约回归：`MixedFileSystem` 作为 `ctx.fs` 唯一实现，必须实现
 * dsh-fs 接缝的**全部**方法。两次踩坑同源：
 *
 * - BUG-2：漏掉第 13 个方法 `processPathFromHostPath`（图片附件解析 →
 *   `resolveImageAccess` → `ctx.get('fs')?.processPathFromHostPath(hostPath)`），
 *   带图请求直接 `TypeError` → 被 LLM 适配器包成 `LlmError(…, 'TRANSPORT')`。
 * - UPSTREAM-1：0.1.5 线新增第 14 个方法 `readByteRange`，宿主同样经 `ctx.get('fs')`
 *   取值 —— 门面不实现就是同一个 `TypeError`。
 *
 * 为什么是**反射 + 静态清单**两条断言：
 *
 * - 反射（具体后端原型链）跟随**已安装家族**：装 0.1.5 时能把"上游又加了方法而我们
 *   没实现"抓出来；装 0.1.2 时它只反射出 13 个，抓不到 `readByteRange`。
 * - 静态清单（`REQUIRED_SEAM_METHODS`）锁死"门面必须有这 14 个"，与装哪个家族无关
 *   —— 这是老家族下仍然能挡住回归的那一条。
 *
 * 为什么不能只反射 `FileSystem.prototype`：`FileSystem` 的抽象成员被 TS 擦除，
 * 运行时原型上只剩 `constructor`/`sandboxMode`/`processPathFromHostPath` 三项，
 * 用它做全集只能覆盖 1 个方法，堵不住漏实现。这里改用**具体后端**（本插件的
 * local 委托链，`LocalFileSystem`/`SandboxedFileSystem` 继承自同一个 `FileSystem`
 * 基类）的运行时原型链作为上游方法全集的权威来源。
 * @module test/mixed-fs-contract
 */

import assert from 'node:assert/strict'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { FileSystem, FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { MixedFileSystem } from '../src/mixed.ts'
import type { FileSystemBranch } from '../src/mixed.ts'
import { sshRoutesRoot } from '../src/transport.ts'
import type { SshFileSystemEngine } from '../src/filesystem.ts'

/** 具体后端上的内部实现细节：不是接缝契约的一部分，不参与反射断言。 */
const INTERNAL_METHODS = new Set(['constructor', 'withLock', 'versionAfterWrite', 'checkedTarget'])

/** 一个具体后端原型链上的**公共方法名**全集（去重、去内部方法）。 */
function seamMethodNames(root: object): string[] {
  const names = new Set<string>()
  for (let proto: object | null = root; proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (INTERNAL_METHODS.has(key)) continue
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)
      if (descriptor !== undefined && typeof descriptor.value === 'function') names.add(key)
    }
  }
  return [...names].sort()
}

const UPSTREAM_METHODS = seamMethodNames(LocalFileSystem.prototype)

/** 0.1.5 线**之前**的接缝方法（13 个）；新家族在此之上再暴露 `readByteRange`。 */
const PRE_015_METHODS = [
  'contains',
  'editText',
  'fileUrl',
  'listDir',
  'lstat',
  'processPath',
  'processPathFromHostPath',
  'readBytes',
  'readText',
  'resolve',
  'stat',
  'streamText',
  'writeText',
]

/** 门面必须实现的**全集**：13 个老方法 + 0.1.5 线新增的 `readByteRange`。 */
const REQUIRED_SEAM_METHODS = [...PRE_015_METHODS, 'readByteRange'].sort()

/** 已安装家族是否带 UPSTREAM-1 的新方法（决定语义用例跑还是跳过）。 */
const LOCAL_HAS_RANGE = UPSTREAM_METHODS.includes('readByteRange')

/**
 * 远程分支替身：本文件的所有断言都必须落在 local 世界——远程世界不共享宿主
 * 文件，任何一次远程委派都是缺陷，故直接抛出。
 */
function explodingRemote(): SshFileSystemEngine {
  const boom = (): never => {
    throw new Error('BUG-2: the remote world must never be consulted for a host path')
  }
  return {
    resolve: boom,
    processPath: boom,
    processPathFromHostPath: boom,
    fileUrl: boom,
    contains: boom,
    stat: boom,
    lstat: boom,
    readText: boom,
    streamText: boom,
    readBytes: boom,
    readByteRange: boom,
    listDir: boom,
    writeText: boom,
    editText: boom,
  } as unknown as SshFileSystemEngine
}

/** 只记录委派的 local 分支替身（语义由真实后端用例断言）。 */
function stubLocal(): FileSystemBranch & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    sandboxMode: 'workspace-write',
    async resolve(path: string): Promise<FsTarget> {
      return { targetKey: FsTargetKey(path), displayPath: path }
    },
    processPath: (target: FsTarget): string => `/world/${String(target.targetKey)}`,
    processPathFromHostPath(hostPath: string): string | undefined {
      calls.push(`processPathFromHostPath:${hostPath}`)
      return `/local${hostPath}`
    },
    fileUrl: (target: FsTarget): string => `file:///world/${String(target.targetKey)}`,
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
    // UPSTREAM-1: 门面转发用的那条路径（老家族的后端没有它，见
    // `test/upstream-1-byte-range.test.ts` 的守卫用例）。
    async readByteRange(target: FsTarget, range: { offset: number; length: number }): Promise<Uint8Array> {
      calls.push(`readByteRange:${String(target.targetKey)}:${range.offset}:${range.length}`)
      return Uint8Array.from([1, 2, 3])
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
}

/** 真实 local 后端（本插件生产用的两种 delegate 之一）。 */
function realLocal(): LocalFileSystem {
  return new LocalFileSystem(new Context(), { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 })
}

/** 真实 sandboxed 后端（生产里存在 sandbox policy 时的 delegate）。 */
async function realSandboxed(): Promise<SandboxedFileSystem> {
  const ctx = new Context()
  await ctx.plugin({
    apply(c) {
      c.provide('sandboxPolicy', {
        defaultMode: 'workspace-write',
        resolve: () => ({ mode: 'workspace-write', workspaceRoot: process.cwd() }),
      })
    },
  })
  let created: SandboxedFileSystem | undefined
  ctx.inject(['sandboxPolicy'], (owner) => {
    created = new SandboxedFileSystem(owner, { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 })
  })
  // 注入回调在后续微任务里执行（与 mixed-install 用例同一机制）。
  for (let i = 0; i < 50 && created === undefined; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(created !== undefined, 'the sandboxed backend must construct inside the inject fiber')
  return created
}

/* ------------------------------------------------ 1) 上游方法全集反射 */

test('contract: the installed backend still exposes the 13 pre-0.1.5 seam methods', () => {
  // 上游基类的抽象成员在运行时被擦除，只有 `sandboxMode`/`processPathFromHostPath`
  // 留下；方法全集必须从具体后端反射，否则这条契约用例本身堵不住漏实现。
  assert.deepEqual(
    Object.getOwnPropertyNames(FileSystem.prototype).filter(name => name !== 'constructor').sort(),
    ['processPathFromHostPath', 'sandboxMode'],
    'upstream FileSystem.prototype no longer looks as expected — revisit this contract test',
  )
  // 去掉 0.1.5 线新增项后，老方法必须逐个还在（改名/删除会在这里红）。
  assert.deepEqual(UPSTREAM_METHODS.filter(name => name !== 'readByteRange'), PRE_015_METHODS,
    'the installed family dropped or renamed a pre-0.1.5 seam method')
})

test('contract: MixedFileSystem implements every required seam method (13 + readByteRange)', () => {
  // 与安装的家族无关：门面必须是 14 个方法的全集（老家族下也只能靠这条挡住回归）。
  const missing = REQUIRED_SEAM_METHODS.filter(name => typeof (MixedFileSystem.prototype as Record<string, unknown>)[name] !== 'function')
  assert.deepEqual(missing, [], `MixedFileSystem is missing seam method(s): ${missing.join(', ')}`)
  // `sandboxMode` 是访问器，不是方法。
  const descriptor = Object.getOwnPropertyDescriptor(MixedFileSystem.prototype, 'sandboxMode')
  assert.equal(typeof descriptor?.get, 'function', 'MixedFileSystem must expose the sandboxMode accessor')
})

test('contract: MixedFileSystem covers everything the installed backend exposes', () => {
  // 跟随家族：装 0.1.5 时，上游再加一个方法也会在这里红（静态清单不知道新名字）。
  const missing = UPSTREAM_METHODS.filter(name => typeof (MixedFileSystem.prototype as Record<string, unknown>)[name] !== 'function')
  assert.deepEqual(missing, [], `MixedFileSystem is missing upstream seam method(s): ${missing.join(', ')}`)
})

test('contract: the reflection assertion turns red when the facade lacks a method', () => {
  // 反例自证：从门面自身的方法集合里删掉方法，断言必须点名它（这正是修复前的形状：
  // `FileSystemBranch` 类型没有该方法 → 门面也没有）。两个踩过的方法都自证一遍。
  for (const method of ['processPathFromHostPath', 'readByteRange']) {
    const own: Record<string, unknown> = {}
    for (const key of Object.getOwnPropertyNames(MixedFileSystem.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(MixedFileSystem.prototype, key)
      if (descriptor !== undefined && typeof descriptor.value === 'function') own[key] = descriptor.value
    }
    assert.equal(typeof own[method], 'function', `the fixed facade must own ${method}`)
    delete own[method]
    const missing = REQUIRED_SEAM_METHODS.filter(name => typeof own[name] !== 'function')
    assert.deepEqual(missing, [method])
  }
})

/* --------------------------------- 2) processPathFromHostPath 的委派与语义 */

test('BUG-2: processPathFromHostPath forwards to the local backend only', () => {
  const local = stubLocal()
  const mixed = new MixedFileSystem(local, explodingRemote())
  assert.equal(mixed.processPathFromHostPath('/host/a.png'), '/local/host/a.png')
  assert.deepEqual(local.calls, ['processPathFromHostPath:/host/a.png'])
})

test('BUG-2: real local backend semantics — absolute maps, relative/blank are undefined', () => {
  const mixed = new MixedFileSystem(realLocal(), explodingRemote())
  const hostPath = join(tmpdir(), 'dsw-bug2-host.png')
  assert.equal(mixed.processPathFromHostPath(hostPath), resolvePath(hostPath))
  assert.equal(mixed.processPathFromHostPath('relative/a.png'), undefined)
  assert.equal(mixed.processPathFromHostPath(''), undefined)
  // 与 dsh-fs-local 的语义完全一致（同一输入 → 同一输出）。
  const local = realLocal()
  for (const probe of [hostPath, 'relative/a.png', '', 'ssh://c1/srv/a.png']) {
    assert.equal(mixed.processPathFromHostPath(probe), local.processPathFromHostPath(probe), `diverged for ${JSON.stringify(probe)}`)
  }
  assert.equal(isAbsolute(hostPath), true)
})

test('BUG-2: a REMOTE session cwd does not change the host mapping world', async () => {
  // 修复前的路由思路（按 cwd/targetKey 路由）在这里会错：宿主文件永远属于
  // local 世界。远程 cwd 只是会话事实，与宿主路径映射无关。
  //
  // 远程 cwd 必须取自插件自己的占位路由树，**不能**用裸 POSIX 绝对路径：
  // `worldOfCwd` 只对 win32 把 `/…` 当成远程世界（src/mixed.ts:122），在
  // Linux 上 `/srv/work` 是合法本地路径 → 走 local → 断言变成「本该拒绝却
  // 成功」（PR #3 的 Ubuntu 红）。`sshRoutesRoot()` 在两种平台都被识别为路由。
  const mixed = new MixedFileSystem(realLocal(), explodingRemote())
  const remoteCwd = join(sshRoutesRoot(), 'c1', 'srv', 'work')
  await assert.rejects(() => mixed.resolve('a.png', { cwd: remoteCwd }), /must never be consulted/)
  const hostPath = join(tmpdir(), 'dsw-bug2-remote-cwd.png')
  assert.equal(mixed.processPathFromHostPath(hostPath), resolvePath(hostPath))
})

test('BUG-2: the sandboxed local delegate answers the same host mapping', async () => {
  // 生产里无 sandbox policy 时委托 `LocalFileSystem`，有 policy 时委托
  // `SandboxedFileSystem`（继承同一实现）——两种 delegate 都必须有答案。
  const sandboxed = await realSandboxed()
  const mixed = new MixedFileSystem(sandboxed as unknown as FileSystemBranch, explodingRemote())
  const hostPath = join(tmpdir(), 'dsw-bug2-sandboxed.png')
  assert.equal(mixed.processPathFromHostPath(hostPath), resolvePath(hostPath))
  assert.equal(mixed.processPathFromHostPath('relative/a.png'), undefined)
})
