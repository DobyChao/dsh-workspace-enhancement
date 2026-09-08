/**
 * E2E-04 — add-machine form: the Port/Username row must WRAP on a narrow
 * viewport instead of pushing past the form card (real regression point).
 *
 * The two cells are `flex: 1 1 220px` inside a `flex-wrap: wrap` row, so they
 * stack once the row's available width drops below 2x220 + 6 = 446 px; the
 * wide-viewport control test pins the opposite behaviour so a "fix" that always
 * stacks is caught too.
 *
 * Viewport choice (derived from the shell's settings panel CSS, not guessed):
 *   available row width = viewport - 48 (panel max-width margin) - 188 (fixed
 *   nav rail) - 32 (page padding) - 20 (card padding) = viewport - 288.
 *   - wrap requires  viewport - 288 <  446  -> viewport <  734
 *   - no overflow requires viewport - 288 > ~261 (label 90 + gap 6 + the
 *     control's intrinsic minimum width ~165)
 *   -> the usable window is roughly 560..733 px; 640 px sits safely inside it.
 * Below ~560 px the shell squeezes the content under the controls' intrinsic
 * minimum width, which is a shell-level squeeze rather than a plugin defect.
 */

import { expect, test } from '../fixtures/index.ts'
import { boxOf, expectInside, expectNoOverflow } from '../fixtures/dom.ts'
import { expectPortUsernameSideBySide, expectPortUsernameWrapped, measurePortUsernameRow } from '../fixtures/assertions.ts'
import { labelNode, machineFormCard, portInput, usernameInput } from '../fixtures/plugin.ts'
import { openSettingsSection } from '../fixtures/shell.ts'

const NARROW = { width: 640, height: 900 }
const WIDE = { width: 1440, height: 900 }

test.describe('E2E-04 添加机器表单：窄视口换行', () => {
  test.use({ viewport: NARROW })

  test('Port/Username 行换行，且所有控件不越出卡片', async ({ app }) => {
    const { page } = app
    await openSettingsSection(page, 'settings.label', 'settings.title')

    const card = await machineFormCard(page)
    await expectNoOverflow(card, `narrow ${NARROW.width}px: machine form card`)

    const row = await measurePortUsernameRow(page)
    expectPortUsernameWrapped(row, NARROW.width)

    // Every control of the row stays inside the card's content box.
    await expectInside(card, [
      ['port label', await labelNode(page, 'form.label.port')],
      ['username label', await labelNode(page, 'form.label.username')],
      ['port input', portInput(page)],
      ['username input', await usernameInput(page)],
    ], `narrow ${NARROW.width}px: Port/Username row inside the form card`)

    // The row itself must not be wider than the card it lives in.
    expect(row.row.width, `row width ${row.row.width} must not exceed card width ${row.card.width}`)
      .toBeLessThanOrEqual(row.card.width + 1)

    await app.shot('E2E-04-add-machine-narrow')
  })
})

test.describe('E2E-04 添加机器表单：宽视口对照', () => {
  test.use({ viewport: WIDE })

  test('宽视口下 Port/Username 同行且不越出卡片', async ({ app }) => {
    const { page } = app
    await openSettingsSection(page, 'settings.label', 'settings.title')

    const card = await machineFormCard(page)
    await expectNoOverflow(card, `wide ${WIDE.width}px: machine form card`)

    const row = await measurePortUsernameRow(page)
    expectPortUsernameSideBySide(row, WIDE.width)
    await expectInside(card, [
      ['port input', portInput(page)],
      ['username input', await usernameInput(page)],
    ], `wide ${WIDE.width}px: Port/Username controls inside the form card`)
    expect((await boxOf(portInput(page))).width).toBeGreaterThan(0)
  })
})
