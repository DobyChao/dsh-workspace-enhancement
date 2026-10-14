/**
 * Remote uploads and artifacts (REQ-A6 C2). The tree reuses `browse.list`;
 * the header reuses the remote-status chip. A file click opens the host
 * document preview when that bridge can read remote content, and always
 * renders text, image, or PDF bytes in this panel so a local-only resource
 * URL is never the only result.
 *
 * @module dsh-workspace-enhancement/client/remote-files-panel
 */

import { useEffect, useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { API_CHANNEL, channelEndpointOf } from '../web-channel.ts'
import type { WireResult } from './index.ts'
import { createRemoteStatusSeats } from './remote-status.ts'
import type { RemoteSessionsFeed } from './remote-status.ts'
import { RemoteStatusAction } from './remote-status-entry.tsx'
import { zhBaseline } from './status.tsx'
import type { RpcCall } from './status.tsx'
import { FolderIcon } from './icons.tsx'
import {
  asPreviewWire,
  baseName,
  inWorkspaceExtras,
  isMissingListing,
  listedLevel,
  previewChoice,
  remoteWorkspaceOf,
  specialRoots,
  workspaceFilesOf,
} from './remote-files.ts'
import type { ListedEntry, PreviewWire } from './remote-files.ts'
import styles from './remote-files.module.css'

/** Props better-sidebar passes. Only the fields this panel reads are named. */
export interface RemoteFilesTabProps {
  ctx: {
    get(name: string, optional?: boolean): unknown
    locale?: { bind(ns: 'dsw'): TranslateNS<'dsw'> }
  }
  scope: { sessionId?: string }
  visible?: boolean
}

/** Props the affiliate viewer passes through from the peer. */
export interface RemoteFileViewerProps {
  path?: string
  customData?: unknown
  scope?: { sessionId?: string }
}

interface LevelState {
  status: 'loading' | 'ready' | 'missing' | 'error'
  entries: ListedEntry[]
  truncated: boolean
  error?: string
}

interface PreviewState {
  path: string
  status: 'loading' | 'ready' | 'error'
  hostAddress?: string
  wire?: PreviewWire
  error?: string
}

function rpcOf(ctx: RemoteFilesTabProps['ctx'], fallback: string): RpcCall {
  return (endpoint, payload, signal) => {
    const connection = ctx.get('connection') as { rpc?: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<WireResult> } } | undefined
    if (connection?.rpc === undefined) {
      return Promise.resolve({ ok: false, error: { code: 'internal', message: fallback } })
    }
    return connection.rpc.call(API_CHANNEL, channelEndpointOf(endpoint), payload ?? {}, signal)
  }
}

function unwrap(result: WireResult, fallback: string): unknown {
  if (!result.ok) throw new Error(result.error.message || fallback)
  return result.value
}

/** In-plugin preview of one `browse.read` document. */
export function RemotePreviewBody(props: {
  wire: PreviewWire
  t: TranslateNS<'dsw'>
}): JSX.Element {
  const { wire, t } = props
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if ((wire.kind !== 'image' && wire.kind !== 'pdf') || wire.base64 === undefined || wire.mediaType === undefined) {
      setUrl(undefined)
      return undefined
    }
    const binary = Uint8Array.from(atob(wire.base64), char => char.charCodeAt(0))
    const blob = new Blob([binary], { type: wire.mediaType })
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [wire.kind, wire.base64, wire.mediaType])
  if (wire.kind === 'text') {
    return (
      <div className={styles.previewBody} data-dsw-remote-preview="text">
        {wire.truncated ? <p className={styles.note}>{t('files.preview.truncated')}</p> : null}
        <pre className={styles.pre}>{wire.text ?? ''}</pre>
      </div>
    )
  }
  if (wire.kind === 'image' && url !== undefined) {
    return (
      <div className={styles.previewBody} data-dsw-remote-preview="image">
        <img className={styles.image} src={url} alt={wire.name} />
      </div>
    )
  }
  if (wire.kind === 'pdf' && url !== undefined) {
    return (
      <div className={styles.previewBody} data-dsw-remote-preview="pdf">
        <iframe className={styles.frame} title={wire.name} src={url} />
      </div>
    )
  }
  const note = wire.truncated && (wire.kind === 'image' || wire.kind === 'pdf')
    ? t('files.preview.tooLarge')
    : t('files.preview.binary')
  return (
    <div className={styles.previewBody} data-dsw-remote-preview={wire.kind}>
      <p className={styles.note}>{note}</p>
    </div>
  )
}

