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
import { CORE_ARTIFACT_ARCH, CORE_ARTIFACT_VERSION, sha256OfSumOutput } from './core-protocol.ts'
import { coreArtifactName, coreTargetForUname, type CoreStatusView } from './core-hub.ts'
import { extractGzipTarMember } from './gzip-tar.ts'
import { bwrapInstallHints, ensureRgVendorFor, rgSourceFor } from './core-vendor.ts'
import { quoteShellArg } from './ssh-core.ts'
import type { SshTransport } from './transport.ts'

const LINUX = new Set(['linux', 'Linux'])

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

export function localCoreTarball(arch: string = CORE_ARTIFACT_ARCH): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'core', 'dist', coreArtifactName(arch))
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

/** The core tarball deploy will push for this remote. */
export interface LinuxCoreTarget {
  arch: string
  manifestArch: string
}

/**
 * Accept a Linux remote this package ships a core for (REQ-I26).
 * Windows stays refused: there is no bwrap there.
 * @param unameS - `uname -s`.
 * @param unameM - `uname -m`.
 */
export function assertLinuxCore(unameS: string, unameM: string): LinuxCoreTarget {
  if (!LINUX.has(unameS.trim())) {
    throw new Error(`dsh-core supports linux only (uname -s = ${JSON.stringify(unameS.trim())})`)
  }
  const target = coreTargetForUname(unameM)
  if (target === undefined) {
    throw new Error(`dsh-core has no build for this architecture (uname -m = ${JSON.stringify(unameM.trim())}); supported: x86_64, aarch64`)
  }
  return target
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
 * Remote extract + chmod + current symlink. Windows-built tarballs land as
 * 644, so every executable must be chmod'ed explicitly; `vendors` are the extra
 * tools uploaded for this deploy (only what we actually pushed is listed).
 *
 * REQ-I14 probe-then-flip: the freshly extracted `<version>/dsh-core` must
 * ANSWER (`dsh-core version`, exit 0) before `current` is repointed. A failed
 * probe stops the `&&` chain with `current` still on the previous install, so
 * a corrupt or unexecutable artifact can never strand the machine without a
 * working core.
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
  steps.push(`${prefix}/dsh-core version`)
  steps.push(`ln -sfn -- ${quoteShellArg(version)} "$HOME"/.dsh-core/current`)
  steps.push(`rm -f -- ${quoteShellArg(remoteTar)} ${vendors.map(vendor => quoteShellArg(vendor.temp)).join(' ')}`.trimEnd())
  return steps.join(' && ')
}

/** Remote probe for the tools that decide what this deploy has to push. */
export function remoteToolProbe(): string {
  return 'if command -v rg >/dev/null 2>&1; then echo RG; fi; if command -v bwrap >/dev/null 2>&1; then echo BWRAP; fi; true'
}

/* ------------------------------------------------------------- fence tier */

/**
 * REQ-I29: the fence tier one remote can actually enforce, as
 * `dsh-core fenceinfo` reports it. `tier: 'none'` means a confined session
 * will refuse fail-closed — the guidance text then names every way out.
 */
export interface FenceTierView {
  tier: 'bwrap' | 'landlock' | 'none'
  bwrapPath?: string | undefined
  bwrapProbeErr?: string | undefined
  bwrapMissing?: boolean | undefined
  landlockAbi?: number | undefined
  landlockErr?: string | undefined
  notes?: readonly string[] | undefined
}

const FENCE_TIERS: readonly string[] = ['bwrap', 'landlock', 'none']

/**
 * Parse one `dsh-core fenceinfo` JSON line. `undefined` for anything that is
 * not a well-formed tier answer (an older same-line core predating the
 * subcommand, a truncated line) — "unknown" is honest, a guess is not.
 */
