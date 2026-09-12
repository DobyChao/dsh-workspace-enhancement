/**
 * Per-session workspace facts shared by the prompt sections of BOTH halves of
 * the workspace surface: the `sw-remote` section (registered by `tools.ts`)
 * and the `tool:sw-exec` / `tool:bash` sections (registered by `exec-tools.ts`).
 *
 * Living in its own module keeps `tools.ts` → `exec-tools.ts` one-directional:
 * `exec-tools.ts` imports these helpers instead of importing `tools.ts` back
 * (a value-import cycle would be harmless at runtime — both modules only call
 * each other from function bodies — but it is a real dependency smell and it
 * makes bundler graphs harder to reason about).
 *
 * Injection-point choice (reconnaissance conclusion, R4/R5): a GLOBAL
 * `ctx.systemPrompt.section({ text: context => … })` plus a scope lookup.
 * `context.scope` IS the session's agent instance (`dsh-agent-loop`'s
 * `assembleContextFor` returns `{ agent, scope: agent }`; the per-session scope
 * key is minted by `ReactLoopAgent` via `createScope(loopCtx, this)`), so
 * `agent.session.header` exposes the only leaves needed here: `cwd` and `id`.
 * @module dsh-workspace-enhancement/session-remote-context
 */

import { remoteRouteFromCwd } from './transport.ts'
import type { SessionSideWorkspaceStore, SideWorkspaceItem } from './session-workspaces.ts'

/**
 * REQ-I11: the face of the per-session connected-machine store
 * (`SessionMachineConnections`) that callers name. The mutators are listed so
 * this type can declare the `sessionConnections` service lookup, but every
 * prompt contribution is a read-only consumer by convention: only the
 * `sw_connect` tool and the `session.conn.*` endpoints mutate the store, and
 * both go through exactly these methods.
 * Injected/absent services are passed as an accessor so a composition without
 * the store degrades to "no session connections" instead of failing assembly.
 */
export interface SessionConnectionsFace {
  /** The machine ids connected to one session, in connection order. */
  listFor(sessionId: string): readonly string[]
  /** REQ-I11 replace semantics: the whole set becomes `ids` (empty = clear). */
  set(sessionId: string, machineIds: readonly unknown[]): string[]
  /** Add one machine to the session (idempotent). */
  connect(sessionId: string, machineId: string): string[]
  /** Remove one machine from the session (absent id is a no-op `false`). */
  disconnect(sessionId: string, machineId: string): boolean
  /**
   * Drop references to machine ids the registry no longer knows and report how
   * many were removed. The store keeps id references only, so the registry is
   * the only place that can know an id is gone: the channel calls this after
   * `machines.remove` (ADR-0021 §2.3).
   */
  retain(known: ReadonlySet<string>): number
}

/**
 * Minimal agent face read by the prompt probe: `dsh-agent-loop`'s
 * `ReactLoopAgent` (the per-session scope key) exposes `id` and `session`;
 * only these leaf fields are touched.
 */
export interface PromptAgentFace {
  readonly id: string
  readonly session?: { readonly header: { readonly cwd?: string; readonly id?: string } }
}

/** The per-session workspace facts every prompt section reads. */
export interface SessionWorkspaceContext {
  /** `session.header.cwd` (any route spelling), when the scope carrier exposes it. */
  cwd?: string
  /** `session.header.id`, when the scope carrier exposes it. */
  sessionId?: string
  /** Side workspaces attached to this session (empty without a store/attachments). */
  sides: readonly SideWorkspaceItem[]
}

/**
 * Read the per-session workspace facts from one assembly context. Pure leaf
 * projection — no live Cordis object leaves this function, and a missing scope
 * carrier yields empty facts instead of throwing.
 * @param context - the assembly context handed to a `systemPrompt.section` text provider.
 * @param store - the side-workspace store accessor (absent → no attachments).
 */
export function sessionWorkspaceContextOf(
  context: { readonly scope?: object },
  store?: () => SessionSideWorkspaceStore | undefined,
): SessionWorkspaceContext {
  const agent = context.scope as PromptAgentFace | undefined
  const cwd = agent?.session?.header.cwd
  const sessionId = agent?.session?.header.id
  return {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    sides: sessionId !== undefined ? (store?.()?.listFor(sessionId) ?? []) : [],
  }
}

/**
 * REQ-I6 ②: is this session inside the REMOTE workspace world? True when the
 * session cwd routes to a machine (`ssh://<id>/…` or the placeholder tree) or
 * when at least one side workspace is attached. A local session with no
 * attachments is `false` — the remote-only prompt sections then inject nothing
 * (zero noise in a plain local conversation).
 * @param context - the assembly context of the session being assembled.
 * @param store - the side-workspace store accessor (absent → no attachments).
 */
export function hasRemoteWorkspaceContext(
  context: { readonly scope?: object },
  store?: () => SessionSideWorkspaceStore | undefined,
): boolean {
  const facts = sessionWorkspaceContextOf(context, store)
  if (facts.sides.length > 0) return true
  return facts.cwd !== undefined && remoteRouteFromCwd(facts.cwd) !== null
}

/**
 * REQ-I11: the session id one assembly context belongs to, or `undefined` when
 * the scope carrier does not expose one. Pure leaf read; a missing carrier is
 * an honest "unknown session" rather than a throw (the callers that MUST have
 * an id fail closed themselves).
 */
export function sessionIdOf(context: { readonly scope?: object }): string | undefined {
  return (context.scope as PromptAgentFace | undefined)?.session?.header.id
}

/** REQ-I11: the connected-machine ids of one assembly context (empty when unknown). */
export function connectedMachineIdsOf(
  context: { readonly scope?: object },
  store?: () => SessionConnectionsFace | undefined,
): string[] {
  const sessionId = sessionIdOf(context)
  if (sessionId === undefined) return []
  return [...(store?.()?.listFor(sessionId) ?? [])]
}

/**
 * REQ-I11 (ADR-0021 §2.8): the session has a REMOTE fact worth prompting about
 * — a remote cwd route, at least one side root, or at least one connected
 * machine. This is the existence condition of BOTH the `sw-remote` section and
 * the `tool:sw-exec` section, so a local session with zero connections still
 * gets zero injection (REQ-I6's zero-injection rule, now including the
 * connection axis).
 * @param context - the assembly context of the session being assembled.
 * @param store - the side-workspace store accessor (absent → no attachments).
 * @param connections - the connected-machine store accessor (absent → none).
 */
export function hasRemoteSessionContext(
  context: { readonly scope?: object },
  store?: () => SessionSideWorkspaceStore | undefined,
  connections?: () => SessionConnectionsFace | undefined,
): boolean {
  if (hasRemoteWorkspaceContext(context, store)) return true
  return connectedMachineIdsOf(context, connections).length > 0
}
