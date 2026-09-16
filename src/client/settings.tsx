/**
 * Minimal remote-machine management settings page (machine registry edition):
 * machine list (edit / delete / set current / forget host key) plus the shared
 * {@link MachineForm} (mode="settings") — one form component with the flow's
 * add-connection form (R2 表单并集; see docs/ui-merge-design.md). No forwards /
 * audit / update sections — those belong to dsh-remote only and are
 * deliberately not ported.
 *
 * All data rides the package's `/dsw` RPC channel (machines.*, hostkey.forget).
 *
 * Styling lives in `settings.module.css` and resolves through the host's
 * `--dsw-*` design tokens, so the page inherits the DeepSeek Harness settings
 * vocabulary (16/24 title, 14/22 body, outlined row cards, one filled editor
 * module, capsule buttons) and follows the dark theme automatically. The page
 * renders inside the host panel's `.options` area and therefore adds no outer
 * padding or surface of its own — see the stylesheet header.
 * @module dsh-workspace-enhancement/settings
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WireResult } from './index.ts'
import { MachineForm } from './machine-form.tsx'
import type { MachineFormInitial, MachineSaveView } from './machine-form.tsx'
import type { RemoteApprovalMode, RemoteSandboxMode } from './machine-payload.ts'
import { ConnStatusBadge, zhBaseline } from './status.tsx'
import { coreStatusLabel } from './core-status.ts'
import type { CoreStatusPayload } from './core-status.ts'
import { AlertIcon, CheckIcon, ChevronIcon } from './icons.tsx'
import styles from './settings.module.css'
// The control vocabulary (capsule buttons, 32px fields) is owned by the form
// stylesheet, which the editor hosted below already renders with — reusing it
// here is what keeps the row actions and the form actions identical.
import form from './machine-form.module.css'

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
  /** AUDIT-6 approval-gate mode (wire rows always carry it; default 'off'). */
  remoteApproval: RemoteApprovalMode
  /** REQ-I9 remote sandbox fence mode (wire rows carry it; default 'off'). */
  remoteSandbox: RemoteSandboxMode
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
    remoteApproval: value.remoteApproval === 'human' || value.remoteApproval === 'ai' ? value.remoteApproval : 'off',
    remoteSandbox: value.remoteSandbox === 'read-only' || value.remoteSandbox === 'workspace-write' ? value.remoteSandbox : 'off',
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
    remoteApproval: machine.remoteApproval ?? 'off',
    remoteSandbox: machine.remoteSandbox ?? 'off',
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

/** Core-status tone, so the chip can carry the host's semantic state color. */
export type CoreTone = 'ok' | 'warn' | 'error'

/** One machine's last core status: copy + the tone its chip renders in. */
export interface CoreLine {
  label: string
  tone: CoreTone
}

/**
 * Tone of a core.status / core.deploy payload: `ok` for a live core,
 * `warn` for a machine whose architecture has no fenced core, and `error`
 * for a plain failure or an RPC throw.
 */
export function coreToneOf(view: CoreStatusPayload): CoreTone {
  if (view.ok === true) return 'ok'
  const detail = typeof view.detail === 'string' ? view.detail : ''
  return /linux|x86_64|amd64|uname/i.test(detail) ? 'warn' : 'error'
}

