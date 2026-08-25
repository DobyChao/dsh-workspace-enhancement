/**
 * R5: the session header action「⊕ 工作区」and its side-workspaces panel —
 * one session's attached extra roots (local dirs / remote machine dirs), each
 * with its permission pair (fs r|rw, exec on|off). Add/edit/remove ride the
 * `/dsw session.ws.*` endpoints; the picker reuses the local browse
 * (`workspaces.listDirectory`) and the remote browse (`/dsw browse.list`).
 * Registered into `conversation.session.header.actions` (official additive
 * list slot; the framework passes `sessionId` as a standard prop).
 * @module dsh-workspace-enhancement/client/side-workspaces
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { FlowInjected } from './flow.tsx'
import type { WireEntry, WireListing, WireResult } from './index.ts'
import { CheckIcon, ChevronIcon, CloseIcon, FolderIcon, PlusIcon, ServerIcon, TrashIcon } from './icons.tsx'

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

/** One browse level (local listing or the `/dsw browse.list` wire shape). */
interface BrowseState {
  kind: 'local' | 'remote'
  machineId?: string
  listing: WireListing | null
  busy: boolean
  error: string
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

function unwrap(result: WireResult): unknown {
  if (result.ok) return result.value
  throw new Error(result.error?.message ?? 'dsw: request failed')
}

function asListing(value: unknown): WireListing | null {
  if (!isRecord(value)) return null
  return {
    path: typeof value.path === 'string' ? value.path : '',
    home: typeof value.home === 'string' ? value.home : '',
    crumbs: Array.isArray(value.crumbs) ? value.crumbs.filter(isRecord)
      .map(entry => ({ name: typeof entry.name === 'string' ? entry.name : '', path: typeof entry.path === 'string' ? entry.path : '', hidden: entry.hidden === true })) : [],
    entries: Array.isArray(value.entries) ? value.entries.filter(isRecord)
      .map(entry => ({ name: typeof entry.name === 'string' ? entry.name : '', path: typeof entry.path === 'string' ? entry.path : '', hidden: entry.hidden === true } as WireEntry)) : [],
    truncated: value.truncated === true,
  }
}

const panelStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const cardStyle: CSSProperties = {
  background: 'var(--color-bg-3, #1e1e2e)', color: 'var(--color-1, #e6e6e6)',
  border: '1px solid var(--color-border, #444)', borderRadius: 10, padding: 16,
  width: 560, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10,
}
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--color-border, #444)', borderRadius: 6 }
const inputStyle: CSSProperties = { background: 'var(--color-bg-2, #181825)', color: 'inherit', border: '1px solid var(--color-border, #444)', borderRadius: 4, padding: '4px 6px', fontSize: 12 }
const selectStyle: CSSProperties = { ...inputStyle, minWidth: 72 }
const buttonStyle: CSSProperties = { background: 'var(--color-bg-2, #181825)', color: 'inherit', border: '1px solid var(--color-border, #555)', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }
const primaryButtonStyle: CSSProperties = { ...buttonStyle, background: '#3b82f6', color: '#fff', borderColor: '#3b82f6' }
const iconButtonStyle: CSSProperties = { background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }

/** The trigger: one per-session button in the header action row. */
export function SideWorkspacesAction(props: FlowInjected & { sessionId: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        title="关联工作区（本会话的副目录）"
        style={buttonStyle}
      >
        <PlusIcon width={13} height={13} style={{ marginRight: 4 }} />
        工作区
      </button>
      {open ? <SideWorkspacesPanel sessionId={props.sessionId} injected={props} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/** The per-session side-workspaces manager. */
export function SideWorkspacesPanel(props: { sessionId: string; injected: FlowInjected; onClose: () => void }): JSX.Element {
  const { sessionId, injected, onClose } = props
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
  const [browse, setBrowse] = useState<BrowseState | null>(null)
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
      const listValue = unwrap(listResult) as { items?: unknown }
      setItems(Array.isArray(listValue.items) ? listValue.items.map(asSideWorkspaceRow).filter((row): row is SideWorkspaceRow => row !== null) : [])
      const machinesValue = unwrap(machinesResult) as { machines?: unknown }
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

  useEffect(() => {
    if (browse === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setBrowse(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [browse])

  const loadBrowse = (path: string | undefined): void => {
    if (browse === null) return
    setBrowse({ ...browse, listing: null, busy: true, error: '' })
    const request = browse.kind === 'local'
      ? injected.listLocalDirectory(path)
      : injected.rpc('browse.list', { id: browse.machineId, path }).then(unwrap)
    Promise.resolve(request).then(value => {
      const listing = asListing(value)
      if (listing === null) throw new Error('dsw: invalid listing response')
      setBrowse({ ...browse, listing, busy: false, error: '' })
    }).catch((reason: unknown) => {
      setBrowse({ ...browse, listing: null, busy: false, error: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  const openBrowse = (): void => {
    const isRemote = draftKind === 'remote'
    if (isRemote && draftMachine === '') {
      setError('请先选择机器')
      return
    }
    const browseState: BrowseState = { kind: draftKind, listing: null, busy: true, error: '', ...(isRemote ? { machineId: draftMachine } : {}) }
    setBrowse(browseState)
    load2(browseState, undefined)
  }

  const load2 = (state: BrowseState, path: string | undefined): void => {
    const request = state.kind === 'local'
      ? injected.listLocalDirectory(path)
      : injected.rpc('browse.list', { id: state.machineId, path }).then(unwrap)
    Promise.resolve(request).then(value => {
      const listing = asListing(value)
      if (listing === null) throw new Error('dsw: invalid listing response')
      setBrowse({ ...state, listing, busy: false, error: '' })
    }).catch((reason: unknown) => {
      setBrowse({ ...state, listing: null, busy: false, error: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  const pickBrowse = (): void => {
    if (browse?.listing === null || browse?.listing === undefined) return
    if (browse.kind === 'remote') {
      setDraftMachine(browse.machineId ?? draftMachine)
    }
    setDraftPath(browse.listing.path)
    setBrowse(null)
  }

  const draftPathSpelling = (): string => {
    const path = draftPath.trim()
    if (path === '') return ''
    return draftKind === 'remote' ? `ssh://${draftMachine}${path}` : path
  }

  const addSide = (): void => {
    const path = draftPathSpelling()
    if (draftKind === 'remote' && draftMachine === '') {
      setError('请先选择机器')
      return
    }
    if (path === '') {
      setError(draftKind === 'remote' ? '请输入远程路径（/ 开头）' : '请输入本地目录路径')
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
    <div style={panelStyle} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={cardRef} style={cardStyle} role="dialog" aria-label="关联工作区" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 14 }}>关联工作区（本会话副目录）</strong>
          <button type="button" style={iconButtonStyle} onClick={onClose} aria-label="关闭"><CloseIcon width={14} height={14} /></button>
        </div>

        {error !== '' ? <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div> : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflow: 'auto' }}>
          {busy && items.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>加载中…</div> : null}
          {items.length === 0 ? <div style={{ fontSize: 12, opacity: 0.6 }}>未关联任何副目录。副目录是模型可以直接读写的附加根，各有独立权限。</div> : null}
          {items.map(item => (
            <div key={item.rootKey} style={rowStyle}>
              {item.kind === 'remote' ? <ServerIcon width={13} height={13} /> : <FolderIcon width={13} height={13} />}
              {editing === item.rootKey
                ? (
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={editingLabel}
                    onChange={(event) => setEditingLabel(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') updateLabel(item.rootKey, editingLabel) }}
                  />
                )
                : <span style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</span>}
              <span style={{ fontSize: 11, opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{item.rootKey}</span>
              <select style={selectStyle} value={item.fs} onChange={(event) => updateSide(item.rootKey, { fs: event.target.value as 'r' | 'rw' })} aria-label="fs 权限">
                <option value="rw">读写</option>
                <option value="r">只读</option>
              </select>
              <select style={selectStyle} value={item.exec} onChange={(event) => updateSide(item.rootKey, { exec: event.target.value as 'on' | 'off' })} aria-label="执行权限">
                <option value="on">可执行</option>
                <option value="off">禁执行</option>
              </select>
              <button type="button" style={iconButtonStyle} title="编辑名称" onClick={() => { setEditing(item.rootKey); setEditingLabel(item.label) }}><CheckIcon width={13} height={13} /></button>
              <button type="button" style={iconButtonStyle} title="移除" onClick={() => removeSide(item.rootKey)}><TrashIcon width={13} height={13} /></button>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--color-border, #444)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={draftKind === 'local' ? primaryButtonStyle : buttonStyle} onClick={() => setDraftKind('local')}>本机目录</button>
            <button type="button" style={draftKind === 'remote' ? primaryButtonStyle : buttonStyle} onClick={() => setDraftKind('remote')}>远程目录</button>
          </div>
          {draftKind === 'remote' ? (
            <select style={{ ...selectStyle, width: '100%' }} value={draftMachine} onChange={(event) => setDraftMachine(event.target.value)} aria-label="机器">
              {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.label}</option>)}
            </select>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder={draftKind === 'remote' ? '远程路径，如 /srv/app（/ 开头）' : '本地目录绝对路径'}
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
            />
            <button type="button" style={buttonStyle} onClick={openBrowse}>浏览…</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="显示名（默认目录名）" value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} />
            <select style={selectStyle} value={draftFs} onChange={(event) => setDraftFs(event.target.value as 'r' | 'rw')} aria-label="添加 fs 权限">
              <option value="rw">读写</option>
              <option value="r">只读</option>
            </select>
            <select style={selectStyle} value={draftExec} onChange={(event) => setDraftExec(event.target.value as 'on' | 'off')} aria-label="添加执行权限">
              <option value="on">可执行</option>
              <option value="off">禁执行</option>
            </select>
            <button type="button" style={primaryButtonStyle} disabled={busy} onClick={addSide}>挂载</button>
          </div>
        </div>
      </div>

      {browse !== null ? (
        <div style={panelStyle} onClick={(event) => { if (event.target === event.currentTarget) setBrowse(null) }}>
          <div style={{ ...cardStyle, width: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 13 }}>选择目录{browse.kind === 'remote' ? `（${machines.find(m => m.id === browse.machineId)?.label ?? browse.machineId}）` : '（本机）'}</strong>
              <button type="button" style={iconButtonStyle} onClick={() => setBrowse(null)}><CloseIcon width={14} height={14} /></button>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(browse.listing?.crumbs ?? []).map(crumb => (
                <button key={crumb.path} style={{ ...buttonStyle, padding: '2px 6px' }} onClick={() => loadBrowse(crumb.path)}>{crumb.name}</button>
              ))}
            </div>
            {browse.busy ? <div style={{ fontSize: 12, opacity: 0.7 }}>加载中…</div> : null}
            {browse.error !== '' ? <div style={{ color: '#f87171', fontSize: 12 }}>{browse.error}</div> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflow: 'auto' }}>
              {(browse.listing?.entries ?? []).filter(entry => !entry.hidden).map(entry => (
                <button key={entry.path} type="button" style={{ ...buttonStyle, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => loadBrowse(entry.path)}>
                  <FolderIcon width={12} height={12} />
                  <span style={{ fontSize: 12 }}>{entry.name}</span>
                </button>
              ))}
              {(browse.listing?.entries ?? []).length === 0 && browse.listing !== null ? <div style={{ fontSize: 12, opacity: 0.6 }}>（空目录）</div> : null}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={buttonStyle} onClick={() => setBrowse(null)}>取消</button>
              <button type="button" style={primaryButtonStyle} disabled={browse.listing === null} onClick={pickBrowse}>
                <ChevronIcon width={12} height={12} style={{ marginRight: 4 }} />
                选择 {browse.kind === 'remote' ? `ssh://${browse.machineId}${browse.listing?.path ?? ''}` : browse.listing?.path ?? ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
