/**
 * REQ-I5: upload a core tarball over SFTP and point `~/.dsh-core/current` at it.
 *
 * Operator action only — never triggered by a model tool.
 *
 * @module dsh-workspace-enhancement/core-deploy
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SFTPWrapper } from 'ssh2'
import { CORE_ARTIFACT_VERSION } from './core-protocol.ts'
import { coreArtifactName, type CoreStatusView } from './core-hub.ts'
import { quoteShellArg } from './ssh-core.ts'
import type { SshTransport } from './transport.ts'

const LINUX = new Set(['linux', 'Linux'])
const AMD64 = new Set(['x86_64', 'amd64', 'x64'])

export function localCoreTarball(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'core', 'dist', coreArtifactName())
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
 * Remote extract + chmod + current symlink. Windows-built tarballs land as
 * 644; `bin/bwrap` and `bin/rg` must be executable or the self-jail cannot start.
 */
export function coreInstallScript(version: string, remoteTar: string): string {
  const prefix = `"$HOME"/.dsh-core/${version}`
  return [
    `mkdir -p -- ${prefix}`,
    `tar -xzf ${quoteShellArg(remoteTar)} -C ${prefix}`,
    `chmod +x -- ${prefix}/dsh-core ${prefix}/bin/bwrap ${prefix}/bin/rg`,
    `ln -sfn -- ${quoteShellArg(version)} "$HOME"/.dsh-core/current`,
    `rm -f -- ${quoteShellArg(remoteTar)}`,
  ].join(' && ')
}

/**
 * Deploy the linux-x64 tarball to the login user's `~/.dsh-core/<version>/`.
 */
export async function deployCore(
  transport: SshTransport,
  options: { artifact?: string | undefined; signal?: AbortSignal | undefined } = {},
): Promise<CoreStatusView> {
  const artifact = options.artifact ?? localCoreTarball()
  if (!existsSync(artifact)) {
    return { ok: false, detail: `core artifact missing: ${artifact}` }
  }
  const uname = await transport.exec('uname -s; uname -m', options.signal !== undefined ? { signal: options.signal } : undefined)
  const [sys, machine] = uname.stdout.split(/\r?\n/).map(line => line.trim())
  try {
    assertLinuxAmd64(sys ?? '', machine ?? '')
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  const version = CORE_ARTIFACT_VERSION
  const tarName = coreArtifactName()
  const sftp = await transport.getSftp(options.signal)
  await transport.exec('mkdir -p -- "$HOME"/.dsh-core', options.signal !== undefined ? { signal: options.signal } : undefined)
  const remoteTar = `/tmp/${tarName}`
  await sftpWrite(sftp, remoteTar, readFileSync(artifact))
  const script = coreInstallScript(version, remoteTar)
  const outcome = await transport.exec(script, options.signal !== undefined ? { signal: options.signal } : undefined)
  if (outcome.exitCode !== 0) {
    return { ok: false, detail: (outcome.stderr || outcome.stdout || 'extract failed').trim() }
  }
  const ver = await transport.exec('"$HOME"/.dsh-core/current/dsh-core version', options.signal !== undefined ? { signal: options.signal } : undefined)
  if (ver.exitCode !== 0) {
    return { ok: false, version, detail: (ver.stderr || ver.stdout || 'version probe failed').trim() }
  }
  try {
    const parsed = JSON.parse(ver.stdout) as { version?: string; arch?: string; proto?: number; caps?: string[] }
    return {
      ok: true,
      version: parsed.version ?? version,
      arch: parsed.arch,
      proto: parsed.proto,
      caps: parsed.caps,
    }
  } catch {
    return { ok: true, version, detail: ver.stdout.trim() }
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
