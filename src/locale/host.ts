/**
 * Host-side i18n face: the host language resolution rule, the stateless
 * `HostLocale` translator, and the tool-localization helper.
 *
 * Design (drafts/i18n-design.md §4.1, §6.2-§6.3): the host reads the persisted
 * language live from the optional `settings` service — `ctx.get('settings')?
 * .get('locale')?.preference ?? 'en'` — on EVERY evaluation, with no cache and
 * no subscription. The client is the only writer of that preference (the
 * settings page Language row), so a language switch is picked up by the next
 * prompt assembly / tool schema projection / error render without restart.
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
import type { ParameterSchemaSpec, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { lookup, type DswKey, type LocaleId, type TranslateFn } from './index.ts'

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

/** Localization spec for one tool: the description key plus a parameter-spec builder. */
export interface LocalizeToolSpec {
  /** Dictionary key of the tool-level description. */
  descriptionKey: DswKey
  /**
   * Rebuild the author-facing parameter schema (per-property descriptions
   * translated) for the CURRENT language. The framework's `defineTool`
   * compiles `parameters` once at registration; this builder feeds the
   * recompiled JSON Schema into the getter on every `schemas()` projection.
   */
  buildParams(t: TranslateFn): ParameterSchemaSpec
}

/**
 * Route-B localization (drafts/i18n-design.md §6.2): after `defineTool`, turn
 * `description` and `parameters` into getters that re-read the host language
 * on every access. `ctx.tools.register` holds the definition object by
 * reference and `schemas()` re-projects `description`/`parameters` per
 * assembly step — getters are the framework-recognized runtime-text mechanism
 * (official run_code precedent). Language is resolved at getter evaluation
 * time, so a switch takes effect on the next step without re-registration.
 *
 * Validation keeps the registration-time baseline schema (constraints and
 * types unchanged — only description text is localized).
 * @param tool - a `defineTool` result.
 * @param locale - the host locale face (getters re-check on each access).
 * @param spec - description key + parameter-spec builder.
 * @returns the same tool definition (mutated in place), ready for `ctx.tools.register`.
 */
export function localizeTool(tool: ToolDefinition, locale: HostLocale, spec: LocalizeToolSpec): ToolDefinition {
  Object.defineProperty(tool, 'description', {
    get: () => locale.t(spec.descriptionKey),
  })
  Object.defineProperty(tool, 'parameters', {
    get: () => parameterSchemaSpecToJsonSchema(spec.buildParams(locale.t)) as unknown as Record<string, unknown>,
  })
  return tool
}
