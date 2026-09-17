/**
 * REQ-I9（ADR-0022）远端沙箱围栏单测：
 *
 * 1. 归一化——缺字段/垃圾值/大小写/类型 ⇒ `'off'`（零迁移），合法值往返；
 * 2. profile 向量——只读/工作区写两个向量**逐 token 钉死**（顺序即契约），
 *    工作区写缺根 ⇒ 抛错（fail-closed，绝不静默降级）；
 * 3. 工作区根解析/形状闸门——相对路径/空串/换行/NUL 一律拒；
 * 4. runner argv 形状——runner 在首、`--` 分隔、原始 argv 之后逐字节未动；
 * 5. 探针命令——含功能探针（真 profile 包 `true`）、runner 路径三处全部
 *    走 `quoteShellArg`，未加引号的 token 集合是固定白名单；
 * 6. parseRemoteProbe——健康/缺 runner/存在但不可用/垃圾输出/信号死亡；
 * 7. 拒绝方言——只认只读文件系统那一条，且只匹配不强制；
 * 8. 缓存按连接身份（重建即失效）；9. 上报形状（诚实边界）；
 * 10. 探针文本与 runner argv 同源（同一构建器，不可能漂移）。
 * @module test/remote-sandbox
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_REMOTE_RUNNER_PATH,
  REMOTE_BWRAP_PROFILE_READ_ONLY,
  REMOTE_BWRAP_PROFILE_WRITE_EXTRA,
  REMOTE_DENIAL_SIGNATURES,
  REMOTE_SANDBOX_MESSAGES,
  REMOTE_SANDBOX_UNAVAILABLE,
  RemoteSandboxError,
  RemoteSandboxPolicyError,
  WORKSPACE_ROOT_PLACEHOLDER,
  buildRemoteProbeCommand,
  createRemoteSandboxCache,
  fenceMissingHint,
  isRemoteDenialText,
  isRemoteSandboxEnabled,
  isUsableRemoteWorkspaceRoot,
  normalizeRemoteSandbox,
  parseRemoteProbe,
  remoteProfileArgs,
  remoteRunnerArgv,
  remoteRunnerVersionOf,
  remoteSandboxFactsOf,
  remoteSandboxUnavailableError,
  resolveRemoteRunnerPath,
  resolveRemoteWorkspaceRoot,
} from '../src/remote-sandbox.ts'
import { quoteShellArg } from '../src/ssh-core.ts'

/* ---------------------------------------------------------------- helpers */

const READ_ONLY_VECTOR = [
  '--ro-bind', '/', '/',
  '--dev', '/dev',
  '--unshare-pid',
  '--proc', '/proc',
  '--die-with-parent',
]

const WORKSPACE = '/home/uuz/repos/demo'

/**
 * The token list a shell would see after quote removal (both quote styles).
 * Handles the repo's quoting spelling `'\''` → `'"'"'`: the `"` segments are
 * empty on removal, so the escaped quote survives as a literal character and
 * the whole payload stays ONE argument.
 */
