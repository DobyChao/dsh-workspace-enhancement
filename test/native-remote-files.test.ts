/** BUG-16: native file addresses must resolve within their own remote session. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { remoteFileTarget } from '../src/client/native-remote-files.ts'
import { sessionFileAddress } from '../src/client/remote-files.ts'
import { workspacePreviewAllowed } from '../src/remote-preview.ts'

const cwdOf = (id: string): string | undefined => ({
  remote: 'ssh://a/srv/project',
  win: 'C:\\Users\\dev\\.dsh\\dsw-routes\\a\\srv\\project',
  local: 'C:\\work',
} as Record<string, string>)[id]

test('BUG-16: ordinary files, uploads and Unicode files use the remote reader before local stat', () => {
  for (const name of ['hello.txt', '.dsh-uploads/file.png', '有空 格.txt']) {
    assert.deepEqual(remoteFileTarget(sessionFileAddress('remote', name), cwdOf), {
      sessionId: 'remote', connectionId: 'a', path: `/srv/project/${name}`,
    })
    assert.equal(workspacePreviewAllowed(cwdOf('remote'), 'a', `/srv/project/${name}`), true)
  }
  assert.deepEqual(remoteFileTarget(sessionFileAddress('win', 'C:\\Users\\dev\\.dsh\\dsw-routes\\a\\srv\\project\\hello.txt'), cwdOf), {
    sessionId: 'win', connectionId: 'a', path: '/srv/project/hello.txt',
  })
})

test('BUG-16: local, unknown, cross-machine, escaped and outside-workspace resources are declined', () => {
  const inputs: Array<[string, string]> = [
    ['local', 'hello.txt'], ['missing', 'hello.txt'], ['remote', '../outside'],
    ['remote', '/srv/project-other/hello.txt'], ['remote', '/etc/passwd'],
    ['remote', 'C:\\private\\file.txt'], ['remote', 'ssh://b/srv/project/hello.txt'],
  ]
  for (const [id, path] of inputs) assert.equal(remoteFileTarget(sessionFileAddress(id, path), cwdOf), null, `${id}: ${path}`)
  assert.equal(remoteFileTarget('dsh-resource://file/session/remote/%E0%A4', cwdOf), null)
  assert.equal(remoteFileTarget('dsh-resource://file/absolute/etc/passwd', cwdOf), null)
  assert.equal(remoteFileTarget('dsh-resource://file/session/remote/%00', cwdOf), null)
})

test('BUG-16: the host preview guard requires the same remote session and connection', () => {
  assert.equal(workspacePreviewAllowed(undefined, 'a', '/srv/project/hello.txt'), false)
  assert.equal(workspacePreviewAllowed(cwdOf('local'), 'a', '/srv/project/hello.txt'), false)
  assert.equal(workspacePreviewAllowed(cwdOf('remote'), 'b', '/srv/project/hello.txt'), false)
  assert.equal(workspacePreviewAllowed(cwdOf('remote'), 'a', '/srv/project/../outside'), false)
  assert.equal(workspacePreviewAllowed(cwdOf('remote'), 'a', '/srv/project'), false)
})
