/**
 * The shared machine/connection form (R2 表单并集): the union of the settings
 * page「添加服务器」form and the add-workspace flow's「新建连接」form — one
 * component, one field set, one interaction set; only the submit action
 * differs by `mode`.
 *
 * Union surface (docs/ui-merge-design.md §2): 主机名/别名（失焦/粘贴自动解析 +
 * 「识别 ssh 配置 ▾」精确别名下拉）、端口、用户名（预填 root）、名称（默认
 * user@host，留空由宿主回退）、默认工作区、认证 tabs（私钥文件/密码；切换
 * 不清空对方）、私钥路径（编辑留空=保持不变，P2-④）、私钥口令、密码（编辑
 * 留空=不变）、高级折叠区（加密保存密码 checkbox——认证=密码时显示；HostKey
 * 模式 select；跳板链文本 + 实时校验摘要 + 清除 + 提交时坏段阻止保存，P2-②）、
 * 测试连接（loading + 结果）、保存（同步 busy 守卫防双击双发，P2-③）。
 *
 * `mode='settings'`：保存后清空表单 + 成功提示（banner 保留）；`mode='flow'`：
 * 保存按钮文案「保存并浏览」，成功后通过 `onSaved(view)` 交给外壳切换目录浏览。
 * Payload 唯一出口是 {@link module:dsh-workspace-enhancement/client/machine-payload}
 * 的 machinePayload（含跳板链）；测试连接走 machines.test；服务端零改动。
 * 全部样式内联、中文标签；无新依赖。
 * @module dsh-workspace-enhancement/client/machine-form
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RpcCall } from './status.tsx'
import { zhBaseline } from './status.tsx'
import { machinePayload } from './machine-payload.ts'
import type { MachineFormState, RemoteApprovalMode, RemoteSandboxMode } from './machine-payload.ts'
import { AlertIcon, CheckIcon, ChevronIcon, SpinnerIcon } from './icons.tsx'
import styles from './machine-form.module.css'

/** One manual or resolved ProxyJump hop. */
export interface JumpInput {
  host: string
  port?: number
  username?: string
  privateKeyPath?: string
  agent?: string
}

/** The Host's `~/.ssh/config` resolution result (wire shape of `connections.resolve`). */
export interface ResolvedSshConfigView {
  host: string
  username: string
  port: number
  privateKeyPaths: string[]
  jump: JumpInput[]
  alias: string
}

/** One `~/.ssh/config` Host alias row (`config.hosts`). */
export interface ConfigHostView {
  alias: string
  host: string
  username: string
  port: number
  identityFile: boolean
  jump: boolean
}

/** Prefilled form state (settings edit / flow config-host draft). */
export interface MachineFormInitial {
  id?: string
  name?: string
  host?: string
  port?: string
  username?: string
  privateKeyPath?: string
  passphrase?: string
  workspace?: string
  hostKeyMode?: '' | 'accept-new' | 'verify' | 'off'
  /** AUDIT-6 approval-gate mode (edit prefills the stored value). */
  remoteApproval?: RemoteApprovalMode
  /** REQ-I9 remote sandbox fence mode (edit prefills the stored value). */
  remoteSandbox?: RemoteSandboxMode
  encryptPassword?: boolean
  jumpText?: string
  /** Preferred auth tab ('password' when the machine records password auth). */
  auth?: 'password' | 'key'
  /** Focus the username field on open (config host missing its user). */
  focusUsername?: boolean
}

/** The saved machine's minimal view handed back to the shell. */
export interface MachineSaveView {
  id: string
  label: string
  host: string
  port: number
  username: string
  /** Encryption was requested but fell back to plaintext (honest marker). */
  encryptFallback?: boolean
}

/** The shell's `/dsw` RPC face (same channel shape as the flow/settings inject). */
export type MachineFormRpc = RpcCall

export interface MachineFormProps {
  mode: 'settings' | 'flow'
  rpc: MachineFormRpc
  initial?: MachineFormInitial | undefined
  /** Typed translate seat (threaded by the shells; defaults to the zh baseline). */
  t?: TranslateNS<'dsw'>
  /** Save succeeded (the view's id drives the flow's browse switch / list refresh). */
  onSaved(view: MachineSaveView): void
  /** Flow: the surrounding modal also offers 取消. */
  onCancel?: (() => void) | undefined
}

/** Typed feedback shown above the actions. */
interface Feedback {
  kind: 'info' | 'success' | 'error'
  text: string
}