function shellTokens(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let started = false
  let quoted: "'" | '"' | null = null
  for (const char of command) {
    if (quoted === null && (char === "'" || char === '"')) {
      quoted = char
      started = true
      continue
    }
    if (quoted !== null && char === quoted) {
      quoted = null
      continue
    }
    if (quoted === null && /\s/.test(char)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += char
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

/**
 * The bare (unquoted) remainder of one shell command: every quoted span is
 * replaced by one `%s` placeholder, so an injection payload that only ever
 * appears inside quotes leaves no trace here.
 */
function stripQuoted(command: string): string {
  let bare = ''
  let quoted = false
  for (const char of command) {
    if (char === "'") {
      quoted = !quoted
      if (!quoted) bare += '\u0000'
      continue
    }
    if (!quoted) bare += char
  }
  if (quoted) throw new Error('unbalanced quoting in the command under test')
  return bare
}

/* ------------------------------------------------------------ 1) mode */

test('normalizeRemoteSandbox: missing/invalid/foreign values all fall back to off', () => {
  for (const raw of [undefined, null, '', 'off', 'OFF', 'readonly', 'read_only', 'danger-full-access',
    'workspace-write ', ' workspace-write', 0, 1, true, false, {}, [], ['read-only'], Symbol('x'), () => 'read-only']) {
    assert.equal(normalizeRemoteSandbox(raw), 'off', `raw=${String(raw)} must normalize to off`)
  }
})

test('normalizeRemoteSandbox: the two fenced values round-trip', () => {
  assert.equal(normalizeRemoteSandbox('read-only'), 'read-only')
  assert.equal(normalizeRemoteSandbox('workspace-write'), 'workspace-write')
  for (const mode of ['off', 'read-only', 'workspace-write'] as const) {
    assert.equal(normalizeRemoteSandbox(normalizeRemoteSandbox(mode)), mode)
  }
})

test('isRemoteSandboxEnabled: off is the only inert mode', () => {
  assert.equal(isRemoteSandboxEnabled('off'), false)
  assert.equal(isRemoteSandboxEnabled('read-only'), true)
  assert.equal(isRemoteSandboxEnabled('workspace-write'), true)
})

/* ------------------------------------------------- 2) profile vectors */

test('REMOTE_BWRAP_PROFILE_READ_ONLY: the deployed upstream token order, verbatim', () => {
  // Provenance: upstream `bwrapProfileArgs({mode:'read-only'})` in
  // @deepseek-ai/dsh-sandbox-local 0.1.5-rc.2 (see the module docstring).
  assert.deepEqual([...REMOTE_BWRAP_PROFILE_READ_ONLY], READ_ONLY_VECTOR)
  assert.deepEqual(REMOTE_BWRAP_PROFILE_WRITE_EXTRA, ['--tmpfs', '/tmp'])
})

test('remoteProfileArgs: read-only is exactly the pinned vector', () => {
  assert.deepEqual(remoteProfileArgs({ mode: 'read-only' }), READ_ONLY_VECTOR)
})

test('remoteProfileArgs: read-only ignores a workspaceRoot (no --bind ever leaks in)', () => {
  assert.deepEqual(remoteProfileArgs({ mode: 'read-only', workspaceRoot: WORKSPACE }), READ_ONLY_VECTOR)
  assert.equal(remoteProfileArgs({ mode: 'read-only', workspaceRoot: WORKSPACE }).includes('--bind'), false)
})

test('remoteProfileArgs: workspace-write = read-only + --tmpfs /tmp + --bind ws ws', () => {
  assert.deepEqual(remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE }), [
    ...READ_ONLY_VECTOR,
    '--tmpfs', '/tmp',
    '--bind', WORKSPACE, WORKSPACE,
  ])
})

test('remoteProfileArgs: the profile is file-effects only (no net/env/chdir/session/seccomp)', () => {
  const tokens = [...remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE })]
  for (const forbidden of ['--unshare-net', '--unshare-all', '--unshare-user', '--clearenv',
    '--chdir', '--new-session', '--seccomp']) {
    assert.equal(tokens.includes(forbidden), false, `${forbidden} must not be in the profile`)
  }
})

test('remoteProfileArgs: workspace-write without a usable root fails closed (no silent downgrade)', () => {
  for (const workspaceRoot of [undefined, '', '/', 'relative/path', 'C:\\ws', '/ws\n/x', '/ws\u0000']) {
    assert.throws(
      () => remoteProfileArgs({ mode: 'workspace-write', ...(workspaceRoot === undefined ? {} : { workspaceRoot }) }),
      (error: unknown) => error instanceof RemoteSandboxPolicyError
        && error instanceof RemoteSandboxError
        && error.code === REMOTE_SANDBOX_UNAVAILABLE
        && error.message === REMOTE_SANDBOX_MESSAGES.workspaceRootRequired,
      `workspaceRoot=${JSON.stringify(workspaceRoot)} must be refused`,
    )
  }
})

