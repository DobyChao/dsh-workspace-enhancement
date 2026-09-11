#!/usr/bin/env node
/**
 * scripts/slot-catalog.mjs — read-only inspector for the upstream Client Slot
 * Catalog, and the reproducible evidence tool behind `docs/decisions/ADR-0017`.
 *
 * WHY THIS EXISTS
 * The upstream `CLIENT_SLOT_API` / `SERVICE_API` tables are a GENERATED artifact
 * (the bundle header says "do not edit by hand"), and the only trustworthy way
 * to read a slot's contract is to read the shipped bundle. `cordis_inspect_*`
 * is forbidden in this repository (it hangs when the page does not answer — see
 * `AGENTS.md` §5.7), so the disk equivalent is the published package's
 * `lib/client.js`. This script turns that bundle into a diffable catalog, so a
 * future clone can re-derive "52 -> 61 / ADDED 12 / REMOVED 3" instead of
 * rewriting the parser.
 *
 *   node scripts/slot-catalog.mjs --list <bundle.js> [filter]
 *   node scripts/slot-catalog.mjs --key  <slot-key> <bundle.js>
 *   node scripts/slot-catalog.mjs --diff <old-bundle.js> <new-bundle.js> [--all-fields]
 *
 * `--list` and `--key` also read the companion `SERVICE_API` table (the client
 * service catalog) when the bundle carries one; `--diff` compares one catalog —
 * the first both bundles share, which is `CLIENT_SLOT_API` in practice.
 *
 * INPUT
 * An ALREADY-EXTRACTED runner bundle path, normally
 * `@deepseek-ai/dsh-cordis-client-runner/lib/client.js` from
 * `npm pack @deepseek-ai/dsh-cordis-client-runner@<version>`. This script does
 * NOT pack, does NOT touch the network, and writes NOTHING: the same two files
 * always yield the same verdict. It also does not depend on anything under the
 * untracked `.tmp/` directory that the original recon scripts lived in.
 *
 * PARSER CONTRACT (re-verify on every upstream bump)
 *  1. Locate `const <CONST> = [` and bracket-match to its closing `]`, then
 *     evaluate the literal with `new Function`. The matched range must evaluate
 *     to an array of objects carrying a string `key` — otherwise the generated
 *     shape changed and this parser must be reviewed by hand. Both
 *     `CLIENT_SLOT_API` and `SERVICE_API` bind by `const`, so reassignments
 *     later in the bundle cannot fool the anchor.
 *  2. Slot entries are read by FIELD NAME, never by indentation or line offset,
 *     so reformatting upstream cannot silently change the verdict. Line
 *     numbers are only reported as locator anchors.
 *
 * CAVEAT: the cited `(line N)` anchors belong to the bundle they were read
 * from. Never mix anchors from two versions (see `ADR-0017` §1.1).
 */
import { readFileSync } from 'node:fs'

/** Declarations this script understands, in probe order. */
const CATALOGS = ['CLIENT_SLOT_API', 'SERVICE_API']

/**
 * Contract fields compared by `--diff`.
 *
 * `CONTRACT_FIELDS` are the behavioural facts: a change in any of them is real
 * drift. `PROSE_FIELDS` are documentation and upstream source locations, which
 * move on almost every bump without changing the contract.
 */
const CONTRACT_FIELDS = [
  'kind', 'scope', 'registerOptions', 'ownerProps', 'declaredBy',
  'occupants', 'replaceRisk', 'example', 'keyDomain', 'slotInject', 'hookContext',
]
const PROSE_FIELDS = ['summary', 'doc', 'standardProps', 'ownerPropsReferences', 'source']

/** Fields `--key` renders, in the order the upstream entry declares them. */
const DUMP_FIELDS = [
  'kind', 'scope', 'summary', 'doc', 'registerOptions', 'ownerProps',
  'ownerPropsReferences', 'standardProps', 'keyDomain', 'hookContext',
  'slotInject', 'declaredBy', 'occupants', 'replaceRisk', 'example', 'source',
]

/** One-line usage block, kept ASCII-only. */
const USAGE = [
  'usage:',
  '  node scripts/slot-catalog.mjs --list <bundle.js> [filter-regex]',
  '  node scripts/slot-catalog.mjs --key  <slot-key> <bundle.js>',
  '  node scripts/slot-catalog.mjs --diff <old-bundle.js> <new-bundle.js> [--all-fields]',
  '',
  '  --list          one line per slot: key | kind | scope | summary',
  '  --key           dump one slot\'s full contract',
  '  --diff          ADDED / REMOVED / DRIFTED between two bundles',
  '  --all-fields    compare prose + source anchors too (noisy across bumps)',
].join('\n')

