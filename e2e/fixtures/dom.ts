/**
 * Layout / colour / evidence helpers.
 *
 * These are the ONLY places that read geometry and computed style. Specs stay
 * declarative: they locate elements semantically (role / text / data-*) and
 * hand the locators here. Every helper throws with a message that names the
 * measured numbers, because a bare `expect(false)` on a layout regression is
 * useless in a CI log.
 */

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Rectangle in CSS pixels, relative to the viewport (Playwright's shape). */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** `boundingBox()` that fails with the locator description instead of null. */
export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`[e2e] no bounding box for ${describeLocator(locator)} — element is not visible`)
  return box
}

/** Best-effort human description of a locator for failure messages. */
export function describeLocator(locator: Locator): string {
  return String(locator)
}

/** Whether `child` lies inside `container` (horizontal + vertical), ±tolerance. */
export function isInside(child: Box, container: Box, tolerance = 1): boolean {
  return child.x >= container.x - tolerance
    && child.y >= container.y - tolerance
    && child.x + child.width <= container.x + container.width + tolerance
    && child.y + child.height <= container.y + container.height + tolerance
}

/**
 * Assert every listed element sits inside the container rectangle. This is the
 * "关键元素 boundingBox 宽度 ≤ 容器宽度" regression check (E2E-02/03/04).
 */
export async function expectInside(
  container: Locator,
  children: ReadonlyArray<readonly [string, Locator]>,
  label: string,
  tolerance = 1,
): Promise<void> {
  const outer = await boxOf(container)
  const failures: string[] = []
  for (const [name, child] of children) {
    if (await child.count() === 0) {
      failures.push(`${name}: not found`)
      continue
    }
    const box = await child.first().boundingBox()
    if (box === null) {
      failures.push(`${name}: not visible`)
      continue
    }
    if (!isInside(box, outer, tolerance)) {
      failures.push(
        `${name}: x=${round(box.x)}..${round(box.x + box.width)} y=${round(box.y)}..${round(box.y + box.height)} ` +
        `outside container x=${round(outer.x)}..${round(outer.x + outer.width)} y=${round(outer.y)}..${round(outer.y + outer.height)}`,
      )
    }
  }
  expect(failures, `[${label}] elements escaped the container box:\n  ${failures.join('\n  ')}`).toEqual([])
}

/** One descendant that escapes its container's content box. */
export interface OverflowOffender {
  tag: string
  text: string
  left: number
  right: number
  /** Identifying attributes, so a failure names the control instead of "input". */
  id: string
  name: string
  type: string
  placeholder: string
  className: string
  /** Nearest preceding sibling text (usually the field label). */
  context: string
}

/** Raw overflow measurement of one container. */
export interface OverflowReport {
  innerLeft: number
  innerRight: number
  scrollWidth: number
  clientWidth: number
  offenders: OverflowOffender[]
}

/**
 * Measure horizontal overflow of a container in-page: any visible descendant
 * whose border box crosses the container's content box, plus the scrollWidth
 * vs clientWidth test (the classic "card content spills out" symptom).
 */
