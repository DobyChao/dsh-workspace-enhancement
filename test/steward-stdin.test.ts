/**
 * BUG-13 (#59): the direct-leg stop steward must read the real SSH stdin.
 * With job control off, a background `cat` whose stdin is not redirected sees
 * `/dev/null` and kills the command within milliseconds. These cases run `sh`
 * in its own session so `kill -TERM 0` cannot take the test runner with it.
 * Windows process-group semantics differ; the string lock lives in
 * `test/bug9-stop.test.ts` and runs there too.
 * @module test/steward-stdin
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { REMOTE_STOP_STEWARD } from '../src/process.ts'
import { quoteShellArg } from '../src/ssh-core.ts'

const skip = process.platform === 'win32'

interface StewardResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  ms: number
}

/**
 * Run the steward as sshd would: fd 0 is the stop wire, fd 3 is the payload.
 * @param argv - the user command, after the `_` placeholder.
 * @param stdin - `'open'` keeps the stop wire up; `'eof'` closes it at once.
 * @param fd3 - bytes delivered on the payload fd (then closed).
 */
function runSteward(argv: readonly string[], stdin: 'open' | 'eof', fd3 = ''): Promise<StewardResult> {
  const child = spawn('sh', ['-c', REMOTE_STOP_STEWARD, '_', ...argv], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  })
  const started = Date.now()
  let stdout = ''
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  const payload = child.stdio[3]
  if (payload !== null && payload !== undefined && 'end' in payload) payload.end(fd3)
  if (stdin === 'eof') child.stdin?.end()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
      }
      reject(new Error(`steward timed out after 4s (stdout=${JSON.stringify(stdout)})`))
    }, 4_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      child.stdin?.end()
      resolve({ code, signal, stdout, ms: Date.now() - started })
    })
  })
}

test('BUG-13: an open stop wire lets the command finish', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-bug13-'))
  try {
    const marker = join(dir, 'm')
    const script = `echo start >> ${quoteShellArg(marker)}; sleep 1; echo end >> ${quoteShellArg(marker)}`
    const result = await runSteward(['sh', '-c', script], 'open')
    assert.equal(result.code, 0, `signal=${result.signal ?? ''} stdout=${result.stdout}`)
    assert.equal(result.signal, null)
    assert.match(readFileSync(marker, 'utf8'), /start\nend\n/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('BUG-13: a real stdin EOF still kills the command group', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-bug13-'))
  try {
    const marker = join(dir, 'm')
    const script = `echo start >> ${quoteShellArg(marker)}; sleep 3; echo end >> ${quoteShellArg(marker)}`
    const result = await runSteward(['sh', '-c', script], 'eof')
    assert.ok(result.ms < 1_500, `expected a prompt kill, lived ${result.ms}ms`)
    const killed = result.signal === 'SIGTERM' || result.code === 143
    assert.ok(killed, `expected SIGTERM, got code=${result.code} signal=${result.signal}`)
    const text = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
    assert.equal(text.includes('end'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('BUG-13: the user command still reads its payload from fd 3', { skip }, async () => {
  const result = await runSteward(['cat'], 'open', 'hello-from-fd3\n')
  assert.equal(result.code, 0, `signal=${result.signal ?? ''}`)
  assert.equal(result.stdout, 'hello-from-fd3\n')
})
