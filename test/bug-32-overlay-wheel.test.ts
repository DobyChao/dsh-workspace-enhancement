/**
 * BUG-32: a wheel over the directory picker must scroll the picker and must
 * not reach the host sidebar viewport.
 *
 * The host (`dsh-client-ui-sidebar` `createScrollHandoff`) listens for `wheel`
 * on the sidebar viewport in the bubble phase and calls `preventDefault`
 * unless the target is inside the section scroller. The picker is rendered in
 * place under that viewport, so the hand-off cancels the list scroll. The
 * overlay stops the event on the way up and does not call `preventDefault`.
 *
 * @module test/bug-32-overlay-wheel
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { bindOverlayWheelContainment } from '../src/client/ui.ts'

interface FakeWheel {
  stopped: boolean
  prevented: boolean
  stopPropagation: () => void
  preventDefault: () => void
}

/** The host hand-off, reduced to the part that steals a bubbling wheel. */
function sidebarHandoff(event: FakeWheel): void {
  if (event.stopped) return
  event.preventDefault()
}

test('overlay wheel containment stops bubbling and does not preventDefault', () => {
  let listener: ((event: WheelEvent) => void) | undefined
  let options: AddEventListenerOptions | boolean | undefined
  let removed = false
  const element = {
    addEventListener(type: string, fn: (event: WheelEvent) => void, opts?: AddEventListenerOptions | boolean) {
      assert.equal(type, 'wheel')
      listener = fn
      options = opts
    },
    removeEventListener(type: string, fn: (event: WheelEvent) => void) {
      assert.equal(type, 'wheel')
      assert.equal(fn, listener)
      removed = true
    },
  }
  const release = bindOverlayWheelContainment(element as unknown as HTMLElement)
  assert.equal(typeof listener, 'function')
  assert.deepEqual(options, { passive: true })

  const event: FakeWheel = {
    stopped: false,
    prevented: false,
    stopPropagation() { event.stopped = true },
    preventDefault() { event.prevented = true },
  }
  listener!(event as unknown as WheelEvent)
  sidebarHandoff(event)
  assert.equal(event.stopped, true)
  assert.equal(event.prevented, false)

  release()
  assert.equal(removed, true)
})

test('directory picker scrollports contain overscroll', () => {
  const css = readFileSync(new URL('../src/client/flow.module.css', import.meta.url), 'utf8')
  for (const selector of ['.overlay {', '.dialog {', '.sidebar {', '.browser {', '.smallDialog,']) {
    const start = css.indexOf(selector)
    assert.notEqual(start, -1, selector)
    const body = css.slice(start, css.indexOf('\n}', start))
    assert.match(body, /overscroll-behavior:\s*contain/, selector)
  }
  const browser = css.slice(css.indexOf('.browser {'), css.indexOf('\n}', css.indexOf('.browser {')))
  const sidebar = css.slice(css.indexOf('.sidebar {'), css.indexOf('\n}', css.indexOf('.sidebar {')))
  assert.match(browser, /overflow-y:\s*auto/)
  assert.match(sidebar, /overflow-y:\s*auto/)
})
