/** BUG-17: bind world-less shell discovery to one browser terminal request. */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { remoteRouteFromCwd } from './transport.ts'

const requests = new AsyncLocalStorage<{ cwd: string | undefined }>()

/** Only browser terminal shell lookup uses this scope; ordinary calls stay local. */
export function browserTerminalCwd(): string | undefined {
  return requests.getStore()?.cwd
}

interface TerminalAgent { session?: { header?: { cwd?: string } } }
interface TerminalFace {
  shells?: (agent: TerminalAgent, ...args: unknown[]) => unknown
  create?: (agent: TerminalAgent, ...args: unknown[]) => unknown
}

const installed = new WeakSet<object>()

/** Optional controller, reversible wrappers, no mutation of Agent or service defaults. */
export function installBrowserTerminalRouting(ctx: Context): void {
  const mount = (owner: Context): void => {
    const controller = owner.get('terminalController' as 'agents', false) as unknown as TerminalFace | undefined
    if (controller === undefined || installed.has(controller)) return
    owner.effect(() => {
      installed.add(controller)
      const restorers: Array<() => void> = []
      for (const key of ['shells', 'create'] as const) {
        const original = controller[key]
        if (typeof original !== 'function') continue
        const wrapped = function(this: unknown, agent: TerminalAgent, ...args: unknown[]): unknown {
          const cwd = agent?.session?.header?.cwd
          // A local nested call must shadow an outer remote request too.
          return requests.run({ cwd: remoteRouteFromCwd(cwd) === null ? undefined : cwd },
            () => original.call(this, agent, ...args))
        }
        controller[key] = wrapped
        restorers.push(() => { if (controller[key] === wrapped) controller[key] = original })
      }
      return () => { for (const restore of restorers) restore(); installed.delete(controller) }
    }, 'dsw browser terminal session routing')
  }
  // inject also mounts a controller loaded after this plugin and cleans up on unload.
  if (typeof ctx.inject === 'function') ctx.inject(['terminalController'], mount)
}
