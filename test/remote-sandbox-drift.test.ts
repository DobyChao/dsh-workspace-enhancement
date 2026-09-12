/**
 * REQ-I9（ADR-0022 §3）profile 向量的**漂移钉**。
 *
 * `src/remote-sandbox.ts` 的 `remoteProfileArgs` 是上游
 * `@deepseek-ai/dsh-sandbox-local` 里 `bwrapProfileArgs` 的**本地重写**（那个函数
 * 没有导出，包也不是本仓库依赖，见模块 docstring）。重写就会分叉，所以这里在
 * 「部署包里确实有那个文件」时，把上游真的构建出来的 argv 与本地向量逐 token
 * 比对；文件不存在（CI、干净 clone）时**报告 SKIP，绝不因此失败**。
 *
 * 读取顺序与 AGENTS.md §5.7 的磁盘权威源一致：lab profile 优先，其次是全局
 * 安装包。两个都读不到就跳过。
 *
 * 纯读、无 spawn、无 Cordis——在文件沙箱里可跑（`npm run test:agent`）。
 * @module test/remote-sandbox-drift
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  REMOTE_BWRAP_PROFILE_READ_ONLY,
  REMOTE_BWRAP_PROFILE_WRITE_EXTRA,
  remoteProfileArgs,
  remoteRunnerArgv,
} from '../src/remote-sandbox.ts'

/**
 * The deployed upstream candidates, lab profile first (AGENTS.md §5.7 source ①,
 * then ②). Whichever exists is the authority for this machine.
 */
const UPSTREAM_CANDIDATES: readonly string[] = [
  String.raw`C:\Users\Admin\.dsh-lab\profiles\node_modules\@deepseek-ai\dsh-sandbox-local\lib\index.js`,
  String.raw`C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-sandbox-local\lib\index.js`,
]

function deployedUpstreamPath(): string | undefined {
  return UPSTREAM_CANDIDATES.find(candidate => existsSync(candidate))
}

