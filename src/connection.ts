/**
 * One standalone SSH connection owned by the connection registry (not the
 * `ctx.ssh` service): the same ProxyJump chain, auth, SFTP, and exec mechanics
 * as `SshRuntime`, but bound to a registry entry instead of the shared
 * service. The registry uses it for connection tests and per-connection
 * directory browsing; the `ssh://<id>/<path>` cwd routing in the providers
 * rides the same instances.
 *
 * The shared session state lives in {@link module:dsh-workspace-enhancement/ssh-core};
 * this module only resolves a registry spec into the hop chain and wires the
 * per-connection error messages. Host-key policy resolution order:
 * `spec.hostKeyMode` (TOFU) → `spec.strictHostKeyChecking`/`spec.knownHosts`
 * (legacy manual) → the registry-wide default mode (TOFU `accept-new`).
 * @module dsh-workspace-enhancement/connection
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Client, SFTPWrapper } from 'ssh2'
import { SshSession, resolveRemoteCwd as mapRemoteCwd } from './ssh-core.ts'
import type { ExecOutcome, ResolvedConnectionHost } from './ssh-core.ts'
import type { JumpConfig } from './runtime.ts'
import { HostKeyGuard, HostKeyStore, defaultKnownHostsFile } from './hostkey.ts'
import type { HostKeyMode } from './hostkey.ts'
import type { CredentialBackend } from './credential.ts'

/** A registry entry as persisted in the state file (machine record). */
export interface SshConnectionSpec {
  /** Stable registry id (`c1`, `c2`, …). */
  id: string
  /** Operator-facing display name. */
  label: string
  /** dsh-remote compat alias; `label` wins when both are present. */
  name?: string
  /** Target hostname or address. */
  host: string
  /** Target SSH port. */
  port: number
  /** Remote login user. */
  username: string
  /** Password authentication (stored verbatim when `credentialBackend` is plain). */
  password?: string
  /** Local path to a PEM identity file. */
  privateKeyPath?: string
  /** Passphrase for an encrypted private key. */
  passphrase?: string
  /** SSH agent socket path or the `pageant` sentinel for Windows. */
  agent?: string
  /** Ordered ProxyJump chain (same semantics as the ssh service). */
  jump?: JumpConfig[]
  /** Remote working directory (dsh-ssh legacy spelling); an absolute POSIX path. */
  cwd?: string
  /**
   * Remote working directory (dsh-remote canonical spelling); an absolute
   * POSIX path. When both are present, `workspace` wins.
   */
  workspace?: string
  /** Socket connect timeout in milliseconds. */
  readyTimeout?: number
  /** TCP keepalive interval in milliseconds; 0 disables. */
  keepaliveInterval?: number
  /** TCP keepalive retry budget before the connection is considered dead. */
  keepaliveCountMax?: number
  /**
   * Per-machine TOFU policy; overrides the registry-wide default. Absent and
   * `strictHostKeyChecking`/`knownHosts` absent → the default mode
   * (`accept-new`).
   */
  hostKeyMode?: HostKeyMode
  /**
   * When true and no {@link hostKeyMode} is set, reject a host key that does
   * not match an entry in {@link knownHosts}. Defaults to false (historical
   * behavior); the TOFU default replaces it for new records.
   */
  strictHostKeyChecking?: boolean
  /** Trusted host keys as `SHA256:<base64>` fingerprints or raw base64 public keys. */
  knownHosts?: string[]
  /** OS-keychain storage backend for the password (else plaintext). */
  credentialBackend?: CredentialBackend
  /**
   * The operator asked for encrypted storage but the OS backend failed and the
   * password fell back to plaintext; the UI shows a warning for these.
   */
  encryptFallback?: boolean
  /** Last workspaces picked on this machine, most recent first (max 8). */
  recentWorkspaces?: string[]
  /** ISO-8601 timestamp of the last successful status probe (conn.probe/reconnect). */
  lastProbeAt?: string
  /** Round-trip milliseconds of the last successful status probe. */
  lastProbeLatencyMs?: number | null
}

/** Connection-level host-key policy resolved from a spec + global default. */
export type HostKeyPolicy =
  | { kind: 'tofu'; mode: HostKeyMode }
  | { kind: 'manual' }
  | { kind: 'none' }

