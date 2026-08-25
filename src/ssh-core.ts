/**
 * Shared SSH connection mechanics for dsh-workspace-enhancement.
 *
 * One copy of the ProxyJump-chain open, host-key verification, exec channel
 * collection, remote-environment read (with cache), SFTP caching, and shell
 * quoting helpers that the aggregate `ctx.ssh` runtime and the registry-owned
 * `SshConnection` both need. The connection-world contracts (`SshTransport`,
 * `ExecOutcome`, `JumpConfig`, `SshConnectionSpec`) are unchanged; this module
 * only removes the duplicated implementations of `runtime.ts` and
 * `connection.ts`, which are thin shells around {@link SshSession} now.
 * @module dsh-workspace-enhancement/ssh-core
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'
import { Client } from 'ssh2'
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2'

/** Collected result of one control-plane command. */
export interface ExecOutcome {
  /** Exit code; null when the command died from a signal. */
  exitCode: number | null
  /** Terminating signal; null on normal exit. */
  signal: string | null
  /** Collected standard output. */
  stdout: string
  /** Collected standard error. */
  stderr: string
}

/** One connection hop after auth and defaults are resolved. */
export interface ResolvedConnectionHost {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string | Buffer
  passphrase?: string
  agent?: string
  readyTimeout: number
  keepaliveInterval: number
  keepaliveCountMax: number
}

/**
 * Quote one argument for a POSIX login shell: single quotes with the only
 * escaping a single-quoted string needs. Identical in spirit to the E2B
 * adapter's helper so both remote providers share one quoting rule.
 * @param value - exact argument value to preserve.
 * @returns a single shell word with no interpolation.
 */
export function quoteShellArg(value: string): string {
  return `'${value.replaceAll('\'', '\'"\'"\'')}'`
}

/**
 * Wrap a remote command so it runs from the configured working directory.
 * @param cwd - absolute remote working directory.
 * @param command - the remote command to run there.
 * @returns the `cd`-guarded command text.
 */
export function wrapCwd(cwd: string, command: string): string {
  return `cd -- ${quoteShellArg(cwd)} && ${command}`
}

/** OpenSSH's default identity probe order, used when no auth is configured. */
const DEFAULT_IDENTITY_FILES = ['.ssh/id_ed25519', '.ssh/id_ecdsa', '.ssh/id_rsa']

/**
 * The first existing OpenSSH default identity, mirroring the ssh client's own
 * probe: a hop with no password, key, or agent configured would otherwise be
 * rejected by every server because ssh2 never tries default key files.
 */
export function defaultIdentity(): string | undefined {
  for (const candidate of DEFAULT_IDENTITY_FILES) {
    const expanded = join(homedir(), candidate)
    if (existsSync(expanded)) return readFileSync(expanded, 'utf8')
  }
  return undefined
}

/**
 * Reads an identity value that is either PEM content or a local identity-file
 * path. A missing file must not leak its local path into a user-facing message
 * — the raw ENOENT text is replaced by a sanitized one here because the
 * `ctx.ssh` construction path (resolveHost/resolveJump) has no connect-rewrap
 * layer to clean it. The error object is kept (code/name preserved).
 */
export function resolvePrivateKey(value: string): string | Buffer {
  if (value.includes('-----BEGIN')) return value
  try {
    return readFileSync(value, 'utf8')
  } catch (error) {
    if (error instanceof Error) error.message = 'dsw: cannot read private key: <redacted>'
    throw error
  }
}

/**
 * Build the host-key verifier for strict checking: accept only a key whose
 * SHA256 fingerprint or raw base64 encoding matches a known-hosts entry.
 * @param knownHosts - configured trusted fingerprints or keys.
 * @returns a verifier accepting exactly the matching keys.
 */