type BusyTask = 'config' | 'resolve' | 'test' | 'save' | null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Parse a `[user@]host[:port]` jump list (comma/space separated). */
export function parseJumpText(text: string): JumpInput[] {
  const entries = text.split(/[\s,]+/).map(entry => entry.trim()).filter(entry => entry !== '')
  return entries.map((entry): JumpInput => {
    let rest = entry
    let username: string | undefined
    let port: number | undefined
    const at = rest.lastIndexOf('@')
    if (at >= 0) {
      username = rest.slice(0, at)
      rest = rest.slice(at + 1)
    }
    const colon = rest.lastIndexOf(':')
    if (colon >= 0) {
      const parsed = Number(rest.slice(colon + 1))
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
        port = parsed
        rest = rest.slice(0, colon)
      }
    }
    return {
      host: rest,
      ...(port !== undefined ? { port } : {}),
      ...(username !== undefined && username !== '' ? { username } : {}),
    }
  })
}

/** Render one resolved hop as `user@host:port` (defaults hidden). */
export function formatHop(hop: JumpInput): string {
  return `${hop.username !== undefined && hop.username !== '' ? `${hop.username}@` : ''}${hop.host}${hop.port !== undefined && hop.port !== 22 ? `:${String(hop.port)}` : ''}`
}

/** Realtime jump summary: `3 · user@b1 → host:2202`, or the bad-input hint. */
export function jumpSummaryOf(text: string, t: TranslateNS<'dsw'> = zhBaseline): string {
  const hops = parseJumpText(text)
  if (hops.length === 0) return ''
  if (hops.some(hop => hop.host.trim() === '')) return t('form.jump.unresolved')
  const joined = hops.map(formatHop).join(' → ')
  return hops.length === 1
    ? t('form.jump.summaryOne', { count: hops.length, hops: joined })
    : t('form.jump.summary', { count: hops.length, hops: joined })
}

/**
 * P2-②: submit-time jump validation. A non-empty jump text that cannot be
 * parsed into hosts is a hard error — the payload must never silently drop
 * the chain (the old code sent no `jump` when a segment was malformed while
 * the summary already warned). Returns the error text, or null when the jump
 * is absent or fully parseable.
 */
export function jumpErrorOf(text: string, t: TranslateNS<'dsw'> = zhBaseline): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const hops = parseJumpText(trimmed)
  if (hops.length === 0 || hops.some(hop => hop.host.trim() === '')) {
    return t('form.jump.unresolvedHint')
  }
  return null
}

/**
 * t8: the jump chain to put on the wire. A non-empty text parses to its hops.
 * An EMPTY text during an EDIT whose machine HAD a jump chain (the
 * secret-free initial knows only its `jumpText`) yields `[]` — the explicit
 * clear, because an omitted chain keeps the stored one and the operator must
 * be able to REMOVE the chain. A new machine, or an edit of one that never
 * had a chain, yields undefined (omit = no jump). The wire builder
 * (machinePayload) serializes `[]` as-is.
 */
export function jumpChainOf(
  text: string,
  isEdit: boolean,
  hadJumpText: string | undefined,
): JumpInput[] | undefined {
  const jumped = parseJumpText(text)
  if (jumped.length > 0) return jumped
  return isEdit && (hadJumpText ?? '').trim() !== '' ? [] : undefined
}

/**
 * P2-③: synchronous busy gate. `busy` state turns the buttons `disabled` only
 * after a re-render, so two clicks in one tick both pass the `disabled` check
 * and double-send; the gate flips synchronously on claim and clears in
 * `finally`, which closes that window. Only the current owner may release, so
 * an overlapping operation (resolve/test/save) can never clear another one's
 * busy state — the old code let a late resolve's `finally` re-enable the
 * buttons while a save was still in flight.
 */
export function createActionGate(): {
  /** Whether any action currently owns the form (sync — no re-render needed). */
  busy(): boolean
  /** Claim the form; false when another action owns it. */
  claim(task: Exclude<BusyTask, null>): boolean
  /** Release the form when this task still owns it; false otherwise. */
  release(task: Exclude<BusyTask, null>): boolean
} {
  let owner: Exclude<BusyTask, null> | null = null
  return {
    busy: () => owner !== null,
    claim(task) {
      if (owner !== null) return false
      owner = task
      return true
    },
    release(task) {
      if (owner !== task) return false
      owner = null
      return true
    },
  }
}

