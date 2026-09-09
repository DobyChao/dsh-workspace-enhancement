/**
 * R4-I2（t4）混合 provider 安装接线测试：installMixedProviders 在同一个
 * Cordis 上下文中「本地类 self-register 服务名 + ctx.set 换成门面」后，
 * 消费者经 ctx.get 必须拿到混合门面（而非本地类），并正确暴露本地后端的
 * sandboxMode 事实。这验证了聚合行成为 ctx.subprocess/ctx.fs 唯一实现的关键
 * 机制（无需真实 loader）。
 * @module test/mixed-install
 */

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { installMixedProviders } from '../src/plugin.ts'
import { MixedFileSystem, MixedSubprocessRuntime } from '../src/mixed.ts'

test('installMixedProviders: ctx.subprocess/ctx.fs resolve to the mixed facades (wire mechanism)', async () => {
  // Write probe goes to a private temp workspace: a repository-root write left
  // a `smoke-install.txt` artifact behind on every `npm test` run.
  const workspace = mkdtempSync(join(tmpdir(), 'dsw-mixed-install-'))
  const ctx = new Context()
  await ctx.plugin({ apply(c) {
    c.provide('sandboxPolicy', {
      defaultMode: 'danger-full-access',
      resolve: () => ({ mode: 'danger-full-access', workspaceRoot: workspace }),
    })
  } })
  installMixedProviders(ctx)
  const subprocess = ctx.get('subprocess')
  assert.ok(subprocess instanceof MixedSubprocessRuntime, 'subprocess must be the mixed facade')
  // The sandboxed delegate is provided from the ctx.inject(['sandboxPolicy'])
  // fiber; wait one turn for the inject callback to run and activate the name.
  await new Promise(resolve => setTimeout(resolve, 10))
  const fs = ctx.get('fs')
  assert.ok(fs instanceof MixedFileSystem, 'fs must be the mixed facade')
  // The confinement fact is inherited from the delegated local backend (the
  // tool layer advertises escalation actions off it).
  assert.equal(fs.sandboxMode, 'danger-full-access')
  // t6: a LOCAL write through the facade reaches the sandboxed backend's
  // inject contract (its checkedTarget accesses `this.ctx.sandboxPolicy`
  // when the tool passes no per-call policy).
  const target = await fs.resolve('mixed-install-probe.txt', { cwd: workspace })
  const outcome = await fs.writeText(target, 'ok', undefined, undefined, undefined)
  assert.equal((outcome as { version?: unknown }).version !== undefined, true)
  // BUG-2: 带图请求走的是接缝的第 13 个方法 `processPathFromHostPath`
  // （图片附件解析 → resolveImageAccess → ctx.get('fs')?.[…]）。安装后的门面
  // 缺它即 TypeError → LlmError(TRANSPORT)。这里断言它存在且映射正确。
  assert.equal(typeof fs.processPathFromHostPath, 'function', 'the installed facade must expose processPathFromHostPath')
  assert.equal(fs.processPathFromHostPath(join(workspace, 'shot.png')), resolve(join(workspace, 'shot.png')))
  assert.equal(fs.processPathFromHostPath('relative/shot.png'), undefined)
})

test('BUG-2: the installed facade maps host paths for the bare local backend too', () => {
  const ctx = new Context()
  installMixedProviders(ctx)
  const fs = ctx.get('fs')
  assert.equal(typeof fs.processPathFromHostPath, 'function', 'the installed facade must expose processPathFromHostPath')
  const hostPath = join(tmpdir(), 'dsw-bug2-install.png')
  assert.equal(fs.processPathFromHostPath(hostPath), resolve(hostPath))
  assert.equal(fs.processPathFromHostPath('shot.png'), undefined)
})

test('installMixedProviders: without a sandbox policy the bare local backend backs the facade', () => {
  const ctx = new Context()
  installMixedProviders(ctx)
  const fs = ctx.get('fs')
  assert.ok(fs instanceof MixedFileSystem, 'fs must be the mixed facade')
  assert.equal(fs.sandboxMode, undefined)
})

test('t6: remote sessions get a forced danger-full-access sandbox override (session/created)', async () => {
  const ctx = new Context()
  const { default: SessionStore } = await import('@deepseek-ai/dsh-session')
  await ctx.plugin(SessionStore)
  const { apply } = await import('../src/plugin.ts')
  apply(ctx, { host: '127.0.0.1', port: 22, username: 'ssh', cwd: '/tmp' })
  const { sshRoutesRoot } = await import('../src/transport.ts')
  const { join } = await import('node:path')
  const remoteCwd = join(sshRoutesRoot(), 'c1', 'srv', 'work')
  const remote = ctx.get('sessions').create(undefined, { meta: { cwd: remoteCwd } })
  const local = ctx.get('sessions').create(undefined, { meta: { cwd: process.cwd() } })
  const modeOf = (events: readonly { type: string; data: { mode?: string } }[]): string | undefined => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i]?.type === 'sandbox/mode') return events[i].data.mode
    }
    return undefined
  }
  // dsh-session 0.1.2-rc.1 replaced the old `session.events` array with the
  // `ownEvents()` accessor (snapshotEvents/ownEvents). Keep the assertion on the
  // live event log this session owns.
  assert.equal(modeOf(remote.ownEvents()), 'danger-full-access', 'remote session must be forced to full')
  assert.equal(modeOf(local.ownEvents()), undefined, 'local session must keep no override')
})
