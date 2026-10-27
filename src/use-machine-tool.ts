/**
 * REQ-I31: the EXPERIMENTAL `sw_use_machine` tool — switch THIS session to
 * another connected remote machine.
 *
 * The switch itself is the host's `workingDirectory.set` (0.2.1 family): it
 * validates the landing directory through `ctx.fs` (our remote provider),
 * commits the durable `working-directory/change` event, and injects the
 * model-visible change notice. Every consumer then follows the projection —
 * the plugin's own seams via {@link effectiveCwdOf} (Phase A of this round),
 * the host tools natively.
 *
 * What this module adds is the GATE the host tool does not have:
 * 1. the experimental settings toggle (the tool only registers while on —
 *    `关闭时工具不注册`, enforced by the registration site in `tools.ts`);
 * 2. the danger-full-access tier (standing session mode, or a one-shot
 *    `sandbox_permissions` approval);
 * 3. the per-session connection gate (stored ∪ implicit-cwd machine, the
 *    same union `sw_exec` gates on — ADR-0021 §2.4);
 * 4. a landing directory that is a DECLARED root: the machine's registered
 *    workspace/cwd, or an explicit absolute POSIX path. A machine with no
 *    registered root and no explicit path is refused — landing at `/` would
 *    fence nothing on the remote component (`core-hub.ts` `remember()`
 *    ignores `/`, and a `--workspace /` serve means the whole machine).
 *
 * Refusals change nothing (the note's "拒绝且不改目录"): every validation runs
 * before `set`, and `set` itself is the only mutating step.
 *
 * The decision core is a PURE function so the sandbox test suite covers the
 * whole gate matrix without a host.
 * @module dsh-workspace-enhancement/use-machine-tool
 */

