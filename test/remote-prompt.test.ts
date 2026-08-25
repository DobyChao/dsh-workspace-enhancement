/**
 * R4 远程认知（t1）纯函数测试：session cwd → 远程路由解析（三条拼写：`ssh://`、
 * 当前 `dsw-routes` 占位树、旧 `dsh-ssh-routes` 树）→ 机器信息 → 强调提示文案。
 * 提示 section 的运行期接线（全局 section + text(context.scope)）由沙箱实例验证，
 * 这里覆盖可单测的部分。
 * @module test/remote-prompt
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { remoteRouteFromCwd, sshRoutesRoot } from '../src/transport.ts'
import { remotePromptFact, renderRemotePrompt } from '../src/tools.ts'
import type { PromptMachineFace } from '../src/tools.ts'

/** Fake DSH home so the placeholder roots are deterministic and outside any real profile. */
const BASE = join(tmpdir(), 'dsh-r4-fake-home')
const ROOT = sshRoutesRoot(BASE)
const LEGACY_ROOT = join(BASE, 'dsh-ssh-routes')

const machine = (extra?: Partial<PromptMachineFace>): PromptMachineFace => ({
  username: 'uuz',
  host: 'c1',
  ...extra,
})

/* ------------------------------------------------- 1) cwd → remote route */

test('remoteRouteFromCwd: undefined and local paths resolve to null (local session)', () => {
  assert.equal(remoteRouteFromCwd(undefined), null)
  assert.equal(remoteRouteFromCwd(join(BASE, 'proj')), null)
  assert.equal(remoteRouteFromCwd(resolve(BASE, '..', 'elsewhere', 'proj')), null)
})

test('remoteRouteFromCwd: an outside path merely CONTAINING dsw-routes is not a route', () => {
  const outside = resolve(BASE, '..', 'elsewhere', 'dsw-routes', 'c1', 'proj')
  assert.equal(remoteRouteFromCwd(outside, BASE), null)
})

test('remoteRouteFromCwd: ssh://<id>/<path> spelling resolves', () => {
  assert.deepEqual(remoteRouteFromCwd('ssh://c1/srv/work'), { connectionId: 'c1', path: '/srv/work' })
  assert.deepEqual(remoteRouteFromCwd('ssh://c1/'), { connectionId: 'c1', path: '/' })
  assert.equal(remoteRouteFromCwd('ssh://'), null)
  assert.equal(remoteRouteFromCwd('ssh://c1'), null)
})

test('remoteRouteFromCwd: dsw-routes placeholders resolve (current tree, both separators)', () => {
  assert.deepEqual(remoteRouteFromCwd(join(ROOT, 'c1', 'srv', 'work'), BASE), { connectionId: 'c1', path: '/srv/work' })
  assert.deepEqual(remoteRouteFromCwd(`${ROOT}/c1/srv/work`, BASE), { connectionId: 'c1', path: '/srv/work' })
  assert.deepEqual(remoteRouteFromCwd(join(ROOT, 'c1'), BASE), { connectionId: 'c1', path: '/' })
})

test('remoteRouteFromCwd: legacy dsh-ssh-routes placeholders keep resolving (old session cwd)', () => {
  assert.deepEqual(remoteRouteFromCwd(join(LEGACY_ROOT, 'c1', 'home', 'uuz'), BASE), { connectionId: 'c1', path: '/home/uuz' })
})

test('remoteRouteFromCwd: an invalid id segment is not a route', () => {
  assert.equal(remoteRouteFromCwd(join(ROOT, 'bad id', 'proj'), BASE), null)
  assert.equal(remoteRouteFromCwd(join(ROOT, 'c1!', 'proj'), BASE), null)
})

/* --------------------------------------- 2) route → 机器信息 → prompt fact */

test('remotePromptFact: local cwd yields null (zero injection)', () => {
  assert.equal(remotePromptFact(join(BASE, 'proj'), machine(), BASE), null)
  assert.equal(remotePromptFact(undefined, machine(), BASE), null)
})

test('remotePromptFact: workspace wins over the route path (flow write-back display)', () => {
  const fact = remotePromptFact(join(ROOT, 'c1', 'srv', 'work'), machine({ workspace: '/srv/proj' }), BASE)
  assert.ok(fact !== null)
  assert.equal(fact.connectionId, 'c1')
  assert.equal(fact.endpoint, 'uuz@c1')
  assert.equal(fact.remotePath, '/srv/work')
  assert.equal(fact.displayPath, '/srv/proj')
  assert.equal(fact.placeholderRoot, 'dsw-routes')
})

test('remotePromptFact: no workspace falls back to the route path; unknown machine keeps the id', () => {
  const fact = remotePromptFact(join(ROOT, 'c1', 'srv', 'work'), machine(), BASE)
  assert.ok(fact !== null)
  assert.equal(fact.displayPath, '/srv/work')
  const unknown = remotePromptFact(join(ROOT, 'c9', 'srv'), undefined, BASE)
  assert.ok(unknown !== null)
  assert.equal(unknown.endpoint, 'conn-c9')
  assert.equal(unknown.displayPath, '/srv')
})

test('remotePromptFact: legacy placeholder also composes the fact', () => {
  const fact = remotePromptFact(join(LEGACY_ROOT, 'c1', 'home', 'uuz'), machine({ workspace: '/home' }), BASE)
  assert.ok(fact !== null)
  assert.equal(fact.connectionId, 'c1')
  assert.equal(fact.displayPath, '/home')
})

/* ------------------------------------------------------ 3) 强调提示文案 */

test('renderRemotePrompt: the emphasis paragraph carries endpoint, display path, and routing alias', () => {
  const fact = remotePromptFact(join(ROOT, 'c1', 'srv', 'work'), machine({ workspace: '/srv/proj' }), BASE)
  assert.ok(fact !== null)
  const text = renderRemotePrompt(fact)
  assert.ok(text.includes('远程 SSH 工作区'))
  assert.ok(text.includes('uuz@c1:/srv/proj'))
  assert.ok(text.includes('dsw-routes\\c1\\…'))
  assert.ok(text.includes('所有命令与文件操作都真实发生在远程服务器上'))
  assert.ok(text.includes('POSIX 绝对路径'))
})
