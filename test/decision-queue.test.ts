import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { auditDecisionQueue } from '../scripts/lib/decision-queue.mjs'

const SAMPLE = `# queue

## 开放

| ID | 推荐 | 代价 | 期限 |
|---|---|---|---|
| UX-8 | do A | small | reversible-until: 2026-10-28 |
| INFRA-8 | owner writes it | red line | irreversible |

## 留痕
`

test('auditDecisionQueue: future reversible and irreversible pass', () => {
  assert.deepEqual(auditDecisionQueue(SAMPLE, '2026-10-14'), [])
  assert.deepEqual(auditDecisionQueue(SAMPLE, '2026-10-28'), [])
})

test('auditDecisionQueue: a passed reversible deadline fails', () => {
  const errors = auditDecisionQueue(SAMPLE, '2026-10-29')
  assert.equal(errors.length, 1)
  assert.match(errors[0] ?? '', /UX-8: reversible deadline 2026-10-28 has passed/)
})

test('auditDecisionQueue: a missing marker fails', () => {
  const broken = SAMPLE.replace('reversible-until: 2026-10-28', 'soon')
  const errors = auditDecisionQueue(broken, '2026-10-14')
  assert.match(errors.join('\n'), /deadline must be irreversible or reversible-until/)
})

test('the committed queue is inside its deadlines today', () => {
  const markdown = readFileSync(new URL('../docs/decisions/queue.md', import.meta.url), 'utf8')
  assert.deepEqual(auditDecisionQueue(markdown, '2026-10-14'), [])
})
