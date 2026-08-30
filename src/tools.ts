/**
 * `sw_*` workspace tools and the per-session remote-context system-prompt
 * section of dsh-workspace-enhancement, riding the machine registry. Three
 * management tools only: status/connect/pick-workspace. The registry's own
 * `connections.*` RPC surface stays separate; tools are the model's control
 * plane and never enumerate the file/execution tools (those belong to the
 * seam engine).
 * @module dsh-workspace-enhancement/tools
 */

import { basename, posix } from 'node:path'
import type { Stats } from 'ssh2'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { registerSwExec, registerWin32Bash } from './exec-tools.ts'
import { lookup, type TranslateFn } from './locale/index.ts'
import { hostLocaleOf, localizeTool } from './locale/host.ts'
import type { SshRegistry, MachineInput } from './registry.ts'
import { remoteRouteFromCwd, sshRoutesRoot } from './transport.ts'
import type { RemoteRouteRef } from './transport.ts'
import type { SessionSideWorkspaceStore, SideWorkspaceItem } from './session-workspaces.ts'

/** Pure text output contract shared by every sw_* tool. */
const textOutSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string', required: true } },
} as const

/**
 * Fixed-ZH translator — the legacy default of the prompt renderers: their
 * pre-i18n copy was Chinese, and the render tests pin that output. The live
 * section callback passes the host-language translator instead.
 */
const ZH_T: TranslateFn = (key, params) => lookup('zh', key, params)

