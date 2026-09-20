/**
 * `sw_*` workspace tools and the per-session remote-context system-prompt
 * section of dsh-workspace-enhancement, riding the machine registry. Two
 * management tools only: status/connect. `sw_pick_workspace` was removed
 * (REQ-I10 / ADR-0027); the workspace directory is the session cwd. The
 * registry's own `connections.*` RPC surface stays separate; tools are the
 * model's control plane and never enumerate the file/execution tools (those
 * belong to the seam engine).
 * @module dsh-workspace-enhancement/tools
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { probeMachines, registerSwExec, registerWin32Bash } from './exec-tools.ts'
import type { MachineProbeResult, ProbeRegistryFace } from './exec-tools.ts'
import { lookup, type TranslateFn } from './locale/index.ts'
import { hostLocaleOf, localizeTool } from './locale/host.ts'
import { modelPrompt } from './model-prompts.ts'
import { connectedMachineIdsOf, sessionIdOf, sessionWorkspaceContextOf } from './session-remote-context.ts'
import type { SessionConnectionsFace } from './session-remote-context.ts'
import type { RemoteApprovalMode } from './remote-approval-gate.ts'
import type { RemoteSandboxMode } from './remote-sandbox.ts'
import type { SshRegistry } from './registry.ts'
import { remoteRouteFromCwd, sshRoutesRoot } from './transport.ts'
import type { RemoteRouteRef } from './transport.ts'
import type { SessionSideWorkspaceStore, SideWorkspaceItem } from './session-workspaces.ts'
import { coreHubOf } from './core-hub.ts'
import type { CoreHub, CoreStatusView } from './core-hub.ts'

/** Pure text output contract shared by every sw_* tool. */
const textOutSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string', required: true } },
} as const

/**
 * Fixed-ZH translator — the baseline compiled into `defineTool` at
 * registration (the `tool.*` faces keep their per-language dictionary copy;
 * the model-facing prompt copy of this module does NOT — see ADR-0014).
 */
const ZH_T: TranslateFn = (key, params) => lookup('zh', key, params)

/** The machine facts the prompt reads (leaf fields only, no live objects). */
export interface PromptMachineFace {
  username: string
  host: string
  workspace?: string
  /** AUDIT-6 gate mode of the routed machine (absent ⇒ treat as `'off'`). */
  remoteApproval?: RemoteApprovalMode
  /** REQ-I9 fence mode of the machine (absent ⇒ treat as `'off'`). */
  remoteSandbox?: RemoteSandboxMode
}

/**
 * Minimal agent face read by the prompt probe: `dsh-agent-loop`'s
 * `ReactLoopAgent` (the per-session scope key) exposes `id` and `session`;
 * only these leaf fields are touched. Re-exported from
 * `session-remote-context.ts` (the shared home of the per-session prompt
 * facts, so `exec-tools.ts` needs no import back into this module).
 */
export type { PromptAgentFace } from './session-remote-context.ts'

/** The per-session remote-context fact the prompt renders. */
export interface RemotePromptFact {
  /** Registry connection id the session routes to. */
  connectionId: string
  /** Absolute POSIX remote path the session works in (from the cwd route). */
  remotePath: string
  /** `user@host` of the routed machine. */
  endpoint: string
  /** Placeholder-tree root basename shown as the local routing alias. */
  placeholderRoot: string
  /** The remote path the prompt shows: machine workspace when set, else the route path. */
  displayPath: string
}

/**
 * R4: compose the per-session remote-context fact from a resolved cwd route
 * and the routed machine. Pure and synchronous; `route === null` (local
 * session) never reaches this helper — callers return `''` first.
 * @param cwd - the session's header cwd (any route spelling).
 * @param machine - the routed machine's leaves; `undefined` keeps `connectionId` as the endpoint label.
 * @param dshBase - DSH home override (tests); defaults to the environment.
 */
