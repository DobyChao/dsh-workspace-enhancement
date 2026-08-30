/**
 * Minimal remote-machine management settings page (machine registry edition):
 * machine list (edit / delete / set current / forget host key) plus the shared
 * {@link MachineForm} (mode="settings") — one form component with the flow's
 * add-connection form (R2 表单并集; see docs/ui-merge-design.md). No forwards /
 * audit / update sections — those belong to dsh-remote only and are
 * deliberately not ported.
 *
 * All data rides the package's `/dsw` RPC channel (machines.*, hostkey.forget);
 * all styles are inline.
 * @module dsh-workspace-enhancement/settings
 */

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WireResult } from './index.ts'
import { MachineForm } from './machine-form.tsx'
import type { MachineFormInitial, MachineSaveView } from './machine-form.tsx'
import { ConnStatusBadge, zhBaseline } from './status.tsx'

/** The `/dsw` RPC face injected by the client plugin. */
export interface SettingsInjected {
  rpc(endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<WireResult>
  /** Typed translate seat (slot-injected once the registration declares `locale`). */
  t?: TranslateNS<'dsw'>
}

/** Owner share of a `settings.section` entry (the shell supplies `close`). */
export interface SettingsOwnerProps {
  close(): void
}

/** Secret-free machine view as wired by `machines.*`. */
interface MachineView {
  id: string
  label: string
  host: string
  port: number
  username: string
  cwd?: string
  workspace?: string
  auth: 'password' | 'key' | 'agent'
  passwordSet: boolean
  jumpHosts: string[]
  hostKeyMode?: 'accept-new' | 'verify' | 'off'
  credentialBackend: string
  /** Encryption was requested but the OS backend failed (plaintext fallback). */
  encryptFallback?: boolean
  recentWorkspaces?: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Structural check for one machine wire row (unknown fields tolerated). */
function asMachineView(value: unknown): MachineView | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.host !== 'string' || typeof value.username !== 'string') return null
  const machine: MachineView = {
    id: value.id,
    label: typeof value.label === 'string' ? value.label : value.host,
    host: value.host,
    port: typeof value.port === 'number' ? value.port : 22,
    username: value.username,
    auth: value.auth === 'password' || value.auth === 'agent' ? value.auth : 'key',
    passwordSet: value.passwordSet === true,
    jumpHosts: Array.isArray(value.jumpHosts) ? value.jumpHosts.map(String) : [],
    credentialBackend: typeof value.credentialBackend === 'string' ? value.credentialBackend : 'plain',
  }
  if (typeof value.cwd === 'string') machine.cwd = value.cwd
  if (typeof value.workspace === 'string') machine.workspace = value.workspace
  if (value.hostKeyMode === 'accept-new' || value.hostKeyMode === 'verify' || value.hostKeyMode === 'off') {
    machine.hostKeyMode = value.hostKeyMode
  }
  if (value.encryptFallback === true) machine.encryptFallback = true
  if (Array.isArray(value.recentWorkspaces)) machine.recentWorkspaces = value.recentWorkspaces.map(String)
  return machine
}

/** Unwrap a wire result or throw its business error. */
function unwrap<T>(result: WireResult, fallback: string): T {
  if (!result.ok) throw new Error(result.error.message || fallback)
  return result.value as T
}

/** Map a machine row onto the shared form's edit initial state (secret-free). */
function editInitialOf(machine: MachineView): MachineFormInitial {
  return {
    id: machine.id,
    name: machine.label,
    host: machine.host,
    port: String(machine.port || 22),
    username: machine.username || 'root',
    workspace: machine.workspace ?? machine.cwd ?? '',
    hostKeyMode: machine.hostKeyMode ?? '',
    encryptPassword: machine.credentialBackend !== '' && machine.credentialBackend !== 'plain',
    auth: machine.auth === 'password'
      || machine.passwordSet === true
      || (machine.credentialBackend !== '' && machine.credentialBackend !== 'plain')
      ? 'password'
      : 'key',
    jumpText: machine.jumpHosts.join(', '),
  }
}

/**
 * F2: the durable save acknowledgment. The machine form's success text cannot
 * persist — the form remounts when `key={editing?.id}` changes and any in-form
 * feedback vanishes with it — so the settings page owns the banner. The
 * honest fallback marker (encryption requested, OS backend failed) rides
 * along as pure text (no live data; a `MachineSaveView` leaf).
 */
export function savedBanner(view: MachineSaveView, t: TranslateNS<'dsw'> = zhBaseline): string {
  const label = view.label || `${view.username}@${view.host}`
  const fallback = view.encryptFallback === true ? t('settings.encrypt.fallback') : ''
  return t('settings.saved', { label, fallback })
}

