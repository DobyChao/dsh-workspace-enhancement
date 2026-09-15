/**
 * Official Write resolves a not-yet-created path. The core leaf realpath
 * used to throw ENOENT; the host-side walk must match dsh-fs-local.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CoreRpcError } from '../src/core-client.ts'
import { realpathAllowMissing } from '../src/core-fs.ts'
import { CORE_ERROR_NOT_FOUND } from '../src/core-protocol.ts'

function missing(path: string): CoreRpcError {
  return new CoreRpcError({ code: CORE_ERROR_NOT_FOUND, message: `not found: ${path}` })
}

test('realpathAllowMissing: missing leaf joins the existing parent', async () => {
  const existing = new Set(['/home/uuz/ssh-test-lab', '/home/uuz', '/home', '/'])
  const lookup = async (path: string): Promise<string> => {
    if (!existing.has(path)) throw missing(path)
    return path
  }
  assert.equal(
    await realpathAllowMissing(lookup, '/home/uuz/ssh-test-lab/r27-in-20260914.txt'),
    '/home/uuz/ssh-test-lab/r27-in-20260914.txt',
  )
})

test('realpathAllowMissing: existing file is returned as-is', async () => {
  const lookup = async (path: string): Promise<string> => path
  assert.equal(await realpathAllowMissing(lookup, '/work/a.txt'), '/work/a.txt')
})

test('realpathAllowMissing: non-ENOENT lookup errors propagate', async () => {
  await assert.rejects(
    () => realpathAllowMissing(async () => {
      throw new CoreRpcError({ code: 'EACCES', message: 'permission denied' })
    }, '/work/a.txt'),
    (error: unknown) => error instanceof CoreRpcError && error.code === 'EACCES',
  )
})
