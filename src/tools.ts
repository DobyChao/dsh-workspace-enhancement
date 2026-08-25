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
export function renderRemotePrompt(fact: RemotePromptFact): string {
  return `⚠ 你当前的工作区是**远程 SSH 工作区**：\`${fact.endpoint}:${fact.displayPath}\`（由本地占位路径 \`${fact.placeholderRoot}\\${fact.connectionId}\\…\` 路由；你看到的占位路径只是路由别名，**所有命令与文件操作都真实发生在远程服务器上**，工作目录为 POSIX 绝对路径）。`
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
export function sideWorkspacePromptFact(item: SideWorkspaceItem): SideWorkspacePromptFact {
  return {
    label: item.label,
    rootKey: item.rootKey,
    fs: item.fs === 'r' ? '只读' : '读写',
    exec: item.exec === 'off' ? '关' : '开',
  }
}

/**
 * R5: render the attached side-workspace list for the per-session prompt.
 * Empty list → `''` (zero noise for sessions without attachments). The closing
 * sentence states the enforcement boundary honestly: the exec gate covers the
 * workspace world (spawn cwd / program path), not path text inside a command.
 */
export function renderSideWorkspaces(items: readonly SideWorkspaceItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map(item => {
    const fact = sideWorkspacePromptFact(item)
    return `- 副工作区 **${fact.label}**：\`${fact.rootKey}\`（fs: ${fact.fs} · exec: ${fact.exec}）`
  })
  return `**本会话额外关联的工作区（副目录，模型可直接操作）**：\n${lines.join('\n')}\n注意权限标记：只读（fs: 只读）拒绝写入，禁执行（exec: 关）拒绝在该目录下运行命令；被拒绝的操作请改用有权限的工作区或请用户调整。`
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
): string {
  const fact = remotePromptFact(cwd, machine, dshBase)
  const remote = fact !== null ? renderRemotePrompt(fact) : ''
  const side = renderSideWorkspaces(sides)
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

/** Render the probe as three check lines plus one hint line (never autoload/install). */
export function renderRemoteEnvProbe(probe: RemoteEnvProbe): string {
  const mark = (present: boolean): string => (present ? '✓' : '✗')
  const missing: string[] = []
  if (!probe.bash) missing.push('bash')
  if (!probe.pwsh) missing.push('pwsh')
  if (!probe.rg) missing.push('rg')
  const lines = [
    'Remote environment:',
    `  bash: ${mark(probe.bash)}`,
    `  pwsh: ${mark(probe.pwsh)}`,
    `  rg: ${mark(probe.rg)}`,
  ]
  if (missing.length === 0) return lines.join('\n')
  lines.push(`提示: 远端缺少 ${missing.join(', ')} —— 安装请在远端执行（仅供参考，不会自动安装）：rg → sudo apt-get install ripgrep；pwsh → https://aka.ms/powershell`)
  return lines.join('\n')
}

/** Ping the active connection with a bounded budget (never hangs the tool). */
async function pingActive(registry: SshRegistry): Promise<string> {
  const active = registry.getActive()
  if (active === null) return 'No active machine — call sw_connect with a host to get started.'
  const prefix = `${active.spec.username}@${active.spec.host}:${active.spec.port}`
  try {
    const outcome = await active.connection.exec('echo ok', { signal: AbortSignal.timeout(8_000) })
    if (outcome.exitCode === 0) {
      return `Ping: OK — ${prefix} (${outcome.stdout.replace(/\s+/g, ' ').trim() || 'echo ok'})`
    }
    return `Ping: FAILED — ${(outcome.stderr || outcome.stdout || `exit ${String(outcome.exitCode)}`).trim()}`
  } catch (error) {
    return `Ping: FAILED — ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Probe the remote toolbox (bash/pwsh/rg) with the same bounded budget. */
async function remoteEnvLine(registry: SshRegistry): Promise<string> {
  const active = registry.getActive()
  if (active === null) return ''
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
 * Register the three sw_* tools plus the per-session workspace-context prompt
 * section on the given context. All side effects are effect-bound, so an
 * unloaded row removes every tool and the prompt section.
 * @param ctx - the mounting context.
 * @param registry - the machine registry accessor.
 * @param sides - the side-workspace store accessor (absent → no attachments).
 */
export function registerWorkspaceTools(ctx: Context, registry: () => SshRegistry, sides: () => SessionSideWorkspaceStore | undefined): void {
  const tools = [
    defineTool({
      name: 'sw_status',
      description:
        'Show the current remote machine (host/user/port), connection health (ping), the current remote workspace, and the host-key policy/state. Call this first to orient, or when an sw_* call fails to check connectivity.',
      parameters: {},
      output: {
        schema: textOutSchema,
        render: (_args, value): Array<{ type: 'text'; text: string }> => [{ type: 'text', text: value.text }],
      },
      async execute(): Promise<{ text: string }> {
        const instance = registry()
        const status = instance.status()
        const lines = [
          `Remote host: ${status.username || '<user>'}@${status.host || '<host>'}:${status.port}${status.activeSource !== 'machine' ? ` (source: ${status.activeSource})` : ''}`,
          `Current remote workspace: ${status.workspace || '(none — call sw_pick_workspace to set one)'}`,
          `Connected: ${status.connected ? 'yes' : 'no'}`,
          `Host key: ${status.hostKeyKnown ? 'trusted' : 'not yet trusted'} (mode=${status.hostKeyMode})`,
          `Password backend: ${status.backend}`,
        ]
        lines.push(await pingActive(instance))
        lines.push(await remoteEnvLine(instance))
        return { text: lines.join('\n') }
      },
    }),
    defineTool({
      name: 'sw_connect',
      description:
        'Connect SSH to a remote host for remote workspace work. Provide host (required), user, optional password or privateKeyPath/port. Defaults to saving the machine to the registry and making it current (save=false keeps it as a temporary connection). Once connected, call sw_pick_workspace to pick the workspace directory this session should work in.',
      parameters: {
        host: { type: 'string', required: true, description: 'Remote host IP or hostname' },
        username: { type: 'string', description: 'SSH user (default root)' },
        port: { type: 'integer', description: 'SSH port (default 22)' },
        password: { type: 'string', description: 'SSH password (prefer SSH key when possible)' },
        privateKeyPath: { type: 'string', description: 'Absolute private-key path' },
        save: { type: 'boolean', description: 'Save this machine to the registry and make it current (default true)' },
      },
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
        if (host === '') throw new Error('sw_connect: host is required')
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
        const ping = await pingActive(instance)
        if (ping.startsWith('Ping: FAILED')) {
          throw new Error(`sw_connect: cannot connect to ${host} — ${ping.slice('Ping: FAILED — '.length)}`)
        }
        return { text: `Connected to ${host} (id=${id}).\n\npick a workspace with sw_pick_workspace (path=<abs>).` }
      },
    }),
    defineTool({
      name: 'sw_pick_workspace',
      description:
        'Set the remote workspace directory this session should treat as its working root on the connected remote. Verifies it exists (a directory); persists it on the active machine (recentWorkspaces keeps the last 8).',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote directory path, e.g. /home/dev/code/project' },
      },
      output: {
        schema: textOutSchema,
        render: (_args, value): Array<{ type: 'text'; text: string }> => [{ type: 'text', text: value.text }],
      },
      async execute(args: { path: string }): Promise<{ text: string }> {
        const path = String(args.path ?? '').trim()
        if (path === '' || !posix.isAbsolute(path)) {
          throw new Error(`sw_pick_workspace: path must be an absolute remote directory path: ${JSON.stringify(path)}`)
        }
        const instance = registry()
        const active = instance.getActive()
        if (active === null) {
          throw new Error('sw_pick_workspace: no active machine — call sw_connect first')
        }
        const sftp = await active.connection.getSftp()
        const stats = await new Promise<Stats>((resolvePromise, reject) => {
          sftp.stat(path, (error, value) => {
            if (error !== undefined) reject(error)
            else resolvePromise(value)
          })
        })
        if (!stats.isDirectory()) {
          throw new Error(`sw_pick_workspace: ${path} is not a directory`)
        }
        instance.setActiveWorkspace(path)
        return { text: `Workspace set to ${path} (active machine: ${active.spec.username}@${active.spec.host}).` }
      },
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
      return composeWorkspacePrompt(cwd, machine, attached)
    },
  })
  ctx.effect(() => sectionDisposer, 'sw-remote system prompt section')
}
