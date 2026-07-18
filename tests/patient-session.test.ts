import assert from 'node:assert/strict'
import test from 'node:test'
import contextHandler from '../api/patient-context.ts'
import sessionHandler from '../api/patient-session.ts'
import type { ApiRequest, ApiResponse } from '../api/patientCore.ts'

process.env.ABBY_SESSION_SECRET = 'test-session-secret-with-sufficient-entropy'

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

async function call(
  handler: (request: ApiRequest, response: ApiResponse) => Promise<void>,
  request: ApiRequest,
) {
  const output = capture()
  await handler(request, output.response)
  return output.result()
}

test('the patient can verify a synthetic care link and load minimum context', async () => {
  const careId = 'demo-cardiovascular'
  const phone = '+15550120011'
  const bootstrap = await call(sessionHandler, { method: 'GET', query: { careId } })
  assert.equal(bootstrap.statusCode, 200)
  assert.equal((bootstrap.body as { visitTitle: string }).visitTitle, 'Private care conversation')

  const challenge = await call(sessionHandler, {
    method: 'POST',
    body: { action: 'send-otp', careId, phone },
  })
  assert.equal(challenge.statusCode, 200)
  const demoCode = (challenge.body as { demoCode: string }).demoCode
  assert.equal(demoCode.length, 6)

  const verified = await call(sessionHandler, {
    method: 'POST',
    body: { action: 'verify-otp', careId, phone, code: demoCode },
  })
  assert.equal(verified.statusCode, 200)
  const token = (verified.body as { token: string }).token

  const context = await call(contextHandler, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(context.statusCode, 200)
  assert.equal((context.body as { workflow: string }).workflow, 'pre_visit_intake')
})
