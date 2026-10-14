/**
 * Where the directory flow starts browsing (UX-11).
 *
 * An explicit connection id wins. With none, the registry's current machine
 * is the start — that is what Settings "set as current" is for. An unknown
 * id falls back to the local home.
 *
 * @module dsh-workspace-enhancement/client/browse-target
 */

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
    return knownIds.includes(explicit) ? { kind: 'remote', id: explicit } : { kind: 'local' }
  }
  const current = currentId.trim()
  if (current !== '' && knownIds.includes(current)) return { kind: 'remote', id: current }
  return { kind: 'local' }
}
