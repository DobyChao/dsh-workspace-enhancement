/**
 * R5: the session header action「⊕ 工作区」and its side-workspaces panel —
 * one session's attached extra roots (local dirs / remote machine dirs), each
 * with its permission pair (fs r|rw, exec on|off). Add/edit/remove ride the
 * `/dsw session.ws.*` endpoints; the picker reuses the shared add-workspace
 * directory flow (`SshWorkspaceFlow`), so local and remote browsing go through
 * the very same modal the main add-workspace flow uses. Registered into
 * `conversation.session.header.actions` (official additive list slot; the
 * framework passes `sessionId` as a standard prop).
 * @module dsh-workspace-enhancement/client/side-workspaces
 */

import { useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowInjected } from './flow.tsx'
import { SshWorkspaceFlow } from './flow.tsx'
import type { WireResult } from './index.ts'
import { zhBaseline } from './status.tsx'
import { CloseIcon, FolderIcon, PlusIcon, ServerIcon, TrashIcon } from './icons.tsx'
import styles from './side-workspaces.module.css'

/** One side workspace as the wire returns it. */
export interface SideWorkspaceRow {
  id: string
  kind: 'local' | 'remote'
  rootKey: string
  label: string
  fs: 'r' | 'rw'
  exec: 'on' | 'off'
}

/** The machines.list wire machine (leaf fields the picker needs). */
interface WireMachine {
  id: string
  label: string
  host: string
  username: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function asSideWorkspaceRow(value: unknown): SideWorkspaceRow | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.rootKey !== 'string') return null
  return {
    id: value.id,
    kind: value.kind === 'remote' ? 'remote' : 'local',
    rootKey: value.rootKey,
    label: typeof value.label === 'string' ? value.label : value.rootKey,
    fs: value.fs === 'r' ? 'r' : 'rw',
    exec: value.exec === 'off' ? 'off' : 'on',
  }
}

function asMachine(value: unknown): WireMachine | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string') return null
  const label = typeof value.label === 'string' && value.label !== '' ? value.label : value.id
  const host = typeof value.host === 'string' ? value.host : ''
  const username = typeof value.username === 'string' ? value.username : ''
  return { id: value.id, label, host, username }
}

function unwrap(result: WireResult, t: TranslateNS<'dsw'>): unknown {
  if (result.ok) return result.value
  throw new Error(result.error?.message ?? t('side.rpc.failed'))
}

/**
 * The flow delivers a remote pick either as its raw `ssh://<id><posixPath>`
 * spelling (pickOnly / suppressSessionRoute) or as the local placeholder that
 * stands in for a remote route (`<DSH_HOME>/dsw-routes/<id>/<path>`, or the
 * legacy `dsh-ssh-routes` spelling). Detect both; the host normalizes either
 * into the same registry-backed root key.
 */
const isRemoteSpelling = (path: string): boolean =>
  /^ssh:\/\//.test(path) || /[\\/](dsw-routes|dsh-ssh-routes)[\\/]/.test(path)