export async function overflowReport(container: Locator): Promise<OverflowReport> {
  return container.first().evaluate((node) => {
    const element = node as HTMLElement
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const num = (value: string): number => {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const innerLeft = rect.left + num(style.paddingLeft) + num(style.borderLeftWidth)
    const innerRight = rect.right - num(style.paddingRight) - num(style.borderRightWidth)
    const offenders: OverflowOffender[] = []
    for (const child of Array.from(element.querySelectorAll('*'))) {
      const childRect = child.getBoundingClientRect()
      if (childRect.width <= 0 || childRect.height <= 0) continue
      if (childRect.right > innerRight + 1 || childRect.left < innerLeft - 1) {
        const control = child as HTMLElement & { type?: string; placeholder?: string }
        let context = ''
        let cursor: Element | null = child
        for (let hop = 0; hop < 4 && cursor !== null; hop += 1) {
          const previous = cursor.previousElementSibling
          const text = (previous?.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (text !== '') { context = text.slice(0, 40); break }
          cursor = cursor.parentElement
        }
        offenders.push({
          tag: child.tagName.toLowerCase(),
          text: (child.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
          left: Math.round(childRect.left),
          right: Math.round(childRect.right),
          id: control.id ?? '',
          name: control.getAttribute('name') ?? '',
          type: control.type ?? '',
          placeholder: control.placeholder ?? '',
          className: typeof control.className === 'string' ? control.className.split(/\s+/)[0] ?? '' : '',
          context,
        })
      }
    }
    return {
      innerLeft: Math.round(innerLeft),
      innerRight: Math.round(innerRight),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      offenders: offenders.slice(0, 12),
    }
  })
}

/** Assert a container neither scrolls horizontally nor lets a child escape. */
export async function expectNoOverflow(container: Locator, label: string): Promise<void> {
  const report = await overflowReport(container)
  const scrollSpill = report.scrollWidth > report.clientWidth + 1
  const details = [
    `content box x=${report.innerLeft}..${report.innerRight}`,
    `scrollWidth=${report.scrollWidth} clientWidth=${report.clientWidth}`,
    ...report.offenders.map((o) => {
      const attrs = [
        o.type === '' ? '' : `type=${o.type}`,
        o.id === '' ? '' : `#${o.id}`,
        o.name === '' ? '' : `name=${o.name}`,
        o.placeholder === '' ? '' : `placeholder="${o.placeholder}"`,
        o.className === '' ? '' : `.${o.className}`,
        o.context === '' ? '' : `after="${o.context}"`,
      ].filter(Boolean).join(' ')
      return `  ${o.tag}${attrs === '' ? '' : ` [${attrs}]`} "${o.text}" x=${o.left}..${o.right}`
    }),
  ].join('\n  ')
  expect(
    scrollSpill || report.offenders.length > 0,
    `[${label}] horizontal overflow detected:\n  ${details}`,
  ).toBe(false)
}

/* ------------------------------------------------------------------ colour */

/** Parsed sRGB colour with alpha in [0, 1]. */
export interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

/** Parse `rgb(r, g, b)` / `rgba(r, g, b, a)`; null for anything else. */
export function parseRgb(value: string | null | undefined): Rgb | null {
  if (value === null || value === undefined) return null
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(value.trim())
  if (match === null) return null
  const channel = (raw: string): number => Math.max(0, Math.min(255, Number.parseFloat(raw)))
  const alphaRaw = match[4]
  const alpha = alphaRaw === undefined
    ? 1
    : alphaRaw.endsWith('%')
      ? Number.parseFloat(alphaRaw) / 100
      : Number.parseFloat(alphaRaw)
  return {
    r: channel(match[1] as string),
    g: channel(match[2] as string),
    b: channel(match[3] as string),
    a: Math.max(0, Math.min(1, alpha)),
  }
}

/** WCAG relative luminance of an opaque colour. */
export function luminanceOf(rgb: Rgb): number {
  const linear = (channel: number): number => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
}

/** WCAG contrast ratio between two colours; null when either is unparseable. */
export function contrastOf(foreground: string, background: string): number | null {
  const fg = parseRgb(foreground)
  const bg = parseRgb(background)
  if (fg === null || bg === null) return null
  const a = luminanceOf(fg)
  const b = luminanceOf(bg)
  const [light, dark] = a >= b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

/** Resolved colours + theme token of one element (theme-following assertions). */
export interface ThemeSnapshot {
  background: string
  foreground: string
  /** Resolved `--dswsw-surface` custom property on the element. */
  surfaceToken: string
  /** The surface token rendered as a real colour by the browser. */
  surfaceTokenRgb: string | null
}

/**
 * Read the colours of one element plus its `--dswsw-surface` token, resolving
 * the token through a scratch element so a token written as `#fff` and a
 * computed `rgb(255, 255, 255)` compare equal.
 */
export async function themeSnapshot(locator: Locator): Promise<ThemeSnapshot> {
  return locator.first().evaluate((node) => {
    const element = node as HTMLElement
    const style = getComputedStyle(element)
    const token = style.getPropertyValue('--dswsw-surface').trim()
    let resolved: string | null = null
    if (token !== '') {
      const probe = document.createElement('div')
      probe.style.backgroundColor = token
      probe.style.display = 'none'
      document.body.appendChild(probe)
      const computed = getComputedStyle(probe).backgroundColor
      probe.remove()
      resolved = computed === 'rgba(0, 0, 0, 0)' && !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/.test(token) ? null : computed
    }
    return {
      background: style.backgroundColor,
      foreground: style.color,
      surfaceToken: token,
      surfaceTokenRgb: resolved,
    }
  })
}

/** Whether the browser currently reports a dark preferred colour scheme. */
export async function prefersDark(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
}

/**
 * Read the colours of an element and wait until they stop changing.
 *
 * Needed after `page.emulateMedia({ colorScheme })`: the shell reacts to the
 * media query by rewriting `documentElement.style.colorScheme` and the theme
 * layer republishes its custom properties, so the first snapshot can still be
 * the previous scheme.
 * @param page - page owning the element.
 * @param locator - element to sample (its resolved tokens + colours).
 * @param attempts - how many 150 ms samples to compare.
 */
export async function settledThemeSnapshot(
  page: Page,
  locator: Locator,
  attempts = 20,
): Promise<ThemeSnapshot> {
  let previous = await themeSnapshot(locator)
  for (let index = 0; index < attempts; index += 1) {
    await page.waitForTimeout(150)
    const next = await themeSnapshot(locator)
    if (next.background === previous.background && next.foreground === previous.foreground) return next
    previous = next
  }
  return previous
}

/* ---------------------------------------------------------------- evidence */

/**
 * Screenshot directory inside the ignored `e2e/artifacts` tree.
 * Resolved from this module's location (cwd-independent), with a cwd fallback
 * for loaders that do not present a `file:` URL.
 */
export const SCREENSHOT_DIR = ((): string => {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'artifacts', 'screenshots')
  } catch {
    return resolve(process.cwd(), 'e2e', 'artifacts', 'screenshots')
  }
})()

/**
 * Store a curated evidence screenshot (happy path). Written to
 * `e2e/artifacts/screenshots/` and attached to the HTML report when a
 * `TestInfo` is supplied.
 * @param page - the page to capture.
 * @param name - file base name, e.g. `E2E-02-settings-zh`.
 * @param testInfo - optional Playwright test info for report attachment.
 */
export async function shot(page: Page, name: string, testInfo?: TestInfo): Promise<string> {
  const path = resolve(SCREENSHOT_DIR, `${name}.png`)
  await mkdir(dirname(path), { recursive: true })
  const buffer = await page.screenshot({ path, fullPage: false })
  if (testInfo !== undefined) await testInfo.attach(name, { body: buffer, contentType: 'image/png' })
  return path
}

/** Write an arbitrary text artefact (JSON dumps, measurements) next to shots. */
export async function writeEvidence(name: string, content: string): Promise<string> {
  const path = resolve(SCREENSHOT_DIR, '..', 'evidence', name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
  return path
}

/** Round to one decimal for readable failure messages. */
export function round(value: number): number {
  return Math.round(value * 10) / 10
}