/** Minimal source of host-key policy fields (spec, config, machine record). */
export interface HostKeyPolicySource {
  hostKeyMode?: HostKeyMode
  strictHostKeyChecking?: boolean
}

/**
 * Resolve a spec's host-key policy. Priority: `hostKeyMode` (TOFU) →
 * `strictHostKeyChecking`/`knownHosts` (legacy manual; `false` = no
 * verification, preserving historical behavior) → the registry-wide default
 * mode (TOFU, default `accept-new`).
 */
export function resolveHostKeyPolicy(source: HostKeyPolicySource, defaultMode: HostKeyMode): HostKeyPolicy {
  if (source.hostKeyMode !== undefined) return { kind: 'tofu', mode: source.hostKeyMode }
  if (source.strictHostKeyChecking === true) return { kind: 'manual' }
  if (source.strictHostKeyChecking === false) return { kind: 'none' }
  return { kind: 'tofu', mode: defaultMode }
}

/**
 * Every credential-bearing field value of a spec that must never surface in a
 * transited error message (private-key paths, passwords, passphrases — the
 * target and every jump hop).
 */
function sensitiveSpecValues(spec: SshConnectionSpec): string[] {
  const values: string[] = []
  const push = (value: string | undefined): void => {
    if (typeof value === 'string' && value !== '') values.push(value)
  }
  push(spec.privateKeyPath)
  push(spec.password)
  push(spec.passphrase)
  for (const hop of spec.jump ?? []) {
    push(hop.privateKey)
    push(hop.password)
    push(hop.passphrase)
  }
  return values
}

/**
 * Replace every occurrence of one value in a message with `<redacted>`. Path
 * values (containing a separator, e.g. an ENOENT message quoting a private-key
 * file) are always redacted; password/passphrase values shorter than the
 * threshold are skipped — error text never quotes the password itself, and
 * substituting a 1–2 character value would collide with ordinary words and
 * wreck the message.
 * @param message - the message to sanitize (transited text only; the error
 *   object and its FsError mapping semantics are untouched).
 * @param values - the sensitive field values cleared from the message.
 * @returns the sanitized message.
 */
export function redactValues(message: string, values: readonly string[]): string {
  let redacted = message
  for (const value of values) {
    if (value.length < 4 && !/[\\/]/.test(value)) continue
    redacted = redacted.split(value).join('<redacted>')
  }
  return redacted
}

/**
 * Redact every credential-bearing field value of a spec from a message
 * (private-key paths, passwords, passphrases — the target and every jump hop).
 * @param message - the message to sanitize (transited text only).
 * @param spec - the spec whose secret values are cleared from the message.
 * @returns the sanitized message.
 */
export function redactSpecMessage(message: string, spec: SshConnectionSpec): string {
  return redactValues(message, sensitiveSpecValues(spec))
}

/**
 * ssh2 failures carry transport `code`s (ECONNREFUSED, CLIENT_AUTH…) that host
 * services forward verbatim and their closed wire vocabularies then reject;
 * rewrap into a bare Error so consumers fall back to their own mapping. Abort
 * reasons and our own messages pass through untouched. The inner message is
 * redacted so credential values (private-key paths, passwords) never reach the
 * UI or the logs.
 */
function rewrapConnectError(error: unknown, label: string, endpoint: string, spec: SshConnectionSpec): unknown {
  if (!(error instanceof Error)) return error
  if (error.name === 'AbortError' || error.message.startsWith('dsw:')) return error
  return new Error(`dsw: cannot connect to "${label}" (${endpoint}): ${redactSpecMessage(error.message, spec)}`)
}

/** Read one identity file, redacting a failure message built from its path.
 * Node quotes the `~`-EXPANDED path in an ENOENT message, so both the
 * configured spelling and the expanded one are cleared (the raw
 * `redactSpecMessage` on the spec alone would miss the expanded form). */
function readIdentityFileFor(spec: SshConnectionSpec, path: string): string {
  const expanded = path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
  try {
    return readFileSync(expanded, 'utf8')
  } catch (error) {
    if (error instanceof Error) error.message = redactValues(redactSpecMessage(error.message, spec), [expanded])
    throw error
  }
}

