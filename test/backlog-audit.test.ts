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
| ID | 标题 | 状态 | 优先级 | 提出 | 备注 |
|---|---|---|---|---|---|
${body}`

test('backlog audit: a doing row in §2 is rejected', () => {
  const result = auditBacklog(skeleton('| BUG-9 | stop | doing | P1 | 2026-09-08 | leftover |\n'))
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /BUG-9: status 'doing' does not belong in §2/)
})

test('backlog audit: a long note is rejected', () => {
  const note = 'x'.repeat(221)
  const result = auditBacklog(skeleton(`| REQ-I1 | tab | todo | P2 | 2026-09-08 | ${note} |\n`))
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /REQ-I1: note 221 chars/)
})

test('backlog audit: §2 must stay P0→P3', () => {
  const result = auditBacklog(skeleton(
    '| REQ-A4 | fwd | todo | P3 | 2026-09-08 | pointer |\n| BUG-7 | cas | todo | P2 | 2026-09-08 | unify version |\n',
  ))
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /BUG-7: §2 must stay ordered P0→P3/)
})

test('backlog audit: a well-formed todo row passes', () => {
  const result = auditBacklog(skeleton('| BUG-8 | tar | todo | P2 | 2026-09-08 | find the stderr drop |\n'))
  assert.equal(result.ok, true)
  assert.equal(result.rows, 1)
})

// INFRA-22: markdown tables stop at the first blank line — a blank row inside
// a table splits it and every later row renders as loose text. The row parser
// skips blank lines, so this regression class needs its own layout rule.
test('backlog audit: a blank line inside a table is rejected', () => {
  const result = auditBacklog(skeleton(
    '| REQ-I14 | warmup | todo | P2 | 2026-09-08 | after connect |\n\n| REQ-I17 | gate | todo | P2 | 2026-09-08 | fail closed |\n',
  ))
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /second, separate block/)
})

test('backlog audit: consecutive blank lines are rejected', () => {
  const result = auditBacklog('# Backlog\n\n\n## 1. doing\n')
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /consecutive blank lines/)
})

test('backlog audit: one blank line between sections is fine', () => {
  const result = auditBacklog(skeleton('| BUG-8 | tar | todo | P2 | 2026-09-08 | ok |\n'))
  assert.equal(result.ok, true)
})

const doneTable = (body) => `# Backlog
## 4. done
| ID | 标题 | 状态 | 优先级 | 完成 | 备注 |
|---|---|---|---|---|---|
${body}`

test('backlog audit: a done row needs a YYYY-MM-DD completion date', () => {
  const missing = auditBacklog(doneTable('| PUB-1 | release | shipped | P1 | tag |\n'))
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join('\n'), /PUB-1: §4 expected 6 columns/)
  const bad = auditBacklog(doneTable('| PUB-1 | release | shipped | P1 | soon | tag |\n'))
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join('\n'), /PUB-1: §4 done date must be YYYY-MM-DD/)
  const ok = auditBacklog(doneTable('| PUB-1 | release | shipped | P1 | 2026-09-13 | tag |\n'))
  assert.equal(ok.ok, true)
})

test('backlog audit: a todo row needs a YYYY-MM-DD proposed date', () => {
  const missing = auditBacklog(skeleton('| BUG-8 | tar | todo | P2 | find it |\n'))
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join('\n'), /BUG-8: §2 expected 6 columns/)
  const bad = auditBacklog(skeleton('| BUG-8 | tar | todo | P2 | soon | find it |\n'))
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join('\n'), /BUG-8: §2 proposed date must be YYYY-MM-DD/)
})
