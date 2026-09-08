/**
 * E2E-07 — session-bar remote badge: a LOCAL session must NOT be marked.
 *
 * The plugin's DOM row layer injects a `[data-dsw-badge]` badge (with
 * `data-dsw-conn-id`) only into rows whose title matches a REMOTE workspace or
 * session. A local session being marked is the failure this guards against.
 *
 * Negative assertion hygiene: the row must first be proven to exist (otherwise
 * "no badge" would be vacuously true), and the badge layer needs a settle
 * window — it injects from a MutationObserver plus store subscriptions, so
 * checking immediately after the row appears can pass before the first scan.
 */

import { expect, test } from '../fixtures/index.ts'

/** How long the badge layer is given to run its first injection pass. */
const BADGE_SETTLE_MS = 3_000

test.describe('E2E-07 会话栏远程标识（负向）', () => {
  test('本地会话不显示远程徽标', async ({ app, session }) => {
    const { page } = app

    const rows = page.locator('[role="treeitem"]')
    await expect(rows.first()).toBeVisible({ timeout: 30_000 })

    // The row for OUR local session (its title derives from the sent marker).
    // Title derivation is asynchronous and can lag behind the row itself, so
    // fall back to the currently selected session row (the fixture just created
    // and selected one) instead of failing the whole guard on a timing race.
    const byMarker = rows.filter({ hasText: session.marker })
    let row = byMarker.first()
    if (await byMarker.count() === 0) {
      const selected = page.locator('[role="treeitem"][aria-selected="true"]').first()
      await expect(
        selected,
        'the session fixture must leave a selected local session row to assert on',
      ).toBeVisible({ timeout: 15_000 })
      row = selected
      app.testInfo.annotations.push({
        type: 'row-located-by-selection',
        description: `row title does not contain ${session.marker} yet; asserted on the selected session row instead`,
      })
    } else {
      await expect(
        row,
        'the local session row must exist, otherwise the negative badge assertion proves nothing',
      ).toBeVisible({ timeout: 15_000 })
    }

    // Give the DOM badge layer time to finish its first scan.
    await page.waitForTimeout(BADGE_SETTLE_MS)

    // Still the same row, still unmarked.
    await expect(row).toBeVisible()
    await expect(row).not.toContainText('🌐')
    expect(await row.locator('[data-dsw-badge]').count(), 'a local session row must carry no badge root').toBe(0)
    expect(await row.locator('[data-dsw-conn-id]').count(), 'a local session row must carry no conn-id marker').toBe(0)

    // Report whether the layer was active at all in this lab (no remote
    // workspaces => nothing to mark anywhere; the assertion above is then
    // weaker, and the annotation says so).
    const badgesInSidebar = await page.locator('[role="treeitem"] [data-dsw-badge]').count()
    app.testInfo.annotations.push({
      type: badgesInSidebar > 0 ? 'badge-layer-active' : 'badge-layer-idle',
      description: badgesInSidebar > 0
        ? `badge layer marked ${badgesInSidebar} other row(s); our local row stayed unmarked`
        : 'no remote workspaces/sessions in this lab, so no row is marked anywhere',
    })

    await app.shot('E2E-07-local-session-unmarked')
  })
})
