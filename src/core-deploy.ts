/**
 * REQ-I5: upload a core tarball over SFTP and point `~/.dsh-core/current` at it.
 *
 * Operator action only — never triggered by a model tool.
 *
 * INFRA-15: the tarball carries only the first-party `dsh-core`. Optional
 * third-party tools are provisioned separately — `rg` is fetched from its
 * official release on the host (or skipped when the remote already has one) and
 * pushed beside the core; `bwrap` is never shipped and must come from the remote
 * host's own package manager, so its absence is reported here as a note and
 * refuses fenced work later.
 *
 * @module dsh-workspace-enhancement/core-deploy
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SFTPWrapper } from 'ssh2'
import { CORE_ARTIFACT_VERSION } from './core-protocol.ts'
import { coreArtifactName, type CoreStatusView } from './core-hub.ts'
import { extractGzipTarMember } from './gzip-tar.ts'
import { bwrapInstallHints, ensureRgVendor } from './core-vendor.ts'
import { RG_VENDOR } from './core-vendor-pins.ts'
import { quoteShellArg } from './ssh-core.ts'
import type { SshTransport } from './transport.ts'

const LINUX = new Set(['linux', 'Linux'])
const AMD64 = new Set(['x86_64', 'amd64', 'x64'])

/**
 * Files the tarball MUST contain. Only the first-party binary: third-party
 * tools are pushed separately (or provided by the remote) — see the module note.
 */
const REQUIRED_ARTIFACT_FILES = ['dsh-core'] as const

/** One extra executable pushed beside the core after extraction. */
export interface VendorFile {
  /** Absolute path of the uploaded temp file on the remote. */
  temp: string
  /** Path relative to `~/.dsh-core/<version>/`. */
  relative: string
}

export function localCoreTarball(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'core', 'dist', coreArtifactName())
}

/**
 * Pure MANIFEST gate: every required file listed with a sha256. Returns the
 * list of problems; empty = the tarball can be deployed as-is.
 */
export function manifestIssues(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) return ['MANIFEST.json is not an object']
  const files = (manifest as { files?: unknown }).files
  if (typeof files !== 'object' || files === null) return ['MANIFEST.json has no files map']
  const issues: string[] = []
  for (const name of REQUIRED_ARTIFACT_FILES) {
    const sha = (files as Record<string, unknown>)[name]
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
      issues.push(`MANIFEST.json is missing sha256 for ${name}`)
    }
  }
  return issues
}

/**
 * Read MANIFEST.json out of the tarball with the in-process gzip/ustar
 * extractor (BUG-8: never spawn PATH `tar` on the host). Throws with a
 * message that already names the archive — callers surface it as-is.
 */
export function readTarballManifest(artifact: string): unknown {
  const data = extractGzipTarMember(artifact, 'MANIFEST.json')
  return JSON.parse(data.toString('utf8')) as unknown
}

export function assertLinuxAmd64(unameS: string, unameM: string): void {
  if (!LINUX.has(unameS.trim())) {
    throw new Error(`dsh-core v1 supports linux only (uname -s = ${JSON.stringify(unameS.trim())})`)
  }
  if (!AMD64.has(unameM.trim())) {
    throw new Error(`dsh-core v1 supports x86_64 only (uname -m = ${JSON.stringify(unameM.trim())})`)
  }
}

function sftpWrite(sftp: SFTPWrapper, remote: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remote, data, (error) => {
      if (error !== undefined) reject(error)
      else resolve()
    })
  })
}

/**
 * Remote extract + chmod + current symlink. Windows-built tarballs land as 644,
 * so every executable must be chmod'ed explicitly; `vendors` are the extra
 * tools uploaded for this deploy (only what we actually pushed is listed).
 */
export function coreInstallScript(version: string, remoteTar: string, vendors: readonly VendorFile[] = []): string {
  const prefix = `"$HOME"/.dsh-core/${version}`
  const steps = [
    `mkdir -p -- ${prefix}`,
    `tar -xzf ${quoteShellArg(remoteTar)} -C ${prefix}`,
  ]
  if (vendors.length > 0) {
    steps.push(`mkdir -p -- ${prefix}/bin`)
    for (const vendor of vendors) {
      steps.push(`cp -- ${quoteShellArg(vendor.temp)} ${prefix}/${vendor.relative}`)
    }
  }
  steps.push(`chmod +x -- ${prefix}/dsh-core ${vendors.map(vendor => `${prefix}/${vendor.relative}`).join(' ')}`.trimEnd())
  steps.push(`ln -sfn -- ${quoteShellArg(version)} "$HOME"/.dsh-core/current`)
  steps.push(`rm -f -- ${quoteShellArg(remoteTar)} ${vendors.map(vendor => quoteShellArg(vendor.temp)).join(' ')}`.trimEnd())
  return steps.join(' && ')
}

/** Remote probe for the tools that decide what this deploy has to push. */
export function remoteToolProbe(): string {
  return 'if command -v rg >/dev/null 2>&1; then echo RG; fi; if command -v bwrap >/dev/null 2>&1; then echo BWRAP; fi; true'
}

/**
 * Development aid: names the deploy should treat as ABSENT on the remote even
 * when the probe finds them (`DSW_CORE_VENDOR_FORCE_MISSING=rg,bwrap`). The
 * fetch-and-push branch is otherwise only reachable on a host that genuinely
 * lacks the tool, which makes it painful to exercise locally.
 *
 * @returns the forced names, lowercased, without blanks or duplicates.
 */