export function parseFenceInfo(stdout: string): FenceTierView | undefined {
  const text = stdout.trim()
  if (text === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  if (typeof record.tier !== 'string' || !FENCE_TIERS.includes(record.tier)) return undefined
  const view: FenceTierView = { tier: record.tier as FenceTierView['tier'] }
  if (typeof record.bwrapPath === 'string' && record.bwrapPath !== '') view.bwrapPath = record.bwrapPath
  if (typeof record.bwrapProbeErr === 'string' && record.bwrapProbeErr !== '') view.bwrapProbeErr = record.bwrapProbeErr
  if (record.bwrapMissing === true) view.bwrapMissing = true
  if (typeof record.landlockAbi === 'number') view.landlockAbi = record.landlockAbi
  if (typeof record.landlockErr === 'string' && record.landlockErr !== '') view.landlockErr = record.landlockErr
  if (Array.isArray(record.notes)) {
    const notes = record.notes.filter((note): note is string => typeof note === 'string' && note !== '')
    if (notes.length > 0) view.notes = notes
  }
  return view
}

/**
 * The operator-facing summary of one tier answer — the deploy result's
 * `detail` and the status line both carry exactly this text.
 */
export function fenceTierNote(view: FenceTierView): string {
  const abi = typeof view.landlockAbi === 'number' ? view.landlockAbi : 0
  switch (view.tier) {
    case 'bwrap':
      return `fence tier: bwrap (functionally probed${abi >= 1 ? `; landlock abi ${abi} as fallback` : ''})`
    case 'landlock':
      return `fence tier: landlock (abi ${abi}${view.bwrapProbeErr !== undefined ? `; bwrap unusable: ${view.bwrapProbeErr}` : '; bwrap not installed'}) — /tmp writable but shared, no PID isolation`
    default: {
      const cause = view.bwrapProbeErr !== undefined
        ? `bwrap installed but unusable (${view.bwrapProbeErr})`
        : 'bwrap not installed'
      return `fence tier: NONE — ${cause}, landlock unavailable (abi ${abi}); confined sessions will refuse. Install bubblewrap (${bwrapInstallHints().join('; ')}) or use a Landlock-enabling kernel (linux ≥5.13), or run the work with sandbox mode off`
    }
  }
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
 * Deploy the matching linux tarball to the login user's `~/.dsh-core/<version>/`.
 *
 * Never fails just because an optional tool is unavailable: the core is still
 * deployed and the returned detail explains what is missing and where the
 * official copy comes from.
 */
export async function deployCore(
  transport: SshTransport,
  options: { artifact?: string | undefined; signal?: AbortSignal | undefined } = {},
): Promise<CoreStatusView> {
  const execOptions = options.signal !== undefined ? { signal: options.signal } : undefined
  const uname = await transport.exec('uname -s; uname -m', execOptions)
  const [sys, machine] = uname.stdout.split(/\r?\n/).map(line => line.trim())
  let target: LinuxCoreTarget
  try {
    target = assertLinuxCore(sys ?? '', machine ?? '')
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  const artifact = options.artifact ?? localCoreTarball(target.arch)
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
  const version = CORE_ARTIFACT_VERSION
  const tarName = coreArtifactName(target.arch)
  const sftp = await transport.getSftp(options.signal)
  await transport.exec('mkdir -p -- "$HOME"/.dsh-core', execOptions)

  const notes: string[] = []
  const probe = await transport.exec(remoteToolProbe(), execOptions)
  const forced = forcedMissingTools()
  const { rg: remoteHasRg } = remoteToolsPresent(probe.stdout, forced)
  if (forced.length > 0) {
    notes.push(`DSW_CORE_VENDOR_FORCE_MISSING=${forced.join(',')} (development aid: the probe above is not authoritative)`)
  }

  const vendors: VendorFile[] = []
  if (!remoteHasRg) {
    const outcome = ensureRgVendorFor(target.arch)
    if (!outcome.ok) {
      notes.push(outcome.detail)
    } else {
      const pin = rgSourceFor(target.arch)
      const versionLabel = pin?.version ?? target.arch
      const temp = `/tmp/dsh-core-rg-${versionLabel}-${target.arch}`
      await sftpWrite(sftp, temp, readFileSync(outcome.path))
      vendors.push({ temp, relative: 'bin/rg' })
      notes.push(outcome.cached
        ? `provisioned rg ${versionLabel} from the host cache`
        : `fetched rg ${versionLabel} from the official release`)
    }
  }

  const remoteTar = `/tmp/${tarName}`
  await sftpWrite(sftp, remoteTar, readFileSync(artifact))
  const script = coreInstallScript(version, remoteTar, vendors)
  const outcome = await transport.exec(script, execOptions)
  if (outcome.exitCode !== 0) {
    return { ok: false, detail: (outcome.stderr || outcome.stdout || 'extract failed').trim() }
  }
  // REQ-I17 provenance: the installed binary must be the byte-exact artifact
  // the MANIFEST describes — a corrupt upload/extraction can never become
  // `current`-trusted. (The static gate keeps the shipped sha on the plugin's
  // compat list, so a verified install is a fence-trusted install.)
  const expectedSha = (manifest as { files?: Record<string, string> }).files?.['dsh-core']
  const installed = await transport.exec('sha256sum -- "$HOME"/.dsh-core/current/dsh-core', execOptions)
  const installedSha = /^([0-9a-f]{64})\b/u.exec(installed.stdout.trim().toLowerCase())?.[1]
  if (installed.exitCode !== 0 || installedSha !== expectedSha) {
    return { ok: false, version, detail: `installed binary hash mismatch (expected ${expectedSha ?? '?'}, got ${installedSha ?? 'unreadable'})` }
  }
  const ver = await transport.exec('"$HOME"/.dsh-core/current/dsh-core version', execOptions)
  if (ver.exitCode !== 0) {
    return { ok: false, version, detail: (ver.stderr || ver.stdout || 'version probe failed').trim() }
  }
  // REQ-I29: the fence tier this remote can really enforce — probed by the
  // core itself (functional bwrap run + real Landlock restriction), reported
  // before any session leans on the fence. `undefined` = an older same-line
  // core: unknown is honest, and the version gate keeps that window patched.
  const fenceOut = await transport.exec('"$HOME"/.dsh-core/current/dsh-core fenceinfo', execOptions)
  const fence = parseFenceInfo(fenceOut.stdout)
  if (fence !== undefined) {
    notes.push(fenceTierNote(fence))
  } else if (fenceOut.exitCode !== 0) {
    notes.push('fence tier unknown (fenceinfo unavailable on the deployed core)')
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
      fence,
      ...(note !== undefined ? { detail: note } : {}),
    }
  } catch {
    return { ok: true, version, fence, detail: note ?? ver.stdout.trim() }
  }
}

export async function coreStatusViaExec(transport: SshTransport, signal?: AbortSignal): Promise<CoreStatusView> {
  const execOptions = signal !== undefined ? { signal } : undefined
  const outcome = await transport.exec(
    'if test -x "$HOME"/.dsh-core/current/dsh-core; then "$HOME"/.dsh-core/current/dsh-core version; else echo MISSING; fi',
    execOptions,
  )
  const text = outcome.stdout.trim()
  if (text === 'MISSING' || outcome.exitCode !== 0) {
    return { ok: false, detail: 'core not installed' }
  }
  // REQ-I29: report the enforceable fence tier alongside the version — a
  // "none" answer is guidance the operator needs BEFORE a confined session
  // refuses mid-work.
  const fenceOut = await transport.exec('"$HOME"/.dsh-core/current/dsh-core fenceinfo', execOptions)
  const fence = parseFenceInfo(fenceOut.stdout)
  const fenceDetail = fence !== undefined && fence.tier === 'none' ? fenceTierNote(fence) : undefined
  try {
    const parsed = JSON.parse(text) as { version?: string; arch?: string; proto?: number; caps?: string[] }
    const hashed = await transport.exec('sha256sum -- "$HOME"/.dsh-core/current/dsh-core', execOptions)
    const sha256 = hashed.exitCode === 0 ? sha256OfSumOutput(hashed.stdout) ?? null : null
    return {
      ok: true,
      version: parsed.version,
      arch: parsed.arch,
      proto: parsed.proto,
      caps: parsed.caps,
      sha256,
      fence,
      ...(fenceDetail !== undefined ? { detail: fenceDetail } : {}),
    }
  } catch {
    return { ok: false, detail: text }
  }
}
