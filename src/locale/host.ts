/**
 * Host-side i18n face: the host language resolution rule and the stateless
 * `HostLocale` translator. Tool schemas are English constants (UX-6); this
 * face is for execution errors and rendered output.
 *
 * Design (drafts/i18n-design.md §4.1, §6.2-§6.3): the host reads the persisted
 * language live from the optional `settings` service — `ctx.get('settings')?
 * .get('locale')?.preference ?? 'en'` — on EVERY evaluation, with no cache and
 * no subscription. The client is the only writer of that preference (the
 * settings page Language row), so a language switch is picked up by the next
 * prompt assembly / error render without restart. Tool schemas are fixed English
 * (UX-6); only execution errors re-read this preference.
 *
 * `settings` stays OPTIONAL: a composition without the service (or without the
 * `locale` namespace registered) falls back to 'en' — the framework's own
 * FALLBACK_LOCALE semantics, mirroring dsh-client-locale's host half.
 *
 * Security: this module reads only the leaf `preference` field and never
 * touches credentials; translation templates carry leaf values only.
 * @module src/locale/host
 */

import type { Context } from '@deepseek-ai/cordis'
import { lookup, type DswKey, type LocaleId } from './index.ts'

/** Minimal structural face of the optional `settings` service (dsh-settings). */
export interface HostLocaleSettings {
  /** Resolve one registered settings namespace (here: `locale`). */
  get(namespace: string): { preference?: unknown } | undefined
}

/** Minimal structural face of a `ctx.get('settings')` value. */
type SettingsService = HostLocaleSettings

/**
 * Pure language resolution: defensive narrowing of the raw persisted
 * preference. Only the literal `'zh'` selects Chinese; every other value
 * (undefined, unset, future schema values, junk) falls back to `'en'` —
 * the framework's FALLBACK_LOCALE semantics.
 * @param preference - the raw `locale.preference` value from settings.
 */
export function localeOf(preference: unknown): LocaleId {
  return preference === 'zh' ? 'zh' : 'en'
}

/** The host translate face: read the language on every call, translate via the `dsw` dictionary. */
export interface HostLocale {
  /** Current host language, resolved live from the optional settings service. */
  active(): LocaleId
  /** Translate one `dsw` key with the host language resolved NOW (no cache). */
  t(key: DswKey, params?: Record<string, unknown>): string
}

/**
 * Build the host locale face for a mounting context. `settings` is optional
 * (`ctx.get` — never `inject`): no settings service, or no `locale` namespace,
 * means the fallback 'en'. Reads the leaf `preference` field only.
 * @param ctx - the host Cordis context.
 */
export function hostLocaleOf(ctx: Context): HostLocale {
  const settings = ctx.get('settings', false) as SettingsService | undefined
  return {
    active: () => localeOf(settings?.get('locale')?.preference),
    t: (key, params) => lookup(localeOf(settings?.get('locale')?.preference), key, params),
  }
}

