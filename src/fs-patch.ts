/**
 * Text-patch application for the 0.2.2 filesystem seam (`patchText` / `moveFile`).
 *
 * The host applies hunks with `@deepseek-ai/dsh-fs-patch` `applyHunks` (Codex
 * NormalizeToLf: original-text search, whitespace and punctuation passes, EOF
 * tail match, successful text ending in LF). That package is not in the peer
 * union — it does not exist on the 0.1.7 / 0.2.0 / 0.2.1 families — so the
 * same contract lives here and the drift job compares it to the real package
 * when that package is installed.
 *
 * @module dsh-workspace-enhancement/fs-patch
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsErrorCode, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'

/**
 * Exclusive UTF-8 byte cap for a contextual before/after basis.
 * Matches the local backend default (`plugin.ts` `LOCAL_FS_CONFIG`).
 */
export const DIFF_BASIS_MAX_BYTES = 10 * 1024 * 1024

/** One parsed hunk. Field names match `@deepseek-ai/dsh-fs-patch` `PatchHunk`. */
export interface PatchHunk {
  /** One-based input line of the marker or the first implicit hunk line. */
  lineNumber: number
  /** Text after `@@ `, used as a search anchor. */
  context?: string
  /** Context and removed lines, without prefixes or line endings. */
  oldLines: readonly string[]
  /** Context and added lines, without prefixes or line endings. */
  newLines: readonly string[]
  /** Whether `*** End of File` follows this hunk. */
  isEndOfFile: boolean
}

/** Guards for {@link FileSystem.moveFile}. An omitted guard is unconditional. */
export interface FsMoveOptions {
  hunks?: readonly PatchHunk[]
  expectedSource?: { version: FsVersionBrand }
  expectedDestination?: FsWriteIntent
}

/**
 * `FsVersion` is a branded string. Naming it here avoids a value import cycle
 * with the filesystem engine while staying assignable to the host brand.
 */
type FsVersionBrand = FsWriteOutcome['version']

/** Outcome of a guarded delete. `before` is null when no bounded basis exists. */
export interface FsDeleteResult {
  before: string | null
}

/** Published destination plus whether the source was removed. */
export type FsMoveResult = {
  sourceBefore: string | null
  destination: FsWriteOutcome
  sourceDeleted: true
} | {
  sourceBefore: string | null
  destination: FsWriteOutcome
  sourceDeleted: false
  sourceFailure: { code: FsErrorCode; message: string }
}

export interface HunkApplyFailure {
  hunkLineNumber: number
  stage: 'context' | 'oldLines'
  searchStart: number
  pattern: string[]
}

export type ApplyHunksResult = {
  ok: true
  after: string
} | {
  ok: false
  failure: HunkApplyFailure
}

const WHITE_SPACE = /\p{White_Space}/u

function trimWhitespace(value: string, leading: boolean): string {
  let start = 0
  let end = value.length
  if (leading) {
    while (start < end && WHITE_SPACE.test(value.charAt(start))) start += 1
  }
  while (end > start && WHITE_SPACE.test(value.charAt(end - 1))) end -= 1
  return value.slice(start, end)
}

function normalizePunctuation(value: string): string {
  return trimWhitespace(value, true)
    .replace(/[\u2010-\u2015\u2212]/gu, '-')
    .replace(/[\u2018-\u201B]/gu, '\'')
    .replace(/[\u201C-\u201F]/gu, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/gu, ' ')
}

const MATCH_PASSES: readonly ((value: string) => string)[] = [
  value => value,
  value => trimWhitespace(value, false),
  value => trimWhitespace(value, true),
  normalizePunctuation,
]

/**
 * Locate `pattern` in `lines` at or after `start`. An EOF search tries only
 * the tail candidate. Empty patterns match at `start`.
 */
function seekSequence(lines: readonly string[], pattern: readonly string[], start: number, eof: boolean): number | undefined {
  if (pattern.length === 0) return start
  if (pattern.length > lines.length) return undefined
  const last = lines.length - pattern.length
  const first = eof ? last : start
  for (const normalize of MATCH_PASSES) {
    const expected = pattern.map(normalize)
    for (let index = first; index <= last; index += 1) {
      const matched = expected.every((line, offset) => normalize(lines[index + offset] ?? '') === line)
      if (matched) return index
    }
  }
  return undefined
}

/**
 * Apply ordered hunks to LF-normalized text. Searches read the original text;
 * a failed search returns no partial update. Successful nonempty output ends
 * in LF, including text that did not.
 */
export function applyHunks(before: string, hunks: readonly PatchHunk[]): ApplyHunksResult {
  const original = before.split('\n')
  if (original.at(-1) === '') original.pop()
  const replacements: { start: number; oldLength: number; newLines: readonly string[] }[] = []
  let lineIndex = 0
  for (const hunk of hunks) {
    if (hunk.context !== undefined) {
      const pattern = [hunk.context]
      const found = seekSequence(original, pattern, lineIndex, false)
      if (found === undefined) {
        return {
          ok: false,
          failure: { hunkLineNumber: hunk.lineNumber, stage: 'context', searchStart: lineIndex, pattern },
        }
      }
      lineIndex = found + 1
    }
    if (hunk.oldLines.length === 0) {
      const start = original.at(-1) === '' ? original.length - 1 : original.length
      replacements.push({ start, oldLength: 0, newLines: hunk.newLines })
      continue
    }
    let pattern = hunk.oldLines
    let newLines = hunk.newLines
    let found = seekSequence(original, pattern, lineIndex, hunk.isEndOfFile)
    if (found === undefined && pattern.at(-1) === '') {
      pattern = pattern.slice(0, -1)
      if (newLines.at(-1) === '') newLines = newLines.slice(0, -1)
      found = seekSequence(original, pattern, lineIndex, hunk.isEndOfFile)
    }
    if (found === undefined) {
      return {
        ok: false,
        failure: {
          hunkLineNumber: hunk.lineNumber,
          stage: 'oldLines',
          searchStart: lineIndex,
          pattern: [...hunk.oldLines],
        },
      }
    }
    replacements.push({ start: found, oldLength: pattern.length, newLines })
    lineIndex = found + pattern.length
  }
  replacements.sort((left, right) => left.start - right.start)
  let lines = original
  for (const replacement of replacements.reverse()) {
    lines = [
      ...lines.slice(0, replacement.start),
      ...replacement.newLines,
      ...lines.slice(replacement.start + replacement.oldLength),
    ]
  }
  if (lines.at(-1) !== '') lines.push('')
  return { ok: true, after: lines.join('\n') }
}

/**
 * `FS_PATCH_MISMATCH` and `FS_SAME_TARGET` joined the error union on the 0.2.2
 * seam. Older families type `FsError`'s code as the previous union, so the
 * string is passed through a cast. The runtime class stores it either way.
 */
export function seamFsError(message: string, code: string, options?: ErrorOptions): FsError {
  return new FsError(message, code as never, options)
}
