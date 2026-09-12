/**
 * E2E-05 — per-session side-workspaces panel: the「工作区」header action opens
 * the panel, and the panel follows the theme (CSS token + background colour).
 *
 * Requires a live session: the header action is registered into
 * `conversation.session.header.actions`, which only exists inside a session.
 * The `session` fixture starts one by sending a unique marker through the real
 * composer (the proven recipe from the historical probes).
 */

import { expect, test } from '../fixtures/index.ts'
import { assertPanelTheme } from '../fixtures/assertions.ts'
import { anyLang, copy } from '../fixtures/copy.ts'
import { sidePanel } from '../fixtures/plugin.ts'
import { currentLang } from '../fixtures/shell.ts'

test.describe('E2E-05 副工作区面板', () => {
  test('标题栏「工作区」按钮可打开面板，面板跟随主题', async ({ app, session }) => {
    const { page } = app
    expect(session.marker).not.toBe('')

    // 1. The header action is mounted and labelled by our own dictionary.
    const trigger = page.getByTitle(anyLang('side.headerAction.title'))
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveText(anyLang('side.headerAction.label'))

    // 2. It opens the panel.
    await trigger.click()
    const panel = sidePanel(page)
    await expect(panel).toBeVisible()

    const lang = await currentLang(page)
    await expect(panel.getByText(copy('side.card.title', lang), { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: anyLang('side.kind.local') })).toBeVisible()
    await expect(panel.getByRole('button', { name: anyLang('side.kind.remote') })).toBeVisible()
    await expect(panel.getByRole('button', { name: anyLang('side.browse') })).toBeVisible()
    await expect(panel.getByRole('button', { name: anyLang('side.mount') })).toBeVisible()
    // REQ-I7: the two permission dropdowns were retired with the tier model.
    // In the default local mode the panel renders NO <select> at all (the
    // machine picker only appears after switching to the remote kind).
    await expect(panel.locator('select')).toHaveCount(0)
    // A brand-new session has no side directories: the empty state must show.
    await expect(panel.getByText(anyLang('side.empty')).first()).toBeVisible({ timeout: 20_000 })
    await app.shot('E2E-05-panel-open')

    // 3. The panel reads the theme tokens and follows light/dark.
    const theme = await assertPanelTheme(page, panel, app.testInfo)
    await app.shot(theme.followed ? 'E2E-05-panel-dark' : 'E2E-05-panel-pinned-scheme')

    // 4. The close control dismisses it.
    await panel.getByRole('button', { name: anyLang('side.close.label') }).click()
    await expect(panel).toHaveCount(0)
  })
})
