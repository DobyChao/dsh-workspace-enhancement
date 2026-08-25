/**
 * Mixed execution-world providers for the `subprocess` and `fs` capability
 * seams: ONE service implementation for each seam routes every call by its
 * working directory / target key.
 *
 * - remote world — `ssh://<id>/<path>`, the `dsw-routes/<id>/…` placeholder
 *   tree, and the legacy `dsh-ssh-routes/<id>/…` tree (a session created from
 *   the remote workspace flow carries one of these as its header cwd) — runs
 *   over the registry-owned SSH transport ({@link SshSubprocessEngine} /
 *   {@link SshFileSystemEngine}).
 * - local world — everything else, including an absent cwd — delegates to the
 *   LOCAL provider implementation re-imported from the seam packages
 *   (`LocalSubprocessRuntime`, `SandboxedFileSystem`).
 *
 * This is the R4-I2 engine-routing fix: the model-facing tools
 * (`tool-bash`/`tool-pwsh`/`tool-fs`) stay bound to `ctx.subprocess`/
 * `ctx.fs`/`ctx.shell` exactly as shipped, and the routing happens inside the
 * services, so a remote workspace session executes its commands and file
 * operations on the server while a local session keeps today's local
 * behavior (including the sandbox fences).
 * @module dsh-workspace-enhancement/mixed
 */

import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsVersion,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import { FsError } from '@deepseek-ai/dsh-fs'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { parseSshTargetKey, remoteRouteFromCwd } from './transport.ts'
import { parseSshRoute } from './registry.ts'
import type { SshSubprocessEngine } from './subprocess.ts'
import type { SshFileSystemEngine } from './filesystem.ts'
import type { SideWorkspaceItem } from './session-workspaces.ts'

/**
 * R5: the side-workspace face the mixed providers gate against — the store's
 * `match(path)` (longest owning root) plus the permission leaves only.
 */
export interface SideWorkspaceFace {
  match(path: string): SideWorkspaceItem | undefined
}

/** Resolve the owning side workspace of one operation path (no store → none). */
function sideWorkspaceOf(
  sides: (() => SideWorkspaceFace | undefined) | undefined,
  path: string,
): SideWorkspaceItem | undefined {
  if (sides === undefined || typeof path !== 'string' || path === '') return undefined
  return sides()?.match(path)
}

/** R5 T3: the fs write gate — a `fs: 'r'` side workspace rejects every write. */
function assertSideWriteAllowed(
  sides: (() => SideWorkspaceFace | undefined) | undefined,
  targetKey: string,
  displayPath: string,
): void {
  const side = sideWorkspaceOf(sides, targetKey)
  if (side !== undefined && side.fs !== 'rw') {
    throw new FsError(
      `cannot write "${displayPath}": the side workspace "${side.label}" is read-only (fs: r). Adjust its permission or use a writable workspace.`,
      'FS_PERMISSION_DENIED',
    )
  }
}

/** R5 T4: the exec gate — an `exec: 'off'` side workspace rejects spawns in its world. */
function assertSideExecAllowed(
  sides: (() => SideWorkspaceFace | undefined) | undefined,
  cwd: string | undefined,
  argv0: string | undefined,
): void {
  const viaCwd = cwd !== undefined ? sideWorkspaceOf(sides, cwd) : undefined
  const viaProgram = argv0 !== undefined && argv0.length > 0 ? sideWorkspaceOf(sides, argv0) : undefined
  const side = viaCwd ?? viaProgram
  if (side !== undefined && side.exec === 'off') {
    throw new Error(
      `dsw: execution is disabled for the side workspace "${side.label}" (exec: off). Use a workspace with exec enabled or ask the user to adjust the permission.`,
    )
  }
}

/** The two execution worlds a mixed provider can route one call to. */
export type ExecutionWorld = 'remote' | 'local'

/** The minimal subprocess surface both branches implement. */
export interface SubprocessBranch {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
  spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>
}

