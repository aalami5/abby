import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol'
import { AccessToken, type VideoGrant } from 'livekit-server-sdk'
import { type ApiRequest, type ApiResponse, PatientApiError, buildPatientPlan, requirePatientSession, sendApiError } from './patientCore.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method !== 'POST') throw new PatientApiError(405, 'method_not_allowed')
    const session = requirePatientSession(request)
    const livekitUrl = process.env.LIVEKIT_URL
    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    if (!livekitUrl || !apiKey || !apiSecret) throw new PatientApiError(503, 'livekit_not_configured')
    const plan = await buildPatientPlan(session.careId)
    const sessionId = crypto.randomUUID()
    const roomName = `abby-${sessionId}`
    const metadata = JSON.stringify({ careId: session.careId, recordId: session.recordId, sessionId, workflow: plan.workflow })
    const token = new AccessToken(apiKey, apiSecret, {
      identity: `patient:${session.patientId}:${sessionId}`,
      name: plan.patientFirstName,
      ttl: '10m',
      metadata,
    })
    const grant: VideoGrant = { room: roomName, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: true }
    token.addGrant(grant)
    token.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: process.env.LIVEKIT_AGENT_NAME || 'abby-care-agent', metadata })],
    })
    response.status(200).json({
      serverUrl: livekitUrl,
      roomName,
      participantToken: await token.toJwt(),
      sessionId,
      workflow: plan.workflow,
    })
  } catch (error) {
    sendApiError(response, error)
  }
}
