/**
 * INFRA-20 家族形状契约：settings 服务的真实安装面（不是手写 fixture）。
 *
 * UPSTREAM-8 的检出链教训：0.1.7 的 `SettingsForms` 重写让 `settings.get`
 * 消失，而当时 typecheck / 单测（fixture 是我们自己写的）/ boot 哨兵
 * （只探 boot + connections.list）三层全绿——断的是「运行时读到的服务形状」。
 * 本文件把两层防护钉进 `npm test`（drift 通道每周对 next/alpha 家族跑它）：
 *
 *   1. 家族自适应方法清单：安装家族的 settings 面方法名必须 ⊆ 两族已知并集
 *      （0.1.5-rc.1 / 0.1.7-rc.2 磁盘权威源枚举）——上游再改面，这里先红；
 *   2. 崩坏复现断言：`localePreferenceOf` 对**真实安装的面**上没有 `get`
 *      的家族必须不抛且回退 undefined（0.1.7 即 UPSTREAM-8 的原始崩坏形状）。
 *      有 `get` 的家族（0.1.5）不在此调用原型方法（未构造的实例上执行
 *      真实 `get` 会读内部状态，属 fixture 覆盖范围，见 locale-host 测试）。
 * @module test/settings-family-face
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import SettingsForms from '@deepseek-ai/dsh-settings'
import { localePreferenceOf, localeOf } from '../src/locale/host.ts'

/**
 * 两族已知方法并集（`Object.getOwnPropertyNames(prototype)`，磁盘权威源
 * 枚举：全局 0.1.5-rc.1 / 仓库 0.1.7-rc.2）。新家族允许是并集的子集；
 * 出现**未知名字**即红——settings 面变了，`localePreferenceOf` 与所有
 * `ctx.get('settings')` 消费点要重新核验。
 */
const KNOWN_SETTINGS_METHODS = [
  // 0.1.5-rc.1 face
  'bumpRevision', 'commit', 'describe', 'documentPath', 'emitDocumentUpdated', 'get',
  'installSection', 'isStopped', 'mutate', 'prepareDocument', 'publish', 'register',
  'replace', 'resolve', 'section', 'update', 'warnListenerFailure', 'warnWatcherFailure', 'write',
  // 0.1.7-rc.2 face (SettingsForms)
  'configure', 'importLegacyDocument', 'invalidate', 'schema', 'writable',
] as const

const face = SettingsForms.prototype as unknown as Record<string, unknown>
const faceNames = Object.getOwnPropertyNames(SettingsForms.prototype).filter(name => name !== 'constructor').sort()

test('settings 面方法名 ⊆ 两族已知并集——上游改面先在这里红（家族自适应 floor）', () => {
  const unknown = faceNames.filter(name => !(KNOWN_SETTINGS_METHODS as readonly string[]).includes(name))
  assert.deepEqual(
    unknown,
    [],
    `@deepseek-ai/dsh-settings 的服务面出现了未知方法 [${unknown.join(', ')}]——`
      + 'settings 面变了：重新核验 localePreferenceOf（src/locale/host.ts）与所有 ctx.get("settings") 消费点，'
      + '并把新名字补进 KNOWN_SETTINGS_METHODS（磁盘权威源：全局安装 / 仓库 node_modules）',
  )
})

test('UPSTREAM-8 崩坏复现：真实安装的 settings 面没有 get 时，localePreferenceOf 不抛且回退 undefined', () => {
  if (typeof face.get === 'function') {
    assert.ok(true, '本安装家族的 settings 面仍有 get（0.1.5 线）——无 get 分支不适用；调用路径由 locale-host fixture 覆盖')
    return
  }
  assert.equal(typeof face.get, 'undefined')
  assert.doesNotThrow(() => localePreferenceOf(face))
  assert.equal(localePreferenceOf(face), undefined)
  assert.equal(localeOf(localePreferenceOf(face)), 'en')
})

test('UPSTREAM-8 崩坏复现：真实安装的 settings 面没有 get 时，hostLocaleOf 的 t() 端到端不抛', async () => {
  if (typeof face.get === 'function') {
    assert.ok(true, '本安装家族的 settings 面仍有 get（0.1.5 线）——跳过（fixture 覆盖）')
    return
  }
  const { hostLocaleOf } = await import('../src/locale/host.ts')
  const ctx = { get: (name: string) => (name === 'settings' ? face : undefined) }
  const locale = hostLocaleOf(ctx as never)
  assert.equal(locale.active(), 'en')
  const text = locale.t('tool.output.exitCode', { code: 1 })
  assert.equal(typeof text, 'string')
  assert.ok(text.length > 0)
})