export function remotePromptFact(
  cwd: string | undefined,
  machine: PromptMachineFace | undefined,
  dshBase?: string,
): RemotePromptFact | null {
  const route: RemoteRouteRef | null = remoteRouteFromCwd(cwd, dshBase)
  if (route === null) return null
  return {
    connectionId: route.connectionId,
    remotePath: route.path,
    endpoint: machine !== undefined ? `${machine.username}@${machine.host}` : `conn-${route.connectionId}`,
    placeholderRoot: basename(sshRoutesRoot(dshBase)),
    displayPath: machine?.workspace ?? route.path,
  }
}

/**
 * Render the one emphasis paragraph of the remote-workplace prompt (order 90).
 * ENGLISH ONLY — model-facing copy never follows the UI language (ADR-0014).
 */
export function renderRemotePrompt(fact: RemotePromptFact): string {
  return modelPrompt('remoteEmphasis', {
    endpoint: fact.endpoint,
    displayPath: fact.displayPath,
    placeholderRoot: fact.placeholderRoot,
    connectionId: fact.connectionId,
  })
}

/** The fact one side workspace renders as (English, model-facing). */
export interface SideWorkspacePromptFact {
  label: string
  /** Display root: `ssh://<id>/<path>` for remote, absolute local path otherwise. */
  rootKey: string
}

/** Pure prompt projection of one side workspace (leaf fields only). */
export function sideWorkspacePromptFact(item: SideWorkspaceItem): SideWorkspacePromptFact {
  return {
    label: item.label,
    rootKey: item.rootKey,
  }
}

/**
 * R5 → REQ-I7: render the attached side-workspace list for the per-session
 * prompt. Empty list → `''` (zero noise for sessions without attachments).
 * Since REQ-I7 (ADR-0019) a side root is a thin declaration — the line shows
 * label + root only, no permission marks.
 * ENGLISH ONLY (ADR-0014).
 */
export function renderSideWorkspaces(items: readonly SideWorkspaceItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map(item => {
    const fact = sideWorkspacePromptFact(item)
    return modelPrompt('sideItem', { label: fact.label, rootKey: fact.rootKey })
  })
  return `${modelPrompt('sideHeading')}\n${lines.join('\n')}\n${modelPrompt('sideNote')}`
}

/**
 * REQ-I11: one connected machine as the prompt renders it (leaf fields only).
 * `reachable` is `null` when the fact carries no live probe result (the panel
 * turned the machine on without a ping): the prompt then claims nothing.
 */
export interface ConnectedMachineFact {
  id: string
  endpoint: string
  reachable?: boolean | null
  /** REQ-I9: the machine's fence mode when it is not `off` (absent ⇒ no fence). */
  sandbox?: RemoteSandboxMode
}

/** Pure prompt projection of one connected registry machine. */
export function connectedMachineFact(id: string, machine: PromptMachineFace | undefined): ConnectedMachineFact {
  return {
    id,
    endpoint: machine !== undefined ? `${machine.username}@${machine.host}` : `conn-${id}`,
  }
}

/**
 * REQ-I11 (ADR-0021 §2.8): render the per-session connected-machine list — the
 * model-facing statement of the session's coarse gate, so the model knows which
 * ids `sw_exec` accepts. Empty list → `''` (a session with no connections
 * injects nothing). ENGLISH ONLY (ADR-0014).
 * @param facts - one entry per connected machine, in connection order.
 */
export function renderConnectedMachines(facts: readonly ConnectedMachineFact[]): string {
  if (facts.length === 0) return ''
  const lines = facts.map(fact => modelPrompt('connectedItem', {
    id: fact.id,
    endpoint: fact.endpoint,
    note: `${fact.reachable === false ? modelPrompt('connectedUnreachable') : ''}`,
  }))
  return `${modelPrompt('connectedHeading')}\n${lines.join('\n')}`
}

/** Render the `sw_status` connected-machine line (ids + endpoint, or the none text). */
export function renderConnectedStatusLine(
  ids: readonly string[],
  machineOf: (id: string) => PromptMachineFace | undefined,
  tr: TranslateFn,
): string {
  if (ids.length === 0) return tr('tool.sw_status.outputs.connNone')
  const items = ids
    .map(id => connectedMachineFact(id, machineOf(id)))
    .map(fact => `${fact.id} (${fact.endpoint})`)
  return tr('tool.sw_status.outputs.connList', { items: items.join(', ') })
}

