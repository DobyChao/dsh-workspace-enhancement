/**
 * Host-key fingerprint helpers and the TOFU (trust-on-first-use) host-key
 * registry — ported from dsh-remote (`lib/hostkey.js`) with the defensive
 * dual-shape handling kept intact.
 *
 * ssh2 v1.17 hands `hostVerifier` the RAW host-key blob Buffer (SSH wire format
 * `string(algo) string(keydata)`), not the old `{ algo, hash }` object; both
 * shapes are accepted so a contract drift fails closed instead of throwing a
 * crypto error on every connect.
 *
 * The persisted store reuses dsh-remote's path AND format —
 * `<dsh home>/remote-workspaces/known_hosts.json`, keyed `host:port` →
 * `{ algo, fingerprint, firstSeen }` — so an existing dsh-remote installation
 * hands its trust records over without conversion on first start.
 * @module dsh-workspace-enhancement/hostkey
 */

import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

/** Host-key policy modes (dsh-remote's TOFU triple). */
export type HostKeyMode = 'accept-new' | 'verify' | 'off'

/** Resolve the harness home: `DSH_HOME` when set, else `~/.dsh`. */
export function dshHome(): string {
  const env = process.env.DSH_HOME
  if (env !== undefined && String(env).trim() !== '') return resolve(String(env).trim())
  return join(homedir(), '.dsh')
}

/** Root holding the machine registry, TOFU store, and keychain secrets. */
export function remoteWorkspacesRoot(): string {
  return join(dshHome(), 'remote-workspaces')
}

/** Default TOFU store location (dsh-remote's path, kept for migration). */
export function defaultKnownHostsFile(): string {
  return join(remoteWorkspacesRoot(), 'known_hosts.json')
}

/** Default OS-keychain secrets directory. */
export function defaultSecretsDir(): string {
  return join(remoteWorkspacesRoot(), '.secrets')
}

/** One trusted host-key record (the dsh-remote known_hosts.json entry shape). */
export interface KnownHostEntry {
  algo: string
  fingerprint: string
  firstSeen: string
}

/** Trusted host-key map, keyed `host:port` (dsh-remote spelling). */
export type KnownHosts = Record<string, KnownHostEntry>

/**
 * Extract the SSH host-key algorithm name from a raw SSH host-key blob
 * (SSH wire format: `uint32 len` + algorithm string + key data). Older ssh2
 * `{ algo, hash }` objects are accepted as a defensive fallback.
 */
export function blobAlgorithm(blob: unknown): string {
  if (typeof blob === 'object' && blob !== null && !Buffer.isBuffer(blob)) {
    const algo = (blob as { algo?: unknown }).algo
    if (typeof algo === 'string' && algo !== '') return algo
    return 'unknown'
  }
  if (!Buffer.isBuffer(blob) || blob.length < 4) return ''
  try {
    const len = blob.readUInt32BE(0)
    return blob.toString('utf8', 4, 4 + len)
  } catch {
    return ''
  }
}

/**
 * SHA-256 fingerprint (base64) of an ssh2 host-key blob. Accepts both the raw
 * wire blob and the legacy `{ hash }` shape; a missing key is a hard error so
 * a contract drift surfaces instead of silently accepting the host.
 */
export function keyFingerprint(key: unknown): string {
  const blob = Buffer.isBuffer(key)
    ? key
    : (key as { hash?: unknown } | null | undefined)?.hash
  if (!Buffer.isBuffer(blob)) {
    throw new Error('host key missing (hostVerifier received no key blob)')
  }
  return createHash('sha256').update(blob).digest('base64')
}

/** Build a fake-but-wire-shaped host-key blob for tests:
 * `string(algo) string(32 bytes)`. */
export function makeKeyBlob(algo: string, seed?: number): Buffer {
  const algoBuf = Buffer.from(algo, 'utf8')
  const data = Buffer.alloc(32, seed ?? 1)
  const blob = Buffer.alloc(4 + algoBuf.length + 4 + data.length)
  blob.writeUInt32BE(algoBuf.length, 0)
  algoBuf.copy(blob, 4)
  blob.writeUInt32BE(data.length, 4 + algoBuf.length)
  data.copy(blob, 8 + algoBuf.length)
  return blob
}

/** Persisted TOFU store: load/save/forget on one known_hosts.json file. */
export class HostKeyStore {
  constructor(private readonly file: string) {}

  /** The store file path. */
  get filePath(): string {
    return this.file
  }

  /** Read the whole store; an absent or corrupt file reads as empty. */
  load(): KnownHosts {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as KnownHosts
      }
    } catch {
      // Absent or corrupt → start empty; the next accepted key rewrites it.
    }
    return {}
  }

  /** One entry, or `undefined` when the host:port was never recorded. */
  get(host: string, port: number): KnownHostEntry | undefined {
    return this.load()[`${host}:${port}`]
  }

  /** Atomically-enough rewrite of the store (mkdir -p first). */
  save(entries: KnownHosts): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
    } catch {
      // A read-only home must not block connect; recording is best-effort.
    }
    writeFileSync(this.file, JSON.stringify(entries, null, 2) + '\n', 'utf8')
  }

  /** Remove one host:port record. Returns whether it existed. */
  forget(host: string, port: number): boolean {
    const entries = this.load()
    const key = `${host}:${port}`
    if (!Object.prototype.hasOwnProperty.call(entries, key)) return false
    delete entries[key]
    this.save(entries)
    return true
  }
}

/**
 * TOFU host-key guard bound to one store and one mode. The verifier records a
 * never-seen key under `accept-new`, rejects a changed key always, rejects an
 * unknown key under `verify`, and accepts everything under `off`.
 */
export class HostKeyGuard {
  /** Last verification failure detail; a connect rewriter may surface it. */
  lastError: string | null = null

  constructor(
    private readonly store: HostKeyStore,
    private readonly mode: HostKeyMode,
  ) {}

  /** Whether the given host:port has a stored fingerprint. */
  isKnown(host: string, port: number): boolean {
    return this.store.get(host, port) !== undefined
  }

  /** Drop the stored fingerprint; the next connect re-records it. */
  forget(host: string, port: number): boolean {
    return this.store.forget(host, port)
  }

  /** Build the per-host ssh2 `hostVerifier` callback for one endpoint. */
  verifier(host: string, port: number): (key: Buffer) => boolean {
    const id = `${host}:${port}`
    return (key: Buffer): boolean => {
      if (this.mode === 'off') return true
      const fingerprint = keyFingerprint(key)
      const stored = this.store.get(host, port)
      if (stored !== undefined) {
        if (stored.fingerprint === fingerprint) {
          this.lastError = null
          return true
        }
        this.lastError =
          `host key for ${id} CHANGED (stored ${stored.fingerprint}, received ${fingerprint}) — ` +
          'possible man-in-the-middle; discard the record (hostkey.forget) to re-trust if this is expected'
        return false
      }
      if (this.mode === 'verify') {
        this.lastError = `unknown host key for ${id} (hostKeyMode=verify) — connect once with accept-new to trust it`
        return false
      }
      const entries = this.store.load()
      entries[id] = {
        algo: blobAlgorithm(key) || 'unknown',
        fingerprint,
        firstSeen: new Date().toISOString(),
      }
      this.store.save(entries)
      this.lastError = null
      return true
    }
  }
}
