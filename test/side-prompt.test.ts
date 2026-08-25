/**
 * R5-T5 单测：提示注入扩展 —— 副工作区清单渲染（权限标记/空清单零噪音）、
 * composeWorkspacePrompt 组合（远程强调 × 副列表的四种组合）。
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
  return { id: 'sw-1', kind: 'local', rootKey: LOCAL_ROOT, label: '本地项目', fs: 'rw', exec: 'on', ...over }
}

test('renderSideWorkspaces: empty list renders empty (zero noise)', () => {
  assert.equal(renderSideWorkspaces([]), '')
})

test('renderSideWorkspaces: one item renders label, root, and the permission pair', () => {
  const text = renderSideWorkspaces([item({ fs: 'r', exec: 'off' })])
  assert.ok(text.includes('副工作区 **本地项目**'))
  assert.ok(text.includes(`\`${LOCAL_ROOT}\``))
  assert.ok(text.includes('fs: 只读'))
  assert.ok(text.includes('exec: 关'))
  assert.ok(text.includes('模型可直接操作'))
  assert.ok(text.includes('只读（fs: 只读）拒绝写入'))
})

test('renderSideWorkspaces: remote item displays the ssh:// root; rw/on marks honest', () => {
  const text = renderSideWorkspaces([item({ kind: 'remote', rootKey: 'ssh://c1/srv/work', label: 'c1 工作' })])
  assert.ok(text.includes('`ssh://c1/srv/work`'))
  assert.ok(text.includes('fs: 读写'))
  assert.ok(text.includes('exec: 开'))
  // 只出现一份清单头（一个条目）
  assert.equal(text.split('本会话额外关联的工作区').length - 1, 1)
})

test('renderSideWorkspaces: multiple items keep attachment order', () => {
  const first = item({ id: 'sw-a', label: 'A', rootKey: LOCAL_ROOT })
  const second = item({ id: 'sw-b', kind: 'remote', rootKey: 'ssh://c1/srv/work', label: 'B' })
  const text = renderSideWorkspaces([first, second])
  assert.ok(text.indexOf('**A**') < text.indexOf('**B**'))
})

test('sideWorkspacePromptFact: leaf projection is small and stable', () => {
  assert.deepEqual(sideWorkspacePromptFact(item({ fs: 'r', exec: 'off', label: 'P' })), {
    label: 'P', rootKey: LOCAL_ROOT, fs: '只读', exec: '关',
  })
})

test('composeWorkspacePrompt: local cwd without sides renders empty', () => {
  assert.equal(composeWorkspacePrompt(resolve(tmpdir(), 'main'), undefined, []), '')
  assert.equal(composeWorkspacePrompt(undefined, undefined, []), '')
})

test('composeWorkspacePrompt: local cwd with sides renders ONLY the side list', () => {
  const text = composeWorkspacePrompt(resolve(tmpdir(), 'main'), undefined, [item({})])
  assert.ok(!text.includes('远程 SSH 工作区'))
  assert.ok(text.includes('副工作区'))
})

test('composeWorkspacePrompt: remote cwd without sides keeps the pure R4 text', () => {
  const machine = { username: 'uuz', host: '127.0.0.1', workspace: '/srv/work' }
  const text = composeWorkspacePrompt('ssh://c1/srv/work', machine, [])
  assert.ok(text.includes('远程 SSH 工作区'))
  assert.ok(text.includes('uuz@127.0.0.1'))
  assert.ok(!text.includes('副工作区'))
})

test('composeWorkspacePrompt: remote cwd with sides renders BOTH parts', () => {
  const machine = { username: 'uuz', host: '127.0.0.1' }
  const text = composeWorkspacePrompt('ssh://c1/srv/work', machine, [item({ kind: 'remote', rootKey: 'ssh://c1/deploy', label: '部署' })])
  assert.ok(text.includes('远程 SSH 工作区'))
  assert.ok(text.includes('副工作区 **部署**'))
  // 两段以空行分隔
  assert.equal(text.split('\n\n').length, 2)
})
