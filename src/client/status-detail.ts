/**
 * Tooltip text for a reachability badge (UX-13).
 *
 * A stored host-key mismatch stays 不可连接 / Unreachable, and its detail is
 * the locale phrase for a changed key. Any other failure message is shown as
 * returned. An empty message falls back to the state label.
 * @module dsh-workspace-enhancement/client/status-detail
 */

import { isHostKeyChangedMessage } from '../host-key-changed.ts'

/**
 * Detail string for one status view.
 * @param message - wire `message`, possibly the host-key marker.
 * @param fallback - state label, or another title, when there is no detail.
 * @param hostKeyChanged - already translated 「主机密钥已变更」 / "Host key changed".
 */
export function statusTooltip(message: string | undefined, fallback: string, hostKeyChanged: string): string {
  if (isHostKeyChangedMessage(message)) return hostKeyChanged
  if (message !== undefined && message !== '') return message
  return fallback
}
