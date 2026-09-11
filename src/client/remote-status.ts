/**
 * Remote-status header entry — pure logic (REQ-I2 entry point, official-slot
 * route).
 *
 * WHY ITS OWN MODULE (docs/testing.md): the sandbox runner (`test:agent`) never
 * executes `.tsx`, so every judgment the entry makes lives here — the slot and
 * entry identity, the session→connection resolution, the render decision, and
 * the registration options. The `.tsx` beside it only renders.
 *
 * TRUTH SOURCE: a session is remote when its cwd routes to a machine — the very
 * fact the host reads for the remote prompt sections
 * (`src/session-remote-context.ts` → `remoteRouteFromCwd`). The client must not
 * import that module (it drags `node:fs` / `ssh2` into the browser bundle), so
 * the route-id rule is mirrored here through `routeIdOf` of `./route-id.ts`,
 * the single client-side spelling of it, shared with the DOM badge layer.
 *
 * SLOT CHOICE (ADR-0017 + the round's hard constraint): the entry registers
 * into `conversation.session.header.utilities` — the official additive list
 * slot both peer families declare ("Right-aligned Session utilities in ascending
 * order"; the rc.1 catalog lists it with the `session-log-download` occupant, the
 * rc.2 catalog with `open-in-app` + `session-log-download`), so the feature is
 * visible both on the family the live deployment runs and on rc.2. A
 * right-aligned utilities cell is where a remote STATUS belongs: the sibling
 * `conversation.session.header.actions` is the title-adjacent ACTION group,
 * where this plugin already owns the side-workspaces cell.
 *
 * No conditional double registration, ever: `ctx.slots.inject` waits for a
 * declaration and cannot ask whether a key exists, so registering into two
 * seats would render the same status twice on rc.2. Should a live check ever
 * show the utilities seat absent, the fallback is to move this ONE constant to
 * `conversation.session.header.actions` — never to register in both.
 * @module dsh-workspace-enhancement/client/remote-status
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { routeIdOf } from './route-id.ts'

/**
 * The official additive list slot the entry occupies: "Right-aligned Session
 * utilities in ascending order". Declared by the header entry of
 * `@deepseek-ai/dsh-client-ui-conversation` in both supported families —
 * `kind: 'list'`, `scope: 'session'`, `replaceRisk: 'none'`.
 */
export const REMOTE_STATUS_SLOT = 'conversation.session.header.utilities'

/**
 * This entry's OWN row identity. No shipped utilities cell uses this id, so the
 * cell is ADDED beside them; reusing a shipped id would replace that cell.
 */
export const REMOTE_STATUS_ENTRY_ID = 'dsh-workspace-enhancement-remote'

/**
 * Row order: positive, so the cell sorts after the shipped utilities — the rc.1
 * occupant (`session-log-download`) and the rc.2 addition (`open-in-app`) declare
 * no order and therefore sit at the default 0. 25 is this repo's existing
 * header-cell spacing (the side-workspaces cell uses 25 in the sibling slot).
 */
export const REMOTE_STATUS_ORDER = 26

/** The session facts the entry renders from (leaf projection only). */
export interface RemoteSessionFacts {
  /** The session's recorded cwd, in any accepted spelling. */
  cwd?: string
}

/**
 * The connection id one cwd spelling routes to, or undefined for a local
 * session. Mirrors the host's `remoteRouteFromCwd`: the `ssh://<id>/<path>`
 * form first, then either local placeholder tree (`dsw-routes/<id>/…`, the
 * pre-rename `dsh-ssh-routes/<id>/…`). An unknown/malformed spelling is a
 * local session — never a guess.
 * @param cwd - the session's recorded cwd (any spelling).
 * @returns the registry connection id, or undefined when the cwd is local.
 */
