/**
 * REQ-I5: deploy helpers are pure arch gates; no live SSH.
 * @module test/core-deploy
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertLinuxAmd64, coreInstallScript, forcedMissingTools, manifestIssues, remoteToolsPresent } from '../src/core-deploy.ts'
import { coreStatusLabel } from '../src/client/core-status.ts'

test('assertLinuxAmd64: linux + x86_64/amd64 accepted', () => {
  assert.doesNotThrow(() => assertLinuxAmd64('Linux', 'x86_64'))
  assert.doesNotThrow(() => assertLinuxAmd64('linux', 'amd64'))
})

test('assertLinuxAmd64: other kernels and aarch64 refused', () => {
  assert.throws(() => assertLinuxAmd64('Darwin', 'x86_64'), /linux only/)
  assert.throws(() => assertLinuxAmd64('Linux', 'aarch64'), /x86_64 only/)
})

test('coreStatusLabel: installed / missing / unsupported', () => {
  const t = (key: string, params?: Record<string, unknown>): string => {
    if (key === 'settings.core.ok') return `ok:${String(params?.version)}${String(params?.arch ?? '')}`
    if (key === 'settings.core.unsupported') return `bad:${String(params?.detail)}`
    return `miss:${String(params?.detail)}`
  }
  assert.equal(coreStatusLabel({ ok: true, version: '0.2.0-dev', arch: 'x86_64' }, t), 'ok:0.2.0-dev x86_64')
  assert.equal(coreStatusLabel({ ok: false, detail: 'core not installed' }, t), 'miss:core not installed')
  assert.match(coreStatusLabel({ ok: false, detail: 'uname -s = Darwin' }, t), /^bad:/)
})

test('coreInstallScript: chmod covers the core alone when nothing else is pushed', () => {
  const script = coreInstallScript('0.2.0-dev', '/tmp/dsh-core-0.2.0-dev-linux-x64.tar.gz')
  assert.match(script, /chmod \+x -- .*\/dsh-core/)
  // INFRA-15: third-party tools are never inside the tarball.
  assert.doesNotMatch(script, /bin\/bwrap/)
})

test('coreInstallScript: pushed vendor files are copied in and chmod-ed, then cleaned up', () => {
  const script = coreInstallScript(
    '0.2.0-dev',
    '/tmp/dsh-core-0.2.0-dev-linux-x64.tar.gz',
    [{ temp: '/tmp/dsh-core-rg-15.2.0', relative: 'bin/rg' }],
  )
  assert.match(script, /mkdir -p -- .*\/bin/)
  assert.match(script, /cp -- '\/tmp\/dsh-core-rg-15\.2\.0' .*\/bin\/rg/)
  assert.match(script, /chmod \+x -- .*\/dsh-core .*\/bin\/rg/)
  assert.match(script, /rm -f -- '[^']*dsh-core-0\.2\.0-dev-linux-x64\.tar\.gz' '\/tmp\/dsh-core-rg-15\.2\.0'/)
})

// REQ-I14 probe-then-flip: a freshly extracted binary must ANSWER before
// `current` is repointed, so a corrupt artifact cannot strand the machine.
test('coreInstallScript: probes the versioned binary before flipping current', () => {
  const script = coreInstallScript('0.2.0-dev', '/tmp/dsh-core-0.2.0-dev-linux-x64.tar.gz')
  const probe = script.indexOf('"$HOME"/.dsh-core/0.2.0-dev/dsh-core version')
  const chmod = script.indexOf('chmod +x --')
  const flip = script.indexOf('ln -sfn --')
  assert.ok(probe > chmod, 'the probe runs after chmod (an unexecutable binary must fail it)')
  assert.ok(probe < flip, 'the probe runs before current is repointed')
  assert.ok(flip > -1 && chmod > -1)
})

const sha = 'a'.repeat(64)

test('manifestIssues: the first-party core alone is a complete manifest (INFRA-15)', () => {
  const issues = manifestIssues({
    version: '0.2.0-dev',
    arch: 'linux-x86_64',
    files: { 'dsh-core': sha },
  })
  assert.deepEqual(issues, [])
})

test('manifestIssues: a tarball without the core is refused', () => {
  // The regression INFRA-15 guards: a fresh clone used to build a tarball whose
  // content (and MANIFEST) lacked the core binary, and the remote install then
  // died before `dsh-core version` could answer.
  const issues = manifestIssues({ version: '0.2.0-dev', files: {} })
  assert.equal(issues.length, 1)
  assert.match(issues.join('; '), /dsh-core/)
})

test('manifestIssues: malformed manifests are refused', () => {
  assert.equal(manifestIssues(null).length, 1)
  assert.equal(manifestIssues('nope').length, 1)
  assert.equal(manifestIssues({}).length, 1)
  assert.equal(manifestIssues({ files: { 'dsh-core': 'deadbeef' } }).length, 1)
})

test('remoteToolsPresent: the probe decides, unless the dev knob forces a name', () => {
  const stdout = 'RG\nBWRAP\n'
  assert.deepEqual(remoteToolsPresent(stdout, []), { rg: true, bwrap: true })
  assert.deepEqual(remoteToolsPresent(stdout, ['rg']), { rg: false, bwrap: true })
  assert.deepEqual(remoteToolsPresent('', ['bwrap']), { rg: false, bwrap: false })
  assert.deepEqual(remoteToolsPresent('RG\n', []), { rg: true, bwrap: false })
  assert.deepEqual(remoteToolsPresent('', []), { rg: false, bwrap: false })
})

test('forcedMissingTools: trims, lowercases and de-duplicates the dev knob', () => {
  assert.deepEqual(forcedMissingTools(''), [])
  assert.deepEqual(forcedMissingTools('   '), [])
  assert.deepEqual(forcedMissingTools(' rg , BWRAP ,rg'), ['rg', 'bwrap'])
  assert.deepEqual(forcedMissingTools('bwrap'), ['bwrap'])
})

/* ------------------------------------------------ REQ-I29: fence tier view */

