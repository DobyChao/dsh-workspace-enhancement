/**
 * REQ-I5: subprocess handle that runs inside a core RPC session.
 *
 * Approval preflight still runs first (unwrapped argv). The fence's only job
 * for a fenced machine is `hub.require`; this handle then `spawn.start`s.
 *
 * @module dsh-workspace-enhancement/core-process
 */

import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import type { Readable, Writable } from 'node:stream'
import type {
  SubprocessCollect,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputMode,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { CoreClient } from './core-client.ts'
import { CORE_EVENTS, CORE_METHODS, asRecord } from './core-protocol.ts'
import { SshOutputCollector } from './output.ts'
import type { CoreHub } from './core-hub.ts'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { isCoreMissingError } from './remote-policy.ts'
import type { SshSubprocessHandle } from './process.ts'

function isCollect(mode: SubprocessOutputMode): mode is SubprocessCollect {
  return mode !== 'pipe' && mode !== 'inherit'
}

function pushChunk(
  collector: SshOutputCollector | undefined,
  pipe: Readable | undefined,
  inherit: boolean,
  which: 'stdout' | 'stderr',
  bytes: Buffer,
): void {
  collector?.push(bytes)
  if (pipe !== undefined) (pipe as PassThrough).write(bytes)
  else if (inherit) {
    if (which === 'stdout') process.stdout.write(bytes)
    else process.stderr.write(bytes)
  }
}

export class CoreSubprocessHandle implements SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  private readonly ownCollected: SubprocessHandle['collected']
  private fallbackHandle: SubprocessHandle | undefined
  readonly done: Promise<SubprocessOutcome>

  get collected(): SubprocessHandle['collected'] {
    return this.fallbackHandle?.collected ?? this.ownCollected
  }

  private readonly stdoutCollector: SshOutputCollector | undefined
  private readonly stderrCollector: SshOutputCollector | undefined
  private settled = false
  private job: string | undefined
  private unsub: (() => void) | undefined
  /** BUG-9: a stop requested before the job id exists is remembered, not dropped. */
  private terminatePending = false
  private terminateSentFor: string | undefined
  private terminateFailureValue: unknown
  private watchedClient: CoreClient | undefined
  private pendingStdin: string | undefined

  constructor(
    private readonly hub: CoreHub,
    private readonly connectionId: string,
    private readonly cwd: string,
    private readonly spec: SubprocessSpawnSpec,
    private readonly spillDir: string,
    private readonly preflight?: () => Promise<void>,
    private readonly policy: SandboxMode = 'read-only',
    private readonly sshFallback?: () => SshSubprocessHandle,
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
    this.ownCollected = {
      ...(this.stdoutCollector !== undefined ? { stdout: this.stdoutCollector } : {}),
      ...(this.stderrCollector !== undefined ? { stderr: this.stderrCollector } : {}),
    }
    this.stdin = spec.stdio.stdin === 'pipe' ? new PassThrough() : undefined
    spec.signal?.addEventListener('abort', this.onAbort, { once: true })
    this.done = this.run()
    void this.done.catch(() => {})
    if (spec.signal?.aborted === true) this.terminate()
  }

  get pid(): number {
    return -1
  }

  terminate(): void {
    if (this.fallbackHandle !== undefined) {
      this.fallbackHandle.terminate()
      return
    }
    // BUG-9 startup window: `spawn.start` may not have answered yet (cold
    // core, approval gate, connection setup) — exactly when a cancel lands.
    // Remember it; trySendTerminate fires the moment the job id appears.
    this.terminatePending = true
    this.trySendTerminate()
  }

  /** Last observed spawn.terminate delivery failure (test/telemetry surface, BUG-9). */
  get lastTerminateFailure(): unknown {
    return this.terminateFailureValue
  }

  /**
   * Send `spawn.terminate` as soon as BOTH the request and the job id exist.
   * A missing core client or a failed RPC is recorded (not swallowed) and the
   * send is un-latched, so the next trigger retries instead of dying silently.
   */
  private trySendTerminate(): void {
    if (!this.terminatePending || this.settled) return
    const job = this.job
    if (job === undefined || job === this.terminateSentFor) return
    const client = this.hub.peek(this.connectionId, { cwd: this.cwd, policy: this.policy })
    if (client === undefined) {
      this.terminateFailureValue = new Error('core client unavailable for spawn.terminate')
      return
    }
    this.terminateSentFor = job
    void client.call(CORE_METHODS.spawnTerminate, { job }).then(undefined, (error: unknown) => {
      if (this.terminateSentFor === job) this.terminateSentFor = undefined
      this.terminateFailureValue = error
    })
  }

  waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (this.settled) return Promise.resolve(true)
    if (signal?.aborted === true) return Promise.resolve(false)
    if (signal === undefined) return this.done.then(() => true, () => true)
    return new Promise<boolean>((resolve) => {
      const onAbort = (): void => { cleanup(); resolve(false) }
      const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
      signal.addEventListener('abort', onAbort, { once: true })
      void this.done.then(() => { cleanup(); resolve(true) }, () => { cleanup(); resolve(true) })
    })
  }

  private readonly onAbort = (): void => { this.terminate() }

  private settle(): void {
    if (this.settled) return
    this.settled = true
    this.unsub?.()
    this.stdoutCollector?.seal()
    this.stderrCollector?.seal()
    this.spec.signal?.removeEventListener('abort', this.onAbort)
    if (this.stdout !== undefined) (this.stdout as PassThrough).end()
    if (this.stderr !== undefined) (this.stderr as PassThrough).end()
  }

  private async run(): Promise<SubprocessOutcome> {
    let releaseHold = (): void => {}
    try {
      if (this.preflight !== undefined) await this.preflight()
      const requireOpts = {
        cwd: this.cwd,
        policy: this.policy,
        ...(this.spec.signal !== undefined ? { signal: this.spec.signal } : {}),
      }
      const client = await this.hub.require(this.connectionId, requireOpts)
      releaseHold = this.hub.hold(this.connectionId, requireOpts)
      const exit = this.watch(client).finally(releaseHold)
      const started = asRecord(await client.call(CORE_METHODS.spawnStart, {
        argv: [...this.spec.argv],
        cwd: this.cwd,
        env: this.spec.env ?? {},
      }, this.spec.signal))
      const job = typeof started?.job === 'string' ? started.job : ''
      if (job === '') throw new Error('core spawn.start returned no job id')
      this.job = job
      this.trySendTerminate()
      this.flushPendingStdin()
      return await exit
    } catch (error) {
      releaseHold()
      if (this.sshFallback !== undefined && isCoreMissingError(error)) {
        this.fallbackHandle = this.sshFallback()
        const outcome = await this.fallbackHandle.done
        this.settle()
        return outcome
      }
      this.settle()
      throw error
    }
  }

  private watch(client: CoreClient): Promise<SubprocessOutcome> {
    return new Promise<SubprocessOutcome>((resolve, reject) => {
      this.unsub = client.onEvent((method, params) => {
        // BUG-9: events can teach us the job id before spawn.start answers —
        // a pending terminate must ride the first event that names the job.
        const rec = asRecord(params)
        if (rec === undefined) return
        if (this.job === undefined && (method === CORE_EVENTS.spawnStdout || method === CORE_EVENTS.spawnStderr || method === CORE_EVENTS.spawnExit)) {
          if (typeof rec.job === 'string') this.job = rec.job
        }
        this.trySendTerminate()
        this.flushPendingStdin()
        if (this.job !== undefined && rec.job !== this.job) return
        if (method === CORE_EVENTS.spawnStdout || method === CORE_EVENTS.spawnStderr) {
          const bytes = Buffer.from(String(rec.b64 ?? ''), 'base64')
          const which = method === CORE_EVENTS.spawnStdout ? 'stdout' : 'stderr'
          const mode = which === 'stdout' ? this.spec.stdio.stdout : this.spec.stdio.stderr
          pushChunk(
            which === 'stdout' ? this.stdoutCollector : this.stderrCollector,
            which === 'stdout' ? this.stdout : this.stderr,
            mode === 'inherit',
            which,
            bytes,
          )
          return
        }
        if (method === CORE_EVENTS.spawnExit) {
          this.settle()
          const code = typeof rec.exitCode === 'number' ? rec.exitCode : 0
          resolve({ exitCode: code, signal: null })
        }
      })
      if (this.stdin !== undefined) {
        this.stdin.on('data', (chunk: Buffer | string) => {
          const job = this.job
          if (job === undefined) return
          const b64 = Buffer.from(chunk).toString('base64')
          void client.call(CORE_METHODS.spawnStdin, { job, b64 }).catch(() => {})
        })
      } else if (typeof this.spec.stdio.stdin === 'object' && this.spec.stdio.stdin !== null && 'data' in this.spec.stdio.stdin) {
        // BUG-9: park the payload instead of spinning on queueMicrotask — a
        // slow spawn.start used to starve the whole event loop waiting for the
        // job id. flushPendingStdin sends it the moment the id lands.
        this.pendingStdin = Buffer.from(this.spec.stdio.stdin.data).toString('base64')
        this.watchedClient = client
        this.flushPendingStdin()
      }
      void 0 as unknown as typeof reject
    })
  }

  /** Send the parked stdin payload once the job id exists (see watch()). */
  private flushPendingStdin(): void {
    const b64 = this.pendingStdin
    const job = this.job
    const client = this.watchedClient
    if (b64 === undefined || job === undefined || client === undefined) return
    this.pendingStdin = undefined
    void client.call(CORE_METHODS.spawnStdin, { job, b64 }).catch(() => {})
  }
}

/** Type-only export kept so tests can construct a handle against a fake hub. */
export type { CoreHub }
