/**
 * Wire marker for a reachability probe whose stored host key did not match.
 * The status state stays `offline` (不可连接). The client translates this
 * marker into 「主机密钥已变更」 / "Host key changed" so it is not shown as a
 * network failure.
 * @module dsh-workspace-enhancement/host-key-changed
 */

/** `view.message` / error text when a known host key mismatches. */
export const HOST_KEY_CHANGED = 'host-key-changed'

/** Whether a probe failure is a known-host-key mismatch. */
export function isHostKeyChangedMessage(message: string | undefined): boolean {
  return message === HOST_KEY_CHANGED || message === `dsw: ${HOST_KEY_CHANGED}`
}

/**
 * Error a connect rewriter should throw for a host-key outcome.
 * A changed key is the stable marker. Any other recorded failure keeps its
 * own text. `null` means the failure was not a host-key rejection.
 */
export function hostKeyConnectError(
  failure: 'changed' | 'unknown' | null,
  lastError: string | null,
): Error | null {
  if (failure === 'changed') return new Error(`dsw: ${HOST_KEY_CHANGED}`)
  if (lastError !== null && lastError !== '') return new Error(`dsw: ${lastError}`)
  return null
}

/** Collapse a probe rejection into the secret-free status `message`. */
export function probeFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return isHostKeyChangedMessage(raw) ? HOST_KEY_CHANGED : raw
}
