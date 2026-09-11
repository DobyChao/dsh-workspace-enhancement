/**
 * The header-action VIEW of the remote-status entry (REQ-I2 entry point). All
 * judgments live in `./remote-status.ts` — this file only renders them, because
 * the sandbox runner never executes `.tsx`.
 *
 * One row in the session header action strip: the tri-state state of the
 * connection the current session's cwd routes to (dot + state label), plus a
 * click that re-checks and reconnects. A local session renders nothing at all —
 * the strip stays exactly as upstream built it.
 * @module dsh-workspace-enhancement/client/remote-status-entry
 */

import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteSessionFacts, RemoteStatusSeats } from './remote-status.ts'
import { remoteConnectionIdOf } from './remote-status.ts'
import type { RpcCall } from './status.tsx'
import { CONN_STATE_COLOR, CONN_STATE_LABEL_KEY, getStatusCenter, useConnStatus, zhBaseline } from './status.tsx'

/** The props this entry receives: its seats, the session, the wire, the seat. */
export interface RemoteStatusActionProps extends RemoteStatusSeats {
  /** The session the framework scopes this row to. */
  sessionId: string
  /** The `/dsw` channel call (conn.status / conn.reconnect). */
  rpc: RpcCall
  /** Typed translate seat injected by the slot (defaults to the zh baseline). */
  t?: TranslateNS<'dsw'>
}

/**
 * Track the session's facts across feed changes. The seat functions are stable
 * across renders (apply builds them once), so the subscription is not
 * re-created; the value guard keeps a feed that fires without a real change
 * from churning renders.
 */
function useRemoteFacts(sessionId: string, seats: RemoteStatusSeats): RemoteSessionFacts | undefined {
  const { remoteFacts, subscribeRemote } = seats
  const [facts, setFacts] = useState<RemoteSessionFacts | undefined>(() => remoteFacts(sessionId))
  useEffect(() => {
    const sync = (): void => {
      const next = remoteFacts(sessionId)
      setFacts(prev => (prev?.cwd === next?.cwd ? prev : next))
    }
    sync()
    return subscribeRemote(sync)
  }, [sessionId, remoteFacts, subscribeRemote])
  return facts
}

/** The remote-status row: dot + state label, click = re-check and reconnect. */
export function RemoteStatusAction(props: RemoteStatusActionProps): JSX.Element | null {
  const t = props.t ?? zhBaseline
  const facts = useRemoteFacts(props.sessionId, props)
  const connId = remoteConnectionIdOf(facts?.cwd)
  // Hooks stay unconditional: the status hook is fed the (possibly undefined)
  // connection and returns an unknown view while there is none.
  const center = getStatusCenter(props.rpc, () => t)
  const { view, busy, reconnect } = useConnStatus(center, connId)
  if (connId === undefined) return null
  const state = view?.state ?? 'unknown'
  const machine = view !== null && view.label !== '' ? view.label : connId
  return (
    <button
      type="button"
      data-dsw-remote-status={connId}
      className="dsw-remote-status"
      title={t('header.remote.title', { machine })}
      aria-label={t('header.remote.label')}
      disabled={busy}
      onClick={() => { void reconnect() }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.35)',
        background: 'rgba(128,128,128,0.08)',
        color: 'inherit',
        cursor: busy ? 'default' : 'pointer',
        fontSize: 11,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>🌐</span>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: CONN_STATE_COLOR[state],
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12, opacity: 0.85 }}>{busy ? t('status.checking') : t(CONN_STATE_LABEL_KEY[state])}</span>
    </button>
  )
}
