/**
 * BUG-24: a subagent's permission chip.
 *
 * The host pins delegated approval to `never` and copies a preset name only
 * for `auto` and `danger-full-access`. Workspace Write is sandbox
 * `workspace-write` plus approval `ask`, so the derived value becomes
 * `custom` and the chip says Custom.
 *
 * When that custom value is only the pinned approval, and the sandbox still
 * matches a named preset, report that preset. Full access already pairs with
 * `never`, so its derived name is left alone. Approval is not put back to
 * `ask` — the host pin is what stops the subagent from prompting.
 *
 * @module dsh-workspace-enhancement/delegated-preset
 */

import type { Context } from '@deepseek-ai/cordis'

/** The knobs `permissionPresets.derive` reads. */
export interface DelegatedPermissionState {
  preset?: string | null
  sandbox?: string | null
  approval?: string | null
}

/** The sandbox half of one named preset. */
export interface DelegatedPresetSpec {
  sandbox?: string
}

const ALIASED = Symbol.for('dsw.delegatedPresetAlias')

/**
 * Replace a delegation-only `custom` with the preset whose sandbox matches.
 * Any other custom value (including a sandbox that matches nothing) stays
 * `custom`.
 */
export function delegatedPresetName(
  derived: string,
  state: DelegatedPermissionState,
  presets: Readonly<Record<string, DelegatedPresetSpec>>,
): string {
  if (derived !== 'custom' || state.approval !== 'never' || typeof state.sandbox !== 'string') return derived
  for (const [name, spec] of Object.entries(presets)) {
    if (spec?.sandbox === state.sandbox) return name
  }
  return derived
}

interface PermissionPresetService {
  derive: (state: DelegatedPermissionState) => string
  presets?: Readonly<Record<string, DelegatedPresetSpec>>
  [ALIASED]?: boolean
}

/** Point the live `permissionPresets.derive` at {@link delegatedPresetName}. */
export function installDelegatedPresetAlias(ctx: Context): void {
  const applyAlias = (service: unknown): void => {
    if (typeof service !== 'object' || service === null) return
    const face = service as PermissionPresetService
    if (face[ALIASED] === true || typeof face.derive !== 'function' || face.presets === undefined) return
    const original = face.derive.bind(face)
    const presets = face.presets
    face.derive = (state) => delegatedPresetName(original(state), state, presets)
    face[ALIASED] = true
  }
  const current = ctx.get('permissionPresets', false)
  if (current !== undefined) applyAlias(current)
  if (typeof ctx.inject === 'function') {
    ctx.inject(['permissionPresets'], (owner: Context) => {
      applyAlias(owner.get('permissionPresets'))
    })
  }
}
