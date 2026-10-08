/**
 * REQ-I24（ADR-0028 §5）：本机副根是工作区的延伸——workspace-write 下，写入目标
 * 或命令 cwd 落在**本会话**挂的本机副根里，官方沙箱就以该副根为 workspaceRoot。
 * 一次写 / 一条命令只认一个根；嵌套在主根下的副根沿用主根；别的会话挂的副根不算。
 * @module test/req-i24-side-root
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { installMixedProviders } from '../src/plugin.ts'
import { localSideRootFor } from '../src/session-workspaces.ts'
import { widenPolicyToSideRoot } from '../src/side-root-policy.ts'
import { installRemoteConfinePassthrough } from '../src/remote-confine.ts'
import { installRemoteSpawnPolicyBridge } from '../src/remote-spawn-policy.ts'

/**
 * `parent` defaults to the OS temp dir; the fs fence test needs a parent
 * OUTSIDE it, because `writableRoots` always admits the temp area.
 */
function layout(parent: string = tmpdir()) {
  mkdirSync(parent, { recursive: true })
  const base = realpathSync.native(mkdtempSync(join(parent, 'dsw-req-i24-')))
  const main = join(base, 'main')
  const sibling = join(base, 'sibling')
  const nested = join(main, 'nested')
  const other = join(base, 'other')
  for (const dir of [main, sibling, nested, other]) mkdirSync(dir, { recursive: true })
  return { base, main, sibling, nested, other }
}

function fakeHost(roots: Record<string, string[]>, session = 's1', cwd?: string) {
  return {
    get(name: string) {
      if (name === 'agents') return { currentInitiator: () => ({ session: { header: { id: session, cwd } } }) }
      if (name === 'sideWorkspaces') {
        return { listFor: (id: string) => (roots[id] ?? []).map(rootKey => ({ kind: 'local', rootKey })) }
      }
      return undefined
    },
  } as unknown as Context
}

test('localSideRootFor: sibling side root wins; main root and nested roots keep the main root', () => {
  const { main, sibling, nested, other } = layout()
  const roots = [sibling, nested]
  assert.equal(localSideRootFor(roots, main, join(sibling, 'a', 'new.txt')), sibling)
  assert.equal(localSideRootFor(roots, main, sibling), sibling)
  assert.equal(localSideRootFor(roots, main, join(nested, 'x.txt')), undefined)
  assert.equal(localSideRootFor(roots, main, join(main, 'x.txt')), undefined)
  assert.equal(localSideRootFor(roots, main, join(other, 'x.txt')), undefined)
  assert.equal(localSideRootFor(roots, main, 'relative/x.txt'), undefined)
  assert.equal(localSideRootFor(roots, main, undefined), undefined)
  assert.equal(localSideRootFor([], main, join(sibling, 'x')), undefined)
  // A prefix that is not a path boundary is not "under" the root.
  assert.equal(localSideRootFor(roots, main, `${sibling}-twin${process.platform === 'win32' ? '\\' : '/'}x`), undefined)
})

test('widenPolicyToSideRoot: only workspace-write swaps, and only for this session\'s roots', () => {
  const { main, sibling } = layout()
  const ww = { mode: 'workspace-write', workspaceRoot: main }
  const host = fakeHost({ s1: [sibling] })
  assert.deepEqual(widenPolicyToSideRoot(host, ww, join(sibling, 'f')), { mode: 'workspace-write', workspaceRoot: sibling })
  assert.equal(widenPolicyToSideRoot(host, ww, join(main, 'f')), ww)
  const ro = { mode: 'read-only', workspaceRoot: main }
  assert.equal(widenPolicyToSideRoot(host, ro, join(sibling, 'f')), ro)
  const danger = { mode: 'danger-full-access', workspaceRoot: main }
  assert.equal(widenPolicyToSideRoot(host, danger, join(sibling, 'f')), danger)
  // Another session attached the root: this session's write stays fenced.
  assert.equal(widenPolicyToSideRoot(fakeHost({ s2: [sibling] }), ww, join(sibling, 'f')), ww)
  assert.equal(widenPolicyToSideRoot(host, undefined, join(sibling, 'f')), undefined)
})

