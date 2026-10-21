/**
 * Workspace-hover rewrite (UX-16). The host's workspace hover card prints the
 * stored cwd, which for a remote workspace is the local placeholder
 * (`…/dsw-routes/<id>/…`). There is no slot on that card, so the row layer
 * rewrites the path line once it is in the DOM: the server, then the real
 * remote path. Copy stays the host's original cwd — that string lives in the
 * hover card's React prop, not in the text node.
 *
 * The card's shape (title, path, created-at — the path is the second element
 * child) is what identifies the line. A hashed CSS module class would break
 * on the next host build.
 * @module dsh-workspace-enhancement/client/workspace-hover
 */

import { routeOfCwd } from './cockpit.ts'

/** Remembers the placeholder so a later probe can fill in the server name. */
export const HOVER_SOURCE_ATTR = 'data-dsw-hover-source'

/** The machine facts the status probe already holds. */
export interface HoverMachine {
  label: string
  username: string
  host: string
  port: number
}

/**
 * One line naming the server. A nickname that is not itself `user@host`
 * leads; otherwise the endpoint stands alone. No probe yet → the registry id.
 */
export function serverLine(connectionId: string, machine: HoverMachine | undefined): string {
  if (machine === undefined) return connectionId
  const username = machine.username.trim()
  const host = machine.host.trim()
  const endpoint = username !== '' && host !== '' ? `${username}@${host}:${machine.port}` : ''
  const label = machine.label.trim()
  const bare = username !== '' && host !== '' ? `${username}@${host}` : ''
  if (endpoint !== '' && (label === '' || label === endpoint || label === bare)) return endpoint
  if (label !== '' && endpoint !== '') return `${label} · ${endpoint}`
  if (endpoint !== '') return endpoint
  if (label !== '') return label
  return connectionId
}

/**
 * Replacement for one displayed cwd, or null when the text is not a remote
 * route. Two lines: server, then the POSIX path the placeholder stands for.
 */
export function workspaceHoverText(displayed: string, machine: HoverMachine | undefined): string | null {
  const route = routeOfCwd(displayed)
  if (route === undefined) return null
  return `${serverLine(route.id, machine)}\n${route.path}`
}

/** The element faces the rewrite reads. An HTMLElement satisfies them. */
export interface HoverPathFace {
  textContent: string | null
  childElementCount: number
  parentElement: { readonly children: ArrayLike<unknown> } | null
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  style: { whiteSpace: string }
}

function childIndex(parent: { readonly children: ArrayLike<unknown> }, child: unknown): number {
  for (let index = 0; index < parent.children.length; index += 1) {
    if (parent.children[index] === child) return index
  }
  return -1
}

function childText(parent: { readonly children: ArrayLike<unknown> }, index: number): string {
  const child = parent.children[index]
  if (child === null || child === undefined || typeof child !== 'object' || !('textContent' in child)) return ''
  const text = child.textContent
  return typeof text === 'string' ? text : ''
}

/**
 * The host hover card's path line: a leaf, the second element child, with a
 * creation-time sibling (a four-digit year). That third line is what keeps a
 * directory row that merely shows a path from being rewritten.
 */
export function isWorkspaceHoverPath(element: HoverPathFace): boolean {
  if (element.childElementCount !== 0) return false
  const parent = element.parentElement
  if (parent === null || parent.children.length < 3) return false
  if (childIndex(parent, element) !== 1) return false
  return /\d{4}/.test(childText(parent, 2))
}

/**
 * Rewrite one hover path line. Already-correct text is left untouched so a
 * scan does not write and re-arm the row observer. Returns whether this
 * element is a remote workspace path the layer owns.
 */
export function rewriteWorkspaceHover(
  element: HoverPathFace,
  machineOf: (id: string) => HoverMachine | undefined,
): boolean {
  if (!isWorkspaceHoverPath(element)) return false
  const live = element.textContent?.trim() ?? ''
  const stored = element.getAttribute(HOVER_SOURCE_ATTR)?.trim() ?? ''
  const source = routeOfCwd(live) !== undefined ? live : stored
  if (source === '') return false
  const route = routeOfCwd(source)
  if (route === undefined) return false
  const next = workspaceHoverText(source, machineOf(route.id))
  if (next === null) return false
  if (element.getAttribute(HOVER_SOURCE_ATTR) !== source) element.setAttribute(HOVER_SOURCE_ATTR, source)
  if (element.style.whiteSpace !== 'pre-line') element.style.whiteSpace = 'pre-line'
  if (element.textContent !== next) element.textContent = next
  return true
}
