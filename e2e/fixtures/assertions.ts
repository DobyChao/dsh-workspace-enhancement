/**
 * Reusable assertions shared by the settings-layout specs (E2E-02/03/04) and
 * the side-panel theme spec (E2E-05).
 *
 * Kept in fixtures so the specs stay readable and the layout rules live in one
 * place; each spec still decides WHICH language and WHICH viewport it asserts.
 */

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import {
  boxOf,
  contrastOf,
  expectInside,
  expectNoOverflow,
  luminanceOf,
  parseRgb,
  prefersDark,
  settledThemeSnapshot,
  type Box,
  type ThemeSnapshot,
} from './dom.ts'
import { copy, exactLang, type Lang } from './copy.ts'
import {
  labelNode,
  machineFormCard,
  machineRowButtons,
  machinesCard,
  portInput,
  rowOfLabel,
  usernameInput,
  type MachineSpec,
} from './plugin.ts'

/** Every copy key the settings page must render in the active language. */
const FORM_LABEL_KEYS = [
  'form.label.host',
  'form.label.port',
  'form.label.username',
  'form.label.name',
  'form.label.workspace',
  'form.label.auth',
] as const

/**
 * Assert the whole「远程工作区」settings page for one language: copy, machine
 * row, button group, and that neither card lets a child escape its box.
 */
export async function assertSettingsPageLayout(page: Page, lang: Lang, machine: MachineSpec): Promise<void> {
  await expect(page.getByText(copy('settings.title', lang), { exact: true })).toBeVisible()
  await expect(page.getByText(copy('settings.machines.title', lang), { exact: true })).toBeVisible()

  for (const key of FORM_LABEL_KEYS) {
    await expect(await labelNode(page, key), `${key} label must render in ${lang}`).toBeVisible()
  }
  await expect(page.getByRole('radio', { name: exactLang('form.auth.keyTab', lang) })).toBeVisible()
  await expect(page.getByRole('radio', { name: exactLang('form.auth.passwordTab', lang) })).toBeVisible()
  await expect(page.getByRole('button', { name: exactLang('form.test.button', lang) })).toBeVisible()
  await expect(page.getByRole('button', { name: exactLang('form.save.settingsLabel', lang) })).toBeVisible()

  // The provisioned machine row renders its endpoint and the full button group.
  await expect(page.getByText(`${machine.username}@${machine.host}:${machine.port}`)).toBeVisible()
  const buttons = await machineRowButtons(page, machine.label)
  for (const [name, locator] of Object.entries(buttons)) {
    if (name === 'row') continue
    await expect(locator, `machine row button "${name}" must be visible`).toBeVisible()
  }

  const listCard = await machinesCard(page)
  const formCard = await machineFormCard(page)
  await expectNoOverflow(listCard, `${lang}: machine list card`)
  await expectNoOverflow(formCard, `${lang}: machine form card`)

  await expectInside(listCard, [
    ['machine row', buttons.row],
    ['edit', buttons.edit],
    ['delete', buttons.delete],
    ['setCurrent', buttons.setCurrent],
    ['forgetKey', buttons.forgetKey],
  ], `${lang}: machine row inside the list card`)

  await expectInside(formCard, [
    ['host label', await labelNode(page, 'form.label.host')],
    ['port label', await labelNode(page, 'form.label.port')],
    ['username label', await labelNode(page, 'form.label.username')],
    ['port input', portInput(page)],
    ['username input', await usernameInput(page)],
    ['test button', page.getByRole('button', { name: exactLang('form.test.button', lang) })],
    ['save button', page.getByRole('button', { name: exactLang('form.save.settingsLabel', lang) })],
  ], `${lang}: machine form fields inside the form card`)
}

/** Measured geometry of the Port/Username row (E2E-04). */
export interface PortUsernameRow {
  card: Box
  row: Box
  portLabel: Box
  usernameLabel: Box
  portInput: Box
  usernameInput: Box
}

/** Measure the add-machine form's Port/Username row and its card. */
export async function measurePortUsernameRow(page: Page): Promise<PortUsernameRow> {
  const portLabel = await labelNode(page, 'form.label.port')
  const usernameLabel = await labelNode(page, 'form.label.username')
  return {
    card: await boxOf(await machineFormCard(page)),
    row: await boxOf(await rowOfLabel(page, 'form.label.port')),
    portLabel: await boxOf(portLabel),
    usernameLabel: await boxOf(usernameLabel),
    portInput: await boxOf(portInput(page)),
    usernameInput: await boxOf(await usernameInput(page)),
  }
}

/**
 * Assert the Port/Username row WRAPS (stacks) at a narrow viewport and keeps
 * every control inside the form card. This is the historical regression: the
 * two cells are `flex: 1 1 220px`, so they must wrap instead of pushing past
 * the card's right edge.
 */
