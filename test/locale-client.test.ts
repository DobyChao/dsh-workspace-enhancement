/**
 * Client locale infrastructure tests (t4): the zh/en dictionary pair must stay
 * strictly key-aligned (zh = key-set source of truth), the pure `lookup()`
 * must implement the documented fallback chain and `{name}` interpolation,
 * and the apply-level `registerDswLocale` wiring must register the `dsw`
 * namespace exactly once inside an effect whose disposer removes it (with the
 * framework's duplicate-registration guard and idempotent-disposer contract
 * simulated by a faithful mini LocaleRuntime; see drafts/i18n-contracts.md §1).
 * @module test/locale-client
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type DswKey, en, lookup, registerDswLocale, zh } from '../src/locale/index.ts'

/** The machine-parseable markers that must stay byte-identical (design §13.1). */
const BYTE_IDENTICAL_KEYS = [
  'tool.output.dropped',
  'tool.output.truncated',
  'tool.output.stderrMarker',
  'tool.output.timedOut',
  'tool.output.killedSignal',
  'tool.output.exitCode',
] as const

/**
 * Minimal LocaleRuntime clone with the documented contract: `locale.register`
 * throws on a duplicate (ns, locale) pair, its disposer is idempotent and
 * removes the dictionaries, and `effect` captures the factory's disposer for
 * teardown. Purposely tiny — the framework's own runtime is not testable
 * outside the browser bundle.
 */
class MiniLocaleRuntime {
  private readonly dicts = new Map<string, Record<'zh' | 'en', Record<string, string>>>()
  private readonly effects: Array<() => void> = []

  /** The `locale` service face the plugin consumes (`ctx.locale`). */
  readonly locale: {
    register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  } = {
    register: (ns, dicts) => {
      for (const l of ['zh', 'en'] as const) {
        if (this.dicts.has(`${ns}\u0000${l}`)) {
          throw new Error(`duplicate locale registration: ${ns}/${l}`)
        }
      }
      this.dicts.set(`${ns}\u0000zh`, dicts.zh)
      this.dicts.set(`${ns}\u0000en`, dicts.en)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        this.dicts.delete(`${ns}\u0000zh`)
        this.dicts.delete(`${ns}\u0000en`)
      }
    },
  }

  effect(fn: () => unknown, _label?: string): unknown {
    const result = fn()
    this.effects.push(() => {
      if (typeof result === 'function') (result as () => void)()
    })
    return null
  }

  teardown(): void {
    for (const dispose of this.effects.splice(0)) dispose()
  }

  isRegistered(ns: string): boolean {
    return this.dicts.has(`${ns}\u0000zh`) && this.dicts.has(`${ns}\u0000en`)
  }
}

test('zh and en dictionaries share exactly the same key set', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.ok(zhKeys.length > 0, 'the dictionary must not be empty')
  assert.deepEqual(zhKeys, enKeys)
})

test('zh is the key source of truth: every key resolves in both languages', () => {
  for (const key of Object.keys(zh) as DswKey[]) {
    assert.equal(typeof en[key], 'string', `en must carry ${key}`)
    assert.ok(en[key].length > 0, `en value of ${key} must not be empty`)
  }
})

test('machine-parseable markers are byte-identical across languages', () => {
  for (const key of BYTE_IDENTICAL_KEYS) {
    assert.equal(zh[key], en[key], `${key} must stay byte-identical`)
  }
})

test('zh and en templates reference the same {param} names', () => {
  const paramsOf = (template: string): string[] =>
    [...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
  for (const key of Object.keys(zh) as DswKey[]) {
    assert.deepEqual(paramsOf(zh[key]), paramsOf(en[key]), `param drift on ${key}`)
  }
})

test('lookup applies the active → en → key fallback chain', () => {
  assert.equal(lookup('zh', 'flow.title'), '选择工作区目录')
  assert.equal(lookup('en', 'form.title'), 'New remote connection')
  // Active locale wins; every key resolves in both languages.
  assert.equal(lookup('en', 'flow.title'), 'Choose a workspace directory')
  // Unknown key falls back to the key itself in both languages.
  assert.equal(lookup('zh', 'never.defined.key' as DswKey), 'never.defined.key')
  assert.equal(lookup('en', 'never.defined.key' as DswKey), 'never.defined.key')
})

test('lookup interpolates {name} params and keeps unknown placeholders', () => {
  assert.equal(lookup('zh', 'flow.empty.hidden', { n: 3 }), '另有 3 个点开头的文件夹未显示')
  assert.equal(lookup('en', 'flow.empty.hidden', { n: 3 }), '3 more dot-prefixed folders are hidden')
  assert.equal(lookup('zh', 'flow.empty.hidden', {}), '另有 {n} 个点开头的文件夹未显示')
  assert.equal(
    lookup('en', 'tool.sw_status.outputs.host', { u: 'root', h: 'c1', p: 22, source: ' (source: machine)' }),
    'Remote host: root@c1:22 (source: machine)',
  )
  // Values are stringified; a missing param leaves the placeholder intact.
  assert.equal(lookup('zh', 'tool.sw_status.outputs.host', { u: 'root', h: 'c1', p: 22 }), '远程主机：root@c1:22{source}')
})

test('registerDswLocale registers the dsw namespace once, effect-bound', () => {
  const runtime = new MiniLocaleRuntime()
  registerDswLocale(runtime)
  assert.ok(runtime.isRegistered('dsw'), 'dsw dictionaries must be registered')
})

test('registerDswLocale against the same runtime twice throws (framework duplicate guard)', () => {
  const runtime = new MiniLocaleRuntime()
  registerDswLocale(runtime)
  assert.throws(() => registerDswLocale(runtime), /duplicate locale registration/)
})

test('the effect disposer removes the dictionaries and is idempotent', () => {
  const runtime = new MiniLocaleRuntime()
  registerDswLocale(runtime)
  assert.ok(runtime.isRegistered('dsw'))
  runtime.teardown()
  assert.ok(!runtime.isRegistered('dsw'), 'teardown must remove the registration')
  runtime.teardown()
  // After disposal a fresh registration succeeds (no stale state).
  registerDswLocale(runtime)
  assert.ok(runtime.isRegistered('dsw'))
})

test('a registered dictionary answers the same translations as lookup', () => {
  const runtime = new MiniLocaleRuntime()
  registerDswLocale(runtime)
  // The runtime keeps the dictionary referenced by the registration; both
  // languages must translate the framework chains to the lookup result.
  assert.equal((runtime as unknown as { dicts: Map<string, Record<'zh' | 'en', Record<string, string>>> }).dicts.get('dsw\u0000zh')?.['flow.title'], zh['flow.title'])
  assert.equal((runtime as unknown as { dicts: Map<string, Record<'zh' | 'en', Record<string, string>>> }).dicts.get('dsw\u0000en')?.['flow.title'], en['flow.title'])
})
