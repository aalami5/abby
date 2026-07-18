import { randomUUID } from 'node:crypto'
import { type ApiRequest, type ApiResponse, PatientApiError, appendAuditEvent, buildPatientPlan, normalizeCareId, requireAgentSecret, resolveRecord, sendApiError } from './patientCore.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method !== 'POST') throw new PatientApiError(405, 'method_not_allowed')
    requireAgentSecret(request)
    const body = parseBody(request.body)
    const careId = normalizeCareId(body.careId)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const actionId = typeof body.actionId === 'string' ? body.actionId : ''
    const plan = await buildPatientPlan(careId)
    const approved = plan.allowedActions.find((action) => action.id === actionId)
    if (!approved) throw new PatientApiError(403, 'action_not_approved')
    const receipt = { id: randomUUID(), mode: process.env.ABBY_DEMO_MODE === 'false' ? 'integration_pending' : 'simulated', actionType: approved.type, accepted: true }
    await appendAuditEvent({ careId, recordId: resolveRecord(careId).id, sessionId, type: 'approved_action', content: { actionId, input: body.input, receipt } })
    response.status(200).json({ receipt })
  } catch (error) {
    sendApiError(response, error)
  }
}

function parseBody(value: unknown) {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
