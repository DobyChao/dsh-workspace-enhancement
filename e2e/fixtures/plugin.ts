/**
 * Plugin-specific locators and state preparation.
 *
 * Structural note: the plugin renders inline-styled boxes with NO `data-*`
 * markers of its own, so two helpers use a single `.locator('..')` parent step
 * from a unique exact-text node to reach the container the plugin itself
 * renders (the card that holds a title + its content). Everything else is
 * role/text/placeholder based. Any deeper structural walking is deliberately
 * avoided so a restyle cannot silently invalidate the suite.
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { anyLang, copy, copyPrefix, escapeRe, exactLang, type CopyKey } from './copy.ts'
import { currentLang } from './shell.ts'

/** Machine rows this suite creates; the prefix drives stale-state cleanup. */
export const E2E_MACHINE_PREFIX = 'e2e-dsw-'

/** Resolved locator for a container box: the parent of its exact-text title. */
async function cardByTitle(page: Page, keys: readonly CopyKey[]): Promise<Locator> {
  const lang = await currentLang(page)
  for (const key of keys) {
    const title = page.getByText(copy(key, lang), { exact: true })
    if (await title.count() > 0) return title.first().locator('..')
  }
  throw new Error(
    `[e2e] plugin card not found: none of ${keys.join(', ')} rendered in ${lang} ` +
    `(is the settings section active?)`,
  )
}

/** The「已配置的机器」box (machine list card). */
export function machinesCard(page: Page): Promise<Locator> {
  return cardByTitle(page, ['settings.machines.title'])
}

/** The「添加机器 / 编辑机器」box (shared machine form card). */
export function machineFormCard(page: Page): Promise<Locator> {
  return cardByTitle(page, ['settings.form.addTitle', 'settings.form.editTitle'])
}

/**
 * The `<label>` element of a machine-form field.
 *
 * Machine-form labels are NOT associated with their inputs (`<label for>` is
 * absent), so `getByLabel` cannot be used. Required fields render the copy plus
 * a ` *` marker inside the same `<label>`, hence the relaxed matcher; anchoring
 * both ends keeps the enclosing flex cell (whose text content is the label
 * alone) out of the match set.
 */
export async function labelNode(page: Page, key: CopyKey): Promise<Locator> {
  const lang = await currentLang(page)
  const matcher = new RegExp(`^${escapeRe(copy(key, lang))}\\s*\\*?$`)
  const label = page.locator('label').filter({ hasText: matcher })
  await expect(label.first()).toBeVisible({ timeout: 10_000 })
  return label.first()
}

/** The flex cell that holds one label plus its control. */
export async function cellOfLabel(page: Page, key: CopyKey): Promise<Locator> {
  return (await labelNode(page, key)).locator('..')
}

/** The row that groups two cells (port + username share one wrapping row). */
export async function rowOfLabel(page: Page, key: CopyKey): Promise<Locator> {
  return (await cellOfLabel(page, key)).locator('..')
}

/** The port input (the only `inputmode="numeric"` control in the form). */
export function portInput(page: Page): Locator {
  return page.locator('input[inputmode="numeric"]').first()
}

/** The username input, reached through its own labelled cell. */
export async function usernameInput(page: Page): Promise<Locator> {
  return (await cellOfLabel(page, 'form.label.username')).locator('input').first()
}

/** Labels of every machine row this suite owns (for stale-state cleanup). */
export async function e2eMachineLabels(page: Page): Promise<string[]> {
  const card = await machinesCard(page)
  const labels = await card.locator('span').evaluateAll(
    (spans, prefix) => spans
      .map(span => (span.textContent ?? '').trim())
      .filter(text => text.startsWith(prefix)),
    E2E_MACHINE_PREFIX,
  )
  return [...new Set(labels)]
}

/**
 * The machine row for one label: the deepest `<div>` that contains both the
 * label text and an「编辑」button (the row wrapper and its flex container both
 * qualify; `.last()` picks the innermost, which owns the button group).
 */
export async function machineRow(page: Page, label: string): Promise<Locator> {
  const lang = await currentLang(page)
  const card = await machinesCard(page)
  const row = card
    .locator('div')
    .filter({ hasText: label })
    .filter({ has: page.getByRole('button', { name: exactLang('settings.machines.edit', lang) }) })
    .last()
  await expect(row).toBeVisible({ timeout: 10_000 })
  return row
}

/** The four per-row action buttons of one machine row. */
export interface MachineRowButtons {
  row: Locator
  edit: Locator
  delete: Locator
  setCurrent: Locator
  forgetKey: Locator
}

/** Locate one machine row and its four action buttons. */
export async function machineRowButtons(page: Page, label: string): Promise<MachineRowButtons> {
  const lang = await currentLang(page)
  const row = await machineRow(page, label)
  return {
    row,
    edit: row.getByRole('button', { name: exactLang('settings.machines.edit', lang) }),
    delete: row.getByRole('button', { name: exactLang('settings.machines.delete', lang) }),
    setCurrent: row.getByRole('button', { name: exactLang('settings.machines.setCurrent', lang) }),
    forgetKey: row.getByRole('button', { name: exactLang('settings.machines.forgetKey', lang) }),
  }
}

/** One machine to provision through the settings form. */
export interface MachineSpec {
  /** Row label; must start with {@link E2E_MACHINE_PREFIX}. */
  label: string
  /** RFC 2606 reserved TLD — never resolvable, never a real host. */
  host: string
  port: string
  username: string
}

/**
 * Fill and submit the shared machine form (settings mode).
 * Assumes the settings section page is already open.
 * @returns the label, for chaining into {@link machineRow}.
 */
export async function addMachine(page: Page, spec: MachineSpec): Promise<string> {
  const lang = await currentLang(page)
  await (await machineFormCard(page)).waitFor({ state: 'visible' })

  await page.getByPlaceholder(copy('form.placeholder.host', lang)).fill(spec.host)
  await portInput(page).fill(spec.port)
  await (await usernameInput(page)).fill(spec.username)
  await page.getByPlaceholder(copy('form.placeholder.name', lang)).fill(spec.label)

  await page.getByRole('button', { name: exactLang('form.save.settingsLabel', lang) }).first().click()

  // F2 banner: the durable acknowledgment that survives the form remount.
  await expect(
    page.getByText(`${copyPrefix('settings.saved', lang)}${spec.label}`),
    'the settings page must acknowledge the save with its own banner',
  ).toBeVisible({ timeout: 20_000 })
  return spec.label
}

/** Delete one machine row (auto-accepts the `window.confirm` dialog). */
export async function deleteMachineRow(page: Page, label: string): Promise<void> {
  const buttons = await machineRowButtons(page, label)
  await buttons.delete.click()
  await expect(page.getByText(label, { exact: true })).toHaveCount(0, { timeout: 20_000 })
}

/** Remove every leftover row from an earlier interrupted run. */
export async function purgeE2eMachines(page: Page): Promise<string[]> {
  const removed: string[] = []
  for (const label of await e2eMachineLabels(page)) {
    await deleteMachineRow(page, label)
    removed.push(label)
  }
  return removed
}

/** The per-session side-workspaces panel (dialog). */
export function sidePanel(page: Page): Locator {
  return page.getByRole('dialog', { name: anyLang('side.card.label') })
}
