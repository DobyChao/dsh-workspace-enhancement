/**
 * REQ-I5: settings-page copy for a core.deploy / core.status payload.
 * Logic lives here so `settings.tsx` stays view-only (sandbox tests skip `.tsx`).
 * REQ-I29: the fence tier rides along — a `none` tier gets its own guidance
 * line instead of hiding behind a green version badge.
 *
 * @module dsh-workspace-enhancement/client/core-status
 */

import type { FenceTierView } from '../core-deploy.ts'
import { BWRAP_VENDOR } from '../core-vendor-pins.ts'

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
  | 'settings.core.fenceNone.title'
  | 'settings.core.fenceNone.summary'
  | 'settings.core.fenceNone.causeMissing'
  | 'settings.core.fenceNone.causeUnusable'
  | 'settings.core.fenceNone.readOnly'
  | 'settings.core.fenceNone.ways'
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
      const cause = fence.bwrapProbeErr !== undefined && fence.bwrapProbeErr !== ''
        ? t('settings.core.fenceNone.causeUnusable', { reason: fence.bwrapProbeErr })
        : t('settings.core.fenceNone.causeMissing')
      return [
        t('settings.core.fenceNone.title', { version: view.version, arch }),
        t('settings.core.fenceNone.summary'),
        cause,
        t('settings.core.fenceNone.readOnly'),
        t('settings.core.fenceNone.ways'),
        ...BWRAP_VENDOR.installHints,
      ].join('\n')
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

/** Chip tone for a status or deploy payload. A live core with no sandbox is a warning. */
export function coreStatusTone(view: CoreStatusPayload): 'ok' | 'warn' | 'error' {
  if (view.ok === true) return view.fence?.tier === 'none' ? 'warn' : 'ok'
  const detail = typeof view.detail === 'string' ? view.detail : ''
  return coreFailureIsArchRefusal(detail) ? 'warn' : 'error'
}

/**
 * Deploy result banner. A core that cannot enforce a sandbox is not a
 * success, even though the binary itself installed.
 */
export function deployBannerKind(view: CoreStatusPayload): 'success' | 'warn' | 'error' {
  if (view.ok !== true) return 'error'
  return view.fence?.tier === 'none' ? 'warn' : 'success'
}
