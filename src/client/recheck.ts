/**
 * Whether the manual re-check control is on screen (UX-13).
 *
 * A settled result used to drop the button: reachable hid it, and the session
 * header never had one. It stays for every reachability state — checking,
 * reachable, and unreachable — so the operator can probe again without
 * waiting out backoff.
 * @module dsh-workspace-enhancement/client/recheck
 */

import type { ConnState } from './conn-state.ts'

/**
 * The re-check button is rendered for this state.
 * @param _state - the current reachability state (every value keeps the button).
 */
export function recheckStaysVisible(_state: ConnState): boolean {
  return true
}

/** Dictionary key of the session-header re-check label (「重新检测」 / Re-check). */
export function headerRecheckLabelKey(): 'status.retryAction.recheck' {
  return 'status.retryAction.recheck'
}
