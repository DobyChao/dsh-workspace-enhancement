/** BUG-16: native resource routing that never asks a local editor to stat SSH files. */
import { remoteWorkspaceOf, baseName } from './remote-files.ts'
import { lexicalPosix, workspaceRelative } from '../remote-layout.ts'

export const NATIVE_REMOTE_FILE_ID = 'dsw:remote-file'

export interface RemoteFileTarget { sessionId: string; connectionId: string; path: string }

/** Decode the host file address, preserving absolute paths and rejecting malformed escapes. */
export function remoteFileTarget(address: string, cwdOf: (id: string) => string | undefined): RemoteFileTarget | null {
  const prefix = 'dsh-resource://file/session/'
  if (!address.startsWith(prefix)) return null
  try {
    const parts = address.slice(prefix.length).split('/').map(decodeURIComponent)
    const sessionId = parts.shift() ?? ''
    if (!sessionId || /[\\/\0]/u.test(sessionId)) return null
    const workspace = remoteWorkspaceOf(cwdOf(sessionId))
    if (workspace === null) return null
    const raw = parts.join('/')
    if (!raw || raw.includes('\0')) return null
    const routed = remoteWorkspaceOf(raw)
    if (routed !== null && routed.connectionId !== workspace.connectionId) return null
    // A Windows drive/UNC path that is not a placeholder still means a HOST file.
    if (routed === null && (/^[a-z]:/iu.test(raw) || raw.startsWith('\\\\') || raw.startsWith('//'))) return null
    const path = routed?.workspace ?? lexicalPosix(raw.startsWith('/') ? raw : `${workspace.workspace}/${raw}`)
    const relative = workspaceRelative(workspace.workspace, path)
    if (relative === undefined || relative === '') return null
    return { sessionId, connectionId: workspace.connectionId, path }
  } catch { return null }
}

export interface NativeFilesHost {
  get(name: string, optional?: boolean): unknown
  inject(deps: string[], mount: (ctx: NativeFilesHost) => void): unknown
  effect(fn: () => unknown, label?: string): unknown
  slots: {
    inject(name: string, mount: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
}

/** Feed reads are cheap and synchronous; the resource predicate never mutates a session. */
export function nativeCwdOf(ctx: Pick<NativeFilesHost, 'get'>, id: string): string | undefined {
  const sessions = ctx.get('sessions') as { list?: { getSnapshot(): { byId: Record<string, { cwd?: string }> } } } | undefined
  return sessions?.list?.getSnapshot().byId[id]?.cwd
}

/** Optional native registry: no better-sidebar dependency and no takeover of the files kind. */
export function installNativeRemoteFiles(ctx: NativeFilesHost, body: unknown, pathLabel: unknown): void {
  ctx.inject(['sidebarRightTabs'], owner => {
    const registry = owner.get('sidebarRightTabs') as { register?: (definition: unknown) => () => void } | undefined
    if (typeof registry?.register !== 'function') return
    owner.effect(() => registry.register!({
      id: NATIVE_REMOTE_FILE_ID,
      kind: NATIVE_REMOTE_FILE_ID,
      patterns: ['dsh-resource://file/session/**'],
      priority: 'extension',
      canOpen: (address: string) => remoteFileTarget(address, id => nativeCwdOf(owner, id)) !== null,
      title: (address: string) => baseName(remoteFileTarget(address, id => nativeCwdOf(owner, id))?.path ?? address),
    }), 'dsw native remote file type')
    owner.slots.inject('sidebar.right.pane.tab', () => owner.slots.register({
      name: 'sidebar.right.pane.tab', key: NATIVE_REMOTE_FILE_ID, locale: 'dsw',
      inject: () => ({ host: owner }),
    }, body))
  })
  ctx.slots.inject('sidebar.right.tab.files.actions', () => ctx.slots.register({
    name: 'sidebar.right.tab.files.actions', id: 'dsw:remote-path', order: -100, locale: 'dsw',
  }, pathLabel))
}
