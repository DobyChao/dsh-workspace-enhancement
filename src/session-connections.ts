/**
 * REQ-I11: per-session CONNECTED-MACHINE state — which registry machines a
 * session has switched on with `sw_connect` (or with a toggle in the session
 * workspace panel). The machine universe is the user's registry: this store
 * keeps only machine ID REFERENCES (never credentials, never connection
 * objects), so removing a machine from the registry cannot leak through here.
 *
 * Model (REQ-I11): the connected set is the session's coarse gate.
 *
 * - `sw_connect(machines: [...])` and the panel toggle write THIS store, so the
 *   model's control plane and the UI cannot disagree;
 * - a session with an empty set sees no `sw_exec` and no remote prompt note;
 * - a session whose header cwd routes to a machine treats that machine as
 *   connected implicitly (the caller unions it in — the store stays literal).
 *
 * It is a GATE, not a fence: the filesystem face routes any `ssh://<id>/…` path
 * at registry level (ADR-0021), so this store controls visibility and tool
 * exposure, not reachability.
 *
 * Storage mirrors {@link SessionSideWorkspaceStore}: one JSON file
 * (`<dsh home>/dsw-session-connections.json`) holding
 * `sessions: { <sessionId>: <machineId[]> }` in connection order. Unknown or
 * legacy fields are ignored on read; a corrupt file warns and reads empty
 * rather than failing the host.
 *
 * Validation errors are plain `dsw:` English here: both callers (the tool layer
 * and the `/dsw` channel) re-check the same conditions and own the localized
 * wording at their own boundary.
 * @module dsh-workspace-enhancement/session-connections
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { dshHome } from './hostkey.ts'
import { isRegistryConnectionId } from './registry.ts'

/** The persisted file shape (`sessions` only; anything else is ignored). */
export interface SessionConnectionsFile {
  sessions: Record<string, string[]>
}

/** Default state file path: `<dsh home>/dsw-session-connections.json`. */
export function defaultSessionConnectionsFile(dshBase?: string): string {
  return join(dshBase ?? dshHome(), 'dsw-session-connections.json')
}

/** Normalize one stored/incoming machine id, or null when it cannot be one. */
export function normalizeMachineId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id !== '' && isRegistryConnectionId(id) ? id : null
}

/** Normalize a session id (padded spellings collapse onto one account). */
export function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id === '' ? null : id
}

