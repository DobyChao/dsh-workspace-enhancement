/**
 * REQ-I5: settings-page copy for a core.deploy / core.status payload.
 * Logic lives here so `settings.tsx` stays view-only (sandbox tests skip `.tsx`).
 *
 * @module dsh-workspace-enhancement/client/core-status
 */

export interface CoreStatusPayload {
  ok?: boolean
  version?: string
  arch?: string
  proto?: number
  caps?: readonly string[]
  sandbox?: string
  detail?: string
}

/** One-line status for the settings machine row. */
export function coreStatusLabel(
  view: CoreStatusPayload,
  t: (key: 'settings.core.ok' | 'settings.core.missing' | 'settings.core.unsupported', params?: Record<string, unknown>) => string,
): string {
  if (view.ok === true && typeof view.version === 'string' && view.version !== '') {
    const arch = typeof view.arch === 'string' && view.arch !== '' ? ` ${view.arch}` : ''
    return t('settings.core.ok', { version: view.version, arch })
  }
  const detail = typeof view.detail === 'string' && view.detail !== '' ? view.detail : ''
  if (/linux|x86_64|amd64|uname/i.test(detail)) {
    return t('settings.core.unsupported', { detail })
  }
  return t('settings.core.missing', { detail: detail === '' ? '—' : detail })
}
