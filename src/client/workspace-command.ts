/**
 * REQ-I33: the `/workspace` slash command.
 *
 * The host command surface (`ctx.commandUi`, 0.2.2) accepts a client action
 * that consumes the token and runs no model turn. This module owns the
 * request the action raises and the adopt step after the directory flow
 * picks a path. The view that portals the flow lives in
 * `workspace-command-host.tsx`; older hosts without `commandUi` never register it.
 */

/** Slash token, without the leading slash. Must not collide with a host command. */
export const WORKSPACE_COMMAND = 'workspace'

/** Which session asked to add a workspace. Null while the flow is closed. */
export interface WorkspaceCommandRequest {
  readonly sessionId: string
}

/** The action and the overlay share one request. */
export interface WorkspaceCommandBridge {
  open(sessionId: string): void
  close(): void
  snapshot(): WorkspaceCommandRequest | null
  subscribe(listener: () => void): () => void
}

/** Host workspace registry face this command needs. */
export interface WorkspaceCreator {
  create(input: { path: string }): Promise<{ workspaceId?: string }>
}

/** Optional navigation after a workspace is registered. */
export interface WorkspaceOpener {
  openWorkspace?(workspaceId: string): Promise<void>
}

/** Copy for the three failures this module names itself. Host errors pass through. */
export interface AdoptMessages {
  empty: string
  unavailable: string
  noId: string
}

/**
 * One bridge. `open` replaces any in-flight request; listeners run after the
 * snapshot changes.
 */
export function createWorkspaceCommandBridge(): WorkspaceCommandBridge {
  let current: WorkspaceCommandRequest | null = null
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    open(sessionId: string): void {
      if (sessionId.trim() === '') return
      current = { sessionId }
      emit()
    },
    close(): void {
      if (current === null) return
      current = null
      emit()
    },
    snapshot(): WorkspaceCommandRequest | null {
      return current
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Register the picked directory as a workspace and open it when the host
 * navigation face is present. A blank path, a missing creator, or a create
 * result without an id fails before any open call.
 */
export async function adoptPickedWorkspace(
  path: string,
  workspaces: WorkspaceCreator | undefined,
  opener: WorkspaceOpener | undefined,
  messages: AdoptMessages,
): Promise<void> {
  const directory = path.trim()
  if (directory === '') throw new Error(messages.empty)
  if (typeof workspaces?.create !== 'function') throw new Error(messages.unavailable)
  const created = await workspaces.create({ path: directory })
  const id = created?.workspaceId
  if (typeof id !== 'string' || id.trim() === '') throw new Error(messages.noId)
  if (typeof opener?.openWorkspace === 'function') await opener.openWorkspace(id)
}
