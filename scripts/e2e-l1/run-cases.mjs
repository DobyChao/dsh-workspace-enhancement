#!/usr/bin/env node
/**
 * L1-in-CI case runner (INFRA-23): drives the REAL host through the REAL
 * agent loop with a scripted fake model, and asserts the L1 matrix's M3–M5
 * behaviors deterministically (docs/uat/matrix.md §3).
 *
 * Why not drive the tools directly: the L1 assertions live in the REAL
 * executor's renderer, the REAL jobs service's owner contract, and the
 * OFFICIAL tool chain (`job_output`, fs tools) — exactly the seams the
 * UPSTREAM-8 breaks hid from every fabricated test double. The fake model
 * (scripts/e2e-l1/fake-model.mjs) keeps the chain real while pinning the
 * model's choices.
 *
 * Per case: fresh fake model + fresh throwaway DSH_HOME (profile.mjs) +
 * one `dsh --profile l1 --json "<task>"` run whose cwd is the placeholder
 * tree of the e2e machine, then assertions over the NDJSON event stream
 * (dsh-headless json-stream vocabulary: session/status/text/tool_call/
 * tool_result/final).
 *
 * usage:
 *   node scripts/e2e-l1/run-cases.mjs --cli <dsh-bin.js> [--plugin <repo>]
 *        (--key <path> | --password <secret> | $DSW_E2E_SSH_PASSWORD)
 *        [--host 127.0.0.1] [--port 2222] [--username e2essh]
 *        [--workspace /tmp/dsh-e2e-l1-ws] [--case m3-echo] [--keep] [--timeout 180000]
 * env:
 *   DSW_E2E_L1_CLI / DSW_E2E_L1_PLUGIN / DSW_E2E_SSH_HOST / DSW_E2E_SSH_PORT /
 *   DSW_E2E_SSH_USERNAME / DSW_E2E_SSH_KEY / DSW_E2E_SSH_PASSWORD / DSW_E2E_L1_WORKSPACE
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startFakeModel } from './fake-model.mjs'
import { materialize, cleanup } from './profile.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

/** Read `--flag value` / `--flag` (boolean) pairs. */
function parseArgs(argv) {
  const out = { flags: new Set() }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out.flags.add(key)
    else {
      out[key] = next
      i += 1
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const env = process.env

/** The host CLI (a node-runnable bin.js): explicit flag > env > repo-local install. */
function resolveCli() {
  const raw = args.cli ?? env.DSW_E2E_L1_CLI
  if (raw !== undefined) return resolve(raw)
  return join(REPO, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

const host = args.host ?? env.DSW_E2E_SSH_HOST ?? '127.0.0.1'
const sshPort = Number(args.port ?? env.DSW_E2E_SSH_PORT ?? 2222)
const username = args.username ?? env.DSW_E2E_SSH_USERNAME ?? 'e2essh'
const password = args.password ?? env.DSW_E2E_SSH_PASSWORD
const keyPath = args.key !== undefined ? resolve(args.key) : env.DSW_E2E_SSH_KEY !== undefined ? resolve(env.DSW_E2E_SSH_KEY) : undefined
const workspace = args.workspace ?? env.DSW_E2E_L1_WORKSPACE ?? '/tmp'
const pluginDir = resolve(args.plugin ?? env.DSW_E2E_L1_PLUGIN ?? REPO)
const caseFilter = args.case
const keep = args.flags.has('keep')
const caseTimeoutMs = Number(args.timeout ?? 180_000)

let failures = 0
const say = (line) => process.stdout.write(`${line}\n`)
const pass = (line) => process.stdout.write(`ok   ${line}\n`)
const fail = (line) => {
  failures += 1
  process.stdout.write(`FAIL ${line}\n`)
}

/** Text of the last tool_result block in an Anthropic request body. */
function lastToolResultText(request) {
  const blocks = (request?.messages ?? []).flatMap(message => Array.isArray(message?.content) ? message.content : [])
  const results = blocks.filter(block => block?.type === 'tool_result')
  const last = results[results.length - 1]
  if (typeof last?.content === 'string') return last.content
  if (Array.isArray(last?.content)) return last.content.map(part => part?.text ?? '').join('\n')
  return ''
}

/** Extract the background job id a previous sw_exec call reported. */
function backgroundJobIdOf(text) {
  return /started background job (\S+)/u.exec(text ?? '')?.[1]
}

/**
 * The L1 cases (matrix.md §3, process-level half). Every case is a FACTORY:
 * fresh closures per run carry state between scripted steps (the M4 job id,
 * the M5 probe path) without module-level mutable state.
 */
const CASES = [
  () => ({
    name: 'm3-echo',
    task: 'run the echo command with sw_exec exactly as scripted',
    steps: [
      { tool_use: { name: 'sw_exec', input: { command: 'echo hi' } } },
      { text: 'm3-echo done' },
    ],
    assert: ({ toolResults, final, exitCode }) => [
      { ok: exitCode === 0, label: 'exit code 0', detail: `got ${exitCode}` },
      { ok: toolResults.some(result => (result.result ?? '').includes('hi')), label: 'tool result contains hi' },
      { ok: final !== undefined && (final.text ?? '').includes('m3-echo done'), label: 'final answer emitted' },
    ],
  }),
  () => ({
    name: 'm3-exit3',
    task: 'run the failing command with sw_exec exactly as scripted',
    steps: [
      { tool_use: { name: 'sw_exec', input: { command: 'exit 3' } } },
      { text: 'm3-exit3 done' },
    ],
    assert: ({ toolResults }) => [
      { ok: toolResults.some(result => (result.result ?? '').includes('[exit code: 3]')), label: '[exit code: 3] marker rendered' },
    ],
  }),
  () => ({
    name: 'm3-no-output',
    task: 'run the silent command with sw_exec exactly as scripted',
    steps: [
      { tool_use: { name: 'sw_exec', input: { command: 'true' } } },
      { text: 'm3-no-output done' },
    ],
    assert: ({ toolResults }) => [
      { ok: toolResults.some(result => (result.result ?? '').includes('(no output)')), label: '(no output) marker rendered' },
    ],
  }),
  () => {
    const state = { jobId: undefined }
    const readOutput = () => ({
      tool_use: { name: 'job_output', input: { job_id: state.jobId ?? '', wait: true, timeout_ms: 20000 } },
    })
    return {
      name: 'm4-background',
      task: 'run the background job exactly as scripted, then read its output',
      steps: [
        { tool_use: { name: 'sw_exec', input: { command: 'sleep 2 && echo done', run_in_background: true } } },
        (request) => {
          state.jobId = backgroundJobIdOf(lastToolResultText(request))
          return readOutput()
        },
        () => readOutput(),
        { text: 'm4-background done' },
      ],
      assert: ({ toolResults }) => {
        const texts = toolResults.map(result => result.result ?? '')
        return [
          { ok: state.jobId !== undefined, label: 'background job id captured' },
          { ok: texts.some(text => text.includes('done')), label: 'job output contains done' },
          { ok: texts.some(text => /exit code: 0/u.test(text)), label: 'job exit marker present' },
        ]
      },
    }
  },
  () => {
    const probePath = `${workspace}/e2e-l1-probe-${Date.now()}.txt`
    return {
      name: 'm5-fs',
      task: 'write the probe file with the write tool, then read it back',
      steps: [
        { tool_use: { name: 'write', input: { file_path: probePath, content: 'dsw e2e-l1 fs probe — write then read back\n' } } },
        { tool_use: { name: 'read', input: { file_path: probePath } } },
        { text: 'm5-fs done' },
      ],
      assert: ({ toolResults }) => [
        { ok: toolResults.length >= 2, label: 'write and read both executed', detail: `${toolResults.length} tool results` },
        { ok: toolResults.every(result => result.status !== 'error'), label: 'no tool errors' },
        { ok: toolResults.some(result => (result.result ?? '').includes('dsw e2e-l1 fs probe')), label: 'read-back content matches' },
        { ok: !toolResults.some(result => /version mismatch|\bCAS\b|stale/u.test(result.result ?? '')), label: 'no CAS/version false positives' },
      ],
    }
  },
]

/** Run one case end to end; true when every assertion held. */
async function runCase(makeCase) {
  const test = makeCase()
  say(`--- ${test.name} ---`)
  const fake = await startFakeModel(test.steps)
  const home = mkdtempSync(join(tmpdir(), `dsh-e2e-l1-${test.name}-`))
  try {
    const { placeholderCwd } = materialize({
      home,
      pluginDir,
      modelPort: fake.port,
      machine: {
        id: 'c1',
        host,
        port: sshPort,
        username,
        workspace,
        ...(keyPath !== undefined ? { privateKeyPath: keyPath } : {}),
        ...(keyPath === undefined && password !== undefined ? { password } : {}),
      },
    })
    const proc = spawn(process.execPath, [resolveCli(), '--profile', 'l1', '--json', test.task], {
      cwd: placeholderCwd,
      env: { ...env, DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    const events = []
    const stderr = []
    let stdoutRest = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', chunk => {
      stdoutRest += chunk
      const lines = stdoutRest.split('\n')
      stdoutRest = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() === '') continue
        try {
          events.push(JSON.parse(line))
        } catch { /* tolerate non-JSON diagnostics on stdout */ }
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', chunk => stderr.push(chunk))
    const outcome = await Promise.race([
      new Promise((done) => { proc.on('close', (code) => done(code)) }),
      sleep(caseTimeoutMs).then(() => 'timeout'),
    ])
    if (outcome === 'timeout') {
      proc.kill('SIGKILL')
      fail(`${test.name}: the host did not exit within ${caseTimeoutMs}ms`)
      return false
    }
    const toolResults = events.filter(event => event.type === 'tool_result')
    const finals = events.filter(event => event.type === 'final')
    let held = true
    for (const assertion of test.assert({
      events,
      toolResults,
      final: finals[finals.length - 1],
      exitCode: outcome,
      fakeRequests: fake.requests,
    })) {
      if (assertion.ok) pass(`${test.name}: ${assertion.label}`)
      else {
        fail(`${test.name}: ${assertion.label}${assertion.detail !== undefined ? ` — ${assertion.detail}` : ''}`)
        held = false
      }
    }
    if (!held) {
      say(`     events: ${JSON.stringify(events).slice(0, 800)}`)
      say(`     stderr tail: ${stderr.join('').slice(-600)}`)
    }
    return held
  } finally {
    fake.server.close()
    if (!keep) cleanup(home)
    else say(`     kept: ${home}`)
  }
}

async function main() {
  say(`e2e-l1: cli=${resolveCli()}`)
  say(`e2e-l1: plugin=${pluginDir}`)
  if (!existsSync(resolveCli())) {
    say('e2e-l1: host CLI not found — pass --cli <dsh lib/bin.js> or set DSW_E2E_L1_CLI')
    process.exitCode = 1
    return
  }
  if (!existsSync(join(pluginDir, 'lib', 'index.js'))) {
    say('e2e-l1: lib/index.js missing — run `npm run build` first')
    process.exitCode = 1
    return
  }
  if (keyPath === undefined && password === undefined) {
    say('e2e-l1: no ssh credential — pass --key <path>, --password <secret>, or set DSW_E2E_SSH_PASSWORD')
    process.exitCode = 1
    return
  }
  if (keyPath !== undefined && !existsSync(keyPath)) {
    say(`e2e-l1: private key not found: ${keyPath}`)
    process.exitCode = 1
    return
  }
  const factories = CASES
  const selected = caseFilter !== undefined ? factories.filter(makeCase => makeCase().name === caseFilter) : factories
  if (selected.length === 0) {
    say(`e2e-l1: no case named ${caseFilter} (have: ${factories.map(makeCase => makeCase().name).join(', ')})`)
    process.exitCode = 1
    return
  }
  let held = 0
  for (const makeCase of selected) {
    if (await runCase(makeCase)) held += 1
  }
  const before = failures
  say(held === selected.length ? `E2E-L1 PASS (${held}/${selected.length} cases)` : `E2E-L1 FAIL (${held}/${selected.length} cases passed)`)
  process.exitCode = held === selected.length && before === failures ? 0 : 1
}

await main()
