/**
 * scripts/lib/dict-audit.mjs — locale dictionary audit, printed as JSON.
 *
 * Loaded by `scripts/check.mjs` through Node's built-in TypeScript transform
 * (`--experimental-transform-types`), so the static gate needs no tsx/esbuild
 * and therefore runs inside the agent sandbox as well as in CI.
 *
 * Reports: key counts, keys present in only one language, duplicate keys, and
 * `{name}` template-parameter mismatches between zh and en.
 */
import { zh, en } from '../../src/locale/index.ts'

const zk = Object.keys(zh)
const ek = Object.keys(en)
const onlyZh = zk.filter(key => !(key in en))
const onlyEn = ek.filter(key => !(key in zh))
const duplicates = zk.filter((key, index) => zk.indexOf(key) !== index)
const params = value => [...new Set((value ?? '').match(/\{(\w+)\}/g) ?? [])].sort().join(' ')
const templateMismatch = zk.filter(key => params(zh[key]) !== params(en[key]))

console.log(JSON.stringify({
  zh: zk.length,
  en: ek.length,
  onlyZh,
  onlyEn,
  duplicates,
  templateMismatch,
}))
