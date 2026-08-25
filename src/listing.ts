/**
 * Shared remote-directory listing for the directory-picker browse backend and
 * the `/dsw` browse channel. One implementation of the level walk (SFTP
 * readdir, symlink follow, name-ascending bounded window, abort-aware probing)
 * and of the remote-home resolution that both surfaces used to duplicate.
 * @module dsh-workspace-enhancement/listing
 */

import { posix } from 'node:path'
import type { SFTPWrapper, Stats } from 'ssh2'
import type { SshTransport } from './transport.ts'

/** One wire row of a remote listing. */
export interface RemoteListingEntry {
  name: string
  path: string
  hidden: boolean
}

/** One remote listing level. */
export interface RemoteListing {
  path: string
  home: string
  crumbs: RemoteListingEntry[]
  entries: RemoteListingEntry[]
  truncated: boolean
}

/** The thrown value as an Error (wire/abort reasons may be anything). */
export function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. SFTP reads are not retractable, so the operation itself keeps
 * running against a channel the caller then abandons — its late settlement
 * is swallowed here so an abandoned read cannot surface as an unhandled
 * rejection.
 * @param operation - the in-flight step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = (): void => {
      operation.catch(() => {})
      reject(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(asError(reason))
      },
    )
  })
}

/**
 * Insert a streamed candidate into the name-ascending bounded window,
 * evicting the name-largest candidate when the window exceeds `keep`.
 * Memory over an arbitrarily large level stays O(keep).
 * @param window - the name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has candidates beyond the window).
 */
export function boundedInsert<T extends { name: string }>(window: T[], candidate: T, keep: number): boolean {
  const tail = window[window.length - 1]
  if (window.length === keep && tail !== undefined && candidate.name.localeCompare(tail.name) >= 0) return true
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const middle = window[mid]
    if (middle !== undefined && candidate.name.localeCompare(middle.name) < 0) hi = mid
    else lo = mid + 1
  }
  window.splice(lo, 0, candidate)
  if (window.length <= keep) return false
  window.pop()
  return true
}

/**
 * Ancestor chain from the filesystem root to `target` inclusive — the
 * breadcrumb rows of a listing, every one a jump target.
 * @param target - the listed directory.
 * @param dirnameOf - path dirname function (posix or win32).
 * @param basenameOf - path basename function (posix or win32).
 */
export function ancestryCrumbs(
  target: string,
  dirnameOf: (path: string) => string,
  basenameOf: (path: string) => string,
): RemoteListingEntry[] {
  const crumbs: RemoteListingEntry[] = []
  let current = target
  for (;;) {
    const parent = dirnameOf(current)
    crumbs.unshift({
      name: parent === current ? current : basenameOf(current),
      path: current,
      hidden: false,
    })
    if (parent === current) return crumbs
    current = parent
  }
}

/** Resolve one SFTP stat, following symlinks. */
function sftpStat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise<Stats>((resolvePromise, reject) => {
    sftp.stat(path, (error, value) => { if (error !== undefined) reject(error); else resolvePromise(value) })
  })
}

/** Read one remote directory level with attr facts. */
function sftpReadDir(sftp: SFTPWrapper, path: string): Promise<Array<{ filename: string; attrs: Stats }>> {
  return new Promise<Array<{ filename: string; attrs: Stats }>>((resolvePromise, reject) => {
    sftp.readdir(path, (error, value) => { if (error !== undefined) reject(error); else resolvePromise(value) })
  })
}

/** One probed row of a remote level: a directory, a symlink to one, or nothing. */
async function remoteDirectoryRow(
  sftp: SFTPWrapper,
  parent: string,
  name: string,
  isDirectory: boolean,
  isSymbolicLink: boolean,
  signal?: AbortSignal,
): Promise<RemoteListingEntry | null> {
  const path = posix.join(parent, name)
  let enterable = isDirectory
  if (!enterable && isSymbolicLink) {
    try {
      enterable = (await raceAbort(sftpStat(sftp, path), signal)).isDirectory()
    } catch (error) {
      if (signal?.aborted === true) throw asError(signal.reason)
      // A broken or unreadable link is not enterable; skip it silently.
      return null
    }
  }
  if (!enterable) return null
  return { name, path, hidden: name.startsWith('.') }
}

/**
 * The remote host account's home directory: the login environment's HOME, else
 * the transport's default remote cwd. A transport whose chain cannot be opened
 * (connect/auth failure) surfaces its error instead of masquerading as a
 * working home — the old catch-all fell back to the spec cwd, so `browse.home`
 * answered `ok: true {path:'/root'}` even when the connection was dead. Once
 * the chain is up, an unreadable environment (env probe failed, HOME unset) is
 * the one case that still falls back to the configured cwd.
 * @param ssh - the transport backing the listing.
 * @param signal - caller lifetime.
 * @returns the remote home path.
 */
export async function remoteHome(ssh: SshTransport, signal?: AbortSignal): Promise<string> {
  // Establish the chain first: a dead or auth-failing transport must propagate
  // its connect error (rewrapped as `dsw: cannot connect …` by the owner),
  // never be swallowed into the cwd fallback.
  await ssh.getClient(signal)
  try {
    const environment = await ssh.getRemoteEnvironment(signal)
    const home = environment.HOME
    if (typeof home === 'string' && home.trim().length > 0) return home
  } catch {
    // An alive transport whose login environment cannot be read (the env probe
    // failed, or the shell profile is broken) falls back below; the listing
    // itself still surfaces the read error.
  }
  return ssh.cwd
}

/**
 * List one remote level over a transport's shared SFTP channel: directories
 * only (symlinks to directories followed), name-ascending, bounded at `limit`
 * rows with `truncated` flagging a cut, abort-aware.
 * @param ssh - the transport backing the listing.
 * @param target - absolute POSIX directory to list.
 * @param limit - complete-result bound for one level.
 * @param opts - caller lifetime and optional pre-resolved home.
 * @returns the level's listing with ancestry.
 */
export async function listRemoteLevel(
  ssh: SshTransport,
  target: string,
  limit: number,
  opts?: { signal?: AbortSignal | undefined; home?: string },
): Promise<RemoteListing> {
  const signal = opts?.signal
  const home = opts?.home ?? await remoteHome(ssh, signal)
  const sftp = await ssh.getSftp(signal)
  const keep = limit + 1
  const window: Array<{ name: string; isDirectory: boolean; isSymbolicLink: boolean }> = []
  let evicted = false
  try {
    const listed = await raceAbort(sftpReadDir(sftp, target), signal)
    for (const entry of listed) {
      signal?.throwIfAborted()
      if (!entry.attrs.isDirectory() && !entry.attrs.isSymbolicLink()) continue
      if (boundedInsert(window, {
        name: entry.filename,
        isDirectory: entry.attrs.isDirectory(),
        isSymbolicLink: entry.attrs.isSymbolicLink(),
      }, keep)) evicted = true
    }
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
  const entries: RemoteListingEntry[] = []
  let truncated = evicted
  for (const candidate of window) {
    signal?.throwIfAborted()
    const row = await remoteDirectoryRow(sftp, target, candidate.name, candidate.isDirectory, candidate.isSymbolicLink, signal)
    if (row === null) continue
    if (entries.length === limit) {
      truncated = true
      break
    }
    entries.push(row)
  }
  return {
    path: target,
    home,
    crumbs: ancestryCrumbs(target, posix.dirname, posix.basename),
    entries,
    truncated,
  }
}
