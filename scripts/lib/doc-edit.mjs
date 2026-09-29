/**
 * Asserting document-edit helpers (INFRA-21).
 *
 * Bare `String.replace` silently no-ops when the needle is absent, and a
 * mismatched multi-line template in an ad-hoc `node -e` edit looks exactly
 * like success — three rounds (R41–R43) lost or misplaced backlog edits that
 * way before anyone noticed. Every scripted edit to a repo document goes
 * through these helpers instead: not-found and not-unique needles THROW, and
 * the caller is expected to `mustInclude` the result before writing.
 *
 * Usage (ad-hoc round scripts):
 *   import { replaceOrThrow, mustInclude } from './scripts/lib/doc-edit.mjs'
 *   const next = replaceOrThrow(content, oldRow, newRow, 'move UPSTREAM-10 to §4')
 *   mustInclude(next, '| UPSTREAM-10 | 0.2.0 家族对齐 | done', 'row landed')
 *   writeFileSync(file, next)
 * @module scripts/lib/doc-edit
 */

/**
 * Replace exactly one occurrence of `find` with `replace`, or throw.
 * @param content - the document being edited.
 * @param find - the exact text to replace (must occur exactly once).
 * @param replace - the replacement text.
 * @param label - human-readable edit name for the error message.
 * @returns the edited content.
 */
export function replaceOrThrow(content, find, replace, label = 'edit') {
  const count = content.split(find).length - 1
  if (count === 0) {
    throw new Error(`replaceOrThrow(${label}): needle not found — the document does not match the expectation (first 90 chars: ${JSON.stringify(String(find).slice(0, 90))})`)
  }
  if (count > 1) {
    throw new Error(`replaceOrThrow(${label}): needle not unique (${count} occurrences) — narrow it (first 90 chars: ${JSON.stringify(String(find).slice(0, 90))})`)
  }
  const next = content.replace(find, replace)
  if (next === content) {
    throw new Error(`replaceOrThrow(${label}): replacement produced no change (identical needle/replacement is still an edit that did nothing)`)
  }
  return next
}

/**
 * Assert `content` contains `needle`, or throw. Call this on the EDITED
 * content before writing — the belt to replaceOrThrow's suspenders.
 * @param content - the edited document.
 * @param needle - text that must be present after the edit.
 * @param label - human-readable assertion name for the error message.
 */
export function mustInclude(content, needle, label = 'assertion') {
  if (!content.includes(needle)) {
    throw new Error(`mustInclude(${label}): expected text missing — ${JSON.stringify(String(needle).slice(0, 90))}`)
  }
}
