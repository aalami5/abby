import { randomInt } from 'node:crypto'
import { readGoogleJson, writeGoogleJson } from './googleCloudStore.js'
import {
  type ApiRequest,
  type ApiResponse,
  PatientApiError,
  createPatientSession,
  expectedPatientPhone,
  normalizeCareId,
  normalizePhone,
  patientPhoneHint,
  resolveRecord,
  sendApiError,
} from './patientCore.js'

type Challenge = { code: string; phone: string; expiresAt: string }
type ChallengeStore = { challenges: Record<string, Challenge> }

const fallback = ((globalThis as typeof globalThis & { abbyPatientChallenges?: ChallengeStore }).abbyPatientChallenges ??= { challenges: {} })

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    const body = parseBody(request.body)
    const careId = normalizeCareId(request.query?.careId ?? body.careId)
    if (!careId) throw new PatientApiError(400, 'care_id_required')
    resolveRecord(careId)

    if (request.method === 'GET') {
      response.status(200).json({
        careId,
        providerName: 'Dr. Oliver Aalami',
        practiceName: 'Abby Care',
        visitTitle: 'Private care conversation',
        phoneHint: patientPhoneHint(careId),
        phoneLocked: true,
        verificationMode: hasTwilio() ? 'sms' : 'demo',
      })
      return
    }

    if (request.method !== 'POST') throw new PatientApiError(405, 'method_not_allowed')
    const action = typeof body.action === 'string' ? body.action : ''
    if (careId === 'demo-cardiovascular' && hasTwilio() && !process.env.ABBY_DEMO_PATIENT_PHONE) {
      throw new PatientApiError(503, 'demo_phone_not_configured')
    }
    const expectedPhone = expectedPatientPhone(careId)
    const suppliedPhone = normalizePhone(body.phone)
    const phone = suppliedPhone || expectedPhone
    if (phone !== expectedPhone) throw new PatientApiError(403, 'phone_does_not_match_care_link')

    if (action === 'send-otp') {
      const code = String(randomInt(100000, 1000000))
      const store = await readGoogleJson<ChallengeStore>('patient-challenges-v1', fallback)
      store.challenges[careId] = { code, phone, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }
      fallback.challenges = store.challenges
      await sendOtp(phone, code)
      await writeGoogleJson('patient-challenges-v1', store)
      response.status(200).json({
        status: 'sent',
        phoneHint: patientPhoneHint(careId),
        demoCode: hasTwilio() ? undefined : code,
      })
      return
    }

    if (action === 'verify-otp') {
      const code = typeof body.code === 'string' ? body.code.trim() : ''
      const store = await readGoogleJson<ChallengeStore>('patient-challenges-v1', fallback)
      const challenge = store.challenges[careId]
      const verified = hasTwilio()
        ? await verifyOtp(phone, code)
        : Boolean(challenge && challenge.phone === phone && challenge.code === code && Date.parse(challenge.expiresAt) >= Date.now())
      if (!verified) throw new PatientApiError(401, 'invalid_or_expired_code')
      delete store.challenges[careId]
      fallback.challenges = store.challenges
      await writeGoogleJson('patient-challenges-v1', store)
      response.status(200).json({ token: createPatientSession(careId), expiresIn: 1800 })
      return
    }

    throw new PatientApiError(400, 'unknown_action')
  } catch (error) {
    sendApiError(response, error)
  }
}

function hasTwilio() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && twilioVerifySid())
}

async function sendOtp(phone: string, code: string) {
  if (!hasTwilio()) return code
  const response = await fetch(`https://verify.twilio.com/v2/Services/${twilioVerifySid()}/Verifications`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Channel: 'sms' }),
  })
  if (!response.ok) throw new PatientApiError(502, 'verification_delivery_failed')
}

async function verifyOtp(phone: string, code: string) {
  const response = await fetch(`https://verify.twilio.com/v2/Services/${twilioVerifySid()}/VerificationCheck`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Code: code }),
  })
  if (!response.ok) return false
  const payload = await response.json() as { status?: string }
  return payload.status === 'approved'
}

function twilioVerifySid() {
  return process.env.TWILIO_VERIFY_SERVICE_SID_ABBY || process.env.TWILIO_VERIFY_SERVICE_SID || ''
}

function parseBody(value: unknown) {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