/** The `const args = [...]` literal of upstream `bwrapProfileArgs(policy)`. */
function upstreamBaseLiteral(source: string): string | undefined {
  return /function bwrapProfileArgs\(policy\) \{\s*const args = (\[[\s\S]*?\]);/
    .exec(source)?.[1]
}

/** Every double-quoted token of one JS array literal, in source order. */
function quotedTokens(literal: string): string[] {
  return [...literal.matchAll(/"([^"]*)"/g)].map(match => match[1] as string)
}

/** The body of the `workspace-write` branch of `bwrapProfileArgs`. */
function upstreamWriteBranch(source: string): string | undefined {
  return /if \(policy\.mode === "workspace-write"\) \{([\s\S]*?)\n\t\}/.exec(source)?.[1]
}

const DEPLOYED_PATH = deployedUpstreamPath()

// Explicit, visible branch report: which path was used, or why this is skipped.
console.log(DEPLOYED_PATH === undefined
  ? '[remote-sandbox-drift] SKIP branch — no deployed @deepseek-ai/dsh-sandbox-local on this machine'
  : `[remote-sandbox-drift] DRIFT branch — comparing against ${DEPLOYED_PATH}`)

test('drift pin: the deployed upstream bwrap profile matches the local derivation', {
  skip: DEPLOYED_PATH === undefined
    ? 'no deployed @deepseek-ai/dsh-sandbox-local (lab profile or global install) on this machine — CI skips by design'
    : false,
}, () => {
  const path = DEPLOYED_PATH
  assert.notEqual(path, undefined)
  const source = readFileSync(path as string, 'utf-8')
  assert.equal(typeof source, 'string')

  // 1. the function must still exist and still be callable-shaped as expected;
  //    a refactor that renames it is a finding, not a silent skip.
  assert.notEqual(source.indexOf('function bwrapProfileArgs(policy)'), -1,
    'upstream bwrapProfileArgs is gone — the local re-derivation must be re-checked against the new source')

  const literal = upstreamBaseLiteral(source)
  assert.notEqual(literal, undefined, 'the `const args = [...]` literal was not found in bwrapProfileArgs')
  assert.deepEqual(
    quotedTokens(literal as string),
    [...REMOTE_BWRAP_PROFILE_READ_ONLY],
    'the read-only prefix tokens (and their order) must match upstream byte-for-byte',
  )

  // 2. the workspace-write branch must add exactly `--tmpfs /tmp` and
  //    `--bind <root> <root>`, in that order — and nothing else.
  const branch = upstreamWriteBranch(source)
  assert.notEqual(branch, undefined, 'the workspace-write branch of bwrapProfileArgs was not found')
  const body = branch as string
  assert.equal(/args\.push\("--tmpfs", "\/tmp"\);/.test(body), true, 'upstream still pushes --tmpfs /tmp')
  assert.equal(
    /args\.push\("--bind", policy\.workspaceRoot, policy\.workspaceRoot\);/.test(body),
    true,
    'upstream still binds the workspace root to itself',
  )
  const pushed = [...body.matchAll(/args\.push\(([^)]*)\)/g)]
    .map(match => match[1] as string)
    .join(' ')
  assert.equal(pushed.includes('--unshare-net'), false, 'upstream has not grown a network namespace')
  assert.equal(pushed.includes('--clearenv'), false, 'upstream has not grown environment scrubbing')
  assert.equal(pushed.includes('--chdir'), false, 'upstream has not grown a chdir (the seam relies on cwd pass-through)')
  assert.equal(pushed.includes('--new-session'), false, 'upstream has not grown a new-session flag')

  // 3. the whole vector, as the local builder emits it, is what upstream builds.
  assert.deepEqual(
    remoteProfileArgs({ mode: 'read-only' }),
    [...REMOTE_BWRAP_PROFILE_READ_ONLY],
  )
  assert.deepEqual(
    remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: '/ws' }),
    [...REMOTE_BWRAP_PROFILE_READ_ONLY, ...REMOTE_BWRAP_PROFILE_WRITE_EXTRA, '--bind', '/ws', '/ws'],
  )
  // 4. and the runner argv shape upstream asserts (`confine()` = 
  //    `[...runnerCommand, ...bwrapProfileArgs(policy), '--', ...argv]`).
  assert.deepEqual(
    remoteRunnerArgv(['bash', '-c', 'true'], { mode: 'workspace-write', workspaceRoot: '/ws' }, 'bwrap'),
    ['bwrap', ...REMOTE_BWRAP_PROFILE_READ_ONLY, ...REMOTE_BWRAP_PROFILE_WRITE_EXTRA,
      '--bind', '/ws', '/ws', '--', 'bash', '-c', 'true'],
  )

  // 5. the functional probe really is observable in the deployed probe helper
  //    (`defaultProbeBwrap` runs the read-only profile around `true`).
  const probeHelper = /function defaultProbeBwrap\(timeoutMs\) \{([\s\S]*?)\n\}/
    .exec(source)?.[1]
  assert.notEqual(probeHelper, undefined, 'upstream defaultProbeBwrap was not found')
  const probeBody = probeHelper as string
  assert.equal(probeBody.includes('bwrapProfileArgs('), true, 'the probe still builds the real profile')
  assert.match(probeBody, /mode: "read-only"/, 'the probe still uses the read-only profile')
  assert.equal(probeBody.includes('"--"'), true, 'the probe still terminates the profile with the -- separator')
  assert.equal(probeBody.includes('"true"'), true, 'the probe still wraps `true`')
  assert.match(probeBody, /status === 0/, 'the probe still requires exit 0 (positive, functional)')

  console.log(`[remote-sandbox-drift] DRIFT branch PASSED — vectors identical (${path})`)
})

test('drift pin: the local derivation is self-consistent even when the upstream is absent', () => {
  // This one always runs, so the file is never a no-op on CI.
  assert.deepEqual(remoteProfileArgs({ mode: 'read-only' }), [...REMOTE_BWRAP_PROFILE_READ_ONLY])
  assert.equal(REMOTE_BWRAP_PROFILE_READ_ONLY.length, 9)
  assert.deepEqual([...REMOTE_BWRAP_PROFILE_WRITE_EXTRA], ['--tmpfs', '/tmp'])
})
