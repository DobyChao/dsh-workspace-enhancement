/**
 * `dsw` locale dictionary exports — shared by the client half (registered as
 * namespace `dsw` through `ctx.locale`) and the host half (`src/locale/host.ts`).
 *
 * Exported here (all platform-neutral, no framework value imports): the ZH/EN
 * dictionaries, the `DswKey` type, the pure `lookup()` translator used by the
 * host side, and the `registerDswLocale` client wiring primitive. This module
 * is internal — it is NOT re-exported from `src/index.ts` (the plugin's public
 * entry keeps `exports` unchanged).
 * @module src/locale
 */

import { zh, type DswKey } from './dsw.ts'
import { en } from './dsw.en.ts'

export type { DswKey }
export { zh, en }

/** The two locales this dictionary supports (mirrors the framework's LOCALE_IDS). */
export type LocaleId = 'zh' | 'en'

/** Host-side translate function shape (also the `buildParams` callback type). */
export type TranslateFn = (key: DswKey, params?: Record<string, unknown>) => string

/**
 * Pure dictionary lookup with the same semantics as the framework chain,
 * minus the `common` step (the host dictionary is self-contained — see
 * drafts/i18n-design.md §2.3): `dsw-<active> → dsw-en → 键本身`.
 *
 * `{name}` placeholders are interpolated with the framework's rule: a
 * placeholder whose name exists in `params` is replaced by `String(value)`,
 * otherwise the placeholder text is kept verbatim.
 * @param locale - the active locale.
 * @param key - a key of the `dsw` namespace (compile-time checked).
 * @param params - leaf template values only; never secrets.
 */
export function lookup(locale: LocaleId, key: DswKey, params?: Record<string, unknown>): string {
  const template = locale === 'zh' ? (zh[key] ?? en[key]) : en[key]
  const text = template ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/**
 * The minimal context face the client dictionary wiring touches (structural):
 * cordis `ctx.effect` plus the framework LocaleRuntime `ctx.locale`. Kept
 * framework-free so this module stays testable in a plain Node context.
 */
export interface DswLocaleContext {
  /** Cordis `ctx.effect` — binds the registration disposer to the current fiber. */
  effect(fn: () => unknown, label?: string): unknown
  /** The framework locale runtime (`ctx.locale`, hard client dependency). */
  locale: {
    register(ns: 'dsw', dicts: { zh: Record<DswKey, string>; en: Record<DswKey, string> }): () => void
  }
}

/**
 * Client-side dictionary registration (drafts/i18n-design.md §9): one typed
 * `register('dsw', { zh, en })` call inside `ctx.effect`, so the registration
 * is disposed together with the plugin context. The framework register
 * returns an idempotent disposer and throws on a duplicate (ns, locale)
 * registration — a programming-error guard the caller (client apply) relies on.
 */
export function registerDswLocale(ctx: DswLocaleContext): void {
  ctx.effect(() => ctx.locale.register('dsw', { zh, en }), 'dsw: dictionaries')
}