/** The one-line resolve summary: alias → user@host:port · identity · jumps. */
export function formatResolvedSummary(resolved: ResolvedSshConfigView, t: TranslateNS<'dsw'> = zhBaseline): string {
  const endpoint = `${resolved.username !== '' ? `${resolved.username}@` : ''}${resolved.host}${resolved.port !== 22 ? `:${String(resolved.port)}` : ''}`
  const parts: string[] = []
  if (resolved.alias.toLowerCase() !== resolved.host.toLowerCase()) parts.push(`${resolved.alias} → ${endpoint}`)
  else parts.push(endpoint)
  if (resolved.privateKeyPaths[0] !== undefined) parts.push(t('form.resolve.privateKey', { path: resolved.privateKeyPaths[0] as string }))
  if (resolved.jump.length > 0) parts.push(t('form.resolve.jump', { hops: resolved.jump.map(formatHop).join(' → ') }))
  return parts.join(' · ')
}

/** Structural check of a `connections.resolve` result. */
function asResolved(value: unknown): ResolvedSshConfigView {
  const record = isRecord(value) ? value : {}
  const jump = Array.isArray(record.jump) ? record.jump.filter(isRecord).map(hop => ({
    host: String(hop.host ?? ''),
    ...(typeof hop.port === 'number' ? { port: hop.port } : {}),
    ...(typeof hop.username === 'string' && hop.username !== '' ? { username: hop.username } : {}),
  })) : []
  return {
    host: String(record.host ?? ''),
    username: String(record.username ?? ''),
    port: typeof record.port === 'number' ? record.port : 22,
    privateKeyPaths: Array.isArray(record.privateKeyPaths)
      ? record.privateKeyPaths.filter((path): path is string => typeof path === 'string')
      : [],
    jump,
    alias: String(record.alias ?? ''),
  }
}

/** Structural check of one machine save result (`machines.add`/`saveMachine`). */
export function asSaveView(value: unknown): MachineSaveView | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id === '') return null
  return {
    id: value.id,
    label: typeof value.label === 'string' ? value.label : String(value.host ?? ''),
    host: typeof value.host === 'string' ? value.host : '',
    port: typeof value.port === 'number' ? value.port : 22,
    username: typeof value.username === 'string' ? value.username : '',
    ...(value.encryptFallback === true ? { encryptFallback: true } : {}),
  }
}

function asConfigHosts(value: unknown): ConfigHostView[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map(record => ({
    alias: String(record.alias ?? ''),
    host: String(record.host ?? ''),
    username: String(record.username ?? ''),
    port: typeof record.port === 'number' ? record.port : 22,
    identityFile: record.identityFile === true,
    jump: record.jump === true,
  })).filter(host => host.alias !== '')
}

interface FieldErrors {
  host?: string
  port?: string
  username?: string
}

/**
 * Stable ids so every label is programmatically tied to its control — the
 * stacked-label layout has no wrapper to imply the association, and the
 * settings page can host two instances across a machine-list rerender.
 */
const FIELD_IDS = {
  host: 'dsw-field-host',
  port: 'dsw-field-port',
  username: 'dsw-field-username',
  name: 'dsw-field-name',
  workspace: 'dsw-field-workspace',
  keyPath: 'dsw-field-key-path',
  passphrase: 'dsw-field-passphrase',
  password: 'dsw-field-password',
  hostKey: 'dsw-field-hostkey',
  remoteApproval: 'dsw-field-approval',
  jump: 'dsw-field-jump',
} as const