const CORE_TONE_CLASS: Record<CoreTone, string | undefined> = {
  ok: styles.coreChipOk,
  warn: styles.coreChipWarn,
  error: styles.coreChipError,
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
  const [coreLines, setCoreLines] = useState<Record<string, CoreLine>>({})
  const [moreOpen, setMoreOpen] = useState('')

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
    setMoreOpen('')
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
    setMoreOpen('')
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
    setMoreOpen('')
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

  const refreshCore = async (id: string): Promise<void> => {
    setMoreOpen('')
    try {
      const result = await rpc('core.status', { id })
      const view = unwrap<CoreStatusPayload>(result, t('settings.rpc.coreStatusFailed'))
      setCoreLines(current => ({ ...current, [id]: { label: coreStatusLabel(view, t), tone: coreToneOf(view) } }))
    } catch (error) {
      setCoreLines(current => ({
        ...current,
        [id]: { label: error instanceof Error ? error.message : String(error), tone: 'error' },
      }))
    }
  }

  const deployCore = async (id: string): Promise<void> => {
    setBusy(true)
    setErr('')
    setMsg('')
    setMoreOpen('')
    try {
      const result = await rpc('core.deploy', { id })
      const view = unwrap<CoreStatusPayload>(result, t('settings.rpc.coreDeployFailed'))
      const line: CoreLine = { label: coreStatusLabel(view, t), tone: coreToneOf(view) }
      setCoreLines(current => ({ ...current, [id]: line }))
      setMsg(line.label)
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

  return (
    <div className={styles.section}>
      <h1 className={styles.title}>{t('settings.title')}</h1>
      <p className={styles.intro}>{t('settings.description')}</p>

      {err !== '' ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <AlertIcon className={styles.bannerIcon} />
          <span>{err}</span>
        </div>
      ) : null}
      {msg !== '' ? (
        <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status">
          <CheckIcon className={styles.bannerIcon} />
          <span>{msg}</span>
        </div>
      ) : null}

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>{t('settings.machines.title')}</h2>
        {machines.length > 0
          ? (
            <ul className={styles.rows}>
              {machines.map(machine => {
                const isCurrent = machine.id === currentId
                const core = coreLines[machine.id]
                return (
                  <li key={machine.id} className={styles.rowCard}>
                    <div className={styles.rowHead}>
                      <div className={styles.rowIdentity}>
                        <span className={styles.rowName}>{machine.label}</span>
                        {/* Configured traits ride with the name; live state and the
                            endpoint belong to the facts line below, so the action
                            cluster always keeps its place on the first line. */}
                        {machine.credentialBackend !== '' && machine.credentialBackend !== 'plain'
                          ? <span className={styles.rowTag}>{t('settings.machines.keychainBadge')}</span>
                          : null}
                        {machine.jumpHosts.length > 0
                          ? <span className={styles.rowTag}>{t('settings.machines.jumpBadge', { count: machine.jumpHosts.length })}</span>
                          : null}
                        {isCurrent ? <span className={styles.rowTag}>{t('settings.machines.currentBadge')}</span> : null}
                      </div>

                      <div className={styles.rowActions}>
                        {!isCurrent && (
                          <button
                            type="button"
                            className={`${form.secondaryButton} ${form.small}`}
                            disabled={busy}
                            onClick={() => void useNow(machine.id)}
                          >{t('settings.machines.setCurrent')}</button>
                        )}
                        <button
                          type="button"
                          className={`${form.secondaryButton} ${form.small}`}
                          disabled={busy}
                          onClick={() => startEdit(machine)}
                        >{t('settings.machines.edit')}</button>

                        <details
                          className={styles.more}
                          open={moreOpen === machine.id}
                          onToggle={event => {
                            const isOpen = (event.currentTarget as HTMLDetailsElement).open
                            setMoreOpen(current => (isOpen ? machine.id : current === machine.id ? '' : current))
                          }}
                        >
                          <summary
                            className={`${form.secondaryButton} ${form.small} ${styles.moreSummary} ${moreOpen === machine.id ? styles.moreSummaryOpen : ''}`}
                            aria-label={t('settings.machines.more')}
                          >
                            {t('settings.machines.more')}
                            <ChevronIcon className={styles.moreChevron} width={12} height={12} />
                          </summary>
                          <div className={styles.moreMenu} role="menu">
                            <button type="button" role="menuitem" className={styles.moreItem} disabled={busy}
                              onClick={() => void forgetKey(machine)}>{t('settings.machines.forgetKey')}</button>
                            <button type="button" role="menuitem" className={styles.moreItem} disabled={busy}
                              onClick={() => void refreshCore(machine.id)}>{t('settings.machines.coreStatus')}</button>
                            <button type="button" role="menuitem" className={styles.moreItem} disabled={busy}
                              onClick={() => void deployCore(machine.id)}>{t('settings.machines.deployCore')}</button>
                            <div className={styles.moreSep} />
                            <button type="button" role="menuitem"
                              className={`${styles.moreItem} ${styles.moreItemDanger}`}
                              disabled={busy}
                              onClick={() => void del(machine.id)}>{t('settings.machines.delete')}</button>
                          </div>
                        </details>
                      </div>
                    </div>

                    <div className={styles.rowMeta}>
                      <ConnStatusBadge id={machine.id} rpc={rpc} t={t} />
                      <span className={styles.rowEndpoint}>{machine.username}@{machine.host}:{machine.port}</span>
                      {machine.encryptFallback === true
                        ? <span className={`${styles.coreChip} ${styles.coreChipWarn}`}>{t('settings.machines.encryptFallbackBadge')}</span>
                        : null}
                      {machine.remoteApproval !== 'off'
                        ? <span className={styles.coreChip}>{t('settings.machines.gateBadge', { mode: machine.remoteApproval })}</span>
                        : null}
                      {core !== undefined
                        ? <span className={`${styles.coreChip} ${CORE_TONE_CLASS[core.tone]}`} role="status">{core.label}</span>
                        : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )
          : <p className={styles.empty}>{t('settings.machines.empty')}</p>}
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>
          {editing !== null ? t('settings.form.editTitle') : t('settings.form.addTitle')}
        </h2>
        <div className={styles.editor}>
          {editing !== null
            ? <div className={styles.editorHead}><span className={styles.editorNote}>{t('settings.form.editNote')}</span></div>
            : null}
          <MachineForm
            key={editing?.id ?? 'blank'}
            mode="settings"
            rpc={rpc}
            initial={editing ?? undefined}
            t={t}
            onSaved={handleSaved}
          />
        </div>
      </section>
    </div>
  )
}

export default RemoteWorkspaceSettingsPage