export function forcedMissingTools(raw: string | undefined = process.env.DSW_CORE_VENDOR_FORCE_MISSING): readonly string[] {
  if (raw === undefined) return []
  const names = raw.split(',').map(name => name.trim().toLowerCase()).filter(name => name !== '')
  return [...new Set(names)]
}

/**
 * Which of the optional tools the remote already has, honouring
 * {@link forcedMissingTools}.
 *
 * @param probeStdout - the output of {@link remoteToolProbe}.
 * @param forced - names to treat as absent regardless of the probe.
 */
export function remoteToolsPresent(
  probeStdout: string,
  forced: readonly string[] = forcedMissingTools(),
): { rg: boolean; bwrap: boolean } {
  return {
    rg: !forced.includes('rg') && /^RG$/m.test(probeStdout),
    bwrap: !forced.includes('bwrap') && /^BWRAP$/m.test(probeStdout),
  }
}

/**
 * Deploy the linux-x64 tarball to the login user's `~/.dsh-core/<version>/`.
 *
 * Never fails just because an optional tool is unavailable: the core is still
 * deployed and the returned detail explains what is missing and where the
 * official copy comes from.
 */
export async function deployCore(
  transport: SshTransport,
  options: { artifact?: string | undefined; signal?: AbortSignal | undefined } = {},
): Promise<CoreStatusView> {
  const artifact = options.artifact ?? localCoreTarball()
  if (!existsSync(artifact)) {
    return { ok: false, detail: `core artifact missing: ${artifact}` }
  }
  let manifest: unknown
  try {
    manifest = readTarballManifest(artifact)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, detail: `cannot read MANIFEST.json from ${artifact}: ${detail}` }
  }
  const issues = manifestIssues(manifest)
  if (issues.length > 0) {
    return { ok: false, detail: `core artifact incomplete (${artifact}): ${issues.join('; ')}` }
  }
  const execOptions = options.signal !== undefined ? { signal: options.signal } : undefined
  const uname = await transport.exec('uname -s; uname -m', execOptions)
  const [sys, machine] = uname.stdout.split(/\r?\n/).map(line => line.trim())
  try {
    assertLinuxAmd64(sys ?? '', machine ?? '')
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  const version = CORE_ARTIFACT_VERSION
  const tarName = coreArtifactName()
  const sftp = await transport.getSftp(options.signal)
  await transport.exec('mkdir -p -- "$HOME"/.dsh-core', execOptions)

  const notes: string[] = []
  const probe = await transport.exec(remoteToolProbe(), execOptions)
  const forced = forcedMissingTools()
  const { rg: remoteHasRg, bwrap: remoteHasBwrap } = remoteToolsPresent(probe.stdout, forced)
  if (forced.length > 0) {
    notes.push(`DSW_CORE_VENDOR_FORCE_MISSING=${forced.join(',')} (development aid: the probe above is not authoritative)`)
  }

  const vendors: VendorFile[] = []
  if (!remoteHasRg) {
    const outcome = ensureRgVendor()
    if (outcome.ok) {
      const temp = `/tmp/dsh-core-rg-${RG_VENDOR.version}`
      await sftpWrite(sftp, temp, readFileSync(outcome.path))
      vendors.push({ temp, relative: 'bin/rg' })
      notes.push(outcome.cached
        ? `provisioned rg ${RG_VENDOR.version} from the host cache`
        : `fetched rg ${RG_VENDOR.version} from the official release`)
    } else {
      notes.push(outcome.detail)
    }
  }
  if (!remoteHasBwrap) {
    notes.push(`the remote has no bwrap — fenced work will refuse until it is installed (${bwrapInstallHints().join('; ')})`)
  }

  const remoteTar = `/tmp/${tarName}`
  await sftpWrite(sftp, remoteTar, readFileSync(artifact))
  const script = coreInstallScript(version, remoteTar, vendors)
  const outcome = await transport.exec(script, execOptions)
  if (outcome.exitCode !== 0) {
    return { ok: false, detail: (outcome.stderr || outcome.stdout || 'extract failed').trim() }
  }
  const ver = await transport.exec('"$HOME"/.dsh-core/current/dsh-core version', execOptions)
  if (ver.exitCode !== 0) {
    return { ok: false, version, detail: (ver.stderr || ver.stdout || 'version probe failed').trim() }
  }
  const note = notes.length > 0 ? notes.join('; ') : undefined
  try {
    const parsed = JSON.parse(ver.stdout) as { version?: string; arch?: string; proto?: number; caps?: string[] }
    return {
      ok: true,
      version: parsed.version ?? version,
      arch: parsed.arch,
      proto: parsed.proto,
      caps: parsed.caps,
      ...(note !== undefined ? { detail: note } : {}),
    }
  } catch {
    return { ok: true, version, detail: note ?? ver.stdout.trim() }
  }
}

export async function coreStatusViaExec(transport: SshTransport, signal?: AbortSignal): Promise<CoreStatusView> {
  const outcome = await transport.exec(
    'if test -x "$HOME"/.dsh-core/current/dsh-core; then "$HOME"/.dsh-core/current/dsh-core version; else echo MISSING; fi',
    signal !== undefined ? { signal } : undefined,
  )
  const text = outcome.stdout.trim()
  if (text === 'MISSING' || outcome.exitCode !== 0) {
    return { ok: false, detail: 'core not installed' }
  }
  try {
    const parsed = JSON.parse(text) as { version?: string; arch?: string; proto?: number; caps?: string[] }
    return { ok: true, version: parsed.version, arch: parsed.arch, proto: parsed.proto, caps: parsed.caps }
  } catch {
    return { ok: false, detail: text }
  }
}
