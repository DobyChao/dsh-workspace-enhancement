/**
 * The flow's connection-form shell (R2 表单并集): the modal chrome —
 * overlay, dialog, head, close — around the shared {@link MachineForm}
 * (mode="flow"). All field/interaction logic lives in the shared component;
 * this shell only maps a config-host `draft` to the form's `initial` and
 * forwards the saved view back to the flow (「保存并浏览」→ sidebar select +
 * remote-directory browse).
 * @module dsh-workspace-enhancement/client/form
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RpcCall } from './status.tsx'
import { MachineForm } from './machine-form.tsx'
import type { MachineFormInitial, MachineSaveView } from './machine-form.tsx'
import { useDialogA11y } from './ui.ts'
import { CloseIcon } from './icons.tsx'
import styles from './flow.module.css'

/** Prefilled fields for a form opened from the sidebar (config host / auth fix). */
export interface ConnectionDraft {
  label?: string
  host?: string
  port?: string
  username?: string
  privateKeyPath?: string
  jumpText?: string
  cwd?: string
  /** Focus the username field on open (the missing piece the user must fill). */
  focusUsername?: boolean
}

export interface ConnectionFormProps {
  /** The `/dsw` RPC channel (the shared form drives resolve/test/save itself). */
  rpc: RpcCall
  /** Prefilled fields, when the sidebar opened the form for one config host. */
  draft?: ConnectionDraft | undefined
  /** Typed translate seat of the `dsw` namespace (threaded from the flow). */
  t: TranslateNS<'dsw'>
  /** The operator dismissed the form. */
  onClose(): void
  /** A connection was saved; the flow switches the browser to it. */
  onSaved(view: MachineSaveView): void
}

/** Map the sidebar's draft onto the shared form's initial state. */
function draftToInitial(draft: ConnectionDraft | undefined): MachineFormInitial | undefined {
  if (draft === undefined) return undefined
  return {
    ...(draft.label !== undefined ? { name: draft.label } : {}),
    ...(draft.host !== undefined ? { host: draft.host } : {}),
    ...(draft.port !== undefined ? { port: draft.port } : {}),
    ...(draft.username !== undefined ? { username: draft.username } : {}),
    ...(draft.privateKeyPath !== undefined ? { privateKeyPath: draft.privateKeyPath } : {}),
    ...(draft.jumpText !== undefined ? { jumpText: draft.jumpText } : {}),
    ...(draft.cwd !== undefined ? { workspace: draft.cwd } : {}),
    ...(draft.focusUsername === true ? { focusUsername: true } : {}),
  }
}

/** The connection form modal (masked password, 密码/私钥二选一). */
export function ConnectionForm({ rpc, draft, t, onClose, onSaved }: ConnectionFormProps) {
  const dialogRef = useDialogA11y(true, onClose)
  return (
    <div className={styles.overlay} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={styles.form} role="dialog" aria-modal="true" aria-label={t('form.dialog.label')} ref={dialogRef}>
        <div className={styles.formHead}>
          <div className={styles.formHeadText}>
            <h3 className={styles.formTitle}>{t('form.title')}</h3>
            <p className={styles.formSub}>{t('form.subtitle')}</p>
          </div>
          <button type="button" className={styles.iconButton} aria-label={t('form.close.label')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className={styles.formGrid}>
          <MachineForm
            mode="flow"
            rpc={rpc}
            initial={draftToInitial(draft)}
            t={t}
            onSaved={onSaved}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  )
}
