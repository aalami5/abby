import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPatientPlan, createPatientSession, requirePatientSession, resolveRecord } from '../api/patientCore.ts'

process.env.ABBY_SESSION_SECRET = 'test-session-secret-with-sufficient-entropy'

test('a patient session is bound to its care record', () => {
  const token = createPatientSession('demo-cardiovascular')
  const claims = requirePatientSession({ headers: { authorization: `Bearer ${token}` } })
  assert.equal(claims.careId, 'demo-cardiovascular')
  assert.equal(claims.recordId, resolveRecord('demo-cardiovascular').id)
})

test('the patient workflow comes from server-side approval state', async () => {
  const record = resolveRecord('demo-cardiovascular')
  const store = (globalThis as typeof globalThis & {
    abbyRunsStore: { runsByCase: Record<string, unknown> }
  }).abbyRunsStore
  delete store.runsByCase[record.id]
  assert.equal((await buildPatientPlan('demo-cardiovascular')).workflow, 'pre_visit_intake')

  store.runsByCase[record.id] = {
    id: 'approved-run',
    caseId: record.id,
    stage: 'approved',
    approvedBy: 'Dr. Test',
    approvedAt: new Date().toISOString(),
  }
  const plan = await buildPatientPlan('demo-cardiovascular')
  assert.equal(plan.workflow, 'post_visit_followthrough')
  assert.ok(plan.allowedActions.length > 0)
  delete store.runsByCase[record.id]
})

test('an invalid patient token is rejected', () => {
  assert.throws(
    () => requirePatientSession({ headers: { authorization: 'Bearer broken.token' } }),
    /invalid_patient_session/,
  )
})