/** The registers page component: machine list + shared form. */
export function RemoteWorkspaceSettingsPage({ rpc, t: tSeat }: SettingsInjected & Partial<SettingsOwnerProps>): ReactNode {
  const t = tSeat ?? zhBaseline
  const [machines, setMachines] = useState<MachineView[]>([])
  const [currentId, setCurrentId] = useState('')
  const [editing, setEditing] = useState<MachineFormInitial | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      const result = await rpc('machines.list')
      const state = unwrap<{ machines: unknown; currentId: unknown }>(result, t('settings.rpc.listMachines'))
      setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m): m is MachineView => m !== null) : [])
      setCurrentId(typeof state.currentId === 'string' ? state.currentId : '')
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    }
  }
  useEffect(() => { void refresh() }, [])

  const startEdit = (machine: MachineView): void => {
    setEditing(editInitialOf(machine))
    setErr('')
    setMsg('')
  }

  const del = async (id: string): Promise<void> => {
    if (!window.confirm(t('settings.delete.confirm'))) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const result = await rpc('machines.remove', { id })
      const state = unwrap<{ machines: unknown; currentId: unknown; removed: boolean }>(result, t('settings.rpc.removeFailed'))
      setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m): m is MachineView => m !== null) : [])
      setCurrentId(typeof state.currentId === 'string' ? state.currentId : '')
      if (editing?.id === id) setEditing(null)
      setMsg(t('settings.deleted'))
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const useNow = async (id: string): Promise<void> => {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const result = await rpc('machines.setCurrent', { id })
      const state = unwrap<{ machines: unknown; currentId: unknown; ok: boolean }>(result, t('settings.rpc.switchFailed'))
      setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m): m is MachineView => m !== null) : [])
      setCurrentId(typeof state.currentId === 'string' ? state.currentId : '')
      setMsg(t('settings.setCurrent'))
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const forgetKey = async (machine: MachineView): Promise<void> => {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const result = await rpc('hostkey.forget', { id: machine.id })
      unwrap<{ ok: boolean; host: string; port: number }>(result, t('settings.rpc.forgetKeyFailed'))
      setMsg(t('settings.forgotten', { host: machine.host, port: machine.port }))
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleSaved = (view: MachineSaveView): void => {
    setEditing(null)
    setErr('')
    // F2: the page-level banner is the durable acknowledgment (the in-form
    // prompt is remounted away); it must stay visible after the refresh.
    setMsg(savedBanner(view, t))
    void refresh()
  }

  const buttonStyle: CSSProperties = {
    padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)', color: 'inherit', cursor: 'pointer', fontSize: 12,
  }
  const boxStyle: CSSProperties = {
    border: '1px solid rgba(128,128,128,0.35)', borderRadius: 8, background: 'rgba(128,128,128,0.06)', padding: 10,
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{t('settings.title')}</div>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {t('settings.description')}
      </div>

      {err !== '' ? <div style={{ color: '#e06c75', fontSize: 12 }}>{err}</div> : null}
      {msg !== '' ? <div style={{ color: '#98c379', fontSize: 12 }}>{msg}</div> : null}

      <div style={boxStyle}>
        <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>{t('settings.machines.title')}</div>
        {machines.length > 0
          ? machines.map(machine => (
            <div key={machine.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,0.25)' }}>
              <div style={{ flex: 1, fontSize: 13 }}>
                {machine.label}{' '}
                <code style={{ fontSize: 12, opacity: 0.8 }}>{machine.username}@{machine.host}:{machine.port}</code>
                <ConnStatusBadge id={machine.id} rpc={rpc} t={t} />
                {machine.credentialBackend !== '' && machine.credentialBackend !== 'plain' ? ' 🗝' : ''}
                {machine.encryptFallback === true ? <span style={{ color: '#e6c07b', fontSize: 12 }}> {t('settings.machines.encryptFallbackBadge')}</span> : ''}
                {machine.jumpHosts.length > 0 ? ' ⛳' : ''}
                {machine.id === currentId ? <span style={{ color: '#98c379', fontSize: 12 }}> {t('settings.machines.currentBadge')}</span> : null}
              </div>
              <button style={buttonStyle} onClick={() => startEdit(machine)}>{t('settings.machines.edit')}</button>
              <button style={buttonStyle} onClick={() => void del(machine.id)}>{t('settings.machines.delete')}</button>
              <button
                style={{ ...buttonStyle, whiteSpace: 'nowrap' }}
                onClick={() => void useNow(machine.id)}
                disabled={machine.id === currentId || busy}
              >{t('settings.machines.setCurrent')}</button>
              <button style={{ ...buttonStyle, whiteSpace: 'nowrap' }} onClick={() => void forgetKey(machine)}>{t('settings.machines.forgetKey')}</button>
            </div>
          ))
          : <div style={{ opacity: 0.6, fontSize: 12 }}>{t('settings.machines.empty')}</div>}
      </div>

      <div style={boxStyle}>
        <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>{editing !== null ? t('settings.form.editTitle') : t('settings.form.addTitle')}</div>
        <MachineForm
          key={editing?.id ?? 'blank'}
          mode="settings"
          rpc={rpc}
          initial={editing ?? undefined}
          t={t}
          onSaved={handleSaved}
        />
      </div>
    </div>
  )
}

export default RemoteWorkspaceSettingsPage
