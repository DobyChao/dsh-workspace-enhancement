/**
 * E2E-02 — settings page render, Chinese, no card overflow.
 *
 * Requirement covered: entering the「远程工作区」settings section shows the
 * machine list row with its full button group, and no control escapes its card
 * (the historical zh layout regression).
 */

import { test } from '../fixtures/index.ts'
import { assertSettingsPageLayout } from '../fixtures/assertions.ts'
import { ensureLanguage, openSettingsSection } from '../fixtures/shell.ts'

test.describe('E2E-02 设置页渲染（中文）', () => {
  test('机器行与按钮组完整可见，且不溢出卡片', async ({ app, machine }) => {
    const { page } = app
    await ensureLanguage(page, 'zh')
    await openSettingsSection(page, 'settings.label', 'settings.title')

    await assertSettingsPageLayout(page, 'zh', machine)

    await app.shot('E2E-02-settings-zh')
  })
})
