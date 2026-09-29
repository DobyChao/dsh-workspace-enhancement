/**
 * INFRA-21 单测：`scripts/lib/doc-edit.mjs` 的断言式文档编辑——不命中必抛、
 * 不唯一必抛、落地校验必抛。R41–R43 三轮「裸 String.replace 静默丢编辑」的教训。
 * @module test/doc-edit
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mustInclude, replaceOrThrow } from '../scripts/lib/doc-edit.mjs'

const doc = [
  '## 1. 当前进行中（doing）',
  '',
  '| ID | 标题 | 状态 |',
  '|---|---|---|',
  '| X-1 | 示例行 | todo | 备注 |',
  '',
  '## 2. 已排期',
].join('\n')

test('replaceOrThrow: 命中且唯一时完成替换并保留其余内容', () => {
  const next = replaceOrThrow(doc, '| X-1 | 示例行 | todo |', '| X-1 | 示例行 | doing |', 'X-1 to doing')
  assert.ok(next.includes('| X-1 | 示例行 | doing |'))
  assert.ok(!next.includes('| todo |'))
  assert.ok(next.includes('## 2. 已排期'))
})

test('replaceOrThrow: 针不存在必抛（裸 replace 会静默无操作——本闸的由来）', () => {
  assert.throws(
    () => replaceOrThrow(doc, '| X-99 | 不存在 | todo |', '| X-99 | 不存在 | doing |', 'missing row'),
    /needle not found/,
  )
})

test('replaceOrThrow: 针不唯一必抛（提示收窄范围）', () => {
  const twice = `${doc}\n| X-1 | 示例行 | todo | 备注 |\n`
  assert.throws(
    () => replaceOrThrow(twice, '| X-1 | 示例行 | todo |', 'x', 'ambiguous row'),
    /not unique \(2 occurrences\)/,
  )
})

test('replaceOrThrow: 替换无变化必抛（防同义替换掩盖未落地）', () => {
  assert.throws(
    () => replaceOrThrow(doc, '| X-1 | 示例行 | todo |', '| X-1 | 示例行 | todo |', 'no-op replace'),
    /produced no change/,
  )
})

test('mustInclude: 缺失必抛、在场通过', () => {
  assert.doesNotThrow(() => mustInclude(doc, '## 2. 已排期', 'section 2 present'))
  assert.throws(() => mustInclude(doc, '## 3. 不存在', 'section 3'), /expected text missing/)
})
