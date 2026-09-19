/**
 * INFRA-15: provision the OPTIONAL third-party tool the remote core can use
 * without this repository redistributing anything.
 *
 * Policy (agreed 2026-09-16):
 *   - `rg` — if the remote host has its own `ripgrep`, use it and push nothing.
 *     Otherwise fetch the OFFICIAL static release on the HOST, verify it against
 *     {@link RG_VENDOR.sha256}, cache it under `$DSH_HOME/cache/dsw-core-vendor/`
 *     and push that single file beside the core. A failed fetch never blocks the
 *     core deploy: the status detail names the official address and the cache
 *     path where a hand-downloaded copy can be dropped instead.
 *   - `bwrap` — never downloaded and never redistributed (upstream publishes
 *     source only). The remote must provide it; the core refuses fenced work
 *     with the install hints from {@link BWRAP_VENDOR}.
 *
 * Network: `curl` (present on Windows 10+, macOS and virtually every Linux) so
 * `https_proxy`/`http_proxy` are honoured. `DSW_CORE_VENDOR_PROXY` overrides the
 * proxy, `DSW_CORE_VENDOR_BASE_URL` mirrors the official download prefix,
 * `DSW_CORE_VENDOR_OFFLINE=1` forbids the network entirely.
 *
 * @module dsh-workspace-enhancement/core-vendor
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BWRAP_VENDOR, RG_VENDOR } from './core-vendor-pins.ts'
import { extractGzipTarMemberToFile } from './gzip-tar.ts'
import { dshHome } from './hostkey.ts'

/** Root of the host-side vendor cache. */
export function coreVendorRoot(): string {
  return join(dshHome(), 'cache', 'dsw-core-vendor')
}

/** One tool's cache directory: `<name>-<version>-<arch>`. */
export function coreVendorDir(name: string, version: string, arch: string): string {
  return join(coreVendorRoot(), `${name}-${version}-${arch}`)
}

/**
 * One pinned official artifact: where it comes from, what it must hash to, and
 * which member to extract. Kept as a parameter (not read from the pins
 * directly) so tests can run the whole path with a locally built tarball.
 */
export interface VendorSource {
  /** Cache/tool name, e.g. `rg`. */
  name: string
  version: string
  arch: string
  /** Official artifact URL. */
  url: string
  /** Pinned sha256 of that artifact (lowercase hex). */
  sha256: string
  /** Path of the executable inside the tarball. */
  member: string
}

/** The pinned ripgrep source. */
export function rgSource(): VendorSource {
  return {
    name: 'rg',
    version: RG_VENDOR.version,
    arch: RG_VENDOR.arch,
    url: RG_VENDOR.url,
    sha256: RG_VENDOR.sha256,
    member: RG_VENDOR.member,
  }
}

/** Directory holding the cached `rg` binary. */
export function rgCacheDir(): string {
  return coreVendorDir('rg', RG_VENDOR.version, RG_VENDOR.arch)
}

/** Cached `rg` binary path (the file pushed to the remote when needed). */
export function rgCachePath(): string {
  return join(rgCacheDir(), 'rg')
}

