/** Scoped display of the host cwd: remote directory plus its routing alias (UX-19). */
import type { Context } from '@deepseek-ai/cordis'
import { modelPrompt } from './model-prompts.ts'
import { workingDirectoryOf } from './remote-policy.ts'
import { remoteRouteFromCwd, sshRoutePlaceholder } from './transport.ts'

/** Preserve local cwd text; explicitly label both spellings for a remote cwd. */
export function workingDirectoryContextText(cwd: string): string {
  const route = remoteRouteFromCwd(cwd)
  if (route === null) return modelPrompt('workingDirectoryLocal', { directory: JSON.stringify(cwd) })
  return modelPrompt('workingDirectoryRemote', {
    remotePath: JSON.stringify(route.path),
    placeholder: JSON.stringify(sshRoutePlaceholder(route.connectionId, route.path)),
  })
}

interface DirectoryContext {
  name: string
  order: number
  required: boolean
  interpolate: boolean
  text: () => string
}

/**
 * Shadow the official context in each agent's scope, through the public registry.
 * The host's refreshContext re-evaluates this provider before every request.
 * No session cwd, host service, or installed package is changed. Older hosts
 * without workingDirectory/getContextOrder keep their existing context.
 */
export function registerWorkingDirectoryContext(ctx: Context): void {
  if (typeof ctx.on !== 'function' || typeof ctx.effect !== 'function') return
  const live = new Set<() => void>()
  ctx.effect(() => () => { for (const release of [...live]) release() }, 'dsw cwd context cleanup')
  const onCreated = (payload: { agent?: { ctx?: Context; session?: unknown } }): void => {
    const agent = payload.agent
    const target = agent?.ctx
    const directory = workingDirectoryOf(ctx)
    if (target === undefined || agent?.session === undefined || directory === undefined) return
    const prompt = target.systemPrompt as unknown as {
      getContextOrder?: (name: string) => number
      context: (entry: DirectoryContext) => () => void
    }
    if (typeof prompt.getContextOrder !== 'function') return
    let stop: () => void
    try {
      stop = prompt.context({
        name: 'working-directory:current',
        order: prompt.getContextOrder('WORKING_DIRECTORY'),
        required: true,
        interpolate: false,
        text: () => workingDirectoryContextText(directory.get(agent.session)),
      })
    } catch (error) {
      // A preset may already own this scoped name. Keep its provider and do
      // not let a display-only enhancement prevent the session from opening.
      ctx.logger?.warn?.(`dsw: cwd annotation unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const release = (): void => {
      if (!live.delete(release)) return
      stop()
    }
    live.add(release)
    target.effect(() => release, 'dsw scoped cwd context')
  }
  ctx.effect(() => ctx.on('agent/created' as never, onCreated as never), 'dsw cwd context agent hook')
}