/** The shared form body: fields + feedback + actions (no modal shell). */
export function MachineForm({ mode, rpc, initial, onSaved, onCancel, t: tSeat }: MachineFormProps): ReactNode {
  const t = tSeat ?? zhBaseline
  const initialState = (): MachineFormState => ({
    id: initial?.id ?? '',
    name: initial?.name ?? '',
    host: initial?.host ?? '',
    port: initial?.port ?? '22',
    username: initial?.username ?? 'root',
    password: '',
    privateKeyPath: initial?.privateKeyPath ?? '',
    passphrase: initial?.passphrase ?? '',
    workspace: initial?.workspace ?? '',
    hostKeyMode: initial?.hostKeyMode ?? '',
    encryptPassword: initial?.encryptPassword ?? false,
    remoteApproval: initial?.remoteApproval ?? 'off',
    remoteSandbox: initial?.remoteSandbox ?? 'off',
  })
  const [form, setForm] = useState<MachineFormState>(initialState)
  // F3: an edit of a password/keychain machine (recorded via `auth`, or a
  // keychain-flagged initial) must open the 密码 tab first — the operator sees
  // the password field and the keychain switch without hunting the segment; a
  // key machine still defaults to the 私钥文件 tab.
  const [authKind, setAuthKind] = useState<'password' | 'key'>(
    initial?.auth ?? (initial?.encryptPassword === true ? 'password' : 'key'),
  )
  const [jumpText, setJumpText] = useState(initial?.jumpText ?? '')
  const [advanced, setAdvanced] = useState(
    (initial?.hostKeyMode !== undefined && initial.hostKeyMode !== '')
    || (initial?.jumpText !== undefined && initial.jumpText !== '')
    || initial?.encryptPassword === true
    || (initial?.remoteApproval !== undefined && initial.remoteApproval !== 'off')
    || (initial?.remoteSandbox !== undefined && initial.remoteSandbox !== 'off'),
  )
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyTask, setBusyTask] = useState<BusyTask>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [resolveSummary, setResolveSummary] = useState<ResolvedSshConfigView | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [configList, setConfigList] = useState<ConfigHostView[] | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  const usernameRef = useRef<HTMLInputElement | null>(null)
  const autoGeneration = useRef(0)
  const lastAutoHost = useRef<string | null>(null)
  // P2-③: the synchronous busy gate (claim before any await, release in finally).
  const actionGate = useRef(createActionGate()).current

  useEffect(() => {
    if (initial?.focusUsername === true) usernameRef.current?.focus()
  }, [initial?.focusUsername])

  const errorsOf = (): FieldErrors => {
    const errors: FieldErrors = {}
    if (form.host.trim() === '') errors.host = t('form.error.host')
    const portText = form.port.trim()
    if (portText === '') errors.port = t('form.error.required')
    else if (!/^\d+$/.test(portText)) errors.port = t('form.error.port.number')
    else {
      const parsed = Number(portText)
      if (parsed < 1 || parsed > 65535) errors.port = t('form.error.port.range')
    }
    if (form.username.trim() === '') errors.username = t('form.error.username')
    return errors
  }
  const errorOf = (key: keyof FieldErrors): string | undefined => (revealed ? errorsOf()[key] : undefined)

  /** Prefill every field the resolution covers; keep operator edits elsewhere. */
  const applyResolved = (resolved: ResolvedSshConfigView, currentCwd: string, currentUser: string): void => {
    setForm(prev => ({
      ...prev,
      host: resolved.host,
      ...(resolved.port !== 22 ? { port: String(resolved.port) } : {}),
      ...(resolved.username !== '' ? { username: resolved.username } : {}),
      ...(resolved.privateKeyPaths[0] !== undefined ? { privateKeyPath: resolved.privateKeyPaths[0] as string } : {}),
      ...(currentCwd.trim() === '' && (resolved.username !== '' ? resolved.username : currentUser).trim() !== ''
        ? { workspace: `/home/${(resolved.username !== '' ? resolved.username : currentUser).trim()}` }
        : {}),
    }))
    if (resolved.privateKeyPaths.length > 0) setAuthKind('key')
    setJumpText(resolved.jump.map(formatHop).join(', '))
    setResolveSummary(resolved)
  }

  /**
   * Silent alias resolution for blur/paste: no validation reveal, no error
   * surface, never disables the form. Guarded by its own generation counter
   * so a stale answer cannot clobber a newer edit.
   */
  const autoResolve = async (value: string): Promise<void> => {
    const hostText = value.trim()
    if (hostText === '' || actionGate.busy()) return
    if (lastAutoHost.current === hostText) return
    lastAutoHost.current = hostText
    const current = autoGeneration.current += 1
    setAutoBusy(true)
    try {
      const result = await rpc('connections.resolve', { host: hostText })
      if (!result.ok) return
      const resolved = asResolved(result.value)
      if (current !== autoGeneration.current) return
      applyResolved(resolved, form.workspace, form.username)
    } catch {
      // Silent by design; the manual list/button reports the error.
    } finally {
      if (current === autoGeneration.current) setAutoBusy(false)
    }
  }

  const resolveExplicit = async (alias: string, expectedCount = 0): Promise<void> => {
    if (!actionGate.claim('resolve')) return
    const current = autoGeneration.current += 1
    setAutoBusy(false)
    setBusy(true)
    setBusyTask('resolve')
    setFeedback({ kind: 'info', text: t('form.config.reading') })
    try {
      const result = await rpc('connections.resolve', { host: alias.trim() })
      if (!result.ok) throw new Error(result.error.message)
      const resolved = asResolved(result.value)
      if (current !== autoGeneration.current) return
      lastAutoHost.current = resolved.host
      applyResolved(resolved, form.workspace, form.username)
      setFeedback({
        kind: 'success',
        text: t('form.config.resolved', { alias: resolved.alias, endpoint: `${resolved.username !== '' ? `${resolved.username}@` : ''}${resolved.host}${resolved.port !== 22 ? `:${String(resolved.port)}` : ''}` }),
      })
      if (expectedCount > 0) setConfigList(previous => previous === null ? previous : previous.filter(host => host.alias !== alias))
    } catch (error) {
      setFeedback({ kind: 'error', text: t('form.config.resolveFailed', { message: error instanceof Error ? error.message : String(error) }) })
    } finally {
      if (actionGate.release('resolve')) {
        setBusy(false)
        setBusyTask(null)
      }
    }
  }

  const toggleConfigList = async (): Promise<void> => {
    if (configOpen) {
      setConfigOpen(false)
      return
    }
    setConfigOpen(true)
    if (configList !== null) return
    setConfigBusy(true)
    setConfigError(null)
    try {
      const result = await rpc('config.hosts')
      if (!result.ok) throw new Error(result.error.message)
      setConfigList(asConfigHosts(result.value))
    } catch (error) {
      setConfigList([])
      setConfigError(error instanceof Error ? error.message : String(error))
    } finally {
      setConfigBusy(false)
    }
  }

  /**
   * The wire payload. P2-②: submissions validate the jump chain before this
   * runs (`jumpErrorOf`), so a malformed segment can no longer be silently
   * dropped — the parsed chain is always passed through verbatim. t8:
   * `jumpChainOf` turns an emptied chain on an edit that previously had one
   * into the explicit `jump: []` clear (an omitted chain would keep it).
   */
  const payload = (): Record<string, unknown> => {
    return machinePayload(form, jumpChainOf(jumpText, form.id !== '', initial?.jumpText))
  }

  const runTest = async (): Promise<void> => {
    if (!actionGate.claim('test')) return
    try {
      setRevealed(true)
      setConfigOpen(false)
      const jumpError = jumpErrorOf(jumpText, t)
      if (jumpError !== null) {
        setFeedback({ kind: 'error', text: jumpError })
        return
      }
      const input = payload()
      if (form.host.trim() === '') {
        setFeedback({ kind: 'error', text: t('form.test.noHost') })
        return
      }
      const editing = form.id !== ''
      if (authKind === 'password' && input.password === undefined && !editing) {
        setFeedback({ kind: 'error', text: t('form.test.noPassword') })
        return
      }
      if (authKind === 'key' && (input.privateKeyPath === undefined || input.privateKeyPath === '')) {
        // P2-④: an edit cannot show the stored key path; the host keeps it
        // when the payload omits it — only a brand-new machine must carry one.
        if (!editing) {
          setFeedback({ kind: 'error', text: t('form.test.noKey') })
          return
        }
      }
      setBusy(true)
      setBusyTask('test')
      setFeedback({ kind: 'info', text: t('form.test.testing') })
      try {
        const result = await rpc('machines.test', input)
        setFeedback(result.ok
          ? { kind: 'success', text: t('form.test.success') }
          : { kind: 'error', text: t('form.test.failed', { message: result.error.message }) })
      } catch (error) {
        setFeedback({ kind: 'error', text: t('form.test.error', { message: error instanceof Error ? error.message : String(error) }) })
      }
    } finally {
      if (actionGate.release('test')) {
        setBusy(false)
        setBusyTask(null)
      }
    }
  }

  const runSave = async (): Promise<void> => {
    if (!actionGate.claim('save')) return
    try {
      setRevealed(true)
      setConfigOpen(false)
      const found = errorsOf()
      if (found.host !== undefined || found.port !== undefined || found.username !== undefined) {
        setFeedback({ kind: 'error', text: t('form.save.incomplete') })
        return
      }
      const jumpError = jumpErrorOf(jumpText, t)
      if (jumpError !== null) {
        setFeedback({ kind: 'error', text: jumpError })
        return
      }
      setBusy(true)
      setBusyTask('save')
      setFeedback({ kind: 'info', text: t('form.save.saving') })
      try {
        const result = await rpc('machines.add', payload())
        if (!result.ok) throw new Error(result.error.message)
        const raw = isRecord(result.value) ? (result.value as Record<string, unknown>).machine : undefined
        const machineRecord = isRecord(raw) ? raw : null
        const view = asSaveView(machineRecord)
        if (view === null) throw new Error(t('form.save.missingId'))
        // R1 保持：加密请求落在明文回退时要明说（honest marker）。
        const fallbackHint = machineRecord?.encryptFallback === true
          ? t('form.encrypt.fallback')
          : ''
        if (mode === 'settings') {
          setForm(initialState)
          setJumpText('')
          setAuthKind('key')
          setResolveSummary(null)
          setAdvanced(false)
          // F2: the success acknowledgment lives at the page level (the form
          // remounts on `key={editing?.id}` change and any in-form text would
          // vanish); only a stale pre-save feedback is cleared here.
          setFeedback(null)
        }
        onSaved({ ...view, ...(fallbackHint !== '' ? { encryptFallback: true } : {}) })
      } catch (error) {
        setFeedback({ kind: 'error', text: t('form.save.failed', { message: error instanceof Error ? error.message : String(error) }) })
      }
    } finally {
      if (actionGate.release('save')) {
        setBusy(false)
        setBusyTask(null)
      }
    }
  }

  const resetForm = (): void => {
    if (actionGate.busy()) return
    setForm(initialState)
    setJumpText(initial?.jumpText ?? '')
    setAuthKind(initial?.auth ?? 'key')
    setAdvanced(false)
    setResolveSummary(null)
    setFeedback(null)
    setRevealed(false)
  }

  const jumpSummary = jumpSummaryOf(jumpText, t)
  const hostError = errorOf('host')
  const portError = errorOf('port')
  const usernameError = errorOf('username')
  const saveLabel = mode === 'flow' ? t('form.save.flowLabel') : t('form.save.settingsLabel')

  // `noUncheckedIndexedAccess` types a CSS-module lookup as `string | undefined`;
  // the className prop accepts that, so the helper returns the lookup verbatim.
  const inputClass = (invalid: boolean): string | undefined =>
    invalid ? `${styles.input} ${styles.inputInvalid}` : styles.input

  return (
    <div className={styles.form}>
      {/* ---------------------------------------------------------- host */}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={FIELD_IDS.host}>
          {t('form.label.host')}<span className={styles.required}>*</span>
        </label>
        <div className={styles.hostRow}>
          <input
            id={FIELD_IDS.host}
            className={inputClass(hostError !== undefined)}
            value={form.host}
            placeholder={t('form.placeholder.host')}
            disabled={busy}
            aria-invalid={hostError !== undefined}
            onChange={event => {
              setForm(prev => ({ ...prev, host: event.target.value }))
              setResolveSummary(null)
              lastAutoHost.current = null
            }}
            onBlur={() => { void autoResolve(form.host) }}
            onPaste={event => {
              const text = event.clipboardData.getData('text')
              if (text.trim() !== '') void autoResolve(text)
            }}
          />
          <button
            type="button"
            className={`${styles.secondaryButton} ${styles.small}`}
            disabled={busy}
            aria-expanded={configOpen}
            onClick={() => { void toggleConfigList() }}
          >
            {t('form.config.recognize')}
            <ChevronIcon
              className={configOpen ? `${styles.pickerChevron} ${styles.pickerChevronOpen}` : styles.pickerChevron}
              width={12}
              height={12}
            />
          </button>
        </div>
        {autoBusy && (
          <span className={styles.busyHint} role="status">
            <SpinnerIcon className={styles.configSpinner} width={13} height={13} />
            {t('form.config.matching')}
          </span>
        )}
        {hostError !== undefined && <span className={styles.invalid}>{hostError}</span>}
        <span className={styles.hint}>{t('form.config.hint')}</span>
      </div>

      {configOpen && (
        <div className={styles.configList}>
          {configBusy
            ? <div className={styles.configEmpty}>{t('form.config.reading')}</div>
            : configError !== null
              ? <div className={styles.configEmpty}>{configError}</div>
              : (configList ?? []).length === 0
                ? <div className={styles.configEmpty}>{t('form.config.empty')}</div>
                : (configList ?? []).map(host => (
                  <button
                    key={host.alias}
                    type="button"
                    className={styles.configOption}
                    disabled={busy}
                    onClick={() => { void resolveExplicit(host.alias, (configList ?? []).length) }}
                  >
                    <span className={styles.configAlias}>{host.alias}</span>
                    <span className={styles.configArrow}>→</span>
                    <span className={styles.configTarget}>
                      {host.host}{host.username !== '' ? ` (${host.username})` : ''}
                    </span>
                    {host.identityFile ? <span className={styles.configBadge}>{t('form.config.badge.key')}</span> : null}
                    {host.jump ? <span className={styles.configBadge}>{t('form.config.badge.jump')}</span> : null}
                  </button>
                ))}
        </div>
      )}

      {resolveSummary !== null && (
        <div className={`${styles.feedback} ${styles.feedbackSuccess}`} role="status">
          <CheckIcon className={styles.feedbackIcon} />
          <span>{formatResolvedSummary(resolveSummary, t)}</span>
        </div>
      )}

      {/* ------------------------------------------------- port + username */}
      <div className={styles.pairPort}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={FIELD_IDS.port}>
            {t('form.label.port')}<span className={styles.required}>*</span>
          </label>
          <input
            id={FIELD_IDS.port}
            className={inputClass(portError !== undefined)}
            value={form.port}
            inputMode="numeric"
            disabled={busy}
            aria-invalid={portError !== undefined}
            onChange={event => { setForm(prev => ({ ...prev, port: event.target.value })) }}
          />
          {portError !== undefined && <span className={styles.invalid}>{portError}</span>}
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={FIELD_IDS.username}>
            {t('form.label.username')}<span className={styles.required}>*</span>
          </label>
          <input
            id={FIELD_IDS.username}
            ref={usernameRef}
            className={inputClass(usernameError !== undefined)}
            value={form.username}
            disabled={busy}
            aria-invalid={usernameError !== undefined}
            onChange={event => { setForm(prev => ({ ...prev, username: event.target.value })) }}
          />
          {usernameError !== undefined && <span className={styles.invalid}>{usernameError}</span>}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={FIELD_IDS.name}>{t('form.label.name')}</label>
        <input
          id={FIELD_IDS.name}
          className={styles.input}
          value={form.name}
          placeholder={t('form.placeholder.name')}
          disabled={busy}
          onChange={event => { setForm(prev => ({ ...prev, name: event.target.value })) }}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={FIELD_IDS.workspace}>{t('form.label.workspace')}</label>
        <input
          id={FIELD_IDS.workspace}
          className={styles.input}
          value={form.workspace}
          placeholder={t('form.placeholder.workspace')}
          disabled={busy}
          onChange={event => { setForm(prev => ({ ...prev, workspace: event.target.value })) }}
        />
      </div>

      {/* ------------------------------------------------------ auth tabs */}
      <div className={styles.field}>
        <span className={styles.fieldLabel} id="dsw-auth-label">{t('form.label.auth')}</span>
        <div className={styles.segmented} role="radiogroup" aria-labelledby="dsw-auth-label">
          <button
            type="button"
            role="radio"
            aria-checked={authKind === 'key'}
            className={authKind === 'key' ? `${styles.segment} ${styles.segmentOn}` : styles.segment}
            disabled={busy}
            onClick={() => { setAuthKind('key') }}
          >{t('form.auth.keyTab')}</button>
          <button
            type="button"
            role="radio"
            aria-checked={authKind === 'password'}
            className={authKind === 'password' ? `${styles.segment} ${styles.segmentOn}` : styles.segment}
            disabled={busy}
            onClick={() => { setAuthKind('password') }}
          >{t('form.auth.passwordTab')}</button>
        </div>

        {authKind === 'key' ? (
          <>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={FIELD_IDS.keyPath}>{t('form.label.keyPath')}</label>
              <input
                id={FIELD_IDS.keyPath}
                className={styles.input}
                value={form.privateKeyPath}
                placeholder={t('form.placeholder.keyPath')}
                disabled={busy}
                onChange={event => { setForm(prev => ({ ...prev, privateKeyPath: event.target.value })) }}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={FIELD_IDS.passphrase}>{t('form.label.keyPassphrase')}</label>
              <input
                id={FIELD_IDS.passphrase}
                type="password"
                className={styles.input}
                value={form.passphrase}
                disabled={busy}
                onChange={event => { setForm(prev => ({ ...prev, passphrase: event.target.value })) }}
              />
            </div>
          </>
        ) : (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={FIELD_IDS.password}>{t('form.auth.passwordTab')}</label>
            <input
              id={FIELD_IDS.password}
              type="password"
              className={styles.input}
              value={form.password}
              placeholder={form.id !== '' ? t('form.placeholder.password.edit') : t('form.placeholder.password.new')}
              disabled={busy}
              onChange={event => { setForm(prev => ({ ...prev, password: event.target.value })) }}
            />
            <span className={styles.hint}>{t('form.password.hint.edit')}</span>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- advanced */}
      <details
        className={styles.disclosure}
        open={advanced}
        onToggle={event => { setAdvanced((event.currentTarget as HTMLDetailsElement).open) }}
      >
        <summary className={styles.disclosureSummary}>{t('form.advanced.label')}</summary>
        <div className={styles.disclosureBody}>
          {authKind === 'password' && (
            <div className={styles.checkRow}>
              <input
                id="dsw-field-encrypt"
                type="checkbox"
                className={styles.checkbox}
                checked={form.encryptPassword}
                disabled={busy}
                onChange={event => { setForm(prev => ({ ...prev, encryptPassword: event.target.checked })) }}
              />
              <label className={styles.checkLabel} htmlFor="dsw-field-encrypt">{t('form.encrypt.checkbox')}</label>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={FIELD_IDS.hostKey}>{t('form.label.hostKey')}</label>
            <select
              id={FIELD_IDS.hostKey}
              className={`${styles.input} ${styles.select}`}
              value={form.hostKeyMode}
              disabled={busy}
              onChange={event => { setForm(prev => ({ ...prev, hostKeyMode: event.target.value as MachineFormState['hostKeyMode'] })) }}
            >
              <option value="">{t('form.hostKey.default')}</option>
              <option value="accept-new">{t('form.hostKey.acceptNew')}</option>
              <option value="verify">{t('form.hostKey.verify')}</option>
              <option value="off">{t('form.hostKey.off')}</option>
            </select>
          </div>

          {/* AUDIT-6 (ADR-0020 D2): per-machine remote-command approval gate. */}
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={FIELD_IDS.remoteApproval}>{t('form.label.remoteApproval')}</label>
            <select
              id={FIELD_IDS.remoteApproval}
              className={`${styles.input} ${styles.select}`}
              value={form.remoteApproval}
              disabled={busy}
              onChange={event => { setForm(prev => ({ ...prev, remoteApproval: event.target.value as MachineFormState['remoteApproval'] })) }}
            >
              <option value="off">{t('form.remoteApproval.off')}</option>
              <option value="human">{t('form.remoteApproval.human')}</option>
              <option value="ai">{t('form.remoteApproval.ai')}</option>
            </select>
            <span className={styles.hint}>{t('form.remoteApproval.hint')}</span>
          </div>

          {/* REQ-I13 (ADR-0025): session /permission is the permission axis.
              The machine remoteSandbox field is leftover and not shown as a
              control so it cannot fight the composer chip. Deploy-core stays
              on the settings list. */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('form.label.remoteSandbox')}</span>
            <span className={styles.hint}>{t('form.remoteSandbox.hint')}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={FIELD_IDS.jump}>{t('form.label.jump')}</label>
            <div className={styles.hostRow}>
              <input
                id={FIELD_IDS.jump}
                className={styles.input}
                value={jumpText}
                placeholder={t('form.placeholder.jump')}
                disabled={busy}
                onChange={event => { setJumpText(event.target.value) }}
              />
              <button
                type="button"
                className={`${styles.secondaryButton} ${styles.small}`}
                disabled={busy || jumpText === ''}
                onClick={() => { setJumpText('') }}
              >{t('form.jump.clear')}</button>
            </div>
            {jumpSummary !== '' && <span className={styles.hint}>{jumpSummary}</span>}
          </div>
        </div>
      </details>

      {feedback !== null && (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`${styles.feedback} ${
            feedback.kind === 'success'
              ? styles.feedbackSuccess
              : feedback.kind === 'error'
                ? styles.feedbackError
                : styles.feedbackInfo
          }`}
        >
          {feedback.kind === 'success'
            ? <CheckIcon className={styles.feedbackIcon} />
            : feedback.kind === 'error'
              ? <AlertIcon className={styles.feedbackIcon} />
              : <SpinnerIcon className={styles.feedbackIcon} width={13} height={13} />}
          <span>{feedback.text}</span>
        </div>
      )}

      <div className={mode === 'flow' ? `${styles.actions} ${styles.actionsFlow}` : styles.actions}>
        {mode === 'flow' && onCancel !== undefined && (
          <button type="button" className={`${styles.secondaryButton} ${styles.small}`} disabled={busy} onClick={onCancel}>
            {t('form.cancel')}
          </button>
        )}
        <div className={styles.actionsTrailing}>
          <button
            type="button"
            className={`${styles.secondaryButton} ${styles.small}`}
            disabled={busy}
            onClick={() => { void runTest() }}
          >
            {busyTask === 'test'
              ? <><SpinnerIcon className={styles.configSpinner} width={13} height={13} /> {t('form.test.testing')}</>
              : t('form.test.button')}
          </button>
          {mode === 'settings' && (
            <button type="button" className={`${styles.secondaryButton} ${styles.small}`} disabled={busy} onClick={resetForm}>
              {initial?.id !== undefined ? t('form.clear.edit') : t('form.clear.empty')}
            </button>
          )}
          <button
            type="button"
            className={`${styles.primaryButton} ${styles.small}`}
            disabled={busy}
            onClick={() => { void runSave() }}
          >
            {busyTask === 'save' ? t('form.save.saving') : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
