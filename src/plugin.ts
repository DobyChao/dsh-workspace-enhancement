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
 * REQ-I13: remote sessions keep the deployment `/permission` default. A
 * remote-cwd `confine` passthrough stops the local runner from wrapping
 * remote argv (ADR-0025). Per-call sandbox policy selects core `--sandbox`.
 *
 * `name: dsh-workspace-enhancement` in cordis.yml is equivalent to the three
 * subpath rows (`dsh-workspace-enhancement/ssh`, `dsh-workspace-enhancement/
 * subprocess`, `dsh-workspace-enhancement/fs`) — except that the mixed wiring
 * only happens on the aggregate row. Subpath rows keep the pure-SSH form for
 * deployments that compose providers individually.
 * @module dsh-workspace-enhancement/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SideRootSandboxedFileSystem } from './side-root-policy.ts'
import SshRuntime from './runtime.ts'
import type { Config } from './runtime.ts'
import SshSubprocessRuntime from './subprocess.ts'
import SshFileSystem from './filesystem.ts'
import { SshSubprocessEngine } from './subprocess.ts'
import { SshFileSystemEngine } from './filesystem.ts'
import { MixedFileSystem, MixedSubprocessRuntime } from './mixed.ts'
import type { FileSystemBranch, SideWorkspaceFace } from './mixed.ts'
import { createRemoteSpawnGate, registerRemoteApprovalAnswerer } from './remote-approval-gate.ts'
import { createRemoteSandboxFence, createRemoteSandboxTerminalGuard } from './remote-sandbox-fence.ts'
import { SessionSideWorkspaceStore } from './session-workspaces.ts'
import { ensureCoreHub } from './core-hub.ts'
import { CoreRoutingFileSystem } from './core-fs.ts'
import { installRemoteConfinePassthrough } from './remote-confine.ts'
import { installRemoteSpawnPolicyBridge } from './remote-spawn-policy.ts'

/**
 * The config mirrors the disabled rows' schema defaults (direct construction
 * bypasses the loader's schemastery resolution): cwd = process.cwd(),
 * diffBasisMaxBytes = 10 MiB (the backend's own default).
 */
const LOCAL_FS_CONFIG = { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 }

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
  // R5 → REQ-I7: the session-attached side-workspace store. Registered as a
  // cordis service ('sideWorkspaces') so the web endpoints and the prompt
  // section resolve the same instance; the mixed filesystem provider routes
  // against it lazily (a missing store means no side workspaces configured —
  // plain R4 behavior). The subprocess facade no longer consults it: the
  // per-root exec gate was retired with the permission model (ADR-0019).
  const sides = (): SideWorkspaceFace | undefined => {
    const value = ctx.get('sideWorkspaces', false) as SessionSideWorkspaceStore | undefined
    return value
  }
  void new SessionSideWorkspaceStore(ctx)

  // Subprocess: the local runtime has no service dependencies, so it can be
  // constructed immediately (the deployment default for local executions).
  // AUDIT-6 (ADR-0020): the remote branch carries the approval gate —
  // optional services (`approval`/`agents`) resolve by name at ask time, so
  // the gate composes in any deployment and no-ops for ungated machines.
  const localSubprocess = new LocalSubprocessRuntime(ctx)
  // REQ-I5: one core hub per process. The fence's job on a fenced machine is
  // to ensure that session is alive and return the original argv; the engine
  // then `spawn.start`s over RPC. Approval still sees unwrapped argv.
  const hub = ensureCoreHub(ctx)
  const fence = createRemoteSandboxFence(ctx, { hub })
  const sshSubprocess = new SshSubprocessEngine(
    ctx,
    createRemoteSpawnGate(ctx),
    fence,
    createRemoteSandboxTerminalGuard(ctx),
    hub,
  )
  ctx.set('subprocess', new MixedSubprocessRuntime(localSubprocess, sshSubprocess))

  const installFs = (owner: Context, localFs: FileSystemBranch): void => {
    const sshFs = new CoreRoutingFileSystem(owner, new SshFileSystemEngine(owner), hub)
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
      const localFs = new SideRootSandboxedFileSystem(owner, LOCAL_FS_CONFIG)
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
  installRemoteConfinePassthrough(ctx)
  installRemoteSpawnPolicyBridge(ctx)
  // AUDIT-6 (ADR-0020 D4): the AI answerer — a prepend `approval/request`
  // waterfall listener that auto-grants only whitelisted commands on
  // `remoteApproval: 'ai'` machines and delegates everything else (including
  // its own failures) to the human answerer. Effect-bound ⇒ reversible.
  registerRemoteApprovalAnswerer(ctx)
  ensureCoreHub(ctx)
  // The mixed providers need the local provider classes (dependencies, so
  // always resolvable); if installation fails anyway, fall back to the
  // pure-SSH mounting so the row never fails harder than before.
  try {
    installMixedProviders(ctx)
  } catch (error) {
    ctx.logger.warn(`dsw: mixed provider install failed, falling back to pure-SSH providers: ${String(error)}`)
    // AUDIT-7: the degraded engine reaches the same `coreHub` service and the
    // same session-policy fence and terminal guard as the shipping path, so a
    // confined session is jailed or refused — never run bare.
    ctx.plugin(SshSubprocessRuntime, createRemoteSpawnGate(ctx))
    ctx.plugin(SshFileSystem)
  }
}