function die(message) {
  console.error(`[slots] FAIL — ${message}`)
  console.error(USAGE)
  process.exit(2)
}

/**
 * Extract a `const <name> = [ ... ]` array literal and evaluate it.
 * @param source - the whole bundle text.
 * @param name - the binding to find.
 * @returns the evaluated array, or `undefined` when the binding is absent.
 */
function readLiteral(source, name) {
  const marker = `const ${name} = [`
  const start = source.indexOf(marker)
  if (start === -1) return undefined
  const open = source.indexOf('[', start)
  let depth = 0
  let end = -1
  let quote = null
  let escaped = false
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) die(`unbalanced brackets after "const ${name} ="`)
  const literal = source.slice(open, end + 1)
  let value
  try {
    // eslint-disable-next-line no-new-func
    value = new Function(`return ${literal}`)()
  } catch (error) {
    die(`cannot evaluate "const ${name}" — the generated shape changed: ${error.message}`)
  }
  if (!Array.isArray(value)) die(`"const ${name}" did not evaluate to an array`)
  return value
}

/**
 * Read one bundle into `{ catalog }: Map<key, entry>` plus locator anchors.
 * @param path - bundle path (read-only).
 * @returns `{ path, source, byName, keys, lines }`.
 */
function readBundle(path) {
  let source
  try {
    source = readFileSync(path, 'utf-8')
  } catch (error) {
    die(`cannot read bundle "${path}": ${error.message}`)
  }
  const byName = new Map()
  for (const name of CATALOGS) {
    const entries = readLiteral(source, name)
    if (entries === undefined) continue
    const bad = entries.findIndex(entry => typeof entry?.key !== 'string')
    if (bad !== -1) die(`"${name}" entry #${bad} has no string "key"`)
    byName.set(name, entries)
  }
  if (byName.size === 0) {
    die(`no ${CATALOGS.join(' / ')} array found in "${path}" — is this a cordis-client-runner bundle?`)
  }
  // Locator anchors: the 1-based line of each `key: "..."` inside the literal.
  const lines = new Map()
  const rows = source.split(/\r?\n/)
  for (let i = 0; i < rows.length; i += 1) {
    const match = rows[i].match(/^\s+key:\s+"([^"]+)",\s*$/)
    if (match && !lines.has(match[1])) lines.set(match[1], i + 1)
  }
  // Report POSIX separators so output is identical on Windows and Linux (the
  // repo's other scripts normalize the same way).
  return { path: path.replaceAll('\\', '/'), byName, lines }
}

const normalize = (value) => JSON.stringify(value ?? null)

/** Render a JSON-ish value the way the upstream literal writes it. */
function show(value) {
  if (value === undefined || value === null) return '(absent)'
  if (typeof value === 'string') return value === '' ? '""' : value
  return JSON.stringify(value)
}

function modeList(bundle, filter) {
  const pattern = filter === undefined ? null : new RegExp(filter, 'i')
  let total = 0
  console.log(`snapshot: ${bundle.path}  — every "(line N)" below anchors to THIS file only`)
  for (const [name, rows] of bundle.byName) {
    const shown = rows.filter(entry => pattern === null || pattern.test(entry.key))
    if (bundle.byName.size > 1) console.log(`# ${name} (${shown.length} of ${rows.length})`)
    for (const entry of shown) {
      const line = bundle.lines.get(entry.key)
      console.log([
        entry.key.padEnd(46),
        String(entry.kind ?? '').padEnd(7),
        String(entry.scope ?? '').padEnd(15),
        String(entry.summary ?? ''),
        line === undefined ? '' : `(line ${line})`,
      ].join(' ').trimEnd())
    }
    if (bundle.byName.size > 1) console.log('')
    total += shown.length
  }
  console.log(`[slots] ${total} entry(ies) shown across ${bundle.byName.size} catalog(s) in ${bundle.path}`)
  return 0
}

function modeKey(bundle, key) {
  let hit = null
  for (const [name, rows] of bundle.byName) {
    const entry = rows.find(candidate => candidate.key === key)
    if (entry !== undefined) { hit = { name, entry }; break }
  }
  if (hit === null) {
    console.error(`[slots] FAIL — "${key}" is not in ${bundle.path}`)
    return 1
  }
  const { name, entry } = hit
  const line = bundle.lines.get(key)
  console.log(`########## ${key}${line === undefined ? '' : ` (line ${line})`} ##########`)
  console.log(`catalog: ${name}`)
  console.log(`snapshot: ${bundle.path}  — the (line N) above anchors to THIS file only`)
  console.log(`key: ${show(entry.key)}`)
  for (const field of DUMP_FIELDS) {
    if (!(field in entry)) continue
    console.log(`${field}: ${show(entry[field])}`)
  }
  // `SERVICE_API` entries carry a different shape from slot entries.
  if (Array.isArray(entry.methods)) {
    console.log(`methods (${entry.methods.length}):`)
    for (const method of entry.methods) {
      console.log(`  - ${method.signature}`)
      if (method.description) console.log(`      ${method.description.replace(/\s+/g, ' ')}`)
    }
  }
  const known = new Set(['key', ...DUMP_FIELDS, 'methods'])
  const unknown = Object.keys(entry).filter(field => !known.has(field))
  if (unknown.length > 0) console.log(`# unknown fields present upstream: ${unknown.join(', ')}`)
  console.log(`source bundle: ${bundle.path}`)
  return 0
}

