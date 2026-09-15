/**
 * REQ-I5: `core/profile.json` must stay locked to the TS bwrap vector and,
 * when present, the deployed upstream `dsh-sandbox-local` tokens.
 * @module test/core-profile-drift
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { REMOTE_BWRAP_PROFILE_READ_ONLY, REMOTE_BWRAP_PROFILE_WRITE_EXTRA } from '../src/remote-sandbox.ts'

const here = dirname(fileURLToPath(import.meta.url))
const profilePath = join(here, '..', 'core', 'profile.json')

test('core/profile.json matches REMOTE_BWRAP_PROFILE_* token arrays', () => {
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
    readOnly: string[]
    workspaceWriteExtra: string[]
  }
  assert.deepEqual(profile.readOnly, [...REMOTE_BWRAP_PROFILE_READ_ONLY])
  assert.deepEqual(profile.workspaceWriteExtra, [...REMOTE_BWRAP_PROFILE_WRITE_EXTRA])
})

test('core/profile.json matches deployed dsh-sandbox-local when that package is present', () => {
  const require = createRequire(import.meta.url)
  let resolved: string
  try {
    resolved = require.resolve('@deepseek-ai/dsh-sandbox-local')
  } catch {
    // CI does not install this package (same SKIP as remote-sandbox-drift).
    return
  }
  const source = readFileSync(resolved, 'utf8')
  for (const token of REMOTE_BWRAP_PROFILE_READ_ONLY) {
    assert.ok(source.includes(token), `upstream bundle missing ${token}`)
  }
  assert.ok(existsSync(profilePath))
})
