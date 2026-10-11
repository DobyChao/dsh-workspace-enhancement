/**
 * UPSTREAM-11 单测：desktop composition watch 的纯逻辑——文件指纹差异、
 * 版本抽取、报告渲染。CLI 的 monorepo 抓取不在单测里跑（网络），由
 * `upstream.yml` 的 desktop-watch 作业与本地 `node scripts/upstream-desktop.mjs` 承担。
 * @module test/upstream-desktop
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DESKTOP_FILES,
  WEB_TEMPLATE_INVARIANT,
  diffDesktop,
  extractDesktopVersion,
  fingerprintOf,
  renderReport,
} from '../scripts/upstream-desktop.mjs'

const pkg = 'apps/desktop/package.json'
const template = 'apps/desktop/src/project-manager.ts'

function observed(): Record<string, { sha256: string, bytes: number, version?: string, webTemplate?: boolean }> {
  return {
    [pkg]: { sha256: 'a'.repeat(64), bytes: 100, version: '0.2.0-rc.2' },
    [template]: { sha256: 'b'.repeat(64), bytes: 200, webTemplate: true },
    'apps/desktop/src/core-package-set.ts': { sha256: 'c'.repeat(64), bytes: 250 },
    'apps/desktop-host/src/index.ts': { sha256: 'd'.repeat(64), bytes: 300 },
  }
}

test('diffDesktop: identical baselines stay silent', () => {
  const now = observed()
  const diff = diffDesktop(now, now)
  assert.deepEqual(diff.changes, [])
  assert.equal(diff.silent, true)
  assert.equal(renderReport(diff), '')
})

test('diffDesktop: a moved template hash rings (the composition-fork earliest signal)', () => {
  const baseline = observed()
  const next = observed()
  next[template] = { sha256: 'e'.repeat(64), bytes: 201, webTemplate: true }
  const diff = diffDesktop(baseline, next)
  assert.deepEqual(diff.changes, [
    { path: template, field: 'sha256', from: 'b'.repeat(64), to: 'e'.repeat(64) },
    { path: template, field: 'bytes', from: '200', to: '201' },
  ])
  assert.equal(diff.silent, false)
  // A cosmetic-only hash move must NOT raise the composition-fork banner.
  assert.ok(!renderReport(diff).includes('COMPOSITION FORK'))
})

test('diffDesktop: the webTemplate invariant going false is the fork itself', () => {
  const baseline = observed()
  const next = observed()
  next[template] = { sha256: 'f'.repeat(64), bytes: 202, webTemplate: false }
  const report = renderReport(diffDesktop(baseline, next))
  assert.match(report, /COMPOSITION FORK/)
  assert.match(report, /PROFILE_TEMPLATES\.web/)
})

test('diffDesktop: a desktop version bump rings on the version field', () => {
  const baseline = observed()
  const next = observed()
  next[pkg] = { sha256: 'g'.repeat(64), bytes: 101, version: '0.2.1-alpha.1' }
  const diff = diffDesktop(baseline, next)
  assert.deepEqual(diff.changes.map(change => change.field).sort(), ['bytes', 'sha256', 'version'])
})

test('diffDesktop: a path missing from the baseline counts as an addition, never a crash', () => {
  const next = observed()
  const diff = diffDesktop({}, next)
  assert.equal(diff.silent, false)
  assert.ok(diff.changes.every(change => change.from === '(none)'))
})

test('extractDesktopVersion: parses the version, tolerates junk', () => {
  assert.equal(extractDesktopVersion('{"version": "0.2.1-alpha.2"}'), '0.2.1-alpha.2')
  assert.equal(extractDesktopVersion('{"name": "x"}'), undefined)
  assert.equal(extractDesktopVersion('not json'), undefined)
})

test('WEB_TEMPLATE_INVARIANT: matches the template spelling the survey pinned', () => {
  assert.ok(WEB_TEMPLATE_INVARIANT.test("const bundles = PROFILE_TEMPLATES.web.bundles"))
  assert.ok(!WEB_TEMPLATE_INVARIANT.test("const bundles = PROFILE_TEMPLATES.desktop.bundles"))
})

test('fingerprintOf: same text, same digest; different text, different digest', () => {
  assert.equal(fingerprintOf('abc'), fingerprintOf('abc'))
  assert.notEqual(fingerprintOf('abc'), fingerprintOf('abd'))
})

test('renderReport: every touched file names its meaning and the acknowledge command', () => {
  const baseline = observed()
  const next = observed()
  next[template] = { sha256: 'e'.repeat(64), bytes: 201, webTemplate: true }
  const report = renderReport(diffDesktop(baseline, next))
  assert.ok(report.includes(`| \`${template}\` | sha256 |`), '报告表格必须点名 template 文件的 sha256 变化')
  assert.ok(report.includes(DESKTOP_FILES[template]), '报告必须带上组合分叉最早信号的含义')
  assert.ok(report.includes('UPSTREAM-11'))
  assert.match(report, /--write-baseline/)
})
