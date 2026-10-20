/** Views for native remote files; all address decisions live in the sibling .ts. */
import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { remoteFileTarget, nativeCwdOf } from './native-remote-files.ts'
import type { NativeFilesHost } from './native-remote-files.ts'
import { asPreviewWire, remoteWorkspaceOf } from './remote-files.ts'
import type { PreviewWire } from './remote-files.ts'
import type { ClientConnection } from './index.ts'
import { API_CHANNEL, channelEndpointOf } from '../web-channel.ts'
import { RemotePreviewBody } from './remote-files-panel.tsx'
import styles from './remote-files.module.css'

/** The host still uses the placeholder for requests; only its display is replaced. */
export function NativeRemotePath(props: { absolutePath?: string }): JSX.Element | null {
  const remote = remoteWorkspaceOf(props.absolutePath)
  return remote === null ? null : <span className={styles.nativePath} data-dsw-remote-path title={remote.workspace}>{remote.workspace}</span>
}

export function NativeRemoteFile(props: {
  host: NativeFilesHost
  t: TranslateNS<'dsw'>
  useTabInfo(): { tab: { navigation: { address: string }; signal: AbortSignal } }
}): JSX.Element {
  const { tab } = props.useTabInfo()
  const address = tab.navigation.address
  const { host, t } = props
  const [result, setResult] = useState<{ address: string; wire?: PreviewWire; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tab.signal])
    const target = remoteFileTarget(address, id => nativeCwdOf(host, id))
    const connection = host.get('connection') as ClientConnection | undefined
    const load = async (): Promise<void> => {
      if (target === null || connection === undefined) throw new Error(t('files.preview.failed'))
      const response = await connection.rpc.call(API_CHANNEL, channelEndpointOf('workspace.read'), {
        id: target.connectionId, sessionId: target.sessionId, path: target.path,
      }, signal)
      if (!response.ok) throw new Error(response.error.message || t('files.preview.failed'))
      const wire = asPreviewWire(response.value)
      if (wire === undefined) throw new Error(t('files.preview.failed'))
      if (!signal.aborted) setResult({ address, wire })
    }
    void load().catch((error: unknown) => {
      if (!signal.aborted) setResult({ address, error: error instanceof Error ? error.message : t('files.preview.failed') })
    })
    return () => controller.abort()
  }, [host, address, tab.signal, t])
  const current = result?.address === address ? result : undefined
  return <section className={styles.panel} data-dsw-native-remote-file>
    {current?.wire !== undefined ? <>
      <p className={styles.nativePath}>{current.wire.path}</p>
      <RemotePreviewBody wire={current.wire} t={t} />
    </> : <p role={current?.error ? 'alert' : 'status'}>{current?.error ?? t('files.loading')}</p>}
  </section>
}