export async function expectPortUsernameWrapped(row: PortUsernameRow, viewportWidth: number): Promise<void> {
  const details =
    `viewport=${viewportWidth}px row=(${row.row.x},${row.row.y},${row.row.width}x${row.row.height}) ` +
    `portLabel=(${row.portLabel.x},${row.portLabel.y},${row.portLabel.width}x${row.portLabel.height}) ` +
    `usernameLabel=(${row.usernameLabel.x},${row.usernameLabel.y},${row.usernameLabel.width}x${row.usernameLabel.height}) ` +
    `card=(${row.card.x},${row.card.y},${row.card.width}x${row.card.height})`
  expect(
    row.usernameLabel.y,
    `Port and Username must WRAP onto separate lines at ${viewportWidth}px — ${details}`,
  ).toBeGreaterThan(row.portLabel.y + row.portLabel.height - 2)
  expect(
    row.usernameLabel.x,
    `wrapped Username cell must start at the row's left edge — ${details}`,
  ).toBeLessThanOrEqual(row.row.x + 2)
}

/** Assert both Port/Username cells sit side by side (wide viewport control). */
export async function expectPortUsernameSideBySide(row: PortUsernameRow, viewportWidth: number): Promise<void> {
  const details =
    `viewport=${viewportWidth}px portLabel.y=${row.portLabel.y} usernameLabel.y=${row.usernameLabel.y} ` +
    `portLabel.x=${row.portLabel.x} usernameLabel.x=${row.usernameLabel.x}`
  expect(
    Math.abs(row.usernameLabel.y - row.portLabel.y),
    `Port and Username must share one line at ${viewportWidth}px — ${details}`,
  ).toBeLessThanOrEqual(4)
  expect(
    row.usernameLabel.x,
    `Username cell must start to the right of the Port cell at ${viewportWidth}px — ${details}`,
  ).toBeGreaterThan(row.portLabel.x)
}

/** Result of the theme probe; `followed` tells whether the flip was exercised. */
export interface PanelThemeResult {
  light: ThemeSnapshot
  dark: ThemeSnapshot
  /** True when the panel's background actually changed with the scheme. */
  followed: boolean
}

/**
 * Assert the side-workspaces panel follows the theme:
 *  1. it resolves the plugin's `--dswsw-surface` / `--dswsw-fg` tokens;
 *  2. the card background is opaque and equals the resolved surface token;
 *  3. text/background contrast is at least 3:1;
 *  4. under `prefers-color-scheme` light/dark the background moves to the
 *     expected side of the luminance scale (skipped when the lab theme is
 *     pinned, which is reported as an annotation rather than a silent pass).
 */
export async function assertPanelTheme(page: Page, panel: Locator, testInfo: TestInfo): Promise<PanelThemeResult> {
  await page.emulateMedia({ colorScheme: 'light' })
  const light = await settledThemeSnapshot(page, panel)
  await page.emulateMedia({ colorScheme: 'dark' })
  const dark = await settledThemeSnapshot(page, panel)

  for (const [mode, snapshot] of [['light', light], ['dark', dark]] as const) {
    expect(snapshot.surfaceToken, `${mode}: the panel must read the --dswsw-surface theme token`).not.toBe('')
    const background = parseRgb(snapshot.background)
    expect(background, `${mode}: unparseable panel background ${snapshot.background}`).not.toBeNull()
    expect(background?.a ?? 0, `${mode}: panel card background must be opaque (${snapshot.background})`)
      .toBeGreaterThanOrEqual(0.9)
    const contrast = contrastOf(snapshot.foreground, snapshot.background)
    expect(contrast, `${mode}: unparseable contrast (${snapshot.foreground} on ${snapshot.background})`).not.toBeNull()
    expect(contrast as number, `${mode}: text contrast on the panel card must be >= 3:1`).toBeGreaterThanOrEqual(3)
    if (snapshot.surfaceTokenRgb !== null) {
      expect(
        snapshot.background,
        `${mode}: card background must equal the resolved --dswsw-surface token (${snapshot.surfaceToken})`,
      ).toBe(snapshot.surfaceTokenRgb)
    }
  }

  const followed = light.background !== dark.background
  if (!followed) {
    const mediaDark = await prefersDark(page)
    testInfo.annotations.push({
      type: 'theme-pinned',
      description:
        `prefers-color-scheme flip did not change the panel background (browser reports dark=${mediaDark}; ` +
        `panel background stayed ${light.background}). The lab theme is pinned to one scheme — set it to ` +
        `"system" to exercise the light/dark direction assertions.`,
    })
    return { light, dark, followed }
  }

  const lightLuminance = luminanceOf(parseRgb(light.background) as NonNullable<ReturnType<typeof parseRgb>>)
  const darkLuminance = luminanceOf(parseRgb(dark.background) as NonNullable<ReturnType<typeof parseRgb>>)
  expect(lightLuminance, `light scheme background must be light (${light.background})`).toBeGreaterThanOrEqual(0.5)
  expect(darkLuminance, `dark scheme background must be dark (${dark.background})`).toBeLessThanOrEqual(0.35)
  return { light, dark, followed }
}
