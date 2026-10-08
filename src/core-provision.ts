/**
 * REQ-I14/REQ-I21: remote-core provisioning, ask-gated.
 *
 * One policy since the 2026-09-30 user decisions (ADR-0024 §3, revised):
 * a deploy ATTEMPT always asks through the platform approval service; a
 * composition that cannot ask (no turn, no approval service) never deploys;
 * danger-full-access sessions never attempt (the core is not needed); a
 * current core deploys nothing and asks nothing. The channels:
 *
 *  1. **`sw_connect`** awaits {@link provisionRemoteCore} per reachable
 *     machine and reports the outcome in its own tool output — approved
 *     deploy / already current / declined / failed, one line per machine.
 *  2. **First-use gap** ({@link createCoreGapAsker}): a confined open that
 *     fails on a verifiably missing/stale disk artifact asks once; on
 *     `allowed-once` it deploys and the hub retries the open. Every false
 *     path warns which link failed (the morning's silent-false lesson).
 *  3. **Background probe** ({@link createCoreWarmup}): the panel/channel
 *     connect paths run outside any turn — they cannot ask, so they only
 *     PROBE and warn, naming the gap for the next tool-path provision.
 *
 * @module dsh-workspace-enhancement/core-provision
 */

import type { Context } from '@deepseek-ai/cordis'
import { CORE_ARTIFACT_VERSION, coreVersionAccepted } from './core-protocol.ts'
import { deployCore } from './core-deploy.ts'
import type { CoreStatusView, CoreHub } from './core-hub.ts'
import type { SshTransport } from './transport.ts'
import type {
  RemoteApprovalAgentFace,
  RemoteApprovalServiceFace,
  RemoteApprovalOutcome,
} from './remote-approval-gate.ts'
/** The approval `toolName` for a core deploy ask (an operator action, not a model tool). */
export const CORE_DEPLOY_TOOL_NAME = 'core.deploy'

/**
 * Marker prefix of the deploy ask's reason. Distinct from the approval gate's
 * `[dsw-remote-gate]` marker on purpose: the AI answerer only auto-grants its
 * own marked asks, so this one always reaches the human answerer.
 */
export const CORE_DEPLOY_ASK_MARKER = '[dsw-core-deploy]'

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
  /**
   * REQ-I21 (2026-09-30, user decision): a deploy only runs when this says
   * yes. Called with the disk facts ONLY when the ladder is about to deploy
   * (missing/stale) — a current core never asks. Every production path wires
   * this to the platform approval ask (which itself fails closed when it
   * cannot ask); an absent face means the CALLER vouches that no ask is
   * needed (tests, or an operator-context automation).
   */
  approve?(id: string, facts: { found: string | undefined; expected: string; signal?: AbortSignal | undefined }): Promise<boolean>
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
  /** `true` when a deploy was needed but the approval said no (nothing uploaded). */
  declined: boolean
  /** Post-action disk version (absent when the probe/install failed). */
  version: string | undefined
  /** Failure detail (deploy or probe); also set for skips that matter. */
  detail: string | undefined
}

/**
 * REQ-I21: one machine's synchronous provision — the status→approve→deploy
 * ladder the `sw_connect` tool awaits and reports per machine. Never throws:
 * a failed or declined deploy is an outcome, not an exception, so a broken or
 * unwilling remote can never fail the connect itself (reads still work via
 * SFTP).
 *
 * User policy (2026-09-30), three rules:
 *  - a deploy ATTEMPT always asks first (`approve`); no approve face ⇒ no
 *    deploy (background paths cannot ask, so they never deploy);
 *  - danger-full-access sessions never attempt (the caller skips — the core
 *    is not needed when writes may fall back to SFTP);
 *  - a current core deploys nothing and asks nothing.
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
  if (status.ok && coreVersionAccepted(status.version ?? '')) {
    return { id, skipped: false, deployed: false, declined: false, version: status.version, detail: undefined }
  }
  if (deps.approve !== undefined) {
    const allowed = await deps.approve(id, {
      found: status.ok ? status.version : undefined,
      expected: CORE_ARTIFACT_VERSION,
      ...(signal !== undefined ? { signal } : {}),
    })
    if (!allowed) {
      return { id, skipped: false, deployed: false, declined: true, version: status.ok ? status.version : undefined, detail: 'deploy was not approved' }
    }
  }
  const view = await deps.deploy(id, signal)
  if (view.ok) {
    deps.afterDeploy?.(id)
    return { id, skipped: false, deployed: true, declined: false, version: view.version ?? CORE_ARTIFACT_VERSION, detail: view.detail }
  }
  return { id, skipped: false, deployed: false, declined: false, version: undefined, detail: view.detail ?? 'deploy failed' }
}

/**
 * The background gap probe (REQ-I14's connect warmup, 2026-09-30 revision):
 * the panel/channel connect paths run OUTSIDE any model turn, so the approval
 * ask can never fire there — and per the user's policy a deploy that cannot
 * ask must not deploy. The warmup therefore only PROBES the disk state and
 * warns on a gap, so the host log names the machine the next tool-path
 * provision (sw_connect, or the hub's first-use ask) will offer to fix.
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
      if (status.ok && coreVersionAccepted(status.version ?? '')) return
      const found = status.ok ? status.version ?? 'unreadable version' : 'not installed'
      deps.warn?.(`dsw: core gap on ${id} (${found}); the deploy will ask on the next sw_connect / confined first use`)
    })()
      .catch(error => {
        deps.warn?.(`dsw: core warmup probe failed on ${id}: ${error instanceof Error ? error.message : String(error)}`)
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
/**
 * Ask — and only ask — the core-deploy question through the platform approval
 * service (REQ-I21: every deploy attempt asks; the callers own the deploy).
 * Resolves `true` only on `allowed-once`; every other ending (including the
 * degradation ladder: no approval service, no initiator, throwing request)
 * resolves `false` WITH a warn naming the link that failed.
 */
export function createCoreDeployAsk(
  ctx: Context,
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
      return true
    } catch (error) {
      note(`dsw: core-deploy approval path errored on ${connectionId}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
}

/**
 * The hub's REQ-I14 gap resolver built from a live context: ask first
 * ({@link createCoreDeployAsk}), deploy only on `allowed-once`, then report
 * the gap solved so the hub retries the open exactly once. Every failure path
 * returns `false` — the caller then falls through to the original fail-closed
 * error, which already carries the deploy hint.
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
  const ask = createCoreDeployAsk(ctx)
  const note = (text: string): void => {
    const logger = (ctx as { logger?: { warn?: (message: string) => void } }).logger
    try {
      logger?.warn?.(text)
    } catch {
      // A broken sink must not turn a fail-closed answer into a throw.
    }
  }
  return async (connectionId, facts): Promise<boolean> => {
    const registry = typeof ctx.get === 'function'
      ? ctx.get('sshRegistry', false) as { get?: (id: string) => unknown } | undefined
      : undefined
    const connection = registry?.get?.(connectionId)
    if (connection === undefined) {
      note(`dsw: core-deploy approval skipped on ${connectionId}: the registry cannot build the connection`)
      return false
    }
    if (!await ask(connectionId, facts)) return false
    const view = await deploy(connection as SshTransport, facts.signal)
    if (!view.ok) {
      note(`dsw: approved core deploy failed on ${connectionId}: ${view.detail ?? 'unknown detail'}`)
      return false
    }
    // Stale serves (old `current`) and their cached refusals must not
    // outlive the flip — the retry re-execs the new binary.
    hubOf()?.close(connectionId)
    return true
  }
}
