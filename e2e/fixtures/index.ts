/**
 * Extended Playwright test: shared fixtures for the dsh-workspace-enhancement
 * E2E suite.
 *
 * Isolation contract: every test gets a fresh browser context and page (the
 * Playwright default). Fixtures prepare the state a spec needs and clean it up
 * afterwards; no spec may depend on another spec's side effects.
 *
 * `app`      — booted page + console/page-error collectors + evidence helper.
 * `machine`  — one machine provisioned through the real settings form, removed
 *              again on teardown (stale rows from an interrupted run are purged
 *              before provisioning, so the fixture is idempotent).
 * `session`  — one live local session (composer send) with the sidebar open.
 */

import { expect, test as base, type Page, type TestInfo } from '@playwright/test'
import { shot } from './dom.ts'
import {
  E2E_MACHINE_PREFIX,
  addMachine,
  deleteMachineRow,
  machineRow,
  purgeE2eMachines,
  type MachineSpec,
} from './plugin.ts'
import { openSettingsSection, openSidebar, startSession, waitForShell } from './shell.ts'

/** Booted page plus the diagnostics a spec may assert or annotate. */
export interface AppHandle {
  page: Page
  testInfo: TestInfo
  /** `console` messages of type `error` seen since boot. */
  consoleErrors: string[]
  /** Uncaught page exceptions seen since boot. */
  pageErrors: string[]
  /** Curated evidence screenshot, attached to the HTML report. */
  shot(name: string): Promise<string>
}

/** The machine provisioned by the `machine` fixture. */
export type MachineHandle = MachineSpec

/** The local session created by the `session` fixture. */
export interface SessionHandle {
  /** Unique message text; also the derived session title substring. */
  marker: string
}

interface Fixtures {
  app: AppHandle
  machine: MachineHandle
  session: SessionHandle
}

export const test = base.extend<Fixtures>({
  app: async ({ page }, use, testInfo) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => { pageErrors.push(error.message) })
    // settings.tsx deletes machines through `window.confirm`; accept it so the
    // cleanup path cannot stall. Playwright auto-DISMISSES dialogs otherwise.
    page.on('dialog', (dialog) => { void dialog.accept() })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForShell(page)

    const handle: AppHandle = {
      page,
      testInfo,
      consoleErrors,
      pageErrors,
      shot: async (name: string) => shot(page, `${testInfo.title.replace(/[^\w-]+/g, '-')}-${name}`, testInfo),
    }
    await use(handle)

    if (pageErrors.length > 0) {
      testInfo.annotations.push({
        type: 'pageerror',
        description: pageErrors.slice(0, 5).join(' | '),
      })
      if (process.env.DSW_E2E_STRICT_CONSOLE === '1') {
        expect(pageErrors, 'uncaught page errors while the plugin was mounted').toEqual([])
      }
    }
  },

  machine: async ({ app }, use) => {
    const spec: MachineSpec = {
      label: `${E2E_MACHINE_PREFIX}${Date.now().toString(36)}`,
      // RFC 2606 reserved TLD: guaranteed non-resolvable, never real data.
      host: 'e2e-host.example.invalid',
      port: '2222',
      username: 'e2e-user',
    }

    await openSettingsSection(app.page, 'settings.label', 'settings.title')
    const purged = await purgeE2eMachines(app.page)
    if (purged.length > 0) {
      app.testInfo.annotations.push({ type: 'stale-machines-purged', description: purged.join(', ') })
    }
    await addMachine(app.page, spec)
    await machineRow(app.page, spec.label)

    await use(spec)

    // Best-effort teardown: a failure here must not mask the test result, and
    // the next run purges leftovers anyway.
    try {
      await openSettingsSection(app.page, 'settings.label', 'settings.title')
      await deleteMachineRow(app.page, spec.label)
    } catch (error) {
      app.testInfo.annotations.push({
        type: 'teardown-warning',
        description: `machine ${spec.label} not removed: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  },

  session: async ({ app }, use) => {
    const marker = `e2e-local-${Date.now().toString(36)}`
    await startSession(app.page, marker)
    // Session rows live in the sidebar; expand it so row assertions can run.
    await openSidebar(app.page)
    await use({ marker })
  },
})

export { expect }
export type { Page }
