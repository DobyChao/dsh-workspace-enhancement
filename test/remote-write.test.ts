/**
 * R4 收尾（t8）单测：⑦ 远程覆盖/编辑 —— 覆盖发布与暂存清理的命令构造
 * （mv -f / rm -rf + POSIX 单引号转义）；⑧⑨ 远程环境自检 —— sw_status 的
 * bash/pwsh/rg 探测解析与渲染。真实 SSH 覆盖/编辑/无残留证明走 lab c1 集成
 * （见任务报告，不进单测套件）。
 * @module test/remote-write
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isOwnStagingDirectory, overwritePublicationCommand, stagingCleanupCommand } from '../src/filesystem.ts'
import { parseRemoteEnvProbe, remoteEnvProbeCommand, renderRemoteEnvProbe } from '../src/tools.ts'

/* ------------------------------------------------- 1) ⑦ 命令构造与转义 */

test('t8 ⑦: overwritePublicationCommand builds a quoted `mv -f` publication', () => {
  const command = overwritePublicationCommand('/tmp/.dsh-abc.tmp/content', '/tmp/target.txt')
  assert.equal(command, `mv -f -- '/tmp/.dsh-abc.tmp/content' '/tmp/target.txt'`)
})

test('t8 ⑦: publication command is hostile-path safe (quoteShellArg escapes)', () => {
  const command = overwritePublicationCommand(`/tmp/a'b;$(x).tmp/content`, '/tmp/t args/ok.txt')
  // quoteShellArg emits the POSIX `'…'"'"'…'` splice inside one quoted segment.
  assert.ok(command.includes(`'/tmp/a'"'"'b;$(x).tmp/content'`), `unexpected quoting: ${command}`)
  assert.ok(command.includes(`'/tmp/t args/ok.txt'`), `unexpected quoting: ${command}`)
  // No raw shell meta may survive outside a single-quoted segment.
  assert.ok(!/;\s+(rm|mv|ls|touch)/u.test(command), `raw meta leaked: ${command}`)
})

test('t8 ⑦: stagingCleanupCommand removes only the quoted random staging dir', () => {
  const command = stagingCleanupCommand('/tmp/x/.dsh-6c1a.tmp')
  assert.equal(command, `rm -rf -- '/tmp/x/.dsh-6c1a.tmp'`)
  const hostile = stagingCleanupCommand(`/tmp/x/.dsh-pp;rm -rf /u.tmp`)
  assert.ok(hostile.includes(`'/tmp/x/.dsh-pp;rm -rf /u.tmp'`), `unexpected quoting: ${hostile}`)
})

test('t8 ⑦: isOwnStagingDirectory accepts exactly the .dsh-<uuid>.tmp shape', () => {
  assert.equal(isOwnStagingDirectory('/tmp/.dsh-6c1a4a9e-1234-4abc-8def-0123456789ab.tmp'), true)
  assert.equal(isOwnStagingDirectory('/tmp/.dsh-6c1a.tmp'), false)
  assert.equal(isOwnStagingDirectory('/tmp/.dsh-that-never-was.tmp'), false)
  assert.equal(isOwnStagingDirectory('/tmp/not-staging.tmp'), false)
  assert.equal(isOwnStagingDirectory('/tmp/.dsh-6c1a4a9e-1234-4abc-8def-0123456789ab.tmp/../..'), false)
})

/* ------------------------------------------------- 2) ⑧⑨ 环境自检解析 */

test('t10: remoteEnvProbeCommand keeps exit status 0 when tools are missing (trailing true)', () => {
  assert.equal(remoteEnvProbeCommand(), 'command -v bash; command -v pwsh; command -v rg; true')
})

test('t8 ⑧⑨: parseRemoteEnvProbe resolves found paths and misses absent tools', () => {
  assert.deepEqual(parseRemoteEnvProbe('/usr/bin/bash\n/opt/microsoft/pwsh\n'), { bash: true, pwsh: true, rg: false })
  assert.deepEqual(parseRemoteEnvProbe('/usr/bin/bash\n'), { bash: true, pwsh: false, rg: false })
  assert.deepEqual(parseRemoteEnvProbe(''), { bash: false, pwsh: false, rg: false })
  // A resolved path anywhere in the line (crlf and path with extras).
  assert.deepEqual(parseRemoteEnvProbe('/usr/local/bin/rg\r\n'), { bash: false, pwsh: false, rg: true })
})

test('t8 ⑧⑨: renderRemoteEnvProbe emits three check lines plus a hint (never installs)', () => {
  const full = renderRemoteEnvProbe({ bash: true, pwsh: true, rg: true })
  assert.ok(full.includes('Remote environment:'))
  assert.ok(full.includes('bash: ✓') && full.includes('pwsh: ✓') && full.includes('rg: ✓'))
  assert.ok(!full.includes('提示'))
  assert.ok(!full.includes('sudo'), 'no install command may be suggested when nothing is missing')
  const partial = renderRemoteEnvProbe({ bash: true, pwsh: false, rg: false })
  assert.ok(partial.split('\n').length >= 5)
  assert.ok(partial.includes('pwsh: ✗') && partial.includes('rg: ✗') && partial.includes('bash: ✓'))
  assert.ok(partial.includes('提示: 远端缺少 pwsh, rg'))
  assert.ok(partial.includes('sudo apt-get install ripgrep'), 'hint names the install command as reference only')
  assert.ok(!partial.includes('命令已执行'), 'hint must not claim execution')
})

test('t10: all-missing probe renders three ✗ lines and the hint (not silently dropped)', () => {
  const empty = renderRemoteEnvProbe(parseRemoteEnvProbe(''))
  assert.ok(empty.includes('bash: ✗') && empty.includes('pwsh: ✗') && empty.includes('rg: ✗'))
  assert.ok(empty.includes('提示: 远端缺少 bash, pwsh, rg'))
})
