#!/usr/bin/env node
/**
 * Throwaway profile materializer for the L1-in-CI harness (INFRA-23).
 *
 * Same pattern as `scripts/boot-smoke.mjs` `writeProfile` (the files the
 * plugin manager would write), shaped for the headless lane instead of the
 * web lane:
 *
 *   profiles/l1/package.json — bundles: dsh-base + dsh-headless + this plugin
 *   profiles/l1/{cordis.yml,cordis.patch.yml} — empty compose/user layers
 *   settings.yaml            — `llm-deepseek.baseURL` pinned at the fake
 *                               model (the dsh-base row resolves the endpoint
 *                               per request from this settings section)
 *   remote-workspaces/machines.json — the e2e ssh target, key or password
 *                               auth, plaintext backend, TOFU accept-new
 *   dsw-routes/<id>/<remote path>/ — the placeholder tree that makes a real
 *                               session's cwd resolve to the remote world
 *                               (the official way to hand `ssh://` routes to
 *                               sessions; src/transport.ts).
 *
 * @module scripts/e2e-l1/profile
 */

import {
  mkdirSync, rmSync, symlinkSync, existsSync, lstatSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** `lstatSync` that does not throw on a missing path. */
function safeLstat(path) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/** Link `target` at `path` (junction on Windows, dir symlink elsewhere). */
function link(target, path) {
  if (existsSync(path) || safeLstat(path)) rmSync(path, { recursive: true, force: true })
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Forward slashes for YAML `link:` specifiers (Windows-proof). */
const specifierPath = (path) => path.replaceAll('\\', '/')

/**
 * Materialize one throwaway DSH_HOME for a single case.
 *
 * @param {object} input
 * @param {string} input.home - DSH_HOME (created fresh; removed if it exists).
 * @param {string} input.pluginDir - this repo (with a built `lib/`).
 * @param {number} input.modelPort - the fake model's loopback port.
 * @param {{ id: string, label?: string, host: string, port: number, username: string,
 *           privateKeyPath?: string, password?: string, workspace: string }} input.machine
 * @returns {{ placeholderCwd: string }} the directory to run the host from.
 */
export function materialize({ home, pluginDir, modelPort, machine }) {
  const profile = join(home, 'profiles', 'l1')
  mkdirSync(join(profile, 'node_modules'), { recursive: true })
  writeFileSync(join(profile, 'cordis.yml'), '# e2e-l1: composed from the bundle list\n[]\n')
  writeFileSync(join(profile, 'cordis.patch.yml'), '# e2e-l1: no user patch layer\n[]\n')
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-l1',
    private: true,
    dependencies: { 'dsh-workspace-enhancement': `link:${specifierPath(resolve(pluginDir))}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-workspace-enhancement'] } },
  }, null, 2)}\n`)

  writeFileSync(join(home, 'settings.yaml'), [
    '# e2e-l1: the model endpoint is the in-process fake server',
    'llm-deepseek:',
    `  baseURL: http://127.0.0.1:${modelPort}`,
    '  apiKey: sk-e2e-l1-fake',
    '',
  ].join('\n'))

  const spec = {
    id: machine.id,
    label: machine.label ?? 'e2e-l1-sshd',
    host: machine.host,
    port: machine.port,
    username: machine.username,
    credentialBackend: 'plain',
    hostKeyMode: 'accept-new',
    workspace: machine.workspace,
  }
  if (machine.privateKeyPath !== undefined) spec.privateKeyPath = machine.privateKeyPath
  if (machine.password !== undefined) spec.password = machine.password
  mkdirSync(join(home, 'remote-workspaces'), { recursive: true })
  writeFileSync(join(home, 'remote-workspaces', 'machines.json'), `${JSON.stringify({ list: [spec], currentId: machine.id }, null, 2)}\n`)

  // The placeholder tree is what a real session's cwd resolves through: any
  // absolute remote path under the machine's workspace works as the session
  // root. `link:` resolves through the profile's node_modules.
  link(resolve(pluginDir), join(profile, 'node_modules', 'dsh-workspace-enhancement'))
  const placeholderCwd = join(home, 'dsw-routes', machine.id, machine.workspace.replaceAll('\\', '/'))
  mkdirSync(placeholderCwd, { recursive: true })
  return { placeholderCwd }
}

/** Best-effort cleanup of a throwaway home (kept open files may survive). */
export function cleanup(home) {
  rmSync(home, { recursive: true, force: true })
}
