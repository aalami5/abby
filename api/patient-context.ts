import { buildPatientPlan, type ApiRequest, type ApiResponse, loadConversationHistory, requirePatientSession, sendApiError } from './patientCore.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method !== 'GET') {
      response.status(405).json({ error: 'method_not_allowed' })
      return
    }
    const session = requirePatientSession(request)
    const plan = await buildPatientPlan(session.careId)
    response.status(200).json({ ...plan, history: await loadConversationHistory(session.careId) })
  } catch (error) {
    sendApiError(response, error)
  }
}
