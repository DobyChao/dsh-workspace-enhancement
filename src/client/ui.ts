/**
 * Shared UI utilities for the dsh-workspace-enhancement client: a class-name joiner and the
 * dialog behavior every modal reuses — a document-level close stack (Esc
 * dismisses the topmost dialog only, unless the directory path field is
 * consuming it), a Tab focus trap, initial focus, and focus restoration.
 * No external focus-management dependency.
 */

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** Join truthy class-name fragments; false/null/undefined drop out. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Live dialog closers; only the top entry reacts to Esc and Tab. */
const stack: Array<() => void> = []

/**
 * Attribute on the directory-picker path field (UX-14). Escape reverts that
 * draft and leaves the picker open; it must not dismiss the dialog.
 * The field in `flow.tsx` sets this same attribute.
 */
export const PATH_EDIT_ATTR = 'data-dsw-path-edit' as const

/** Props for the path field. Spread onto the input so the attribute cannot drift. */
export function pathEditMarker(): { 'data-dsw-path-edit': '' } {
  return { [PATH_EDIT_ATTR]: '' }
}

/** True when `target` is the path field that handles Escape locally. */
export function isPathEditEscapeTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  const read = (target as { getAttribute?: unknown }).getAttribute
  if (typeof read !== 'function') return false
  return (read as (name: string) => unknown).call(target, PATH_EDIT_ATTR) != null
}

/**
 * What the dialog capture listener should do with Escape.
 * `'ignore'` leaves the picker open (the path field reverts its own draft).
 */
export function dialogEscapeAction(target: EventTarget | null): 'ignore' | 'dismiss' {
  return isPathEditEscapeTarget(target) ? 'ignore' : 'dismiss'
}

/**
 * Window-capture Escape for the path field. Stops the event before a
 * document capture listener (the dialog stack) can dismiss the picker.
 * Returns true when the caller should revert the draft and exit edit mode.
 */
export function consumePathEditEscape(event: {
  key: string
  target: EventTarget | null
  preventDefault: () => void
  stopPropagation: () => void
}): boolean {
  if (event.key !== 'Escape' || !isPathEditEscapeTarget(event.target)) return false
  event.preventDefault()
  event.stopPropagation()
  return true
}

/**
 * Dialog accessibility behavior for one modal while `active`.
 * Returns the ref to place on the dialog element.
 */
export function useDialogA11y(active: boolean, onClose: () => void): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return
    const element = ref.current
    if (element === null) return
    const close = (): void => { closeRef.current() }
    stack.push(close)

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = (): HTMLElement[] =>
      Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(node => node.offsetParent !== null)

    element.tabIndex = -1
    const initial = element.querySelector<HTMLElement>('input, textarea, select')
    ;(initial ?? element).focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (stack[stack.length - 1] !== close) return
      if (event.key === 'Escape') {
        // The path field swallows Escape on window first. If this event still
        // arrives, leave the picker open so the field can revert its draft.
        if (dialogEscapeAction(event.target) === 'ignore') return
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusables()
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (first === undefined || last === undefined) {
        event.preventDefault()
        element.focus()
        return
      }
      const current = document.activeElement
      const atStart = current === first || current === element || current === document.body || current === null
      const atEnd = current === last || current === element || current === document.body || current === null
      if (event.shiftKey && atStart) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && atEnd) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const index = stack.lastIndexOf(close)
      if (index >= 0) stack.splice(index, 1)
      if (previous !== null && document.contains(previous)) previous.focus()
    }
  }, [active])

  return ref
}

/**
 * BUG-14: backdrop-dismiss props that survive drag-selection. A plain
 * `onClick` guarded by `target === currentTarget` also fires for a click the
 * browser dispatches on the nearest COMMON ANCESTOR of mousedown and mouseup —
 * selecting text inside the dialog and releasing over the backdrop read as a
 * backdrop click and closed the picker, losing the browse state. The dismiss
 * now additionally requires the press itself to have started on the backdrop.
 * The press flag lives in the returned closure, so any re-render between
 * press and release fails safe (no dismiss) rather than guessing.
 */
export function backdropDismissProps(onDismiss: () => void): {
  onMouseDown: (event: { target: unknown; currentTarget: unknown }) => boolean
  onClick: (event: { target: unknown; currentTarget: unknown }) => void
} {
  let pressedOnBackdrop = false
  return {
    onMouseDown: event => {
      pressedOnBackdrop = event.target === event.currentTarget
      return pressedOnBackdrop
    },
    onClick: event => {
      if (pressedOnBackdrop && event.target === event.currentTarget) onDismiss()
    },
  }
}
