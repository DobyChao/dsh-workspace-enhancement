/**
 * CSS Modules loader hooks for the unit-test run (see ./css-stub.mjs).
 *
 * A CSS Module import is stubbed with a Proxy that returns the property name
 * for any class lookup — so `styles.input` yields `'input'` and assertions can
 * match on readable, stable class names instead of hashed ones.
 *
 * @module scripts/css-stub-hooks
 */

/** @param {string} specifier @param {{ parentURL?: string }} context @param {Function} nextResolve */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) {
    return {
      url: new URL(specifier, context.parentURL).href,
      format: 'module',
      shortCircuit: true,
    }
  }
  return nextResolve(specifier, context)
}

/** @param {string} url @param {object} context @param {Function} nextLoad */
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      source: 'export default new Proxy({}, { get: (_target, key) => key });',
      shortCircuit: true,
    }
  }
  return nextLoad(url, context)
}
