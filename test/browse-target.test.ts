import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialBrowseTarget } from '../src/client/browse-target.ts'

test('initialBrowseTarget: explicit id wins, else the current machine (UX-11)', () => {
  assert.deepEqual(initialBrowseTarget('c2', 'c1', ['c1', 'c2']), { kind: 'remote', id: 'c2' })
  assert.deepEqual(initialBrowseTarget('', 'c1', ['c1', 'c2']), { kind: 'remote', id: 'c1' })
  assert.deepEqual(initialBrowseTarget('', 'missing', ['c1']), { kind: 'local' })
  assert.deepEqual(initialBrowseTarget('gone', 'c1', ['c1']), { kind: 'local' })
  assert.deepEqual(initialBrowseTarget('  ', '', []), { kind: 'local' })
})
