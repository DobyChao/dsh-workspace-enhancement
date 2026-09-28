/**
 * Host-side i18n face: the host language resolution rule and the stateless
 * `HostLocale` translator. Tool schemas are English constants (UX-6); this
 * face is for execution errors and rendered output.
 *
 * Design (drafts/i18n-design.md §4.1, §6.2-§6.3): the host reads the persisted
 * language live from the optional `settings` service on EVERY evaluation, with
 * no cache and no subscription. The client is the only writer of that
 * preference (the settings page Language row), so a language switch is picked
 * up by the next prompt assembly / error render without restart. Tool schemas
 * are fixed English (UX-6); only execution errors re-read this preference.
 *
 * The read is FAMILY-ADAPTIVE (UPSTREAM-8): the 0.1.5 `settings` service
 * exposed `get('locale').preference`; the 0.1.7 family rewrote the service as
 * `SettingsForms` (describe/update/replace/mutate) with no namespace reader,
 * and its `describe()` walks every profile entry with revision side effects —
 * a configuration-UI read, not a per-render one. The 0.1.7 official tool faces
 * render their markers in hardcoded English (`(no output)`, `[exit code: N]`),
 * so the honest per-family answer there is the 'en' fallback
 * (framework FALLBACK_LOCALE semantics), never a thrown render.
 *
 * `settings` stays OPTIONAL: a composition without the service (or without the
 * `locale` namespace registered) falls back to 'en'.
 *
 * Security: this module reads only the leaf `preference` field and never
 * touches credentials; translation templates carry leaf values only.
 * @module src/locale/host
 */

import type { Context } from '@deepseek-ai/cordis'
import { lookup, type DswKey, type LocaleId } from './index.ts'

/** Minimal structural face of the optional `settings` service (dsh-settings ≤ 0.1.5-rc). */
export interface HostLocaleSettings {
  /** Resolve one registered settings namespace (here: `locale`). */
  get(namespace: string): { preference?: unknown } | undefined
}

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
 * Read the locale preference off a raw `ctx.get('settings')` value, defensively
 * across host families. Only the 0.1.5 namespace-reader shape is read; a
 * settings service WITHOUT a `get` function (the 0.1.7 `SettingsForms` rewrite)
 * yields `undefined` → 'en' instead of the TypeError that used to break every
 * localized render (UPSTREAM-8).
 * @param settings - the raw settings service value, whatever family provided it.
 */
export function localePreferenceOf(settings: unknown): unknown {
  if (typeof settings !== 'object' || settings === null) return undefined
  if (typeof (settings as HostLocaleSettings).get !== 'function') return undefined
  return (settings as HostLocaleSettings).get('locale')?.preference
}

/**
 * Build the host locale face for a mounting context. `settings` is optional
 * (`ctx.get` — never `inject`): no settings service, no `locale` namespace, or
 * a 0.1.7-family service without the namespace reader all mean the fallback
 * 'en'. Reads the leaf `preference` field only.
 * @param ctx - the host Cordis context.
 */
export function hostLocaleOf(ctx: Context): HostLocale {
  const settings: unknown = ctx.get('settings', false)
  return {
    active: () => localeOf(localePreferenceOf(settings)),
    t: (key, params) => lookup(localeOf(localePreferenceOf(settings)), key, params),
  }
}

