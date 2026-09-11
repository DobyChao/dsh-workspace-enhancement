/**
 * R5-T5 → REQ-I7 单测：提示注入扩展 —— 副工作区清单渲染（薄声明行/空清单零噪音）、
 * composeWorkspacePrompt 组合（远程强调 × 副列表的四种组合）。
 *
 * REQ-I7 ① 之后清单行只剩 label + rootKey（权限档位退役，ADR-0019）。
 * REQ-I6 ① 之后这里的断言全部是英文：model-facing 文案不随 UI 语言切换
 * （`src/model-prompts.ts`，见 `docs/decisions/ADR-0014`）。
 * @module test/side-prompt
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { composeWorkspacePrompt, renderSideWorkspaces, sideWorkspacePromptFact } from '../src/tools.ts'
import type { SideWorkspaceItem } from '../src/session-workspaces.ts'

const LOCAL_ROOT = resolve(tmpdir(), 'dsw-prompt', 'local-proj')

function item(over: Partial<SideWorkspaceItem>): SideWorkspaceItem {
  return { id: 'sw-1', kind: 'local', rootKey: LOCAL_ROOT, label: '本地项目', ...over }
}

test('renderSideWorkspaces: empty list renders empty (zero noise)', () => {
  assert.equal(renderSideWorkspaces([]), '')
})

test('renderSideWorkspaces: one item renders label and root only, NO permission marks', () => {
  const text = renderSideWorkspaces([item({})])
  assert.ok(text.includes('Side workspace **本地项目**'))
  assert.ok(text.includes(`\`${LOCAL_ROOT}\``))
  assert.ok(text.includes('side directories the model can operate on directly'))
  assert.ok(text.includes('an extra directory this session can operate on directly'))
  // REQ-I7: the retired permission tiers must not survive anywhere in the copy.
  assert.ok(!text.includes('fs:'))
  assert.ok(!text.includes('exec:'))
  assert.ok(!text.includes('read-only'))
  // REQ-I6 ①: no Chinese model-facing copy may survive (labels are data, not copy).
  assert.ok(!text.includes('只读') && !text.includes('副工作区'))
})

test('renderSideWorkspaces: remote item displays the ssh:// root', () => {
  const text = renderSideWorkspaces([item({ kind: 'remote', rootKey: 'ssh://c1/srv/work', label: 'c1 工作' })])
  assert.ok(text.includes('`ssh://c1/srv/work`'))
  // 只出现一份清单头（一个条目）
  assert.equal(text.split('Extra workspaces linked to this session').length - 1, 1)
})

test('renderSideWorkspaces: multiple items keep attachment order', () => {
  const first = item({ id: 'sw-a', label: 'A', rootKey: LOCAL_ROOT })
  const second = item({ id: 'sw-b', kind: 'remote', rootKey: 'ssh://c1/srv/work', label: 'B' })
  const text = renderSideWorkspaces([first, second])
  assert.ok(text.indexOf('**A**') < text.indexOf('**B**'))
})

test('sideWorkspacePromptFact: leaf projection is small and stable', () => {
  assert.deepEqual(sideWorkspacePromptFact(item({ label: 'P' })), {
    label: 'P', rootKey: LOCAL_ROOT,
  })
  assert.deepEqual(sideWorkspacePromptFact(item({ kind: 'remote', rootKey: 'ssh://c1/x' })), {
    label: '本地项目', rootKey: 'ssh://c1/x',
  })
})

test('composeWorkspacePrompt: local cwd without sides renders empty', () => {
  assert.equal(composeWorkspacePrompt(resolve(tmpdir(), 'main'), undefined, []), '')
  assert.equal(composeWorkspacePrompt(undefined, undefined, []), '')
})

test('composeWorkspacePrompt: local cwd with sides renders ONLY the side list', () => {
  const text = composeWorkspacePrompt(resolve(tmpdir(), 'main'), undefined, [item({})])
  assert.ok(!text.includes('remote SSH workspace'))
  assert.ok(text.includes('Side workspace'))
})

test('composeWorkspacePrompt: remote cwd without sides keeps the pure R4 text', () => {
  const machine = { username: 'uuz', host: '127.0.0.1', workspace: '/srv/work' }
  const text = composeWorkspacePrompt('ssh://c1/srv/work', machine, [])
  assert.ok(text.includes('remote SSH workspace'))
  assert.ok(text.includes('uuz@127.0.0.1'))
  assert.ok(!text.includes('Side workspace'))
})

test('composeWorkspacePrompt: remote cwd with sides renders BOTH parts', () => {
  const machine = { username: 'uuz', host: '127.0.0.1' }
  const text = composeWorkspacePrompt('ssh://c1/srv/work', machine, [item({ kind: 'remote', rootKey: 'ssh://c1/deploy', label: '部署' })])
  assert.ok(text.includes('remote SSH workspace'))
  assert.ok(text.includes('Side workspace **部署**'))
  // 两段以空行分隔
  assert.equal(text.split('\n\n').length, 2)
})
