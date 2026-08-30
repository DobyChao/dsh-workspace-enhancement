/**
 * t5 宿主消息目录单测：zh/en 双语键集严格相等（zh 为键集真源、en 编译校验完整）、
 * 键完整性（所有键在中英双语下均为非空字符串）、语言解析回退链
 * （settings.locale.preference ?? en，settings 可选、非法值防御性收窄）、
 * 纯 lookup（`dsw-active → dsw-en → 键本身` + {name} 模板插值）、
 * hostLocaleOf 每次求值即时读（无缓存无订阅）、localizeTool 描述/参数 getter
 * 随语言切换取词（路线 B 的机制层验证）。
 * @module test/locale-host
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { zh, en, lookup, type DswKey } from '../src/locale/index.ts'
import { hostLocaleOf, localeOf, localizeTool } from '../src/locale/host.ts'

/* ------------------------------------------------------ 1) 双语键集严格相等 */

test('zh/en 键集严格相等（en 由 Record<DswKey,string> 编译校验，此处再运行时锁定）', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.ok(zhKeys.length > 0, 'zh 词典不能为空')
  assert.equal(zhKeys.length, enKeys.length, 'zh/en 键数必须一致')
  assert.deepEqual(zhKeys, enKeys, 'zh/en 键集必须完全相同（缺键/多键都是漏译或漂移）')
})

test('键完整性：每个键在 zh 与 en 下都是非空字符串', () => {
  for (const key of Object.keys(zh) as DswKey[]) {
    const z = zh[key]
    const e = en[key]
    assert.ok(typeof z === 'string' && z.trim().length > 0, `zh[${key}] 为空`)
    assert.ok(typeof e === 'string' && e.trim().length > 0, `en[${key}] 为空`)
  }
})

test('键命名符合 <surface>.<scope>.<item> 形态（surface 全小写，后续段 camelCase/点号分层）', () => {
  for (const key of Object.keys(zh)) {
    assert.match(key, /^[a-z]+(\.[a-zA-Z0-9_]+)+$/, `键名不符合规范：${key}`)
    assert.ok(!key.startsWith('workspace.'), `键名不得带 workspace. 前缀（属命名空间 dsw）：${key}`)
  }
})

/* ------------------------------------------------- 2) 语言解析回退链（纯函数） */

test('localeOf：仅字面量 "zh" 选中中文，其余一律回退 en（防御性收窄）', () => {
  assert.equal(localeOf('zh'), 'zh')
  assert.equal(localeOf('en'), 'en')
  assert.equal(localeOf(undefined), 'en')
  assert.equal(localeOf('fr'), 'en')
  assert.equal(localeOf(''), 'en')
  assert.equal(localeOf(42), 'en')
  assert.equal(localeOf(null), 'en')
})

test('lookup：查找链 dsw-active → dsw-en → 键本身', () => {
  const sample = Object.keys(zh)[0] as DswKey
  assert.equal(lookup('zh', sample), zh[sample])
  assert.equal(lookup('en', sample), en[sample])
  // 键本身兜底：缺失键返回键名（运行时防御，类型层已禁止）
  assert.equal(lookup('en', 'does.not.exist' as DswKey), 'does.not.exist')
  assert.equal(lookup('zh', 'does.not.exist' as DswKey), 'does.not.exist')
})

test('lookup：{name} 模板插值（框架同规：占位符缺参保留原文）', () => {
  assert.equal(lookup('zh', 'flow.badge.jump', { n: 3 }), '跳板 ×3')
  assert.equal(lookup('en', 'flow.badge.jump', { n: 3 }), '3-hop jump')
  assert.equal(lookup('zh', 'flow.badge.jump'), '跳板 ×{n}')
  assert.equal(lookup('zh', 'flow.connection.delete.title', { label: '不存在的参数' }), '删除连接')
  assert.equal(lookup('en', 'tool.sw_connect.error.connectFailed', { host: 'c1', detail: 'timeout' }), 'sw_connect: cannot connect to c1 — timeout')
  assert.equal(lookup('zh', 'tool.sw_connect.error.connectFailed', { host: 'c1', detail: 'timeout' }), 'sw_connect: 无法连接 c1 — timeout')
})

/* --------------------------------------------- 3) hostLocaleOf：可选服务 + 即时读 */

interface FakeSettings {
  preference?: unknown
}

