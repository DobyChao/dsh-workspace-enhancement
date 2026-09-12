/**
 * SSH Service Provider for the subprocess capability seam. Each handle starts
 * through the shared SSH connection and keeps its output spill files on the
 * local host (remote bytes already arrive over the channel).
 *
 * The engine half ({@link SshSubprocessEngine}) is a plain class that the
 * mixed provider (see mixed.ts) embeds as its remote branch; the service half
 * ({@link SshSubprocessRuntime}) is the standalone plugin form that mounts as
 * `ctx.subprocess` in pure-SSH deployments.
 * @module @deepseek-ai/dsh-subprocess-ssh
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { quoteShellArg } from './ssh-core.ts'
import { resolveSshCwd } from './transport.ts'
import type { SshCwdRoute, SshTransport } from './transport.ts'
import { createRemoteSpawnGate } from './remote-approval-gate.ts'
import type { RemoteSpawnGate } from './remote-approval-gate.ts'
import { SshSubprocessHandle } from './process.ts'
import { spawnSshTerminal } from './terminal.ts'
import type { SshTerminalHandle } from './terminal.ts'

/**
 * Enforce the seam's documented grace bound (positive, finite, one Node timer),
 * matching subprocess-local's spawn-time check.
 * @param graceMs - the spec's cleanup grace in milliseconds.
 */
