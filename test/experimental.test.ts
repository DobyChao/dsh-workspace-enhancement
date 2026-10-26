/**
 * REQ-I31: the experimental-toggles store. These cases pin the persistence
 * contract (one file, default off, corrupt reads all-off) and the listener
 * notification the tools half re-registers `sw_use_machine` on.
 * @module test/experimental
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  ExperimentalToggles,
  defaultExperimentalFile,
  experimentalFilePath,
  loadExperimentalToggles,
} from '../src/experimental.ts'

const tempFile = (): { dir: string; file: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-exp-'))
  return { dir, file: join(dir, 'experimental.json') }
}

test('defaultExperimentalFile: lives in the DSH home by default', () => {
  assert.equal(defaultExperimentalFile('/home/x'), join('/home/x', 'dsw-experimental.json'))
  assert.equal(experimentalFilePath('/home/x'), defaultExperimentalFile('/home/x'))
})

test('loadExperimentalToggles: missing file reads all-off', () => {
  const { file } = tempFile()
  assert.deepEqual(loadExperimentalToggles(file, () => {}), { switchMachine: false })
})

test('loadExperimentalToggles: an on record survives the round-trip', () => {
  const { file } = tempFile()
  writeFileSync(file, `${JSON.stringify({ toggles: { switchMachine: true } }, null, 2)}\n`)
  assert.deepEqual(loadExperimentalToggles(file, () => {}), { switchMachine: true })
})

test('loadExperimentalToggles: corrupt file warns and reads all-off', () => {
  const { file } = tempFile()
  writeFileSync(file, '{ not json')
  const warnings: string[] = []
  assert.deepEqual(loadExperimentalToggles(file, message => warnings.push(message)), { switchMachine: false })
  assert.equal(warnings.length, 1)
})

test('loadExperimentalToggles: unknown/legacy fields are ignored', () => {
  const { file } = tempFile()
  writeFileSync(file, JSON.stringify({ toggles: { switchMachine: 'yes', other: 1 }, legacy: true }))
  assert.deepEqual(loadExperimentalToggles(file, () => {}), { switchMachine: false })
})

test('ExperimentalToggles: default off; set persists and notifies; same-value is a no-op', () => {
  const { file } = tempFile()
  const store = new ExperimentalToggles(new Context(), { file })
  assert.equal(store.switchMachine(), false)

  const flips: boolean[] = []
  const unsubscribe = store.onChange(() => flips.push(store.switchMachine()))
  assert.equal(store.setSwitchMachine(true), true)
  assert.equal(store.switchMachine(), true)
  assert.deepEqual(flips, [true])
  // The persisted file is the durable truth the next host boot reads.
  assert.deepEqual(loadExperimentalToggles(file, () => {}), { switchMachine: true })
  assert.match(readFileSync(file, 'utf8'), /"switchMachine": true/)

  // A same-value call neither persists a change event nor notifies.
  assert.equal(store.setSwitchMachine(true), true)
  assert.deepEqual(flips, [true])

  assert.equal(store.setSwitchMachine(false), false)
  assert.deepEqual(flips, [true, false])
  unsubscribe()
  assert.equal(store.setSwitchMachine(true), true)
  assert.deepEqual(flips, [true, false], 'an unsubscribed listener is never called again')
})

test('ExperimentalToggles: a throwing listener is isolated and the state still flips', () => {
  const { file } = tempFile()
  const store = new ExperimentalToggles(new Context(), { file })
  store.onChange(() => { throw new Error('listener exploded') })
  let seen = false
  store.onChange(() => { seen = true })
  assert.equal(store.setSwitchMachine(true), true)
  assert.equal(seen, true)
  assert.equal(store.switchMachine(), true)
})
