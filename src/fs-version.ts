/**
 * BUG-7: one FsVersion algorithm for the SFTP face and the remote core.
 *
 * A read on one transport followed by a CAS write on the other used to
 * mismatch because SFTP hashed `[path, size, Date, mode]` with an `ssh:`
 * prefix while the core hashed basename + hex(RFC3339Nano) + two size
 * bytes. Both now hash the same JSON tuple:
 *
 *   [posixPath, size, mtimeMs quantized to whole seconds]
 *
 * SFTP attrs only carry second-resolution mtime, so the millisecond field
 * is quantized; otherwise a core stat (UnixMilli) and an SFTP stat of the
 * same second would still disagree. Mode is not part of the tuple: a chmod
 * must not trip a content CAS.
 *
 * @module dsh-workspace-enhancement/fs-version
 */

import { createHash } from 'node:crypto'

/** Whole-second mtime expressed as milliseconds, so SFTP and core agree. */
export function versionMtimeMs(mtimeMs: number): number {
  if (!Number.isFinite(mtimeMs)) return 0
  return Math.trunc(mtimeMs / 1000) * 1000
}

/**
 * Best-effort milliseconds from an ssh2 `Stats`/`Attributes` or a Node
 * `fs.Stats`. ssh2 SFTP attrs store Unix seconds; Node stats store `mtimeMs`.
 */
export function statsVersionMtimeMs(stats: {
  mtimeMs?: number
  mtime?: number | Date
}): number {
  if (typeof stats.mtimeMs === 'number' && Number.isFinite(stats.mtimeMs)) {
    return versionMtimeMs(stats.mtimeMs)
  }
  const mtime = stats.mtime
  if (mtime instanceof Date) return versionMtimeMs(mtime.getTime())
  if (typeof mtime === 'number' && Number.isFinite(mtime)) {
    return versionMtimeMs(mtime < 1e12 ? mtime * 1000 : mtime)
  }
  return 0
}

/**
 * Opaque content-version token. Identical for the same path/size/mtime on
 * every transport. The path is POSIX-slash so a Windows host talking to a
 * Linux core still matches.
 */
export function fileContentVersion(path: string, size: number, mtimeMs: number): string {
  const posixPath = path.replaceAll('\\', '/')
  return createHash('sha256')
    .update(JSON.stringify([posixPath, size, versionMtimeMs(mtimeMs)]))
    .digest('hex')
}