/** Options passed by the registry into every connection it owns. */
export interface SshConnectionOptions {
  /** TOFU store; defaults to `<dsh home>/remote-workspaces/known_hosts.json`. */
  hostKeyStore?: HostKeyStore
  /** Registry-wide default TOFU mode applied when the spec sets no policy. */
  defaultHostKeyMode?: HostKeyMode
  /**
   * Async password provider for keychain-backed machines; consulted before the
   * chain is opened so an OS-store password never lands in the persisted spec.
   */
  passwordProvider?: (machineId: string) => Promise<string | undefined>
}

/**
 * Resolve the keychain-backed password into the chain's TARGET hop. An
 * explicit non-empty password ALWAYS wins; an empty string counts as "no
 * explicit password" so a keychain machine persisted with `password: ''`
 * (same-session save) still resolves its secret. A provider miss leaves the
 * hops untouched (no empty-password auth attempt). Jump hops keep their own
 * auth as configured.
 * @param current - the configured hop chain (target last).
 * @param provider - the machine's password resolver (OS keychain, best-effort).
 * @param machineId - the machine id the provider resolves for.
 * @returns the enriched hop chain, or `current` unchanged on a provider miss.
 */
export async function resolveTargetPassword(
  current: readonly ResolvedConnectionHost[],
  provider: (machineId: string) => Promise<string | undefined>,
  machineId: string,
): Promise<readonly ResolvedConnectionHost[]> {
  const password = await provider(machineId)
  if (password === undefined || password === '') return current
  return current.map((hop, index) => (
    index === current.length - 1 && (hop.password === undefined || hop.password === '')
      ? { ...hop, password }
      : hop
  ))
}

/** A registry-owned live SSH connection (jump chain + shared SFTP). */
export class SshConnection {
  readonly id: string
  readonly label: string
  readonly endpoint: string

  private readonly session: SshSession
  private readonly hostKeyPolicy: HostKeyPolicy
  private readonly hostKeyGuard: HostKeyGuard | undefined
  private readonly hostKeyStore: HostKeyStore

  /** The transport's default remote working directory (`workspace` wins). */
  get cwd(): string {
    return this.spec.workspace ?? this.spec.cwd ?? '/root'
  }

  /** The resolved host-key policy for this connection. */
  get policy(): HostKeyPolicy {
    return this.hostKeyPolicy
  }

