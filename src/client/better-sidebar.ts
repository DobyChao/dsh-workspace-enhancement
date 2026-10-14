/**
 * Optional better-sidebar integration (REQ-A6 A, B as affiliate).
 *
 * `dsh-better-sidebar` is an optional peer. This module never value-imports
 * it: the service is a cordis singleton, and a second copy would be a
 * different identity. Absence, a missing `registerTab`, or a throw from the
 * peer (including "already registered") leaves the rest of the plugin mounted.
 *
 * The tab id is `dsw:workspaces`. It does not register the host `files` kind.
 * The affiliate viewer claims only `.dsh-uploads` / `.dsh-artifacts` paths,
 * and only by content sniff, so it does not take the peer's own file viewers.
 *
 * @module dsh-workspace-enhancement/client/better-sidebar
 */

import { WORKSPACE_TAB_ID, REMOTE_VIEWER_ID, claimsRemoteArtifactPath } from './remote-files.ts'

/** Minimal host face. `get` is optional-service style; `effect` owns disposal. */
export interface BetterSidebarHost {
  get(name: string, optional?: boolean): unknown
  effect(fn: () => unknown, label?: string): unknown
}

/** What we need from `ctx.betterSidebar`. Everything else is ignored. */
export interface BetterSidebarProbe {
  registerTab: (descriptor: WorkspaceTabDescriptor) => (() => void) | void
  registerFileViewer?: (descriptor: AffiliateViewerDescriptor) => (() => void) | void
  /** Monotonic capability list. Missing on peers older than the features field. */
  features: readonly string[]
}

/** Tab registration. Fields match the peer's long-standing descriptor core. */
export interface WorkspaceTabDescriptor {
  id: typeof WORKSPACE_TAB_ID
  title: () => string
  description: () => string
  order: number
  single: true
  component: (props: unknown) => unknown
}

/** Affiliate file viewer. `exts: []` plus `detect` is sniff-only, not a catch-all. */
export interface AffiliateViewerDescriptor {
  id: typeof REMOTE_VIEWER_ID
  title: () => string
  exts: readonly []
  priority: number
  fetchStrategy: 'custom'
  detect: (path: string, head?: Uint8Array) => boolean
  load: (path: string, scope: { sessionId?: string }, signal?: AbortSignal) => Promise<unknown>
  component: (props: unknown) => unknown
}

export interface BetterSidebarInstall {
  title: () => string
  description: () => string
  /** Panel component. Typed loosely: the peer passes its own props object. */
  component: unknown
  viewerTitle: () => string
  load: (path: string, scope: { sessionId?: string }, signal?: AbortSignal) => Promise<unknown>
  /** Affiliate viewer component. */
  viewer: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Capability probe. No service, or no `registerTab` function, degrades to
 * undefined. `features` defaults to an empty list so newer fields stay off
 * until the peer advertises them. Version strings are not compared.
 */
export function probeBetterSidebar(value: unknown): BetterSidebarProbe | undefined {
  if (!isRecord(value) || typeof value.registerTab !== 'function') return undefined
  const features = Array.isArray(value.features)
    ? value.features.filter((item): item is string => typeof item === 'string')
    : []
  const probe: BetterSidebarProbe = {
    registerTab: value.registerTab as BetterSidebarProbe['registerTab'],
    features,
  }
  if (typeof value.registerFileViewer === 'function') {
    probe.registerFileViewer = value.registerFileViewer as NonNullable<BetterSidebarProbe['registerFileViewer']>
  }
  return probe
}

/** Whether a probed peer advertises one capability. Absent features never match. */
export function sidebarHasFeature(probe: BetterSidebarProbe, feature: string): boolean {
  return probe.features.includes(feature)
}

/** The workspace tab. Id is ours; order sits after the peer's own builtins. */
export function workspaceTabDescriptor(input: {
  title: () => string
  description: () => string
  component: unknown
}): WorkspaceTabDescriptor {
  return {
    id: WORKSPACE_TAB_ID,
    title: input.title,
    description: input.description,
    order: 80,
    single: true,
    component: input.component as WorkspaceTabDescriptor['component'],
  }
}

/**
 * Affiliate viewer (B). `detect` is true only for upload/artifact paths.
 * With `exts: []` the peer treats a detect-miss as sniff-only and does not
 * claim the file, so ordinary extensions stay with the peer's own viewers.
 */
export function affiliateViewerDescriptor(input: {
  title: () => string
  load: AffiliateViewerDescriptor['load']
  component: unknown
}): AffiliateViewerDescriptor {
  return {
    id: REMOTE_VIEWER_ID,
    title: input.title,
    exts: [],
    priority: 40,
    fetchStrategy: 'custom',
    detect: (path) => claimsRemoteArtifactPath(path),
    load: input.load,
    component: input.component as AffiliateViewerDescriptor['component'],
  }
}

function guarded(register: () => (() => void) | void): () => void {
  try {
    const dispose = register()
    return typeof dispose === 'function' ? dispose : () => {}
  } catch {
    return () => {}
  }
}

/**
 * Register the workspace tab, and the affiliate viewer when the peer has
 * `registerFileViewer`. Returns false when the peer is absent — callers keep
 * going. Registrations are effect-scoped so unload removes them.
 */
export function installBetterSidebar(ctx: BetterSidebarHost, input: BetterSidebarInstall): boolean {
  const probe = probeBetterSidebar(ctx.get('betterSidebar'))
  if (probe === undefined) return false
  const tab = workspaceTabDescriptor(input)
  ctx.effect(
    () => guarded(() => probe.registerTab(tab)),
    'dsw better-sidebar workspace tab',
  )
  if (probe.registerFileViewer !== undefined) {
    const viewer = affiliateViewerDescriptor({
      title: input.viewerTitle,
      load: input.load,
      component: input.viewer,
    })
    const registerViewer = probe.registerFileViewer
    ctx.effect(
      () => guarded(() => registerViewer(viewer)),
      'dsw better-sidebar remote viewer',
    )
  }
  return true
}
