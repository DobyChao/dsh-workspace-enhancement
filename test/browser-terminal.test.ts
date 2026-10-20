/** BUG-17: same host, concurrent remote terminal owners and local shell discovery. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { installBrowserTerminalRouting } from '../src/browser-terminal.ts'
import { MixedSubprocessRuntime } from '../src/mixed.ts'
import type { SubprocessBranch } from '../src/mixed.ts'
import { SshSubprocessEngine } from '../src/subprocess.ts'
import { EventEmitter } from 'node:events'
import { spawnSshTerminal } from '../src/terminal.ts'
import type { SshTransport } from '../src/transport.ts'

interface Owner { session: { header: { cwd: string } } }
const agent = (cwd: string): Owner => ({ session: { header: { cwd } } })

function fixture() {
  const effects: Array<() => unknown> = []
  const calls: string[] = []
  const transports = Object.fromEntries(['a', 'b'].map(id => [id, {
    cwd: `/srv/${id}`,
    async exec(command: string) {
      await new Promise(resolve => setImmediate(resolve))
      calls.push(`${id}:${command}`)
      if (command.startsWith('uname')) return { exitCode: 0, stdout: `Linux\n/bin/${id}-shell\n` }
      if (command.includes('cmd.exe')) return { exitCode: 1, stdout: '' }
      return { exitCode: 0, stdout: `/bin/${id}-shell\n` }
    },
  }]))
  let controller: unknown
  const ctx = {
    get(name: string) {
      if (name === 'sshRegistry') return { get: (id: string) => transports[id] }
      if (name === 'terminalController') return controller
      throw new Error(`unexpected lookup ${name}`)
    },
    effect(fn: () => () => unknown) { effects.push(fn()) },
    inject(_deps: string[], mount: (owner: unknown) => void) { mount(ctx) },
  } as unknown as Context
  const remote = new SshSubprocessEngine(ctx)
  const spawned: SubprocessTerminalSpawnSpec[] = []
  remote.spawnTerminal = async spec => { spawned.push(spec); return {} as SubprocessTerminalHandle }
  const local: SubprocessBranch = {
    terminalEnvironment: async () => ({ platform: 'windows', defaultShell: 'cmd.exe' }),
    resolveExecutable: async name => `C:\\Windows\\${name}`,
    spawn: () => { throw new Error('not used') },
    spawnTerminal: async spec => { spawned.push(spec); return {} as SubprocessTerminalHandle },
  }
  const mixed = new MixedSubprocessRuntime(local, remote)
  const face = {
    async shells(_owner: Owner, signal = new AbortController().signal) {
      const env = await mixed.terminalEnvironment(signal)
      const shell = await mixed.resolveExecutable(env.defaultShell!, undefined, signal)
      try { await mixed.resolveExecutable('cmd.exe', undefined, signal) } catch (error) {
        // Actual TerminalController discovery catches only this typed lookup miss.
        if (!(error instanceof SubprocessExecutableNotFoundError)) throw error
      }
      return shell
    },
    async create(owner: Owner) {
      const shell = await this.shells(owner)
      await mixed.spawnTerminal({ argv: [shell, '-i'], cwd: owner.session.header.cwd, cols: 80, rows: 24, terminalType: 'xterm', graceMs: 100 })
      return shell
    },
  }
  controller = face
  return { ctx, face, mixed, remote, calls, effects, spawned }
}

test('BUG-17: simultaneous remote shells/PTYs stay on their own machine; host discovery stays local', async () => {
  const f = fixture()
  installBrowserTerminalRouting(f.ctx)
  const shells = await Promise.all([
    f.face.create(agent('ssh://a/srv/a')),
    f.face.create(agent('ssh://b/srv/b')),
    f.face.create(agent('C:\\work')),
    f.mixed.resolveExecutable('cmd.exe'),
  ])
  assert.deepEqual(shells, ['/bin/a-shell', '/bin/b-shell', 'C:\\Windows\\cmd.exe', 'C:\\Windows\\cmd.exe'])
  assert.equal(f.spawned.find(spec => spec.cwd === 'ssh://b/srv/b')?.argv[0], '/bin/b-shell')
  assert.equal(f.spawned.find(spec => spec.cwd === 'ssh://a/srv/a')?.argv[0], '/bin/a-shell')
  assert.equal(f.calls.filter(call => call.includes('uname')).length, 2)
  assert.equal(await f.mixed.resolveExecutable('cmd.exe'), 'C:\\Windows\\cmd.exe')
})

test('BUG-17: controller wrapping restores exact functions and supports reload', async () => {
  const f = fixture()
  const original = f.face.shells
  installBrowserTerminalRouting(f.ctx)
  const wrapped = f.face.shells
  installBrowserTerminalRouting(f.ctx)
  assert.equal(f.face.shells, wrapped)
  f.effects.at(-1)!()
  assert.equal(f.face.shells, original)
  installBrowserTerminalRouting(f.ctx)
  assert.equal(await f.face.shells(agent('ssh://b/srv/b')), '/bin/b-shell')
  f.effects.at(-1)!()
})

test('BUG-17: unknown routes and cancellation surface instead of falling back to host shells', async () => {
  const f = fixture()
  installBrowserTerminalRouting(f.ctx)
  await assert.rejects(f.face.shells(agent('ssh://missing/work')))
  const controller = new AbortController()
  controller.abort(new Error('cancel discovery'))
  await assert.rejects(f.face.shells(agent('ssh://a/work'), controller.signal), /cancel discovery/)
  assert.equal(f.calls.length, 0)
})

test('BUG-17: Node writable success callback null is not a terminal allocation failure', async () => {
  const channel = new EventEmitter() as EventEmitter & { write(data: unknown, callback: (error: null) => void): void }
  const writes: string[] = []
  channel.write = (data, callback) => { writes.push(String(data)); callback(null) }
  const ssh = {
    getRemoteEnvironment: async () => ({ PATH: '/usr/bin:/bin', HOME: '/home/test' }),
    exec: async () => ({ exitCode: 0, stdout: 'PATH=/usr/bin:/bin\u0000HOME=/home/test\u0000', stderr: '' }),
    getClient: async () => ({ shell: (_options: unknown, callback: (error: null, stream: unknown) => void) => callback(null, channel) }),
  } as unknown as SshTransport
  const terminal = await spawnSshTerminal(ssh, '/srv/project', {
    argv: ['/bin/bash', '-i'], cols: 80, rows: 24, terminalType: 'xterm', graceMs: 20,
  })
  assert.match(writes[0]!, /cd '\/srv\/project' && exec env -i/)
  channel.emit('close', 0, null)
  assert.equal((await terminal.done).exitCode, 0)
})
