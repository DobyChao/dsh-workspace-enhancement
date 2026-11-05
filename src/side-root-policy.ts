/**
 * REQ-I24 (ADR-0028 §5): a LOCAL side root is an extension of the workspace,
 * with the main root's permissions. The official sandbox knows one
 * `workspaceRoot` per policy, so one write (by target path) or one command
 * (by cwd) picks its root here and the official enforcement does the rest —
 * `SandboxedFileSystem` for file tools, `ctx.sandbox.confine` for commands.
 *
 * One root per call: a command running in the main root cannot write a
 * sibling side root without escalation (ADR-0029 §4.3).
 *
 * @module dsh-workspace-enhancement/side-root-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import type { FsEditOutcome, FsEditRequest, FsTarget, FsVersion, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { initiatorSessionOf } from './remote-policy.ts'
import { localSideRootFor } from './session-workspaces.ts'

/** The initiator session's attached LOCAL side roots (no session/store → none). */
export function sessionLocalSideRoots(ctx: Context): string[] {
  if (typeof ctx.get !== 'function') return []
  const session = initiatorSessionOf(ctx) as { header?: { id?: string } } | undefined
  const sessionId = session?.header?.id
  if (sessionId === undefined) return []
  const store = ctx.get('sideWorkspaces', false) as {
    listFor?: (id: string) => readonly { kind: string; rootKey: string }[]
  } | undefined
  if (store === undefined || typeof store.listFor !== 'function') return []
  const roots: string[] = []
  for (const item of store.listFor(sessionId)) {
    if (item.kind === 'local') roots.push(item.rootKey)
  }
  return roots
}

/**
 * `policy` with its workspace root swapped for the session's local side root
 * holding `path`. Only `workspace-write` changes: `read-only` writes nothing
 * and `danger-full-access` is unfenced. Returns `policy` itself when nothing
 * changes, so callers can tell a swap by identity.
 */
export function widenPolicyToSideRoot<T>(ctx: Context, policy: T, path: string | undefined): T {
  if (typeof policy !== 'object' || policy === null) return policy
  const { mode, workspaceRoot } = policy as { mode?: unknown; workspaceRoot?: unknown }
  if (mode !== 'workspace-write' || typeof workspaceRoot !== 'string') return policy
  const roots = sessionLocalSideRoots(ctx)
  const side = localSideRootFor(roots, workspaceRoot, path)
  if (side === undefined) return policy
  return { ...policy, workspaceRoot: side }
}

interface PolicyResolver {
  resolve?: () => SandboxExecutionPolicy
}

/**
 * The local sandboxed backend with side-root-aware writes. An omitted policy
 * resolves exactly as the official backend would before the swap.
 */
export class SideRootSandboxedFileSystem extends SandboxedFileSystem {
  /**
   * The 0.2.2 seam adds concrete `patchText` / `deleteFile` / `moveFile` on
   * `SandboxedFileSystem`. Declaring them with `override` fails to compile on
   * older families (TS4113); omitting `override` fails on 0.2.2 (TS4114,
   * `noImplicitOverride`). Wrapping the inherited methods when they exist
   * widens the workspace root the same way `writeText` does, on both lines.
   */
  constructor(ctx: Context, config: { cwd?: string; diffBasisMaxBytes?: number }) {
    super(ctx, config)
    this.installSeamMutations()
  }

  private installSeamMutations(): void {
    const proto = SandboxedFileSystem.prototype as unknown as Record<string, unknown>
    const self = this as unknown as Record<string, unknown>
    const patch = proto.patchText
    if (typeof patch === 'function') {
      self.patchText = (
        target: FsTarget,
        hunks: unknown,
        expected: unknown,
        signal: AbortSignal | undefined,
        sandboxPolicy: SandboxExecutionPolicy | undefined,
      ) => (patch as (...args: unknown[]) => Promise<unknown>).call(
        this, target, hunks, expected, signal, this.policyFor(target, sandboxPolicy),
      )
    }
    const remove = proto.deleteFile
    if (typeof remove === 'function') {
      self.deleteFile = (
        target: FsTarget,
        expected: unknown,
        signal: AbortSignal | undefined,
        sandboxPolicy: SandboxExecutionPolicy | undefined,
      ) => (remove as (...args: unknown[]) => Promise<unknown>).call(
        this, target, expected, signal, this.policyFor(target, sandboxPolicy),
      )
    }
    const move = proto.moveFile
    if (typeof move === 'function') {
      self.moveFile = (
        source: FsTarget,
        destination: FsTarget,
        options: unknown,
        signal: AbortSignal | undefined,
        sandboxPolicy: SandboxExecutionPolicy | undefined,
      ) => (move as (...args: unknown[]) => Promise<unknown>).call(
        this, source, destination, options, signal, this.policyForAll([source, destination], sandboxPolicy),
      )
    }
  }

  /**
   * One policy for every path in the call. Paths that widen to the same side
   * root share that root; a split (main plus side, or two sides) keeps the
   * caller's policy so the official fence still denies the cross-root write.
   */
  private policyForAll(
    targets: readonly FsTarget[],
    sandboxPolicy: SandboxExecutionPolicy | undefined,
  ): SandboxExecutionPolicy | undefined {
    const widened = targets.map(target => this.policyFor(target, sandboxPolicy))
    const rootOf = (policy: SandboxExecutionPolicy | undefined): string | undefined => {
      if (typeof policy !== 'object' || policy === null) return undefined
      const root = (policy as { workspaceRoot?: unknown }).workspaceRoot
      return typeof root === 'string' ? root : undefined
    }
    const roots = widened.map(rootOf)
    if (roots.every(root => root === roots[0])) return widened[0]
    return sandboxPolicy
  }

  private policyFor(target: FsTarget, sandboxPolicy: SandboxExecutionPolicy | undefined): SandboxExecutionPolicy | undefined {
    const resolver = (this.ctx as unknown as { sandboxPolicy?: PolicyResolver }).sandboxPolicy
    const base = sandboxPolicy ?? resolver?.resolve?.()
    if (base === undefined) return sandboxPolicy
    const widened = widenPolicyToSideRoot(this.ctx, base, String(target.targetKey))
    return widened === base ? sandboxPolicy : widened
  }

  override writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    return super.writeText(target, content, expected, signal, this.policyFor(target, sandboxPolicy))
  }

  override editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    return super.editText(target, edit, expected, signal, this.policyFor(target, sandboxPolicy))
  }
}
