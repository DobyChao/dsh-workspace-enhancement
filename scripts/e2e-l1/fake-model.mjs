#!/usr/bin/env node
/**
 * Fake Anthropic Messages server for the L1-in-CI harness (INFRA-23).
 *
 * M3–M7 assert TOOL behavior, not model behavior — but the assertion points
 * (the real agent loop's renderer, the jobs service's owner contract, the
 * official tool chain) are only reached when a REAL host session runs the
 * tools. This server stands in for the LLM: it answers the exact protocol
 * `dsh-llm-deepseek` speaks (Anthropic Messages, `POST <baseURL>/messages`)
 * with a FIXED, scripted tool-call sequence, so the whole chain becomes
 * deterministic (R51 design recon; see docs/decisions/ADR-0031 round R51).
 *
 * Scripting model: `steps` is a queue. Each step is one of
 *   { tool_use: { name, input } }   — reply with that tool call
 *   { text: string }                — reply with plain text (ends the turn)
 *   (request) => step | Promise<step> — dynamic step; `request` carries the
 *     full Anthropic request body, so a step can read the PREVIOUS
 *     tool_result blocks out of `request.messages` (that is how the M4 case
 *     learns the background job id the first call returned).
 * Exhausting the queue answers a plain final text, so a buggy extra round
 * cannot hang the run.
 *
 * Both streaming (SSE) and non-streaming clients are answered, keyed on the
 * request's `stream` flag. No auth is enforced; the harness's settings.yaml
 * carries a dummy apiKey.
 *
 * @module scripts/e2e-l1/fake-model
 */

import { createServer } from 'node:http'

/** `tool_call_n` ids must be unique per conversation. */
function callId(index) {
  return `e2etool_${index}`
}

/** Build the Anthropic message content blocks + stop_reason for one step. */
function blocksOf(step, index) {
  if (step?.tool_use !== undefined) {
    return {
      content: [{ type: 'tool_use', id: callId(index), name: step.tool_use.name, input: step.tool_use.input ?? {} }],
      stop_reason: 'tool_use',
    }
  }
  const text = typeof step?.text === 'string' ? step.text : 'e2e-l1: scripted steps exhausted'
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
}

/** SSE-encode one Anthropic streaming response. */
function sseOf(step, index, model) {
  const { content, stop_reason } = blocksOf(step, index)
  const events = [
    ['message_start', { type: 'message_start', message: { id: `e2emsg_${index}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
  ]
  content.forEach((block, blockIndex) => {
    events.push(['content_block_start', { type: 'content_block_start', index: blockIndex, content_block: block.type === 'tool_use' ? { type: 'tool_use', id: block.id, name: block.name, input: {} } : { type: 'text', text: '' } }])
    if (block.type === 'tool_use') {
      events.push(['content_block_delta', { type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }])
    } else {
      events.push(['content_block_delta', { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: block.text } }])
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index: blockIndex }])
  })
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 1 } }])
  events.push(['message_stop', { type: 'message_stop' }])
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

/**
 * Start the fake model on 127.0.0.1 (ephemeral port).
 *
 * @param {Array<Record<string, unknown> | ((request: any) => any)>} steps - scripted replies.
 * @returns {Promise<{ server: import('node:http').Server, port: number, requests: any[] }>}
 */
export async function startFakeModel(steps) {
  const requests = []
  let index = 0
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const url = req.url ?? ''
      if (!url.endsWith('/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: `fake-model: unexpected path ${url}` }))
        return
      }
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch { /* an unparseable body still gets the next scripted step */ }
      requests.push(body)
      Promise.resolve()
        .then(() => {
          const step = steps[index]
          index += 1
          return typeof step === 'function' ? step(body) : step
        })
        .then(step => {
          const model = typeof body.model === 'string' && body.model !== '' ? body.model : 'e2e-fake'
          if (body.stream === true) {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
            res.end(sseOf(step, index - 1, model))
          } else {
            const { content, stop_reason } = blocksOf(step, index - 1)
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ id: `e2emsg_${index - 1}`, type: 'message', role: 'assistant', model, content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }))
          }
        })
        .catch(error => {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: `fake-model: ${String(error)}` }))
        })
    })
  })
  await new Promise((done, bad) => {
    server.once('error', bad)
    server.listen(0, '127.0.0.1', done)
  })
  return { server, port: server.address().port, requests }
}