/** sha256 of a buffer, lowercase hex. */
export function sha256Of(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** sha256 of a file, lowercase hex. */
export function fileSha256(path: string): string {
  return sha256Of(readFileSync(path))
}

/**
 * Cache path of one tool's executable.
 * @param source - the pinned source.
 */
export function vendorCachePath(source: VendorSource): string {
  return join(coreVendorDir(source.name, source.version, source.arch), source.name)
}

/**
 * The cached executable, when its digest sidecar still matches.
 * @param source - the pinned source.
 * @returns the path, or undefined when the cache is empty/corrupt.
 */
export function cachedVendor(source: VendorSource): string | undefined {
  const binary = vendorCachePath(source)
  const digest = `${binary}.sha256`
  if (!existsSync(binary) || !existsSync(digest)) return undefined
  try {
    return fileSha256(binary) === readFileSync(digest, 'utf8').trim() ? binary : undefined
  } catch {
    return undefined
  }
}

/**
 * The cached `rg` binary, when its digest sidecar still matches.
 * @returns the path, or undefined when the cache is empty/corrupt.
 */
export function cachedRg(): string | undefined {
  return cachedVendor(rgSource())
}

/**
 * Apply the mirror override to one official URL.
 * @param url - the pinned official URL.
 * @returns the override-prefixed URL, or `url` unchanged.
 */
export function vendorUrl(url: string): string {
  const override = (process.env.DSW_CORE_VENDOR_BASE_URL ?? '').trim()
  if (override === '') return url
  return `${override.replace(/\/+$/, '')}/${basename(url)}`
}

/** Configured proxy for the vendor download, if any. */
export function vendorProxy(): string | undefined {
  const value = (process.env.DSW_CORE_VENDOR_PROXY
    ?? process.env.https_proxy ?? process.env.HTTPS_PROXY
    ?? process.env.http_proxy ?? process.env.HTTP_PROXY ?? '').trim()
  return value === '' ? undefined : value
}

/** True when the operator forbade network access. */
function offline(): boolean {
  const value = (process.env.DSW_CORE_VENDOR_OFFLINE ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/** Outcome of provisioning the optional search tool. */
export type RgVendorOutcome =
  | { ok: true; path: string; cached: boolean }
  | { ok: false; detail: string }

/** Injectable download seam so tests never touch the network. */
export type VendorDownload = (url: string, target: string, proxy: string | undefined) => string | undefined

/**
 * Download one URL to a file with `curl`.
 * @returns undefined on success, else a short error detail.
 */
function curlDownload(url: string, target: string, proxy: string | undefined): string | undefined {
  const args = ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20', '--max-time', '300']
  if (proxy !== undefined) args.push('--proxy', proxy)
  args.push('--output', target, url)
  const log = `${target}.log`
  const fd = openSync(log, 'w')
  try {
    const run = spawnSync('curl', args, { stdio: ['ignore', 'ignore', fd] })
    const detail = readFileSafe(log).trim()
    if (run.error !== undefined) return `curl could not run (${run.error.message})`
    if (run.status !== 0) return detail === '' ? `curl exited ${String(run.status)}` : detail
    return undefined
  } finally {
    closeSync(fd)
    rmSync(log, { force: true })
  }
}

/** Read a file, returning '' when it is missing or unreadable. */
function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Extract one member of a gzip tarball to `target` without spawning PATH `tar`
 * (BUG-8: MSYS GNU tar corrupts `-xzOf` and used to hide stderr).
 * @returns undefined on success, else a short error detail.
 */
function extractMember(archive: string, member: string, target: string): string | undefined {
  return extractGzipTarMemberToFile(archive, member, target)
}

/** Actionable text for a failed fetch (official address + manual escape hatch). */
function unavailableDetail(source: VendorSource, reason: string): string {
  return [
    `${source.name} ${source.version} is missing on the remote and could not be fetched here: ${reason}`,
    `official release: ${source.url}`,
    `expected sha256: ${source.sha256}`,
    `place the extracted binary at ${vendorCachePath(source)} (or install ${source.name} on the remote itself) and deploy again`,
  ].join(' — ')
}

/**
 * Ensure a verified copy of one pinned official tool exists in the host cache.
 * Fetches, verifies the pinned sha256, extracts the member and stores it with a
 * digest sidecar. Nothing is cached unless every check passed.
 *
 * @param source - the pinned source (see {@link rgSource}).
 * @param download - download seam (tests inject a local writer).
 * @returns the cached path, or an actionable failure detail.
 */
export function ensureVendor(source: VendorSource, download: VendorDownload = curlDownload): RgVendorOutcome {
  const hit = cachedVendor(source)
  if (hit !== undefined) return { ok: true, path: hit, cached: true }
  if (offline()) return { ok: false, detail: unavailableDetail(source, 'DSW_CORE_VENDOR_OFFLINE is set') }

  const target = vendorCachePath(source)
  const dir = coreVendorDir(source.name, source.version, source.arch)
  mkdirSync(dir, { recursive: true })
  const staged = join(dir, `.${source.name}-${String(process.pid)}.part`)
  const archive = `${staged}.tar.gz`
  try {
    const failure = download(vendorUrl(source.url), archive, vendorProxy())
    if (failure !== undefined) return { ok: false, detail: unavailableDetail(source, failure) }
    if (!existsSync(archive)) return { ok: false, detail: unavailableDetail(source, 'the download produced no file') }

    const digest = fileSha256(archive)
    if (digest !== source.sha256) {
      return {
        ok: false,
        detail: unavailableDetail(source, `sha256 mismatch (got ${digest}); the download was discarded`),
      }
    }

    const extracted = extractMember(archive, source.member, staged)
    if (extracted !== undefined) return { ok: false, detail: unavailableDetail(source, extracted) }
    chmodSync(staged, 0o755)
    const binaryDigest = fileSha256(staged)
    renameSync(staged, target)
    writeFileSync(`${target}.sha256`, `${binaryDigest}\n`)
    return { ok: true, path: target, cached: false }
  } finally {
    rmSync(staged, { force: true })
    rmSync(archive, { force: true })
  }
}

/**
 * Ensure a verified `rg` binary exists in the host cache.
 * @returns the cached path, or an actionable failure detail.
 */
export function ensureRgVendor(download: VendorDownload = curlDownload): RgVendorOutcome {
  return ensureVendor(rgSource(), download)
}

/** bwrap install hints, for the refusal message the model and the operator read. */
export function bwrapInstallHints(): readonly string[] {
  return BWRAP_VENDOR.installHints
}

/** Official bubblewrap source address (there is no upstream binary release). */
export function bwrapHomepage(): string {
  return BWRAP_VENDOR.homepage
}
