/**
 * Backlog layout auditor: section ↔ status, note cap, §2 priority order.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditBacklog } from '../scripts/lib/backlog.mjs'

const skeleton = (body) => `# Backlog
## 1. doing
| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
## 2. todo
| ID | 标题 | 状态 | 优先级 | 备注 |
|---|---|---|---|---|
${body}`

test('backlog audit: a doing row in §2 is rejected', () => {
  const result = auditBacklog(skeleton('| BUG-9 | stop | doing | P1 | leftover |\n'))
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /BUG-9: status 'doing' does not belong in §2/)
})

test('backlog audit: a long note is rejected', () => {
  const note = 'x'.repeat(221)
  const result = auditBacklog(skeleton(`| REQ-I1 | tab | todo | P2 | ${note} |\n`))
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /REQ-I1: note 221 chars/)
})

test('backlog audit: §2 must stay P0→P3', () => {
  const result = auditBacklog(skeleton(
    '| REQ-A4 | fwd | todo | P3 | pointer |\n| BUG-7 | cas | todo | P2 | unify version |\n',
  ))
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /BUG-7: §2 must stay ordered P0→P3/)
})

test('backlog audit: a well-formed todo row passes', () => {
  const result = auditBacklog(skeleton('| BUG-8 | tar | todo | P2 | find the stderr drop |\n'))
  assert.equal(result.ok, true)
  assert.equal(result.rows, 1)
})
