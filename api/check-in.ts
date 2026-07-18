type CheckInRequest = {
  patientId?: string
  patientName?: string
  patientPhone?: string
  providerName?: string
  specialty?: string
  chatUrl?: string
}

type TwilioMessagingConfig = {
  accountSid: string
  authToken: string
  messagingServiceSid?: string
  fromNumber?: string
}

type VercelRequest = {
  method?: string
  body?: unknown
}

type VercelResponse = {
  status: (code: number) => { json: (body: unknown) => void }
}

declare const process: {
  env: Record<string, string | undefined>
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const body = normalizeCheckIn(parseBody(request.body))
    const message = buildCheckInMessage(body)
    const twilio = getTwilioMessagingConfig()

    if (!twilio) {
      response.status(200).json({
        mode: 'demo',
        status: 'not-sent',
        message,
        detail: 'Twilio messaging is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID_ABBY or TWILIO_FROM_NUMBER_ABBY.',
      })
      return
    }

    const twilioResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: twilioAuthorization(twilio),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: body.patientPhone,
        Body: message,
        ...(twilio.messagingServiceSid ? { MessagingServiceSid: twilio.messagingServiceSid } : { From: twilio.fromNumber ?? '' }),
      }),
    })

    const payload = await twilioResponse.json() as { sid?: string; status?: string; message?: string }
    if (!twilioResponse.ok) {
      response.status(twilioResponse.status).json({ error: payload.message ?? `Twilio returned ${twilioResponse.status}` })
      return
    }

    response.status(200).json({
      mode: 'twilio',
      status: payload.status ?? 'queued',
      message,
      twilioMessageSid: payload.sid,
    })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

function buildCheckInMessage(body: CheckInRequest & { patientPhone: string; specialty: string }): string {
  const providerName = body.providerName?.trim() || 'Dr. Oliver Aalami'
  const greeting = body.patientName ? `Hi ${firstName(body.patientName)},` : 'Hello,'
  const invite = `this is Abby, ${providerName}'s assistant. Please start your quick ${body.specialty} check-in`
  return body.chatUrl
    ? `${greeting} ${invite} here: ${body.chatUrl}`
    : `${greeting} ${invite} before your visit.`
}

function parseBody(body: unknown) {
  if (typeof body === 'string') return JSON.parse(body) as Record<string, unknown>
  if (body && typeof body === 'object') return body as Record<string, unknown>
  return {}
}

function normalizeCheckIn(value: Record<string, unknown>): CheckInRequest & { patientPhone: string; specialty: string } {
  const patientPhone = normalizePhone(value.patientPhone)
  const specialty = typeof value.specialty === 'string' && value.specialty.trim() ? value.specialty.trim().toLowerCase() : 'vascular surgery'
  if (!patientPhone) throw new Error('patientPhone is required')
  return {
    patientId: typeof value.patientId === 'string' ? value.patientId : undefined,
    patientName: typeof value.patientName === 'string' ? value.patientName.trim() : undefined,
    patientPhone,
    providerName: typeof value.providerName === 'string' ? value.providerName.trim() : undefined,
    specialty,
    chatUrl: normalizeUrl(value.chatUrl),
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : undefined
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  return digits ? `+${digits}` : ''
}

function getTwilioMessagingConfig(): TwilioMessagingConfig | undefined {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID_ABBY ?? process.env.TWILIO_MESSAGING_SERVICE_SID
  const fromNumber = process.env.TWILIO_FROM_NUMBER_ABBY ?? process.env.TWILIO_FROM_NUMBER
  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) return undefined
  return { accountSid, authToken, messagingServiceSid, fromNumber }
}

function twilioAuthorization(config: TwilioMessagingConfig): string {
  return `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`
}
