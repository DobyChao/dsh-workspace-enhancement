import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WORKSPACE_COMMAND,
  adoptPickedWorkspace,
  createWorkspaceCommandBridge,
} from '../src/client/workspace-command.ts'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const messages = { empty: 'empty', unavailable: 'unavailable', noId: 'no-id' }

test('REQ-I33: the bridge opens one session and close clears it', () => {
  const bridge = createWorkspaceCommandBridge()
  const seen: Array<string | null> = []
  const stop = bridge.subscribe(() => {
    seen.push(bridge.snapshot()?.sessionId ?? null)
  })
  bridge.open('')
  assert.equal(bridge.snapshot(), null)
  bridge.open('s1')
  bridge.open('s2')
  bridge.close()
  bridge.close()
  stop()
  assert.deepEqual(seen, ['s1', 's2', null])
  assert.equal(bridge.snapshot(), null)
})

test('REQ-I33: a picked directory is registered and then opened', async () => {
  const opened: string[] = []
  await adoptPickedWorkspace('  /work  ', {
    async create(input) {
      assert.equal(input.path, '/work')
      return { workspaceId: 'ws-1' }
    },
  }, {
    async openWorkspace(id) {
      opened.push(id)
    },
  }, messages)
  assert.deepEqual(opened, ['ws-1'])
})

test('REQ-I33: adopt fails closed without a creator or an id', async () => {
  await assert.rejects(
    adoptPickedWorkspace('   ', { async create() { return { workspaceId: 'x' } } }, undefined, messages),
    /empty/,
  )
  await assert.rejects(
    adoptPickedWorkspace('/work', undefined, undefined, messages),
    /unavailable/,
  )
  await assert.rejects(
    adoptPickedWorkspace('/work', { async create() { return {} } }, {
      async openWorkspace() { throw new Error('should not open') },
    }, messages),
    /no-id/,
  )
})

test('REQ-I33: /workspace is registered only behind commandUi and portals the flow', () => {
  const client = readFileSync(join(REPO, 'src', 'client', 'index.ts'), 'utf-8')
  const view = readFileSync(join(REPO, 'src', 'client', 'workspace-command-host.tsx'), 'utf-8')
  assert.equal(WORKSPACE_COMMAND, 'workspace')
  assert.match(client, /inject\(\['commandUi'\]/)
  assert.match(client, /WORKSPACE_COMMAND/)
  assert.match(client, /conversation\.input\.overlay/)
  assert.match(view, /createPortal\(flow, document\.body\)/)
})
