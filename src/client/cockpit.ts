/**
 * Session workspace cockpit — pure derivation logic (REQ-I11 / ADR-0021 §2.9).
 *
 * WHY ITS OWN MODULE (docs/testing.md): the sandbox runner (`npm run test:agent`)
 * never executes `.tsx`, so every judgment the cockpit makes lives here — which
 * sections exist, where the session actually works, which toggle is on, and how
 * a stale machine id is handled. `./side-workspaces.tsx` only renders what these
 * functions return.
 *
 * TRUTH SOURCES, in order:
 *
 *  - the session cwd (read by the panel through the `remoteFacts` seat over the
 *    sessions store — the same fact `./remote-status.ts` reads) says WHERE the
 *    session works: any accepted route spelling (`ssh://<id>/<path>`, the
 *    `dsw-routes/<id>/…` placeholder tree the host's `session.route` hands back,
 *    the legacy `dsh-ssh-routes/` tree) is the remote main workspace; anything
 *    else is a plain local session (ADR-0021 §2.9 item 1);
 *  - `machines.list` is the machine universe: a connection row exists for every
 *    registry machine and for nothing else;
 *  - `session.conn.list` is the ONLY source of the connected set. This module
 *    keeps no second copy: the panel re-reads it after every mutation and derives
 *    the toggle state from whatever that read returned, so a failed toggle can
 *    never leave the UI optimistically wrong (ADR-0021 §0/§2.9: the panel toggle
 *    and `sw_connect` write one store, and the UI may not disagree with it).
 *
 * THE IMPLICIT MAIN MACHINE (ADR-0021 §2.4; host side `connectedMachinesOf` in
 * `src/exec-tools.ts`): a cwd that routes to a machine the registry still knows
 * counts as CONNECTED without being stored. The panel performs the same union
 * the `sw_exec` gate performs, so what the UI shows as connected is exactly what
 * the tool accepts. The row is flagged `implicit` and is not toggleable, because
 * disconnecting it cannot stick: the connection comes from the session's own cwd,
 * not from the store. (A cwd routing to a machine the registry no longer knows is
 * still shown as the main workspace — that is where the session works — but it is
 * NOT counted as connected, again mirroring the host.)
 *
 * STALE IDS: a connected id the registry no longer knows (a stale `machines.list`)
 * is reported as `staleConnectionIds` and renders NO row. The panel must never
 * offer a toggle for a machine that does not exist, and `side.conn.empty` is about
 * machines the user can actually see.
 * @module dsh-workspace-enhancement/client/cockpit
 */

import { remoteConnectionIdOf } from './remote-status.ts'

/** One registry machine, reduced to the leaf fields the cockpit renders. */
export interface CockpitMachine {
  id: string
  label: string
  host: string
  username: string
}

/** One side workspace as the wire returns it (REQ-I7: declaration only). */
export interface CockpitSideRow {
  id: string
  kind: 'local' | 'remote'
  rootKey: string
  label: string
}

/** A registry route recovered from a cwd spelling: the machine id + POSIX path. */
export interface CockpitRoute {
  /** The registry machine id the path routes to. */
  id: string
  /** The remote path in POSIX spelling (`/` when the spelling names none). */
  path: string
}

/**
 * The main workspace of one session: `none` for a plain local session, `remote`
 * when the cwd routes to a machine. `machineKnown` is false when the route names
 * a machine the registry no longer carries — the route is still the truth about
 * where the session works, so it is displayed, but it is not a connection.
 */
export type MainWorkspace =
  | { kind: 'none' }
  | {
    kind: 'remote'
    machineId: string
    /** The machine's label, or the raw id when the registry lost it. */
    label: string
    host: string
    username: string
    path: string
    machineKnown: boolean
  }

/** One row of the「已连接的机器」 section: a registry machine and its toggle. */
export interface ConnectionRow {
  id: string
  label: string
  host: string
  username: string
  /** Whether this session has the machine (stored, or implicit main machine). */
  connected: boolean
  /** Connected only because the session cwd routes there (never stored). */
  implicit: boolean
  /** Whether a toggle can change anything (false for the implicit main machine). */
  canToggle: boolean
}

