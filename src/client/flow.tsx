/**
 * The add-workspace directory flow of dsh-workspace-enhancement, laid out as a connection
 * sidebar beside a directory browser (VS Code Remote Explorer style): the
 * sidebar lists `~/.ssh/config` hosts (one click resolves, registers, and
 * browses — no form), saved connections, and the local entry; the right pane
 * browses whichever side is active. Picking a remote directory hands the owner
 * an `ssh://<id><path>` workspace path, which the deployment's remote
 * providers consume (see README for the workspace-adoption seam).
 */

import { useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigHostView, ConnectionView, WireEntry, WireListing, WireResult } from './index.ts'
import { ConnectionForm } from './form.tsx'
import type { ConnectionDraft } from './form.tsx'
import type { MachineSaveView, ResolvedSshConfigView } from './machine-form.tsx'
import { ConnStatusBadge, zhBaseline } from './status.tsx'
import { cx, useDialogA11y } from './ui.ts'
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  KeyIcon,
  LockIcon,
  MonitorIcon,
  PlusIcon,
  RefreshIcon,
  RouteIcon,
  ServerIcon,
  SpinnerIcon,
  TrashIcon,
} from './icons.tsx'
import styles from './flow.module.css'

/** Services the plugin injects into every registration. */
export interface FlowInjected {
  listLocalDirectory(path?: string, signal?: AbortSignal): Promise<WireListing>
  createLocalDirectory(path: string, name: string): Promise<string>
  rpc(endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<WireResult>
}

/**
 * The locale translate seat of the `dsw` namespace. The slot renderer injects
 * `t` when a registration declares `locale: 'dsw'` (src/client/index.ts, t7);
 * the type stays optional so nested call sites (side-workspaces, t7) compile
 * until they thread their own `t` — the runtime seat is always provided.
 */
export interface FlowTimed {
  t?: TranslateNS<'dsw'>
}

/** The owner share of the directory-flow holes (see ui-workspace's contract). */
export interface FlowProps {
  open: boolean
  busy: boolean
  onPicked(path: string): void
  onCancel(): void
  onError(message: string): void
  /**
   * Skip the host `session.route` adoption when a remote directory is picked:
   * no placeholder tree is created and no machine workspace is written back —
   * the raw `ssh://<id><posixPath>` spelling is handed to the owner instead
   * (the host normalizes it anyway). Defaults to false (unchanged behavior).
   */
  suppressSessionRoute?: boolean
  /**
   * When non-empty, `open` turning true opens the dialog with that saved
   * connection as the current browse target — the same as clicking the
   * connection in the sidebar (remote mode + its home listed through
   * `browse.list`, including its error handling). An id that is not a saved
   * connection degrades to the default local-home browse; undefined/'' keeps
   * the current behavior. The value is snapshotted when `open` turns true;
   * later changes while the dialog stays open do not re-navigate.
   */
  initialConnectionId?: string
  /**
   * Picker-only mode: the remote footer button reads「选择此目录」and hands the
   * raw `ssh://<id><posixPath>` spelling straight to `onPicked` — no
   * `session.route` adoption, no placeholder tree, no write-back (the same
   * delivery path as `suppressSessionRoute`). Takes precedence over
   * `suppressSessionRoute` when both are set. Defaults to false (unchanged
   * behavior).
   */
  pickOnly?: boolean
}

/** Which filesystem the browser pane is showing. */
type Mode = { kind: 'local' } | { kind: 'remote'; id: string }

/** One listing pane's live state. */
interface Pane {
  path: string | null
  listing: WireListing | null
  error: string | null
  loading: boolean
}

const EMPTY_PANE: Pane = { path: null, listing: null, error: null, loading: false }

/** A remote failure translated for the right pane (auth ones can route to the form). */
interface RemoteFailure {
  title: string
  text: string
  needsAuth: boolean
}

/** Unwrap a wire result or throw its business error. */
function unwrap<T>(result: WireResult, fallback: string): T {
  if (!result.ok) throw new Error(result.error.message || fallback)
  return result.value as T
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Minimal structural check for a wire listing. */
function asListing(value: unknown): WireListing {
  const record = isRecord(value) ? value : {}
  const wireEntry = (entry: unknown): WireEntry => ({
    name: String((entry as Record<string, unknown> | undefined)?.name ?? ''),
    path: String((entry as Record<string, unknown> | undefined)?.path ?? ''),
    hidden: (entry as Record<string, unknown> | undefined)?.hidden === true,
  })
  return {
    path: typeof record.path === 'string' ? record.path : '',
    home: typeof record.home === 'string' ? record.home : '',
    crumbs: Array.isArray(record.crumbs) ? record.crumbs.filter(isRecord).map(wireEntry) : [],
    entries: Array.isArray(record.entries) ? record.entries.filter(isRecord).map(wireEntry) : [],
    truncated: record.truncated === true,
  }
}

/** Structural check for one `config.hosts` row. */
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

/** Structural check for one secret-free connection view. */
function asConnectionView(record: Record<string, unknown>): ConnectionView {
  return {
    id: String(record.id ?? ''),
    label: String(record.label ?? ''),
    host: String(record.host ?? ''),
    port: typeof record.port === 'number' ? record.port : 22,
    username: String(record.username ?? ''),
    ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
    auth: (record.auth === 'password' || record.auth === 'agent' ? record.auth : 'key') as ConnectionView['auth'],
    jumpHosts: Array.isArray(record.jumpHosts) ? record.jumpHosts.map(String) : [],
  }
}

/** Structural check for a `connections.resolve` result. */
function asResolved(value: unknown): ResolvedSshConfigView {
  const record = isRecord(value) ? value : {}
  return {
    host: typeof record.host === 'string' ? record.host : '',
    username: typeof record.username === 'string' ? record.username : '',
    port: typeof record.port === 'number' ? record.port : 22,
    privateKeyPaths: Array.isArray(record.privateKeyPaths) ? record.privateKeyPaths.map(String) : [],
    jump: Array.isArray(record.jump) ? record.jump.filter(isRecord).map(hop => ({
      host: String(hop.host ?? ''),
      ...(typeof hop.port === 'number' ? { port: hop.port } : {}),
      ...(typeof hop.username === 'string' && hop.username !== '' ? { username: hop.username } : {}),
      ...(hop.privateKeyPath !== undefined ? { privateKeyPath: String(hop.privateKeyPath) } : {}),
    })) : [],
    alias: typeof record.alias === 'string' ? record.alias : '',
  }
}

/** Structural check for a `connections.add` result (its view only). */
function asAddedView(value: unknown): ConnectionView {
  const record = isRecord(value) ? value : {}
  return asConnectionView(isRecord(record.view) ? record.view : {})
}

/**
 * Translate a raw ssh2/web error into a readable remote failure. ssh2 never
 * consults the OS agent or default identities on its own, so a spec without
 * password/privateKey/agent surfaces as `All configured authentication
 * methods failed` — that one gets the auth-completion guidance.
 */
function describeRemoteFailure(raw: string, t: TranslateNS<'dsw'>): RemoteFailure {
  if (/invalid_union/.test(raw)) {
    return {
      title: t('flow.error.invalidResponse.title'),
      text: t('flow.error.invalidResponse.text'),
      needsAuth: false,
    }
  }
  if (/all configured authentication methods/i.test(raw)) {
    return {
      title: t('flow.error.auth.title'),
      text: t('flow.error.auth.text'),
      needsAuth: true,
    }
  }
  if (/cannot parse privatekey|cannot read private key|invalid private key|no key found/i.test(raw)) {
    return {
      title: t('flow.error.key.title'),
      text: t('flow.error.key.text', { raw }),
      needsAuth: true,
    }
  }
  if (/timed?\s?out|etimedout/i.test(raw)) {
    return { title: t('flow.error.timeout.title'), text: t('flow.error.timeout.text'), needsAuth: false }
  }
  if (/econnrefused/i.test(raw)) {
    return { title: t('flow.error.refused.title'), text: t('flow.error.refused.text'), needsAuth: false }
  }
  if (/enotfound|getaddrinfo|dns/i.test(raw)) {
    return { title: t('flow.error.dns.title'), text: t('flow.error.dns.text'), needsAuth: false }
  }
  if (/ehostunreach|enetunreach/i.test(raw)) {
    return { title: t('flow.error.unreachable.title'), text: t('flow.error.unreachable.text'), needsAuth: false }
  }
  return { title: t('flow.error.generic.title'), text: raw, needsAuth: false }
}

/** The directory-flow occupant registered into both workspace holes. */
export function SshWorkspaceFlow(props: FlowProps & FlowInjected & FlowTimed) {
  const { open, busy, onPicked, onCancel, listLocalDirectory, createLocalDirectory, rpc, suppressSessionRoute = false, pickOnly = false, initialConnectionId = '', t: tSeat } = props
  // The typed translate seat: injected by the slot renderer once the entry
  // declares `locale: 'dsw'` (src/client/index.ts, t7); nested call sites
  // (side-workspaces, t7) thread it explicitly. The seat itself is a stable
  // per-namespace reference (LocaleRuntime.bind), safe for memo deps.
  // t15-r2: `tSeat ?? zhBaseline` (the rest of the components' pattern) —
  // the seat is optional in FlowInjected so a seat-less renderer (tests or a
  // non-locale fence) must fall back instead of throwing.
  const t = tSeat ?? zhBaseline

  const [mode, setMode] = useState<Mode>({ kind: 'local' })
  const [pane, setPane] = useState<Pane>(EMPTY_PANE)
  const [connections, setConnections] = useState<ConnectionView[]>([])
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [configHosts, setConfigHosts] = useState<ConfigHostView[]>([])
  const [configLoading, setConfigLoading] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [hostPending, setHostPending] = useState<string | null>(null)
  const [hostError, setHostError] = useState<{ alias: string; message: string } | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ host: ConfigHostView; resolved: ResolvedSshConfigView } | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formDraft, setFormDraft] = useState<ConnectionDraft | undefined>(undefined)
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const [openingRemote, setOpeningRemote] = useState(false)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [nativePicking, setNativePicking] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ConnectionView | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const generation = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const configGeneration = useRef(0)
  const configRequest = useRef<AbortController | null>(null)
  const modeRef = useRef<Mode>(mode)
  modeRef.current = mode
  const paneRef = useRef<Pane>(pane)
  paneRef.current = pane

