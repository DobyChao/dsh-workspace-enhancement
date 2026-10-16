/**
 * Wire id for a reachability probe of an ssh-config host that is not a saved
 * machine. The colon keeps it out of the registry id alphabet, so it cannot
 * be persisted or routed as `ssh://<id>`.
 * @module dsh-workspace-enhancement/config-probe
 */

/** Scheduler and wire id for one exact `~/.ssh/config` Host alias. */
export function configProbeId(alias: string): string {
  return `config:${alias}`
}
