/**
 * Shared MachineForm tests (R2 表单并集, t2): the pure helpers the form is
 * built on (jump text parsing/summary, the machinePayload jump merge) and a
 * static server render of the two modes — the render assertions stand in for
 * the lab screenshot: same field set in both modes, flow's save label and
 * cancel only there, settings' reset action only there.
 * @module test/machine-form
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MachineForm, asSaveView, createActionGate, jumpChainOf, jumpErrorOf, jumpSummaryOf, parseJumpText } from '../src/client/machine-form.tsx'
import type { RpcCall } from '../src/client/status.tsx'
import { EMPTY_MACHINE_FORM, machinePayload } from '../src/client/machine-payload.ts'

const idleRpc: RpcCall = () => Promise.resolve({ ok: true, value: undefined })

function markup(mode: 'settings' | 'flow'): string {
  return renderToStaticMarkup(createElement(MachineForm, {
    mode,
    rpc: idleRpc,
    onSaved: () => {},
    ...(mode === 'flow' ? { onCancel: () => {} } : {}),
  }))
}

function markupPiece(mode: 'settings' | 'flow', piece: string): boolean {
  return markup(mode).includes(piece)
}

test('parseJumpText: user@host:port, bare hosts, and comma/space separation', () => {
  assert.deepEqual(parseJumpText('bastion'), [{ host: 'bastion' }])
  assert.deepEqual(parseJumpText('user@jump.example.com:2202, b2'), [
    { host: 'jump.example.com', port: 2202, username: 'user' },
    { host: 'b2' },
  ])
  assert.deepEqual(parseJumpText(''), [])
  assert.deepEqual(parseJumpText('  a ,, b '), [{ host: 'a' }, { host: 'b' }])
  assert.deepEqual(parseJumpText('user@'), [{ host: '', username: 'user' }])
})

test('jumpSummaryOf: counts + formats hops; malformed text hints', () => {
  assert.equal(jumpSummaryOf(''), '')
  assert.equal(jumpSummaryOf('u@b1:2202, b2'), '跳板 2 段 · u@b1:2202 → b2')
  assert.equal(jumpSummaryOf('user@'), '跳板链中存在无法解析的段')
})

test('machinePayload: merges the parsed jump chain; undefined omits, [] is an explicit clear', () => {
  const payload = machinePayload(EMPTY_MACHINE_FORM, [{ host: 'b1' }, { host: 'b2', port: 2202, username: 'u' }])
  assert.deepEqual(payload.jump, [{ host: 'b1' }, { host: 'b2', port: 2202, username: 'u' }])
  const without = machinePayload(EMPTY_MACHINE_FORM, undefined)
  assert.equal('jump' in without, false)
  // t8: an EXPLICIT empty chain reaches the wire as `jump: []` (clear signal).
  const empty = machinePayload(EMPTY_MACHINE_FORM, [])
  assert.deepEqual(empty.jump, [])
})

test('t8: jumpChainOf — an edit clearing a chain the machine had sends the explicit clear', () => {
  // A non-empty text parses to its hops (any mode).
  assert.deepEqual(jumpChainOf('u@b1, b2', true, 'u@b1, b2'), [
    { host: 'b1', username: 'u' },
    { host: 'b2' },
  ])
  // Edit + chain text emptied + the machine HAD a chain → [] (clear).
  assert.deepEqual(jumpChainOf('', true, 'u@b1, b2'), [])
  assert.deepEqual(jumpChainOf('   ', true, ' u@b1 '), [])
  // Edit of a machine that never had a chain → omit.
  assert.equal(jumpChainOf('', true, ''), undefined)
  assert.equal(jumpChainOf('', true, undefined), undefined)
  // A NEW machine with an empty text → omit (no jump, unchanged behavior).
  assert.equal(jumpChainOf('', false, 'whatever'), undefined)
  assert.equal(jumpChainOf('', false, undefined), undefined)
})

test('t8: an edit clearing the jump text sends jump: [] on the wire', () => {
  const edit = { ...EMPTY_MACHINE_FORM, id: 'c1' }
  const cleared = machinePayload(edit, jumpChainOf('', true, 'u@bastion'))
  assert.deepEqual(cleared.jump, [])
  const kept = machinePayload(edit, jumpChainOf('', true, ''))
  assert.equal('jump' in kept, false)
})

test('machinePayload: plaintext switch rules unchanged by the jump param', () => {
  const plain = machinePayload({ ...EMPTY_MACHINE_FORM, password: 'pw' })
  assert.equal(plain.credentialBackend, 'plain')
  const keychain = machinePayload({ ...EMPTY_MACHINE_FORM, password: 'pw', encryptPassword: true })
  assert.equal('credentialBackend' in keychain, false)
  const silent = machinePayload(EMPTY_MACHINE_FORM)
  assert.equal('password' in silent, false)
})

test('P2-④: an edit payload omits an empty privateKeyPath (keep) and sends a typed one', () => {
  const edit = machinePayload({ ...EMPTY_MACHINE_FORM, id: 'c1' })
  assert.equal('privateKeyPath' in edit, false)
  const editTyped = machinePayload({ ...EMPTY_MACHINE_FORM, id: 'c1', privateKeyPath: 'C:\\u\\.ssh\\id_ed25519' })
  assert.equal(editTyped.privateKeyPath, 'C:\\u\\.ssh\\id_ed25519')
  // New machine: '' is sent explicitly (未配置), a path as typed.
  const fresh = machinePayload(EMPTY_MACHINE_FORM)
  assert.equal(fresh.privateKeyPath, '')
  const freshTyped = machinePayload({ ...EMPTY_MACHINE_FORM, privateKeyPath: 'C:\\u\\.ssh\\id_ed25519' })
  assert.equal(freshTyped.privateKeyPath, 'C:\\u\\.ssh\\id_ed25519')
})

test('P2-②: jumpErrorOf blocks malformed jump text and accepts valid/absent chains', () => {
  assert.equal(jumpErrorOf(''), null)
  assert.equal(jumpErrorOf('   '), null)
  assert.equal(jumpErrorOf('user@bastion.example.com:2202, b2'), null)
  assert.equal(jumpErrorOf('a ,, b'), null)
  assert.match(jumpErrorOf('user@') ?? '', /无法解析/)
  assert.match(jumpErrorOf(':2202') ?? '', /无法解析/)
  assert.match(jumpErrorOf(',') ?? '', /无法解析/)
  // The summary and the submit error agree on the malformed case.
  assert.equal(jumpSummaryOf('user@'), '跳板链中存在无法解析的段')
  assert.notEqual(jumpErrorOf('user@'), null)
})

test('P2-③: the action gate rejects a second claim while one action owns the form', () => {
  const gate = createActionGate()
  assert.equal(gate.busy(), false)
  assert.equal(gate.claim('test'), true)
  assert.equal(gate.busy(), true)
  // Same-tick double click: the second click is dropped before any re-render.
  assert.equal(gate.claim('save'), false)
  assert.equal(gate.claim('test'), false)
  // Only the current owner can release; a stale finally cannot clear the gate.
  assert.equal(gate.release('save'), false)
  assert.equal(gate.busy(), true)
  assert.equal(gate.release('test'), true)
  assert.equal(gate.busy(), false)
  assert.equal(gate.claim('save'), true)
  assert.equal(gate.release('save'), true)
})

test('F2: asSaveView carries the honest plaintext-fallback marker', () => {
  const view = asSaveView({ id: 'c1', label: 'm', host: 'h', port: 22, username: 'u', encryptFallback: true })
  assert.equal(view?.encryptFallback, true)
  const plain = asSaveView({ id: 'c2', label: 'm', host: 'h', port: 22, username: 'u' })
  assert.equal(plain?.encryptFallback, undefined)
  assert.equal(asSaveView({}), null)
})

test('shared render (settings): full union field set with save + reset actions', () => {
  const html = markup('settings')
  for (const piece of [
    '主机名 / 别名', '识别 ssh 配置 ▾', '端口', '用户名', '名称（可选）',
    '默认工作区', '认证方式', '私钥文件', '私钥口令（可选）', '高级',
    '测试连接', '保存', '清空',
  ]) {
    assert.equal(html.includes(piece), true, `settings render must contain "${piece}"`)
  }
  // The save label is plain 保存 (no 并浏览), and flow-only 取消 is absent.
  assert.equal(html.includes('保存并浏览'), false)
  assert.equal(html.includes('>取消<'), false)
})

test('shared render (flow): same fields, 「保存并浏览」 + 取消, no 清空', () => {
  const html = markup('flow')
  for (const piece of [
    '主机名 / 别名', '识别 ssh 配置 ▾', '端口', '用户名', '名称（可选）',
    '默认工作区', '认证方式', '私钥文件', '高级', '测试连接', '保存并浏览', '取消',
  ]) {
    assert.equal(html.includes(piece), true, `flow render must contain "${piece}"`)
  }
  assert.equal(html.includes('清空'), false)
})

test('shared render: password tab shows only after switching (default = private key)', () => {
  const html = markup('settings')
  // Default auth tab is 私钥文件 → the password input placeholder is not
  // rendered; both tab labels are, and the password placeholder appears for
  // the flow/settings shell only after the tab click (covered by the fields
  // above). The 密码 radio label is always present.
  assert.equal(html.includes('密码'), true)
  assert.equal(html.includes('留空 = 保持不变'), false)
})

test('F3: a keychain-flagged edit opens the password tab first', () => {
  // Edit of a keychain machine (encryptPassword from credentialBackend): the
  // password tab is the default, so the leave-empty placeholder is visible
  // without hunting the segment.
  const html = renderToStaticMarkup(createElement(MachineForm, {
    mode: 'settings',
    rpc: idleRpc,
    initial: { id: 'c1', encryptPassword: true },
    onSaved: () => {},
  }))
  assert.equal(html.includes('留空 = 保持不变'), true)
})

test('F3: a private-key machine still defaults to the key tab', () => {
  const html = markup('settings')
  assert.equal(html.includes('留空 = 保持不变'), false)
  assert.equal(html.includes('SSH 密码'), false)
  assert.equal(html.includes('私钥口令（可选）'), true)
})