/** Affiliate viewer body: renders whatever `load` put in `customData`. */
export function RemoteFileViewer(props: RemoteFileViewerProps): JSX.Element {
  const wire = asPreviewWire(props.customData)
  if (wire === undefined) {
    return <p className={styles.note} data-dsw-remote-preview="error">{props.path ?? ''}</p>
  }
  return <RemotePreviewBody wire={wire} t={zhBaseline} />
}

/** Workspace tab: the two remote trees, in-workspace extras, and a preview. */
export function RemoteFilesTab(props: RemoteFilesTabProps): JSX.Element {
  const t = props.ctx.locale?.bind('dsw') ?? zhBaseline
  const sessionId = props.scope.sessionId ?? ''
  const rpc = useMemo(() => rpcOf(props.ctx, t('rpc.transportUnavailable')), [props.ctx, t])
  const seats = useMemo(() => createRemoteStatusSeats(() => {
    const sessions = props.ctx.get('sessions') as { list?: RemoteSessionsFeed } | undefined
    return sessions?.list
  }), [props.ctx])
  const [cwd, setCwd] = useState<string | undefined>(() => seats.remoteFacts(sessionId)?.cwd)
  const [levels, setLevels] = useState<Record<string, LevelState>>({})
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({})
  const [extras, setExtras] = useState<string[]>([])
  const [preview, setPreview] = useState<PreviewState | undefined>(undefined)
  const workspace = remoteWorkspaceOf(cwd)
  const workspacePath = workspace?.workspace

  useEffect(() => {
    setLevels({})
    setOpenDirs({})
    setExtras([])
    setPreview(undefined)
  }, [cwd, sessionId])

  useEffect(() => {
    const sync = (): void => {
      const next = seats.remoteFacts(sessionId)?.cwd
      setCwd(prev => (prev === next ? prev : next))
    }
    sync()
    return seats.subscribeRemote(sync)
  }, [seats, sessionId])

  useEffect(() => {
    if (props.visible === false || workspacePath === undefined) return undefined
    const controller = new AbortController()
    void rpc('session.files', { sessionId }, controller.signal)
      .then(result => {
        if (!result.ok || !isRecord(result.value)) return
        const artifacts = Array.isArray(result.value.artifacts)
          ? result.value.artifacts.filter((item): item is string => typeof item === 'string')
          : []
        setExtras(inWorkspaceExtras(workspacePath, artifacts))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [props.visible, rpc, sessionId, workspacePath])

  const loadDir = (path: string): void => {
    if (workspace === null) return
    setLevels(prev => ({ ...prev, [path]: { status: 'loading', entries: [], truncated: false } }))
    void rpc('browse.files', { id: workspace.connectionId, path, sessionId })
      .then(result => {
        const level = listedLevel(unwrap(result, t('rpc.browseList')))
        if (level === undefined) {
          setLevels(prev => ({ ...prev, [path]: { status: 'error', entries: [], truncated: false, error: t('files.preview.failed') } }))
          return
        }
        setLevels(prev => ({
          ...prev,
          [path]: { status: 'ready', entries: level.entries, truncated: level.truncated },
        }))
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t('files.preview.failed')
        setLevels(prev => ({
          ...prev,
          [path]: {
            status: isMissingListing(message) ? 'missing' : 'error',
            entries: [],
            truncated: false,
            ...(isMissingListing(message) ? {} : { error: message }),
          },
        }))
      })
  }

  const toggleDir = (path: string): void => {
    setOpenDirs(prev => {
      const next = !prev[path]
      if (next && levels[path] === undefined) loadDir(path)
      return { ...prev, [path]: next }
    })
  }

  const openFile = (path: string): void => {
    if (workspace === null) return
    const bridge = props.ctx.get('sidebarRight')
    const remote = props.ctx.get('remote')
    const openResource = isRecord(bridge) ? bridge.openResource : undefined
    const choice = previewChoice({
      sessionId,
      workspace: workspace.workspace,
      remotePath: path,
      openResource,
      workspaceFiles: workspaceFilesOf(remote),
    })
    setPreview({ path, status: 'loading' })
    let hostAddress: string | undefined
    if (choice.kind === 'host' && typeof openResource === 'function') {
      try {
        const opened: unknown = openResource(choice.address)
        hostAddress = choice.address
        if (isPromise(opened)) {
          void opened.catch(() => {
            setPreview(prev => {
              if (prev === undefined || prev.path !== path) return prev
              const next = { ...prev }
              delete next.hostAddress
              return next
            })
          })
        }
      } catch {
        hostAddress = undefined
      }
    }
    void rpc('browse.read', { id: workspace.connectionId, path, sessionId })
      .then(result => {
        const wire = asPreviewWire(unwrap(result, t('files.preview.failed')))
        if (wire === undefined) {
          setPreview({ path, status: 'error', ...(hostAddress !== undefined ? { hostAddress } : {}), error: t('files.preview.failed') })
          return
        }
        setPreview({ path, status: 'ready', wire, ...(hostAddress !== undefined ? { hostAddress } : {}) })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t('files.preview.failed')
        setPreview({ path, status: 'error', ...(hostAddress !== undefined ? { hostAddress } : {}), error: message })
      })
  }

  return (
    <section className={styles.panel} data-dsw-remote-files="panel" aria-label={t('files.tab.title')}>
      <header className={styles.toolbar}>
        <h2 className={styles.title}>{t('files.tab.title')}</h2>
        <RemoteStatusAction sessionId={sessionId} rpc={rpc} t={t} {...seats} />
      </header>
      {workspace === null ? (
        <p className={styles.note} data-dsw-remote-files="local">{t('files.local')}</p>
      ) : (
        <div className={styles.body}>
          <div className={styles.tree} role="tree">
            {specialRoots(workspace.workspace).map(root => (
              <TreeDir
                key={root.id}
                path={root.path}
                label={t(root.id === 'uploads' ? 'files.root.uploads' : 'files.root.artifacts')}
                rootId={root.id}
                open={openDirs[root.path] === true}
                level={levels[root.path]}
                openDirs={openDirs}
                levels={levels}
                t={t}
                onToggle={toggleDir}
                onFile={openFile}
              />
            ))}
            {extras.length > 0 ? (
              <div className={styles.group}>
                <p className={styles.groupLabel}>{t('files.extras')}</p>
                {extras.map(path => (
                  <button
                    key={path}
                    type="button"
                    className={styles.file}
                    data-dsw-remote-file={path}
                    onClick={() => openFile(path)}
                  >
                    {baseName(path)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.preview}>
            <PreviewPane preview={preview} t={t} />
          </div>
        </div>
      )}
    </section>
  )
}

function PreviewPane(props: { preview: PreviewState | undefined; t: TranslateNS<'dsw'> }): JSX.Element {
  const { preview, t } = props
  if (preview === undefined) return <p className={styles.note}>{t('files.preview.idle')}</p>
  return (
    <div className={styles.previewPane}>
      <p className={styles.previewName}>{baseName(preview.path)}</p>
      {preview.hostAddress !== undefined ? <p className={styles.note} data-dsw-remote-preview="host">{t('files.preview.host')}</p> : null}
      {preview.status === 'loading' ? <p className={styles.note}>{t('files.loading')}</p> : null}
      {preview.status === 'error' ? <p className={styles.note} data-dsw-remote-preview="error">{preview.error}</p> : null}
      {preview.status === 'ready' && preview.wire !== undefined ? <RemotePreviewBody wire={preview.wire} t={t} /> : null}
    </div>
  )
}

function TreeDir(props: {
  path: string
  label: string
  rootId?: 'uploads' | 'artifacts'
  open: boolean
  level: LevelState | undefined
  openDirs: Record<string, boolean>
  levels: Record<string, LevelState>
  t: TranslateNS<'dsw'>
  onToggle: (path: string) => void
  onFile: (path: string) => void
}): JSX.Element {
  const { level, t } = props
  return (
    <div className={styles.dir} role="treeitem" aria-expanded={props.open}>
      <button
        type="button"
        className={styles.dirButton}
        data-dsw-remote-root={props.rootId}
        data-dsw-remote-dir={props.path}
        onClick={() => props.onToggle(props.path)}
      >
        <FolderIcon width={14} height={14} />
        <span>{props.label}</span>
      </button>
      {props.open ? (
        <div className={styles.children} role="group">
          {level === undefined || level.status === 'loading' ? <p className={styles.note}>{t('files.loading')}</p> : null}
          {level?.status === 'missing' ? <p className={styles.note}>{t('files.missing')}</p> : null}
          {level?.status === 'error' ? <p className={styles.note}>{level.error ?? t('files.preview.failed')}</p> : null}
          {level?.status === 'ready' && level.entries.length === 0 ? <p className={styles.note}>{t('files.empty')}</p> : null}
          {level?.entries.map(entry => (
            entry.kind === 'directory' ? (
              <TreeDir
                key={entry.path}
                path={entry.path}
                label={entry.name}
                open={props.openDirs[entry.path] === true}
                level={props.levels[entry.path]}
                openDirs={props.openDirs}
                levels={props.levels}
                t={t}
                onToggle={props.onToggle}
                onFile={props.onFile}
              />
            ) : (
              <button
                key={entry.path}
                type="button"
                className={styles.file}
                data-dsw-remote-file={entry.path}
                onClick={() => props.onFile(entry.path)}
              >
                {entry.name}
              </button>
            )
          ))}
          {level?.truncated ? <p className={styles.note}>{t('files.truncated')}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function'
}