test('confine: a command whose cwd is in a local side root is confined to that root', async () => {
  const { main, sibling } = layout()
  const seen: unknown[] = []
  const policy = { mode: 'workspace-write', workspaceRoot: main }
  const sandbox = {
    confine: (_argv: readonly string[], p: unknown, signal?: unknown) => {
      seen.push({ p, signal })
      return { argv: ['x'], enforcement: 'full' }
    },
  }
  const shell = {
    execute: (spec: { workdir?: string }) => {
      void spec
      return (sandbox.confine as (a: string[], p: unknown, s?: unknown) => unknown)(['echo'], policy, 'sig')
    },
  }
  const host = {
    get(name: string) {
      if (name === 'sandbox') return sandbox
      if (name === 'shell') return shell
      return fakeHost({ s1: [sibling] }).get(name)
    },
  } as unknown as Context
  installRemoteConfinePassthrough(host)
  installRemoteSpawnPolicyBridge(host)
  shell.execute({ workdir: join(sibling, 'sub') })
  shell.execute({ workdir: main })
  shell.execute({})
  assert.deepEqual(seen, [
    { p: { mode: 'workspace-write', workspaceRoot: sibling }, signal: 'sig' },
    { p: policy, signal: 'sig' },
    { p: policy, signal: 'sig' },
  ])
})

test('installed local fs: a Write into a sibling side root passes the official fence; outside still denied', async (t) => {
  const { base, main, sibling, other } = layout(join(process.cwd(), '.tmp'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(base, 'home')
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(base, { recursive: true, force: true })
  })
  const ww = { mode: 'workspace-write', workspaceRoot: main }
  const ctx = new Context()
  await ctx.plugin({ apply(c) {
    c.provide('sandboxPolicy', { defaultMode: 'workspace-write', resolve: () => ww })
    c.provide('agents', { currentInitiator: () => ({ session: { header: { id: 's1', cwd: main } } }) })
  } })
  installMixedProviders(ctx)
  await new Promise(resolve => setTimeout(resolve, 10))
  const denied = (error: { code?: string }) => error.code === 'FS_SANDBOX_DENIED'
  const fs = ctx.get('fs') as {
    resolve(path: string, opts: { cwd: string }): Promise<unknown>
    writeText(target: unknown, content: string, expected?: unknown, signal?: unknown, policy?: unknown): Promise<unknown>
  }
  const before = await fs.resolve(join(sibling, 'before.txt'), { cwd: main })
  await assert.rejects(fs.writeText(before, 'no', undefined, undefined, ww), denied)
  const store = ctx.get('sideWorkspaces') as { attach(id: string, input: { id: string; kind: string; path: string }): unknown }
  store.attach('s1', { id: 'sib', kind: 'local', path: sibling })

  const inSide = await fs.resolve(join(sibling, 'side.txt'), { cwd: main })
  await fs.writeText(inSide, 'side', undefined, undefined, ww)
  assert.equal(readFileSync(join(sibling, 'side.txt'), 'utf8'), 'side')
  const omitted = await fs.resolve(join(sibling, 'omitted.txt'), { cwd: main })
  await fs.writeText(omitted, 'ok')
  assert.equal(readFileSync(join(sibling, 'omitted.txt'), 'utf8'), 'ok')

  const outside = await fs.resolve(join(other, 'x.txt'), { cwd: main })
  await assert.rejects(fs.writeText(outside, 'no', undefined, undefined, ww), denied)
  const readOnly = await fs.resolve(join(sibling, 'ro.txt'), { cwd: main })
  await assert.rejects(fs.writeText(readOnly, 'no', undefined, undefined, { mode: 'read-only', workspaceRoot: main }), denied)
})
