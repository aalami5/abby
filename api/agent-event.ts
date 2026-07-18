import { type ApiRequest, type ApiResponse, PatientApiError, appendAuditEvent, buildPatientPlan, normalizeCareId, requireAgentSecret, resolveRecord, sendApiError } from './patientCore.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method !== 'POST') throw new PatientApiError(405, 'method_not_allowed')
    requireAgentSecret(request)
    const body = parseBody(request.body)
    const careId = normalizeCareId(body.careId)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const type = typeof body.type === 'string' ? body.type : ''
    const content = typeof body.content === 'string' ? body.content.slice(0, 4000) : ''
    if (!careId || !sessionId || !type || !content) throw new PatientApiError(400, 'event_fields_required')
    const plan = await buildPatientPlan(careId)
    if (type === 'escalation') {
      const ruleId = typeof body.escalationRuleId === 'string' ? body.escalationRuleId : ''
      if (!plan.escalationRules.some((rule) => rule.id === ruleId)) throw new PatientApiError(403, 'escalation_rule_not_approved')
    }
    const event = await appendAuditEvent({ careId, recordId: resolveRecord(careId).id, sessionId, type, content })
    response.status(201).json({ eventId: event.id, status: type === 'escalation' ? 'escalated' : 'recorded' })
  } catch (error) {
    sendApiError(response, error)
  }
}

function parseBody(value: unknown) {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