  const dialogRef = useDialogA11y(open, () => { onCancel() })
  const folderDialogRef = useDialogA11y(folderDraft !== null, () => { if (!folderBusy) setFolderDraft(null) })
  const deleteDialogRef = useDialogA11y(deleteTarget !== null, () => { if (removingId === null) setDeleteTarget(null) })
  const confirmDialogRef = useDialogA11y(confirmTarget !== null, () => { if (hostPending === null) setConfirmTarget(null) })

  /** List one level, guarding against superseded/closed generations. */
  const loadLevel = async (request: (signal: AbortSignal) => Promise<WireListing>): Promise<void> => {
    const current = generation.current += 1
    const controller = new AbortController()
    activeRequest.current = controller
    setPane(previous => ({ ...previous, loading: true, error: null }))
    try {
      const listing = await request(controller.signal)
      if (current !== generation.current || controller.signal.aborted) return
      setPane({ path: listing.path, listing, error: null, loading: false })
    } catch (error) {
      if (current !== generation.current || controller.signal.aborted) return
      setPane(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const navigateLocal = (path?: string): void => {
    setMode({ kind: 'local' })
    void loadLevel(signal => listLocalDirectory(path, signal))
  }

  const navigateRemote = (id: string, path?: string): void => {
    setMode({ kind: 'remote', id })
    void loadLevel(async signal => asListing(unwrap(await rpc('browse.list', { id, ...(path !== undefined ? { path } : {}) }, signal), t('rpc.browseList'))))
  }

  const openRemotePath = async (): Promise<void> => {
    if (mode.kind !== 'remote' || pane.path === null || openingRemote) return
    setOpeningRemote(true)
    try {
      if (pickOnly || suppressSessionRoute) {
        // Opt-out owner (side-workspaces panel) / picker-only mode: hand the
        // raw ssh:// spelling — no placeholder tree, no machine-workspace
        // write-back. Spelling matches sshTargetKey (`ssh://<id><posixPath>`);
        // the host normalizes it into the registry connection on attach.
        // pickOnly wins over suppressSessionRoute when both are present
        // (identical delivery at this boundary).
        onPicked(`ssh://${mode.id}${pane.path}`)
        return
      }
      // The host mkdir's the session cwd locally, so hand it the local
      // placeholder that stands in for the remote route (both spellings
      // resolve to the same registry connection in the providers). Adopt it
      // through the host's own pick flow: the session gets a workspaceId
      // (the web hero gates cwd-only sessions), and the placeholder routes
      // every bash/fs/terminal operation onto the remote host.
      const routed = unwrap(await rpc('session.route', { id: mode.id, path: pane.path }), t('rpc.sessionRoute'))
      const cwd = isRecord(routed) && typeof routed.cwd === 'string' ? routed.cwd : ''
      if (cwd === '') throw new Error(t('flow.route.empty'))
      onPicked(cwd)
    } catch (error) {
      setPane(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setOpeningRemote(false)
    }
  }

  /**
   * Refresh the connection list. `silent` keeps the previous list on screen
   * (post-mutation refreshes) instead of flashing the skeleton. Returns the
   * freshly parsed list ([] when the call failed) so callers can validate an
   * id against the latest registry state.
   */
  const refreshConnections = async (silent = false): Promise<ConnectionView[]> => {
    if (!silent) setConnectionsLoading(true)
    try {
      const value = unwrap(await rpc('connections.list'), t('rpc.connectionsList'))
      if (Array.isArray(value)) {
        const list = value.filter(isRecord).map(asConnectionView)
        setConnections(list)
        setConnectionsError(null)
        return list
      }
    } catch (error) {
      setConnectionsError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!silent) setConnectionsLoading(false)
    }
    return []
  }

  /**
   * Refresh the `~/.ssh/config` host list (the Host re-reads the file on every
   * call). Same generation + abort guard as the directory pane so closing the
   * dialog or a rapid retry can never apply a stale answer.
   */
  const refreshConfigHosts = async (silent = false): Promise<void> => {
    if (!silent) setConfigLoading(true)
    const current = configGeneration.current += 1
    const controller = new AbortController()
    configRequest.current = controller
    try {
      const value = unwrap(await rpc('config.hosts', {}, controller.signal), t('rpc.configHosts'))
      if (current !== configGeneration.current || controller.signal.aborted) return
      setConfigHosts(asConfigHosts(value))
      setConfigError(null)
    } catch (error) {
      if (current !== configGeneration.current || controller.signal.aborted) return
      setConfigError(error instanceof Error ? error.message : String(error))
    } finally {
      if (current === configGeneration.current && !silent) setConfigLoading(false)
    }
  }

  /** Open: refresh both sidebar lists and browse the initial target (local home, or the saved connection named by `initialConnectionId` when it exists). Closed: abort. */
  useEffect(() => {
    if (!open) {
      generation.current += 1
      activeRequest.current?.abort()
      activeRequest.current = null
      configGeneration.current += 1
      configRequest.current?.abort()
      configRequest.current = null
      return
    }
    generation.current += 1
    const openGeneration = generation.current
    setPane(EMPTY_PANE)
    setFolderDraft(null)
    setFormOpen(false)
    setFormDraft(undefined)
    setOpeningRemote(false)
    setDeleteTarget(null)
    setRemovingId(null)
    setHostPending(null)
    setHostError(null)
    setConfirmTarget(null)
    setNativePicking(false)
    void refreshConfigHosts()
    // Snapshot of the requested starting machine (empty/absent id keeps the
    // default local-home browse). When it names a saved connection, open the
    // dialog exactly like clicking that connection once its registry entry is
    // confirmed; an unknown id degrades back to the local home.
    const initialId = initialConnectionId.trim()
    if (initialId === '') {
      setMode({ kind: 'local' })
      void refreshConnections()
      void loadLevel(signal => listLocalDirectory(undefined, signal))
      return
    }
    setMode({ kind: 'remote', id: initialId })
    void (async () => {
      const list = await refreshConnections()
      if (openGeneration !== generation.current) return // closed / superseded before the list arrived
      if (list.some(connection => connection.id === initialId)) {
        navigateRemote(initialId)
      } else {
        setMode({ kind: 'local' })
        void loadLevel(signal => listLocalDirectory(undefined, signal))
      }
    })()
  }, [open])

  /** The active connection view (undefined while browsing locally). */
  const activeConnection = mode.kind === 'remote' ? connections.find(connection => connection.id === mode.id) : undefined

  const activePath = pane.path ?? ''

  const refreshCurrent = (): void => {
    if (modeRef.current.kind === 'local') navigateLocal(paneRef.current.path ?? undefined)
    else navigateRemote(modeRef.current.id, paneRef.current.path ?? undefined)
  }

  /** One OS folder chooser on the host display; a pick lands straight as the workspace. */
  const pickNative = async (): Promise<void> => {
    if (mode.kind !== 'local' || nativePicking) return
    setNativePicking(true)
    try {
      const result = unwrap(await rpc('local.pickNative'), t('rpc.pickNative'))
      const path = isRecord(result) && typeof result.path === 'string' ? result.path : ''
      if (path !== '') onPicked(path)
    } catch (error) {
      setPane(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setNativePicking(false)
    }
  }

  /** The registry entry a config alias points at, if it was registered before. */
  const matchConfigHost = (host: ConfigHostView): ConnectionView | undefined =>
    connections.find(connection =>
      connection.port === host.port
      && (connection.host.toLowerCase() === host.alias.toLowerCase()
        || connection.host.toLowerCase() === host.host.toLowerCase()))

  const openForm = (draft?: ConnectionDraft): void => {
    setFormDraft(draft)
    setFormOpen(true)
  }

  /**
   * One click on a config host: switch to its registered entry when there is
   * one; otherwise resolve the alias first. A missing username routes to the
   * prefilled form (the registry refuses empty usernames); anything else asks
   * for confirmation before it is registered and browsed.
   */
  const activateConfigHost = async (host: ConfigHostView): Promise<void> => {
    if (hostPending !== null) return
    const existing = matchConfigHost(host)
    if (existing !== undefined) {
      setHostError(null)
      navigateRemote(existing.id)
      return
    }
    setHostError(null)
    setHostPending(host.alias)
    try {
      const resolved = asResolved(unwrap(await rpc('connections.resolve', { host: host.alias }), t('rpc.connectionsResolve')))
      if (resolved.host === '') throw new Error(t('flow.resolve.empty'))
      if (resolved.username.trim() === '') {
        openForm({
          label: host.alias,
          host: resolved.host,
          port: String(resolved.port),
          username: '',
          ...(resolved.privateKeyPaths[0] !== undefined ? { privateKeyPath: resolved.privateKeyPaths[0] } : {}),
          ...(resolved.jump.length > 0 ? { jumpText: resolved.jump.map(hop => `${hop.username !== undefined && hop.username !== '' ? `${hop.username}@` : ''}${hop.host}${hop.port !== undefined && hop.port !== 22 ? `:${String(hop.port)}` : ''}`).join(', ') } : {}),
          focusUsername: true,
        })
        return
      }
      setConfirmTarget({ host, resolved })
    } catch (error) {
      setHostError({ alias: host.alias, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setHostPending(null)
    }
  }

  /** Confirmed: register the config host and browse its home right away. */
  const confirmAddHost = async (): Promise<void> => {
    if (confirmTarget === null || hostPending !== null) return
    const { host, resolved } = confirmTarget
    setHostError(null)
    setHostPending(host.alias)
    try {
      const result = await rpc('connections.add', {
        label: host.alias,
        host: resolved.host,
        port: resolved.port,
        username: resolved.username,
        ...(resolved.privateKeyPaths[0] !== undefined ? { privateKeyPath: resolved.privateKeyPaths[0] } : {}),
        ...(resolved.jump.length > 0 ? { jump: resolved.jump } : {}),
      })
      const view = asAddedView(unwrap(result, t('rpc.connectionsAdd')))
      if (view.id === '') throw new Error(t('flow.add.missingId'))
      setConfirmTarget(null)
      await refreshConnections(true)
      await refreshConfigHosts(true)
      navigateRemote(view.id)
    } catch (error) {
      setConfirmTarget(null)
      setHostError({ alias: host.alias, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setHostPending(null)
    }
  }

  /** A prefilled form for the connection whose browse just failed on auth. */
  const draftFromConnection = (connection: ConnectionView): ConnectionDraft => ({
    label: connection.label,
    host: connection.host,
    port: String(connection.port),
    username: connection.username,
    ...(connection.jumpHosts.length > 0 ? { jumpText: connection.jumpHosts.join(', ') } : {}),
  })

  const confirmCreateFolder = async (): Promise<void> => {
    const name = (folderDraft ?? '').trim()
    if (name === '' || pane.path === null) return
    if (name === '.' || name === '..' || /[/\\]/.test(name)) {
      setFolderError(t('flow.mkdir.invalidName'))
      return
    }
    setFolderBusy(true)
    setFolderError(null)
    try {
      if (mode.kind === 'local') {
        await createLocalDirectory(pane.path, name)
      } else {
        unwrap(await rpc('browse.mkdir', { id: mode.id, path: pane.path, name }), t('rpc.browseMkdir'))
      }
      setFolderDraft(null)
      refreshCurrent()
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error))
    } finally {
      setFolderBusy(false)
    }
  }

  const confirmRemove = async (): Promise<void> => {
    if (deleteTarget === null || removingId !== null) return
    setRemovingId(deleteTarget.id)
    try {
      unwrap(await rpc('connections.remove', { id: deleteTarget.id }), t('rpc.connectionsRemove'))
      await refreshConnections(true)
      await refreshConfigHosts(true)
      if (mode.kind === 'remote' && mode.id === deleteTarget.id) {
        setMode({ kind: 'local' })
        void loadLevel(signal => listLocalDirectory(undefined, signal))
      }
    } catch (error) {
      setConnectionsError(error instanceof Error ? error.message : String(error))
    } finally {
      setRemovingId(null)
      setDeleteTarget(null)
    }
  }

  const formSaved = async (view: MachineSaveView): Promise<void> => {
    setFormOpen(false)
    setFormDraft(undefined)
    await refreshConnections(true)
    await refreshConfigHosts(true)
    navigateRemote(view.id)
  }

  const hiddenCount = (pane.listing?.entries ?? []).filter(entry => entry.hidden).length
  const visibleEntries = (pane.listing?.entries ?? []).filter(entry => showHidden || !entry.hidden)
  const home = pane.listing?.home ?? ''
  const crumbs = pane.listing?.crumbs ?? []
  const lastCrumbIndex = crumbs.length - 1

  const subtitle = mode.kind === 'local'
    ? t('flow.subtitle.local')
    : t('flow.subtitle.remote', { endpoint: activeConnection !== undefined ? `${activeConnection.username}@${activeConnection.host}:${activeConnection.port}` : mode.id })

  /** The translated remote failure for the right pane, when there is one. */
  const remoteFailure = mode.kind === 'remote' && pane.error !== null ? describeRemoteFailure(pane.error, t) : null

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('flow.dialog.label')} ref={dialogRef}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h3 className={styles.title}>{t('flow.title')}</h3>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
          <button type="button" className={styles.iconButton} aria-label={t('flow.close.label')} onClick={onCancel}>
            <CloseIcon />
          </button>
        </header>

        <div className={styles.body}>
          <nav className={styles.sidebar} aria-label={t('flow.sidebar.label')}>
            <section className={styles.sidebarSection} aria-label={t('flow.sidebar.local.section')}>
              <ul className={styles.connectionList} role="list">
                <li className={cx(styles.connectionItem, mode.kind === 'local' && styles.connectionItemActive)}>
                  <button
                    type="button"
                    className={styles.connectionMain}
                    aria-current={mode.kind === 'local' ? 'true' : 'false'}
                    onClick={() => { if (mode.kind !== 'local') navigateLocal() }}
                  >
                    <MonitorIcon className={styles.connectionIcon} />
                    <span className={styles.connectionInfo}>
                      <span className={styles.connectionLabel}>{t('flow.sidebar.local.title')}</span>
                      <span className={styles.connectionDetail}>
                        <span className={styles.connectionEndpoint}>{t('flow.sidebar.local.subtitle')}</span>
                      </span>
                    </span>
                  </button>
                </li>
              </ul>
            </section>

            <section className={styles.sidebarSection} aria-label={t('flow.sidebar.saved.section')}>
              <h4 className={styles.sidebarTitle}>
                {t('flow.sidebar.saved.title')}
                {connections.length > 0 && <span className={styles.sidebarCount}>{connections.length}</span>}
              </h4>

              {connectionsLoading && (
                <div role="status" aria-label={t('flow.sidebar.saved.loading')}>
                  {[0, 1].map(index => (
                    <div key={index} className={styles.skeletonRow}>
                      <div className={styles.skeletonDot} />
                      <div className={styles.skeletonLines}>
                        <div className={styles.skeletonLine} style={{ width: '38%' }} />
                        <div className={styles.skeletonLine} style={{ width: '62%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {connectionsError !== null && !connectionsLoading && (
                <div className={styles.sideError} role="alert">
                  <span className={styles.sideErrorText}>{connectionsError}</span>
                  <button type="button" className={styles.retryButton} onClick={() => { void refreshConnections() }}>
                    <RefreshIcon style={{ width: 12, height: 12 }} />
                    {t('flow.retry')}
                  </button>
                </div>
              )}

              {!connectionsLoading && connectionsError === null && connections.length === 0 && (
                <div className={styles.sideEmpty}>
                  <ServerIcon className={styles.sideEmptyIcon} style={{ width: 18, height: 18 }} />
                  <p className={styles.sideEmptyTitle}>{t('flow.sidebar.saved.empty.title')}</p>
                  <p className={styles.sideEmptyText}>{t('flow.sidebar.saved.empty.text')}</p>
                </div>
              )}

              {!connectionsLoading && connections.length > 0 && (
                <ul className={styles.connectionList} role="list">
                  {connections.map(connection => {
                    const active = mode.kind === 'remote' && mode.id === connection.id
                    return (
                      <li key={connection.id} className={cx(styles.connectionItem, active && styles.connectionItemActive)}>
                        <button
                          type="button"
                          className={styles.connectionMain}
                          aria-current={active ? 'true' : 'false'}
                          onClick={() => { navigateRemote(connection.id) }}
                        >
                          <ServerIcon className={styles.connectionIcon} />
                          <span className={styles.connectionInfo}>
                            <span className={styles.connectionLabel}>{connection.label}</span>
                            <span className={styles.connectionDetail}>
                              <span className={styles.connectionEndpoint}>
                                {connection.username}@{connection.host}:{connection.port}
                              </span>
                              <span className={styles.badge}>
                                {connection.auth === 'password' ? <LockIcon style={{ width: 11, height: 11 }} /> : <KeyIcon style={{ width: 11, height: 11 }} />}
                                {connection.auth === 'password' ? t('flow.badge.auth.password') : connection.auth === 'agent' ? t('flow.badge.auth.agent') : t('flow.badge.auth.key')}
                              </span>
                              {connection.jumpHosts.length > 0 && (
                                <span className={styles.badge} title={connection.jumpHosts.join(' → ')}>
                                  <RouteIcon style={{ width: 11, height: 11 }} />
                                  {t('flow.badge.jump', { n: connection.jumpHosts.length })}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                        <span className={styles.connectionStatus}>
                          <ConnStatusBadge id={connection.id} rpc={rpc} t={t} compact />
                        </span>
                        <button
                          type="button"
                          className={styles.connectionRemove}
                          aria-label={t('flow.connection.delete.label', { label: connection.label })}
                          title={t('flow.connection.delete.title')}
                          onClick={() => { setDeleteTarget(connection) }}
                        >
                          <TrashIcon style={{ width: 14, height: 14 }} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className={styles.sidebarSection} aria-label={t('flow.sidebar.ssh.section')}>
              <h4 className={styles.sidebarTitle}>
                {t('flow.sidebar.ssh.title')}
                {configHosts.length > 0 && <span className={styles.sidebarCount}>{configHosts.length}</span>}
              </h4>

              {configLoading && (
                <div role="status" aria-label={t('flow.sidebar.ssh.loading')}>
                  {[0, 1].map(index => (
                    <div key={index} className={styles.skeletonRow}>
                      <div className={styles.skeletonDot} />
                      <div className={styles.skeletonLines}>
                        <div className={styles.skeletonLine} style={{ width: '38%' }} />
                        <div className={styles.skeletonLine} style={{ width: '62%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {configError !== null && !configLoading && (
                <div className={styles.sideError} role="alert">
                  <span className={styles.sideErrorText}>{t('flow.sidebar.ssh.error', { detail: configError })}</span>
                  <button type="button" className={styles.retryButton} onClick={() => { void refreshConfigHosts() }}>
                    <RefreshIcon style={{ width: 12, height: 12 }} />
                    {t('flow.retry')}
                  </button>
                </div>
              )}

              {!configLoading && configError === null && configHosts.length === 0 && (
                <div className={styles.sideEmpty}>
                  <p className={styles.sideEmptyTitle}>{t('flow.sidebar.ssh.empty.title')}</p>
                  <p className={styles.sideEmptyText}>{t('flow.sidebar.ssh.empty.text')}</p>
                </div>
              )}

              {!configLoading && configHosts.length > 0 && (
                <ul className={styles.connectionList} role="list">
                  {configHosts.map(host => {
                    const registered = matchConfigHost(host)
                    const working = hostPending === host.alias
                    const failed = hostError !== null && hostError.alias === host.alias
                    return (
                      <li key={host.alias} className={styles.connectionItem}>
                        <button
                          type="button"
                          className={styles.connectionMain}
                          aria-current="false"
                          disabled={hostPending !== null}
                          title={registered !== undefined
                            ? t('flow.ssh.registered.title', { user: registered.username, host: registered.host, port: registered.port })
                            : host.username !== ''
                              ? t('flow.ssh.clickRegister.title', { user: host.username, host: host.host, port: host.port })
                              : t('flow.ssh.noUsername.title')}
                          onClick={() => { void activateConfigHost(host) }}
                        >
                          <ServerIcon className={styles.connectionIcon} />
                          <span className={styles.connectionInfo}>
                            <span className={styles.connectionLabel}>{host.alias}</span>
                            <span className={styles.connectionDetail}>
                              {working ? (
                                <span className={styles.hostWorking}>
                                  <SpinnerIcon className={cx(styles.spin, styles.hostSpinner)} />
                                  {t('flow.ssh.adding')}
                                </span>
                              ) : failed && hostError !== null ? (
                                <span className={styles.hostErrorText} role="alert">{t('flow.ssh.addFailed', { message: hostError.message })}</span>
                              ) : (
                                <>
                                  <span className={styles.connectionEndpoint}>
                                    {host.username !== '' ? `${host.username}@${host.host}:${host.port}` : t('flow.ssh.noUsername')}
                                  </span>
                                  {registered !== undefined ? (
                                    <span className={cx(styles.badge, styles.badgeAdded)}>
                                      <CheckIcon style={{ width: 11, height: 11 }} />
                                      {t('flow.ssh.added')}
                                    </span>
                                  ) : (
                                    <>
                                      {host.identityFile && (
                                        <span className={styles.badge}>
                                          <KeyIcon style={{ width: 11, height: 11 }} />
                                          {t('flow.ssh.badge.key')}
                                        </span>
                                      )}
                                      {host.jump && (
                                        <span className={styles.badge}>
                                          <RouteIcon style={{ width: 11, height: 11 }} />
                                          {t('flow.ssh.badge.jump')}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <button
              type="button"
              className={styles.sidebarAdd}
              aria-label={t('flow.connection.new.label')}
              title={t('flow.connection.new.title')}
              onClick={() => { openForm() }}
            >
              <PlusIcon style={{ width: 14, height: 14 }} />
            </button>
          </nav>

          <div className={styles.main}>
            <div className={styles.toolbar}>
              <nav className={styles.crumbs} aria-label={t('flow.crumbs.label')}>
                <button
                  type="button"
                  className={styles.crumb}
                  aria-label={t('flow.crumb.home.label')}
                  title={t('flow.crumb.home.title')}
                  disabled={home === '' || pane.loading}
                  onClick={() => {
                    if (mode.kind === 'local') navigateLocal(home)
                    else navigateRemote(mode.id, home)
                  }}
                >
                  <HomeIcon style={{ width: 13, height: 13, verticalAlign: '-2px' }} />
                </button>
                {crumbs.map((crumb, index) =>
                  index === lastCrumbIndex ? (
                    <span key={crumb.path} className={styles.crumbCurrent} aria-current="page" title={crumb.path}>
                      {crumb.name}
                    </span>
                  ) : (
                    <span key={crumb.path} className={styles.crumbStep}>
                      <button
                        type="button"
                        className={styles.crumb}
                        disabled={pane.loading}
                        onClick={() => {
                          if (mode.kind === 'local') navigateLocal(crumb.path)
                          else navigateRemote(mode.id, crumb.path)
                        }}
                      >{crumb.name}</button>
                      <span className={styles.crumbSep} aria-hidden>/</span>
                    </span>
                  ),
                )}
              </nav>
          <div className={styles.toolbarActions}>
            {mode.kind === 'local' && (
              <button
                type="button"
                className={cx(styles.toolButton, styles.toolButtonText)}
                aria-label={t('flow.nativePicker.label')}
                title={t('flow.nativePicker.title')}
                disabled={nativePicking || busy}
                onClick={() => { void pickNative() }}
              >
                {nativePicking ? <SpinnerIcon className={styles.spin} /> : <FolderIcon style={{ width: 13, height: 13 }} />}
                {t('flow.nativePicker.text')}
              </button>
            )}
            <button
                  type="button"
                  className={styles.toolButton}
                  aria-label={t('flow.mkdir.label')}
                  title={t('flow.mkdir.title')}
                  disabled={pane.listing === null || pane.loading}
                  onClick={() => {
                    setFolderDraft('')
                    setFolderError(null)
                  }}
                >
                  <FolderPlusIcon />
                </button>
                <button
                  type="button"
                  className={cx(styles.toolButton, showHidden && styles.toolButtonOn)}
                  aria-pressed={showHidden}
                  aria-label={showHidden ? t('flow.hidden.hideLabel') : t('flow.hidden.showLabel')}
                  title={showHidden ? t('flow.hidden.hideTitle') : t('flow.hidden.showTitle')}
                  onClick={() => { setShowHidden(previous => !previous) }}
                >
                  <EyeIcon />
                  {!showHidden && hiddenCount > 0 && <span className={styles.countBadge} aria-hidden>{hiddenCount}</span>}
                </button>
                <button
                  type="button"
                  className={styles.toolButton}
                  aria-label={t('flow.refresh.label')}
                  title={t('flow.refresh.title')}
                  disabled={pane.loading || pane.listing === null}
                  onClick={refreshCurrent}
                >
                  <RefreshIcon className={pane.loading ? styles.spin : undefined} />
                </button>
              </div>
            </div>

            <div
              className={cx(styles.browser, pane.loading && pane.listing !== null && styles.browserBusy)}
              aria-busy={pane.loading}
            >
              {pane.loading && pane.listing === null && (
                <div className={styles.skeletons} role="status" aria-label={t('flow.loading.label')}>
                  {[52, 78, 64, 90, 45, 71].map((width, index) => (
                    <div key={index} className={styles.skeleton} style={{ width: `${width}%` }} />
                  ))}
                </div>
              )}

              {pane.error !== null && !pane.loading && (
                <div className={styles.errorPanel} role="alert">
                  <AlertIcon className={styles.errorIcon} />
                  <div className={styles.errorBody}>
                    <p className={styles.errorTitle}>
                      {remoteFailure !== null ? remoteFailure.title : mode.kind === 'remote' ? t('flow.browse.error.remote') : t('flow.browse.error.local')}
                    </p>
                    <p className={styles.errorText}>{remoteFailure !== null ? remoteFailure.text : pane.error}</p>
                  </div>
                  <div className={styles.errorActions}>
                    {remoteFailure?.needsAuth === true && activeConnection !== undefined && (
                      <button
                        type="button"
                        className={styles.retryButton}
                        onClick={() => { openForm(draftFromConnection(activeConnection)) }}
                      >
                        <KeyIcon style={{ width: 12, height: 12 }} />
                        {t('flow.auth.complete')}
                      </button>
                    )}
                    <button type="button" className={styles.retryButton} onClick={refreshCurrent}>
                      <RefreshIcon style={{ width: 12, height: 12 }} />
                      {t('flow.retry')}
                    </button>
                  </div>
                </div>
              )}

              {pane.listing !== null && visibleEntries.length === 0 && !pane.loading && pane.error === null && (
                <div className={styles.emptyState}>
                  <FolderIcon className={styles.emptyIcon} style={{ width: 22, height: 22 }} />
                  <p className={styles.emptyTitle}>{t('flow.empty.title')}</p>
                  <p className={styles.emptyText}>
                    {hiddenCount > 0 && !showHidden
                      ? t('flow.empty.hidden', { n: hiddenCount })
                      : t('flow.empty.text')}
                  </p>
                </div>
              )}

              {visibleEntries.length > 0 && (
                <ul className={styles.entryList} role="list">
                  {visibleEntries.map(entry => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={cx(styles.entry, entry.hidden && styles.entryHidden)}
                        onClick={() => {
                          if (mode.kind === 'local') navigateLocal(entry.path)
                          else navigateRemote(mode.id, entry.path)
                        }}
                      >
                        <FolderIcon className={styles.entryIcon} />
                        <span className={styles.entryName}>{entry.name}</span>
                        <ChevronIcon className={styles.entryChevron} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {pane.listing?.truncated === true && (
                <p className={styles.truncated}>{t('flow.truncated')}</p>
              )}
            </div>
          </div>
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.button} disabled={busy} onClick={onCancel}>{t('flow.cancel')}</button>
          <button
            type="button"
            className={cx(styles.button, styles.primary)}
            disabled={pane.listing === null || pane.loading || busy || openingRemote || pane.path === null}
            onClick={() => {
              if (pane.path === null) return
              if (mode.kind === 'local') onPicked(pane.path)
              else if (pickOnly) onPicked(`ssh://${mode.id}${pane.path}`)
              else void openRemotePath()
            }}
          >
            {mode.kind === 'remote' && openingRemote && <SpinnerIcon className={styles.spin} />}
            {mode.kind === 'remote' ? (openingRemote ? t('flow.footer.connecting') : (pickOnly ? t('flow.footer.pick') : t('flow.footer.open'))) : t('flow.footer.select')}
          </button>
        </footer>
      </div>

      {folderDraft !== null && (
        <div className={styles.overlay} onClick={(event) => { if (event.target === event.currentTarget && !folderBusy) setFolderDraft(null) }}>
          <div className={styles.smallDialog} role="dialog" aria-modal="true" aria-label={t('flow.mkdir.dialogLabel')} ref={folderDialogRef}>
            <h3 className={styles.formTitle}>{t('flow.mkdir.title')}</h3>
            <p className={styles.createIn}>
              {t('flow.mkdir.location')}<span className={cx(styles.mono, styles.createPath)}>{activePath === '' ? '…' : activePath}</span>
            </p>
            <input
              className={cx(styles.input, folderError !== null && styles.inputError)}
              value={folderDraft}
              placeholder={t('flow.mkdir.placeholder')}
              disabled={folderBusy}
              onChange={(event) => { setFolderDraft(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter' && !folderBusy) void confirmCreateFolder() }}
            />
            {folderError !== null && <p className={styles.fieldError} role="alert">{folderError}</p>}
            <div className={styles.formActions}>
              <span className={styles.gap} />
              <button type="button" className={styles.button} disabled={folderBusy} onClick={() => { setFolderDraft(null) }}>{t('flow.cancel')}</button>
              <button
                type="button"
                className={cx(styles.button, styles.primary)}
                disabled={folderBusy || (folderDraft ?? '').trim() === ''}
                onClick={() => { void confirmCreateFolder() }}
              >
                {folderBusy && <SpinnerIcon className={styles.spin} />}
                {t('flow.mkdir.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget !== null && (
        <div className={styles.overlay} onClick={(event) => { if (event.target === event.currentTarget && removingId === null) setDeleteTarget(null) }}>
          <div className={styles.smallDialog} role="dialog" aria-modal="true" aria-label={t('flow.connection.delete.dialogLabel')} ref={deleteDialogRef}>
            <div className={styles.confirmHead}>
              <span className={styles.confirmIconWrap}><TrashIcon /></span>
              <div>
                <h3 className={styles.formTitle}>{t('flow.connection.delete.confirm', { label: deleteTarget.label })}</h3>
                <p className={styles.confirmText}>
                  {t('flow.connection.delete.text', { u: deleteTarget.username, h: deleteTarget.host, p: deleteTarget.port })}
                </p>
              </div>
            </div>
            <div className={styles.formActions}>
              <span className={styles.gap} />
              <button type="button" className={styles.button} disabled={removingId !== null} onClick={() => { setDeleteTarget(null) }}>{t('flow.cancel')}</button>
              <button
                type="button"
                className={cx(styles.button, styles.danger)}
                disabled={removingId !== null}
                onClick={() => { void confirmRemove() }}
              >
                {removingId !== null && <SpinnerIcon className={styles.spin} />}
                {t('flow.connection.delete.title')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmTarget !== null && (
        <div className={styles.overlay} onClick={(event) => { if (event.target === event.currentTarget && hostPending === null) setConfirmTarget(null) }}>
          <div className={styles.smallDialog} role="dialog" aria-modal="true" aria-label={t('flow.ssh.confirm.dialogLabel')} ref={confirmDialogRef}>
            <div className={styles.confirmHead}>
              <span className={cx(styles.confirmIconWrap, styles.confirmIconInfo)}><ServerIcon /></span>
              <div>
                <h3 className={styles.formTitle}>{t('flow.ssh.confirm.title', { alias: confirmTarget.host.alias })}</h3>
                <p className={styles.confirmText}>
                  {confirmTarget.resolved.jump.length > 0
                    ? t('flow.ssh.confirm.text.jump', {
                        u: confirmTarget.resolved.username,
                        h: confirmTarget.resolved.host,
                        p: confirmTarget.resolved.port,
                        n: confirmTarget.resolved.jump.length,
                      })
                    : t('flow.ssh.confirm.text', {
                        u: confirmTarget.resolved.username,
                        h: confirmTarget.resolved.host,
                        p: confirmTarget.resolved.port,
                      })}
                </p>
              </div>
            </div>
            <div className={styles.formActions}>
              <span className={styles.gap} />
              <button type="button" className={styles.button} disabled={hostPending !== null} onClick={() => { setConfirmTarget(null) }}>{t('flow.cancel')}</button>
              <button
                type="button"
                className={cx(styles.button, styles.primary)}
                disabled={hostPending !== null}
                onClick={() => { void confirmAddHost() }}
              >
                {hostPending !== null && <SpinnerIcon className={styles.spin} />}
                {t('flow.ssh.confirm.submit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {formOpen && (
        <ConnectionForm
          rpc={rpc}
          draft={formDraft}
          t={t}
          onClose={() => { setFormOpen(false); setFormDraft(undefined) }}
          onSaved={(view) => { void formSaved(view) }}
        />
      )}
    </div>
  )
}
