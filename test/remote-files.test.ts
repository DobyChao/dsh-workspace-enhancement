/**
 * REQ-A6: remote upload/artifact tree, host preview bridge, and the optional
 * better-sidebar probe. The panel is a view; these functions are the behavior.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  affiliateViewerDescriptor,
  installBetterSidebar,
  probeBetterSidebar,
  sidebarHasFeature,
  workspaceTabDescriptor,
} from '../src/client/better-sidebar.ts'
import {
  asPreviewWire,
  inWorkspaceExtras,
  isMissingListing,
  listedLevel,
  previewChoice,
  remoteWorkspaceOf,
  sessionFileAddress,
  specialRoots,
  WORKSPACE_TAB_ID,
  REMOTE_VIEWER_ID,
} from '../src/client/remote-files.ts'
import { claimsRemoteArtifactPath, previewPathAllowed } from '../src/remote-layout.ts'
import { REMOTE_ARTIFACT_DIR, REMOTE_UPLOAD_DIR } from '../src/session-uploads.ts'

const workspace = '/srv/app'

test('REQ-A6 directory names match the upload landing zones', () => {
  assert.equal(REMOTE_UPLOAD_DIR, '.dsh-uploads')
  assert.equal(REMOTE_ARTIFACT_DIR, '.dsh-artifacts')
  const roots = specialRoots(workspace)
  assert.deepEqual(roots.map(root => root.path), [
    '/srv/app/.dsh-uploads',
    '/srv/app/.dsh-artifacts',
  ])
})

test('REQ-A6 remote workspace comes from the session cwd spelling', () => {
  assert.deepEqual(remoteWorkspaceOf('ssh://c1/srv/app'), { connectionId: 'c1', workspace: '/srv/app' })
  assert.deepEqual(remoteWorkspaceOf('/home/dev/.dsh/dsw-routes/c1/srv/app'), {
    connectionId: 'c1',
    workspace: '/srv/app',
  })
  assert.deepEqual(remoteWorkspaceOf('C:\\Users\\dev\\.dsh\\dsw-routes\\c1\\srv\\app'), {
    connectionId: 'c1',
    workspace: '/srv/app',
  })
  assert.equal(remoteWorkspaceOf('/home/dev/project'), null)
  assert.equal(remoteWorkspaceOf('ssh://c1'), null)
  assert.equal(remoteWorkspaceOf(undefined), null)
})

test('REQ-A6 preview reads stay inside the workspace upload and artifact trees', () => {
  const recorded = ['/srv/app/out/report.md']
  assert.equal(previewPathAllowed(workspace, '/srv/app/.dsh-uploads/a.txt', []), true)
  assert.equal(previewPathAllowed(workspace, '/srv/app/.dsh-artifacts/pic.png', []), true)
  assert.equal(previewPathAllowed(workspace, '/srv/app/.dsh-uploads', []), true)
  assert.equal(previewPathAllowed(workspace, '/srv/app/out/report.md', recorded), true)
  assert.equal(previewPathAllowed(workspace, '/srv/app/secret.txt', []), false)
  assert.equal(previewPathAllowed(workspace, '/etc/passwd', []), false)
  assert.equal(previewPathAllowed(workspace, '/srv/app/.dsh-uploads/../secret', []), false)
  assert.deepEqual(inWorkspaceExtras(workspace, ['/srv/app/out/report.md', '/srv/app/.dsh-uploads/a.txt']), [
    '/srv/app/out/report.md',
  ])
})

test('REQ-A6 host preview uses a session file address, never an absolute one', () => {
  const address = sessionFileAddress('s 1', '.dsh-uploads/a b.txt')
  assert.equal(address, 'dsh-resource://file/session/s%201/.dsh-uploads/a%20b.txt')
  assert.equal(address.includes('file/absolute'), false)
  const ready = previewChoice({
    sessionId: 's1',
    workspace,
    remotePath: '/srv/app/.dsh-uploads/a.txt',
    openResource: () => undefined,
    workspaceFiles: { readBytes: () => undefined },
  })
  assert.deepEqual(ready, {
    kind: 'host',
    address: 'dsh-resource://file/session/s1/.dsh-uploads/a.txt',
  })
  const localOnly = previewChoice({
    sessionId: 's1',
    workspace,
    remotePath: '/srv/app/.dsh-uploads/a.txt',
    openResource: () => undefined,
    workspaceFiles: undefined,
  })
  assert.deepEqual(localOnly, { kind: 'plugin' })
  const outside = previewChoice({
    sessionId: 's1',
    workspace,
    remotePath: '/etc/passwd',
    openResource: () => undefined,
    workspaceFiles: { read: () => undefined },
  })
  assert.deepEqual(outside, { kind: 'plugin' })
})

test('REQ-A6 listing and preview wires tolerate partial payloads', () => {
  const level = listedLevel({
    path: '/srv/app/.dsh-uploads',
    truncated: false,
    entries: [
      { name: 'a.txt', path: '/srv/app/.dsh-uploads/a.txt', kind: 'file' },
      { name: 'nested', path: '/srv/app/.dsh-uploads/nested', kind: 'directory' },
      { name: '..', path: '/srv/app', kind: 'directory' },
    ],
  })
  assert.equal(level?.entries.length, 2)
  assert.equal(level?.entries[0]?.kind, 'file')
  assert.equal(level?.entries[1]?.kind, 'directory')
  assert.equal(asPreviewWire({ path: '/a', name: 'a', kind: 'text', text: 'hi', size: 2 })?.text, 'hi')
  assert.equal(asPreviewWire({ kind: 'nope' }), undefined)
  assert.equal(isMissingListing('No such file'), true)
  assert.equal(isMissingListing('permission denied'), false)
})

test('REQ-A6 better-sidebar probe degrades without registerTab and never uses the files kind', () => {
  assert.equal(probeBetterSidebar(undefined), undefined)
  assert.equal(probeBetterSidebar({ version: '0.19.0' }), undefined)
  const bare = probeBetterSidebar({ registerTab: () => () => {} })
  assert.notEqual(bare, undefined)
  assert.deepEqual(bare?.features, [])
  assert.equal(sidebarHasFeature(bare!, 'badge'), false)
  const featured = probeBetterSidebar({
    registerTab: () => () => {},
    registerFileViewer: () => () => {},
    features: ['badge', 3, 'openFile'],
  })
  assert.equal(sidebarHasFeature(featured!, 'badge'), true)
  assert.equal(featured?.registerFileViewer === undefined, false)
  const tab = workspaceTabDescriptor({ title: () => 't', description: () => 'd', component: () => null })
  assert.equal(tab.id, WORKSPACE_TAB_ID)
  assert.equal(tab.id === 'files', false)
  assert.equal(tab.single, true)
  const viewer = affiliateViewerDescriptor({
    title: () => 'v',
    load: async () => ({}),
    component: () => null,
  })
  assert.equal(viewer.id, REMOTE_VIEWER_ID)
  assert.deepEqual(viewer.exts, [])
  assert.equal(viewer.fetchStrategy, 'custom')
  assert.equal(viewer.detect('/srv/app/.dsh-uploads/a.txt'), true)
  assert.equal(viewer.detect('/srv/app/.dsh-artifacts/b.pdf'), true)
  assert.equal(viewer.detect('/srv/app/src/main.ts'), false)
  assert.equal(viewer.detect('/srv/app/.dsh-uploads-old/a.txt'), false)
  assert.equal(claimsRemoteArtifactPath('/tmp/.dsh-uploads/a'), true)
})

test('REQ-A6 install skips a missing peer and swallows an already-registered throw', () => {
  const skipped: string[] = []
  const absent = installBetterSidebar({
    get: () => undefined,
    effect: (fn) => { skipped.push('called'); fn() },
  }, {
    title: () => 't',
    description: () => 'd',
    component: () => null,
    viewerTitle: () => 'v',
    load: async () => ({}),
    viewer: () => null,
  })
  assert.equal(absent, false)
  assert.deepEqual(skipped, [])

  const registered: string[] = []
  const present = installBetterSidebar({
    get: (name) => name === 'betterSidebar' ? {
      registerTab: () => { throw new Error('tab type "dsw:workspaces" already registered') },
      registerFileViewer: (descriptor: { id: string }) => {
        registered.push(descriptor.id)
        return () => {}
      },
      features: [],
    } : undefined,
    effect: (fn) => fn(),
  }, {
    title: () => 't',
    description: () => 'd',
    component: () => null,
    viewerTitle: () => 'v',
    load: async () => ({}),
    viewer: () => null,
  })
  assert.equal(present, true)
  assert.deepEqual(registered, [REMOTE_VIEWER_ID])
})
