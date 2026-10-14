import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  artifactActions,
  mirrorUploadedFile,
  planRemoteUpload,
  renderRemoteFileLines,
  resetSessionUploadsForTests,
  safeUploadLeaf,
  sessionUploadsFor,
} from '../src/session-uploads.ts'

test('safeUploadLeaf strips separators and odd characters', () => {
  assert.equal(safeUploadLeaf('notes.md'), 'notes.md')
  assert.equal(safeUploadLeaf('../../etc/passwd'), 'passwd')
  assert.equal(safeUploadLeaf(''), 'file')
  assert.equal(safeUploadLeaf('a b.txt'), 'a_b.txt')
})

test('planRemoteUpload lands in the remote workspace and ignores local cwd', () => {
  assert.equal(planRemoteUpload('/home/me/proj', 'a.txt', 'sha256:abcdef1234567890'), null)
  const plan = planRemoteUpload('ssh://c1/srv/work', 'a b.txt', 'sha256:abcdef1234567890')
  assert.deepEqual(plan, {
    machineId: 'c1',
    remotePath: '/srv/work/.dsh-uploads/abcdef12-a_b.txt',
    leaf: 'abcdef12-a_b.txt',
  })
})

test('mirrorUploadedFile writes once and records the remote path (REQ-I28)', async () => {
  resetSessionUploadsForTests()
  const writes: { path: string; data: Buffer }[] = []
  const first = await mirrorUploadedFile({
    cwd: 'ssh://c1/srv/work',
    sessionId: 's1',
    file: { attachmentId: 'sha256:abcdef1234', name: 'pic.png' },
    read: async () => Buffer.from('png'),
    write: async (remotePath, data) => { writes.push({ path: remotePath, data }) },
  })
  const second = await mirrorUploadedFile({
    cwd: 'ssh://c1/srv/work',
    sessionId: 's1',
    file: { attachmentId: 'sha256:abcdef1234', name: 'pic.png' },
    read: async () => { throw new Error('should not read twice') },
    write: async () => { throw new Error('should not write twice') },
  })
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.path, '/srv/work/.dsh-uploads/abcdef12-pic.png')
  assert.equal(writes[0]?.data.toString(), 'png')
  assert.equal(second?.remotePath, first?.remotePath)
  assert.equal(sessionUploadsFor('s1')[0]?.remotePath, first?.remotePath)
  const lines = renderRemoteFileLines('s1')
  assert.match(lines, /Files copied into this remote workspace/)
  assert.match(lines, /\/srv\/work\/\.dsh-uploads\/abcdef12-pic\.png/)
  const local = await mirrorUploadedFile({
    cwd: '/tmp/local',
    sessionId: 's2',
    file: { attachmentId: 'id', name: 'a.txt' },
    read: async () => Buffer.from('no'),
    write: async () => { throw new Error('local must not write') },
  })
  assert.equal(local, null)
  await assert.rejects(mirrorUploadedFile({
    cwd: 'ssh://c1/srv/work',
    sessionId: 's3',
    file: { attachmentId: 'other', name: 'b.txt' },
    read: async () => Buffer.from('x'),
    write: async () => { throw new Error('disk full') },
  }), /disk full/)
  resetSessionUploadsForTests()
})

test('artifactActions records in-workspace paths and copies host files outside it', () => {
  const actions = artifactActions('/srv/work', [
    'out/report.md',
    '/srv/work/already.txt',
    '/tmp/host-only.bin',
    'ssh://c9/nope',
    '../escape',
  ])
  assert.deepEqual(actions.map(action => action.remotePath), [
    '/srv/work/out/report.md',
    '/srv/work/already.txt',
    '/srv/work/.dsh-artifacts/host-only.bin',
  ])
  assert.equal(actions[2]?.copyHostPath, '/tmp/host-only.bin')
  assert.equal(actions[0]?.copyHostPath, undefined)
})
