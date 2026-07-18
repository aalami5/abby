import assert from 'node:assert/strict'
import test from 'node:test'
import chatHandler from '../api/patient-chat.ts'
import { createPatientSession, type ApiRequest, type ApiResponse } from '../api/patientCore.ts'

process.env.ABBY_SESSION_SECRET = 'test-session-secret-with-sufficient-entropy'
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'

function capture() {
  let statusCode = 0
  let body: unknown
  const response: ApiResponse = {
    status(code) {
      statusCode = code
      return { json(value) { body = value } }
    },
  }
  return { response, result: () => ({ statusCode, body }) }
}

async function call(request: ApiRequest) {
  const output = capture()
  await chatHandler(request, output.response)
  return output.result()
}

function patientRequest(): ApiRequest {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${createPatientSession('demo-cardiovascular')}` },
    body: { messages: [{ sender: 'patient', content: 'Please explain my next step.' }] },
  }
}

test('patient chat retries one transient Anthropic network failure', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = originalFetch })
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    if (attempts === 1) throw new TypeError('fetch failed')
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Your next step is to review the approved plan.' }],
      model: 'claude-sonnet-4-6',
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const result = await call(patientRequest())

  assert.equal(result.statusCode, 200)
  assert.equal(attempts, 2)
})

test('patient chat returns a specific temporary-unavailable error after retries', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = originalFetch })
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    throw new TypeError('fetch failed')
  }

  const result = await call(patientRequest())

  assert.equal(result.statusCode, 503)
  assert.deepEqual(result.body, { error: 'claude_temporarily_unavailable' })
  assert.equal(attempts, 2)
})
