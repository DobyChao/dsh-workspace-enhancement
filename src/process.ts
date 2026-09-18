/** One asynchronously-started SSH command projected onto the subprocess seam. */

import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import type { Readable, Writable } from 'node:stream'
import type { ClientChannel } from 'ssh2'
import type {
  SubprocessCollect,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputMode,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { quoteShellArg } from './ssh-core.ts'
import type { SshTransport } from './transport.ts'
import { readRemoteEnvironment, scrubRemoteEnvironment, serializeEnvironment } from './environment.ts'
import { SshOutputCollector } from './output.ts'

function isCollect(mode: SubprocessOutputMode): mode is SubprocessCollect {
  return mode !== 'pipe' && mode !== 'inherit'
}

/** BUG-9: longest plausible `echo $$` line before the peel gives up (bypass). */
const PID_LINE_MAX_BYTES = 32
/** BUG-9: a `echo $$` line is 1–10 decimal digits, no sign, no padding. */
const PID_LINE_RE = /^[1-9][0-9]{0,9}$/
/** BUG-9: after the KILL escalation, how long until the channel is force-closed. */
const KILL_CLOSE_FALLBACK_MS = 2_000

/** Normalize an SSH signal name into the `SIG…` vocabulary the seam carries. */
function normalizeSignal(signal: string | null | undefined): NodeJS.Signals | null {
  if (signal === null || signal === undefined) return null
  return (signal.startsWith('SIG') ? signal : `SIG${signal}`) as NodeJS.Signals
}

/**
 * Build the remote command text: change to the working directory, print the
 * shell's pid, then replace the environment with the scrubbed remote base plus
 * explicit entries and exec the argv. `env -i` prevents credential-shaped
 * remote names from leaking into the child; the scrubbed base restores PATH
 * and HOME.
 *
 * BUG-9: `echo $$` is the FIRST stdout bytes the command ever produces, and the
 * `exec` that follows keeps that pid — so the line both survives into the
 * exec'd argv[0] and gives us the remote pid to kill through an independent
 * channel on servers whose sshd rejects signal requests (OpenSSH < 7.9 without
 * a PTY, Dropbear). The handle peels the line back off stdout
 * ({@link SshSubprocessHandle.takeStdoutChunk}); a non-numeric first line
 * simply bypasses the peel, so the completion path is unchanged.
 *
 * `argv` is passed in rather than read from `spec.argv` because the startup
 * sequence may have replaced it (REQ-I9: the remote sandbox fence wraps the
 * argv AFTER the approval preflight) — this function stays the one and only
 * serializer, so every token still passes through {@link quoteShellArg} here
 * and nowhere else (AGENTS.md §5.6).
 * @param ssh - connection owner backing this execution world.
 * @param cwd - resolved absolute remote working directory.
 * @param spec - fully resolved subprocess request.
 * @param argv - the argv to execute (the spec's own, or the fenced one).
 * @returns the remote command text.
 */
async function buildCommand(
  ssh: SshTransport,
  cwd: string,
  spec: SubprocessSpawnSpec,
  argv: readonly string[],
): Promise<string> {
  const remote = await readRemoteEnvironment(ssh)
  const environment = serializeEnvironment(scrubRemoteEnvironment(remote), spec.env)
  const serialized = argv.map(quoteShellArg).join(' ')
  return `cd -- ${quoteShellArg(cwd)} && echo $$ && exec env -i -- ${environment} ${serialized}`
}

/**
 * SSH-backed subprocess handle. The remote pid is learned from the `echo $$`
 * prefix line once it arrives (BUG-9); until then `pid` is `-1`.
 */
export class SshSubprocessHandle implements SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly collected: SubprocessHandle['collected']
  readonly done: Promise<SubprocessOutcome>

  private readonly terminationController = new AbortController()
  private readonly stdoutCollector: SshOutputCollector | undefined
  private readonly stderrCollector: SshOutputCollector | undefined
  private channel: ClientChannel | undefined
  private graceTimer: NodeJS.Timeout | undefined
  private closeTimer: NodeJS.Timeout | undefined
  private settled = false
  /** BUG-9: pid echo state — `pending` buffers stdout until the first newline. */
  private pidState: 'pending' | 'captured' | 'bypassed' = 'pending'
  private pidBuffer: Buffer = Buffer.alloc(0)
  private remotePid: number | undefined
  private readonly remoteKillSent = new Set<'TERM' | 'KILL'>()

  /**
   * Start the SSH command without blocking the synchronous spawn call.
   * @param runtime - connection owner backing this execution world.
   * @param cwd - resolved absolute remote working directory.
   * @param spec - fully resolved subprocess request.
   * @param spillDir - local spill directory for collect-mode streams.
   * @param preflight - optional AUDIT-6 approval gate, awaited at the HEAD of
   * the async startup (connection and command text are resolved, nothing has
   * reached SSH yet); a rejection fails `done` without touching the network.
   * @param resolveArgv - optional second startup stage (REQ-I9 / ADR-0022 §2.2):
   * awaited AFTER `preflight` and BEFORE the command serialization, it returns
   * the argv to actually execute. Defaults to identity, so an unmodified
   * deployment behaves exactly as before. The fence lives here — and nowhere
   * upstream of the gate — because the approval gate must keep inspecting the
   * UNWRAPPED argv (a `bwrap` `argv[0]` would stop `isRemoteShellShape()`
   * matching and silently disarm AUDIT-6 for every remote command).
   */
  constructor(
    private readonly runtime: SshTransport,
    private readonly cwd: string,
    private readonly spec: SubprocessSpawnSpec,
    private readonly spillDir: string,
    private readonly preflight?: () => Promise<void>,
    private readonly resolveArgv?: (argv: readonly string[]) => Promise<readonly string[]>,
  ) {
    const outMode = spec.stdio.stdout
    const errMode = spec.stdio.stderr
    this.stdout = outMode === 'pipe' ? new PassThrough() : undefined
    this.stderr = errMode === 'pipe' ? new PassThrough() : undefined
    this.stdoutCollector = isCollect(outMode)
      ? new SshOutputCollector(outMode.maxBytes, outMode.spill?.maxBytes, 'stdout', spillDir)
      : undefined
    this.stderrCollector = isCollect(errMode)
      ? new SshOutputCollector(errMode.maxBytes, errMode.spill?.maxBytes, 'stderr', spillDir)
      : undefined
    this.collected = {
      ...(this.stdoutCollector !== undefined ? { stdout: this.stdoutCollector } : {}),
      ...(this.stderrCollector !== undefined ? { stderr: this.stderrCollector } : {}),
    }
    this.stdin = spec.stdio.stdin === 'pipe' ? new PassThrough() : undefined

    spec.signal?.addEventListener('abort', this.onAbort, { once: true })
    this.done = this.run()
    void this.done.catch(() => {})
    if (spec.signal?.aborted === true) this.terminate()
  }

  /** Remote process id once the `echo $$` line arrived; `-1` before that. */
  get pid(): number {
    return this.remotePid ?? -1
  }

  /** @inheritdoc */
  terminate(): void {
    if (this.settled || this.terminationController.signal.aborted) return
    this.terminationController.abort(new Error('subprocess-ssh: command terminated'))
    const channel = this.channel
    if (channel !== undefined) this.beginTermination(channel)
    // No channel yet: run() either skips the remote start entirely (abort
    // before the exec) or calls beginTermination the moment the channel lands.
  }

  /** @inheritdoc */
  waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (this.settled) return Promise.resolve(true)
    if (signal?.aborted === true) return Promise.resolve(false)
    if (signal === undefined) {
      return this.done.then(() => true, () => true)
    }
    return new Promise<boolean>((resolve) => {
      const onAbort = (): void => { cleanup(); resolve(false) }
      const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
      signal.addEventListener('abort', onAbort, { once: true })
      void this.done.then(() => { cleanup(); resolve(true) }, () => { cleanup(); resolve(true) })
    })
  }

  private readonly onAbort = (): void => { this.terminate() }

  private fireSignal(channel: ClientChannel, name: 'TERM' | 'KILL'): void {
    try {
      channel.signal(name)
    } catch (_alreadyClosed) {
      // The channel closed before the signal could be delivered; close is authoritative.
    }
  }

  /**
   * BUG-9 termination chain: the `channel.signal` request stays the first hop,
   * but it is a silent single point on OpenSSH < 7.9 / Dropbear (no PTY ⇒ the
   * server rejects signal requests and ssh2 swallows the failure). So the same
   * escalation ALSO fires a `kill` through an independent exec channel — group
   * first, bare pid as fallback — and if even that leaves the channel open
   * past the grace, the channel is closed locally so `done` cannot hang the
   * tool call forever.
   */
  private beginTermination(channel: ClientChannel): void {
    this.fireSignal(channel, 'TERM')
    this.dispatchRemoteKill('TERM')
    this.graceTimer = setTimeout(() => {
      this.fireSignal(channel, 'KILL')
      this.dispatchRemoteKill('KILL')
      this.closeTimer = setTimeout(() => {
        if (this.settled) return
        try {
          channel.close()
        } catch (_alreadyClosedAfterKill) {
          // Racing a natural close is fine — settle() owns the outcome then.
        }
      }, KILL_CLOSE_FALLBACK_MS)
    }, this.spec.graceMs)
  }

  /** Remember the stop request for the pid line that has not arrived yet. */
  private onRemotePid(pid: number): void {
    this.remotePid = pid
    if (this.terminationController.signal.aborted) this.dispatchRemoteKill('TERM')
  }

  /**
   * Fire `kill -<sig> -- -PID` (process group) with a bare-pid fallback on the
   * same connection but a fresh channel, so a server that rejects signal
   * requests still loses the process. `pid` is a validated decimal from the
   * `echo $$` peel — never caller text — so no shell metacharacters can ride
   * along (AGENTS.md §5.6).
   */
  private dispatchRemoteKill(name: 'TERM' | 'KILL'): void {
    const pid = this.remotePid
    if (pid === undefined || this.settled || this.remoteKillSent.has(name)) return
    this.remoteKillSent.add(name)
    const command = `kill -${name} -- -${pid} 2>/dev/null; kill -${name} ${pid} 2>/dev/null; true`
    void this.runtime.getClient().then(async (client) => {
      await new Promise<void>((resolve) => {
        let finished = false
        const done = (): void => { if (!finished) { finished = true; resolve() } }
        try {
          client.exec(command, { pty: false }, (error, stream) => {
            if (error !== undefined) { done(); return }
            stream.on('data', () => {}) // drain: a stalled kill channel must not leak backpressure
            stream.stderr.on('data', () => {})
            stream.on('close', done)
            stream.on('error', done)
          })
        } catch (_clientDied) {
          done()
        }
      })
    }).catch(() => {
      // The signal hop and the close fallback remain; nothing else to do here.
    })
  }

  private settle(): void {
    if (this.settled) return
    this.settled = true
    if (this.graceTimer !== undefined) clearTimeout(this.graceTimer)
    if (this.closeTimer !== undefined) clearTimeout(this.closeTimer)
    this.graceTimer = undefined
    this.closeTimer = undefined
    this.stdoutCollector?.seal()
    this.stderrCollector?.seal()
    this.spec.signal?.removeEventListener('abort', this.onAbort)
  }

  private async run(): Promise<SubprocessOutcome> {
    let channel: ClientChannel
    try {
      // AUDIT-6 (ADR-0020 D1): the approval question precedes every remote
      // byte — even the connection/environment read waits for the decision.
      if (this.preflight !== undefined) await this.preflight()
      // REQ-I9 (ADR-0022 §2.2): the fence is the SECOND stage — after the gate
      // decided on the user's original argv, before anything is serialized or
      // sent. It may perform network I/O (the runner probe) and fails closed.
      const argv = this.resolveArgv === undefined
        ? this.spec.argv
        : await this.resolveArgv(this.spec.argv)
      const command = await buildCommand(this.runtime, this.cwd, this.spec, argv)
      // BUG-9 startup window: an abort that lands before anything reached SSH
      // must not still START the remote command only to chase it afterwards.
      if (this.terminationController.signal.aborted) {
        throw this.terminationController.signal.reason instanceof Error
          ? this.terminationController.signal.reason
          : new Error('subprocess-ssh: command terminated before start')
      }
      const client = await this.runtime.getClient()
      channel = await new Promise<ClientChannel>((resolve, reject) => {
        client.exec(command, { pty: false }, (error, stream) => {
          if (error !== undefined) reject(error)
          else resolve(stream)
        })
      })
    } catch (error) {
      this.settle()
      throw error
    }
    this.channel = channel
    if (this.terminationController.signal.aborted) this.beginTermination(channel)

    this.wireStdout(channel)
    this.wireStderr(channel)
    if (this.stdin !== undefined) {
      this.stdin.pipe(channel)
    } else if (typeof this.spec.stdio.stdin === 'object') {
      channel.end(this.spec.stdio.stdin.data)
    }

    return await new Promise<SubprocessOutcome>((resolve, reject) => {
      channel.on('close', (code: number | null, signal: string | null) => {
        this.flushPendingPidLine()
        this.settle()
        resolve({ exitCode: code, signal: normalizeSignal(signal) })
      })
      channel.on('error', (error: Error) => {
        this.flushPendingPidLine()
        this.settle()
        reject(error)
      })
    })
  }

  /**
   * Peel the `echo $$` prefix line off stdout (BUG-9). Buffers while the first
   * line is incomplete; a numeric line captures the remote pid and only the
   * remainder reaches the stream, any other first line bypasses the peel and
   * streams verbatim — so a server that somehow drops our echo loses nothing
   * but the independent-kill hop.
   */
  private takeStdoutChunk(chunk: Buffer): Buffer[] {
    if (this.pidState !== 'pending') return [chunk]
    this.pidBuffer = this.pidBuffer.length === 0 ? chunk : Buffer.concat([this.pidBuffer, chunk])
    const newline = this.pidBuffer.indexOf(0x0a)
    if (newline < 0) {
      if (this.pidBuffer.length > PID_LINE_MAX_BYTES) {
        this.pidState = 'bypassed'
        const pending = this.pidBuffer
        this.pidBuffer = Buffer.alloc(0)
        return [pending]
      }
      return []
    }
    const line = this.pidBuffer.subarray(0, newline).toString('latin1')
    const rest = this.pidBuffer.subarray(newline + 1)
    const whole = this.pidBuffer
    this.pidBuffer = Buffer.alloc(0)
    if (PID_LINE_RE.test(line) === true) {
      this.pidState = 'captured'
      this.onRemotePid(Number(line))
      return rest.length > 0 ? [rest] : []
    }
    this.pidState = 'bypassed'
    return [whole]
  }

  /** A channel that closed mid-first-line must not swallow buffered bytes. */
  private flushPendingPidLine(): void {
    if (this.pidState !== 'pending') return
    this.pidState = 'bypassed'
    const pending = this.pidBuffer
    this.pidBuffer = Buffer.alloc(0)
    if (pending.length > 0) this.routeStdout(pending)
  }

  private routeStdout(chunk: Buffer): void {
    const mode = this.spec.stdio.stdout
    if (mode === 'pipe') (this.stdout as PassThrough | undefined)?.write(chunk)
    else if (mode === 'inherit') process.stdout.write(chunk)
    else this.stdoutCollector?.push(chunk)
  }

  private wireStdout(channel: ClientChannel): void {
    // Routed by hand (not channel.pipe) so every byte passes the pid peel
    // first; a remote exec channel is window-flow-controlled by ssh2 anyway.
    channel.on('data', (data: Buffer) => {
      for (const chunk of this.takeStdoutChunk(data)) this.routeStdout(chunk)
    })
  }

  private wireStderr(channel: ClientChannel): void {
    const mode = this.spec.stdio.stderr
    if (mode === 'pipe') channel.stderr.pipe(this.stderr as PassThrough)
    else if (mode === 'inherit') channel.stderr.pipe(process.stderr)
    else channel.stderr.on('data', (data: Buffer) => { this.stderrCollector?.push(data) })
  }
}