export function remoteConnectionIdOf(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  if (cwd.startsWith('ssh://')) {
    const rest = cwd.slice('ssh://'.length)
    const slash = rest.indexOf('/')
    const id = slash === -1 ? rest : rest.slice(0, slash)
    return /^[A-Za-z0-9._-]+$/.test(id) ? id : undefined
  }
  return routeIdOf(cwd)
}

/**
 * Whether the header entry renders at all: remote sessions only. A local
 * session (no cwd recorded, or a cwd that routes nowhere) shows NOTHING —
 * the same zero-noise stance the remote prompt sections take.
 * @param facts - the session facts (undefined while the store has no row yet).
 */
export function showsRemoteStatus(facts: RemoteSessionFacts | undefined): boolean {
  return remoteConnectionIdOf(facts?.cwd) !== undefined
}

/** The registration options handed to `ctx.slots.register`. */
export interface RemoteStatusRegisterOptions {
  /** The official slot key (both peer families declare it). */
  name: typeof REMOTE_STATUS_SLOT
  /** This entry's own row id (never the side-workspaces id). */
  id: typeof REMOTE_STATUS_ENTRY_ID
  /** Row order, after the side-workspaces entry. */
  order: typeof REMOTE_STATUS_ORDER
  /** Registrant-localized row label (resolved by the slot's label resolver). */
  label: () => string
  /** The dictionary namespace the slot injects as the typed `t` seat. */
  locale: 'dsw'
}

/**
 * Build the registration options. Pure (a translate seat in, options out) so
 * the id/order contract is unit-testable without the slot registry.
 * @param t - the translate seat of the active language.
 */
export function remoteStatusRegisterOptions(t: TranslateNS<'dsw'>): RemoteStatusRegisterOptions {
  return {
    name: REMOTE_STATUS_SLOT,
    id: REMOTE_STATUS_ENTRY_ID,
    order: REMOTE_STATUS_ORDER,
    // Label thunk: read-time resolution keeps the active language live without
    // re-registration (the resolveSlotLabel contract the other entries use).
    label: () => t('header.remote.label'),
    locale: 'dsw',
  }
}

/** Minimal snapshot face of the client `sessions` store feed (see index.ts). */
export interface RemoteSessionsFeed {
  getSnapshot(): { byId: Record<string, { cwd?: string }> }
  subscribe(fn: () => void): () => void
}

/** The seats the entry consumes: current-session facts + change events. */
export interface RemoteStatusSeats {
  /** The session's facts, or undefined while the store carries no such row. */
  remoteFacts(sessionId: string): RemoteSessionFacts | undefined
  /** Subscribe to feed changes (returns the disposer). */
  subscribeRemote(onChange: () => void): () => void
}

/**
 * Build the seats over the live session feed. Resolution is lazy and optional
 * (`ctx.get` territory): a runtime without the store — or with a store whose
 * shape moved — degrades to "no facts" and the entry stays hidden instead of
 * throwing inside the header's render.
 *
 * The caller hands in the FEED (`sessions.list`, the SessionController's list
 * store), not the `sessions` service face: the face carries `open`/`fork`/
 * `search`/… and exposes the store as `list`.
 * @param resolveFeed - reads the live feed; undefined while it is absent.
 */
export function createRemoteStatusSeats(resolveFeed: () => RemoteSessionsFeed | undefined): RemoteStatusSeats {
  // Guard the shape, not just the presence (mirrors local-directory's method
  // guard): a renamed or half-built feed must hide the cell, never throw.
  const feed = (): RemoteSessionsFeed | undefined => {
    const found = resolveFeed()
    if (found === undefined) return undefined
    if (typeof found.getSnapshot !== 'function' || typeof found.subscribe !== 'function') return undefined
    return found
  }
  return {
    remoteFacts: sessionId => {
      const row = feed()?.getSnapshot().byId[sessionId]
      if (row === undefined) return undefined
      return typeof row.cwd === 'string' ? { cwd: row.cwd } : {}
    },
    subscribeRemote: onChange => feed()?.subscribe(onChange) ?? (() => {}),
  }
}
