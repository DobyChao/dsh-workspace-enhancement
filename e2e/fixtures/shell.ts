/**
 * DSH shell navigation helpers (third-party shell, driven but never asserted).
 *
 * Provenance: every path here was validated by the historical Python probes
 * (`i18n_layout_probe.py`, `i18n_t11_pha.py`, `r2ui_full.py`, `r5p_e2e_ext.py`).
 * The locators use the shell's own ARIA/slot contracts:
 *   - settings trigger: `button[aria-haspopup="dialog"]` containing the
 *     `[data-slot="settings.trigger"]` slot content (the probe's proven path);
 *   - settings panel: `div[role=dialog][aria-modal=true]` whose nav contains
 *     the General section button;
 *   - settings section nav rows: plain `<button>` whose accessible name is the
 *     section label (see SettingsPanel in dsh-client-ui-settings-general);
 *   - language row: the only `button[aria-haspopup="menu"]` in the General
 *     section; its items are `[role="menuitem"]` rendered in a portal.
 *
 * Language handling: the shell mirrors the active locale onto
 * `document.documentElement.lang` ('zh-CN' | 'en'), which is how
 * {@link currentLang} reads it without opening a dialog.
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { anyLang, copy, type CopyKey, type Lang } from './copy.ts'

/** Composer fallback selector set; the lab shell renders a Lexical editor. */
/**
 * The conversation composer. DSH renders it with Lexical, so it is a
 * `contenteditable` editor carrying `role="textbox"` — NOT a `<textarea>`.
 * A bare `getByRole('textbox')` also matches the sidebar "Search sessions"
 * input, which is what broke the first version of this fixture.
 */
const COMPOSER_EDITOR = '[contenteditable="true"][role="textbox"], div[contenteditable="true"]'

/** Wait for the shell to mount: the settings trigger is always present. */
export async function waitForShell(page: Page): Promise<void> {
  const trigger = await settingsTrigger(page)
  await expect(trigger).toBeVisible({ timeout: 60_000 })
}

/**
 * The settings trigger button. Primary locator is the shell's slot marker
 * (proven by `i18n_layout_probe.py`); the role/name form is the fallback.
 */
export async function settingsTrigger(page: Page): Promise<Locator> {
  const bySlot = page
    .locator('button[aria-haspopup="dialog"]')
    .filter({ has: page.locator('[data-slot="settings.trigger"]') })
  if (await bySlot.count() > 0) return bySlot
  return page.getByRole('button', { name: anyLang('shell.settings.trigger') })
}

/** The settings panel dialog (scoped by its own section-nav button). */
export function settingsDialog(page: Page): Locator {
  return page
    .locator('div[role="dialog"][aria-modal="true"]')
    .filter({ has: page.getByRole('button', { name: anyLang('shell.settings.general') }) })
}

/** Open the settings dialog (idempotent) and return it. */
export async function openSettings(page: Page): Promise<Locator> {
  const dialog = settingsDialog(page)
  if (await dialog.count() === 0) {
    const trigger = await settingsTrigger(page)
    await expect(trigger).toBeVisible({ timeout: 60_000 })
    await trigger.click()
  }
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  return dialog
}

/** Close the settings dialog via its own close control. */
export async function closeSettings(page: Page): Promise<void> {
  const dialog = settingsDialog(page)
  if (await dialog.count() === 0) return
  await dialog.getByRole('button', { name: anyLang('shell.settings.close') }).click()
  await expect(dialog).toHaveCount(0, { timeout: 10_000 })
}

/** The active locale, read from the shell's `document.documentElement.lang`. */
export async function currentLang(page: Page): Promise<Lang> {
  const lang = await page.evaluate(() => document.documentElement.lang ?? '')
  return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** The label currently shown on the shell's Language selector. */
export async function activeLanguageLabel(page: Page): Promise<string> {
  const dialog = await openSettings(page)
  const selector = dialog.getByRole('button', { name: anyLang('shell.language.zh', 'shell.language.en') })
  return ((await selector.first().textContent()) ?? '').trim()
}

/**
 * Switch the UI language through the shell's Language row.
 *
 * Order matters (proven by `i18n_t11_pha.py`): open the settings dialog, make
 * the General section active (the Language row lives there), click the selector,
 * then click the `[role="menuitem"]` in the PORTAL — the menu is not a child of
 * the dialog, so it must be located from the page, not from `dialog`.
 */
export async function setLanguage(page: Page, target: Lang): Promise<void> {
  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: anyLang('shell.settings.general') }).click()
  const selector = dialog.getByRole('button', { name: anyLang('shell.language.zh', 'shell.language.en') })
  await expect(selector.first()).toBeVisible()
  await selector.first().click()
  const item = page.getByRole('menuitem', {
    name: anyLang(target === 'en' ? 'shell.language.en' : 'shell.language.zh'),
  })
  await expect(item.first()).toBeVisible({ timeout: 10_000 })
  await item.first().click()
  await expect.poll(() => currentLang(page), { timeout: 15_000 }).toBe(target)
}

