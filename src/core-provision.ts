/**
 * REQ-I14: making the remote-core deployment invisible.
 *
 * Two halves share one policy — the fence owns the machine, so the core it
 * runs is THIS plugin's provisioning problem, never the operator's manual
 * chore (ADR-0024 §3/§6.1, revised 2026-09-29):
 *
 *  1. **Connection warmup** ({@link createCoreWarmup}): when a fenced machine
 *     is connected to a session, a background `core.status` → `core.deploy`
 *     run installs or upgrades the first-party artifact before the first tool
 *     call needs it. Fire-and-forget: connect latency must not pay for an
 *     upload, and a failed warmup only means the status quo (fail-closed
 *     refusal at use time).
 *  2. **First-use approval** ({@link createCoreGapAsker}): when a confined
 *     open fails on a verifiably missing/stale disk artifact, the hub asks the
 *     platform approval service once; `allowed-once` deploys and retries, every
 *     other ending falls through to the original `SANDBOX_UNAVAILABLE` with
 *     its deploy hint (REQ-I17's fail-closed text). Deploying a binary to the
 *     operator's host stays a human decision — the marker below is deliberately
 *     NOT the AI answerer's, so no auto-grant path can pick it up.
 *
 * @module dsh-workspace-enhancement/core-provision
 */

import type { Context } from '@deepseek-ai/cordis'
import { CORE_ARTIFACT_VERSION } from './core-protocol.ts'
import { deployCore } from './core-deploy.ts'
import type { CoreStatusView, CoreHub } from './core-hub.ts'
import type { SshTransport } from './transport.ts'
import type {
  RemoteApprovalAgentFace,
  RemoteApprovalServiceFace,
  RemoteApprovalOutcome,
} from './remote-approval-gate.ts'
import {
  isRemoteSandboxEnabled,
  normalizeRemoteSandbox,
} from './remote-sandbox.ts'
import type { RemoteSandboxMode } from './remote-sandbox.ts'

/** The approval `toolName` for a core deploy ask (an operator action, not a model tool). */
export const CORE_DEPLOY_TOOL_NAME = 'core.deploy'

/**
 * Marker prefix of the deploy ask's reason. Distinct from the approval gate's
 * `[dsw-remote-gate]` marker on purpose: the AI answerer only auto-grants its
 * own marked asks, so this one always reaches the human answerer.
 */
export const CORE_DEPLOY_ASK_MARKER = '[dsw-core-deploy]'

/* ------------------------------------------------------ connection warmup */

/** Faceted deps: everything the warmup needs, injectable in tests. */
export interface CoreWarmupDeps {
  /** The machine view of one route (fence mode read), or `undefined`. */
  machine(id: string): { remoteSandbox?: RemoteSandboxMode } | undefined
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

/**
 * The fire-and-forget warmup closure. Deduplicates per machine id: N connects
 * racing on one machine produce ONE status→deploy run; the promise leaves the
 * map when it settles, so a later reconnect warms again.
 *
 * @returns the trigger; it never throws and never blocks the caller.
 */
export function createCoreWarmup(deps: CoreWarmupDeps): (id: string) => void {
  const inFlight = new Map<string, Promise<void>>()
  return (id: string): void => {
    if (inFlight.has(id)) return
    const run = (async (): Promise<void> => {
      const machine = deps.machine(id)
      if (machine === undefined) return
      if (!isRemoteSandboxEnabled(normalizeRemoteSandbox(machine.remoteSandbox))) return
      const status = await deps.status(id)
      if (status.ok && status.version === CORE_ARTIFACT_VERSION) return
      const view = await deps.deploy(id)
      if (view.ok) {
        deps.afterDeploy?.(id)
      } else {
        deps.warn?.(`dsw: core warmup deploy failed on ${id}: ${view.detail ?? 'unknown detail'}`)
      }
    })()
      .catch(error => {
        deps.warn?.(`dsw: core warmup failed on ${id}: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { inFlight.delete(id) })
    inFlight.set(id, run)
  }
}

/* ------------------------------------------------- first-use approval ask */

/** Build the human-facing one-line reason for one deploy ask. */
export function coreDeployAskReason(facts: { machineId: string; found: string | undefined; expected: string }): string {
  const found = facts.found === undefined ? 'not installed' : `version ${facts.found}`
  return `${CORE_DEPLOY_ASK_MARKER} machine=${facts.machineId}: the remote core is ${found}, this plugin requires ${facts.expected} — upload and install the first-party dsh-core artifact under ~/.dsh-core on that host?`
}

/**
 * The hub's REQ-I14 gap resolver built from a live context. Every prerequisite
 * is resolved LAZILY per ask (the approval service may compose after the hub),
 * and every failure path returns `false` — the caller then falls through to
 * the original fail-closed error, which already carries the deploy hint.
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
  return async (connectionId, facts): Promise<boolean> => {
    try {
      const approval = typeof ctx.get === 'function'
        ? ctx.get('approval', false) as RemoteApprovalServiceFace | undefined
        : undefined
      if (approval === undefined) return false
      const agents = typeof ctx.get === 'function'
        ? ctx.get('agents', false) as { currentInitiator?: () => RemoteApprovalAgentFace | undefined } | undefined
        : undefined
      const agent = agents?.currentInitiator?.()
      if (agent === undefined) return false
      const registry = typeof ctx.get === 'function'
        ? ctx.get('sshRegistry', false) as { get?: (id: string) => unknown } | undefined
        : undefined
      const connection = registry?.get?.(connectionId)
      if (connection === undefined) return false
      let outcome: RemoteApprovalOutcome
      try {
        outcome = await approval.request({
          agent,
          toolName: CORE_DEPLOY_TOOL_NAME,
          reason: coreDeployAskReason({
            machineId: connectionId,
            found: facts.found,
            expected: facts.expected,
          }),
          ...(facts.signal !== undefined ? { signal: facts.signal } : {}),
        })
      } catch {
        // No open turn / no answerer composed: not a deploy decision, fail closed.
        return false
      }
      if (outcome !== 'allowed-once') return false
      const view = await deploy(connection as SshTransport, facts.signal)
      if (!view.ok) return false
      // Stale serves (old `current`) and their cached refusals must not
      // outlive the flip — the retry re-execs the new binary.
      hubOf()?.close(connectionId)
      return true
    } catch {
      return false
    }
  }
}
