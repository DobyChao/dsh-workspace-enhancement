/**
 * REQ-I5 / ADR-0024: framed-RPC client over a duplex (SSH exec channel or a
 * local pipe). Multiplexes requests by numeric id and fans spawn events to
 * per-job listeners.
 *
 * @module dsh-workspace-enhancement/core-client
 */

import type { Readable, Writable } from 'node:stream'
import {
  CORE_ERROR_IO,
  CORE_ERROR_SANDBOX,
  CORE_EVENTS,
  CORE_METHODS,
  CORE_PROTO,
  decodeFrames,
  encodeFrame,
  type CoreErrorBody,
  type CoreHelloOk,
  type CoreMessage,
} from './core-protocol.ts'

export class CoreRpcError extends Error {
  readonly code: string
  constructor(body: CoreErrorBody) {
    super(body.message)
    this.name = 'CoreRpcError'
    this.code = body.code
  }
}

export interface CoreEventSink {
  (method: string, params: unknown): void
}

interface Pending {
  resolve: (ok: unknown) => void
  reject: (error: unknown) => void
}

/**
 * One live RPC session. The caller owns the streams (SSH exec channel or a
 * fake duplex); this class only frames and demuxes.
 */
export interface CoreClientOptions {
  /** Latest stderr text from the exec channel (jail diagnostics). */
  stderrOf?: () => string
}

export class CoreClient {
  private nextId = 1
  private rest: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private readonly pending = new Map<number, Pending>()
  private readonly events: CoreEventSink[] = []
  private readonly activitySinks: Array<() => void> = []
  private readonly closeSinks: Array<() => void> = []
  private closed = false
  private closeNotified = false
  private helloCache: CoreHelloOk | undefined

  constructor(
    private readonly stdin: Writable,
    private readonly stdout: Readable,
    private readonly options: CoreClientOptions = {},
  ) {
    stdout.on('data', (chunk: Buffer | string) => {
      this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    stdout.on('end', () => {
      this.failAll(new CoreRpcError({ code: CORE_ERROR_IO, message: this.stdoutClosedMessage() }))
    })
    stdout.on('error', (error: Error) => { this.failAll(error) })
    stdin.on('error', (error: Error) => { this.failAll(error) })
  }

  private stdoutClosedMessage(): string {
    const detail = this.options.stderrOf?.().trim().replace(/\s+/gu, ' ')
    if (detail === undefined || detail === '') return 'core stdout closed'
    return `core stdout closed: ${detail.slice(0, 240)}`
  }

  /** Subscribe to id=0 events (spawn stdout/stderr/exit). */
  onEvent(sink: CoreEventSink): () => void {
    this.events.push(sink)
    return () => {
      const index = this.events.indexOf(sink)
      if (index >= 0) this.events.splice(index, 1)
    }
  }

  /** Fired on every outbound RPC (idle accounting). */
  onActivity(sink: () => void): () => void {
    this.activitySinks.push(sink)
    return () => {
      const index = this.activitySinks.indexOf(sink)
      if (index >= 0) this.activitySinks.splice(index, 1)
    }
  }

  /** Fired once when the duplex dies or {@link close} runs. */
  onClose(sink: () => void): () => void {
    this.closeSinks.push(sink)
    return () => {
      const index = this.closeSinks.indexOf(sink)
      if (index >= 0) this.closeSinks.splice(index, 1)
    }
  }

  /**
   * Cached hello, or a fresh round-trip. Settings/status pass `{ cached: false }`
   * so a stale cache cannot look like a live process (ADR-0024 §6.1).
   */
  async hello(signal?: AbortSignal, opts?: { cached?: boolean }): Promise<CoreHelloOk> {
    if (opts?.cached !== false && this.helloCache !== undefined) return this.helloCache
    const ok = await this.call(CORE_METHODS.hello, {}, signal)
    const rec = ok as CoreHelloOk
    this.helloCache = rec
    return rec
  }

  /**
   * Send one request and wait for the matching response.
   * Events (id 0) never settle this promise.
   */
  call(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new CoreRpcError({ code: CORE_ERROR_SANDBOX, message: 'core session is closed' }))
    }
    for (const sink of this.activitySinks) sink()
    signal?.throwIfAborted()
    const id = this.nextId
    this.nextId += 1
    return new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => {
        this.pending.delete(id)
        reject(signal?.reason ?? new Error('aborted'))
      }
      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.pending.set(id, {
        resolve: (ok) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(ok)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
      })
      try {
        const frame = encodeFrame({ id, m: method, p: params, proto: CORE_PROTO })
        const ok = this.stdin.write(frame)
        if (!ok) {
          // Backpressure: still queued; 'drain' is not required for correctness.
        }
      } catch (error) {
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      }
    })
  }

  /** End the stdin side; pending calls fail. */
  close(): void {
    if (this.closed) return
    try {
      this.stdin.end()
    } catch {
      // Already ended.
    }
    this.failAll(new CoreRpcError({ code: CORE_ERROR_SANDBOX, message: 'core session closed' }))
  }

  private onData(chunk: Buffer): void {
    try {
      const decoded = decodeFrames(Buffer.concat([this.rest, chunk]))
      this.rest = decoded.rest
      for (const message of decoded.messages) this.dispatch(message)
    } catch (error) {
      this.failAll(error)
    }
  }

  private dispatch(message: CoreMessage): void {
    if (message.id === 0) {
      const method = message.m ?? CORE_EVENTS.spawnStdout
      for (const sink of this.events) sink(method, message.p)
      return
    }
    const waiter = this.pending.get(message.id)
    if (waiter === undefined) return
    this.pending.delete(message.id)
    if (message.err !== undefined) waiter.reject(new CoreRpcError(message.err))
    else waiter.resolve(message.ok)
  }

  private failAll(error: unknown): void {
    if (this.closed && this.pending.size === 0) {
      this.notifyClosed()
      return
    }
    this.closed = true
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const waiter of pending) waiter.reject(error)
    this.notifyClosed()
  }

  private notifyClosed(): void {
    if (this.closeNotified) return
    this.closeNotified = true
    const sinks = this.closeSinks.splice(0)
    for (const sink of sinks) {
      try {
        sink()
      } catch {
        // Listener failures must not block teardown.
      }
    }
  }
}

export { CORE_EVENTS }