test('remoteProfileArgs: each call returns a fresh array (callers may mutate)', () => {
  const first = remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE })
  const second = remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE })
  assert.notEqual(first, second)
  first.push('--junk')
  assert.deepEqual(second, [...READ_ONLY_VECTOR, '--tmpfs', '/tmp', '--bind', WORKSPACE, WORKSPACE])
  assert.equal([...REMOTE_BWRAP_PROFILE_READ_ONLY].length, READ_ONLY_VECTOR.length)
})

/* --------------------------------------------- 3) workspace-root guard */

test('isUsableRemoteWorkspaceRoot: absolute, non-empty, NUL/newline-free only', () => {
  assert.equal(isUsableRemoteWorkspaceRoot(WORKSPACE), true)
  assert.equal(isUsableRemoteWorkspaceRoot('/'), false, 'the root is not a workspace')
  for (const bad of [undefined, null, '', 'relative', './ws', '../ws', '~/ws', '/ws\n', '/ws\r', '/ws\u0000', 7, {}, ['/ws']]) {
    assert.equal(isUsableRemoteWorkspaceRoot(bad), false, `${JSON.stringify(bad)} must be rejected`)
  }
})

test('resolveRemoteWorkspaceRoot: first usable candidate wins, else undefined', () => {
  assert.equal(resolveRemoteWorkspaceRoot(undefined, '/', WORKSPACE, '/other'), WORKSPACE)
  assert.equal(resolveRemoteWorkspaceRoot(), undefined)
  assert.equal(resolveRemoteWorkspaceRoot(undefined, 'relative', '/'), undefined)
})

test('resolveRemoteRunnerPath: only an absolute path is honoured, else the bare default', () => {
  assert.equal(resolveRemoteRunnerPath('/usr/local/bin/bwrap'), '/usr/local/bin/bwrap')
  assert.equal(resolveRemoteRunnerPath(undefined), 'bwrap')
  assert.equal(resolveRemoteRunnerPath(''), 'bwrap')
  assert.equal(resolveRemoteRunnerPath('bwrap'), 'bwrap', 'a bare name is the default, not a resolution')
  assert.equal(resolveRemoteRunnerPath('bin/bwrap'), 'bwrap')
  assert.equal(resolveRemoteRunnerPath(7), 'bwrap')
  assert.equal(resolveRemoteRunnerPath(null, '/opt/bwrap'), '/opt/bwrap')
})

/* ------------------------------------------------- 4) runner argv shape */

test('remoteRunnerArgv: runner first, then the profile, then --, then the argv untouched', () => {
  const argv = ['bash', '-c', 'echo hi > /tmp/x; ls "$HOME"']
  const wrapped = remoteRunnerArgv(argv, { mode: 'read-only' }, DEFAULT_REMOTE_RUNNER_PATH)
  assert.deepEqual(wrapped, [...['bwrap'], ...READ_ONLY_VECTOR, '--', ...argv])
  assert.equal(wrapped[0], 'bwrap')
  assert.equal(wrapped.at(-argv.length - 1), '--')
  assert.deepEqual(wrapped.slice(-argv.length), argv, 'the original argv survives byte-for-byte, in order')
  assert.deepEqual(argv, ['bash', '-c', 'echo hi > /tmp/x; ls "$HOME"'], 'the input array is not mutated')
})

test('remoteRunnerArgv: an explicit runner path replaces bwrap and stays at argv[0]', () => {
  const wrapped = remoteRunnerArgv(['true'], { mode: 'read-only' }, '/usr/local/bin/bwrap')
  assert.equal(wrapped[0], '/usr/local/bin/bwrap')
  assert.deepEqual(wrapped, ['/usr/local/bin/bwrap', ...READ_ONLY_VECTOR, '--', 'true'])
})

