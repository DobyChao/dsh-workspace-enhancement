/**
 * The client-side spelling of the host's route-placeholder rule: recover the
 * registry connection id from a local placeholder path
 * (`…/dsw-routes/<id>/<remote path>` or the legacy `dsh-ssh-routes/` tree).
 *
 * WHY IT IS ITS OWN MODULE (t4): two client consumers need the same rule — the
 * DOM row-badge layer (`./row-badges.ts`, which looks the id up on workspace
 * paths) and the official-slot remote-status entry (`./remote-status.ts`, which
 * looks it up on a session cwd). `row-badges.ts` imports `status.tsx` for its
 * palette, and the sandbox test runner cannot load `.tsx` (not even
 * transitively — `ERR_UNKNOWN_FILE_EXTENSION`), so a pure-`.ts` home is what
 * lets the entry's judgment be unit-tested by `npm run test:agent`. The body
 * below is the function `row-badges.ts` used to define; it re-exports it
 * unchanged, so that layer behaves exactly as before.
 * @module dsh-workspace-enhancement/client/route-id
 */

/**
 * The registry connection id inside a route-placeholder path, or undefined.
 * Mirrors the host's `routeFromPlaceholder` root/id rules: the id is the first
 * path segment under the placeholder root and must be a safe registry id.
 * @param path - a workspace path or session cwd (any spelling that is not `ssh://`).
 * @returns the connection id, or undefined when the path names no route.
 */
export function routeIdOf(path: string): string | undefined {
  const match = /(?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i.exec(path)
  if (match === null) return undefined
  const id = match[1]
  if (id === undefined || !/^[A-Za-z0-9._-]+$/.test(id)) return undefined
  return id
}
