/**
 * Static contract guard (not a UI scenario): the COPY table in
 * `fixtures/copy.ts` must stay byte-identical with the real dictionaries in
 * `src/locale/dsw.ts` / `src/locale/dsw.en.ts`.
 *
 * This is what keeps the copy assertions honest: the specs pin literal strings,
 * and this test fails the moment a dictionary value changes, naming the exact
 * key and both values. No browser is involved, so it runs even when the lab is
 * down — but `globalSetup` still probes the lab first, because the suite as a
 * whole is a black-box suite.
 */

import { expect, test } from '../fixtures/index.ts'
import { copyDrift } from '../fixtures/copy.ts'

test.describe('copy 契约（静态守卫）', () => {
  test('COPY 表与 src/locale 词典逐键一致', async () => {
    const drift = copyDrift()
    const report = drift
      .map(entry => `${entry.key} [${entry.lang}]\n    table:      ${JSON.stringify(entry.table)}\n    dictionary: ${JSON.stringify(entry.dictionary)}`)
      .join('\n')
    expect(drift, `COPY table drifted from src/locale/dsw*.ts:\n${report}`).toEqual([])
  })
})
