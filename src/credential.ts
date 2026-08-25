/**
 * Optional OS-keychain password storage — ported from dsh-remote
 * (`lib/credential.js`). Machines keep their password in the OS credential
 * store instead of the plaintext machines.json when the operator asked to
 * encrypt it per machine.
 *
 * Every backend is best-effort: any failure resolves to `{ ok: false }` and the
 * caller falls back to plaintext — the feature must never block connecting.
 *
 * Backends:
 *   darwin  → `security` (login keychain, generic password)
 *   win32   → DPAPI via PowerShell (CurrentUser scope), files under
 *             `$DSH_HOME/remote-workspaces/.secrets/`
 *   linux   → `secret-tool` (libsecret / gnome-keyring), optional
 *   else    → unsupported (plain)
 * @module dsh-workspace-enhancement/credential
 */

import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SERVICE = 'dsh-remote'
const TIMEOUT = 8000

/** Per-machine credential storage backend. */
export type CredentialBackend = 'plain' | 'keychain' | 'windows' | 'secret'

function run(bin: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: TIMEOUT, maxBuffer: 1 << 20, ...(input !== undefined ? { input } : {}) },
      (error, stdout, _stderr) => {
        if (error !== null) {
          reject(error)
          return
        }
        resolve(String(stdout ?? '').trim())
      },
    )
  })
}

/** The backend the current platform should use when encryption is requested. */
export function platformBackend(): CredentialBackend {
  if (process.platform === 'darwin') return 'keychain'
  if (process.platform === 'win32') return 'windows'
  return 'secret' // linux (secret-tool may be absent → falls back to plain)
}

/** Only machine ids are stored; sanitize just in case. */
function account(machineId: string): string {
  return String(machineId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Save a password to the OS store. Resolves `{ ok, backend }`; `ok: false` on
 * any failure (the caller falls back to plaintext).
 */
export async function saveSecret(
  machineId: string,
  password: string,
  secretsDir: string,
): Promise<{ ok: boolean; backend: CredentialBackend }> {
  const acc = account(machineId)
  try {
    if (process.platform === 'darwin') {
      await run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', acc, '-w', String(password)])
      return { ok: true, backend: 'keychain' }
    }
    if (process.platform === 'win32') {
      // DPAPI-encrypt and store under the harness home. Windows PowerShell 5.1
      // (.NET Framework) does not auto-load System.Security.Cryptography.ProtectedData
      // (it lives in System.Security.dll), so the assembly is loaded explicitly —
      // without it every Protect call fails and the caller silently falls back
      // to plaintext (the B4 regression).
      const script =
        'Add-Type -AssemblyName System.Security;' +
        `$p='${String(password).replaceAll('\'', '\'\'')}';` +
        '$s=[System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($p),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);' +
        '[Convert]::ToBase64String($s)'
      const b64 = await run('powershell', ['-NoProfile', '-STA', '-Command', script])
      if (b64 === '') return { ok: false, backend: 'windows' }
      mkdirSync(secretsDir || '.', { recursive: true })
      writeFileSync(join(secretsDir || '.', `${acc}.bin`), b64, 'utf8')
      return { ok: true, backend: 'windows' }
    }
    if (process.platform === 'linux') {
      await run('secret-tool', ['store', `--label=${SERVICE}`, 'service', SERVICE, 'account', acc], `${String(password)}\n`)
      return { ok: true, backend: 'secret' }
    }
  } catch {
    // Fall through to plaintext.
  }
  return { ok: false, backend: platformBackend() }
}

/** Fetch a stored password. Resolves the password string, or `null`. */
export async function getSecret(machineId: string, secretsDir: string): Promise<string | null> {
  const acc = account(machineId)
  try {
    if (process.platform === 'darwin') {
      return await run('security', ['find-generic-password', '-s', SERVICE, '-a', acc, '-w'])
    }
    if (process.platform === 'win32') {
      const b64 = readFileSync(join(secretsDir || '.', `${acc}.bin`), 'utf8').trim()
      if (b64 === '') return null
      // Same assembly preload as saveSecret: PS 5.1 cannot resolve
      // ProtectedData without it.
      const script =
        'Add-Type -AssemblyName System.Security;' +
        `$s=[Convert]::FromBase64String('${b64}');` +
        '[Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($s,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))'
      return await run('powershell', ['-NoProfile', '-STA', '-Command', script])
    }
    if (process.platform === 'linux') {
      return await run('secret-tool', ['lookup', 'service', SERVICE, 'account', acc])
    }
  } catch {
    // Best effort: fall through to plaintext / null.
  }
  return null
}

/** Delete a stored password (idempotent). */
export async function deleteSecret(machineId: string, secretsDir: string): Promise<void> {
  const acc = account(machineId)
  try {
    if (process.platform === 'darwin') {
      await run('security', ['delete-generic-password', '-s', SERVICE, '-a', acc]).catch(() => undefined)
      return
    }
    if (process.platform === 'win32') {
      try {
        unlinkSync(join(secretsDir || '.', `${acc}.bin`))
      } catch {
        // Absent secret → nothing to delete.
      }
      return
    }
    if (process.platform === 'linux') {
      await run('secret-tool', ['clear', 'service', SERVICE, 'account', acc]).catch(() => undefined)
    }
  } catch {
    // Best effort.
  }
}
