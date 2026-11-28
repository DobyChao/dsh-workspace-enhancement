/**
 * BUG-32 wiring: the directory picker itself, not a stand-in, must stop wheel
 * events on its overlay.
 *
 * `bindOverlayWheelContainment` is unit-tested on a fake element. This file
 * renders `SshWorkspaceFlow` and dispatches a real wheel from the directory
 * list. The listener an ancestor would use (the host sidebar viewport) must
 * not see the event, and the event must stay uncancelled so the list can
 * scroll. Deleting the overlay effect in `flow.tsx` fails this test.
 *
 * The CSS-module stub names each class after its key, so the rendered
 * `browser` / `sidebar` nodes are the rules that declare
 * `overscroll-behavior: contain`.
 *
 * Imports `.tsx`, so `npm run test:agent` skips this file; `npm test` runs it.
 *
 * @module test/bug-32-picker-wheel-wiring
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { WireListing, WireResult } from '../src/client/index.ts'

const listing = (): WireListing => ({
  path: '/home/user',
  home: '/home/user',
  crumbs: [{ name: 'user', path: '/home/user', hidden: false }],
  entries: [{ name: 'proj', path: '/home/user/proj', hidden: false }],
  truncated: false,
})

const rpc = (endpoint: string): Promise<WireResult> => {
  if (endpoint === 'connections.list' || endpoint === 'config.hosts') return Promise.resolve({ ok: true, value: [] })
  if (endpoint === 'machines.list') return Promise.resolve({ ok: true, value: { items: [], currentId: '' } })
  if (endpoint === 'browse.list') return Promise.resolve({ ok: true, value: listing() })
  return Promise.resolve({ ok: true, value: {} })
}

/** The rule body for one selector in the picker stylesheet. */
function cssRule(selector: string): string {
  const css = readFileSync(new URL('../src/client/flow.module.css', import.meta.url), 'utf8')
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, selector)
  return css.slice(start, css.indexOf('\n}', start))
}

test('rendered directory picker stops wheel on the overlay and contains the lists', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const view = dom.window
  const globals = globalThis as typeof globalThis & {
    window: typeof view
    document: Document
    HTMLElement: typeof view.HTMLElement
    Element: typeof view.Element
    Node: typeof view.Node
    IS_REACT_ACT_ENVIRONMENT: boolean
  }
  globals.window = view
  globals.document = view.document
  globals.HTMLElement = view.HTMLElement
  globals.Element = view.Element
  globals.Node = view.Node
  globals.IS_REACT_ACT_ENVIRONMENT = true

  try {
    const { act, createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { SshWorkspaceFlow } = await import('../src/client/flow.tsx')

    const container = view.document.createElement('div')
    view.document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(SshWorkspaceFlow, {
        open: true,
        busy: false,
        onPicked: () => {},
        onCancel: () => {},
        onError: () => {},
        listLocalDirectory: async () => listing(),
        createLocalDirectory: async () => '/home/user/new',
        rpc,
      }))
      await new Promise(resolve => { setTimeout(resolve, 0) })
    })

    const overlay = container.querySelector('.overlay')
    const browser = container.querySelector('.browser')
    const sidebar = container.querySelector('.sidebar')
    assert.ok(overlay instanceof view.HTMLElement)
    assert.ok(browser instanceof view.HTMLElement)
    assert.ok(sidebar instanceof view.HTMLElement)
    assert.ok(overlay.contains(browser))
    assert.ok(overlay.contains(sidebar))

    for (const selector of ['.browser {', '.sidebar {']) {
      const rule = cssRule(selector)
      assert.match(rule, /overflow-y:\s*auto/, selector)
      assert.match(rule, /overscroll-behavior:\s*contain/, selector)
    }

    // Same phase as the host sidebar viewport: bubble, and it would cancel
    // the list scroll if the overlay let the event through.
    let escaped = 0
    container.addEventListener('wheel', (event) => {
      escaped += 1
      event.preventDefault()
    })
    const event = new view.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })
    browser.dispatchEvent(event)
    const sidebarEvent = new view.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 })
    sidebar.dispatchEvent(sidebarEvent)
    assert.equal(escaped, 0)
    assert.equal(event.defaultPrevented, false)
    assert.equal(sidebarEvent.defaultPrevented, false)

    await act(async () => { root.unmount() })
  } finally {
    view.close()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})
