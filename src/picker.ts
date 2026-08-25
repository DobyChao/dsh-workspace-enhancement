/**
 * Directory-picker browse backend over the dsh-workspace-enhancement SSH
 * connection: the web GUI's "Select Workspace Directory" dialog — the
 * add-workspace flow — browses the remote host through the shared SFTP
 * channel, and picked remote paths become workspace paths the plugin's
 * providers already understand.
 *
 * Behavior facts:
 * - On a Windows host the picker is dual-root: local listings keep the
 *   drive-qualified paths of the host account (so the existing local browsing
 *   is unchanged), the remote host appears as one pinned entry on the local
 *   home level, and every POSIX-absolute path addresses the remote host —
 *   the same routing rule as {@link SshRuntime.resolveRemoteCwd}.
 * - On a POSIX host every absolute path addresses the remote host, so the
 *   picker is remote-only (the local filesystem is unreachable through it;
 *   it would share the remote path vocabulary).
 * - Remote listings return directories only, name-sorted, symlinks to
 *   directories followed, `hidden` means dot-prefixed, and one level is
 *   bounded at `maxEntries` rows with `truncated` flagging a cut. The remote
 *   level walk is shared with the `/dsw` browse channel
 *   ({@link module:dsh-workspace-enhancement/listing}).
 * - `createDirectory` is non-recursive SFTP mkdir with an existence probe.
 *
 * Mount as its own row (`dsh-workspace-enhancement/picker`): the
 * directory-picker seam registers one implementation per context, so this row
 * must REPLACE the deployment's existing `directory-picker` row (the web
 * bundle's `@deepseek-ai/dsh-host-directory-picker-auto`), not sit beside it,
 * and the shipped in-app browser surface
 * (`@deepseek-ai/dsh-client-ui-directory-picker-browse`) must be composed
 * separately because replacing `-auto` drops the surface it mounted.
 * @module dsh-workspace-enhancement/picker
 */

import { mkdir, opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix, resolve, win32 } from 'node:path'
import type { Stats } from 'ssh2'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DirectoryPicker, DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import type {
  DirectoryEntry,
  DirectoryListing,
  DirectoryPickerBrowseCapability,
  DirectoryPickerCapability,
} from '@deepseek-ai/dsh-host-directory-picker'
import { ancestryCrumbs, asError, boundedInsert, listRemoteLevel, raceAbort, remoteHome } from './listing.ts'
import type { SshRuntime } from './runtime.ts'

/** Configuration for the directory-picker browse backend. */
export interface Config {
  /**
   * Complete-result bound for one remote or local level: at most this many
   * child-directory rows (hidden rows count toward the bound), with
   * `truncated` flagging a cut level. Defaults to 1000, the bound GitHub's
   * web UI applies to directory listings.
   */
  maxEntries?: number
  /**
   * Name of the pinned remote-host entry shown on the local home level
   * (Windows hosts only). Defaults to `Remote host <username>@<host>`.
   */
  remoteLabel?: string
  /**
   * Name of the pinned local-host entry shown on the remote home level
   * (Windows hosts only). Defaults to `Local host`.
   */
  localLabel?: string
}

/** Resolved config with every default filled by Schemastery before construction. */
interface ResolvedConfig {
  maxEntries: number
  remoteLabel?: string
  localLabel?: string
}

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * True when the path names one fixed Windows filesystem location regardless
 * of process state: drive-qualified (`C:\…`, `C:/…`) or complete UNC
 * (`\\server\share…`, `//server/share…`). Rooted drive-less forms (`\foo`,
 * `/foo`) and incomplete UNC prefixes pass `isAbsolute` yet still resolve
 * against the process's current drive, so they do not count.
 * @param path - candidate path.
 */
function fullyQualifiedWin32(path: string): boolean {
  return win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/])/.test(path)
}

/** One probed row of a local level: a directory, a symlink to one, or nothing. */
async function localDirectoryRow(
  parent: string,
  name: string,
  isDirectory: boolean,
  isSymbolicLink: boolean,
  signal?: AbortSignal,
): Promise<DirectoryEntry | null> {
  const path = join(parent, name)
  let enterable = isDirectory
  if (!enterable && isSymbolicLink) {
    try {
      enterable = (await raceAbort(stat(path), signal)).isDirectory()
    } catch (error) {
      if (signal?.aborted === true) throw asError(signal.reason)
      return null
    }
  }
  if (!enterable) return null
  return { name, path, hidden: name.startsWith('.') }
}