function modeDiff(oldBundle, newBundle, allFields) {
  const name = CATALOGS.find(candidate => oldBundle.byName.has(candidate) && newBundle.byName.has(candidate))
  if (name === undefined) {
    die(`no catalog present in both bundles (old: ${[...oldBundle.byName.keys()].join(', ')}; new: ${[...newBundle.byName.keys()].join(', ')})`)
  }
  const fields = allFields ? [...CONTRACT_FIELDS, ...PROSE_FIELDS] : CONTRACT_FIELDS
  const oldRows = oldBundle.byName.get(name)
  const newRows = newBundle.byName.get(name)
  const oldByKey = new Map(oldRows.map(entry => [entry.key, entry]))
  const newByKey = new Map(newRows.map(entry => [entry.key, entry]))

  const added = [...newByKey.keys()].filter(key => !oldByKey.has(key)).sort()
  const removed = [...oldByKey.keys()].filter(key => !newByKey.has(key)).sort()
  const common = [...newByKey.keys()].filter(key => oldByKey.has(key))
  const drifted = []
  for (const key of common) {
    const before = oldByKey.get(key)
    const after = newByKey.get(key)
    const changed = fields.filter(field => normalize(before[field]) !== normalize(after[field]))
    if (changed.length > 0) drifted.push({ key, changed })
  }

  console.log(`[slots] catalog: ${name}`)
  console.log(`[slots] OLD snapshot: ${oldBundle.path} (${oldRows.length} entries)`)
  console.log(`[slots] NEW snapshot: ${newBundle.path} (${newRows.length} entries)`)
  console.log(`[slots] compared fields: ${fields.join(', ')}${allFields ? '' : ' (behavioural; add --all-fields for prose)'}`)
  console.log('[slots] anchors below are tagged OLD/NEW on purpose: the two bundles are different snapshots,')
  console.log('[slots] so their line numbers are NOT interchangeable (see ADR-0017 §1.1).')
  console.log('')
  console.log(`ADDED (${added.length})  [line N anchors to NEW snapshot]:`)
  for (const key of added) console.log(`  + ${key}  (line ${newBundle.lines.get(key) ?? '?'})`)
  console.log(`REMOVED (${removed.length})  [line N anchors to OLD snapshot]:`)
  for (const key of removed) console.log(`  - ${key}  (line ${oldBundle.lines.get(key) ?? '?'})`)
  console.log(`DRIFTED (${drifted.length})  [no anchors: compare by field name, not by line]:`)
  for (const item of drifted) console.log(`  ~ ${item.key}  [${item.changed.join(', ')}]`)
  console.log(`UNCHANGED (${common.length - drifted.length}) of ${common.length} common keys`)
  console.log('')
  console.log(`[slots] ${oldRows.length} -> ${newRows.length} slots; added ${added.length}, removed ${removed.length}, drifted ${drifted.length}`)
  return 0
}

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const positional = argv.filter(arg => !arg.startsWith('--'))
const allFields = flag('--all-fields')
const modes = ['--list', '--key', '--diff'].filter(mode => flag(mode))

if (flag('--help') || argv.length === 0) {
  console.log(USAGE)
  process.exit(0)
}
if (modes.length !== 1) die(`exactly one of --list / --key / --diff is required (got ${modes.length})`)

const [first, second, third] = positional

if (modes[0] === '--list') {
  if (first === undefined) die('--list needs a bundle path')
  process.exit(modeList(readBundle(first), second))
}

if (modes[0] === '--key') {
  if (first === undefined || second === undefined) die('--key needs <slot-key> <bundle.js>')
  process.exit(modeKey(readBundle(second), first))
}

if (third !== undefined) die(`--diff takes two bundle paths (got "${first}", "${second}", "${third}")`)
if (first === undefined || second === undefined) die('--diff needs <old-bundle.js> <new-bundle.js>')
process.exit(modeDiff(readBundle(first), readBundle(second), allFields))
