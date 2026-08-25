/**
 * dsh-workspace-enhancement — unified SSH remote-execution engine for DeepSeek
 * Harness (ported from dsh-ssh).
 *
 * One package, two mounting styles:
 * - `name: dsh-workspace-enhancement` — aggregate plugin: mounts the shared
 *   connection owner (`ctx.ssh`) plus the remote subprocess (`ctx.subprocess`)
 *   and filesystem (`ctx.fs`) providers in one row.
 * - Subpath rows (`dsh-workspace-enhancement/ssh`,
 *   `dsh-workspace-enhancement/subprocess`, `dsh-workspace-enhancement/fs`)
 *   mount each service separately, for deployments that compose providers
 *   individually.
 * @module dsh-workspace-enhancement
 */

export { SshRuntime, quoteShellArg, wrapCwd } from './runtime.ts'
export type { Config, JumpConfig, ExecOutcome } from './runtime.ts'
export { SshSubprocessRuntime } from './subprocess.ts'
export { SshFileSystem } from './filesystem.ts'
export { SshDirectoryPicker } from './picker.ts'
export type { Config as PickerConfig } from './picker.ts'
export { SshRegistry, parseSshRoute, loadMachinesState, normalizeMachine } from './registry.ts'
export type { RegistryConfig, SshConnectionView, ResolvedSshConfig, SshRoute, ConnectionInput, MachineInput, MachineView, WorkspaceStatus } from './registry.ts'
export { parseSshTargetKey, resolveSshCwd, resolveSshTargetKey, sshTargetKey } from './transport.ts'
export type { SshCwdRoute, SshTransport } from './transport.ts'
export { SshConnection, resolveHostKeyPolicy } from './connection.ts'
export type { SshConnectionSpec, SshConnectionOptions, HostKeyPolicy, HostKeyPolicySource } from './connection.ts'
export { dshHome, remoteWorkspacesRoot, defaultKnownHostsFile, defaultSecretsDir, HostKeyStore, HostKeyGuard, blobAlgorithm, keyFingerprint, makeKeyBlob } from './hostkey.ts'
export type { HostKeyMode, KnownHosts, KnownHostEntry } from './hostkey.ts'
export { platformBackend, saveSecret, getSecret, deleteSecret } from './credential.ts'
export type { CredentialBackend } from './credential.ts'
export { apply } from './plugin.ts'