test('remoteRunnerArgv: the separator protects an argv whose tokens look like flags', () => {
  const wrapped = remoteRunnerArgv(['ls', '--', '-r', '-la'], { mode: 'read-only' }, 'bwrap')
  assert.deepEqual(wrapped.slice(-4), ['ls', '--', '-r', '-la'])
  assert.equal(wrapped.indexOf('--'), READ_ONLY_VECTOR.length + 1, 'exactly one separator, right after the profile')
})

test('remoteRunnerArgv: workspace-write carries exactly one --bind pair', () => {
  const wrapped = remoteRunnerArgv(['bash', '-c', 'true'], { mode: 'workspace-write', workspaceRoot: WORKSPACE }, 'bwrap')
  assert.equal(wrapped.filter(token => token === '--bind').length, 1)
  assert.equal(wrapped.filter(token => token === WORKSPACE).length, 2)
  assert.deepEqual(wrapped, ['bwrap', ...READ_ONLY_VECTOR, '--tmpfs', '/tmp', '--bind', WORKSPACE, WORKSPACE, '--', 'bash', '-c', 'true'])
})

test('remoteRunnerArgv: an empty original argv still produces a well-formed wrap', () => {
  assert.deepEqual(remoteRunnerArgv([], { mode: 'read-only' }, 'bwrap'), ['bwrap', ...READ_ONLY_VECTOR, '--'])
})

/* -------------------------------------------------- 5) probe command */

test('buildRemoteProbeCommand: the version gate, the resolve gate, and the real profile around true', () => {
  const command = buildRemoteProbeCommand()
  assert.match(command, /^command -v 'bwrap' && 'bwrap' --version; command -v 'bwrap' > \/dev\/null && /)
  const [versionGate, resolveGate, functionalStep] = command.split(' && ')
  assert.equal(versionGate, "command -v 'bwrap'", '1) resolvable at all')
  assert.equal(resolveGate, "'bwrap' --version; command -v 'bwrap' > /dev/null", '2) version read, then re-resolve')
  // 3) the functional check — and the shape that matters: the step must be the
  //    runner argv as SEPARATE shell words. Quoting the joined vector instead
  //    yields ONE word, so a healthy host tries to exec a program literally
  //    named `bwrap --ro-bind … -- true`, exits 127, and fail-closed turns that
  //    into a fence that refuses every command on every host forever.
  const expectedArgv = ['bwrap', ...READ_ONLY_VECTOR, '--', 'true']
  assert.equal(expectedArgv.length, 12, 'the full vector incl. runner + terminator')
  assert.deepEqual(shellTokens(functionalStep ?? ''), expectedArgv,
    'quote removal must yield the runner argv word by word')
  assert.equal(
    (functionalStep ?? '').includes(quoteShellArg(expectedArgv.join(' '))),
    false,
    'never the joined vector wrapped in a single quote pair',
  )
})