/** The machine facts the prompt reads (leaf fields only, no live objects). */
export interface PromptMachineFace {
  username: string
  host: string
  workspace?: string
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

/** Render the one emphasis paragraph of the remote-workplace prompt (order 90). */
export function renderRemotePrompt(fact: RemotePromptFact, tr: TranslateFn = ZH_T): string {
  return tr('prompt.remote.emphasis', {
    endpoint: fact.endpoint,
    displayPath: fact.displayPath,
    placeholderRoot: fact.placeholderRoot,
    connectionId: fact.connectionId,
  })
}

/** The permission fact one side workspace renders as. */
export interface SideWorkspacePromptFact {
  label: string
  /** Display root: `ssh://<id>/<path>` for remote, absolute local path otherwise. */
  rootKey: string
  /** `只读` | `读写` */
  fs: string
  /** `开` | `关` */
  exec: string
}

/** Pure prompt projection of one side workspace (leaf fields only). */
export function sideWorkspacePromptFact(item: SideWorkspaceItem, tr: TranslateFn = ZH_T): SideWorkspacePromptFact {
  return {
    label: item.label,
    rootKey: item.rootKey,
    fs: item.fs === 'r' ? tr('prompt.side.fs.r') : tr('prompt.side.fs.rw'),
    exec: item.exec === 'off' ? tr('prompt.side.exec.off') : tr('prompt.side.exec.on'),
  }
}

/**
 * R5: render the attached side-workspace list for the per-session prompt.
 * Empty list → `''` (zero noise for sessions without attachments). The closing
 * sentence states the enforcement boundary honestly: the exec gate covers the
 * workspace world (spawn cwd / program path), not path text inside a command.
 */
export function renderSideWorkspaces(items: readonly SideWorkspaceItem[], tr: TranslateFn = ZH_T): string {
  if (items.length === 0) return ''
  const lines = items.map(item => {
    const fact = sideWorkspacePromptFact(item, tr)
    return tr('prompt.side.item', { label: fact.label, rootKey: fact.rootKey, fs: fact.fs, exec: fact.exec })
  })
  return `${tr('prompt.side.heading')}\n${lines.join('\n')}\n${tr('prompt.side.note')}`
}

/**
 * Compose the whole workspace prompt of one session: the R4 remote emphasis
 * (only when the cwd routes remote) plus the R5 side-workspace list (only when
 * attachments exist). Pure and synchronous; an empty result means zero
 * injection.
 */
export function composeWorkspacePrompt(
  cwd: string | undefined,
  machine: PromptMachineFace | undefined,
  sides: readonly SideWorkspaceItem[],
  dshBase?: string,
  tr: TranslateFn = ZH_T,
): string {
  const fact = remotePromptFact(cwd, machine, dshBase)
  const remote = fact !== null ? renderRemotePrompt(fact, tr) : ''
  const side = renderSideWorkspaces(sides, tr)
  return [remote, side].filter(part => part !== '').join('\n\n')
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
 * Legacy default of the probe renderer: pre-i18n the heading was English
 * while the missing-tool hint was Chinese — a mixed output the existing tests
 * pin. The default reproduces it exactly; the live tool path passes the
 * host-language translator instead.
 */
const LEGACY_ENV_PROBE_T: TranslateFn = (key, params) =>
  lookup(key === 'tool.env.heading' ? 'en' : 'zh', key, params)

/** Render the probe as three check lines plus one hint line (never autoload/install). */
export function renderRemoteEnvProbe(probe: RemoteEnvProbe, tr: TranslateFn = LEGACY_ENV_PROBE_T): string {
  const mark = (present: boolean): string => (present ? '✓' : '✗')
  const missing: string[] = []
  if (!probe.bash) missing.push('bash')
  if (!probe.pwsh) missing.push('pwsh')
  if (!probe.rg) missing.push('rg')
  const lines = [
    tr('tool.env.heading'),
    `  bash: ${mark(probe.bash)}`,
    `  pwsh: ${mark(probe.pwsh)}`,
    `  rg: ${mark(probe.rg)}`,
  ]
  if (missing.length === 0) return lines.join('\n')
  lines.push(tr('prompt.env.missing', { missing: missing.join(', ') }))
  return lines.join('\n')
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
async function remoteEnvLine(registry: SshRegistry, tr: TranslateFn): Promise<string> {
  const active = registry.getActive()
  if (active === null) return ''
  try {
    const outcome = await active.connection.exec(remoteEnvProbeCommand(), { signal: AbortSignal.timeout(8_000) })
    if (outcome.exitCode !== 0) return ''
    return renderRemoteEnvProbe(parseRemoteEnvProbe(outcome.stdout), tr)
  } catch {
    // Connectivity already reported by pingActive.
    return ''
  }
}

/** sw_connect parameter spec builder (descriptions localized per language). */
const swConnectParams = (tr: TranslateFn): ParameterSchemaSpec => ({
  host: { type: 'string', required: true, description: tr('tool.sw_connect.param.host') },
  username: { type: 'string', description: tr('tool.sw_connect.param.username') },
  port: { type: 'integer', description: tr('tool.sw_connect.param.port') },
  password: { type: 'string', description: tr('tool.sw_connect.param.password') },
  privateKeyPath: { type: 'string', description: tr('tool.sw_connect.param.privateKeyPath') },
  save: { type: 'boolean', description: tr('tool.sw_connect.param.save') },
})

/** sw_pick_workspace parameter spec builder. */
const swPickWorkspaceParams = (tr: TranslateFn): ParameterSchemaSpec => ({
  path: { type: 'string', required: true, description: tr('tool.sw_pick_workspace.param.path') },
})

/**
 * Register the three sw_* tools plus the per-session workspace-context prompt
 * section on the given context. All side effects are effect-bound, so an
 * unloaded row removes every tool and the prompt section.
 * @param ctx - the mounting context.
 * @param registry - the machine registry accessor.
 * @param sides - the side-workspace store accessor (absent → no attachments).
 */
export function registerWorkspaceTools(ctx: Context, registry: () => SshRegistry, sides: () => SessionSideWorkspaceStore | undefined): void {
  const locale = hostLocaleOf(ctx)
  const t = locale.t
  const tools = [
    localizeTool(defineTool({
      name: 'sw_status',
      description: ZH_T('tool.sw_status.description'),
      parameters: {},
      output: {
        schema: textOutSchema,
        render: (_args, value): Array<{ type: 'text'; text: string }> => [{ type: 'text', text: value.text }],
      },
      async execute(): Promise<{ text: string }> {
        const instance = registry()
        const status = instance.status()
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
          t('tool.sw_status.outputs.hostKey', {
            trusted: status.hostKeyKnown ? 'trusted' : 'not yet trusted',
            mode: status.hostKeyMode,
          }),
          t('tool.sw_status.outputs.backend', { backend: status.backend }),
        ]
        lines.push((await pingActive(instance, t)).text)
        lines.push(await remoteEnvLine(instance, t))
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
      async execute(args: {
        host: string
        username?: string
        port?: number
        password?: string
        privateKeyPath?: string
        save?: boolean
      }): Promise<{ text: string }> {
        const instance = registry()
        const host = String(args.host ?? '').trim()
        if (host === '') throw new Error(t('tool.sw_connect.error.hostRequired'))
        const input: MachineInput = {
          host,
          label: host,
          name: host,
          ...(args.username !== undefined && args.username !== '' ? { username: args.username } : {}),
          ...(args.port !== undefined ? { port: args.port } : {}),
          ...(args.password !== undefined && args.password !== '' ? { password: args.password } : {}),
          ...(args.privateKeyPath !== undefined && args.privateKeyPath !== '' ? { privateKeyPath: args.privateKeyPath } : {}),
        }
        let id: string
        if (args.save !== false) {
          const saved = await instance.connectUpsert(input)
          id = saved.id
        } else {
          id = instance.connectTemporary(input).id
        }
        const ping = await pingActive(instance, t)
        if (!ping.ok) {
          throw new Error(t('tool.sw_connect.error.connectFailed', { host, detail: ping.detail }))
        }
        return { text: t('tool.sw_connect.output', { host, id }) }
      },
    }), locale, {
      descriptionKey: 'tool.sw_connect.description',
      buildParams: swConnectParams,
    }),
    localizeTool(defineTool({
      name: 'sw_pick_workspace',
      description: ZH_T('tool.sw_pick_workspace.description'),
      parameters: swPickWorkspaceParams(ZH_T),
      output: {
        schema: textOutSchema,
        render: (_args, value): Array<{ type: 'text'; text: string }> => [{ type: 'text', text: value.text }],
      },
      async execute(args: { path: string }): Promise<{ text: string }> {
        const path = String(args.path ?? '').trim()
        if (path === '' || !posix.isAbsolute(path)) {
          throw new Error(t('tool.sw_pick_workspace.error.invalidPath', { path: JSON.stringify(path) }))
        }
        const instance = registry()
        const active = instance.getActive()
        if (active === null) {
          throw new Error(t('tool.sw_pick_workspace.error.noActive'))
        }
        const sftp = await active.connection.getSftp()
        const stats = await new Promise<Stats>((resolvePromise, reject) => {
          sftp.stat(path, (error, value) => {
            if (error !== undefined) reject(error)
            else resolvePromise(value)
          })
        })
        if (!stats.isDirectory()) {
          throw new Error(t('tool.sw_pick_workspace.error.notDir', { path }))
        }
        instance.setActiveWorkspace(path)
        return { text: t('tool.sw_pick_workspace.output', { path, u: active.spec.username, h: active.spec.host }) }
      },
    }), locale, {
      descriptionKey: 'tool.sw_pick_workspace.description',
      buildParams: swPickWorkspaceParams,
    }),
  ]

  for (const tool of tools) {
    const disposer = ctx.tools.register(tool)
    ctx.effect(() => disposer, `sw-remote tool ${tool.name}`)
  }

  /**
   * R4 远程认知 + R5 副工作区：按会话注入工作区上下文提示。
   *
   * 注入点选型（侦察结论）：全局 section + `text(context)` 按 scope 反查会话
   * （方案 B）。每个 assembly 的 `context.scope` 就是该会话的 agent 实例
   * （dsh-agent-loop 的 `assembleContextFor` 返回 `{ agent, scope: agent }`；
   * 每会话 scope key 由 `ReactLoopAgent` 构造时的 `createScope(loopCtx, this)`
   * mint），agent 暴露 `session.header`（叶子字段：cwd + id）。因此：
   * - 本地会话无副工作区：远程事实为空、副列表为空 → ''，零注入。
   * - 远程会话（cwd = `ssh://<id>/…` 或占位树）：按 route 找机器渲染强调提示。
   * - 含副工作区（session.header.id → store.listFor）：追加副目录清单与权限标记。
   * - 不选方案 A（session/created 里为会话 createScope + 注册 scoped section）：
   *   注册需要持有一份带该 scope 标签的 ctx——agent 的 scoped ctx 对宿主行不可见；
   *   用同一 key 自行 createScope 会让两个 fiber 共存、section 生命周期无法跟随
   *   会话卸载（泄漏到进程退出且 key 又是每会话唯一的，无法回收）。
   * - 「当前 remote」旧文案（全局单行）已删除：它按「全局 active 机器」注入，
   *   本地会话也会看到远端信息；新文案只按「本会话上下文」注入。
   */
  const sectionDisposer = ctx.systemPrompt.section({
    name: 'sw-remote',
    order: 90,
    text: (context) => {
      const agent = context.scope as PromptAgentFace | undefined
      const cwd = agent?.session?.header.cwd
      const sessionId = agent?.session?.header.id
      const attached = sessionId !== undefined ? (sides()?.listFor(sessionId) ?? []) : []
      if (cwd === undefined && attached.length === 0) return ''
      const route = cwd !== undefined ? remoteRouteFromCwd(cwd) : null
      if (route === null && attached.length === 0) return ''
      const machine = route !== null ? registry().listMachines().machines.find(entry => entry.id === route.connectionId) : undefined
      return composeWorkspacePrompt(cwd, machine, attached, undefined, t)
    },
  })
  ctx.effect(() => sectionDisposer, 'sw-remote system prompt section')

  // S1+S2: sw_exec always (server-parameterized remote execution), win32 bash
  // seam on Windows hosts only (the official bash tool owns `bash` + its
  // `tool:bash` section on POSIX; a duplicate registration would fail).
  registerSwExec(ctx, registry)
  registerWin32Bash(ctx, registry)
}
