import type { PatientBootstrap, PatientMessage, PatientPlan, VoiceConnection } from './patientTypes'

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) {
    const messages: Record<string, string> = {
      care_link_not_found: 'This care link is no longer available.',
      phone_does_not_match_care_link: 'That phone number does not match this private care link.',
      invalid_or_expired_code: 'That code is incorrect or has expired. Please request a new one.',
      demo_phone_not_configured: 'Real SMS is ready, but this demo link still needs its private test phone number.',
      patient_session_expired: 'For your privacy, please verify your phone again.',
      claude_not_configured: 'Abby is not available yet. Please try again shortly.',
      livekit_not_configured: 'Realtime voice is being connected. You can continue by text.',
    }
    throw new Error(messages[result.error ?? ''] ?? 'Something went wrong. Please try again.')
  }
  return result
}

export function loadPatientBootstrap(careId: string) {
  return requestJson<PatientBootstrap>(`/api/patient-session?careId=${encodeURIComponent(careId)}`)
}

export function sendPatientOtp(careId: string, phone: string) {
  return requestJson<{ status: string; phoneHint: string; demoCode?: string }>('/api/patient-session', {
    method: 'POST',
    body: JSON.stringify({ action: 'send-otp', careId, phone }),
  })
}

export function verifyPatientOtp(careId: string, phone: string, code: string) {
  return requestJson<{ token: string; expiresIn: number }>('/api/patient-session', {
    method: 'POST',
    body: JSON.stringify({ action: 'verify-otp', careId, phone, code }),
  })
}

export function loadPatientPlan(token: string) {
  return requestJson<PatientPlan>('/api/patient-context', {
    headers: { authorization: `Bearer ${token}` },
  })
}

export function sendPatientMessage(token: string, messages: PatientMessage[]) {
  return requestJson<{ message: PatientMessage; suggestedReplies: string[]; model?: string }>('/api/patient-chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  })
}

export function createVoiceConnection(token: string) {
  return requestJson<VoiceConnection>('/api/livekit-token', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
}
