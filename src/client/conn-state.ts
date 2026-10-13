/**
 * The connection-state vocabulary and its host-token colors, split from
 * `status.tsx` so the DOM-badge layer (`row-badges.ts`) and the tests can
 * read them WITHOUT loading a `.tsx` view — the sandbox test lane cannot
 * transform JSX (UX-4 regression: a dynamic import of the view module made
 * `test:agent` fail while the tsx-loader lanes stayed green).
 *
 * @module dsh-workspace-enhancement/client/conn-state
 */

/** The tri-state a remote connection resolves to. */
export type ConnState = 'unknown' | 'active' | 'offline'

/**
 * Dot colors for the DOM row-badge layer (`row-badges.ts` /
 * `remote-status-entry.tsx`), which injects into host DOM nodes and therefore
 * cannot address a CSS module class. UX-4: the values are var() references to
 * the SAME host semantic tokens the React badge resolves through
 * `status.module.css` (`--dsw-alias-state-success-primary` green,
 * `--dsw-alias-state-error-primary` red, `--dsw-alias-label-caption` gray) —
 * var() resolves in inline styles too, so both surfaces follow the host
 * theme with no hex left to drift.
 */
export const CONN_STATE_COLOR: Record<ConnState, string> = {
  unknown: 'var(--dsw-alias-label-caption)',
  active: 'var(--dsw-alias-state-success-primary)',
  offline: 'var(--dsw-alias-state-error-primary)',
}
