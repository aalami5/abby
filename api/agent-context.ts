import { type ApiRequest, type ApiResponse, PatientApiError, buildPatientPlan, normalizeCareId, requireAgentSecret, sendApiError } from './patientCore.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method !== 'POST') throw new PatientApiError(405, 'method_not_allowed')
    requireAgentSecret(request)
    const body = parseBody(request.body)
    const careId = normalizeCareId(body.careId)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!careId || !sessionId) throw new PatientApiError(400, 'context_identifiers_required')
    response.status(200).json({ ...(await buildPatientPlan(careId)), careId, sessionId })
  } catch (error) {
    sendApiError(response, error)
  }
}

function parseBody(value: unknown) {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
