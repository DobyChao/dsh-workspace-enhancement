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
import type { Context } from '@deepseek-ai/cordis'

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
  run?: (spec: { sandboxPolicy?: unknown }) => unknown
  start?: (spec: { sandboxPolicy?: unknown }) => unknown
}

const patched = new WeakSet<object>()

function patchShell(owner: Context): void {
  if (typeof owner.get !== 'function') return
  const shell = owner.get('shell', false) as ShellFace | undefined
  if (shell === undefined || patched.has(shell)) return
  patched.add(shell)
  if (typeof shell.run === 'function') {
    const original = shell.run.bind(shell)
    shell.run = (spec) => runWithRemoteSpawnPolicy(spec?.sandboxPolicy, () => original(spec))
  }
  if (typeof shell.start === 'function') {
    const original = shell.start.bind(shell)
    shell.start = (spec) => runWithRemoteSpawnPolicy(spec?.sandboxPolicy, () => original(spec))
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
