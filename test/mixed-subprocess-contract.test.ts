/**
 * AUDIT-1 / R14 O2 契约回归（subprocess 侧）：`MixedSubprocessRuntime` 替换的是
 * `ctx.subprocess` 的唯一实现——上游基类（`SubprocessRuntime`，cordis `Service` 子类）
 * 新增抽象成员时，门面是「子集类型」（`SubprocessBranch`），tsc 不会点名漏实现，
 * 漏了就是运行时 `TypeError`。fs 侧 2026-09-25 的 `watch` 事件（0.1.7-rc.2，drift 红、
 * 反射契约点名、当天修）证明了这类契约有效；**同日** subprocess 门面被查出缺
 * `terminalEnvironment`——正是没有本契约拦住的 O2 形态（见 R39）。
 *
 * 与 `test/mixed-fs-contract.test.ts` 同构的两条断言：
 * - 静态清单（`REQUIRED_SEAM_METHODS`）：门面必须有的**地板**，与安装家族无关；
 * - 反射（具体后端 `LocalSubprocessRuntime` 原型链）：跟随**已安装家族**——
 *   上游加公开接缝成员而门面没跟上时红（抽象成员被 TS 擦除，只能从具体后端反射）。
 *
 * 为什么**不做** `extends` 上游基类（AUDIT-1 评估结论，R14 O2 的建议被否）：
 * ① 基类是 cordis `Service` 子类：构造要 `Context`、自带服务生命周期；门面是
 *   `ctx.set('subprocess', new MixedSubprocessRuntime(...))` 的纯路由对象，继承
 *   会改变注册与生命周期语义；
 * ② 基类运行时原型近乎空（抽象成员被 TS 擦除），`extends` 继承不到东西；
 * ③ 若上游新增**具现**方法，静默继承会让它绕过世界路由、直接以基类（local）语义
 *   应答——对路由门面而言，契约测试的红强迫逐方法**显式**路由（`watch` 的
 *   「local 转发 / remote 诚实拒绝」就是模板），比静默继承安全。
 * @module test/mixed-subprocess-contract
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { MixedSubprocessRuntime } from '../src/mixed.ts'

/** 本地后端的内部实现：基类未声明、宿主经类型化的 `ctx.subprocess` 调不到，不参与反射断言。 */
const INTERNAL_METHODS = new Set([
  'constructor',
  'disposeManagedProcesses',
  'executableCandidates',
  'selectContainmentMode',
  'terminateForHostExit',
  'warnFallback',
])

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

const UPSTREAM_METHODS = seamMethodNames(LocalSubprocessRuntime.prototype)

/** 0.1.5 线的接缝地板（3 个）；0.1.7 起在此之上再暴露已知增量。 */
const PRE_017_METHODS = ['resolveExecutable', 'spawn', 'spawnTerminal']

/**
 * 0.1.7 起**已知**的接缝增量：`terminalEnvironment`（UPSTREAM-5）。
 * 上游再加公开成员时，下面的反射断言会点名新名字——把它挪进这张表（或
 * `INTERNAL_METHODS`，如果它确实只是本地内部实现），并给门面补实现。
 */
const KNOWN_ADDITIONS = ['terminalEnvironment']

/** 门面必须实现的**全集**：3 个老方法 + 已知增量。 */
const REQUIRED_SEAM_METHODS = [...PRE_017_METHODS, ...KNOWN_ADDITIONS].sort()

/* ------------------------------------------------ 1) 上游方法全集反射 */

test('contract: the installed local runtime still exposes the pre-0.1.7 seam floor', () => {
  // 老成员必须逐个还在（改名/删除会在这里红，并点名新形状）。
  assert.deepEqual(
    UPSTREAM_METHODS.filter(name => !KNOWN_ADDITIONS.includes(name)),
    PRE_017_METHODS,
    'the installed family dropped, renamed, or ADDED a subprocess seam method — '
      + 'classify the new name in KNOWN_ADDITIONS (seam) or INTERNAL_METHODS (local-only), '
      + 'and implement it on the facade when it is a seam member',
  )
})

test('contract: MixedSubprocessRuntime implements every required seam method', () => {
  // 与安装的家族无关：门面必须是全集（老家族下也只能靠这条挡住回归）。
  const missing = REQUIRED_SEAM_METHODS.filter(name => typeof (MixedSubprocessRuntime.prototype as Record<string, unknown>)[name] !== 'function')
  assert.deepEqual(missing, [], `MixedSubprocessRuntime is missing seam method(s): ${missing.join(', ')}`)
})

test('contract: MixedSubprocessRuntime covers everything the installed backend exposes', () => {
  // 跟随家族：装 0.1.7+ 时，上游再加一个公开成员也会在这里红（静态清单不知道新名字）。
  const missing = UPSTREAM_METHODS.filter(name => typeof (MixedSubprocessRuntime.prototype as Record<string, unknown>)[name] !== 'function')
  assert.deepEqual(missing, [], `MixedSubprocessRuntime is missing upstream seam method(s): ${missing.join(', ')}`)
})

test('contract: the reflection assertion turns red when the facade lacks a method', () => {
  // 反例自证：从门面自身的方法集合里删掉方法，静态清单断言必须点名它。
  // `terminalEnvironment` 正是 2026-09-25 查出的真实漏实现（修复合并在前一提交）。
  for (const method of ['spawn', 'terminalEnvironment']) {
    const own: Record<string, unknown> = {}
    for (const key of Object.getOwnPropertyNames(MixedSubprocessRuntime.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(MixedSubprocessRuntime.prototype, key)
      if (descriptor !== undefined && typeof descriptor.value === 'function') own[key] = descriptor.value
    }
    assert.equal(typeof own[method], 'function', `the fixed facade must own ${method}`)
    delete own[method]
    const missing = REQUIRED_SEAM_METHODS.filter(name => typeof own[name] !== 'function')
    assert.deepEqual(missing, [method])
  }
})
