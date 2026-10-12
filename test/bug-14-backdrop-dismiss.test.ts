/**
 * BUG-14 regression: the backdrop-dismiss props must not treat a click the
 * browser dispatches on the common ancestor of mousedown and mouseup as a
 * backdrop click — drag-selecting text inside the dialog and releasing over
 * the backdrop closed the picker and lost the browse state. Only a press that
 * STARTED on the backdrop may dismiss.
 *
 * @module test/bug-14-backdrop-dismiss
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backdropDismissProps } from '../src/client/ui.ts'

const backdrop = { target: 'overlay', currentTarget: 'overlay' }
const card = { target: 'card', currentTarget: 'overlay' }

test('press on the card, release over the backdrop (drag-selection) does not dismiss', () => {
  let closed = 0
  const props = backdropDismissProps(() => { closed += 1 })
  props.onMouseDown(card)
  props.onClick(backdrop)
  assert.equal(closed, 0)
})

test('press and release on the backdrop dismisses (the plain backdrop click)', () => {
  let closed = 0
  const props = backdropDismissProps(() => { closed += 1 })
  props.onMouseDown(backdrop)
  props.onClick(backdrop)
  assert.equal(closed, 1)
})

test('click landing on the card never dismisses', () => {
  let closed = 0
  const props = backdropDismissProps(() => { closed += 1 })
  props.onMouseDown(card)
  props.onClick(card)
  assert.equal(closed, 0)
})

test('a re-render between press and release fails safe: no dismiss', () => {
  let closed = 0
  backdropDismissProps(() => { closed += 1 }).onMouseDown(backdrop)
  // The component re-rendered before mouseup: fresh props, fresh press flag.
  const afterRender = backdropDismissProps(() => { closed += 1 })
  afterRender.onClick(backdrop)
  assert.equal(closed, 0)
})

test('a stray click with no preceding press does not dismiss', () => {
  let closed = 0
  const props = backdropDismissProps(() => { closed += 1 })
  props.onClick(backdrop)
  assert.equal(closed, 0)
})
