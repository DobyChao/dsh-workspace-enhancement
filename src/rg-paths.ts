/**
 * Rewrite ripgrep stdout before a Windows host displays it (BUG-28).
 *
 * Official grep/glob run `path.relative` on whatever `rg` printed. A POSIX
 * absolute path is absolute on win32, so it is resolved onto the process's
 * current drive and comes back as `D:\home\uuz\...`. That string is neither
 * the placeholder nor the remote path, so a later read/edit looks on the
 * local disk.
 *
 * Replace each absolute POSIX path with its placeholder. The official
 * relativizer then stays inside the placeholder tree: a file under the
 * session directory becomes a relative name, and a path outside it stays the
 * placeholder because `..` is returned unchanged.
 * @module dsh-workspace-enhancement/rg-paths
 */

import { Buffer } from 'node:buffer'
import { sshRoutePlaceholder } from './transport.ts'

/** One ripgrep stdout line: a bare path, or one `--json` record. */
export function rewriteRgLine(line: string, connectionId: string): string {
  const cr = line.endsWith('\r')
  const body = cr ? line.slice(0, -1) : line
  const rewritten = rewriteRgBody(body, connectionId)
  return cr ? `${rewritten}\r` : rewritten
}

function rewriteRgBody(body: string, connectionId: string): string {
  if (body.startsWith('{')) return rewriteRgJson(body, connectionId)
  if (body.startsWith('/')) return sshRoutePlaceholder(connectionId, body)
  return body
}

/** Replace `data.path.text` only. Match text stays the remote file's bytes. */
function rewriteRgJson(body: string, connectionId: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  if (parsed === null || typeof parsed !== 'object') return body
  const data = (parsed as { data?: unknown }).data
  if (data === null || typeof data !== 'object') return body
  const path = (data as { path?: unknown }).path
  if (path === null || typeof path !== 'object') return body
  const text = (path as { text?: unknown }).text
  if (typeof text !== 'string' || !text.startsWith('/')) return body
  ;(path as { text: string }).text = sshRoutePlaceholder(connectionId, text)
  return JSON.stringify(parsed)
}

/**
 * Line-buffer one rg stdout stream. Chunks may split a JSON record; only
 * complete lines are rewritten. Call {@link RgStdoutRewriter.flush} before
 * the collector is sealed.
 */
export class RgStdoutRewriter {
  private pending: Buffer = Buffer.alloc(0)

  constructor(private readonly connectionId: string) {}

  /** Rewrite every complete line in `chunk` and emit those bytes. */
  push(chunk: Uint8Array, emit: (bytes: Buffer) => void): void {
    if (chunk.length === 0) return
    this.pending = this.pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.pending, chunk])
    const ready: Buffer[] = []
    let start = 0
    for (let index = 0; index < this.pending.length; index += 1) {
      if (this.pending[index] !== 0x0a) continue
      const line = this.pending.subarray(start, index).toString('utf8')
      ready.push(Buffer.from(`${rewriteRgLine(line, this.connectionId)}\n`))
      start = index + 1
    }
    this.pending = Buffer.from(this.pending.subarray(start))
    if (ready.length > 0) emit(Buffer.concat(ready))
  }

  /** Rewrite a trailing line that never received a newline. */
  flush(emit: (bytes: Buffer) => void): void {
    if (this.pending.length === 0) return
    emit(Buffer.from(rewriteRgLine(this.pending.toString('utf8'), this.connectionId)))
    this.pending = Buffer.alloc(0)
  }
}
