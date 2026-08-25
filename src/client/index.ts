/**
 * Browser half of dsh-workspace-enhancement: the add-workspace directory flow —
 * a connection sidebar (saved connections, `~/.ssh/config` hosts, local entry)
 * beside the directory browser — plus the minimal machine-management settings
 * page (`settings.section`). Registered into both directory-flow holes and the
 * settings section, so mounting `dsh-workspace-enhancement` composes the whole
 * picking interaction. Cross-plane calls ride the shared web transport: local
 * listing through the `workspaces` service (the Host's `directoryPicker`
 * browse capability) and remote listing/connection management through the
 * package's `/dsw` RPC channel.
 */

import type { Context } from '@deepseek-ai/cordis'
import { SshWorkspaceFlow } from './flow.tsx'
import { installRowBadges } from './row-badges.ts'
import type { RowBadgeSources } from './row-badges.ts'
import { RemoteWorkspaceSettingsPage } from './settings.tsx'
import { SideWorkspacesAction } from './side-workspaces.tsx'

/** Local, self-contained wire contracts (no cross-plugin value imports). */
export interface WireEntry {
  name: string
  path: string
  hidden: boolean
}

export interface WireListing {
  path: string
  home: string
  crumbs: WireEntry[]
  entries: WireEntry[]
  truncated: boolean
}

export interface ConnectionView {
  id: string
  label: string
  host: string
  port: number
  username: string
  cwd?: string
  auth: 'password' | 'key' | 'agent'
  jumpHosts: string[]
}

/** One exact `~/.ssh/config` Host alias (the `config.hosts` wire row). */
export interface ConfigHostView {
  alias: string
  host: string
  username: string
  port: number
  identityFile: boolean
  jump: boolean
}

export type WireResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } }

/** The client workspace service's directory faces. */
export interface ClientWorkspaces {
  listDirectory(path?: string, signal?: AbortSignal): Promise<WireListing>
  createDirectory(path: string, name: string): Promise<string>
  /** The workspaces feed (present once the runtime workspace service is up). */
  list?: ClientSnapshot<{ items: readonly WorkspaceRowLike[] }>
}

/** One workspace registry projection row (the sidebar grouping source). */
export interface WorkspaceRowLike {
  title: string
  path: string
}

/** One session list projection row (the flat-mode sidebar source). */
export interface SessionRowLike {
  displayTitle: string
  cwd?: string
}

/** Minimal observable snapshot face of a runtime store. */
export interface ClientSnapshot<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/** The client connection handle's RPC face. */
export interface ClientConnection {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<WireResult>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      inject(key: string, callback: () => (() => void) | Iterable<() => void, void, void>): () => void
      register(options: {
        name: string
        /** List-slot row identity (required by SlotCore for list slots). */
        id?: string
        /** Nav/sort position of a list-slot row. */
        order?: number
        /** Registrant-localized display text (label resolver). */
        label?: () => string
        inject?: (...args: never[]) => Record<string, unknown>
      }, component: unknown): () => void
    }
    workspaces: ClientWorkspaces
  }
}

/** Required client services: the slot registry and the wire-facing workspace service. */
export const inject = ['slots', 'workspaces', 'sessions']

/**
 * Client plugin body: fill both directory-flow holes with the SSH workspace
 * flow, the settings section with the machine page, and install the sidebar
 * row badge layer (DOM compatibility). `slots.inject` waits for each hole's
 * declaration, and the generator installs the two registrations
 * transactionally.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const injected = (): Record<string, unknown> => ({
    listLocalDirectory: (path?: string, signal?: AbortSignal) => ctx.workspaces.listDirectory(path, signal),
    createLocalDirectory: (path: string, name: string) => ctx.workspaces.createDirectory(path, name),
    rpc: (endpoint: string, payload?: unknown, signal?: AbortSignal) => {
      const connection = ctx.get('connection') as ClientConnection | undefined
      if (connection === undefined) {
        return Promise.resolve({ ok: false, error: { code: 'internal', message: 'dsw: the web transport is not available' } } as WireResult)
      }
      return connection.rpc.call('/dsw', endpoint, payload ?? {}, signal)
    },
  })
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, SshWorkspaceFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow', inject: injected,
      }, SshWorkspaceFlow)
    }))
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-workspace-enhancement',
      order: 40,
      label: () => '远程工作区',
      inject: injected,
    }, RemoteWorkspaceSettingsPage))
  // R5: one per-session「工作区」button in the header action row — the single
  // entry point for attached side workspaces (add/edit perms/remove).
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'dsh-workspace-enhancement-side',
      order: 25,
      label: () => '工作区',
      inject: injected,
    }, SideWorkspacesAction))
  installSidebarRowBadges(ctx)
}

/**
 * Install the sidebar row badge layer (C3, DOM compatibility). Feeds project
 * from the runtime workspace/session stores; when a feed is absent (runtime
 * not yet up — the client runtime tier normally mounts before bundles),
 * grouped workspaces still mark and the flat mode degrades quietly.
 */
function installSidebarRowBadges(ctx: Context): void {
  const workspacesService = ctx.get('workspaces') as unknown as ClientWorkspaces | undefined
  const workspacesFeed = workspacesService?.list as ClientSnapshot<{ items: readonly WorkspaceRowLike[] }> | undefined
  const sessionsService = ctx.get('sessions') as unknown as { list?: ClientSnapshot<{ byId: Record<string, SessionRowLike> }> } | undefined
  const sessionsFeed = sessionsService?.list
  const sources: RowBadgeSources = {
    workspaces: () => workspacesFeed?.getSnapshot().items.map(item => ({ title: item.title, path: item.path })) ?? [],
    sessions: () => {
      const state = sessionsFeed?.getSnapshot()
      if (state === undefined) return []
      return Object.values(state.byId).map(row => ({
        title: row.displayTitle,
        ...(typeof row.cwd === 'string' ? { cwd: row.cwd } : {}),
      }))
    },
  }
  const dispose = installRowBadges(
    (endpoint, payload, signal) => {
      const connection = ctx.get('connection') as ClientConnection | undefined
      if (connection === undefined) {
        return Promise.resolve({ ok: false, error: { code: 'internal', message: 'dsw: the web transport is not available' } } as WireResult)
      }
      return connection.rpc.call('/dsw', endpoint, payload ?? {}, signal)
    },
    sources,
    onChange => {
      const un1 = workspacesFeed?.subscribe(onChange)
      const un2 = sessionsFeed?.subscribe(onChange)
      return () => {
        if (un1 !== undefined) un1()
        if (un2 !== undefined) un2()
      }
    },
  )
  ctx.effect(() => dispose, 'dsw: sidebar row badges')
}