test('buildRemoteProbeCommand: nothing is unquoted except the fixed probe vocabulary', () => {
  const command = buildRemoteProbeCommand()
  // The bare remainder is the fixed operator vocabulary only. Count NUL
  // placeholders separately: the functional step quotes EVERY argv word (12 of
  // them), so the number of quoted spans is now part of the contract rather
  // than one opaque span.
  const bare = stripQuoted(command).split(/\s+/).filter(token => token !== '' && token !== '\u0000')
  assert.deepEqual(bare, ['command', '-v', '&&', '--version;', 'command', '-v', '>', '/dev/null', '&&'],
    'the bare vocabulary is fixed: runner and profile words are never bare text')
  const spans = stripQuoted(command).split('\u0000').length - 1
  // 3 runner occurrences (resolve gate, version, re-resolve) + 12 argv words.
  assert.equal(spans, 15, 'every runner occurrence and every argv word is quoted')
  assert.equal(command.includes('$('), false, 'no command substitution')
  assert.equal(command.includes('`'), false, 'no backtick substitution')
  assert.equal(/\$\{?[A-Za-z_]/.test(command), false, 'no variable expansion')
  assert.equal(command.includes('||'), false, 'no or-list')
  assert.equal(command.includes('|'), false, 'no pipeline')
})

test('buildRemoteProbeCommand: a runner path with an embedded quote stays one inert argument', () => {
  const hostile = "/tmp/it's; touch /tmp/pwned && echo "
  const command = buildRemoteProbeCommand(hostile)
  assert.equal(command.split(quoteShellArg(hostile)).length - 1, 4,
    'all three occurrences use the single-quoted spelling')
  // Quote removal is the contract: every occurrence must come back as ONE inert
  // argument, and the functional step must come back as the runner argv.
  const tokens = shellTokens(command)
  assert.equal(tokens.filter(token => token === hostile).length, 4,
    'the payload is four arguments, never shell syntax')
  assert.deepEqual(tokens.slice(-(READ_ONLY_VECTOR.length + 3)), [hostile, ...READ_ONLY_VECTOR, '--', 'true'],
    'the functional step is the runner argv word by word')
})

test('buildRemoteProbeCommand: a shell-metacharacter runner path is inert, not a second command', () => {
  const hostile = '/tmp/x; touch /tmp/pwned && echo '
  const command = buildRemoteProbeCommand(hostile)
  assert.equal(command.split(quoteShellArg(hostile)).length - 1, 4, 'every occurrence is quoted')
  assert.deepEqual(
    stripQuoted(command).split(/\s+/).filter(token => token !== '' && token !== '\u0000'),
    ['command', '-v', '&&', '--version;', 'command', '-v', '>', '/dev/null', '&&'],
    'the payload leaves no trace in the bare shell text',
  )
  assert.equal(stripQuoted(command).includes('touch'), false)
  assert.equal(stripQuoted(command).includes('pwned'), false)
  const tokens = shellTokens(command)
  assert.equal(tokens.filter(token => token === hostile).length, 4,
    'quote removal restores the whole payload as one argument each time')
  assert.deepEqual(tokens.slice(-(READ_ONLY_VECTOR.length + 3)), [hostile, ...READ_ONLY_VECTOR, '--', 'true'])
})

test('buildRemoteProbeCommand: an explicit runner path is used consistently (same builder as the wrap)', () => {
  const command = buildRemoteProbeCommand('/opt/bwrap')
  assert.equal(command.includes("command -v '/opt/bwrap' && '/opt/bwrap' --version"), true)
  assert.deepEqual(shellTokens(command).slice(-(READ_ONLY_VECTOR.length + 3)),
    ['/opt/bwrap', ...READ_ONLY_VECTOR, '--', 'true'],
    'probe text and runner argv share one builder, so they cannot drift apart')
})
/* ------------------------------------------------ 6) parseRemoteProbe */

test('parseRemoteProbe: healthy host ⇒ ok with the version', () => {
  const verdict = parseRemoteProbe({ exitCode: 0, stdout: 'bubblewrap 0.8.0\n', stderr: '' })
  assert.deepEqual(verdict, { ok: true, version: '0.8.0' })
})

test('parseRemoteProbe: healthy host whose --version wording differs still reports ok', () => {
  const verdict = parseRemoteProbe({ exitCode: 0, stdout: 'bwrap 0.9.1', stderr: '' })
  assert.deepEqual(verdict, { ok: true, version: '0.9.1' })
})

test('parseRemoteProbe: ok without a readable version is still an honest ok (no invented version)', () => {
  const verdict = parseRemoteProbe({ exitCode: 0, stdout: '', stderr: '' })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.version, undefined)
  assert.deepEqual(Object.keys(verdict), ['ok'])
})

test('parseRemoteProbe: missing runner (exit 127) fails closed and keeps the env diagnostic', () => {
  const verdict = parseRemoteProbe({
    exitCode: 127,
    stdout: '',
    stderr: "env: 'bwrap': No such file or directory\n",
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.version, undefined)
  assert.equal(verdict.detail, "env: 'bwrap': No such file or directory")
})

test('parseRemoteProbe: a missing runner that is never resolved is still refused (bare bash text)', () => {
  const verdict = parseRemoteProbe({ exitCode: 127, stdout: '', stderr: 'bash: line 1: bwrap: command not found\n' })
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail ?? '', /command not found/)
})

