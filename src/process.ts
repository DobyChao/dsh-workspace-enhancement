/** One asynchronously-started SSH command projected onto the subprocess seam. */

import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { Duplex, Readable, Writable } from 'node:stream'
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

/** BUG-9: after the KILL escalation, how long until the channel is force-closed. */
const KILL_CLOSE_FALLBACK_MS = 2_000

/**
 * POSIX steward that owns the remote process group. SSH stdin is the stop
 * wire only: a background `cat` waits for EOF, then `kill -TERM 0` hits every
 * member of this SSH session's process group (sshd already `setsid`'d it).
 * The user command reads fd 3, so a closed payload / `ignore` stdin cannot
 * be mistaken for a stop. OS pids never leave the remote machine.
 *
 * `pipe` stdin cannot share that wire (the payload IS fd 0), so that shape
 * falls back to `exec` + channel signal/close.
 */
const REMOTE_STOP_STEWARD = '"$@"'
  + ' <&3 &'
  + ' job=$!;'
  + ' exec 3<&-;'
  + ' (cat >/dev/null; kill -TERM 0) &'
  + ' watch=$!;'
  + ' wait $job;'
  + ' status=$?;'
  + ' kill $watch >/dev/null 2>&1;'
  + ' wait $watch >/dev/null 2>&1;'
  + ' exit $status'

/** Normalize an SSH signal name into the `SIG…` vocabulary the seam carries. */
function normalizeSignal(signal: string | null | undefined): NodeJS.Signals | null {
  if (signal === null || signal === undefined) return null
  return (signal.startsWith('SIG') ? signal : `SIG${signal}`) as NodeJS.Signals
}

/**
 * Pick a here-doc delimiter that does not occur in `data`, so the payload
 * cannot close the document early. The token is hex; expanding the prefix
 * is only for the astronomical collision case.
 */
function stdinDelimiter(data: string): string {
  const digest = createHash('sha256').update(data).digest('hex')
  for (let n = 16; n <= 64; n += 8) {
    const token = `DSW_STDIN_${digest.slice(0, n)}`
    if (!data.includes(token)) return token
  }
  return `DSW_STDIN_${digest}`
}

function hereDocFd3(data: string): string {
  const delim = stdinDelimiter(data)
  const body = data.length === 0 ? '' : (data.endsWith('\n') ? data : `${data}\n`)
  return `3<<'${delim}'\n${body}${delim}`
}

/**
 * Build the remote command text: change to the working directory, then run
 * argv under a scrubbed `env -i`. `env -i` prevents credential-shaped remote
 * names from leaking into the child; the scrubbed base restores PATH and HOME.
 *
 * BUG-9: except for live `stdin: 'pipe'`, the argv is launched by a steward
 * that kills its process group when the SSH stdin pipe EOFs. The host never
 * learns a remote pid — `handle.pid` stays `-1` (architecture.md §5).
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
  const prefix = `cd -- ${quoteShellArg(cwd)} && env -i -- ${environment}`
  if (spec.stdio.stdin === 'pipe') {
    return `${prefix} exec ${serialized}`
  }
  const steward = `${prefix} sh -c ${quoteShellArg(REMOTE_STOP_STEWARD)} _ ${serialized}`
  if (spec.stdio.stdin === 'ignore') return `${steward} 3</dev/null`
  return `${steward} ${hereDocFd3(spec.stdio.stdin.data)}`
}

/**
 * SSH-backed subprocess handle. Remote pids stay on the remote: this handle
 * reports {@link SshSubprocessHandle.pid} as `-1` for the life of the call.
 */
export class SshSubprocessHandle implements SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  /** ssh2 has no inherited fd-7 control channel. */
  readonly control: Duplex | undefined = undefined
  readonly collected: SubprocessHandle['collected']
  readonly done: Promise<SubprocessOutcome>
  /** Remote OS pids are not a local-process identity; the seam's sentinel. */
  readonly pid = -1

  private readonly terminationController = new AbortController()
  private readonly stdoutCollector: SshOutputCollector | undefined
  private readonly stderrCollector: SshOutputCollector | undefined
  private channel: ClientChannel | undefined
  private graceTimer: NodeJS.Timeout | undefined
  private closeTimer: NodeJS.Timeout | undefined
  private settled = false

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
   * BUG-9 termination chain: EOF on the steward's stop wire (stdin), then the
   * SSH signal request (OpenSSH ≥ 7.9), then a local close so `done` cannot
   * hang the tool call on a server that ignores both.
   */
  private beginTermination(channel: ClientChannel): void {
    try {
      channel.end()
    } catch (_alreadyClosed) {
      // The steward may already have exited; close still runs below.
    }
    this.fireSignal(channel, 'TERM')
    this.graceTimer = setTimeout(() => {
      this.fireSignal(channel, 'KILL')
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
    }
    // `{ data }` is inlined as fd 3 on the steward; `ignore` is `3</dev/null`.
    // SSH stdin stays open as the stop wire until terminate() or natural exit.

    return await new Promise<SubprocessOutcome>((resolve, reject) => {
      channel.on('close', (code: number | null, signal: string | null) => {
        this.settle()
        resolve({ exitCode: code, signal: normalizeSignal(signal) })
      })
      channel.on('error', (error: Error) => {
        this.settle()
        reject(error)
      })
    })
  }

  private wireStdout(channel: ClientChannel): void {
    const mode = this.spec.stdio.stdout
    if (mode === 'pipe') channel.pipe(this.stdout as PassThrough)
    else if (mode === 'inherit') channel.pipe(process.stdout)
    else channel.on('data', (data: Buffer) => { this.stdoutCollector?.push(data) })
  }

  private wireStderr(channel: ClientChannel): void {
    const mode = this.spec.stdio.stderr
    if (mode === 'pipe') channel.stderr.pipe(this.stderr as PassThrough)
    else if (mode === 'inherit') channel.stderr.pipe(process.stderr)
    else channel.stderr.on('data', (data: Buffer) => { this.stderrCollector?.push(data) })
  }
}