function requireRepresentableGrace(graceMs: number): void {
  if (!Number.isFinite(graceMs) || graceMs <= 0 || graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`subprocess graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * The SSH execution half of the subprocess capability (no service
 * registration): routes every call over the registry connection named by the
 * working directory.
 *
 * AUDIT-6 (ADR-0020): when a `gate` is supplied, every remote spawn passes it
 * BEFORE any SSH activity. `spawn` keeps its synchronous seam contract — the
 * question rides the handle's async startup (`SshSubprocessHandle` preflight)
 * — while `spawnTerminal` (async signature) awaits the gate up front. The gate
 * itself no-ops for machines without `remoteApproval` (default `'off'`), for
 * non-shell-shaped host-assembled argv, and for routes without a registry
 * machine (the aggregate `ctx.ssh` transport, `sw_connect save:false`
 * temporaries) — see ADR-0020 D1's honest non-coverage list.
 */
export class SshSubprocessEngine {
  private readonly live = new Set<SshSubprocessHandle>()
  private readonly terminals = new Set<SshTerminalHandle>()
  private readonly spillDir = mkdtempSync(join(tmpdir(), 'dsh-subprocess-ssh-'))
  private disposing = false

  constructor(
    private readonly ctx: Context,
    private readonly gate?: RemoteSpawnGate,
  ) {
    ctx.effect(() => async () => {
      await this.dispose()
    }, 'ssh subprocess teardown')
  }

  /**
   * Ask the AUDIT-6 approval gate for one route. Pure pass-through: the gate
   * decides coverage (machine mode, shell shape) and throws on denial.
   */
  private async runGate(
    argv: readonly (string | undefined)[],
    route: SshCwdRoute,
    signal: AbortSignal | undefined,
    terminal: boolean,
  ): Promise<void> {
    if (this.gate === undefined) return
    await this.gate({ argv, connectionId: route.connectionId, ...(signal !== undefined ? { signal } : {}), ...(terminal ? { terminal: true } : {}) })
  }

  /**
   * The aggregate SSH transport, resolved lazily through `ctx.get` — property
   * access (`this.ctx.ssh`) needs an inject mapping and throws from a plain
   * plugin fiber, while `ctx.get` reads the service store.
   */
  private ssh(): SshTransport {
    const value = this.ctx.get('ssh') as SshTransport | undefined
    if (value === undefined) throw new Error('subprocess-ssh: the ssh transport is not mounted')
    return value
  }

  /** Terminate every managed process/terminal and await quiescence (idempotent). */
  async dispose(): Promise<void> {
    if (this.disposing) return
    this.disposing = true
    const handles = [...this.live]
    const terminals = [...this.terminals]
    const pending: Promise<unknown>[] = []
    for (const handle of handles) {
      handle.terminate()
      pending.push(handle.waitForExit().then(() => { this.live.delete(handle) }))
    }
    for (const terminal of terminals) {
      pending.push(terminal.terminate().then(() => { this.terminals.delete(terminal) }))
    }
    const outcomes = await Promise.allSettled(pending)
    const failures = outcomes.flatMap<unknown>(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'subprocess-ssh: teardown failed')
  }

  /** @inheritdoc (same as SubprocessRuntime.resolveExecutable, remote world). */
  async resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (command.length === 0) throw new Error('subprocess-ssh: executable name must be non-empty')
    signal?.throwIfAborted()
    if (posix.isAbsolute(command)) {
      const result = await this.ssh().exec(
        `test -f ${quoteShellArg(command)} -a -x ${quoteShellArg(command)}`,
        signal !== undefined ? { signal } : undefined,
      )
      signal?.throwIfAborted()
      if (result.exitCode !== 0) {
        throw new Error(`subprocess-ssh: command ${JSON.stringify(command)} is not an executable file`)
      }
      return command
    }
    if (command.includes('/')) {
      throw new Error(
        `subprocess-ssh: command ${JSON.stringify(command)} is a relative path; use an absolute path or a bare PATH name`,
      )
    }
    const path = env?.PATH
    const prefix = path === undefined ? '' : `PATH=${quoteShellArg(path)} `
    const result = await this.ssh().exec(`${prefix}command -v -- ${quoteShellArg(command)}`, signal !== undefined ? { signal } : undefined)
    signal?.throwIfAborted()
    const executable = result.stdout.trim()
    if (result.exitCode !== 0
      || executable.length === 0
      || executable.includes('\n')
      || (!posix.isAbsolute(executable) && !executable.includes('/'))) {
      throw new Error(`subprocess-ssh: executable ${JSON.stringify(command)} did not resolve to one absolute path`)
    }
    return posix.isAbsolute(executable) ? executable : posix.resolve(this.ssh().cwd, executable)
  }

  /** @inheritdoc (same semantics as SubprocessRuntime.spawn, remote world). */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (this.disposing) throw new Error('subprocess-ssh: service is disposing')
    const program = spec.argv[0]
    if (program === undefined || program.length === 0) {
      throw new Error('invalid argv: expected a non-empty program name at argv[0]')
    }
    requireRepresentableGrace(spec.graceMs)
    if (spec.signal?.aborted === true) {
      throw new Error(`aborted before spawn: ${String(spec.signal.reason)}`)
    }
    const route = resolveSshCwd(this.ctx, spec.cwd)
    const preflight = this.gate === undefined
      ? undefined
      : () => this.runGate(spec.argv, route, spec.signal, false)
    const handle = new SshSubprocessHandle(route.transport, route.cwd, spec, this.spillDir, preflight)
    this.live.add(handle)
    const release = async (): Promise<void> => {
      await handle.waitForExit()
      this.live.delete(handle)
    }
    void handle.done.then(release, release).catch(() => {})
    return handle
  }

  /** @inheritdoc (same semantics as SubprocessRuntime.spawnTerminal, remote world). */
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    if (this.disposing) throw new Error('subprocess-ssh: service is disposing')
    const program = spec.argv[0]
    if (program === undefined || program.length === 0) {
      throw new Error('subprocess-ssh: terminal argv must contain a program')
    }
    requireRepresentableGrace(spec.graceMs)
    spec.signal?.throwIfAborted()
    const route = resolveSshCwd(this.ctx, spec.cwd)
    // AUDIT-6: an interactive terminal is itself an arbitrary-command entry —
    // gated regardless of shell shape whenever the machine is (ADR-0020 D1).
    await this.runGate(spec.argv, route, spec.signal, true)
    const terminal = await spawnSshTerminal(route.transport, route.cwd, spec)
    if (this.disposing) {
      await terminal.terminate()
      throw new Error('subprocess-ssh: service disposed during terminal setup')
    }
    this.terminals.add(terminal)
    const release = async (): Promise<void> => {
      await terminal.terminate()
      this.terminals.delete(terminal)
    }
    void terminal.done.then(release, release).catch(() => {})
    return terminal
  }
}

/**
 * Standalone SSH command manager registered as `ctx.subprocess` — the
 * pure-SSH deployment form (also what the mixed provider's remote branch is
 * built from).
 *
 * AUDIT-6 (ADR-0020): an explicit `gate` wins (the aggregate row passes its
 * own); when a subpath deployment mounts this class bare, the constructor
 * attaches the SAME remote approval gate built from its own context — so every
 * deployment form fences gated machines' remote shell commands uniformly. The
 * AI auto-grant answerer is an aggregate-row feature (`plugin.ts` apply); a
 * bare subpath deployment asks and falls through to the deployment's human
 * answerer (fail closed), it just never auto-grants.
 */
export class SshSubprocessRuntime extends SubprocessRuntime {
  static inject = ['ssh']

  private readonly engine: SshSubprocessEngine

  /** Create the SSH subprocess service and bind its disposal policy. */
  constructor(ctx: Context, gate?: RemoteSpawnGate) {
    super(ctx)
    this.engine = new SshSubprocessEngine(ctx, gate ?? createRemoteSpawnGate(ctx))
  }

  /** @inheritdoc */
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    return this.engine.resolveExecutable(command, env, signal)
  }

  /** @inheritdoc */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    return this.engine.spawn(spec)
  }

  /** @inheritdoc */
  spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return this.engine.spawnTerminal(spec)
  }
}

export default SshSubprocessRuntime