import { posix } from 'node:path'
import { approveEscalation, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import type { EscalationApprover } from '@deepseek-ai/dsh-sandbox'
import { TOOL_ABORTED, defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { connectedMachinesOf } from './exec-tools.ts'
import { hostLocaleOf } from './locale/host.ts'
import type { TranslateFn } from './locale/index.ts'
import { effectiveCwdOf, resolveRemoteSessionMode, sessionProjectionsOf, type WorkingDirectoryFace } from './remote-policy.ts'
import { remoteRouteFromCwd, sshTargetKey } from './transport.ts'
import { SW_USE_MACHINE_DESCRIPTION, SW_USE_MACHINE_PARAMS } from './tool-schema.ts'
import type { SessionConnectionsFace } from './session-remote-context.ts'
import type { SshRegistry } from './registry.ts'

/** The registry facts the decision needs (a `MachineView` subset). */
export interface UseMachineTarget {
  id: string
  workspace?: string
  cwd?: string
}

/** The refusal reasons, in decision order; the tool layer maps them to locale keys. */
export type UseMachineRefusal =
  | 'empty'
  | 'reserved'
  | 'unknown'
  | 'notConnected'
  | 'pathNotAbsolute'
  | 'noRegisteredRoot'

/** The pure decision: refuse, switch, or report the already-active no-op. */
export type UseMachineDecision =
  | { action: 'refuse'; reason: UseMachineRefusal }
  | { action: 'switch'; machineId: string; landing: string }
  | { action: 'noop'; machineId: string; landing: string }

/**
 * Validate one switch request. Pure and synchronous.
 *
 * @param requested - the `machine` argument, already trimmed by the caller.
 * @param explicitPath - the `path` argument, when given.
 * @param machines - every registry machine (the known-id list).
 * @param connectedIds - the session's connected set (stored ∪ implicit cwd).
 * @param currentMachineId - the machine the session cwd routes to, if remote.
 */
export function decideUseMachine(
  requested: string,
  explicitPath: string | undefined,
  machines: readonly UseMachineTarget[],
  connectedIds: readonly string[],
  currentMachineId: string | null,
): UseMachineDecision {
  if (requested === '') return { action: 'refuse', reason: 'empty' }
  if (requested === 'local') return { action: 'refuse', reason: 'reserved' }
  const target = machines.find(machine => machine.id === requested)
  if (target === undefined) return { action: 'refuse', reason: 'unknown' }
  if (!connectedIds.includes(requested)) return { action: 'refuse', reason: 'notConnected' }
  // The landing rule mirrors sw_exec's defaultRemoteDir (workspace → cwd →
  // '/'), but '/' is never an acceptable landing: no registered root means
  // the caller must name one explicitly.
  const landing = explicitPath !== undefined
    ? (posix.isAbsolute(explicitPath) ? posix.normalize(explicitPath) : undefined)
    : ((target.workspace !== undefined && posix.isAbsolute(target.workspace) ? posix.normalize(target.workspace)
      : target.cwd !== undefined && posix.isAbsolute(target.cwd) ? posix.normalize(target.cwd)
      : undefined))
  if (landing === undefined) {
    return { action: 'refuse', reason: explicitPath !== undefined ? 'pathNotAbsolute' : 'noRegisteredRoot' }
  }
  if (landing === '/') return { action: 'refuse', reason: 'noRegisteredRoot' }
  if (currentMachineId === requested && explicitPath === undefined) {
    return { action: 'noop', machineId: requested, landing }
  }
  return { action: 'switch', machineId: requested, landing }
}

const TEXT_OUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string', required: true } },
} as const

/**
 * Build the experimental `sw_use_machine` tool. The registration site
 * (`tools.ts`) mounts it ONLY while the settings toggle is on AND the host
 * exposes `workingDirectory.set`; both conditions are re-checked on every
 * toggle flip.
 */
export function useMachineToolOf(
  ctx: Context,
  deps: {
    registry: () => SshRegistry
    connections: () => SessionConnectionsFace | undefined
    workingDirectory: WorkingDirectoryFace
  },
): ReturnType<typeof defineTool> {
  const t = hostLocaleOf(ctx).t as TranslateFn
  return defineTool({
    name: 'sw_use_machine',
    description: SW_USE_MACHINE_DESCRIPTION,
    parameters: SW_USE_MACHINE_PARAMS,
    output: {
      schema: TEXT_OUT_SCHEMA,
      render: (_args, value): Array<{ type: 'text'; text: string }> => [{ type: 'text', text: value.text }],
    },
    async execute(
      args: { machine?: string; path?: string; sandbox_permissions?: string; justification?: string },
      exec: ToolRunContext,
    ): Promise<{ text: string }> {
      validateEscalationArgs(args.sandbox_permissions, args.justification)
      const agent = exec.agent as
        | { readonly session?: { readonly header?: { readonly cwd?: string; readonly id?: string } } }
        | undefined
      if (agent === undefined || agent.session?.header?.id === undefined) {
        throw new Error(t('tool.sw_use_machine.error.noSession'))
      }
      const registry = deps.registry()
      const machines = registry.listMachines().machines
      const sessionCwd = effectiveCwdOf(
        sessionProjectionsOf(ctx),
        agent.session,
        agent.session?.header?.cwd,
      )
      const connected = connectedMachinesOf(
        sessionCwd,
        agent.session.header.id,
        sessionId => deps.connections()?.listFor(sessionId) ?? [],
        registry,
      )
      const requested = String(args.machine ?? '').trim()
      const explicitPath = args.path !== undefined && String(args.path).trim() !== ''
        ? String(args.path).trim()
        : undefined
      const decision = decideUseMachine(
        requested,
        explicitPath,
        machines,
        connected.ids,
        remoteRouteFromCwd(sessionCwd)?.connectionId ?? null,
      )
      if (decision.action === 'refuse') {
        const known = machines.map(machine => machine.id)
        throw new Error(t(`tool.sw_use_machine.error.${decision.reason}`, {
          id: requested,
          ids: connected.ids.join(', '),
          known: known.length > 0 ? known.join(', ') : t('tool.sw_use_machine.error.noKnown'),
        }))
      }
      // The danger tier gate: a standing danger session passes; anything else
      // needs a one-shot approval, which throws on decline (nothing changed).
      let mode = resolveRemoteSessionMode(ctx)
      if (mode !== 'danger-full-access' && args.sandbox_permissions !== undefined && args.justification !== undefined) {
        mode = await approveEscalation({
          requestedMode: args.sandbox_permissions,
          justification: args.justification,
          effectiveMode: mode,
          subject: 'machine switch',
        }, {
          approver: ctx.get('approval', false) as EscalationApprover | undefined,
          agent: exec.agent,
          callId: exec.callId,
          toolName: 'sw_use_machine',
          ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
        })
      }
      if (mode !== 'danger-full-access') {
        throw new Error(t('tool.sw_use_machine.error.notDanger', { mode }))
      }
      if (decision.action === 'noop') {
        return { text: t('tool.sw_use_machine.output.alreadyActive', { id: decision.machineId, path: decision.landing }) }
      }
      // BUG-20 belt: capture the committed cwd so a cross-machine mis-commit
      // can be rolled back before failing loud — a switch must never report
      // success while the session actually stays on (or moves within) another
      // machine's route tree.
      const previous = deps.workingDirectory.get(agent.session)
      const committed = await deps.workingDirectory.set(
        agent,
        sshTargetKey(decision.machineId, decision.landing),
        exec.signal,
      )
      const committedRoute = remoteRouteFromCwd(committed)
      if (committedRoute === null || committedRoute.connectionId !== decision.machineId) {
        try {
          await deps.workingDirectory.set(agent, previous, exec.signal)
        } catch {
          // Best-effort rollback: the loud failure below is the contract;
          // a failed restore only means the session keeps the (wrong) commit.
        }
        throw new Error(t('tool.sw_use_machine.error.commitMismatch', {
          id: decision.machineId,
          committed,
        }))
      }
      if (exec.signal?.aborted === true) throw new Error(TOOL_ABORTED)
      return { text: t('tool.sw_use_machine.output.switched', {
        id: decision.machineId,
        path: decision.landing,
        cwd: committed,
      }) }
    },
  })
}
