/**
 * REQ-I14/REQ-I21: remote-core provisioning.
 *
 * Policy since 2026-10-29 (`BUG-26`, revising the 2026-09-30 "always ask"
 * rule in ADR-0024 §3): a missing or stale core is deployed with no approval
 * card; a current core deploys nothing. Session sandbox mode does not skip
 * the ladder — danger-full-access still prefers `dsh-core serve --sandbox off`
 * once a core is installed. The channels:
 *
 *  1. **`sw_connect`** awaits {@link provisionRemoteCore} per reachable
 *     machine and reports the outcome in its own tool output — deployed /
 *     already current / failed, one line per machine.
 *  2. **First-use gap** ({@link createCoreGapAsker}): a confined open that
 *     fails on a verifiably missing/stale disk artifact deploys and the hub
 *     retries the open. A missing connection or a failed deploy returns
 *     false and the original refusal stands.
 *  3. **Background probe** ({@link createCoreWarmup}): the panel/channel
 *     connect paths only PROBE and warn. They do not upload; the next
 *     `sw_connect` or confined first use does.
 *
 * @module dsh-workspace-enhancement/core-provision
 */

import type { Context } from '@deepseek-ai/cordis'
import { CORE_ARTIFACT_VERSION, coreDiskCurrent } from './core-protocol.ts'
import { forgetCoreEffect } from './remote-component-context.ts'
import { deployCore } from './core-deploy.ts'
import type { CoreStatusView, CoreHub } from './core-hub.ts'
import type { SshTransport } from './transport.ts'

/* ------------------------------------------------------ connection warmup */

/** Faceted deps: everything the provision ladder needs, injectable in tests. */
export interface CoreWarmupDeps {
  /** The machine view of one route, or `undefined` (unknown id). */
  machine(id: string): { readonly id?: string } | undefined
  /** The live connection of one route — the deploy transport. */
  connection(id: string): SshTransport | undefined
  /** On-disk artifact probe (`CoreHub.status`). */
  status(id: string, signal?: AbortSignal): Promise<CoreStatusView>
  /** Upload + install (`deployCore`). */
  deploy(id: string, signal?: AbortSignal): Promise<CoreStatusView>
  /** Runs after a successful deploy (drop stale serves; clear blocked keys). */
  afterDeploy?(id: string): void
  /** Diagnostic sink for background failures (never gates anything). */
  warn?(text: string): void
}

/** What one synchronous provision run decided about one machine. */
export interface CoreProvisionOutcome {
  /** The machine id that was provisioned. */
  id: string
  /** `true` when nothing ran: unfenced/unknown machine, or hub-free composition. */
  skipped: boolean
  /** `true` when this run uploaded and installed a new artifact. */
  deployed: boolean
  /**
   * `true` when a caller reports that a needed deploy did not run.
   * Production no longer sets this (2026-10-29, BUG-26: deploys are not asked).
   */
  declined: boolean
  /** Post-action disk version (absent when the probe/install failed). */
  version: string | undefined
  /** Failure detail (deploy or probe); also set for skips that matter. */
  detail: string | undefined
}

/**
 * REQ-I21: one machine's synchronous provision — the status→deploy ladder
 * the `sw_connect` tool awaits and reports per machine. Never throws: a
 * failed deploy is an outcome, not an exception, so a broken remote can
 * never fail the connect itself (reads still work via SFTP).
 *
 * User policy (2026-10-29, BUG-26; the 2026-09-30 "always ask" rule is retired):
 *  - a missing or stale core is deployed with no approval card;
 *  - a current core deploys nothing;
 *  - session mode does not skip the caller. danger-full-access uses the core
 *    with `--sandbox off` when one is installed, and SFTP only as the fallback.
 *
 * Gating note: confinement that requires the core follows the SESSION
 * (`resolveRemoteSessionMode`, fail-safe `read-only` — ADR-0025), not any
 * per-machine field. Unknown machines are the only skip.
 */