test('parseRemoteProbe: present but unusable (userns blocked) fails closed with bwrap text', () => {
  const verdict = parseRemoteProbe({
    exitCode: 1,
    stdout: 'bubblewrap 0.8.0\n',
    stderr: 'bwrap: No permissions to creating new namespace, likely because the kernel does not allow non-privileged user namespaces\n',
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.version, '0.8.0', 'a readable version does not make an unusable runner usable')
  assert.match(verdict.detail ?? '', /No permissions to creating new namespace/)
})

test('parseRemoteProbe: garbage / interleaved output never reads as ok', () => {
  for (const outcome of [
    { exitCode: 1, stdout: '', stderr: 'command not found' },
    { exitCode: 2, stdout: 'bwrap: unexpected argument --ro-bind', stderr: '' },
    { exitCode: 255, stdout: 'usage: bwrap [OPTIONS...] [COMMAND]', stderr: 'bwrap: usage error' },
    { exitCode: -1, stdout: '', stderr: '' },
    { exitCode: 3, stdout: '\u0000\u0001\u0002', stderr: '' },
  ]) {
    const verdict = parseRemoteProbe(outcome)
    assert.equal(verdict.ok, false, `exit ${outcome.exitCode} must not be ok`)
  }
})

test('parseRemoteProbe: a signal death (exitCode null) is a failure with an explicit detail', () => {
  const verdict = parseRemoteProbe({ exitCode: null, stdout: '', stderr: '', signal: 'SIGKILL' })
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail ?? '', /did not complete \(signal: SIGKILL\)/)
  const bare = parseRemoteProbe({ exitCode: null, stdout: '', stderr: '' })
  assert.match(bare.detail ?? '', /signal: unknown/)
})

test('parseRemoteProbe: a silent non-zero exit still yields a non-empty detail', () => {
  const verdict = parseRemoteProbe({ exitCode: 1, stdout: '', stderr: '' })
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail ?? '', /exited 1 with no diagnostic output/)
})

test('parseRemoteProbe: detail falls back to stdout and is whitespace-collapsed and capped', () => {
  const fromStdout = parseRemoteProbe({ exitCode: 1, stdout: 'line one\n\n  line two\n', stderr: '' })
  assert.equal(fromStdout.detail, 'line one line two')
  const long = parseRemoteProbe({ exitCode: 1, stdout: '', stderr: 'x'.repeat(400) })
  assert.equal((long.detail ?? '').length, 241, '240 chars plus the ellipsis')
  assert.equal((long.detail ?? '').endsWith('…'), true)
})

test('parseRemoteProbe: never throws on a malformed outcome object', () => {
  const loose = parseRemoteProbe({ exitCode: 0 } as never)
  assert.equal(loose.ok, true)
  const bad = parseRemoteProbe({ exitCode: 1, stdout: null, stderr: undefined } as never)
  assert.equal(bad.ok, false)
  assert.equal(typeof bad.detail, 'string')
})

test('remoteRunnerVersionOf: strict bubblewrap wording wins, loose semver is the fallback', () => {
  assert.equal(remoteRunnerVersionOf('bubblewrap 0.8.0', ''), '0.8.0')
  assert.equal(remoteRunnerVersionOf('', 'bubblewrap v0.10.0-rc'), '0.10.0')
  assert.equal(remoteRunnerVersionOf('bwrap 0.7', ''), '0.7')
  assert.equal(remoteRunnerVersionOf('no version here', ''), undefined)
})

/* -------------------------------------------------- 7) denial dialect */

test('REMOTE_DENIAL_SIGNATURES: the narrow bwrap read-only-filesystem dialect', () => {
  assert.deepEqual([...REMOTE_DENIAL_SIGNATURES], ['read-only file system'])
})

