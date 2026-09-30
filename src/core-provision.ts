/**
 * REQ-I14/REQ-I21: making the remote-core deployment invisible.
 *
 * Two halves share one policy — the core the fence runs is THIS plugin's
 * provisioning problem, never the operator's manual chore (ADR-0024 §3/§6.1,
 * revised 2026-09-29/30):
 *
 *  1. **Connection warmup** ({@link createCoreWarmup}): when a machine is
 *     connected via the PANEL/channel paths, a background `core.status` →
 *     `core.deploy` run installs or upgrades the first-party artifact before
 *     the first tool call needs it. Fire-and-forget: a UI toggle must not pay
 *     for an upload, and a failed warmup only means the status quo.
 *  2. **The synchronous tool channel** ({@link provisionRemoteCore}, REQ-I21):
 *     `sw_connect` awaits the same ladder per reachable machine and reports
 *     the outcome in its own tool output; `sw_status` reports the per-machine
 *     core state. This is the remediation channel that always works — the
 *     approval ask (below) depends on a chain of runtime preconditions that
 *     fails SILENTLY (2026-09-30 lab report: no approval audit pair ⇒ the
 *     request never fired; every false path now warns).
 *
 *  3. **First-use approval** ({@link createCoreGapAsker}): when a confined
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

/** What one synchronous provision run decided about one machine. */
export interface CoreProvisionOutcome {
  /** The machine id that was provisioned. */
  id: string
  /** `true` when nothing ran: unfenced/unknown machine, or hub-free composition. */
  skipped: boolean
  /** `true` when this run uploaded and installed a new artifact. */
  deployed: boolean
  /** Post-action disk version (absent when the probe/install failed). */
  version: string | undefined
  /** Failure detail (deploy or probe); also set for skips that matter. */
  detail: string | undefined
}

/**
 * REQ-I21: one machine's synchronous provision — the status→deploy ladder the
 * `sw_connect` tool awaits and reports per machine. Never throws: a failed
 * deploy is an outcome (`deployed: false`, `detail`), not an exception, so a
 * broken remote can never fail the connect itself (reads still work via SFTP).
 *
 * Gating note (2026-09-30 lab fix): the machine's `remoteSandbox` field is
 * deliberately NOT consulted. Confinement that requires the core follows the
 * SESSION (`resolveRemoteSessionMode`, fail-safe `read-only` — ADR-0025), so
 * an `off`-fielded machine still fences a confined session and needs the
 * core; the field keeps governing terminals, the legacy fence, and display.
 * Unknown machines are the only skip.
 */
export async function provisionRemoteCore(
  deps: CoreWarmupDeps,
  id: string,
  signal?: AbortSignal,
): Promise<CoreProvisionOutcome> {
  const machine = deps.machine(id)
  if (machine === undefined) return { id, skipped: true, deployed: false, version: undefined, detail: 'unknown machine' }
  const status = await deps.status(id, signal)
  if (status.ok && status.version === CORE_ARTIFACT_VERSION) {
    return { id, skipped: false, deployed: false, version: status.version, detail: undefined }
  }
  const view = await deps.deploy(id, signal)
  if (view.ok) {
    deps.afterDeploy?.(id)
    return { id, skipped: false, deployed: true, version: view.version ?? CORE_ARTIFACT_VERSION, detail: view.detail }
  }
  return { id, skipped: false, deployed: false, version: undefined, detail: view.detail ?? 'deploy failed' }
}

/**
 * The fire-and-forget warmup closure (REQ-I14, the UI/channel connect paths —
 * the `sw_connect` tool uses the synchronous {@link provisionRemoteCore}
 * instead). Deduplicates per machine id: N connects racing on one machine
 * produce ONE status→deploy run; the promise leaves the map when it settles,
 * so a later reconnect warms again.
 *
 * @returns the trigger; it never throws and never blocks the caller.
 */
export function createCoreWarmup(deps: CoreWarmupDeps): (id: string) => void {
  const inFlight = new Map<string, Promise<void>>()
  return (id: string): void => {
    if (inFlight.has(id)) return
    const run = provisionRemoteCore(deps, id)
      .then(outcome => {
        if (outcome.skipped || outcome.deployed) return
        if (outcome.detail !== undefined) {
          deps.warn?.(`dsw: core warmup deploy failed on ${id}: ${outcome.detail}`)
        }
      })
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
  /** REQ-I21 observability: the 2026-09-30 lab report showed a silent false
   *  path is undiagnosable from artifacts (no approval audit pair ⇒ request()
   *  never called, but WHICH precondition failed stayed invisible). */
  const note = (text: string): void => {
    const logger = (ctx as { logger?: { warn?: (message: string) => void } }).logger
    try {
      logger?.warn?.(text)
    } catch {
      // A broken sink must not turn a fail-closed answer into a throw.
    }
  }
  return async (connectionId, facts): Promise<boolean> => {
    try {
      const approval = typeof ctx.get === 'function'
        ? ctx.get('approval', false) as RemoteApprovalServiceFace | undefined
        : undefined
      if (approval === undefined) {
        note(`dsw: core-deploy approval skipped on ${connectionId}: no approval service is composed`)
        return false
      }
      const agents = typeof ctx.get === 'function'
        ? ctx.get('agents', false) as { currentInitiator?: () => RemoteApprovalAgentFace | undefined } | undefined
        : undefined
      const agent = agents?.currentInitiator?.()
      if (agent === undefined) {
        note(`dsw: core-deploy approval skipped on ${connectionId}: no initiating agent (outside a tool-call initiator boundary)`)
        return false
      }
      const registry = typeof ctx.get === 'function'
        ? ctx.get('sshRegistry', false) as { get?: (id: string) => unknown } | undefined
        : undefined
      const connection = registry?.get?.(connectionId)
      if (connection === undefined) {
        note(`dsw: core-deploy approval skipped on ${connectionId}: the registry cannot build the connection`)
        return false
      }
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
      } catch (error) {
        // No open turn / no answerer composed: not a deploy decision, fail closed.
        note(`dsw: core-deploy approval request failed on ${connectionId}: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
      if (outcome !== 'allowed-once') {
        note(`dsw: core-deploy approval answered '${String(outcome)}' on ${connectionId} — keeping the fail-closed refusal`)
        return false
      }
      const view = await deploy(connection as SshTransport, facts.signal)
      if (!view.ok) {
        note(`dsw: approved core deploy failed on ${connectionId}: ${view.detail ?? 'unknown detail'}`)
        return false
      }
      // Stale serves (old `current`) and their cached refusals must not
      // outlive the flip — the retry re-execs the new binary.
      hubOf()?.close(connectionId)
      return true
    } catch (error) {
      note(`dsw: core-deploy approval path errored on ${connectionId}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
}
