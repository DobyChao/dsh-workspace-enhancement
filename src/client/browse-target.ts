/**
 * Where the directory flow starts browsing (UX-11 / UX-17).
 *
 * An explicit connection id wins. With none, the registry current id is the
 * start — Settings "set as default" writes that id. The sentinel `local`,
 * and any other unknown id, is this computer.
 *
 * @module dsh-workspace-enhancement/client/browse-target
 */

import { LOCAL_MACHINE_ID } from './machine-list.ts'

export type BrowseTarget =
  | { kind: 'local' }
  | { kind: 'remote'; id: string }

/**
 * @param explicitId - connection id the opener named (empty when the hero flow did not).
 * @param currentId - `machines.list` currentId.
 * @param knownIds - saved connection ids.
 */
export function initialBrowseTarget(
  explicitId: string,
  currentId: string,
  knownIds: readonly string[],
): BrowseTarget {
  const explicit = explicitId.trim()
  if (explicit !== '') {
    if (explicit === LOCAL_MACHINE_ID || !knownIds.includes(explicit)) return { kind: 'local' }
    return { kind: 'remote', id: explicit }
  }
  const current = currentId.trim()
  if (current !== '' && current !== LOCAL_MACHINE_ID && knownIds.includes(current)) {
    return { kind: 'remote', id: current }
  }
  return { kind: 'local' }
}