test('isRemoteDenialText: matches case-insensitively and only on the bwrap signature', () => {
  assert.equal(isRemoteDenialText('touch: cannot touch \'/tmp/x\': Read-only file system'), true)
  assert.equal(isRemoteDenialText('READ-ONLY FILE SYSTEM'), true)
  assert.equal(isRemoteDenialText('bash: /tmp/x: Read-only file system'), true)
  assert.equal(isRemoteDenialText(''), false)
  assert.equal(isRemoteDenialText('cat: /etc/hostname: No such file or directory'), false)
  assert.equal(isRemoteDenialText('permission denied'), false, 'other runners\' dialects are not merged in')
  assert.equal(isRemoteDenialText('operation not permitted'), false)
})

test('isRemoteDenialText: a clean read is not a denial and a denial is not a runner failure', () => {
  assert.equal(isRemoteDenialText('dsh-host\n'), false)
  const denied = parseRemoteProbe({ exitCode: 1, stdout: '', stderr: 'bwrap: read-only file system' })
  assert.equal(denied.ok, false, 'a denial must never be mistaken for a usable probe')
})

/* --------------------------------------------------------- 8) cache */

test('createRemoteSandboxCache: keyed by connection identity, so a rebuild re-probes', () => {
  const cache = createRemoteSandboxCache()
  const first = { id: 'c1' }
  const rebuilt = { id: 'c1' }
  assert.equal(cache.get(first), undefined)
  cache.set(first, { ok: true, version: '0.8.0' })
  assert.deepEqual(cache.get(first), { ok: true, version: '0.8.0' })
  assert.equal(cache.get(rebuilt), undefined, 'same id, different object ⇒ no stale verdict')
  cache.set(rebuilt, { ok: false, detail: 'gone' })
  assert.equal(cache.get(first)?.ok, true)
  assert.equal(cache.get(rebuilt)?.ok, false)
})

/* ------------------------------------------------------ 9) reporting */

test('remoteSandboxFactsOf: off wraps nothing and claims nothing', () => {
  const facts = remoteSandboxFactsOf('off')
  assert.equal(facts.mode, 'off')
  assert.equal(facts.wrapsSpawn, false)
  assert.equal(facts.enforcement, 'none')
  assert.deepEqual(facts.profileArgs, [])
  assert.deepEqual(facts.denialSignatures, [])
  assert.deepEqual(facts.boundaries, [])
  assert.deepEqual(facts.covers, {
    spawnedCommands: false,
    interactiveTerminals: false,
    fsWrites: false,
    network: false,
    hostProbes: false,
  })
})

test('remoteSandboxFactsOf: a fenced mode reports the honest coverage gaps', () => {
  for (const mode of ['read-only', 'workspace-write'] as const) {
    const facts = remoteSandboxFactsOf(mode)
    assert.equal(facts.mode, mode)
    assert.equal(facts.wrapsSpawn, true)
    assert.equal(facts.enforcement, 'full')
    assert.equal(facts.covers.spawnedCommands, true)
    assert.equal(facts.covers.interactiveTerminals, false, 'fenced terminals are refused in v1')
    assert.equal(facts.covers.fsWrites, true, 'fenced file tools share the core jail')
    assert.equal(facts.covers.network, false)
    assert.equal(facts.covers.hostProbes, false)
    assert.deepEqual([...facts.denialSignatures], ['read-only file system'])
    assert.equal(facts.boundaries.includes(REMOTE_SANDBOX_MESSAGES.boundaryFsWrites), true)
    assert.equal(facts.boundaries.includes(REMOTE_SANDBOX_MESSAGES.boundaryFileEffects), true)
  }
})