  /** Build the hop chain from a registry spec (auth defaults fall down the chain). */
  constructor(readonly spec: SshConnectionSpec, options: SshConnectionOptions = {}) {
    this.id = spec.id
    this.label = spec.label
    this.endpoint = `${spec.username}@${spec.host}`
    // Tailscale/DERP-relayed paths routinely exceed 20s to ready (observed
    // 4–20s variance); OpenSSH has no client-side handshake cap at all.
    const readyTimeout = spec.readyTimeout ?? 45_000
    const keepaliveInterval = spec.keepaliveInterval ?? 0
    const keepaliveCountMax = spec.keepaliveCountMax ?? 3
    const parent: ResolvedConnectionHost = {
      host: spec.host,
      port: spec.port,
      username: spec.username,
      readyTimeout,
      keepaliveInterval,
      keepaliveCountMax,
    }
    // An empty-string password means "no explicit password" (the keychain
    // backend persists `''` as the no-plaintext marker); writing it would both
    // force an empty-password auth attempt and mask the keychain resolution
    // below, so only non-empty values land in the hop chain.
    if (spec.password !== undefined && spec.password !== '') parent.password = spec.password
    if (spec.privateKeyPath !== undefined) parent.privateKey = readIdentityFileFor(spec, spec.privateKeyPath)
    if (spec.passphrase !== undefined) parent.passphrase = spec.passphrase
    if (spec.agent !== undefined) parent.agent = spec.agent
    const hops: ResolvedConnectionHost[] = [...(spec.jump ?? []).map((jump): ResolvedConnectionHost => {
      const hop: ResolvedConnectionHost = {
        host: jump.host ?? parent.host,
        port: jump.port ?? parent.port,
        username: jump.username ?? parent.username,
        readyTimeout: jump.readyTimeout ?? readyTimeout,
        keepaliveInterval: jump.keepaliveInterval ?? keepaliveInterval,
        keepaliveCountMax: jump.keepaliveCountMax ?? keepaliveCountMax,
      }
      if (jump.password !== undefined) hop.password = jump.password
      if (jump.privateKey !== undefined) hop.privateKey = jump.privateKey.includes('-----BEGIN') ? jump.privateKey : readIdentityFileFor(spec, jump.privateKey)
      if (jump.passphrase !== undefined) hop.passphrase = jump.passphrase
      if (jump.agent !== undefined) hop.agent = jump.agent
      return hop
    }), parent]
    this.hostKeyStore = options.hostKeyStore ?? new HostKeyStore(defaultKnownHostsFile())
    this.hostKeyPolicy = resolveHostKeyPolicy(spec, options.defaultHostKeyMode ?? 'accept-new')
    if (this.hostKeyPolicy.kind !== 'tofu') {
      this.hostKeyGuard = undefined
    } else {
      this.hostKeyGuard = new HostKeyGuard(this.hostKeyStore, this.hostKeyPolicy.mode)
    }
    const hostKeyGuard = this.hostKeyGuard
    const sessionHostVerifier = hostKeyGuard === undefined
      ? undefined
      : (host: ResolvedConnectionHost, key: Buffer): boolean => hostKeyGuard.verifier(host.host, host.port)(key)
    const passwordProvider = options.passwordProvider
    const resolveHosts = passwordProvider === undefined
      ? undefined
      : (current: readonly ResolvedConnectionHost[]): Promise<readonly ResolvedConnectionHost[]> =>
        resolveTargetPassword(current, passwordProvider, this.id)
    this.session = new SshSession(hops, spec.strictHostKeyChecking ?? false, spec.knownHosts ?? [], {
      disposedMessage: `dsw: connection "${this.label}" is disposed`,
      label: this.label,
      ...(sessionHostVerifier !== undefined ? { hostVerifier: sessionHostVerifier } : {}),
      ...(resolveHosts !== undefined ? { resolveHosts } : {}),
      connectErrorRewriter: (error) => {
        const hostKeyError = hostKeyGuard?.lastError
        if (hostKeyError !== null && hostKeyError !== undefined) {
          return new Error(`dsw: ${hostKeyError}`)
        }
        return rewrapConnectError(error, this.label, this.endpoint, spec)
      },
      resolveRemoteCwd: (cwd) => mapRemoteCwd(this.cwd, cwd),
    })
  }

  /**
   * Whether the jump chain reached its ready state and has not been disposed.
   * Never forces a connect; a brand-new connection reports `false`.
   */
  isConnected(): boolean {
    return this.session.isConnected()
  }

  /** Whether the given endpoint has a recorded TOFU fingerprint. */
  hostKeyKnown(host?: string, port?: number): boolean {
    return this.hostKeyStore.get(host ?? this.spec.host, port ?? this.spec.port) !== undefined
  }

  /** The trust record for this connection's endpoint, if any. */
  hostKeyEntry(): { algo: string; fingerprint: string; firstSeen: string } | undefined {
    return this.hostKeyStore.get(this.spec.host, this.spec.port)
  }

  /** Release the chain and the shared SFTP channel. */
  dispose(): void {
    this.session.dispose()
  }

  /**
   * Map a caller-supplied working directory onto this connection's host. The
   * rules mirror {@link SshRuntime.resolveRemoteCwd}: a POSIX absolute path is
   * already remote, while a Windows drive/UNC path or the absent cwd falls
   * back to the registry entry's configured remote cwd.
   */
  resolveRemoteCwd(cwd: string | undefined): string {
    return mapRemoteCwd(this.cwd, cwd)
  }

  /** The authenticated target client after the jump chain succeeds. */
  getClient(signal?: AbortSignal): Promise<Client> {
    return this.session.getClient(signal)
  }

  /** The shared SFTP channel, opened lazily once per connection. */
  getSftp(signal?: AbortSignal): Promise<SFTPWrapper> {
    return this.session.getSftp(signal)
  }

  /** The remote login environment, read once and cached. */
  getRemoteEnvironment(signal?: AbortSignal): Promise<Record<string, string>> {
    return this.session.getRemoteEnvironment(signal)
  }

  /** Run one control-plane command with collected output. */
  exec(command: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<ExecOutcome> {
    return this.session.exec(command, opts)
  }
}

export default SshConnection