/**
 * Pure routing decision (exported for tests): a cwd resolves onto the remote
 * world exactly when it names a remote route — `ssh://`, the current
 * `dsw-routes` placeholder tree, or the legacy `dsh-ssh-routes` tree — OR,
 * on a Windows host, when it is a POSIX-absolute path a local Windows
 * working directory cannot represent (its only sources are remote routes and
 * remote workspace values, which the tool layer passes through verbatim).
 * Everything else — drive/UNC paths, relative paths, and most importantly an
 * ABSENT cwd — stays local (any other default would silently send ordinary
 * local sessions over SSH, the exact defect R4-I2 fixes).
 * @param cwd - the caller-supplied working directory.
 * @param platform - host platform override (tests); defaults to the process.
 */
export function worldOfCwd(cwd: string | undefined, platform: NodeJS.Platform = process.platform): ExecutionWorld {
  if (cwd === undefined) return 'local'
  if (remoteRouteFromCwd(cwd) !== null) return 'remote'
  if (platform === 'win32' && cwd.startsWith('/') && !cwd.startsWith('//')) return 'remote'
  return 'local'
}

/**
 * Rewrite one argv vector for the REMOTE world: a Windows-style absolute
 * argv[0] (`C:\…\rg.exe`, `\\server\share\…`) cannot exist on a POSIX host —
 * the only honest remote interpretation is its bare command name (with the
 * `.exe` suffix dropped), resolved by the remote PATH. Bare names and POSIX
 * absolute paths pass through unchanged; the rest of the argv is untouched
 * (the callers' own path arguments are the tools' responsibility).
 */
export function remoteArgvOf(argv: readonly (string | undefined)[]): (string | undefined)[] {
  const program = argv[0]
  if (program === undefined || program.length === 0) return [...argv]
  let rewritten = program
  if (/^[A-Za-z]:[\\/]/.test(program) || program.includes('\\')) {
    const firstSlash = Math.max(program.lastIndexOf('/'), program.lastIndexOf('\\'))
    rewritten = firstSlash >= 0 ? program.slice(firstSlash + 1) : program
  }
  if (rewritten.toLowerCase().endsWith('.exe')) rewritten = rewritten.slice(0, -4)
  if (rewritten === program) return [...argv]
  return [rewritten, ...argv.slice(1)]
}

/**
 * The routing decision for one filesystem target: a target key of the form
 * `ssh://<id>/<path>` is remote; any other key (a local realpath) is local.
 */
export function worldOfTargetKey(targetKey: string): ExecutionWorld {
  return parseSshTargetKey(targetKey).connectionId !== undefined ? 'remote' : 'local'
}

/**
 * Mixed subprocess provider: `spawn`/`spawnTerminal` route on the spec's cwd.
 * `resolveExecutable` is inherently world-less (no cwd parameter) and stays
 * LOCAL — the in-process consumers are host diagnostic tools; the bash/pwsh
 * executors never call it (they spawn `bash`/`pwsh` directly).
 */
export class MixedSubprocessRuntime implements SubprocessBranch {
  constructor(
    private readonly local: SubprocessBranch,
    private readonly remote: SshSubprocessEngine,
    private readonly sides?: () => SideWorkspaceFace | undefined,
  ) {}

  /** @inheritdoc — local world (see class doc: resolveExecutable is world-less). */
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    return this.local.resolveExecutable(command, env, signal)
  }

  /** @inheritdoc */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    assertSideExecAllowed(this.sides, spec.cwd, spec.argv[0])
    if (worldOfCwd(spec.cwd) === 'remote') {
      return this.remote.spawn({ ...spec, argv: remoteArgvOf(spec.argv as (string | undefined)[]).filter((value): value is string => value !== undefined) })
    }
    return this.local.spawn(spec)
  }

  /** @inheritdoc */
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    assertSideExecAllowed(this.sides, spec.cwd, spec.argv[0])
    return worldOfCwd(spec.cwd) === 'remote' ? this.remote.spawnTerminal(spec) : this.local.spawnTerminal(spec)
  }
}

/** The minimal filesystem surface both branches implement (the seam's 12 methods). */
export type FileSystemBranch = {
  /** The backend's default confinement mode, when it confines at all. */
  readonly sandboxMode?: unknown
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  processPath(target: FsTarget): string
  fileUrl(target: FsTarget): string
  contains(parent: FsTarget, child: FsTarget): boolean
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
  lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>
  readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>
  writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<FsWriteOutcome>
  editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<FsEditOutcome>
}

