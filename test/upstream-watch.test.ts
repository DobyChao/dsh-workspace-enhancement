/**
 * UPSTREAM-7 单测：scope watch 的纯逻辑——组合差异（组成漂移）、SSH 四包收编判定、
 * 报告渲染。CLI 的注册表查询不在单测里跑（spawn + 网络），由 `upstream.yml` 的
 * scope-watch 作业与本地 `node scripts/upstream-watch.mjs` 承担。
 * @module test/upstream-watch
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SSH_PACKAGES,
  compositionCell,
  deepDepsOf,
  diffBaseline,
  renderReport,
} from '../scripts/upstream-watch.mjs'

function cell(deps: string[], version = '1.0.0'): { version: string; deps: string[] } {
  return compositionCell(version, deps)
}

test('deepDepsOf: unions every dep block, @deepseek-ai only, sorted', () => {
  const names = deepDepsOf({
    dependencies: { '@deepseek-ai/dsh-base': '*', 'ssh2': '^1' },
    optionalDependencies: { '@deepseek-ai/dsh-brand': '*' },
    peerDependencies: { '@deepseek-ai/cordis': '^4', 'other-pkg': 'x' },
  })
  assert.deepEqual(names, ['@deepseek-ai/cordis', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-brand'])
  assert.deepEqual(deepDepsOf(undefined), [])
  assert.deepEqual(deepDepsOf({}), [])
})

test('diffBaseline: identical compositions stay silent', () => {
  const hosts = { '@deepseek-ai/dsh': { next: cell(['@deepseek-ai/dsh-base']) } }
  const diff = diffBaseline(hosts, { '@deepseek-ai/dsh': { next: cell(['@deepseek-ai/dsh-base']) } })
  assert.deepEqual(diff, { changes: [], sshAdopted: [], sshBaseline: [] })
  assert.equal(renderReport(diff), '')
})

test('diffBaseline: a new dependency in any tag rings as an addition', () => {
  const baseline = {
    '@deepseek-ai/dsh': {
      latest: cell(['@deepseek-ai/dsh-base'], '0.1.5-rc.3'),
      next: cell(['@deepseek-ai/dsh-base'], '0.1.7-rc.2'),
    },
  }
  const observed = {
    '@deepseek-ai/dsh': {
      latest: cell(['@deepseek-ai/dsh-base'], '0.1.5-rc.3'),
      next: cell(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-anything-new'], '0.1.7-rc.2'),
    },
  }
  const diff = diffBaseline(baseline, observed)
  assert.deepEqual(diff.changes, [
    { package: '@deepseek-ai/dsh', tag: 'next', kind: 'added', deps: ['@deepseek-ai/dsh-anything-new'] },
  ])
  assert.match(renderReport(diff), /dsh-anything-new/)
})

test('diffBaseline: a dropped dependency rings as a removal', () => {
  const diff = diffBaseline(
    { '@deepseek-ai/dsh-web-app': { next: cell(['@deepseek-ai/dsh-frontend', '@deepseek-ai/dsh-storage']) } },
    { '@deepseek-ai/dsh-web-app': { next: cell(['@deepseek-ai/dsh-storage']) } },
  )
  assert.deepEqual(diff.changes, [
    { package: '@deepseek-ai/dsh-web-app', tag: 'next', kind: 'removed', deps: ['@deepseek-ai/dsh-frontend'] },
  ])
})

test('diffBaseline: a tag the baseline never recorded reports every dep as an addition', () => {
  const diff = diffBaseline(
    { '@deepseek-ai/dsh': { latest: cell(['@deepseek-ai/dsh-base']) } },
    { '@deepseek-ai/dsh': { latest: cell(['@deepseek-ai/dsh-base']), next: cell(['@deepseek-ai/dsh-base']) } },
  )
  assert.deepEqual(diff.changes, [
    { package: '@deepseek-ai/dsh', tag: 'next', kind: 'added', deps: ['@deepseek-ai/dsh-base'] },
  ])
})

test('diffBaseline: SSH runtime adoption is surfaced as the UPSTREAM-6 trigger once', () => {
  // First sighting: rings in both the composition diff and the SSH callout.
  const observed = {
    '@deepseek-ai/dsh': { next: cell(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-ssh'], '0.1.8-rc.1') },
  }
  const first = diffBaseline({ '@deepseek-ai/dsh': { next: cell(['@deepseek-ai/dsh-base']) } }, observed)
  assert.deepEqual(first.sshBaseline, [
    { package: '@deepseek-ai/dsh', tag: 'next', version: '0.1.8-rc.1', deps: ['@deepseek-ai/dsh-ssh'] },
  ])
  assert.match(renderReport(first), /UPSTREAM-6 reevaluation trigger/)

  // Already acknowledged in the baseline: still listed as adopted, but no new ring.
  const acknowledged = diffBaseline(observed, observed)
  assert.deepEqual(acknowledged.sshAdopted, first.sshAdopted)
  assert.deepEqual(acknowledged.sshBaseline, [])
  assert.equal(renderReport(acknowledged), '', 'an acknowledged composition must not re-ring')
})

test('diffBaseline: every official SSH package name counts as adoption', () => {
  for (const name of SSH_PACKAGES) {
    const diff = diffBaseline(
      { '@deepseek-ai/dsh-web-app': { alpha: cell(['@deepseek-ai/dsh-base']) } },
      { '@deepseek-ai/dsh-web-app': { alpha: cell(['@deepseek-ai/dsh-base', name]) } },
    )
    assert.equal(diff.sshBaseline.length, 1, `${name} must be recognized`)
  }
})

test('diffBaseline: cells missing from the observation are skipped, never fabricated', () => {
  const diff = diffBaseline(
    { '@deepseek-ai/dsh': { next: cell(['@deepseek-ai/dsh-base']) } },
    {},
  )
  assert.deepEqual(diff, { changes: [], sshAdopted: [], sshBaseline: [] })
})
