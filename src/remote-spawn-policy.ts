/**
 * REQ-I18 → REQ-I27 / ADR-0031 §3.3 RETIRED the one-shot policy store: the
 * policy now travels INSIDE the confine product (`remote-confine-policy.ts`)
 * because every official entry — including any future one — calls
 * `ctx.sandbox.confine` (BUG-12 was exactly a new entry this bridge missed).
 *
 * What REMAINS here is the world pinning: the official shell's workdir is
 * pinned to the session world (ADR-0028, `region-exec`) and the
 * `dswLocalExec` bypass flag for `sw_exec(server: "local")` on Linux.
 *
 * @module dsh-workspace-enhancement/remote-spawn-policy
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { pinBashWorkdir, pinPwshWorkdir, sessionLocalCwd } from './region-exec.ts'
import { initiatorEffectiveCwdOf } from './remote-policy.ts'
import { sessionLocalSideRoots } from './side-root-policy.ts'

/** Set while `sw_exec(server: "local")` is inside the host shell. */
const hostLocalExec = new AsyncLocalStorage<true>()
const workdirStore = new AsyncLocalStorage<string>()

/** True only inside a host-local shell call (`dswLocalExec`). */
export function isHostLocalShellExec(): boolean {
  return hostLocalExec.getStore() === true
}

/** The workdir of the shell call being confined (REQ-I24 side-root pick). */
export function currentShellWorkdir(): string | undefined {
  return workdirStore.getStore()
}

/** Enter the workdir around one shell entry (the policy overlay is gone —
 * the confine registry carries it now, ADR-0031 §3.3). */
function enterShellCall<T>(spec: ShellSpec, fn: () => T): T {
  if (typeof spec.workdir !== 'string') return fn()
  return workdirStore.run(spec.workdir, fn)
}

interface ShellFace {
  run?: (spec: ShellSpec) => unknown
  start?: (spec: ShellSpec) => unknown
  /** 0.2.0 family: request → spec; drops fields it does not know. */
  resolve?: (request: ShellSpec) => ShellSpec
  /** 0.2.0 family: the only spawn entry (`run` / `start` are gone). */
  execute?: (spec: ShellSpec) => unknown
}

interface ShellSpec {
  sandboxPolicy?: unknown
  workdir?: string
  /** Set by `sw_exec(server: "local")` so the pin does not send it remote. */
  dswLocalExec?: boolean
  [key: string]: unknown
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
  const sessionCwd = initiatorEffectiveCwdOf(ctx)
  if (process.platform === 'win32') {
    const next = pinPwshWorkdir(spec.workdir, sessionLocalCwd(sessionLocalSideRoots(ctx), homedir()))
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
      const local = spec?.dswLocalExec === true
      const next = adjustShellSpec(owner, spec ?? {})
      const call = () => enterShellCall(next, () => original(next))
      return local ? hostLocalExec.run(true, call) : call()
    }
  }
  if (typeof shell.start === 'function') {
    const original = shell.start.bind(shell)
    shell.start = (spec) => {
      const local = spec?.dswLocalExec === true
      const next = adjustShellSpec(owner, spec ?? {})
      const call = () => enterShellCall(next, () => original(next))
      return local ? hostLocalExec.run(true, call) : call()
    }
  }
  // BUG-12: the 0.2.0 tools call `resolve` then `execute`. The world pin runs
  // on the resolved spec (its workdir is always filled), and the local flag is
  // re-stamped because the official `resolve` drops unknown fields.
  if (typeof shell.resolve === 'function') {
    const original = shell.resolve.bind(shell)
    shell.resolve = (request) => {
      const local = request?.dswLocalExec === true
      const resolved = original(adjustShellSpec(owner, request ?? {}))
      if (local) return { ...resolved, dswLocalExec: true }
      return adjustShellSpec(owner, resolved)
    }
  }
  if (typeof shell.execute === 'function') {
    const original = shell.execute.bind(shell)
    shell.execute = (spec) => {
      const local = spec?.dswLocalExec === true
      const next = adjustShellSpec(owner, spec ?? {})
      const call = () => enterShellCall(next, () => original(next))
      return local ? hostLocalExec.run(true, call) : call()
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
