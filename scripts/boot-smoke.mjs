#!/usr/bin/env node
/**
 * Boot smoke for dsh-workspace-enhancement — the sentinel the drift job was
 * missing.
 *
 * The upstream sentinels (`typecheck`, the unit suite, `check:static`) all stop
 * at "it compiles against the family". They cannot see a host whose SERVICE
 * CONTRACT changed, because the plugin only fails when a real host loads it
 * (`cannot get property "webServer" without inject` — R17 t3 §10.1: 0.1.5-rc.1
 * and 0.1.5-rc.2 crashed at boot while every static gate stayed green).
 *
 * This script boots a REAL host against a throwaway `DSH_HOME`, waits for the
 * listening URL, and probes the surface the row is supposed to provide:
 *
 *   1. the process must still be alive after the URL was printed (boot did not
 *      fail and no fiber took the tree down);
 *   2. the HTTP root must answer (the web transport is up);
 *   3. `POST /api/dsw/connections.list` must answer 200 with the channel's JSON
 *      envelope (the row actually mounted its channel on the shared transport).
 *
 * The channel assertion is STRICT on every channel. The plugin's routes are
 * exact Fetch routes below `/api` (`connection.fetch.register`), a supported
 * seam across the whole 0.1.5 line, so a 404/405 here is a regression and never
 * "a known break" — the `--channel-warn` escape hatch is gone for that reason.
 *
 * Exit code 0 = all probes passed, 1 = any probe failed. Never touches the
 * product profile: `DSH_HOME` always points at a fresh directory.
 *
 * usage:
 *   node scripts/boot-smoke.mjs [--cli <bin.js>] [--plugin <dir>] [--home <dir>]
 *                               [--port <n>] [--timeout <ms>] [--keep]
 *                               [--channel <path>] [--endpoint <name>] [--no-channel]
 * env:
 *   DSH_BOOT_SMOKE_CLI / DSH_BOOT_SMOKE_PLUGIN / DSH_BOOT_SMOKE_HOME
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, existsSync, lstatSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

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

/**
 * Default host CLI.
 *
 * `@deepseek-ai/dsh` is NOT one of this repo's dependencies (the host is the
 * deployment's), so there is no repo-local default any more. Candidates, in
 * order: `--cli` / `DSH_BOOT_SMOKE_CLI` (already applied by the caller), a
 * repo-local install if one exists, the npm global root next to this node
 * binary, and the Windows npm prefix.
 */
