/**
 * REQ-I5 / ADR-0024 §6: identity of a *running* `dsh-core serve`.
 *
 * Disk artifact and SSH keepalive are other layers. This module only answers
 * "which jail process should this call reuse?" — POSIX prefix math, no SSH.
 *
 * @module dsh-workspace-enhancement/core-session
 */

import { posix } from 'node:path'
import type { CoreServeSandbox } from './remote-policy.ts'

export type { CoreServeSandbox } from './remote-policy.ts'

/** Kill an idle serve this many ms after the last RPC, when no spawn job is held. */
export const CORE_IDLE_MS = 10 * 60 * 1000

/**
 * Absolute POSIX directory (or file) used as a jail root / containment probe.
 * Relative, drive-letter, and empty spellings are not roots.
 */
export function normalizePosixRoot(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '' || !posix.isAbsolute(trimmed)) return undefined
  const cleaned = posix.normalize(trimmed)
  if (cleaned === '/') return '/'
  return cleaned.replace(/\/+$/u, '')
}

/** POSIX prefix containment — same rule as `posixInside` in `core/serve.go`. */
export function posixInside(root: string, path: string): boolean {
  const ws = normalizePosixRoot(root)
  const got = normalizePosixRoot(path)
  if (ws === undefined || got === undefined) return false
  if (got === ws) return true
  const prefix = ws.endsWith('/') ? ws : `${ws}/`
  return got.startsWith(prefix)
}

/** Longest declared root that contains `path`, or `undefined`. */
export function longestContainingRoot(roots: readonly string[], path: string): string | undefined {
  let best: string | undefined
  for (const root of roots) {
    const normalized = normalizePosixRoot(root)
    // `/` contains every POSIX path; using it as a workspace-write jail
    // remounts the host (`bwrap --bind / /`) and leaks `/tmp` (R27 step 4).
    if (normalized === undefined || normalized === '/' || !posixInside(normalized, path)) continue
    if (best === undefined || normalized.length > best.length) best = normalized
  }
  return best
}

/** Deduped absolute POSIX roots, first-seen order. */
export function uniquePosixRoots(values: readonly (string | undefined)[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizePosixRoot(value)
    if (normalized === undefined || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/**
 * Official git tools pass `GIT_DIR` (`.git` or `…/.git/HEAD`) as cwd. That
 * path is often missing on a fresh remote tree; bwrap `--bind` then dies with
 * `Can't find source path …/.git`. The writable jail is the working tree.
 */
export function gitWorkingTreeOf(path: string): string {
  const root = normalizePosixRoot(path)
  if (root === undefined) return path
  if (root === '/.git') return '/'
  if (root.endsWith('/.git')) return root.slice(0, -'/.git'.length)
  const marker = '/.git/'
  const index = root.indexOf(marker)
  if (index >= 0) {
    const tree = root.slice(0, index)
    return tree === '' ? '/' : tree
  }
  return root
}

/** Cache key for one serve process. `read-only` and `off` ignore workspace. */
export function coreSessionKey(
  connectionId: string,
  mode: CoreServeSandbox,
  workspace?: string,
): string {
  if (mode === 'read-only' || mode === 'off') return `${connectionId}\0${mode}`
  return `${connectionId}\0workspace-write\0${normalizePosixRoot(workspace) ?? ''}`
}

export interface CoreWorkspaceInput {
  mode: CoreServeSandbox
  machineWorkspace?: string | undefined
  machineCwd?: string | undefined
  /**
   * Session / spawn cwd. May mint a sibling workspace-write jail when nothing
   * already-declared contains it.
   */
  cwd?: string | undefined
  /**
   * Operation path (fs target, browse listing). Never mints a new jail by
   * itself — only matches an already-declared root.
   */
  path?: string | undefined
  /** Roots remembered for this machine until SSH dispose / hub.close. */
  knownRoots?: readonly string[] | undefined
}

/**
 * Jail `--workspace` for a workspace-write call. `read-only` and `off`
 * return `undefined` (one process per machine; `off` skips bwrap).
 */
export function resolveCoreWorkspace(input: CoreWorkspaceInput): string | undefined {
  if (input.mode === 'read-only' || input.mode === 'off') return undefined
  const declared = uniquePosixRoots([
    input.machineWorkspace,
    input.machineCwd,
    ...(input.knownRoots ?? []),
  ])
  const cwd = normalizePosixRoot(input.cwd)
  if (cwd !== undefined) {
    const hit = longestContainingRoot(declared, cwd)
    if (hit !== undefined) return hit
    const minted = gitWorkingTreeOf(cwd)
    if (minted === '/') return declared[0]
    const parent = posix.dirname(minted)
    if (parent !== minted && parent !== '/') {
      const parentHit = longestContainingRoot(declared, parent)
      if (parentHit !== undefined) return parentHit
    }
    return minted
  }
  const path = normalizePosixRoot(input.path)
  if (path !== undefined) {
    const hit = longestContainingRoot(declared, path)
    if (hit !== undefined) return hit
  }
  return declared[0] === '/' ? undefined : declared[0]
}