import { fenceTierNote, parseFenceInfo } from '../src/core-deploy.ts'

test('parseFenceInfo: the three tier answers parse with their fields', () => {
  const bwrap = parseFenceInfo('{"tier":"bwrap","bwrapPath":"/usr/bin/bwrap","bwrapMissing":false,"landlockAbi":7}')
  assert.equal(bwrap?.tier, 'bwrap')
  assert.equal(bwrap?.bwrapPath, '/usr/bin/bwrap')
  assert.equal(bwrap?.landlockAbi, 7)
  const landlock = parseFenceInfo('{"tier":"landlock","bwrapProbeErr":"exit 1 under the read-only profile","landlockAbi":3,"notes":["landlock tier: no mount isolation"]}')
  assert.equal(landlock?.tier, 'landlock')
  assert.equal(landlock?.bwrapProbeErr, 'exit 1 under the read-only profile')
  assert.deepEqual(landlock?.notes, ['landlock tier: no mount isolation'])
  const none = parseFenceInfo('{"tier":"none","bwrapMissing":true,"landlockAbi":0}')
  assert.equal(none?.tier, 'none')
  assert.equal(none?.bwrapMissing, true)
})

test('parseFenceInfo: garbage and foreign shapes are unknown, never guessed', () => {
  assert.equal(parseFenceInfo(''), undefined)
  assert.equal(parseFenceInfo('usage: dsh-core …'), undefined)
  assert.equal(parseFenceInfo('{"tier":"nsjail"}'), undefined)
  assert.equal(parseFenceInfo('{"tier":42}'), undefined)
})

test('fenceTierNote: each tier line is honest about what it means', () => {
  assert.match(fenceTierNote({ tier: 'bwrap', landlockAbi: 7 }), /bwrap \(functionally probed; landlock abi 7 as fallback\)/)
  assert.match(
    fenceTierNote({ tier: 'landlock', landlockAbi: 3, bwrapProbeErr: 'exit 1 under the read-only profile' }),
    /landlock \(abi 3; bwrap unusable: exit 1.*\/tmp writable but shared, no PID isolation/,
  )
  const none = fenceTierNote({ tier: 'none', bwrapMissing: true, landlockAbi: 0 })
  for (const want of ['fence tier: NONE', 'bwrap not installed', 'landlock unavailable', 'sandbox mode off']) {
    assert.ok(none.includes(want), `none note missing "${want}": ${none}`)
  }
  const noneProbe = fenceTierNote({ tier: 'none', bwrapProbeErr: 'uid map failed', landlockAbi: 0 })
  assert.match(noneProbe, /bwrap installed but unusable \(uid map failed\)/)
})

test('coreStatusLabel: the fence tier drives the settings line (REQ-I29)', () => {
  const t = (key: string, params?: Record<string, unknown>): string => `${key}:${JSON.stringify(params ?? {})}`
  assert.match(
    coreStatusLabel({ ok: true, version: '0.2.3', fence: { tier: 'bwrap' } }, t),
    /^settings\.core\.okFenced:/,
  )
  assert.match(
    coreStatusLabel({ ok: true, version: '0.2.3', fence: { tier: 'landlock', landlockAbi: 3 } }, t),
    /^settings\.core\.okDegraded:/,
  )
  // A core without a fence is NOT a green line — the guidance takes the row.
  const noneLine = coreStatusLabel(
    { ok: true, version: '0.2.3', fence: { tier: 'none' }, detail: 'fence tier: NONE — …' },
    t,
  )
  assert.match(noneLine, /^settings\.core\.fenceNone:/)
  // An older same-line core (no fenceinfo answer) keeps the plain ok line.
  assert.match(coreStatusLabel({ ok: true, version: '0.2.3' }, t), /^settings\.core\.ok:/)
})