/**
 * REQ-I11 (ADR-0021 §2.8): the VOLATILE session-workspace state — the connected
 * machine list and the side-root list — rendered as ONE runtime-context
 * contribution. Both lists are re-evaluated per assembly, so a `sw_connect` call
 * or a panel toggle becomes visible to the model inside the same conversation
 * (a `section()` alone would only be re-read in the header prompt). Both empty →
 * `''`, which is how a local session with zero connections keeps zero injection.
 * ENGLISH ONLY (ADR-0014).
 * @param connected - one fact per connected machine, in connection order.
 * @param sides - the session's side roots (薄声明清单, REQ-I7).
 */
export function renderSessionWorkspaceContext(
  connected: readonly ConnectedMachineFact[],
  sides: readonly SideWorkspaceItem[],
): string {
  const parts: string[] = []
  const machines = renderConnectedMachines(connected)
  if (machines !== '') parts.push(machines)
  const side = renderSideWorkspaces(sides)
  if (side !== '') parts.push(side)
  return parts.join('\n')
}

/**
 * Compose the STABLE framing of one session's workspace prompt: the R4 remote
 * emphasis (only when the cwd routes remote) plus the AUDIT-6 honesty sentences.
 * Pure and synchronous; an empty result means this session has no remote main
 * workspace. ENGLISH ONLY (ADR-0014).
 *
 * REQ-I11 (ADR-0021 §2.8): the VOLATILE lists (connected machines, side roots)
 * moved to the `dsw-session-workspace` runtime-context contribution
 * ({@link renderSessionWorkspaceContext}) — they must be re-read as durable
 * user-role snapshots inside the conversation, not frozen into the header
 * prompt. The optional `connected`/`sides` parameters stay for callers that want
 * the full single-shot composition (tests, tools), but the host registration
 * never renders the lists twice.
 *
 * AUDIT-6 (ADR-0020 D6): a remote-main-workspace session additionally always
 * carries the `remoteNoSandbox` honesty sentence, plus the `remoteGateActive`
 * expectation sentence exactly when the routed machine's approval gate is on.
 */
export function composeWorkspacePrompt(
  cwd: string | undefined,
  machine: PromptMachineFace | undefined,
  sides: readonly SideWorkspaceItem[],
  dshBase?: string,
  connected: readonly ConnectedMachineFact[] = [],
): string {
  const fact = remotePromptFact(cwd, machine, dshBase)
  const parts: string[] = []
  if (fact !== null) {
    parts.push(renderRemotePrompt(fact))
    parts.push(modelPrompt('remoteNoSandbox'))
    if (machine?.remoteApproval !== undefined && machine.remoteApproval !== 'off') {
      parts.push(modelPrompt('remoteGateActive'))
    }
  }
  const side = renderSideWorkspaces(sides)
  if (side !== '') parts.push(side)
  const machines = renderConnectedMachines(connected)
  if (machines !== '') parts.push(machines)
  return parts.join('\n\n')
}

/** The remote toolbox the R4 remote world needs (bash/pwsh for terminals, rg for glob/searches). */
export interface RemoteEnvProbe {
  bash: boolean
  pwsh: boolean
  rg: boolean
}

/**
 * R4 ⑧⑨: probe the remote toolbox with one bounded `command -v` pass. A
 * missing shell explains a remote terminal failure ("command not found"),
 * and a missing `rg` is the one requirement of the model-facing glob/search
 * tools — the remote surface reports it honestly instead of silently
 * degrading (the mixed provider rewrites `rg.exe` → `rg`; a remote without
 * rg then fails with a clear 127).
 */
export function remoteEnvProbeCommand(): string {
  // Trailing `; true` keeps the compound command's exit status 0 even when
  // every tool is missing — otherwise the caller's exit-code guard would drop
  // the whole three-line report exactly when it is most needed.
  return 'command -v bash; command -v pwsh; command -v rg; true'
}

