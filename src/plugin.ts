/**
 * One-row aggregate plugin: mounts the shared SSH connection owner plus the
 * MIXED subprocess and filesystem providers — the single implementation of
 * `ctx.subprocess` / `ctx.fs`, routing every call by its working directory
 * (remote routes over SSH, everything else delegates to the local
 * implementations). The local provider rows are disabled by this bundle's
 * patch (cordis.patch.yml) so their service registrations cannot collide with
 * the mixed ones; the sandbox rows and the sandboxed shell executors
 * (`bash-sandbox`/`pwsh-sandbox`) stay enabled and consume the mixed
 * `ctx.subprocess`.
 *
 * R4-I2 执行适配层：远程会话的每会话沙箱模式被固定为 `danger-full-access`
 * （session/created 时写入 `sandbox/mode` 覆盖事件），因此沙箱化的 shell
 * 执行器对远程会话跳过本地跑器包装，`bash -c`/`pwsh -Command` 原样到达远端。
 *
 * `name: dsh-workspace-enhancement` in cordis.yml is equivalent to the three
 * subpath rows (`dsh-workspace-enhancement/ssh`, `dsh-workspace-enhancement/
 * subprocess`, `dsh-workspace-enhancement/fs`) — except that the mixed wiring
 * only happens on the aggregate row. Subpath rows keep the pure-SSH form for
 * deployments that compose providers individually.
 * @module dsh-workspace-enhancement/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import SshRuntime from './runtime.ts'
import type { Config } from './runtime.ts'
import SshSubprocessRuntime from './subprocess.ts'
import SshFileSystem from './filesystem.ts'
import { SshSubprocessEngine } from './subprocess.ts'
import { SshFileSystemEngine } from './filesystem.ts'
import { MixedFileSystem, MixedSubprocessRuntime } from './mixed.ts'
import type { FileSystemBranch, SideWorkspaceFace } from './mixed.ts'
import { remoteRouteFromCwd } from './transport.ts'
import { SessionSideWorkspaceStore } from './session-workspaces.ts'

/**
 * The config mirrors the disabled rows' schema defaults (direct construction
 * bypasses the loader's schemastery resolution): cwd = process.cwd(),
 * diffBasisMaxBytes = 10 MiB (the backend's own default).
 */
const LOCAL_FS_CONFIG = { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 }

/**
 * R4-I2 执行适配层：远程会话的沙箱视图。每会话策略由 dsh-permission-presets
 * 在 session/created 时 pin 成部署默认（如 workspace-write），而 sandbox 化的
 * shell 执行器（bash-sandbox/pwsh-sandbox）在非 full 模式会把命令包进「本地
 * 沙箱 runner」——那是本机路径/本机节点脚本，远端不存在（exit 127）。远程会话
 * 的唯一正确语义是 full：本地沙箱对远端命令没有意义，跳过包装后
 * `bash -c '<command>'` / `pwsh -Command …` 原样经混合 provider 路由到远端。
 * 我们监听 session/created 并在默认 pin 之后追加 `sandbox/mode:
 * danger-full-access`（寄存器顺序在本 bundle 之后，append 成为最后事件，
 * fold 生效）；用户之后在 UI 里主动切换的模式仍是最后事件，按其决定（诚实：
 * 窄模式 + 远程 = 本地 runner 不可用 → 明确失败，绝不静默本地）。
 * @param ctx - the aggregate row's context.
 */
function forceRemoteSandboxMode(ctx: Context): void {
  ctx.on('session/created', (session: Session) => {
    if (remoteRouteFromCwd(session.header.cwd) === null) return
    setSandboxMode(session, 'danger-full-access')
  })
}

/**
 * Install the mixed providers: the LOCAL implementation classes are
 * constructed in THIS fiber (each Service subclass registration makes this
 * row the provider of the seam name), then `ctx.set` swaps the registered
 * value for the routing facade. Consumers that `inject` the seams can only
 * activate once the name is provided, so they always observe the facade —
 * row order does not matter.
 *
 * The composition is deliberately synchronous: provide + set are the only two
 * steps, and no consumer fiber can wake between them (activation runs on a
 * later microtask).
 * @param ctx - the aggregate row's context.
 */
export function installMixedProviders(ctx: Context): void {
  // R5: the session-attached side-workspace store. Registered as a cordis
  // service ('sideWorkspaces') so the web endpoints and the prompt section
  // resolve the same instance; the mixed providers gate against it lazily
  // (a missing store means no side workspaces configured — plain R4 behavior).
  const sides = (): SideWorkspaceFace | undefined => {
    const value = ctx.get('sideWorkspaces', false) as SessionSideWorkspaceStore | undefined
    return value
  }
  void new SessionSideWorkspaceStore(ctx)

  // Subprocess: the local runtime has no service dependencies, so it can be
  // constructed immediately (the deployment default for local executions).
  const localSubprocess = new LocalSubprocessRuntime(ctx)
  const sshSubprocess = new SshSubprocessEngine(ctx)
  ctx.set('subprocess', new MixedSubprocessRuntime(localSubprocess, sshSubprocess, sides))

  const installFs = (owner: Context, localFs: FileSystemBranch): void => {
    const sshFs = new SshFileSystemEngine(owner)
    owner.set('fs', new MixedFileSystem(localFs, sshFs, sides))
  }

  // Filesystem: the deployment's local backend is the SANDBOXED one when a
  // sandbox policy row exists. The SandboxedFileSystem accesses
  // `this.ctx.sandboxPolicy` (properties) at write time, which ONLY resolves
  // through the inject contract — so when a policy is present the delegate is
  // constructed inside `ctx.inject(['sandboxPolicy'])`, whose fiber carries
  // the mapping (and whose provide/set fiber pair is the same child fiber).
  if (ctx.get('sandboxPolicy', false) !== undefined) {
    ctx.inject(['sandboxPolicy'], (owner) => {
      const localFs = new SandboxedFileSystem(owner, LOCAL_FS_CONFIG)
      installFs(owner, localFs)
    })
  } else {
    // No policy row at all: the bare local backend (no service access).
    installFs(ctx, new LocalFileSystem(ctx, LOCAL_FS_CONFIG))
  }
}

/**
 * Mount the aggregate plugin.
 * @param ctx - the mounting Cordis context.
 * @param config - the shared SSH connection configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(SshRuntime, config)
  forceRemoteSandboxMode(ctx)
  // The mixed providers need the local provider classes (dependencies, so
  // always resolvable); if installation fails anyway, fall back to the
  // pure-SSH mounting so the row never fails harder than before.
  try {
    installMixedProviders(ctx)
  } catch (error) {
    ctx.logger.warn(`dsw: mixed provider install failed, falling back to pure-SSH providers: ${String(error)}`)
    ctx.plugin(SshSubprocessRuntime)
    ctx.plugin(SshFileSystem)
  }
}
