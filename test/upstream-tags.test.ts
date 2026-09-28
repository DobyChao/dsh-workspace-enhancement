/**
 * INFRA-20 单测：dist-tag watch 的纯逻辑——通道差异（tag 漂移）、通道含义渲染、
 * 报告渲染。CLI 的注册表查询不在单测里跑（spawn + 网络），由 `upstream.yml` 的
 * tag-watch 作业与本地 `node scripts/upstream-tags.mjs` 承担。
 * @module test/upstream-tags
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHANNEL_MEANING,
  TAG_CHANNELS,
  TAG_PACKAGES,
  diffTags,
  renderReport,
} from '../scripts/upstream-tags.mjs'

const pkg = TAG_PACKAGES[0]

function tags(latest: string, next: string, alpha: string): Record<string, Record<string, string>> {
  return { [pkg]: { latest, next, alpha } }
}

test('diffTags: identical baselines stay silent', () => {
  const observed = tags('0.1.7-rc.2', '0.1.7-rc.2', '0.1.7-alpha.2')
  const diff = diffTags(observed, observed)
  assert.deepEqual(diff.changes, [])
  assert.equal(diff.silent, true)
  assert.equal(renderReport(diff), '')
})

test('diffTags: a moved channel rings with from → to (the 2026-09-28 latest flip shape)', () => {
  const baseline = tags('0.1.5-rc.3', '0.1.7-rc.2', '0.1.7-alpha.2')
  const observed = tags('0.1.7-rc.2', '0.1.7-rc.2', '0.1.7-alpha.2')
  const diff = diffTags(baseline, observed)
  assert.deepEqual(diff.changes, [{ package: pkg, channel: 'latest', from: '0.1.5-rc.3', to: '0.1.7-rc.2' }])
  assert.equal(diff.silent, false)
})

test('diffTags: a channel missing from the baseline counts as an addition, never a crash', () => {
  const diff = diffTags({}, tags('1.0.0', '1.0.0-rc.1', '1.0.0-alpha.1'))
  assert.deepEqual(
    diff.changes.map(change => change.channel).sort(),
    [...TAG_CHANNELS].sort(),
  )
  assert.ok(diff.changes.every(change => change.from === '(none)'))
})

test('diffTags: observed channels that are absent are skipped (registry holes are not signals)', () => {
  const diff = diffTags(tags('1.0.0', '1.0.0', '1.0.0'), { [pkg]: { latest: '1.0.1' } })
  assert.deepEqual(diff.changes, [{ package: pkg, channel: 'latest', from: '1.0.0', to: '1.0.1' }])
})

test('renderReport: every moved channel names its meaning and the acknowledge command', () => {
  const diff = diffTags(tags('0.1.5-rc.3', '0.1.7-rc.2', '0.1.7-alpha.1'), tags('0.1.7-rc.2', '0.1.7-rc.2', '0.1.7-alpha.2'))
  const report = renderReport(diff)
  assert.match(report, /\| @deepseek-ai\/dsh \| latest \| 0\.1\.5-rc\.3 \| 0\.1\.7-rc\.2 \|/)
  assert.match(report, /\| @deepseek-ai\/dsh \| alpha \| 0\.1\.7-alpha\.1 \| 0\.1\.7-alpha\.2 \|/)
  assert.ok(report.includes(CHANNEL_MEANING.latest), '报告必须带上 latest 通道的含义（peer-pin 政策指针）')
  assert.ok(report.includes(CHANNEL_MEANING.alpha), '报告必须带上 alpha 通道的含义（预警）')
  assert.match(report, /--write-baseline/)
})