/** Every judgment the cockpit view renders, derived in one pass. */
export interface CockpitView {
  main: MainWorkspace
  /** One row per registry machine, in registry order. */
  connections: ConnectionRow[]
  /** Stored ids the registry no longer knows (rendered nowhere). */
  staleConnectionIds: string[]
  /** The main machine when the registry still knows it, else undefined. */
  mainMachineId: string | undefined
  /** At least one VISIBLE machine is on (stored or implicit). */
  anyConnected: boolean
}

/** The RPC one toggle performs (pure: a row in, a request out). */
export interface CockpitToggleRequest {
  endpoint: 'session.conn.connect' | 'session.conn.disconnect'
  payload: { sessionId: string; id: string }
}

/** The `ssh://<id>/<posix>` spelling: scheme, id, optional POSIX tail. */
const SSH_SPELLING = /^ssh:\/\/([^/]+)((?:\/.*)?)$/

/**
 * The placeholder spelling, mirroring the pattern behind `routeIdOf`
 * (`./route-id.ts`, re-exported through `remoteConnectionIdOf`); this match is
 * only used to slice off the POSIX tail — the id itself always comes from
 * `remoteConnectionIdOf`, the repo's single client-side spelling of the rule.
 */
const PLACEHOLDER_SPELLING = /[\\/](?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Split a spelling's tail into a leading-slash POSIX path (`''` → `/`). */
function posixPathOf(raw: string): string {
  const segments = raw.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.')
  return segments.length === 0 ? '/' : `/${segments.join('/')}`
}

/**
 * The route one cwd spelling names, or undefined for a local session. Mirrors
 * the host's `remoteRouteFromCwd` through the two client-side rules the repo
 * already ships: `remoteConnectionIdOf` for the id (both spellings) and the
 * placeholder slice for the path. An unknown or malformed spelling is a local
 * session — never a guess.
 * @param cwd - the session's recorded cwd (any accepted spelling).
 */
export function routeOfCwd(cwd: string | undefined): CockpitRoute | undefined {
  const id = remoteConnectionIdOf(cwd)
  if (id === undefined || cwd === undefined) return undefined
  const ssh = SSH_SPELLING.exec(cwd)
  if (ssh !== null) return { id, path: posixPathOf(ssh[2] ?? '') }
  const placeholder = PLACEHOLDER_SPELLING.exec(cwd)
  // Unreachable while `remoteConnectionIdOf` and this pattern agree; a mismatch
  // degrades to "local session" rather than to a fabricated path.
  if (placeholder === null) return undefined
  return { id, path: posixPathOf(cwd.slice(placeholder.index + placeholder[0].length)) }
}

/**
 * Where one session actually works (ADR-0021 §2.9 item 1): the registry machine
 * + remote path the cwd routes to, or `none` for a plain local session.
 * @param cwd - the session's recorded cwd.
 * @param machines - the registry machines (for the label/host).
 */
export function mainWorkspaceOf(cwd: string | undefined, machines: readonly CockpitMachine[]): MainWorkspace {
  const route = routeOfCwd(cwd)
  if (route === undefined) return { kind: 'none' }
  const machine = machines.find(entry => entry.id === route.id)
  if (machine === undefined) {
    return {
      kind: 'remote',
      machineId: route.id,
      label: route.id,
      host: '',
      username: '',
      path: route.path,
      machineKnown: false,
    }
  }
  return {
    kind: 'remote',
    machineId: machine.id,
    label: machine.label,
    host: machine.host,
    username: machine.username,
    path: route.path,
    machineKnown: true,
  }
}

/**
 * The「已连接的机器」rows: one per registry machine (registry order), each with
 * the toggle state the last `session.conn.list` read implies. The implicit main
 * machine is unioned in exactly like the host's `sw_exec` gate does (and only
 * when the registry still knows it), and is never toggleable.
 * @param machines - the registry machines.
 * @param connectedIds - the ids the store returned (raw).
 * @param mainMachineId - the cwd's machine id when the registry knows it.
 */
export function connectionRows(
  machines: readonly CockpitMachine[],
  connectedIds: readonly string[],
  mainMachineId: string | undefined,
): ConnectionRow[] {
  const stored = normalizeIds(connectedIds)
  return machines.map(machine => {
    const implicit = mainMachineId !== undefined && machine.id === mainMachineId
    return {
      id: machine.id,
      label: machine.label,
      host: machine.host,
      username: machine.username,
      connected: implicit || stored.includes(machine.id),
      implicit,
      canToggle: !implicit,
    }
  })
}

/**
 * The whole cockpit derivation in one pass — the only entry point the view uses.
 * @param cwd - the session's recorded cwd.
 * @param machines - the registry machines.
 * @param connectedIds - the ids the last `session.conn.list` read returned.
 */
export function cockpitViewOf(
  cwd: string | undefined,
  machines: readonly CockpitMachine[],
  connectedIds: readonly string[],
): CockpitView {
  const main = mainWorkspaceOf(cwd, machines)
  const mainMachineId = main.kind === 'remote' && main.machineKnown ? main.machineId : undefined
  const connections = connectionRows(machines, connectedIds, mainMachineId)
  return {
    main,
    connections,
    staleConnectionIds: staleConnectionIdsOf(connectedIds, machines),
    mainMachineId,
    // Visible machines only: a store holding nothing but stale ids shows the
    // empty state, because no machine the user can see is connected.
    anyConnected: connections.some(row => row.connected),
  }
}

/**
 * The connected ids the registry no longer carries (a stale `machines.list`).
 * They render nowhere; surfacing them keeps the disappearance testable instead
 * of silent.
 * @param connectedIds - the ids the store returned (raw).
 * @param machines - the registry machines.
 */
export function staleConnectionIdsOf(
  connectedIds: readonly string[],
  machines: readonly CockpitMachine[],
): string[] {
  const known = new Set(machines.map(machine => machine.id))
  return normalizeIds(connectedIds).filter(id => !known.has(id))
}

/**
 * The RPC one toggle performs, or undefined when the row must not toggle (the
 * implicit main machine, or a blank session id). Pure, so the panel performs no
 * judgment of its own.
 * @param sessionId - the session the toggle belongs to.
 * @param row - the connection row the user clicked.
 */
export function toggleRequest(sessionId: string, row: ConnectionRow): CockpitToggleRequest | undefined {
  if (!row.canToggle || sessionId.trim() === '') return undefined
  return {
    endpoint: row.connected ? 'session.conn.disconnect' : 'session.conn.connect',
    payload: { sessionId, id: row.id },
  }
}

/** The `user@host` line of one machine ('' when the registry has no host). */
export function machineEndpointOf(machine: { host: string; username: string }): string {
  if (machine.host === '') return ''
  return machine.username === '' ? machine.host : `${machine.username}@${machine.host}`
}

/** Normalize a raw id list: strings, trimmed, non-empty, first-seen order. */
export function normalizeIds(values: readonly unknown[]): string[] {
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (id === '' || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * One `machines.list` row, reduced to the leaf fields the cockpit renders. A row
 * without a usable id is dropped (it can name nothing).
 * @param value - one raw wire row.
 */
export function asMachine(value: unknown): CockpitMachine | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.trim() === '') return null
  const id = value.id.trim()
  const label = typeof value.label === 'string' && value.label !== '' ? value.label : id
  return {
    id,
    label,
    host: typeof value.host === 'string' ? value.host : '',
    username: typeof value.username === 'string' ? value.username : '',
  }
}

/** The `machines.list` value (`{ machines: [...] }`) as cockpit machines. */
export function asMachineRows(value: unknown): CockpitMachine[] {
  const list = isRecord(value) && Array.isArray(value.machines) ? value.machines : []
  return list.map(asMachine).filter((row): row is CockpitMachine => row !== null)
}

/**
 * One `session.ws.list` row (REQ-I7: declaration only). A row without an id or a
 * root key is dropped.
 * @param value - one raw wire row.
 */
export function asSideRow(value: unknown): CockpitSideRow | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.rootKey !== 'string') return null
  return {
    id: value.id,
    kind: value.kind === 'remote' ? 'remote' : 'local',
    rootKey: value.rootKey,
    label: typeof value.label === 'string' ? value.label : value.rootKey,
  }
}

/** The `session.ws.list` value (`{ items: [...] }`) as side rows. */
export function asSideRows(value: unknown): CockpitSideRow[] {
  const list = isRecord(value) && Array.isArray(value.items) ? value.items : []
  return list.map(asSideRow).filter((row): row is CockpitSideRow => row !== null)
}

/** The `session.conn.*` value (`{ items: string[] }`) as the connected id list. */
export function asConnectedIds(value: unknown): string[] {
  const list = isRecord(value) && Array.isArray(value.items) ? value.items : []
  return normalizeIds(list)
}
