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
  readonly collected: SubprocessHandle['collected']
  readonly done: Promise<SubprocessOutcome>

  private readonly stdoutCollector: SshOutputCollector | undefined
  private readonly stderrCollector: SshOutputCollector | undefined
  private settled = false
  private job: string | undefined
  private unsub: (() => void) | undefined

  constructor(
    private readonly hub: CoreHub,
    private readonly connectionId: string,
    private readonly cwd: string,
    private readonly spec: SubprocessSpawnSpec,
    private readonly spillDir: string,
    private readonly preflight?: () => Promise<void>,
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

  get pid(): number {
    return -1
  }

  terminate(): void {
    const job = this.job
    if (job === undefined) return
    const client = this.hub.peek(this.connectionId)
    void client?.call(CORE_METHODS.spawnTerminate, { job }).catch(() => {})
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
    try {
      if (this.preflight !== undefined) await this.preflight()
      const client = await this.hub.require(this.connectionId, {
        cwd: this.cwd,
        ...(this.spec.signal !== undefined ? { signal: this.spec.signal } : {}),
      })
      const exit = this.watch(client)
      const started = asRecord(await client.call(CORE_METHODS.spawnStart, {
        argv: [...this.spec.argv],
        cwd: this.cwd,
        env: this.spec.env ?? {},
      }, this.spec.signal))
      const job = typeof started?.job === 'string' ? started.job : ''
      if (job === '') throw new Error('core spawn.start returned no job id')
      this.job = job
      return await exit
    } catch (error) {
      this.settle()
      throw error
    }
  }

  private watch(client: CoreClient): Promise<SubprocessOutcome> {
    return new Promise<SubprocessOutcome>((resolve, reject) => {
      this.unsub = client.onEvent((method, params) => {
        const rec = asRecord(params)
        if (rec === undefined) return
        if (this.job !== undefined && rec.job !== this.job) return
        if (this.job === undefined && (method === CORE_EVENTS.spawnStdout || method === CORE_EVENTS.spawnStderr || method === CORE_EVENTS.spawnExit)) {
          if (typeof rec.job === 'string') this.job = rec.job
        }
        if (rec.job !== this.job) return
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
        const data = this.spec.stdio.stdin.data
        const b64 = Buffer.from(data).toString('base64')
        const send = (): void => {
          const job = this.job
          if (job === undefined) {
            queueMicrotask(send)
            return
          }
          void client.call(CORE_METHODS.spawnStdin, { job, b64 }).catch(() => {})
        }
        send()
      }
      void 0 as unknown as typeof reject
    })
  }
}

/** Type-only export kept so tests can construct a handle against a fake hub. */
export type { CoreHub }
