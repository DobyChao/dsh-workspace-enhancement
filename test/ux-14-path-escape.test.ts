/**
 * UX-14: Escape while the directory path field is focused cancels that edit.
 * The dialog's document capture listener must not dismiss the picker, and the
 * field listener must stop the event before that listener runs. Escape on any
 * other target still dismisses the topmost dialog.
 *
 * @module test/ux-14-path-escape
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consumePathEditEscape, dialogEscapeAction, PATH_EDIT_ATTR, pathEditMarker } from '../src/client/ui.ts'

const pathField = (): { getAttribute: (name: string) => string | null } => ({
  getAttribute: name => (name === PATH_EDIT_ATTR ? '' : null),
})

const other = (): { getAttribute: (name: string) => null } => ({
  getAttribute: () => null,
})

const key = (name: string, target: object | null): {
  key: string
  target: object | null
  prevented: boolean
  stopped: boolean
  preventDefault: () => void
  stopPropagation: () => void
} => {
  const event = {
    key: name,
    target,
    prevented: false,
    stopped: false,
    preventDefault() { event.prevented = true },
    stopPropagation() { event.stopped = true },
  }
  return event
}

test('the path field marker is the attribute Escape checks', () => {
  assert.deepEqual(pathEditMarker(), { [PATH_EDIT_ATTR]: '' })
  assert.equal(PATH_EDIT_ATTR, 'data-dsw-path-edit')
})

test('Escape on the path field is consumed and does not dismiss the picker', () => {
  const event = key('Escape', pathField())
  let dismissed = 0
  assert.equal(consumePathEditEscape(event), true)
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  // Document capture (useDialogA11y) does not run after stopPropagation.
  // If the event still arrived, the dialog would ignore it.
  if (!event.stopped && dialogEscapeAction(event.target) === 'dismiss') dismissed += 1
  assert.equal(dialogEscapeAction(event.target), 'ignore')
  assert.equal(dismissed, 0)
})

test('Escape on the path field still does not dismiss when it reaches the dialog', () => {
  assert.equal(dialogEscapeAction(pathField()), 'ignore')
})

test('Escape outside the path field still dismisses the dialog', () => {
  const event = key('Escape', other())
  assert.equal(consumePathEditEscape(event), false)
  assert.equal(event.prevented, false)
  assert.equal(event.stopped, false)
  assert.equal(dialogEscapeAction(event.target), 'dismiss')
})

test('Enter on the path field is left for the commit handler', () => {
  const event = key('Enter', pathField())
  assert.equal(consumePathEditEscape(event), false)
  assert.equal(event.prevented, false)
  assert.equal(event.stopped, false)
})

test('Escape with no attribute reader still dismisses', () => {
  assert.equal(dialogEscapeAction(null), 'dismiss')
  assert.equal(dialogEscapeAction({} as EventTarget), 'dismiss')
  const event = key('Escape', null)
  assert.equal(consumePathEditEscape(event), false)
})
