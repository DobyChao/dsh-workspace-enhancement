/**
 * E2E-03 — settings page render, English, no card overflow.
 *
 * Requirement covered: the same layout assertions as E2E-02 after switching the
 * UI language to English. English copy is longer than the Chinese original, and
 * this exact switch is where the layout previously broke.
 */

import { test } from '../fixtures/index.ts'
import { assertSettingsPageLayout } from '../fixtures/assertions.ts'
import { ensureLanguage, openSettingsSection } from '../fixtures/shell.ts'

test.describe('E2E-03 设置页渲染（英文）', () => {
  test('切换到 English 后布局断言同样成立', async ({ app, machine }) => {
    const { page } = app
    await ensureLanguage(page, 'en')
    await openSettingsSection(page, 'settings.label', 'settings.title')

    await assertSettingsPageLayout(page, 'en', machine)

    await app.shot('E2E-03-settings-en')
  })
})