export function hostVerifierFor(knownHosts: readonly string[]): (key: Buffer) => boolean {
  return (key: Buffer): boolean => {
    const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`
    const raw = key.toString('base64')
    return knownHosts.some((entry) => {
      // A known_hosts line is "<host> <keytype> <token>"; the token is the field that varies.
      const token = entry.trim().split(/\s+/).at(-1) ?? ''
      return token === fingerprint || token === raw
    })
  }
}

/**
 * Shape the ssh2 connection config for one hop, without the jump socket.
 * Host-key verification and the default-identity probe apply per hop, so a
 * jump chain is verified at every boundary it crosses. A caller-supplied
 * per-hop verifier (TOFU) wins over the static known-hosts list; `strict`
 * falls back to {@link hostVerifierFor} otherwise.
 */
export function toConnectConfig(
  host: ResolvedConnectionHost,
  strict: boolean,
  knownHosts: readonly string[],
  hostVerifier?: (host: ResolvedConnectionHost, key: Buffer) => boolean,
): ConnectConfig {
  const config: ConnectConfig = {
    host: host.host,
    port: host.port,
    username: host.username,
    readyTimeout: host.readyTimeout,
    keepaliveInterval: host.keepaliveInterval,
    keepaliveCountMax: host.keepaliveCountMax,
  }
  if (host.password !== undefined) config.password = host.password
  if (host.privateKey !== undefined) config.privateKey = host.privateKey
  if (host.passphrase !== undefined) config.passphrase = host.passphrase
  if (host.agent !== undefined) config.agent = host.agent
  if (hostVerifier !== undefined) {
    const hop = host
    config.hostVerifier = (key: Buffer) => hostVerifier(hop, key)
  } else if (strict) {
    config.hostVerifier = hostVerifierFor(knownHosts)
  }
  if (config.password === undefined && config.privateKey === undefined && config.agent === undefined) {
    const identity = defaultIdentity()
    if (identity !== undefined) config.privateKey = identity
  }
  return config
}

/** Resolve once the client reaches its ready state. */
export function connectReady(client: Client, config: ConnectConfig): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onReady = (): void => { cleanup(); resolve() }
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const cleanup = (): void => {
      client.removeListener('ready', onReady)
      client.removeListener('error', onError)
    }
    client.once('ready', onReady)
    client.once('error', onError)
    client.connect(config)
  })
}

/** Open a direct-tcpip channel through one already-connected hop. */
export function forwardThrough(client: Client, host: string, port: number): Promise<ClientChannel> {
  return new Promise<ClientChannel>((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
      if (error !== undefined) reject(error)
      else resolve(channel)
    })
  })
}

/**
 * Open the whole jump chain: each hop connects after the previous one, and the
 * last client is the target. On failure the already-opened clients are ended
 * (the original error owns the failure) and it is rethrown.
 * @param hosts - resolved hops in order (target last).
 * @param strict - whether to enforce {@link hostVerifierFor} on every hop.
 * @param knownHosts - trusted host keys applied when strict.
 * @param hostVerifier - optional per-hop verifier (TOFU); wins over strict.
 * @returns the opened clients, target last.
 */
export async function openChain(
  hosts: readonly ResolvedConnectionHost[],
  strict: boolean,
  knownHosts: readonly string[],
  hostVerifier?: (host: ResolvedConnectionHost, key: Buffer) => boolean,
): Promise<Client[]> {
  const clients: Client[] = []
  try {
    for (let index = 0; index < hosts.length; index += 1) {
      const host = hosts[index] as ResolvedConnectionHost
      const previous = clients[index - 1]
      const client = new Client()
      clients.push(client)
      const config = toConnectConfig(host, strict, knownHosts, hostVerifier)
      if (previous === undefined) {
        await connectReady(client, config)
      } else {
        const socket = await forwardThrough(previous, host.host, host.port)
        await connectReady(client, { ...config, sock: socket })
      }
    }
    return clients
  } catch (error) {
    for (const client of clients.reverse()) {
      try {
        client.end()
      } catch (_alreadyEnded) {
        // Best-effort teardown of the partial chain; the original error owns the failure.
      }
    }
    throw error
  }
}

/**
 * Run one control-plane command on an authenticated client with collected
 * output. Used by adapters for executable lookup, canonical-path resolution,
 * and the remote-environment probe, not for user work.
 * @param client - the authenticated target client.
 * @param text - remote command text (already shell-quoted by the caller).
 * @param opts - optional cancellation.
 * @returns the collected exit facts and output.
 */
export function execChannel(client: Client, text: string, opts?: { signal?: AbortSignal }): Promise<ExecOutcome> {
  return new Promise<ExecOutcome>((resolve, reject) => {
    // Buffer whole chunks and decode once: SSH data events may split a
    // multi-byte UTF-8 character across two callbacks, so per-chunk
    // decoding would corrupt it.
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    let channel: ClientChannel | undefined
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    }
    const onAbort = (): void => {
      // Closing the channel ends the remote command; its close event reports the outcome.
      channel?.close()
    }
    const cleanup = (): void => { opts?.signal?.removeEventListener('abort', onAbort) }
    client.exec(text, { pty: false }, (error, stream) => {
      if (error !== undefined) { cleanup(); reject(error); return }
      channel = stream
      stream.on('data', (data: Buffer) => { stdoutChunks.push(data) })
      stream.stderr.on('data', (data: Buffer) => { stderrChunks.push(data) })
      stream.on('close', (code: number | null, signal: string | null) => { finish(code, signal) })
    })
    if (opts?.signal?.aborted === true) { onAbort(); return }
    opts?.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Parse the NUL-delimited name/value stream produced by a remote `env -0`. */
export function parseRemoteEnvironment(stdout: string): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const entry of stdout.split('\0')) {
    if (entry.length === 0) continue
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    environment[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  return environment
}

/**
 * Map a caller-supplied working directory onto a remote host. The harness
 * hands providers the session cwd, which is a local path when the harness
 * runs on the developer machine; a local absolute path (Windows drive, UNC)
 * or a relative path has no meaning on the remote host, so it is redirected
 * to the configured remote cwd. A POSIX absolute path is a remote path and
 * passes through unchanged.
 * @param fallback - the transport's default remote working directory.
 * @param cwd - the caller-supplied working directory, or `undefined` for the default.
 * @returns the remote working directory to execute in.
 */
export function resolveRemoteCwd(fallback: string, cwd: string | undefined): string {
  if (cwd === undefined) return fallback
  if (cwd.startsWith('ssh://')) {
    throw new Error('dsw: ssh:// working directories must be routed through ctx.subprocess or ctx.fs; ctx.ssh cannot choose a registry connection')
  }
  if (posix.isAbsolute(cwd)) return cwd
  if (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('//') || cwd.startsWith('\\\\')) return fallback
  return posix.resolve(fallback, cwd)
}

/** Options shared by every session owner (runtime service or registry connection). */
export interface SshSessionOptions {
  /** Error message when an operation runs after dispose. */
  disposedMessage?: string
  /** Optional rewriter of a failed chain open (the registry rewraps ssh2 transport codes). */
  connectErrorRewriter?: (error: unknown) => unknown
  /** Owner label embedded in the remote-environment failure message. */
  label?: string
  /**
   * Map a caller-supplied working directory onto this session's remote host.
   */
  resolveRemoteCwd?: (cwd: string | undefined) => string
  /**
   * Optional per-hop host-key verifier (TOFU); when set it wins over the
   * static `strict`/`knownHosts` pair on every hop of the chain.
   */
  hostVerifier?: (host: ResolvedConnectionHost, key: Buffer) => boolean
  /**
   * Optional async host enrichment run before the chain opens (e.g. resolving
   * a keychain-backed password). The resolved hops replace the configured ones
   * for this attempt only; nothing is persisted.
   */
  resolveHosts?: (hosts: readonly ResolvedConnectionHost[]) => Promise<readonly ResolvedConnectionHost[]>
  /**
   * Optional message redactor for errors leaving this session (connect
   * rewrap, environment-read failure). Applies to the transited message text
   * only — the error object's shape (name, code, cause) is preserved.
   */
  redactMessage?: (message: string) => string
}

/**
 * One authenticated SSH session state shared by the aggregate runtime and the
 * registry-owned connections: the opened jump chain, the lazily shared SFTP
 * channel, and the cached remote login environment, plus disposal. Order and
 * failure semantics match the connection owner both callers used before the
 * extraction (target channel closed before the jump clients, partial chain
 * ended on failure, SFTP invalidated on close/end).
 */
export class SshSession {
  private clients: Client[] = []
  private ready: Promise<Client> | undefined
  private sftp: SFTPWrapper | undefined
  private sftpOpening: Promise<SFTPWrapper> | undefined
  private remoteEnvironment: Promise<Record<string, string>> | undefined
  private disposed = false
  private connected = false

  constructor(
    private readonly hosts: readonly ResolvedConnectionHost[],
    private readonly strict: boolean,
    private readonly knownHosts: readonly string[],
    private readonly options: SshSessionOptions = {},
  ) {}

  /**
   * Return the shared live connection after the jump chain and auth succeed.
   * @param signal - caller lifetime; absent for the service runtime (unchanged API).
   * @returns the authenticated target client.
   * @throws when connection, jump, or authentication fails, or when disposing.
   */
  async getClient(signal?: AbortSignal): Promise<Client> {
    signal?.throwIfAborted()
    if (this.disposed) throw new Error(this.disposedMessage())
    if (this.ready === undefined) {
      const attempt = this.open()
      this.ready = attempt
      // A FAILED attempt is never cached: an auth stub, a bounced port, or a
      // VM that came back online must be able to retry on the next call (the
      // failed-connection-cache root fix). The rejection still propagates to
      // every caller awaiting this attempt; the next caller starts fresh.
      void attempt.catch(() => {
        if (this.ready === attempt) this.ready = undefined
      })
    }
    let client: Client
    try {
      client = await this.ready
    } catch (error) {
      throw this.rewrapConnect(error)
    }
    signal?.throwIfAborted()
    if (this.disposed) throw new Error(this.disposedMessage())
    return client
  }

  /**
   * Return the shared SFTP channel, opened lazily once per connection. A
   * closed connection invalidates it so the next call reopens.
   * @param signal - caller lifetime; absent for the service runtime.
   * @returns the live SFTP wrapper.
   */
  async getSftp(signal?: AbortSignal): Promise<SFTPWrapper> {
    if (this.disposed) throw new Error(this.disposedMessage())
    if (this.sftp !== undefined) return this.sftp
    this.sftpOpening ??= this.openSftp(signal)
    const sftp = await this.sftpOpening
    if (this.sftp === undefined) this.sftp = sftp
    return sftp
  }

  /**
   * Return the remote login environment, read once per connection and cached.
   * The login environment is stable for the connection lifetime, so adapters
   * avoid one control command per spawned process.
   * @param signal - caller lifetime; absent for the service runtime.
   * @returns the remote environment as name/value entries.
   */
  getRemoteEnvironment(signal?: AbortSignal): Promise<Record<string, string>> {
    if (this.disposed) return Promise.reject(new Error(this.disposedMessage()))
    this.remoteEnvironment ??= this.readRemoteEnvironment(signal)
    return this.remoteEnvironment
  }

  /**
   * Run one control-plane command with collected output. Used by adapters for
   * executable lookup and canonical-path resolution, not for user work.
   * @param command - remote command text (already shell-quoted by the caller).
   * @param opts - optional working-directory override and cancellation.
   * @returns the collected exit facts and output.
   */
  async exec(command: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<ExecOutcome> {
    opts?.signal?.throwIfAborted()
    const client = await this.getClient(opts?.signal)
    const cwdMapper = this.options.resolveRemoteCwd
    const resolvedCwd = opts?.cwd !== undefined
      ? (cwdMapper !== undefined ? cwdMapper(opts.cwd) : opts.cwd)
      : undefined
    const text = resolvedCwd !== undefined ? wrapCwd(resolvedCwd, command) : command
    const outcome = await execChannel(client, text, opts)
    opts?.signal?.throwIfAborted()
    return outcome
  }

  /** Release the chain and the shared SFTP channel (idempotent). */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.connected = false
    if (this.sftp !== undefined) {
      const sftp = this.sftp
      this.sftp = undefined
      this.sftpOpening = undefined
      try {
        sftp.end()
      } catch (_alreadyEnded) {
        // A closed SFTP channel is already quiescent.
      }
    }
    const clients = this.clients
    this.clients = []
    // End the target first so its channel closes before the jump sockets it rode.
    for (const client of clients.reverse()) {
      try {
        client.end()
      } catch (_alreadyEnded) {
        // A client that already ended is already quiescent.
      }
    }
  }

  private disposedMessage(): string {
    return this.options.disposedMessage ?? 'SSH service is disposing'
  }

  /** Whether the chain reached its ready state and has not been disposed. */
  isConnected(): boolean {
    return this.connected && !this.disposed
  }

  private rewrapConnect(error: unknown): unknown {
    const rewrapped = this.options.connectErrorRewriter !== undefined ? this.options.connectErrorRewriter(error) : error
    if (rewrapped instanceof Error && this.options.redactMessage !== undefined) {
      rewrapped.message = this.options.redactMessage(rewrapped.message)
    }
    return rewrapped
  }

  private async openSftp(signal?: AbortSignal): Promise<SFTPWrapper> {
    const client = await this.getClient(signal)
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((error, value) => {
        if (error !== undefined) reject(error)
        else resolve(value)
      })
    })
    const invalidate = (): void => {
      this.sftp = undefined
      this.sftpOpening = undefined
    }
    sftp.on('close', invalidate)
    sftp.on('end', invalidate)
    return sftp
  }

  private async readRemoteEnvironment(signal?: AbortSignal): Promise<Record<string, string>> {
    const { exitCode, stdout } = await this.exec('env -0', signal === undefined ? undefined : { signal })
    if (exitCode !== 0) {
      const suffix = this.options.label === undefined ? '' : ` of "${this.options.label}"`
      throw new Error(this.options.redactMessage === undefined
        ? `dsw: cannot read the remote environment${suffix}`
        : this.options.redactMessage(`dsw: cannot read the remote environment${suffix}`))
    }
    return parseRemoteEnvironment(stdout)
  }

  private async open(): Promise<Client> {
    const hosts = this.options.resolveHosts === undefined
      ? this.hosts
      : await this.options.resolveHosts(this.hosts)
    const clients = await openChain(hosts, this.strict, this.knownHosts, this.options.hostVerifier)
    this.clients = clients
    this.connected = true
    return clients[clients.length - 1] as Client
  }
}
