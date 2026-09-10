/**
 * Local-pane directory seats for the two `directoryFlow` slots.
 *
 * The local pane browses the HOST filesystem, and the client service that owns
 * that capability is **`uiWorkspace`** — the Workspace Controller's UI face.
 * Upstream builds it as `new UiWorkspaceService(...)` whose constructor runs
 * `super(ctx, "uiWorkspace")` and implements `listDirectory(path, signal)` /
 * `createDirectory(path, name)` there
 * (`dsh-client-ui-workspace/lib/client.js:37`, `:85`, `:90`); the official
 * browse picker calls `ctx.uiWorkspace.listDirectory(path, signal)`
 * (`dsh-client-ui-directory-picker-browse/lib/client.js:1023`).
 *
 * The similarly named **`workspaces`** service is the controller's own face
 * (create / rename / delete / archiveSession / list — Service Catalog
 * `key: "workspaces"`, `dsh-cordis-client-runner/lib/client.js:1488`) and has
 * neither method. Wiring the seats to it made the local pane fail with
 * `ctx.workspaces.listDirectory is not a function` (BUG-3).
 *
 * Resolution is lazy and optional (`ctx.get`, never `inject`): a renamed or
 * missing service must degrade to one localized error line inside the pane,
 * never stop the rest of the plugin (settings page, side workspaces) from
 * mounting.
 *
 * @module dsh-workspace-enhancement/client/local-directory
 */

import type { WireListing } from './index.ts'

/** The `uiWorkspace` client service face this plugin consumes. */
export interface ClientUiWorkspace {
  listDirectory(path?: string, signal?: AbortSignal): Promise<WireListing>
  createDirectory(path: string, name: string): Promise<string>
}

/** The two seats injected into the `directoryFlow` slot registrations. */
export interface LocalDirectorySeats {
  listLocalDirectory(path?: string, signal?: AbortSignal): Promise<WireListing>
  createLocalDirectory(path: string, name: string): Promise<string>
}

/**
 * Build the local-pane seats.
 *
 * @param resolve - reads the live `uiWorkspace` service; `undefined` while the
 * service is absent (or when the runtime has not mounted it at all).
 * @param unavailable - localized message used when the service (or its
 * directory methods) is missing; the pane renders it as the browse error.
 * @returns seats that forward to the service, or reject with `unavailable()`.
 */
export function createLocalDirectorySeats(
  resolve: () => ClientUiWorkspace | undefined,
  unavailable: () => string,
): LocalDirectorySeats {
  // Guard the method too, not just the service: a future upstream rename of the
  // service would surface as a localized message instead of a raw TypeError.
  const require = (): ClientUiWorkspace => {
    const service = resolve()
    if (service === undefined || typeof service.listDirectory !== 'function') {
      throw new Error(unavailable())
    }
    return service
  }
  return {
    listLocalDirectory: async (path, signal) => require().listDirectory(path, signal),
    createLocalDirectory: async (path, name) => require().createDirectory(path, name),
  }
}