test('remoteSandboxFactsOf: the reported profile matches the real vector (bind root aside)', () => {
  assert.deepEqual(remoteSandboxFactsOf('read-only').profileArgs, READ_ONLY_VECTOR)
  const write = [...remoteSandboxFactsOf('workspace-write').profileArgs]
  assert.deepEqual(write, [
    ...READ_ONLY_VECTOR,
    '--tmpfs', '/tmp',
    '--bind', WORKSPACE_ROOT_PLACEHOLDER, WORKSPACE_ROOT_PLACEHOLDER,
  ])
  const real = remoteProfileArgs({ mode: 'workspace-write', workspaceRoot: WORKSPACE })
  assert.deepEqual(
    write.map(token => (token === WORKSPACE_ROOT_PLACEHOLDER ? WORKSPACE : token)),
    real,
    'the reporting shape is the real vector with the root substituted — it cannot drift',
  )
})

/* ------------------------------------------------- 10) error surface */

test('remoteSandboxUnavailableError: carries the code and the mode, with and without a detail', () => {
  const plain = remoteSandboxUnavailableError('read-only')
  assert.equal(plain.code, REMOTE_SANDBOX_UNAVAILABLE)
  assert.equal(plain.name, 'RemoteSandboxError')
  assert.equal(plain instanceof Error, true)
  assert.match(plain.message, /sandbox mode "read-only"/)
  assert.equal(plain.message.includes('probe failed'), false)

  const detailed = remoteSandboxUnavailableError('workspace-write', "env: 'bwrap': No such file or directory")
  assert.equal(detailed.code, REMOTE_SANDBOX_UNAVAILABLE)
  assert.match(detailed.message, /sandbox mode "workspace-write"/)
  assert.match(detailed.message, /Runner failure: remote sandbox probe failed/)
  assert.match(detailed.message, /no command text was sent/)
  assert.match(detailed.message, /env: 'bwrap': No such file or directory/)

  const emptyDetail = remoteSandboxUnavailableError('read-only', '')
  assert.equal(emptyDetail.message, plain.message)
})

test('fenceMissingHint: a missing core is a deploy problem, not a bubblewrap problem', () => {
  // The real detail a deleted `~/.dsh-core/<version>/` produces (core-client
  // reports the remote shell's stderr verbatim).
  const coreGone = 'core stdout closed: bash: line 1: /home/uuz/.dsh-core/current/dsh-core: No such file or directory'
  assert.match(String(fenceMissingHint(coreGone)), /core\.deploy/)
  assert.match(String(fenceMissingHint("env: 'bwrap': No such file or directory")), /no bubblewrap/)
  assert.equal(fenceMissingHint('bwrap: Permission denied'), undefined, 'no signature ⇒ no hint')
  const refusal = remoteSandboxUnavailableError('workspace-write', coreGone)
  assert.match(refusal.message, /deploy it from the plugin settings \(core\.deploy\)/)
  assert.equal(/apt-get install|pacman|zypper|dnf install/.test(refusal.message), false,
    'a deleted core must not be reported as a missing bubblewrap')

  // A runner that is genuinely absent still gets the install hints.
  const noRunner = remoteSandboxUnavailableError('read-only', "env: 'bwrap': No such file or directory")
  assert.match(noRunner.message, /The remote has no bubblewrap/)
  assert.match(noRunner.message, /apt-get install -y bubblewrap/)

  // An unrelated failure gets no remedy sentence at all.
  const other = remoteSandboxUnavailableError('read-only', 'bwrap: setting up uid map: Permission denied')
  assert.equal(other.message.includes('The remote has no bubblewrap'), false)
  assert.equal(other.message.includes('not installed on the remote'), false)
})

test('the refusal vocabulary stays distinct from the approval gate refusal', () => {
  assert.notEqual(REMOTE_SANDBOX_UNAVAILABLE, '')
  assert.equal(REMOTE_SANDBOX_UNAVAILABLE, 'SANDBOX_UNAVAILABLE', 'the upstream code string, verbatim')
  assert.equal(REMOTE_SANDBOX_MESSAGES.terminalUnsupported.includes('{mode}'), true)
})