/** Switch only when needed — keeps specs fast and avoids redundant writes. */
export async function ensureLanguage(page: Page, target: Lang): Promise<void> {
  if (await currentLang(page) === target) return
  await setLanguage(page, target)
}

/**
 * Click one settings-section nav row and wait for its page title.
 * @param page - page with the settings dialog (opened here when needed).
 * @param navKey - COPY key of the section label (`settings.label`, ...).
 * @param titleKey - COPY key of the page title rendered by that section.
 */
export async function openSettingsSection(page: Page, navKey: CopyKey, titleKey: CopyKey): Promise<Locator> {
  const dialog = await openSettings(page)
  const nav = dialog.getByRole('button', { name: anyLang(navKey) })
  await expect(nav.first()).toBeVisible({ timeout: 15_000 })
  await nav.first().click()
  const lang = await currentLang(page)
  await expect(page.getByText(copy(titleKey, lang), { exact: true })).toBeVisible({ timeout: 15_000 })
  return dialog
}

/** Expand the sidebar when it is collapsed (needed for session-row assertions). */
export async function openSidebar(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: anyLang('shell.sidebar.open') })
  if (await toggle.count() > 0 && await toggle.first().isVisible()) await toggle.first().click()
}

/**
 * Open the add-workspace directory flow (the shell's own button) and return the
 * plugin's dialog. Falls back to expanding the sidebar when the button is not
 * rendered yet.
 */
export async function openAddWorkspaceFlow(page: Page): Promise<Locator> {
  const flow = page.getByRole('dialog', { name: anyLang('flow.dialog.label') })
  if (await flow.count() === 0) {
    let button = page.getByRole('button', { name: anyLang('shell.workspace.add') })
    if (await button.count() === 0 || !(await button.first().isVisible())) {
      await openSidebar(page)
      button = page.getByRole('button', { name: anyLang('shell.workspace.add') })
    }
    await expect(button.first()).toBeVisible({ timeout: 20_000 })
    await button.first().click()
  }
  await expect(flow).toBeVisible({ timeout: 20_000 })
  return flow
}

/** Close the add-workspace flow via its own close control. */
export async function closeFlowDialog(page: Page): Promise<void> {
  const flow = page.getByRole('dialog', { name: anyLang('flow.dialog.label') })
  if (await flow.count() === 0) return
  await flow.getByRole('button', { name: anyLang('flow.close.label') }).first().click()
  await expect(flow).toHaveCount(0, { timeout: 10_000 })
}

/**
 * Type a marker into the composer and send it, so the shell creates a session
 * and mounts the per-session header actions.
 *
 * Two proven pitfalls drive this shape:
 *  - the send is retried once: the first keystrokes can land before the editor
 *    finishes mounting and the primary button stays disabled
 *    (`r5p_e2e_ext.py` sends twice in that case);
 *  - after a successful submit the primary button becomes the STOP button
 *    (`input.stop`), so a retry must not assume the send button still exists.
 * @returns the marker, which doubles as the derived session title substring.
 */
export async function startSession(page: Page, marker: string): Promise<string> {
  const header = page.getByTitle(anyLang('side.headerAction.title'))

  const sendOnce = async (): Promise<void> => {
    const send = page.getByRole('button', { name: anyLang('shell.input.send') })
    // No send button => a submit is already in flight (stop button owns the slot).
    if (await send.count() === 0) return
    const editor = page.locator(COMPOSER_EDITOR).first()
    if (await editor.count() > 0) {
      await editor.click()
      await editor.fill('')
      await editor.pressSequentially(marker, { delay: 5 })
    } else {
      // Fallback: the composer is the last textbox on the page (the sidebar
      // search box comes first in DOM order).
      const fallback = page.getByRole('textbox').last()
      await fallback.click()
      await fallback.pressSequentially(marker, { delay: 5 })
    }
    if (await send.count() === 0) return
    await expect(send.first()).toBeEnabled({ timeout: 20_000 })
    await send.first().click()
  }

  await sendOnce()
  try {
    await header.first().waitFor({ state: 'visible', timeout: 60_000 })
    return marker
  } catch {
    // Retry once: the first send raced the editor mount.
  }
  await sendOnce()
  await header.first().waitFor({ state: 'visible', timeout: 60_000 })
  return marker
}
