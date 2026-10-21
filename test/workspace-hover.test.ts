/**
 * UX-16: the workspace hover card must show the server and the real remote
 * path, not the local placeholder the host stores as the workspace cwd.
 * @module test/workspace-hover
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HOVER_SOURCE_ATTR, isWorkspaceHoverPath, rewriteWorkspaceHover, serverLine, workspaceHoverText } from '../src/client/workspace-hover.ts'
import type { HoverMachine, HoverPathFace } from '../src/client/workspace-hover.ts'

const machine: HoverMachine = { label: 'uuz@127.0.0.1', username: 'uuz', host: '127.0.0.1', port: 22 }
const placeholder = 'C:\\Users\\Admin\\.dsh-lab\\dsw-routes\\c1\\home\\uuz\\eee'

function card(pathText: string): { path: HoverPathFace; title: HoverPathFace; time: HoverPathFace } {
  const title = leaf('eee')
  const path = leaf(pathText)
  const time = leaf('创建于 2026年9月17日 17:43')
  const parent = { children: [title, path, time] }
  title.parentElement = parent
  path.parentElement = parent
  time.parentElement = parent
  return { path, title, time }
}

function leaf(text: string): HoverPathFace & { parentElement: { readonly children: ArrayLike<unknown> } | null } {
  const attrs = new Map<string, string>()
  const element = {
    textContent: text,
    childElementCount: 0,
    parentElement: null as { readonly children: ArrayLike<HoverPathFace> } | null,
    style: { whiteSpace: '' },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attrs.set(name, value) },
  }
  return element
}

test('UX-16: server line prefers the endpoint when the label is just user@host', () => {
  assert.equal(serverLine('c1', machine), 'uuz@127.0.0.1:22')
  assert.equal(serverLine('c1', { ...machine, label: 'lab' }), 'lab · uuz@127.0.0.1:22')
  assert.equal(serverLine('c1', undefined), 'c1')
})

test('UX-16: a placeholder cwd becomes the server and the real remote path', () => {
  assert.equal(workspaceHoverText(placeholder, machine), 'uuz@127.0.0.1:22\n/home/uuz/eee')
  assert.equal(workspaceHoverText('ssh://c1/home/uuz/eee', undefined), 'c1\n/home/uuz/eee')
  assert.equal(workspaceHoverText('D:\\work\\eee', machine), null)
})

test('UX-16: only the hover card path line is rewritten, and a later probe fills the server', () => {
  const { path, title } = card(placeholder)
  assert.equal(isWorkspaceHoverPath(path), true)
  assert.equal(isWorkspaceHoverPath(title), false)
  const machines = new Map<string, HoverMachine>()
  assert.equal(rewriteWorkspaceHover(path, id => machines.get(id)), true)
  assert.equal(path.textContent, 'c1\n/home/uuz/eee')
  assert.equal(path.getAttribute(HOVER_SOURCE_ATTR), placeholder)
  assert.equal(path.style.whiteSpace, 'pre-line')
  machines.set('c1', machine)
  assert.equal(rewriteWorkspaceHover(path, id => machines.get(id)), true)
  assert.equal(path.textContent, 'uuz@127.0.0.1:22\n/home/uuz/eee')
  // A second pass with the same facts does not write again.
  const before = path.textContent
  assert.equal(rewriteWorkspaceHover(path, id => machines.get(id)), true)
  assert.equal(path.textContent, before)
})

test('UX-16: a local hover path and a session time line stay as the host wrote them', () => {
  const local = card('D:\\work\\eee')
  assert.equal(rewriteWorkspaceHover(local.path, () => machine), false)
  assert.equal(local.path.textContent, 'D:\\work\\eee')
  const sessionTime = leaf('5分钟前')
  const sessionTitle = leaf('hello')
  const status = leaf('等待批准')
  const parent = { children: [sessionTitle, sessionTime, status] }
  sessionTime.parentElement = parent
  assert.equal(rewriteWorkspaceHover(sessionTime, () => undefined), false)
  assert.equal(sessionTime.textContent, '5分钟前')
})