function defaultCli() {
  const candidates = [
    join(REPO, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    process.env.APPDATA === undefined ? '' : join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  return candidates.find((candidate) => candidate !== '' && existsSync(candidate)) ?? candidates[0]
}

const args = parseArgs(process.argv.slice(2))
const cli = resolve(args.cli ?? process.env.DSH_BOOT_SMOKE_CLI ?? defaultCli())
const plugin = resolve(args.plugin ?? process.env.DSH_BOOT_SMOKE_PLUGIN ?? REPO)
const timeoutMs = Number(args.timeout ?? 90_000)
// The channel probe is ON by default and STRICT: a boot where the row silently
// failed to mount is exactly the failure mode this sentinel exists for, and the
// `/api` seam it uses is supported everywhere the plugin claims support.
// `--no-channel` skips the probe entirely (boot-only smoke).
const channel = args.channel ?? '/api'
const endpoint = args.endpoint ?? 'dsw/connections.list'
const requireChannel = !args.flags.has('no-channel')
const keep = args.flags.has('keep')

let failures = 0
let home = ''
const say = (line) => process.stdout.write(`${line}\n`)
const fail = (line) => {
  failures += 1
  process.stdout.write(`FAIL ${line}\n`)
}
const pass = (line) => process.stdout.write(`ok   ${line}\n`)

/** A free loopback port (bind 0, read it, release). */
async function freePort() {
  if (args.port !== undefined) return Number(args.port)
  const probe = createServer()
  await new Promise((done, bad) => {
    probe.once('error', bad)
    probe.listen(0, '127.0.0.1', done)
  })
  const { port } = probe.address()
  await new Promise((done) => probe.close(done))
  return port
}

/** Link `target` at `path` (junction on Windows, dir symlink elsewhere). */
function link(target, path) {
  if (existsSync(path) || safeLstat(path)) rmSync(path, { recursive: true, force: true })
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

/** `lstatSync` that does not throw on a missing path. */
function safeLstat(path) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/** Native path for a YAML/JSON `link:` specifier. */
const specifierPath = (path) => path.replaceAll('\\', '/')

/**
 * Materialize the throwaway profile: the same three files the plugin manager
 * writes for `dsh plugin --profile web add <pkg>` — an empty bundle root, an
 * empty user patch layer, and a package.json whose bundle list carries our row
 * patch — plus the `node_modules` entry the `link:` dependency resolves through.
 */
function writeProfile(home) {
  const web = join(home, 'profiles', 'web')
  mkdirSync(join(web, 'node_modules'), { recursive: true })
  writeFileSync(join(web, 'cordis.yml'), '# boot smoke: the tree is composed from the bundle list\n[]\n')
  writeFileSync(join(web, 'cordis.patch.yml'), '# boot smoke: no user patch layer\n[]\n')
  const manifest = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { 'dsh-workspace-enhancement': `link:${specifierPath(plugin)}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-workspace-enhancement'] } },
  }
  writeFileSync(join(web, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  link(plugin, join(web, 'node_modules', 'dsh-workspace-enhancement'))
}

/** Resolve the browser session cookie from the launch URL token. */
async function redeem(origin, token) {
  const res = await fetch(`${origin}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean)
  return {
    status: res.status,
    cookie: setCookies.map((header) => header.split(';')[0]).join('; '),
  }
}

/**
 * The channel envelope: `{type, rpcId, method, payload}` (see the client
 * transport). The endpoint travels as the full path below the shared channel
 * (`dsw/connections.list`), which is how `../src/web-channel.ts` spells it.
 */
async function callChannel(origin, cookie, name) {
  const res = await fetch(`${origin}${channel}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
    body: JSON.stringify({ type: 'client-request', rpcId: `boot-smoke-${Date.now()}`, method: name, payload: {} }),
  })
  const text = await res.text()
  return { status: res.status, text }
}

/** Stop the host and everything it spawned. */
function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    proc.kill('SIGKILL')
  }
}

async function main() {
  say(`boot smoke: cli=${cli}`)
  say(`boot smoke: plugin=${plugin}`)
  if (!existsSync(cli)) {
    fail(`host CLI not found at ${cli} (pass --cli or set DSH_BOOT_SMOKE_CLI)`)
    return
  }
  if (!existsSync(join(plugin, 'lib', 'web.js'))) {
    fail(`${plugin}/lib/web.js missing — run \`npm run build\` first`)
    return
  }

  home = args.home !== undefined
    ? resolve(args.home)
    : mkdtempSync(join(tmpdir(), 'dsh-boot-smoke-'))
  if (args.home !== undefined) rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  writeProfile(home)
  say(`boot smoke: DSH_HOME=${home}${keep ? ' (kept)' : ''}`)

  const port = await freePort()
  const outLog = join(home, 'host.stdout.log')
  const errLog = join(home, 'host.stderr.log')
  const outFd = openSync(outLog, 'a')
  const errFd = openSync(errLog, 'a')

  const proc = spawn(process.execPath, [cli, 'web', '--port', String(port), '--no-open'], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', outFd, errFd],
  })

  const read = (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  }

  let origin
  let token
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const url = /(http:\/\/127\.0\.0\.1:\d+\/)\?token=([\w.-]+)/u.exec(read(outLog))
    if (url !== null) {
      origin = url[1].replace(/\/$/u, '')
      token = url[2]
      break
    }
    if (proc.exitCode !== null) break
    await sleep(250)
  }

  if (origin === undefined || token === undefined) {
    fail(`the host never printed a listening URL within ${timeoutMs}ms`)
    if (proc.exitCode !== null) say(`host exit code=${proc.exitCode}`)
    say(`--- host.stdout.log ---\n${read(outLog).slice(-1500)}`)
    say(`--- host.stderr.log ---\n${read(errLog).slice(-2500)}`)
    stop(proc)
    return
  }
  pass(`host printed ${origin}/?token=… (pid ${proc.pid})`)

  await sleep(500)
  if (proc.exitCode !== null) {
    fail(`the host exited (code=${proc.exitCode}) after printing the URL — a fiber took the tree down`)
    say(`--- host.stderr.log ---\n${read(errLog).slice(-2500)}`)
    return
  }
  pass('host process is still alive after boot')

  let session
  try {
    session = await redeem(origin, token)
  } catch (error) {
    fail(`GET /?token=… failed: ${String(error)}`)
    stop(proc)
    return
  }
  if (session.status !== 303 && session.status !== 200) {
    fail(`GET /?token=… -> HTTP ${session.status} (expected 303/200)`)
  } else {
    pass(`GET /?token=… -> HTTP ${session.status}`)
  }

  if (session.cookie === '') {
    fail('the token exchange returned no session cookie')
  } else {
    try {
      const root = await fetch(`${origin}/`, { headers: { cookie: session.cookie }, redirect: 'manual' })
      if (root.status === 200) pass('GET / -> HTTP 200 (web transport serves the app)')
      else fail(`GET / -> HTTP ${root.status} (expected 200)`)
    } catch (error) {
      fail(`GET / failed: ${String(error)}`)
    }
  }

  const probePath = `${channel}/${endpoint}`
  if (requireChannel) {
    try {
      const res = await callChannel(origin, session.cookie, endpoint)
      if (res.status !== 200) {
        fail(`POST ${probePath} -> HTTP ${res.status} (expected 200) — the row did not mount its channel`)
        say(`     body: ${res.text.slice(0, 300)}`)
      } else {
        // The transport answers with `{type:"server-response", rpcId, result}`,
        // where `result` is the channel's own envelope (`{ok, value|error}`).
        const body = JSON.parse(res.text)
        const inner = body?.result ?? body
        if (inner?.ok !== true) fail(`POST ${probePath} answered ok=${JSON.stringify(inner?.ok)} — ${res.text.slice(0, 200)}`)
        else pass(`POST ${probePath} -> HTTP 200, result.ok=true (the row mounted its channel)`)
      }
    } catch (error) {
      fail(`POST ${probePath} failed: ${String(error)}`)
    }
  } else {
    say('note: channel probe skipped by --no-channel')
  }

  stop(proc)
  await sleep(300)
  say(failures > 0 ? `SMOKE FAIL (${failures} failing assertion(s))` : 'SMOKE PASS')
  say(`logs: ${outLog} / ${errLog}`)
}

try {
  await main()
} catch (error) {
  fail(`boot smoke crashed: ${error?.stack ?? String(error)}`)
} finally {
  if (!keep && args.home === undefined && home !== '' && failures === 0) {
    // Best effort: a Windows host may still hold the log files for a moment.
    try {
      rmSync(home, { recursive: true, force: true })
    } catch { /* keep the temp home for diagnosis */ }
  }
  process.exitCode = failures === 0 ? 0 : 1
}