export async function provisionRemoteCore(
  deps: CoreWarmupDeps,
  id: string,
  signal?: AbortSignal,
): Promise<CoreProvisionOutcome> {
  const machine = deps.machine(id)
  if (machine === undefined) return { id, skipped: true, deployed: false, declined: false, version: undefined, detail: 'unknown machine' }
  const status = await deps.status(id, signal)
  if (coreDiskCurrent(status)) {
    return { id, skipped: false, deployed: false, declined: false, version: status.version, detail: undefined }
  }
  const view = await deps.deploy(id, signal)
  if (view.ok) {
    deps.afterDeploy?.(id)
    return { id, skipped: false, deployed: true, declined: false, version: view.version ?? CORE_ARTIFACT_VERSION, detail: view.detail }
  }
  return { id, skipped: false, deployed: false, declined: false, version: undefined, detail: view.detail ?? 'deploy failed' }
}

/**
 * The background gap probe (REQ-I14's connect warmup): the panel/channel
 * connect paths do not upload. They only PROBE and warn, so the host log
 * names the machine the next `sw_connect` or confined first use will deploy.
 * Deduplicates per machine id like before.
 *
 * @returns the trigger; it never throws and never blocks the caller.
 */
export function createCoreWarmup(deps: CoreWarmupDeps): (id: string) => void {
  const inFlight = new Map<string, Promise<void>>()
  return (id: string): void => {
    if (inFlight.has(id)) return
    const run = (async (): Promise<void> => {
      if (deps.machine(id) === undefined) return
      const status = await deps.status(id)
      if (coreDiskCurrent(status)) return
      const found = status.ok ? status.version ?? 'unreadable version' : 'not installed'
      deps.warn?.(`dsw: core gap on ${id} (${found}); the next sw_connect or a confined first use will deploy it`)
    })()
      .catch(error => {
        deps.warn?.(`dsw: core warmup probe failed on ${id}: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { inFlight.delete(id) })
    inFlight.set(id, run)
  }
}

/* ------------------------------------------------ first-use gap deploy */

/**
 * The hub's gap resolver (REQ-I14, ask removed 2026-10-29, BUG-26): a confined
 * open that fails on a verifiably missing or stale disk artifact deploys the
 * shipped core and reports the gap solved, so the hub retries the open once.
 * A missing connection or a failed deploy returns `false` and the original
 * refusal stands. There is no approval card.
 *
 * @param hubOf - late-bound hub handle (the hub is still constructing when
 *   this resolver is handed to it); used to drop stale serves post-deploy.
 * @param deploy - the deploy call (injectable in tests; defaults to
 *   {@link deployCore} on the registry connection).
 */
export function createCoreGapAsker(
  ctx: Context,
  hubOf: () => CoreHub | undefined,
  deploy: (transport: SshTransport, signal?: AbortSignal) => Promise<CoreStatusView> = (transport, signal) =>
    deployCore(transport, signal !== undefined ? { signal } : {}),
): (connectionId: string, facts: { found: string | undefined; expected: string; signal?: AbortSignal | undefined }) => Promise<boolean> {
  const note = (text: string): void => {
    const logger = (ctx as { logger?: { warn?: (message: string) => void } }).logger
    try {
      logger?.warn?.(text)
    } catch {
      // A broken sink must not turn a failed deploy into a throw.
    }
  }
  return async (connectionId, facts): Promise<boolean> => {
    const registry = typeof ctx.get === 'function'
      ? ctx.get('sshRegistry', false) as { get?: (id: string) => unknown } | undefined
      : undefined
    const connection = registry?.get?.(connectionId)
    if (connection === undefined) {
      note(`dsw: core deploy skipped on ${connectionId}: the registry cannot build the connection`)
      return false
    }
    const view = await deploy(connection as SshTransport, facts.signal)
    if (!view.ok) {
      note(`dsw: core deploy failed on ${connectionId}: ${view.detail ?? 'unknown detail'}`)
      return false
    }
    // Stale serves (old `current`) and their cached refusals must not
    // outlive the flip — the retry re-execs the new binary.
    forgetCoreEffect(connectionId)
    hubOf()?.close(connectionId)
    return true
  }
}