/** Parse a `command -v` probe: stdout lines are the resolved paths of found tools. */
export function parseRemoteEnvProbe(output: string): RemoteEnvProbe {
  const found = new Set(output.split(/\r?\n/).map(line => line.trim()).filter(line => line !== ''))
  const basename = (line: string): string => (line.split(/[\\/]/).pop() ?? '').toLowerCase()
  return {
    bash: [...found].some(line => basename(line) === 'bash'),
    pwsh: [...found].some(line => basename(line) === 'pwsh'),
    rg: [...found].some(line => basename(line) === 'rg'),
  }
}

/**
 * Render the probe as three check lines plus one hint line (never
 * autoload/install). ENGLISH ONLY — this is model-facing tool output
 * (ADR-0014); the heading and the missing-tool hint both come from the same
 * English source instead of the pre-ADR mixed zh/en pair.
 */
export function renderRemoteEnvProbe(probe: RemoteEnvProbe): string {
  const mark = (present: boolean): string => (present ? '✓' : '✗')
  const missing: string[] = []
  if (!probe.bash) missing.push('bash')
  if (!probe.pwsh) missing.push('pwsh')
  if (!probe.rg) missing.push('rg')
  const lines = [
    modelPrompt('envHeading'),
    `  bash: ${mark(probe.bash)}`,
    `  pwsh: ${mark(probe.pwsh)}`,
    `  rg: ${mark(probe.rg)}`,
  ]
  if (missing.length === 0) return lines.join('\n')
  lines.push(modelPrompt('envMissing', { missing: missing.join(', ') }))
  return lines.join('\n')
}

/** Render a fenced machine's core hello/status for `sw_status`. */
export function renderCoreEnv(view: CoreStatusView): string {
  if (view.ok === true && view.version !== undefined) {
    return modelPrompt('envCore', {
      version: view.version,
      arch: view.arch ?? 'unknown',
      caps: (view.caps ?? []).join(', ') || 'none',
    })
  }
  return modelPrompt('envCoreMissing', { detail: view.detail ?? 'core not installed' })
}

/** Ping result: the render text plus a structured ok/detail pair for composition. */
interface PingResult {
  ok: boolean
  /** The model-visible text line. */
  text: string
  /** The failure reason (model-visible; also feeds the sw_connect failure error). */
  detail: string
}

/** Ping the active connection with a bounded budget (never hangs the tool). */
async function pingActive(registry: SshRegistry, tr: TranslateFn): Promise<PingResult> {
  const active = registry.getActive()
  if (active === null) return { ok: false, text: tr('tool.common.noActive'), detail: tr('tool.common.noActive') }
  const prefix = `${active.spec.username}@${active.spec.host}:${active.spec.port}`
  try {
    const outcome = await active.connection.exec('echo ok', { signal: AbortSignal.timeout(8_000) })
    if (outcome.exitCode === 0) {
      const echo = outcome.stdout.replace(/\s+/g, ' ').trim() || 'echo ok'
      return { ok: true, text: tr('tool.sw_status.ping.ok', { prefix, outcome: echo }), detail: '' }
    }
    const detail = (outcome.stderr || outcome.stdout || `exit ${String(outcome.exitCode)}`).trim()
    return { ok: false, text: tr('tool.sw_status.ping.failed', { detail }), detail }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, text: tr('tool.sw_status.ping.failed', { detail }), detail }
  }
}

/** Probe the remote toolbox (bash/pwsh/rg) with the same bounded budget. */
async function remoteEnvLine(registry: SshRegistry, hub?: CoreHub): Promise<string> {
  const active = registry.getActive()
  if (active === null) return ''
  const id = active.spec.id
  if (hub !== undefined) {
    try {
      const view = await hub.status(id, AbortSignal.timeout(8_000))
      if (view.ok) return renderCoreEnv(view)
    } catch {
      return renderCoreEnv({ ok: false, detail: 'core status failed' })
    }
  }
  try {
    const outcome = await active.connection.exec(remoteEnvProbeCommand(), { signal: AbortSignal.timeout(8_000) })
    if (outcome.exitCode !== 0) return ''
    return renderRemoteEnvProbe(parseRemoteEnvProbe(outcome.stdout))
  } catch {
    // Connectivity already reported by pingActive.
    return ''
  }
}

