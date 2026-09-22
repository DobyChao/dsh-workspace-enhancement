/**
 * REQ-I18: carry one call's sandbox policy from the shell executor into
 * `subprocess.spawn`.
 *
 * Official bash/pwsh approve `sandbox_permissions` and stamp the granted mode
 * onto the shell spec. `SubprocessSpawnSpec` has no policy field, and a
 * danger grant never calls `confine`, so the remote core used to keep the
 * sticky session mode. This store is entered around `ctx.shell.run` / `start`
 * (and around our own `sw_exec` / win32 bash spawns) and read once, synchronously,
 * inside `SshSubprocessEngine.spawn`.
 *
 * @module dsh-workspace-enhancement/remote-spawn-policy
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { initiatorSessionOf } from './remote-policy.ts'
import { pinBashWorkdir, pinPwshWorkdir, sessionLocalCwd } from './region-exec.ts'

const storage = new AsyncLocalStorage<unknown>()

/** The policy bound to the current spawn, if a caller entered one. */
export function currentRemoteSpawnPolicy(): unknown {
  return storage.getStore()
}

/**
 * Run `fn` with `policy` visible to {@link currentRemoteSpawnPolicy}.
 * `undefined` does not enter the store, so a non-escalated call keeps the
 * session mode.
 */
export function runWithRemoteSpawnPolicy<T>(policy: unknown, fn: () => T): T {
  if (policy === undefined) return fn()
  return storage.run(policy, fn)
}

interface ShellFace {
  run?: (spec: ShellSpec) => unknown
  start?: (spec: ShellSpec) => unknown
}

interface ShellSpec {
  sandboxPolicy?: unknown
  workdir?: string
  /** Set by `sw_exec(server: "local")` so the pin does not send it remote. */
  dswLocalExec?: boolean
  [key: string]: unknown
}

function localSideRootsOf(ctx: Context): string[] {
  if (typeof ctx.get !== 'function') return []
  const session = initiatorSessionOf(ctx) as { header?: { id?: string } } | undefined
  const sessionId = session?.header?.id
  if (sessionId === undefined) return []
  const store = ctx.get('sideWorkspaces', false) as {
    listFor?: (id: string) => readonly { kind: string; rootKey: string }[]
  } | undefined
  if (store === undefined || typeof store.listFor !== 'function') return []
  const roots: string[] = []
  for (const item of store.listFor(sessionId)) {
    if (item.kind === 'local') roots.push(item.rootKey)
  }
  return roots
}

/**
 * Pin the official shell to its world (ADR-0028). Windows `ctx.shell` is pwsh:
 * a remote spelling stays on this host. Linux `ctx.shell` is bash: a remote
 * main workspace rejects local paths and other machines. `dswLocalExec` is the
 * Linux `sw_exec(server: "local")` bypass and is stripped before the executor.
 */
export function adjustShellSpec(ctx: Context, spec: ShellSpec): ShellSpec {
  if (spec.dswLocalExec === true) {
    const { dswLocalExec: _flag, ...rest } = spec
    return rest
  }
  const sessionCwd = initiatorSessionOf(ctx)?.header?.cwd
  if (process.platform === 'win32') {
    const next = pinPwshWorkdir(spec.workdir, sessionLocalCwd(localSideRootsOf(ctx), homedir()))
    if (next === spec.workdir) return spec
    return { ...spec, ...(next !== undefined ? { workdir: next } : {}) }
  }
  const next = pinBashWorkdir(spec.workdir, sessionCwd)
  if (next === spec.workdir) return spec
  return { ...spec, ...(next !== undefined ? { workdir: next } : {}) }
}

const patched = new WeakSet<object>()

function patchShell(owner: Context): void {
  if (typeof owner.get !== 'function') return
  const shell = owner.get('shell', false) as ShellFace | undefined
  if (shell === undefined || patched.has(shell)) return
  patched.add(shell)
  if (typeof shell.run === 'function') {
    const original = shell.run.bind(shell)
    shell.run = (spec) => {
      const next = adjustShellSpec(owner, spec ?? {})
      return runWithRemoteSpawnPolicy(next.sandboxPolicy, () => original(next))
    }
  }
  if (typeof shell.start === 'function') {
    const original = shell.start.bind(shell)
    shell.start = (spec) => {
      const next = adjustShellSpec(owner, spec ?? {})
      return runWithRemoteSpawnPolicy(next.sandboxPolicy, () => original(next))
    }
  }
}

/**
 * Bind `ctx.shell` run/start so the spec's `sandboxPolicy` is visible to the
 * remote spawn they perform. Safe when `shell` is not provided yet.
 */
export function installRemoteSpawnPolicyBridge(ctx: Context): void {
  patchShell(ctx)
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['shell'], (owner) => { patchShell(owner) })
}
