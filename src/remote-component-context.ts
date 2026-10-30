/**
 * Per-machine "is the remote component in effect?" lines for the
 * `dsw-session-workspace` runtime context.
 *
 * The host evaluates `PromptContext.text` synchronously, before the
 * `system-prompt/assemble` waterfall. A live SSH probe cannot run inside
 * `text`. Callers probe (or reuse {@link cachedCoreEffect}) and then
 * {@link withRemoteComponentLines} on the assembly the waterfall returns.
 *
 * "In effect" is {@link coreDiskCurrent}: same major.minor, and a known
 * sha256 when the probe hashed the file. A version-only status that never
 * hashed stays in effect so an older probe does not look like a refusal.
 * @module dsh-workspace-enhancement/remote-component-context
 */

import type { CoreStatusView } from './core-hub.ts'
import { CORE_ARTIFACT_VERSION, coreDiskCurrent, coreVersionAccepted } from './core-protocol.ts'
import { modelPrompt } from './model-prompts.ts'

/** How long a probe may be reused. A successful deploy must {@link forgetCoreEffect}. */
export const CORE_EFFECT_TTL_MS = 60_000

/** The runtime-context contribution these lines are appended to. */
export const SESSION_WORKSPACE_CONTEXT = 'dsw-session-workspace'

/** One machine's last probe, as the runtime context will describe it. */
export interface RemoteComponentFact {
  id: string
  view: CoreStatusView
}

interface CacheEntry {
  at: number
  view: CoreStatusView
}

const cache = new Map<string, CacheEntry>()

/** Remember a probe so the next prompt assembly does not SSH again. */
export function rememberCoreEffect(id: string, view: CoreStatusView, at = Date.now()): void {
  cache.set(id, { at, view })
}

/** Drop one machine's probe. Call this after a deploy replaces the binary. */
export function forgetCoreEffect(id: string): void {
  cache.delete(id)
}

/** Last probe for `id`, or `undefined` once {@link CORE_EFFECT_TTL_MS} has passed. */
export function cachedCoreEffect(id: string, now = Date.now()): CoreStatusView | undefined {
  const hit = cache.get(id)
  if (hit === undefined) return undefined
  if (now - hit.at >= CORE_EFFECT_TTL_MS) {
    cache.delete(id)
    return undefined
  }
  return hit.view
}

/** Test isolation. Production never clears the whole map. */
export function clearCoreEffectCache(): void {
  cache.clear()
}

/** Collapse a probe detail so it cannot break `{{name}}` interpolation. */
function plain(detail: string): string {
  return detail.replaceAll('{{', '').replaceAll('}}', '').replaceAll('\n', ' ').slice(0, 180)
}

/** One English line for one machine. */
function lineOf(fact: RemoteComponentFact): string {
  const { id, view } = fact
  const version = view.version ?? 'unknown'
  if (coreDiskCurrent(view)) return modelPrompt('remoteComponentActive', { id, version })
  if (view.ok && coreVersionAccepted(version)) {
    if (view.sha256 === null) return modelPrompt('remoteComponentUnreadable', { id, version })
    return modelPrompt('remoteComponentUntrusted', { id, version })
  }
  if (view.ok) {
    return modelPrompt('remoteComponentMismatch', { id, found: version, expected: CORE_ARTIFACT_VERSION })
  }
  if ((view.detail ?? '').includes('not installed')) return modelPrompt('remoteComponentMissing', { id })
  const detail = plain(view.detail ?? 'probe failed')
  return modelPrompt('remoteComponentError', { id, detail: detail === '' ? 'probe failed' : detail })
}

/**
 * Heading plus one line per machine, in the given order. Empty when there
 * are no machines — a local session must stay silent.
 */
export function renderRemoteComponentContext(facts: readonly RemoteComponentFact[]): string {
  if (facts.length === 0) return ''
  return [modelPrompt('remoteComponentHeading'), ...facts.map(lineOf)].join('\n')
}

/** An assembly slice that carries resolved runtime-context text. */
export interface ContextAssembly {
  contexts: ReadonlyArray<{ name: string; text: string }>
}

/**
 * Append the component lines to `dsw-session-workspace`.
 *
 * A missing contribution (runtime context suppressed, or this plugin did not
 * register) is left alone — the lines are not invented as a new section.
 * Empty `lines` is a no-op.
 */
export function withRemoteComponentLines<T extends ContextAssembly>(assembly: T, lines: string): T {
  if (lines === '') return assembly
  let found = false
  const contexts = assembly.contexts.map((entry) => {
    if (entry.name !== SESSION_WORKSPACE_CONTEXT) return entry
    found = true
    const text = entry.text === '' ? lines : `${entry.text}\n${lines}`
    return { ...entry, text }
  })
  if (!found) return assembly
  return { ...assembly, contexts }
}