/**
 * sw_connect parameter spec builder (descriptions localized per language).
 * REQ-I11 / ADR-0021 §2.1: EXACTLY one property — an array of registry machine
 * ids. The former `host/username/port/password/privateKeyPath/save` face is gone
 * for two structural reasons: credential material must never be a model tool
 * parameter (`tool/call` arguments are persisted verbatim into the session log —
 * SEC-5), and the machine universe is the user's registry, so the model cannot
 * silently add machines to the user's domain.
 */
const swConnectParams = (tr: TranslateFn): ParameterSchemaSpec => ({
  machines: {
    type: 'array',
    items: { type: 'string' },
    required: true,
    description: tr('tool.sw_connect.param.machines'),
  },
})

/** REQ-I11: the session id of one tool run (leaf read; `undefined` ⇒ fail closed). */
function sessionIdOfExec(exec: ToolRunContext): string | undefined {
  return sessionIdOf(exec.agent !== undefined ? { scope: exec.agent as object } : {})
}

/** The session cwd the tools read (leaf field only). */
function sessionCwdOfExec(exec: ToolRunContext): string | undefined {
  const agent = exec.agent as { readonly session?: { readonly header?: { readonly cwd?: string } } } | undefined
  return agent?.session?.header?.cwd
}

/**
 * Register the sw_status / sw_connect tools plus the per-session workspace
 * prompt contributions on the given context. All side effects are effect-bound, so an
 * unloaded row removes every tool, section and runtime-context entry.
 * @param ctx - the mounting context.
 * @param registry - the machine registry accessor.
 * @param sides - the side-workspace store accessor (absent → no attachments).
 * @param connections - the connected-machine store accessor (absent → no session
 *   connections; the `sw_connect` tool then reports the missing store instead of
 *   silently pretending the session switched anything on).
 */
