import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { workingDirectoryContextText, registerWorkingDirectoryContext } from '../src/working-directory-context.ts'
import { sshRoutePlaceholder } from '../src/transport.ts'

test('UX-19: the cwd label identifies the remote directory and the local placeholder together', () => {
  const text = workingDirectoryContextText(sshRoutePlaceholder('c1', '/srv/work'))
  assert.match(text, /Current working directory \(remote\): "\/srv\/work"/)
  assert.match(text, /Local routing placeholder:/)
  assert.match(text, /routing alias only/)
  assert.match(text, /execute on the remote machine/)
  assert.equal(workingDirectoryContextText('/local/project'), 'Current working directory: "/local/project".')
})

test('UX-19: scoped cwd provider follows changes, keeps literal braces, and unmounts with the plugin', () => {
  const cleanup: Array<() => void> = []
  let created: ((payload: unknown) => void) | undefined
  let cwd = sshRoutePlaceholder('c1', '/srv/{{literal}}')
  let stopCount = 0
  let provider: { name: string; required: boolean; interpolate: boolean; text: () => string } | undefined
  const host = {
    get: () => ({ get: () => cwd, set: () => Promise.resolve('') }),
    on: (_name: string, handler: (payload: unknown) => void) => { created = handler; return () => {} },
    effect: (effect: () => () => void) => { cleanup.push(effect()); return () => {} },
  }
  registerWorkingDirectoryContext(host as unknown as Context)
  assert.ok(created)
  const agent = { session: {}, ctx: {
    systemPrompt: {
      getContextOrder: () => 100,
      context: (entry: NonNullable<typeof provider>) => { provider = entry; return () => { stopCount++ } },
    },
    effect: () => {},
  } }
  created({ agent })
  assert.ok(provider)
  assert.equal(provider.name, 'working-directory:current')
  assert.equal(provider.required, true)
  assert.equal(provider.interpolate, false)
  assert.match(provider.text(), /\/srv\/\{\{literal\}\}/)
  cwd = sshRoutePlaceholder('c2', '/other/project')
  assert.match(provider.text(), /"\/other\/project"/)
  assert.doesNotMatch(provider.text(), /\/srv\//)
  cwd = '/local/project'
  assert.equal(provider.text(), 'Current working directory: "/local/project".')
  for (const dispose of cleanup.reverse()) dispose()
  assert.equal(stopCount, 1)
})

test('UX-19: older hosts without workingDirectory keep the original provider', () => {
  let created: ((payload: unknown) => void) | undefined
  let registrations = 0
  registerWorkingDirectoryContext({
    get: () => undefined,
    effect: (effect: () => unknown) => { effect() },
    on: (_name: string, handler: (payload: unknown) => void) => { created = handler; return () => {} },
  } as unknown as Context)
  created?.({ agent: { session: {}, ctx: { systemPrompt: { context: () => { registrations++ } } } } })
  assert.equal(registrations, 0)
})

test('UX-19: an existing scoped cwd provider does not prevent agent creation', () => {
  let created: ((payload: unknown) => void) | undefined
  const warnings: string[] = []
  registerWorkingDirectoryContext({
    get: () => ({ get: () => '/local', set: () => Promise.resolve('') }),
    effect: (effect: () => unknown) => { effect() },
    on: (_name: string, handler: (payload: unknown) => void) => { created = handler; return () => {} },
    logger: { warn: (message: string) => { warnings.push(message) } },
  } as unknown as Context)
  assert.doesNotThrow(() => created?.({ agent: { session: {}, ctx: {
    systemPrompt: { getContextOrder: () => 100, context: () => { throw new Error('already registered') } },
  } } }))
  assert.equal(warnings.length, 1)
})
