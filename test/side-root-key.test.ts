/**
 * 远程侧根拼写规范化（session.ws.add 前置）：remoteSideRootKey 把三种远程
 * 拼写（`ssh://<id>/<abs>`、占位树 `dsw-routes/<id>/…`、旧树
 * `dsh-ssh-routes/<id>/…`）统一到同一个 `ssh://<id>/<posix>` 根键；无含义
 * 的本地/相对路径读作 null。
 * @module test/side-root-key
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { remoteSideRootKey } from '../src/session-workspaces.ts'
import { sshRoutesRoot } from '../src/transport.ts'

test('remoteSideRootKey: the ssh:// spelling canonicalizes to ssh://<id>/<posix>', () => {
  assert.equal(remoteSideRootKey('ssh://c1/srv/work'), 'ssh://c1/srv/work')
  assert.equal(remoteSideRootKey('ssh://c1//a//b/'), 'ssh://c1/a/b') // degenerate separators
  assert.equal(remoteSideRootKey('ssh://c2/a/b'), 'ssh://c2/a/b')
  assert.equal(remoteSideRootKey('ssh://c1/'), 'ssh://c1/') // filesystem-root key stays
})

test('remoteSideRootKey: both placeholder trees decode to the same ssh:// root key', () => {
  const placeholder = join(sshRoutesRoot(), 'c1', 'srv', 'work')
  assert.equal(remoteSideRootKey(placeholder), 'ssh://c1/srv/work')
  assert.equal(remoteSideRootKey(join(placeholder, 'subdir')), 'ssh://c1/srv/work/subdir')
  // The pre-rename tree routes identically.
  const legacy = placeholder.replace('dsw-routes', 'dsh-ssh-routes')
  assert.equal(remoteSideRootKey(legacy), 'ssh://c1/srv/work')
  // A placeholder whose id is a different machine still decodes onto ITS root.
  assert.equal(remoteSideRootKey(join(sshRoutesRoot(), 'c2', 'srv', 'work')), 'ssh://c2/srv/work')
})

test('remoteSideRootKey: meaningless spellings read as null', () => {
  assert.equal(remoteSideRootKey('C:\\x'), null) // win32 local absolute
  assert.equal(remoteSideRootKey('relative'), null) // relative
  assert.equal(remoteSideRootKey('/home/uuz'), null) // bare POSIX absolute
  assert.equal(remoteSideRootKey(''), null)
  assert.equal(remoteSideRootKey('ssh://c1'), null) // missing path
  assert.equal(remoteSideRootKey('ssh://c1:22/srv'), null) // port in the id slot
  assert.equal(remoteSideRootKey('ssh://bad id/a'), null) // id charset
})
