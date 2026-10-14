/**
 * REQ-I5: settings-page copy for a core.deploy / core.status payload.
 * Logic lives here so `settings.tsx` stays view-only (sandbox tests skip `.tsx`).
 * REQ-I29: the fence tier rides along — a `none` tier gets its own guidance
 * line instead of hiding behind a green version badge.
 *
 * @module dsh-workspace-enhancement/client/core-status
 */

import type { FenceTierView } from '../core-deploy.ts'

export interface CoreStatusPayload {
  ok?: boolean
  version?: string
  arch?: string
  proto?: number
  caps?: readonly string[]
  sandbox?: string
  fence?: FenceTierView | undefined
  detail?: string
}

export type CoreStatusLabelKey =
  | 'settings.core.ok'
  | 'settings.core.okFenced'
  | 'settings.core.okDegraded'
  | 'settings.core.fenceNone'
  | 'settings.core.missing'
  | 'settings.core.unsupported'

/** One-line status for the settings machine row. */
export function coreStatusLabel(
  view: CoreStatusPayload,
  t: (key: CoreStatusLabelKey, params?: Record<string, unknown>) => string,
): string {
  if (view.ok === true && typeof view.version === 'string' && view.version !== '') {
    const arch = typeof view.arch === 'string' && view.arch !== '' ? ` ${view.arch}` : ''
    const fence = view.fence
    if (fence?.tier === 'none') {
      // The core is fine; the FENCE is not — that distinction is the line.
      return t('settings.core.fenceNone', { version: view.version, arch, detail: view.detail ?? '' })
    }
    if (fence?.tier === 'landlock') {
      return t('settings.core.okDegraded', { version: view.version, arch, abi: fence.landlockAbi ?? 0 })
    }
    if (fence?.tier === 'bwrap') {
      return t('settings.core.okFenced', { version: view.version, arch })
    }
    return t('settings.core.ok', { version: view.version, arch })
  }
  const detail = typeof view.detail === 'string' && view.detail !== '' ? view.detail : ''
  if (coreFailureIsArchRefusal(detail)) {
    return t('settings.core.unsupported', { detail })
  }
  return t('settings.core.missing', { detail: detail === '' ? '—' : detail })
}

/**
 * An architecture refusal (no core for this kernel/machine), as opposed to a
 * generic failure that happens to mention "linux".
 */
export function coreFailureIsArchRefusal(detail: string): boolean {
  return /uname|linux only|no build for this architecture/i.test(detail)
}

/** Deploy result banner: only a live core is success (UX-12). */
export function deployBannerKind(view: CoreStatusPayload): 'success' | 'error' {
  return view.ok === true ? 'success' : 'error'
}
