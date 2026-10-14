/**
 * INFRA-24: the decision queue in docs/decisions/queue.md.
 *
 * Open rows carry a recommendation, a cost, and either `irreversible` or
 * `reversible-until: YYYY-MM-DD` (inclusive). A reversible row whose date is
 * before today fails the static gate so someone executes the recommendation
 * into ## 留痕 or extends the date. This module does not change product code.
 */

const ROW_ID = /^[A-Z][A-Z]*-[A-Za-z0-9]+$/
const DEADLINE = /^reversible-until: (\d{4}-\d{2}-\d{2})$/

/**
 * @param {string} markdown
 * @param {string} [today] ISO date `YYYY-MM-DD` (defaults to UTC today).
 * @returns {string[]}
 */
export function auditDecisionQueue(markdown, today = new Date().toISOString().slice(0, 10)) {
  const errors = []
  const start = markdown.indexOf('## 开放')
  if (start < 0) {
    errors.push('docs/decisions/queue.md: missing ## 开放')
    return errors
  }
  const rest = markdown.slice(start)
  const next = rest.indexOf('\n## ', 1)
  const section = next < 0 ? rest : rest.slice(0, next)
  const lines = section.split('\n').filter(line => line.startsWith('|'))
  const rows = lines.filter(line => !/^\|\s*-+/.test(line) && !/\|\s*ID\s*\|/.test(line))
  if (rows.length === 0) errors.push('decision queue: open table is empty')
  for (const line of rows) {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (cells.length < 4) {
      errors.push(`decision queue: row needs 4 cells (${line.trim()})`)
      continue
    }
    const [id, recommendation, cost, deadline] = cells
    if (!ROW_ID.test(id)) errors.push(`decision queue: bad id ${id}`)
    if (recommendation === '') errors.push(`${id}: recommendation is empty`)
    if (cost === '') errors.push(`${id}: cost is empty`)
    if (deadline === 'irreversible') continue
    const match = DEADLINE.exec(deadline)
    if (match === null) {
      errors.push(`${id}: deadline must be irreversible or reversible-until: YYYY-MM-DD`)
      continue
    }
    if (today > match[1]) {
      errors.push(`${id}: reversible deadline ${match[1]} has passed — execute the recommendation into ## 留痕 or extend the date`)
    }
  }
  if (!markdown.includes('## 留痕')) errors.push('docs/decisions/queue.md: missing ## 留痕')
  return errors
}
