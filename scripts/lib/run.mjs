/**
 * scripts/lib/run.mjs — capture a child process without pipes.
 *
 * Under the DSH file sandbox a process may not open named pipes, so
 * `child_process.spawnSync`/`execFileSync` with the default `stdio: 'pipe'`
 * fails with EPERM. Redirecting the child's stdout/stderr to temporary FILE
 * descriptors works in the sandbox and in CI alike, so every script here uses
 * this helper instead of the sync capture helpers.
 */
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {{ status: number | null, error?: Error, stdout: string, stderr: string }}
 */
export function runCapture(command, args, options = {}) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-run-'))
  const outPath = join(work, 'stdout')
  const errPath = join(work, 'stderr')
  const outFd = openSync(outPath, 'w')
  const errFd = openSync(errPath, 'w')
  let result
  try {
    result = spawnSync(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      stdio: ['ignore', outFd, errFd],
    })
  } finally {
    closeSync(outFd)
    closeSync(errFd)
  }
  const stdout = readFileSync(outPath, 'utf-8')
  const stderr = readFileSync(errPath, 'utf-8')
  rmSync(work, { recursive: true, force: true })
  return { status: result.status, error: result.error, stdout, stderr }
}

/** True when the failure is the sandbox refusing a child process, not a bug. */
export function isSandboxSpawnFailure(result) {
  const text = `${result.error?.message ?? ''}${result.stderr ?? ''}`
  return /EPERM|EACCES|operation not permitted|SetFileSecurityW/.test(text)
}
