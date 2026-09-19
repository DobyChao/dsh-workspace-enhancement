/**
 * Shared parser / layout auditor for docs/backlog.md.
 *
 * Agents follow this by running `npm run check:static` — do not invent a
 * second copy of the section↔status rules. The human-facing text lives in
 * the backlog file header and AGENTS.md §2.
 */

const SECTION_HEADING = /^## (\d+)\./
const ROW_ID = /^\|\s*`?([A-Z][A-Z]*(?:-[A-Za-z0-9]+)+)\s*\|/

/** Status values allowed in each numbered section. */
export const SECTION_STATUSES = {
  1: ['doing'],
  2: ['todo'],
  3: ['blocked'],
  4: ['done', 'shipped'],
  5: ['dropped'],
  6: ['blocked', 'todo'],
}

/** Visible-note ceiling (markdown links count as their label). */
export const NOTE_MAX = {
  1: 220,
  2: 220,
  3: 220,
  4: 160,
  5: 120,
  6: 140,
}

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 }

/**
 * Strip link targets and emphasis so the length cap measures what a reader sees.
 * @param {string} note
 * @returns {string}
 */
export function visibleNote(note) {
  return note
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/\*\*/g, '')
    .trim()
}

/**
 * @param {string} markdown
 * @returns {{ rows: Array<{ id: string, title: string, status: string, priority: string, note: string, section: number }>, errors: string[] }}
 */
export function parseBacklog(markdown) {
  let section = 0
  const rows = []
  const errors = []
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(SECTION_HEADING)
    if (heading) {
      section = Number(heading[1])
      continue
    }
    if (!ROW_ID.test(line)) continue
    const parts = line.split(/(?<!\\)\|/)
    const cells = parts.slice(1, -1).map(cell => cell.trim())
    if (cells.length !== 5) {
      errors.push(`${cells[0] ?? '?'}: expected 5 columns, got ${cells.length}`)
      continue
    }
    const [id, title, status, priority, note] = cells
    rows.push({ id, title, status, priority, note, section })
  }
  return { rows, errors }
}

/**
 * @param {string} markdown
 * @returns {{ ok: boolean, rows: number, errors: string[] }}
 */
export function auditBacklog(markdown) {
  const { rows, errors } = parseBacklog(markdown)
  const seen = new Set()
  let lastTodoRank = -1
  for (const row of rows) {
    if (seen.has(row.id)) errors.push(`${row.id}: duplicate id`)
    seen.add(row.id)
    const allowed = SECTION_STATUSES[row.section]
    if (allowed === undefined) {
      errors.push(`${row.id}: row sits outside §1–§6`)
    } else if (!allowed.includes(row.status)) {
      errors.push(`${row.id}: status '${row.status}' does not belong in §${row.section} (${allowed.join('|')})`)
    }
    const max = NOTE_MAX[row.section] ?? 160
    const length = [...visibleNote(row.note)].length
    if (length > max) errors.push(`${row.id}: note ${length} chars > ${max} (remaining action + pointer only)`)
    if (row.section === 2) {
      const rank = PRIORITY_RANK[row.priority]
      if (rank === undefined) {
        errors.push(`${row.id}: priority '${row.priority}' must be P0–P3`)
      } else if (rank < lastTodoRank) {
        errors.push(`${row.id}: §2 must stay ordered P0→P3 (found ${row.priority} after a lower-urgency row)`)
      } else {
        lastTodoRank = rank
      }
    }
  }
  return { ok: errors.length === 0, rows: rows.length, errors }
}
