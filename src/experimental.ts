/**
 * REQ-I31: EXPERIMENTAL toggles — deployment-local, file-backed, default OFF.
 *
 * One key today: `switchMachine`, the experimental `sw_use_machine` tool. The
 * settings page is the only write surface (`experimental.get` / `experimental.set`
 * on the `/api/dsw` channel); the tools half registers the gated tool only
 * while the key is on (关闭时工具不注册), re-registering on every flip so the
 * tool never lingers in the model's tool list.
 *
 * Storage mirrors the other dsw state files (session-connections,
 * session-workspaces): one JSON file (`<dsh home>/dsw-experimental.json`),
 * unknown/legacy fields ignored on read, a corrupt file warns and reads
 * all-off instead of failing the host. An absent file is all-off — a fresh
 * install never ships an experiment on.
 *
 * Validation errors are plain `dsw:` English here; the channel re-owns the
 * localized wording at its boundary (same rule as session-connections).
 * @module dsh-workspace-enhancement/experimental
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { dshHome } from './hostkey.ts'

/** The persisted file shape (`toggles` only; anything else is ignored). */
export interface ExperimentalFile {
  toggles: { switchMachine?: boolean }
}

/** Default state file path: `<dsh home>/dsw-experimental.json`. */
export function defaultExperimentalFile(dshBase?: string): string {
  return join(dshBase ?? dshHome(), 'dsw-experimental.json')
}

/** Load the persisted toggles (missing → all-off; corrupt → warn + all-off). */
export function loadExperimentalToggles(
  file: string,
  warn: (message: string) => void,
): { switchMachine: boolean } {
  if (!existsSync(file)) return { switchMachine: false }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ExperimentalFile>
    if (typeof parsed.toggles?.switchMachine === 'boolean') return { switchMachine: parsed.toggles.switchMachine }
  } catch (error) {
    warn(`dsw: cannot read experimental toggles ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { switchMachine: false }
}

/**
 * The experimental-toggles store (cordis service `experimentalToggles`).
 * Every mutator persists; a failed write warns and keeps the in-memory state
 * authoritative (the same honesty rule as the other dsw stores). Toggle
 * flips notify {@link onChange} listeners synchronously — the tools half
 * re-registers the gated tool inside the listener.
 */
export class ExperimentalToggles extends Service {
  private readonly file: string
  private switchMachineValue: boolean
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, opts?: { file?: string }) {
    super(ctx, 'experimentalToggles')
    this.file = opts?.file ?? defaultExperimentalFile()
    this.switchMachineValue = loadExperimentalToggles(this.file, message => this.ctx.logger.warn(message)).switchMachine
  }

  /** The physical state file (tests/displays). */
  get statePath(): string {
    return this.file
  }

  /** Whether the experimental switch-machine tool may register (default false). */
  switchMachine(): boolean {
    return this.switchMachineValue
  }

  /** Flip `switchMachine`, persist, and notify (a same-value call is a no-op). */
  setSwitchMachine(value: boolean): boolean {
    const next = value === true
    if (next === this.switchMachineValue) return next
    this.switchMachineValue = next
    void this.persist()
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        this.ctx.logger.warn(`dsw: experimental-toggle listener failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return next
  }

  /** Subscribe to toggle flips; returns the unsubscriber. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Persist (mkdir -p first; a failed write warns and never crashes the caller). */
  persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
    } catch {
      // A read-only home must not crash the session; the write below surfaces it.
    }
    try {
      writeFileSync(this.file, `${JSON.stringify({ toggles: { switchMachine: this.switchMachineValue } }, null, 2)}\n`, 'utf8')
    } catch (error) {
      this.ctx.logger.warn(`dsw: cannot persist experimental toggles ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    experimentalToggles: ExperimentalToggles
  }
}

/** Convenience: the default file path without touching the service. */
export const experimentalFilePath = (dshBase?: string): string => defaultExperimentalFile(dshBase)
