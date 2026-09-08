/**
 * E2E-06 — language switch takes effect immediately, without a page reload.
 *
 * The switch is driven through the shell's Language row (the plugin only owns
 * the `dsw` dictionary it registers). The plugin-side proof is that OUR copy
 * flips in place: settings page title, form labels and machine-row buttons.
 *
 * "No reload" is proven with a `window` sentinel: a reload would drop it.
 */

import { expect, test } from '../fixtures/index.ts'
import { copy, exactLang } from '../fixtures/copy.ts'
import { labelNode, machineRowButtons } from '../fixtures/plugin.ts'
import { ensureLanguage, openSettingsSection, setLanguage } from '../fixtures/shell.ts'

/** Sentinel written before each switch and read after it. */
const SENTINEL = '__e2eLanguageSwitchSentinel'

async function writeSentinel(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((key: string) => {
    (window as unknown as Record<string, unknown>)[key] = 'kept'
  }, SENTINEL)
}

async function readSentinel(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate((key: string) => (window as unknown as Record<string, unknown>)[key], SENTINEL)
}

test.describe('E2E-06 语言切换即时生效', () => {
  test('中文 → English → 中文：文案随之变化且页面未刷新', async ({ app, machine }) => {
    const { page } = app

    // ---- baseline: Chinese ----
    await ensureLanguage(page, 'zh')
    await openSettingsSection(page, 'settings.label', 'settings.title')
    await expect(page.getByText(copy('settings.title', 'zh'), { exact: true })).toBeVisible()
    await expect(await labelNode(page, 'form.label.port')).toBeVisible()
    await expect(page.getByRole('radio', { name: exactLang('form.auth.keyTab', 'zh') })).toBeVisible()
    const zhButtons = await machineRowButtons(page, machine.label)
    await expect(zhButtons.edit).toBeVisible()
    await app.shot('E2E-06-baseline-zh')
    await writeSentinel(page)

    // ---- switch to English ----
    await setLanguage(page, 'en')
    await openSettingsSection(page, 'settings.label', 'settings.title')
    await expect(page.getByText(copy('settings.title', 'en'), { exact: true })).toBeVisible()
    await expect(await labelNode(page, 'form.label.port')).toBeVisible()
    await expect(page.getByRole('radio', { name: exactLang('form.auth.keyTab', 'en') })).toBeVisible()
    const enButtons = await machineRowButtons(page, machine.label)
    await expect(enButtons.edit).toBeVisible()
    expect(await readSentinel(page), 'switching to English must not reload the page').toBe('kept')
    await app.shot('E2E-06-switched-en')

    // ---- switch back to Chinese ----
    await setLanguage(page, 'zh')
    await openSettingsSection(page, 'settings.label', 'settings.title')
    await expect(page.getByText(copy('settings.title', 'zh'), { exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: exactLang('form.auth.keyTab', 'zh') })).toBeVisible()
    expect(await readSentinel(page), 'switching back to Chinese must not reload the page').toBe('kept')
    await app.shot('E2E-06-back-to-zh')
  })
})