/**
 * Mixed filesystem provider: `resolve`/`lstat` route on the supplied cwd,
 * every target operation routes on the target key (`ssh://` = remote).
 * The sandbox mode fact is inherited from the LOCAL delegate (the sandboxed
 * backend reports the deployment default so the tool layer still advertises
 * escalation honestly); the per-call sandbox policy is forwarded to the local
 * delegate and dropped for remote targets — a write on the server can never
 * be fenced by the local sandbox.
 */
export class MixedFileSystem implements FileSystemBranch {
  constructor(
    private readonly local: FileSystemBranch,
    private readonly remote: SshFileSystemEngine,
    private readonly sides?: () => SideWorkspaceFace | undefined,
  ) {}

  /** The deployment's confinement fact, as reported by the local backend. */
  get sandboxMode(): unknown {
    return this.local.sandboxMode
  }

  /** @inheritdoc */
  async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    // R5 T2: a side-workspace PATH wins over the cwd world — an absolute path
    // under a remote side root must resolve over its machine even when the
    // session cwd is local, and vice versa (the cwd only fixes relative paths).
    const side = sideWorkspaceOf(this.sides, path)
    if (side !== undefined) {
      if (side.kind === 'remote') {
        const route = parseSshRoute(path)
        if (route !== null) {
          return this.remote.resolve(route.path, { cwd: side.rootKey, ...(opts?.signal !== undefined ? { signal: opts.signal } : {}) })
        }
      } else {
        return this.local.resolve(path, opts)
      }
    }
    return worldOfCwd(opts?.cwd) === 'remote' ? this.remote.resolve(path, opts) : this.local.resolve(path, opts)
  }

  /** @inheritdoc */
  processPath(target: FsTarget): string {
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.processPath(target)
      : this.local.processPath(target)
  }

  /** @inheritdoc */
  fileUrl(target: FsTarget): string {
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.fileUrl(target)
      : this.local.fileUrl(target)
  }

  /** @inheritdoc — targets from different worlds never contain one another. */
  contains(parent: FsTarget, child: FsTarget): boolean {
    if (worldOfTargetKey(String(parent.targetKey)) !== worldOfTargetKey(String(child.targetKey))) return false
    return worldOfTargetKey(String(parent.targetKey)) === 'remote'
      ? this.remote.contains(parent, child)
      : this.local.contains(parent, child)
  }

  /** @inheritdoc */
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.stat(target, signal)
      : this.local.stat(target, signal)
  }

  /** @inheritdoc */
  lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    const side = sideWorkspaceOf(this.sides, path)
    if (side !== undefined) {
      if (side.kind === 'remote') {
        const route = parseSshRoute(path)
        if (route !== null) return this.remote.lstat(route.path, { cwd: side.rootKey }, signal)
      } else {
        return this.local.lstat(path, opts, signal)
      }
    }
    return worldOfCwd(opts?.cwd) === 'remote' ? this.remote.lstat(path, opts, signal) : this.local.lstat(path, opts, signal)
  }

  /** @inheritdoc */
  readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.readText(target, signal)
      : this.local.readText(target, signal)
  }

  /** @inheritdoc */
  streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.streamText(target, signal)
      : this.local.streamText(target, signal)
  }

  /** @inheritdoc */
  readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.readBytes(target, signal, maxBytes)
      : this.local.readBytes(target, signal, maxBytes)
  }

  /** @inheritdoc */
  listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.listDir(target, signal)
      : this.local.listDir(target, signal)
  }

  /** @inheritdoc — the per-call policy reaches the local backend only. */
  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<FsWriteOutcome> {
    // Async method: the gate rejection must be a PROMISE rejection, never a
    // synchronous throw — the seam contract is promise-returning and callers
    // may await it without a synchronous guard.
    assertSideWriteAllowed(this.sides, String(target.targetKey), target.displayPath)
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.writeText(target, content, expected, signal)
      : this.local.writeText(target, content, expected, signal, sandboxPolicy)
  }

  /** @inheritdoc — the per-call policy reaches the local backend only. */
  async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<FsEditOutcome> {
    assertSideWriteAllowed(this.sides, String(target.targetKey), target.displayPath)
    return worldOfTargetKey(String(target.targetKey)) === 'remote'
      ? this.remote.editText(target, edit, expected, signal)
      : this.local.editText(target, edit, expected, signal, sandboxPolicy)
  }
}