/** A streamed local dirent reduced to the facts the bounded window keeps. */
interface DirentCandidate {
  name: string
  isDirectory: boolean
  isSymbolicLink: boolean
}

/** Directory-picker browse backend registered as `ctx.directoryPicker`. */
export class SshDirectoryPicker extends DirectoryPicker {
  static inject = ['ssh']
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1e3),
    remoteLabel: z.string(),
    localLabel: z.string(),
  })

  private readonly config: ResolvedConfig
  private readonly localHome: string
  /**
   * The cached remote-home resolution, established lazily on the FIRST use
   * (never at mount time). Success is cached; a failure resets the cache so
   * the next browse retries — an eager resolve made the picker's construction
   * attempt a connection against the placeholder `ssh-remote` row, which
   * failed at load and killed the whole bundle.
   */
  private remoteHomePromise: Promise<string> | undefined
  private readonly browseCapability: DirectoryPickerBrowseCapability

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config as ResolvedConfig
    this.localHome = homedir()
    this.browseCapability = {
      kind: 'browse',
      list: (path?: string, signal?: AbortSignal) => this.list(path, signal),
      createDirectory: (path: string, name: string) => this.createDirectory(path, name),
    }
  }

  /**
   * Resolve the remote home lazily: the first browse establishes the
   * connection — a dead placeholder row surfaces its error at browse time
   * (R1: transmit connection failures, never mask them), success is cached
   * for the service lifetime, and a failure is dropped so the next browse
   * retries.
   * @param signal - caller lifetime of the triggering browse.
   * @returns the remote home path.
   */
  private resolveRemoteHome(signal?: AbortSignal): Promise<string> {
    if (this.remoteHomePromise === undefined) {
      this.remoteHomePromise = remoteHome(this.ctx.ssh, signal).catch((error: unknown) => {
        this.remoteHomePromise = undefined
        throw error
      })
    }
    return this.remoteHomePromise
  }

  /** The browse interaction capability (stable for the service lifetime). */
  override capability(): DirectoryPickerCapability {
    return this.browseCapability
  }

  /**
   * List one directory level.
   * @param path - absolute directory to list; absent lists the local home on
   *   Windows hosts (the add-workspace dialog opens on the local machine) and
   *   the remote home elsewhere.
   * @param signal - caller lifetime; abort stops the scan and rejects.
   * @returns the level's listing with ancestry.
   */
  async list(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    if (path === undefined) {
      return this.dualMode ? this.listLocal(this.localHome, signal) : this.listRemote(await this.resolveRemoteHome(signal), signal)
    }
    if (this.isLocalPath(path)) return this.listLocal(resolve(path), signal)
    if (posix.isAbsolute(path)) return this.listRemote(path, signal)
    throw new DirectoryPickerError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`)
  }

  /**
   * Create one child directory under an existing parent.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment (no separators, not `.`/`..`).
   * @returns the created directory's absolute path.
   */
  async createDirectory(path: string, name: string): Promise<string> {
    if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
      throw new DirectoryPickerError('directory-create-failed', join(path, name), `"${name}" is not a single path segment`)
    }
    if (this.isLocalPath(path)) return this.createLocalDirectory(path, name)
    if (posix.isAbsolute(path)) return this.createRemoteDirectory(path, name)
    throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
  }

  /** Whether the host platform keeps a reachable local filesystem beside the remote one. */
  private get dualMode(): boolean {
    return process.platform === 'win32'
  }

  /** Whether `path` addresses the local filesystem (Windows hosts only). */
  private isLocalPath(path: string): boolean {
    return this.dualMode && fullyQualifiedWin32(path)
  }

  /** The pinned remote entry's display name. */
  private remoteEntryLabel(): string {
    if (this.config.remoteLabel !== undefined) return this.config.remoteLabel
    return `Remote host ${this.ctx.ssh.endpoint}`
  }

  /** The pinned local entry's display name. */
  private localEntryLabel(): string {
    if (this.config.localLabel !== undefined) return this.config.localLabel
    return 'Local host'
  }

  /** List one remote level through the shared {@link listRemoteLevel} walk. */
  private async listRemote(target: string, signal?: AbortSignal): Promise<DirectoryListing> {
    try {
      return await listRemoteLevel(this.ctx.ssh, target, this.config.maxEntries, {
        signal,
        home: await this.resolveRemoteHome(signal),
      })
    } catch (error) {
      signal?.throwIfAborted()
      throw new DirectoryPickerError('directory-unreadable', target, `cannot list ${target}: ${messageOf(error)}`)
    }
  }

  /** List one local level over the host filesystem (Windows hosts only). */
  private async listLocal(target: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const home = this.localHome
    const keep = this.config.maxEntries + 1
    const window: DirentCandidate[] = []
    let evicted = false
    try {
      const opening = opendir(target)
      const level = await raceAbort(opening, signal).catch((error) => {
        opening.then((dir) => dir.close().catch(() => {}), () => {})
        throw error
      })
      try {
        for (;;) {
          const dirent = await raceAbort(level.read(), signal)
          if (dirent === null) break
          if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue
          if (boundedInsert(window, {
            name: dirent.name,
            isDirectory: dirent.isDirectory(),
            isSymbolicLink: dirent.isSymbolicLink(),
          }, keep)) evicted = true
        }
      } finally {
        const closing = level.close()
        if (signal?.aborted === true) closing.catch(() => {})
        else await closing
      }
    } catch (error) {
      signal?.throwIfAborted()
      throw new DirectoryPickerError('directory-unreadable', target, `cannot list ${target}: ${messageOf(error)}`)
    }
    const entries: DirectoryEntry[] = []
    let truncated = evicted
    for (const candidate of window) {
      signal?.throwIfAborted()
      const row = await localDirectoryRow(target, candidate.name, candidate.isDirectory, candidate.isSymbolicLink, signal)
      if (row === null) continue
      if (entries.length === this.config.maxEntries) {
        truncated = true
        break
      }
      entries.push(row)
    }
    return {
      path: target,
      home,
      crumbs: ancestryCrumbs(target, win32.dirname, win32.basename),
      entries,
      truncated,
    }
  }

  /** Create one child directory on the remote host (SFTP mkdir, non-recursive). */
  private async createRemoteDirectory(path: string, name: string): Promise<string> {
    if (!posix.isAbsolute(path)) {
      throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
    }
    const target = posix.join(path, name)
    const sftp = await this.ctx.ssh.getSftp()
    try {
      const existing = await new Promise<Stats | undefined>((resolvePromise) => {
        sftp.lstat(target, (error, value) => { if (error !== undefined) resolvePromise(undefined); else resolvePromise(value) })
      })
      if (existing !== undefined) throw new DirectoryPickerError('directory-exists', target, `${target} already exists`)
    } catch (error) {
      if (error instanceof DirectoryPickerError) throw error
      throw new DirectoryPickerError('directory-create-failed', target, `cannot create ${target}: ${messageOf(error)}`)
    }
    try {
      await new Promise<void>((resolvePromise, reject) => {
        sftp.mkdir(target, (error) => { if (error !== undefined) reject(error); else resolvePromise() })
      })
      return target
    } catch (error) {
      throw new DirectoryPickerError('directory-create-failed', target, `cannot create ${target}: ${messageOf(error)}`)
    }
  }

  /** Create one child directory on the local filesystem (Windows hosts only). */
  private async createLocalDirectory(path: string, name: string): Promise<string> {
    if (!fullyQualifiedWin32(path)) {
      throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
    }
    const parent = resolve(path)
    const target = join(parent, name)
    try {
      await mkdir(target)
      return target
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST') {
        throw new DirectoryPickerError('directory-exists', target, `${target} already exists`)
      }
      throw new DirectoryPickerError('directory-create-failed', target, `cannot create ${target}: ${messageOf(error)}`)
    }
  }
}

export default SshDirectoryPicker
