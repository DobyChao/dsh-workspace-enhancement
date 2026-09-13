/**
 * REQ-I9 (ADR-0022 D1): the machine-list fence badge projection, in its own
 * `.ts` module for the same reason `route-id.ts` exists — the sandbox test
 * runner uses Node's built-in type stripping and cannot load `.tsx`, not even
 * transitively, so a helper that lived in `row-badges.ts` (which imports
 * `status.tsx` for its view type) would be invisible to `npm run test:agent`.
 * `row-badges.ts` re-exports it, so the badge surface keeps ONE implementation.
 *
 * Zero migration is the whole contract here: `'off'` — the default, and every
 * machine record that predates the field — renders the EMPTY string, so an
 * upgraded settings page shows exactly what it showed before.
 *
 * @module dsh-workspace-enhancement/client/sandbox-badge
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteSandboxMode } from '../remote-sandbox.ts'

/**
 * The fence badge text of one machine row.
 * @param mode - the machine view's fence mode (untrusted wire value; an older
 *   host that never sends the key passes `undefined`).
 * @param t - the translate seat (active language).
 * @returns the localized badge text, or `''` when nothing should be rendered.
 */
export function sandboxBadgeOf(mode: RemoteSandboxMode | undefined, t: TranslateNS<'dsw'>): string {
  const normalized: RemoteSandboxMode = mode === 'read-only' || mode === 'workspace-write' ? mode : 'off'
  return normalized === 'off' ? '' : t('settings.machines.sandboxBadge', { mode: normalized })
}
