/**
 * BUG-8: read one member out of a gzip ustar without spawning `tar`.
 *
 * Host-side `core.deploy` used to `spawnSync('tar')`. On Windows the first
 * `tar` on PATH is often Git-Bash/MSYS GNU tar, which corrupts `-xzOf`
 * stdout (MANIFEST.json becomes garbage JSON) and whose stderr we discarded.
 * The remote Linux extract in `coreInstallScript` still uses GNU tar; this
 * module is the host-side replacement.
 *
 * Stdlib only (`node:zlib`) so it runs inside the DSH file sandbox.
 *
 * @module dsh-workspace-enhancement/gzip-tar
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'

const BLOCK = 512

/** Strip `./` and trailing slashes so `./MANIFEST.json` matches `MANIFEST.json`. */
export function normalizeTarMember(name: string): string {
  return name.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
}

function octal(block: Buffer, start: number, length: number): number {
  const text = block.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim()
  if (text === '') return 0
  const value = Number.parseInt(text, 8)
  return Number.isFinite(value) ? value : 0
}

function headerChecksum(header: Buffer): number {
  let sum = 0
  for (let i = 0; i < BLOCK; i++) {
    sum += (i >= 148 && i < 156) ? 0x20 : (header[i] ?? 0)
  }
  return sum
}

function memberName(header: Buffer): string {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
  return prefix === '' ? name : `${prefix.replace(/\/+$/, '')}/${name}`
}

function paddedSize(size: number): number {
  if (size === 0) return 0
  return Math.ceil(size / BLOCK) * BLOCK
}

function ustarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(BLOCK)
  let prefix = ''
  let leaf = name
  if (name.length > 100) {
    const slash = name.lastIndexOf('/')
    if (slash <= 0 || slash >= name.length - 1) {
      throw new Error(`gzip-tar: member name too long: ${name}`)
    }
    prefix = name.slice(0, slash)
    leaf = name.slice(slash + 1)
    if (prefix.length > 155 || leaf.length > 100) {
      throw new Error(`gzip-tar: member name too long: ${name}`)
    }
  }
  header.write(leaf, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'utf8')
  header.write('0000000\0', 108, 8, 'utf8')
  header.write('0000000\0', 116, 8, 'utf8')
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8')
  header.write('00000000000\0', 136, 12, 'utf8')
  header.write('        ', 148, 8, 'utf8')
  header[156] = 0x30
  header.write('ustar\0', 257, 6, 'utf8')
  header.write('00', 263, 2, 'utf8')
  if (prefix !== '') header.write(prefix, 345, 155, 'utf8')
  const sum = headerChecksum(header)
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8')
  return header
}

/**
 * Pack a gzip ustar from an in-memory file map. Used by tests so they do not
 * depend on PATH `tar` (the same MSYS bug this module exists to avoid).
 */
export function packGzipTar(files: Record<string, string | Uint8Array>): Buffer {
  const chunks: Buffer[] = []
  for (const [rawName, body] of Object.entries(files)) {
    const name = normalizeTarMember(rawName)
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body)
    const pad = paddedSize(buf.length) - buf.length
    chunks.push(ustarHeader(name, buf.length), buf)
    if (pad > 0) chunks.push(Buffer.alloc(pad))
  }
  chunks.push(Buffer.alloc(BLOCK * 2))
  return gzipSync(Buffer.concat(chunks))
}

/**
 * Extract one regular-file member. Throws a message that already names the
 * archive and the member — callers surface it as-is (BUG-8: do not swallow
 * the reason the way PATH tar's ignored stderr did).
 */
export function extractGzipTarMember(archive: string, member: string): Buffer {
  const wanted = normalizeTarMember(member)
  let data: Buffer
  try {
    data = gunzipSync(readFileSync(archive))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`gzip-tar: cannot gunzip ${archive}: ${detail}`)
  }
  let offset = 0
  while (offset + BLOCK <= data.length) {
    const header = data.subarray(offset, offset + BLOCK)
    if (header.every(byte => byte === 0)) break
    const declared = octal(header, 148, 8)
    const stored = headerChecksum(header)
    if (declared !== 0 && declared !== stored) {
      throw new Error(`gzip-tar: bad ustar checksum in ${archive}`)
    }
    const size = octal(header, 124, 12)
    const type = header[156] ?? 0
    const full = memberName(header)
    offset += BLOCK
    const content = data.subarray(offset, offset + size)
    offset += paddedSize(size)
    const isFile = type === 0 || type === 0x30
    if (isFile && normalizeTarMember(full) === wanted) return Buffer.from(content)
  }
  throw new Error(`gzip-tar: member ${wanted} not in ${archive}`)
}

/** Write {@link extractGzipTarMember} to `target`. Returns an error detail or undefined. */
export function extractGzipTarMemberToFile(
  archive: string,
  member: string,
  target: string,
): string | undefined {
  try {
    writeFileSync(target, extractGzipTarMember(archive, member))
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
