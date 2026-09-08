/**
 * E2E-01 — application boot and plugin bundle injection.
 *
 * Requirement covered: the plugin's client half is composed into the DSH web
 * shell and registers BOTH directory-flow holes plus the settings section.
 *
 * Assertion strategy: the shell's own controls prove the app booted; the
 * plugin's registrations are observed as rendered UI (a settings-section nav
 * row and the directory-flow dialog), never as internal state.
 */

import { expect, test } from '../fixtures/index.ts'
import { anyLang, copy } from '../fixtures/copy.ts'
import {
  closeFlowDialog,
  closeSettings,
  currentLang,
  openAddWorkspaceFlow,
  openSettings,
  settingsTrigger,
} from '../fixtures/shell.ts'

test.describe('E2E-01 应用启动与插件注入', () => {
  test('页面加载成功，插件 UI 已注册（settings.section + directoryFlow）', async ({ app }) => {
    const { page } = app

    // 1. The document rendered content at all.
    await expect(page.locator('body')).toBeVisible()
    expect(await page.evaluate(() => document.body.innerText.trim().length)).toBeGreaterThan(0)

    // 2. The DSH shell mounted (its settings trigger is shell-owned UI).
    await expect(await settingsTrigger(page)).toBeVisible()
    await app.shot('E2E-01-shell-booted')

    // 3. Plugin registration #1: the settings.section row (`settings.label`).
    const dialog = await openSettings(page)
    const sectionNav = dialog.getByRole('button', { name: anyLang('settings.label') })
    await expect(sectionNav).toBeVisible()
    await sectionNav.click()
    const lang = await currentLang(page)
    await expect(page.getByText(copy('settings.title', lang), { exact: true })).toBeVisible({ timeout: 15_000 })
    await app.shot('E2E-01-settings-section-mounted')
    await closeSettings(page)

    // 4. Plugin registration #2: the directory flow fills both holes; the
    //    shell's「添加工作区」button opens OUR dialog with its own nav.
    const flow = await openAddWorkspaceFlow(page)
    await expect(flow.getByRole('navigation', { name: anyLang('flow.sidebar.label') })).toBeVisible()
    await expect(flow.getByRole('region', { name: anyLang('flow.sidebar.local.section') })).toBeVisible()
    await expect(flow.getByRole('region', { name: anyLang('flow.sidebar.saved.section') })).toBeVisible()
    await expect(flow.getByRole('button', { name: anyLang('flow.cancel') })).toBeVisible()
    await app.shot('E2E-01-flow-injected')

    // 5. Closing the flow removes it again (no orphaned overlay).
    await closeFlowDialog(page)
    await expect(flow).toHaveCount(0)

    // 6. No uncaught exception from the plugin bundle during the whole boot.
    const pluginErrors = app.pageErrors.filter(message =>
      /dsw|workspace-enhancement|client\.js/i.test(message))
    expect(pluginErrors, 'the plugin bundle must not throw during boot').toEqual([])
  })
})