export function registerWorkspaceTools(
  ctx: Context,
  registry: () => SshRegistry,
  sides: () => SessionSideWorkspaceStore | undefined,
  connections: () => SessionConnectionsFace | undefined,
): void {
  const locale = hostLocaleOf(ctx)
  const t = locale.t
  const machineFaceOf = (id: string): PromptMachineFace | undefined =>
    registry().listMachines().machines.find(entry => entry.id === id)
  /** REQ-I11: the session's connected ids (store ∪ implicit main machine). */
  const connectedIdsOf = (sessionId: string | undefined, cwd: string | undefined): string[] => {
    if (sessionId === undefined) return []
    const ids = [...(connections()?.listFor(sessionId) ?? [])]
    const route = remoteRouteFromCwd(cwd)
    if (route !== null && !ids.includes(route.connectionId) && registry().get(route.connectionId) !== undefined) {
      ids.unshift(route.connectionId)
    }
    return ids
  }
  /** REQ-I11: the prompt facts of the session's connected set (implicit first). */
  const connectedFactsOf = (sessionId: string | undefined, cwd: string | undefined): ConnectedMachineFact[] =>
    connectedIdsOf(sessionId, cwd).map(id => connectedMachineFact(id, machineFaceOf(id)))
  const tools = [
    localizeTool(defineTool({
      name: 'sw_status',
      description: ZH_T('tool.sw_status.description'),
      parameters: {},
      output: {
        schema: textOutSchema,
        render: (_args, value): Array<{ type: 'text'; text: string }> => [{ type: 'text', text: value.text }],
      },
      async execute(_args: unknown, exec: ToolRunContext): Promise<{ text: string }> {
        const instance = registry()
        const status = instance.status()
        const sessionId = sessionIdOfExec(exec)
        const cwd = sessionCwdOfExec(exec)
        const lines = [
          t('tool.sw_status.outputs.host', {
            u: status.username || '<user>',
            h: status.host || '<host>',
            p: status.port,
            source: status.activeSource !== 'machine' ? ` (source: ${status.activeSource})` : '',
          }),
          status.workspace
            ? t('tool.sw_status.outputs.workspace', { ws: status.workspace })
            : t('tool.sw_status.outputs.workspaceNone'),
          t('tool.sw_status.outputs.connected', { yesno: status.connected ? 'yes' : 'no' }),
          // REQ-I11 (ADR-0021 §2.5): the session's own connected set — the ids
          // sw_exec accepts here — kept next to the registry-wide facts.
          renderConnectedStatusLine(connectedIdsOf(sessionId, cwd), machineFaceOf, t),
          t('tool.sw_status.outputs.hostKey', {
            trusted: status.hostKeyKnown ? 'trusted' : 'not yet trusted',
            mode: status.hostKeyMode,
          }),
          t('tool.sw_status.outputs.backend', { backend: status.backend }),
        ]
        lines.push((await pingActive(instance, t)).text)
        lines.push(await remoteEnvLine(instance, coreHubOf(ctx)))
        return { text: lines.join('\n') }
      },
    }), locale, { descriptionKey: 'tool.sw_status.description', buildParams: () => ({}) }),
    localizeTool(defineTool({
      name: 'sw_connect',
      description: ZH_T('tool.sw_connect.description'),
      parameters: swConnectParams(ZH_T),
      output: {
        schema: textOutSchema,
        render: (_args, value): Array<{ type: 'text'; text: string }> => [{ type: 'text', text: value.text }],
      },
      async execute(args: { machines: string[] }, exec: ToolRunContext): Promise<{ text: string }> {
        const sessionId = sessionIdOfExec(exec)
        if (sessionId === undefined) throw new Error(t('tool.sw_connect.error.noSession'))
        const store = connections()
        if (store === undefined) throw new Error(t('tool.sw_connect.error.storeMissing'))
        const instance = registry()
        const known = instance.listMachines().machines.map(machine => machine.id)
        const requested = [...new Set(
          (Array.isArray(args.machines) ? args.machines : [])
            .map(id => String(id ?? '').trim())
            .filter(id => id !== ''),
        )]
        const unknown = requested.filter(id => !known.includes(id))
        if (unknown.length > 0) {
          throw new Error(t('tool.sw_connect.error.unknownMachine', {
            ids: unknown.join(', '),
            known: known.length > 0 ? known.join(', ') : t('tool.sw_connect.error.noKnownMachines'),
          }))
        }
        // ADR-0021 §2.2: `[]` disconnects everything — no ping, no partial state.
        if (requested.length === 0) {
          store.set(sessionId, [])
          return { text: t('tool.sw_connect.output.cleared') }
        }
        const probes = await probeMachines(instance, requested)
        const reachable = probes.filter(probe => probe.ok)
        // Atomicity: an all-unreachable request THROWS and leaves the stored set
        // exactly as it was — a failed switch must never half-apply.
        if (reachable.length === 0) {
          const details = probes
            .map(probe => t('tool.sw_connect.output.unreachable', {
              id: probe.id,
              detail: probe.detail === '' ? t('tool.sw_connect.error.noDetail') : probe.detail,
            }))
            .join('\n')
          throw new Error(t('tool.sw_connect.error.allUnreachable', { details }))
        }
        store.set(sessionId, reachable.map(probe => probe.id))
        // Honest per-machine report: the resulting connected set, one line each,
        // including the machines that did NOT answer (they are not connected).
        const lines = [t('tool.sw_connect.output.heading')]
        for (const probe of probes) {
          const endpoint = `${machineFaceOf(probe.id)?.username ?? '<user>'}@${machineFaceOf(probe.id)?.host ?? '<host>'}`
          lines.push(probe.ok
            ? t('tool.sw_connect.output.reachable', { id: probe.id, endpoint })
            : t('tool.sw_connect.output.unreachable', {
              id: probe.id,
              detail: probe.detail === '' ? t('tool.sw_connect.error.noDetail') : probe.detail,
            }))
        }
        return { text: lines.join('\n') }
      },
    }), locale, {
      descriptionKey: 'tool.sw_connect.description',
      buildParams: swConnectParams,
    }),
  ]

  for (const tool of tools) {
    const disposer = ctx.tools.register(tool)
    ctx.effect(() => disposer, `sw-remote tool ${tool.name}`)
  }

  /**
   * R4 远程认知 + R5 副工作区 + REQ-I11 会话连接：按会话注入工作区提示。
   *
   * 注入点选型（侦察结论）：全局 section + `text(context)` 按 scope 反查会话
   * （方案 B）。每个 assembly 的 `context.scope` 就是该会话的 agent 实例
   * （dsh-agent-loop 的 `assembleContextFor` 返回 `{ agent, scope: agent }`；
   * 每会话 scope key 由 `ReactLoopAgent` 构造时的 `createScope(loopCtx, this)`
   * mint），agent 暴露 `session.header`（叶子字段：cwd + id）。因此：
   * - 本地会话无副工作区、无连接机器：远程事实为空、易变清单为空 → ''，零注入。
   * - 远程会话（cwd = `ssh://<id>/…` 或占位树）：按 route 找机器渲染强调提示。
   * - 不选方案 A（session/created 里为会话 createScope + 注册 scoped section）：
   *   注册需要持有一份带该 scope 标签的 ctx——agent 的 scoped ctx 对宿主行不可见；
   *   用同一 key 自行 createScope 会让两个 fiber 共存、section 生命周期无法跟随
   *   会话卸载（泄漏到进程退出且 key 又是每会话唯一的，无法回收）。
   * - 「当前 remote」旧文案（全局单行）已删除：它按「全局 active 机器」注入，
   *   本地会话也会看到远端信息；新文案只按「本会话上下文」注入。
   * - REQ-I6 ①：本 section 的文案是 **model-facing 英文常量**（`src/model-prompts.ts`），
   *   不随 UI 语言切换（ADR-0014）。
   *
   * REQ-I11（ADR-0021 §2.8）**两段分工**：
   * - **稳定框架**（远程强调 + `remoteNoSandbox` + `remoteGateActive`）留在这条
   *   `section('sw-remote', order 90)`；
   * - **易变状态**（本会话已连接机器清单 + 副根清单）走
   *   `systemPrompt.context({ name: 'dsw-session-workspace', order 90 })`——
   *   `context()` 的契约是「每次 assembly 求值、以耐久 user-role 快照进入对话」，
   *   这正是「会话中途插入一条状态注记」的正典机制（宿主自己的运行时上下文也走
   *   它，`suppressRuntimeContext()` 是官方静音口）。放进 section 只会让状态变化
   *   等到下一次头部 prompt 重写才可见。
   * - 两段在「无远程事实」时都返回 '' ⇒ 本地零连接会话零注入；
   *   清单**只在 context 里渲染一次**，section 不再重复。
   */
  const sectionDisposer = ctx.systemPrompt.section({
    name: 'sw-remote',
    order: 90,
    text: (context) => {
      const { cwd } = sessionWorkspaceContextOf(context, sides)
      const route = cwd !== undefined ? remoteRouteFromCwd(cwd) : null
      if (route === null) return ''
      const machine = registry().listMachines().machines.find(entry => entry.id === route.connectionId)
      return composeWorkspacePrompt(cwd, machine, [])
    },
  })
  ctx.effect(() => sectionDisposer, 'sw-remote system prompt section')
  const contextDisposer = ctx.systemPrompt.context({
    name: 'dsw-session-workspace',
    order: 90,
    text: (context) => {
      const { cwd, sides: attached } = sessionWorkspaceContextOf(context, sides)
      return renderSessionWorkspaceContext(connectedFactsOf(sessionIdOf(context), cwd), attached)
    },
  })
  ctx.effect(() => contextDisposer, 'dsw-session-workspace runtime context')

  // S1+S2 + REQ-I16: sw_exec always (server-parameterized remote execution);
  // win32 bash is injected per remote-cwd session (not globally).
  // `sides`/`connections` are passed on so both tools can decide per session
  // (REQ-I6 ② prompt zero-injection + REQ-I11 server gate).
  registerSwExec(ctx, registry, { sides, connections })
  // REQ-I16: scoped onto agent.ctx when the session cwd is a remote Linux
  // workspace. The session gate still applies at execute time.
  registerWin32Bash(ctx, registry, { sides, connections })
}