/** Dedupe a machine-id list, preserving first-seen order and dropping junk. */
export function normalizeMachineIds(values: readonly unknown[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const id = normalizeMachineId(value)
    if (id === null || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/** Load the persisted file (missing → empty; corrupt → warn + empty). */
export function loadSessionConnections(
  file: string,
  warn: (message: string) => void,
): Map<string, string[]> {
  const sessions = new Map<string, string[]>()
  if (!existsSync(file)) return sessions
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SessionConnectionsFile>
    if (typeof parsed.sessions !== 'object' || parsed.sessions === null) return sessions
    for (const [rawSession, rawList] of Object.entries(parsed.sessions)) {
      const sessionId = normalizeSessionId(rawSession)
      if (sessionId === null || !Array.isArray(rawList)) continue
      const ids = normalizeMachineIds(rawList)
      // An emptied account is dropped (never persisted back as `"<id>": []`).
      if (ids.length > 0) sessions.set(sessionId, ids)
    }
  } catch (error) {
    warn(`dsw: cannot read session-connection state ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return sessions
}

/**
 * Session → connected-machine store (cordis service `sessionConnections`).
 * Every mutator persists; a failed write warns and keeps the in-memory state
 * authoritative (the same honesty rule as the side-workspace store).
 */
export class SessionMachineConnections extends Service {
  private readonly file: string
  private readonly sessions = new Map<string, string[]>()

  constructor(ctx: Context, opts?: { file?: string }) {
    super(ctx, 'sessionConnections')
    this.file = opts?.file ?? defaultSessionConnectionsFile()
    for (const [sessionId, ids] of loadSessionConnections(this.file, message => this.ctx.logger.warn(message))) {
      this.sessions.set(sessionId, ids)
    }
  }

  /** The physical state file (tests/displays). */
  get statePath(): string {
    return this.file
  }

  /** The machine ids connected to one session, in connection order. */
  listFor(sessionId: string): string[] {
    const sid = normalizeSessionId(sessionId)
    if (sid === null) return []
    return [...(this.sessions.get(sid) ?? [])]
  }

  /** Whether one machine is connected to one session. */
  has(sessionId: string, machineId: string): boolean {
    const id = normalizeMachineId(machineId)
    return id !== null && this.listFor(sessionId).includes(id)
  }

  /** Every session id that currently has at least one connection. */
  sessionIds(): string[] {
    return [...this.sessions.keys()]
  }

  /**
   * Replace a session's whole connected set — the `sw_connect(machines: […])`
   * form. Empty input clears the session. Unknown machine ids are NOT rejected
   * here (the caller owns registry validation); use {@link retain} to prune
   * references to machines that were deleted.
   * @returns the stored set.
   */
  set(sessionId: string, machineIds: readonly unknown[]): string[] {
    const sid = this.requireSession(sessionId)
    const ids = normalizeMachineIds(machineIds)
    if (ids.length === 0) this.sessions.delete(sid)
    else this.sessions.set(sid, ids)
    void this.persist()
    return [...ids]
  }

  /** Add one machine to the session (idempotent; keeps the existing order). */
  connect(sessionId: string, machineId: string): string[] {
    const sid = this.requireSession(sessionId)
    const id = normalizeMachineId(machineId)
    if (id === null) throw new Error('dsw: a session connection needs a valid machine id')
    const list = this.sessions.get(sid) ?? []
    if (!list.includes(id)) {
      list.push(id)
      this.sessions.set(sid, list)
      void this.persist()
    }
    return [...list]
  }

  /** Remove one machine from the session (absent id is a no-op `false`). */
  disconnect(sessionId: string, machineId: string): boolean {
    const sid = normalizeSessionId(sessionId)
    const id = normalizeMachineId(machineId)
    if (sid === null || id === null) return false
    const list = this.sessions.get(sid)
    if (list === undefined || !list.includes(id)) return false
    const remaining = list.filter(entry => entry !== id)
    if (remaining.length === 0) this.sessions.delete(sid)
    else this.sessions.set(sid, remaining)
    void this.persist()
    return true
  }

  /** Drop one session's whole connection account. */
  clear(sessionId: string): boolean {
    const sid = normalizeSessionId(sessionId)
    if (sid === null || !this.sessions.delete(sid)) return false
    void this.persist()
    return true
  }

  /**
   * Drop references to machine ids the registry no longer knows (a deleted
   * machine must not stay "connected"). Returns the number of removed
   * references. The channel calls this after `machines.remove`, which is the one
   * place that knows an id is gone (there is no startup sweep: the store is
   * registry-agnostic by construction, so a stale reference is pruned the first
   * time a machine is removed rather than on load).
   */
  retain(known: ReadonlySet<string>): number {
    let removed = 0
    for (const [sessionId, list] of [...this.sessions]) {
      const kept = list.filter(id => known.has(id))
      removed += list.length - kept.length
      if (kept.length === 0) this.sessions.delete(sessionId)
      else if (kept.length !== list.length) this.sessions.set(sessionId, kept)
    }
    if (removed > 0) void this.persist()
    return removed
  }

  /** Persist (mkdir -p first; a failed write warns and never crashes the caller). */
  persist(): void {
    const sessions: Record<string, string[]> = {}
    for (const [sessionId, ids] of this.sessions) sessions[sessionId] = ids
    try {
      mkdirSync(dirname(this.file), { recursive: true })
    } catch {
      // A read-only home must not crash the session; the write below surfaces it.
    }
    try {
      writeFileSync(this.file, `${JSON.stringify({ sessions }, null, 2)}\n`, 'utf8')
    } catch (error) {
      this.ctx.logger.warn(`dsw: cannot persist session-connection state ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private requireSession(sessionId: string): string {
    const sid = normalizeSessionId(sessionId)
    if (sid === null) throw new Error('dsw: a session connection needs a non-empty session id')
    return sid
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionConnections: SessionMachineConnections
  }
}

/** Convenience: the default file path without touching the service. */
export const sessionConnectionsFilePath = (dshBase?: string): string => defaultSessionConnectionsFile(dshBase)
