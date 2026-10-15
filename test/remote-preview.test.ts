/**
 * REQ-A6: bounded remote preview reads and the file-inclusive listing.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listRemoteFiles } from '../src/listing.ts'
import type { SshTransport } from '../src/transport.ts'
import {
  previewDocument,
  previewKindOf,
  readRemotePreviewFile,
} from '../src/remote-preview.ts'
import type { PreviewSftp, PreviewStat } from '../src/remote-preview.ts'

function stat(size: number, file: boolean): PreviewStat {
  return { size, isFile: () => file }
}

function memorySftp(files: Record<string, Buffer | 'dir'>): PreviewSftp {
  return {
    stat(path, callback) {
      const hit = files[path]
      if (hit === undefined) callback(new Error('No such file'))
      else callback(undefined, stat(hit === 'dir' ? 0 : hit.length, hit !== 'dir'))
    },
    open(path, _flags, callback) {
      if (typeof files[path] !== 'object') callback(new Error('not a file'))
      else callback(undefined, Buffer.from(path))
    },
    read(handle, buffer, offset, length, position, callback) {
      const path = handle.toString()
      const body = files[path]
      if (typeof body !== 'object') {
        callback(new Error('not a file'), 0)
        return
      }
      const slice = body.subarray(position, position + length)
      slice.copy(buffer, offset)
      callback(undefined, slice.length)
    },
    close(_handle, callback) { callback(undefined) },
  }
}

test('REQ-A6 preview classifies text, images, and pdfs', () => {
  assert.equal(previewKindOf('notes.md', new Uint8Array()), 'text')
  assert.equal(previewKindOf('shot.png', new Uint8Array()), 'image')
  assert.equal(previewKindOf('paper.pdf', new Uint8Array()), 'pdf')
  assert.equal(previewKindOf('blob.bin', Uint8Array.from([0, 1, 2])), 'binary')
  const text = previewDocument('/srv/app/.dsh-uploads/a.txt', {
    size: 5,
    bytes: new TextEncoder().encode('hello'),
    truncated: false,
  })
  assert.equal(text.kind, 'text')
  assert.equal(text.text, 'hello')
  const image = previewDocument('/srv/app/.dsh-artifacts/a.png', {
    size: 4,
    bytes: Uint8Array.from([1, 2, 3, 4]),
    truncated: false,
  })
  assert.equal(image.kind, 'image')
  assert.equal(image.mediaType, 'image/png')
  assert.equal(typeof image.base64, 'string')
  const huge = previewDocument('/srv/app/.dsh-artifacts/a.pdf', {
    size: 9,
    bytes: new Uint8Array(),
    truncated: true,
  })
  assert.equal(huge.kind, 'pdf')
  assert.equal(huge.base64, undefined)
})

test('REQ-A6 a remote read stops at the byte cap and refuses directories', async () => {
  const sftp = memorySftp({
    '/srv/app/.dsh-uploads/a.txt': Buffer.from('abcdef'),
    '/srv/app/.dsh-uploads': 'dir',
  })
  const file = await readRemotePreviewFile(sftp, '/srv/app/.dsh-uploads/a.txt', 4)
  assert.equal(file.isFile, true)
  assert.equal(file.truncated, true)
  assert.equal(file.size, 6)
  assert.equal(Buffer.from(file.bytes).toString(), 'abcd')
  const dir = await readRemotePreviewFile(sftp, '/srv/app/.dsh-uploads', 4)
  assert.equal(dir.isFile, false)
})

test('REQ-A6 file listing keeps files and directories', async () => {
  const entries = [
    { filename: '.', attrs: flags(false, false, false) },
    { filename: 'note.txt', attrs: flags(true, false, false) },
    { filename: 'nested', attrs: flags(false, true, false) },
    { filename: 'link', attrs: flags(false, false, true) },
  ]
  const sftp = {
    readdir(_path: string, callback: (error: Error | undefined, value: typeof entries) => void) {
      callback(undefined, entries)
    },
    stat(path: string, callback: (error: Error | undefined, value?: { isDirectory(): boolean; isFile(): boolean }) => void) {
      const file = path.endsWith('/link')
      callback(undefined, {
        isDirectory: () => false,
        isFile: () => file,
      })
    },
  }
  const ssh = { getSftp: async () => sftp } as unknown as SshTransport
  const listed = await listRemoteFiles(ssh, '/srv/app/.dsh-uploads', 10)
  assert.deepEqual(listed.entries.map(entry => [entry.name, entry.kind]), [
    ['link', 'file'],
    ['nested', 'directory'],
    ['note.txt', 'file'],
  ])
})

function flags(file: boolean, directory: boolean, link: boolean) {
  return {
    isFile: () => file,
    isDirectory: () => directory,
    isSymbolicLink: () => link,
  }
}