function fakeContext(settings?: FakeSettings): Context & { reads: Array<[string, boolean | undefined]> } {
  const reads: Array<[string, boolean | undefined]> = []
  const ctx = {
    reads,
    get(name: string, strict?: boolean): unknown {
      reads.push([name, strict])
      if (name === 'settings') {
        if (settings === undefined) return undefined
        return {
          get(namespace: string): { preference?: unknown } | undefined {
            return namespace === 'locale' ? { preference: settings.preference } : undefined
          },
        }
      }
      return undefined
    },
  }
  return ctx as unknown as Context & { reads: Array<[string, boolean | undefined]> }
}

test('hostLocaleOf：settings 缺失时定格 en（平安回退）', () => {
  const ctx = fakeContext()
  const locale = hostLocaleOf(ctx)
  assert.equal(locale.active(), 'en')
  assert.equal(locale.t('status.unknown'), en['status.unknown'])
})

test('hostLocaleOf：preference zh/en 生效，非法值回退 en', () => {
  assert.equal(hostLocaleOf(fakeContext({ preference: 'zh' })).active(), 'zh')
  assert.equal(hostLocaleOf(fakeContext({ preference: 'en' })).active(), 'en')
  assert.equal(hostLocaleOf(fakeContext({ preference: 'fr' })).active(), 'en')
})

test('hostLocaleOf：t 按当前语言取词（zh→中文、en→英文）', () => {
  const zhLocale = hostLocaleOf(fakeContext({ preference: 'zh' }))
  assert.equal(zhLocale.t('side.mount'), '挂载')
  assert.equal(zhLocale.t('tool.sw_status.ping.ok', { prefix: 'u@h:22', outcome: 'echo ok' }), 'Ping: 正常 — u@h:22 (echo ok)')
  const enLocale = hostLocaleOf(fakeContext({ preference: 'en' }))
  assert.equal(enLocale.t('side.mount'), 'Mount')
  assert.equal(enLocale.t('tool.sw_status.ping.ok', { prefix: 'u@h:22', outcome: 'echo ok' }), 'Ping: OK — u@h:22 (echo ok)')
})

test('hostLocaleOf：每次求值即时读（无缓存无订阅）——settings 变更后下一读即新语言', () => {
  const settings: FakeSettings = { preference: 'zh' }
  const locale = hostLocaleOf(fakeContext(settings))
  assert.equal(locale.active(), 'zh')
  settings.preference = 'en'
  assert.equal(locale.active(), 'en', '切换语言后下一次读取必须立即生效')
  settings.preference = undefined
  assert.equal(locale.active(), 'en', 'preference 清空回退 en')
})

test('hostLocaleOf：只读 ctx.settings 可选服务（ctx.get 判空、非 inject），不读其他字段', () => {
  const ctx = fakeContext({ preference: 'zh' })
  const locale = hostLocaleOf(ctx)
  void locale.active()
  assert.deepEqual(ctx.reads, [['settings', false]], 'hostLocaleOf 只能通过 ctx.get("settings", false) 访问，且不读其他服务')
})

/* --------------------------------------------- 4) localizeTool：getter 机制层 */

test('localizeTool：description/parameters getter 每次访问按当前语言取词', () => {
  const settings: FakeSettings = { preference: 'zh' }
  const locale = hostLocaleOf(fakeContext(settings))
  const tool = {
    name: 'sw_test',
    description: 'baseline zh',
    parameters: {},
    output: { schema: { type: 'string', required: true }, render: () => [{ type: 'text', text: '' }] },
    execute: async () => ({}),
  } as unknown as ToolDefinition
  const localized = localizeTool(tool, locale, {
    descriptionKey: 'tool.sw_connect.description',
    buildParams: t => ({
      path: { type: 'string', required: true, description: t('tool.sw_pick_workspace.param.path') },
    }),
  })
  assert.equal(localized.description, zh['tool.sw_connect.description'])
  assert.equal(localized.parameters.properties?.path?.description, '远程目录绝对路径，如 /home/dev/code/project')
  settings.preference = 'en'
  assert.equal(localized.description, en['tool.sw_connect.description'])
  const params = localized.parameters as { properties: { path: { description: string } } }
  assert.equal(params.properties.path.description, 'Absolute remote directory path, e.g. /home/dev/code/project')
})
