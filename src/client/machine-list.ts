/**
 * Settings machine-list rules (UX-17).
 *
 * `local` is this computer. It is the same reserved id the registry refuses
 * to store as an SSH machine. Settings may still mark it as the default start
 * (`currentId`). The visible label is "default"; the stored key stays `currentId`.
 *
 * @module dsh-workspace-enhancement/client/machine-list
 */

/** This computer, in the settings list and as a `currentId` sentinel. */
export const LOCAL_MACHINE_ID = 'local'

/** Which row actions apply. The local row is not an SSH machine. */
export interface MachineRowPolicy {
  canSetDefault: boolean
  canEdit: boolean
  canForgetKey: boolean
  canCoreStatus: boolean
  canDeploy: boolean
  canDelete: boolean
}

const REMOTE_ROW: MachineRowPolicy = {
  canSetDefault: true,
  canEdit: true,
  canForgetKey: true,
  canCoreStatus: true,
  canDeploy: true,
  canDelete: true,
}

const LOCAL_ROW: MachineRowPolicy = {
  canSetDefault: true,
  canEdit: false,
  canForgetKey: false,
  canCoreStatus: false,
  canDeploy: false,
  canDelete: false,
}

/** Actions for one settings row. Any id other than this computer is a remote machine. */
export function machineRowPolicy(id: string): MachineRowPolicy {
  return id === LOCAL_MACHINE_ID ? LOCAL_ROW : REMOTE_ROW
}

/**
 * Whether `rowId` is the default start for a new workspace.
 * An empty or unknown current id, including the local sentinel, means this computer.
 */
export function isDefaultStart(currentId: string, rowId: string, remoteIds: readonly string[]): boolean {
  const current = currentId.trim()
  const remoteIsDefault = current !== '' && current !== LOCAL_MACHINE_ID && remoteIds.includes(current)
  if (rowId === LOCAL_MACHINE_ID) return !remoteIsDefault
  return remoteIsDefault && rowId === current
}
