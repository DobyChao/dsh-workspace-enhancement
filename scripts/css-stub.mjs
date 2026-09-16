/**
 * Test-run CSS stub: makes `import styles from './x.module.css'` resolvable
 * under plain `node --test`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Client components legitimately import CSS Modules (that is how the plugin
 * gets the host's `--dsw-*` design tokens). The bundle build resolves those
 * through tsdown + lightningcss, but `node --import tsx --test` does not know
 * the `.css` extension at all and dies with
 * `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".css"` the moment a
 * unit test reaches a component module.
 *
 * Registering this hook AFTER tsx puts it first in the loader chain (ESM
 * hooks run newest-first), so `.css` is answered here while `.ts` / `.tsx`
 * fall through to tsx untouched.
 *
 * IMPORTANT: registering this file does NOT affect the shipped bundle — it is
 * loaded only by the `test` / `test:coverage` scripts.
 *
 * @module scripts/css-stub
 */

import { register } from 'node:module'

register(new URL('./css-stub-hooks.mjs', import.meta.url))