/** The trigger: one per-session button in the header action row. */
export function SideWorkspacesAction(props: FlowInjected & { sessionId: string; t?: TranslateNS<'dsw'> }): JSX.Element {
  const t = props.t ?? zhBaseline
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={styles.action}
        onClick={() => setOpen(value => !value)}
        title={t('side.headerAction.title')}
      >
        <PlusIcon width={13} height={13} />
        {t('side.headerAction.label')}
      </button>
      {open ? <SideWorkspacesPanel sessionId={props.sessionId} injected={props} t={t} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/** The per-session side-workspaces manager. */
export function SideWorkspacesPanel(props: { sessionId: string; injected: FlowInjected; t?: TranslateNS<'dsw'>; onClose: () => void }): JSX.Element {
  const { sessionId, injected, onClose, t: tSeat } = props
  const t = tSeat ?? zhBaseline
  const [items, setItems] = useState<SideWorkspaceRow[]>([])
  const [machines, setMachines] = useState<WireMachine[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [draftKind, setDraftKind] = useState<'local' | 'remote'>('local')
  const [draftPath, setDraftPath] = useState('')
  const [draftMachine, setDraftMachine] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [draftFs, setDraftFs] = useState<'r' | 'rw'>('rw')
  const [draftExec, setDraftExec] = useState<'on' | 'off'>('on')
  const [browseOpen, setBrowseOpen] = useState(false)
  const [editing, setEditing] = useState('') // rootKey being label-edited
  const [editingLabel, setEditingLabel] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)

  const refresh = (): void => {
    setBusy(true)
    setError('')
    Promise.all([
      injected.rpc('session.ws.list', { sessionId }),
      injected.rpc('machines.list', {}),
    ]).then(([listResult, machinesResult]) => {
      const listValue = unwrap(listResult, t) as { items?: unknown }
      setItems(Array.isArray(listValue.items) ? listValue.items.map(asSideWorkspaceRow).filter((row): row is SideWorkspaceRow => row !== null) : [])
      const machinesValue = unwrap(machinesResult, t) as { machines?: unknown }
      const rows = Array.isArray(machinesValue.machines) ? machinesValue.machines.map(asMachine).filter((row): row is WireMachine => row !== null) : []
      setMachines(rows)
      setDraftMachine(current => current !== '' ? current : (rows[0]?.id ?? ''))
      setBusy(false)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    })
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const draftPathSpelling = (): string => {
    const path = draftPath.trim()
    if (path === '') return ''
    return draftKind === 'remote' ? `ssh://${draftMachine}${path}` : path
  }

  /**
   * A pick from the shared flow: fill the draft back into the form. The flow
   * runs in pickOnly mode, so a remote pick arrives as the raw
   * `ssh://<id>/<posix>` spelling and a local pick as an absolute path;
   * mounting only goes through the「挂载」button — no `session.ws.add` here.
   */
  const handlePicked = (path: string): void => {
    setError('')
    if (/^ssh:\/\//.test(path)) {
      // `ssh://<id>/<posix>` → the first segment after the scheme is the
      // machine id (registry ids never contain '/'), the remainder the POSIX
      // path in `/xxx` form. `'ssh://'` is 6 characters — slice by its exact
      // length so the id is never truncated.
      const segments = path.slice('ssh://'.length).split('/')
      const id = segments.shift() ?? ''
      setDraftKind('remote')
      setDraftMachine(id)
      setDraftPath(`/${segments.join('/')}`)
    } else if (isRemoteSpelling(path)) {
      // Defensive: pickOnly no longer produces placeholder spellings, but a
      // legacy dsw-routes / dsh-ssh-routes path still means a remote root —
      // recover the registry id and the POSIX path (the placeholder joins the
      // remote segments with OS separators, so normalize them back to '/'),
      // so the draft can be re-spelled as ssh://<id>/<path> on mount. Never
      // put the placeholder itself into draftPath: the 挂载 spelling would
      // wrap it again, and the host would reject it.
      const match = /[\\/](dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)(?:[\\/](.*))?$/.exec(path)
      if (match === null) {
        setError(t('side.error.unresolvedPath'))
        setBrowseOpen(false)
        return
      }
      const rest = (match[3] ?? '').split(/[\\/]+/).filter(segment => segment !== '').join('/')
      setDraftKind('remote')
      setDraftMachine(match[2] ?? '')
      setDraftPath(rest === '' ? '/' : `/${rest}`)
    } else {
      setDraftKind('local')
      setDraftPath(path)
    }
    setBrowseOpen(false)
  }

  const addSide = (): void => {
    const path = draftPathSpelling()
    if (draftKind === 'remote' && draftMachine === '') {
      setError(t('side.error.noMachine'))
      return
    }
    if (path === '') {
      setError(draftKind === 'remote' ? t('side.error.path.remote') : t('side.error.path.local'))
      return
    }
    setBusy(true)
    setError('')
    injected.rpc('session.ws.add', {
      sessionId,
      id: `sw-${Date.now().toString(36)}`,
      kind: draftKind,
      path,
      ...(draftLabel.trim() !== '' ? { label: draftLabel.trim() } : {}),
      fs: draftFs,
      exec: draftExec,
    }).then(() => {
      setDraftPath('')
      setDraftLabel('')
      setBusy(false)
      refresh()
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    })
  }

  const updateSide = (rootKey: string, patch: { fs?: 'r' | 'rw'; exec?: 'on' | 'off' }): void => {
    injected.rpc('session.ws.update', { rootKey, ...patch }).then(() => refresh())
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  const updateLabel = (rootKey: string, label: string): void => {
    if (label.trim() === '') {
      setEditing('')
      return
    }
    injected.rpc('session.ws.update', { rootKey, label: label.trim() }).then(() => {
      setEditing('')
      refresh()
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  const removeSide = (rootKey: string): void => {
    injected.rpc('session.ws.remove', { sessionId, rootKey }).then(() => refresh())
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  return (
    <div className={styles.panel} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={cardRef} className={styles.card} role="dialog" aria-label={t('side.card.label')} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
        <div className={styles.header}>
          <strong className={styles.title}>{t('side.card.title')}</strong>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('side.close.label')}><CloseIcon width={14} height={14} /></button>
        </div>

        {error !== '' ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.list}>
          {busy && items.length === 0 ? <div className={styles.loading}>{t('side.loading')}</div> : null}
          {items.length === 0 ? <div className={styles.empty}>{t('side.empty')}</div> : null}
          {items.map(item => (
            <div key={item.rootKey} className={styles.row}>
              {item.kind === 'remote' ? <ServerIcon className={styles.rowIcon} width={13} height={13} /> : <FolderIcon className={styles.rowIcon} width={13} height={13} />}
              {editing === item.rootKey
                ? (
                  <input
                    className={styles.input}
                    value={editingLabel}
                    onChange={(event) => setEditingLabel(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') updateLabel(item.rootKey, editingLabel) }}
                  />
                )
                : <span className={styles.itemLabel}>{item.label}</span>}
              <span className={styles.rowPath} title={item.rootKey}>{item.rootKey}</span>
              <select className={styles.select} value={item.fs} onChange={(event) => updateSide(item.rootKey, { fs: event.target.value as 'r' | 'rw' })} aria-label={t('side.fs.label')}>
                <option value="rw">{t('permission.rw')}</option>
                <option value="r">{t('permission.r')}</option>
              </select>
              <select className={styles.select} value={item.exec} onChange={(event) => updateSide(item.rootKey, { exec: event.target.value as 'on' | 'off' })} aria-label={t('side.exec.label')}>
                <option value="on">{t('permission.execOn')}</option>
                <option value="off">{t('permission.execOff')}</option>
              </select>
              <button type="button" className={styles.renameButton} title={t('side.rename.title')} onClick={() => { setEditing(item.rootKey); setEditingLabel(item.label) }}>{t('side.rename.button')}</button>
              <button type="button" className={`${styles.iconButton} ${styles.danger}`} title={t('side.remove.title')} onClick={() => removeSide(item.rootKey)}><TrashIcon width={13} height={13} /></button>
            </div>
          ))}
        </div>

        <div className={styles.form}>
          <div className={styles.segment} role="group" aria-label={t('side.kind.label')}>
            <button type="button" className={draftKind === 'local' ? `${styles.segmentButton} ${styles.segmentButtonOn}` : styles.segmentButton} onClick={() => setDraftKind('local')}>{t('side.kind.local')}</button>
            <button type="button" className={draftKind === 'remote' ? `${styles.segmentButton} ${styles.segmentButtonOn}` : styles.segmentButton} onClick={() => setDraftKind('remote')}>{t('side.kind.remote')}</button>
          </div>
          {draftKind === 'remote' ? (
            <select className={`${styles.select} ${styles.selectWide}`} value={draftMachine} onChange={(event) => setDraftMachine(event.target.value)} aria-label={t('side.machine.label')}>
              {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.label}</option>)}
            </select>
          ) : null}
          <div className={styles.fieldRow}>
            <input
              className={styles.input}
              placeholder={draftKind === 'remote' ? t('side.draft.path.remote') : t('side.draft.path.local')}
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
            />
            <button type="button" className={styles.button} onClick={() => setBrowseOpen(true)}>{t('side.browse')}</button>
          </div>
          <div className={styles.fieldRow}>
            <input className={styles.input} placeholder={t('side.draft.labelPlaceholder')} value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} />
            <select className={styles.select} value={draftFs} onChange={(event) => setDraftFs(event.target.value as 'r' | 'rw')} aria-label={t('side.fs.label')}>
              <option value="rw">{t('permission.rw')}</option>
              <option value="r">{t('permission.r')}</option>
            </select>
            <select className={styles.select} value={draftExec} onChange={(event) => setDraftExec(event.target.value as 'on' | 'off')} aria-label={t('side.exec.label')}>
              <option value="on">{t('permission.execOn')}</option>
              <option value="off">{t('permission.execOff')}</option>
            </select>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={addSide}>{t('side.mount')}</button>
          </div>
        </div>
      </div>

      <SshWorkspaceFlow
        open={browseOpen}
        busy={busy}
        suppressSessionRoute
        pickOnly
        initialConnectionId={draftKind === 'remote' ? draftMachine : ''}
        onPicked={handlePicked}
        onCancel={() => setBrowseOpen(false)}
        onError={(message) => setError(message)}
        listLocalDirectory={injected.listLocalDirectory}
        createLocalDirectory={injected.createLocalDirectory}
        rpc={injected.rpc}
        t={t}
      />
    </div>
  )
}
