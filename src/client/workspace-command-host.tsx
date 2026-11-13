/**
 * View for `/workspace`: portals the existing add-workspace directory flow.
 * The composer overlay that hosts this cell is clipped, same as the session
 * header (BUG-30), so the dialog is portaled to `document.body`.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowInjected } from './flow.tsx'
import { SshWorkspaceFlow } from './flow.tsx'
import { zhBaseline } from './status.tsx'
import type { WorkspaceCommandBridge } from './workspace-command.ts'

export interface WorkspaceCommandHostProps extends FlowInjected {
  sessionId: string
  t?: TranslateNS<'dsw'>
  bridge: WorkspaceCommandBridge
  adoptWorkspace(path: string): Promise<void>
}

/** Renders the directory flow only for the session that invoked the command. */
export function WorkspaceCommandHost(props: WorkspaceCommandHostProps): JSX.Element | null {
  const t = props.t ?? zhBaseline
  const request = useSyncExternalStore(props.bridge.subscribe, props.bridge.snapshot)
  const open = request?.sessionId === props.sessionId
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) setError('')
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const flow = (
    <>
      <SshWorkspaceFlow
        open
        busy={false}
        onPicked={(path) => {
          void props.adoptWorkspace(path).then(() => {
            props.bridge.close()
          }, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason))
          })
        }}
        onCancel={() => {
          setError('')
          props.bridge.close()
        }}
        onError={setError}
        listLocalDirectory={props.listLocalDirectory}
        createLocalDirectory={props.createLocalDirectory}
        rpc={props.rpc}
        t={t}
      />
      {error !== '' ? (
        <div
          role="alert"
          style={{
            position: 'fixed',
            zIndex: 1100,
            left: '50%',
            bottom: 28,
            transform: 'translateX(-50%)',
            maxWidth: 'min(520px, calc(100% - 32px))',
            padding: '8px 12px',
            borderRadius: 12,
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-state-error-primary)',
            boxShadow: 'var(--dsw-shadow-lv3)',
          }}
        >
          {error}
        </div>
      ) : null}
    </>
  )
  return createPortal(flow, document.body)
}
