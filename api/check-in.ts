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

type TwilioMessagePayload = {
  sid?: string
  status?: string
  message?: string
  error_code?: number | null
  error_message?: string | null
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
    const invalidDestination = invalidSmsDestinationReason(body.patientPhone)
    if (invalidDestination) {
      response.status(200).json({
        mode: 'twilio',
        status: 'failed',
        message,
        twilioErrorCode: 400,
        twilioErrorMessage: invalidDestination,
      })
      return
    }

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

    const payload = await twilioResponse.json() as TwilioMessagePayload
    if (!twilioResponse.ok) {
      response.status(200).json({
        mode: 'twilio',
        status: 'failed',
        message,
        twilioMessageSid: payload.sid,
        twilioErrorCode: payload.error_code ?? twilioResponse.status,
        twilioErrorMessage: payload.message ?? payload.error_message ?? `Twilio returned ${twilioResponse.status}`,
      })
      return
    }

    const statusPayload = payload.sid ? await pollTwilioMessageStatus(twilio, payload.sid) : payload

    response.status(200).json({
      mode: 'twilio',
      status: statusPayload.status ?? payload.status ?? 'queued',
      message,
      twilioMessageSid: payload.sid,
      twilioErrorCode: statusPayload.error_code ?? undefined,
      twilioErrorMessage: statusPayload.error_message ?? undefined,
    })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

async function pollTwilioMessageStatus(twilio: TwilioMessagingConfig, messageSid: string): Promise<TwilioMessagePayload> {
  let latest: TwilioMessagePayload = {}

  for (const delayMs of [900, 1800, 3200]) {
    await sleep(delayMs)
    const twilioResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages/${messageSid}.json`, {
      headers: { authorization: twilioAuthorization(twilio) },
    })
    const payload = await twilioResponse.json() as TwilioMessagePayload
    if (!twilioResponse.ok) return latest.status ? latest : payload

    latest = payload
    if (['sent', 'delivered', 'failed', 'undelivered'].includes(payload.status ?? '')) return payload
  }

  return latest
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildCheckInMessage(body: CheckInRequest & { patientPhone: string; specialty: string }): string {
  const providerName = providerDisplayName(body.providerName) || 'Dr. Oliver Aalami'
  const greeting = body.patientName ? `Hi ${firstName(body.patientName)},` : 'Hello,'
  const invite = `this is Abby, ${providerName}'s assistant. You can start your quick ${body.specialty} check-in`
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

function providerDisplayName(name?: string): string {
  const trimmed = name?.trim() ?? ''
  if (!trimmed) return ''
  if (/^dr\.\s+/i.test(trimmed)) return trimmed
  return `Dr. ${trimmed}`
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

function invalidSmsDestinationReason(phone: string): string {
  if (!/^\+\d{10,15}$/.test(phone)) return 'Enter a valid cell phone number before starting check-in.'

  const digits = phone.slice(1)
  if (!digits.startsWith('1') || digits.length !== 11) return ''

  const areaCode = digits.slice(1, 4)
  const exchange = digits.slice(4, 7)
  const lineNumber = digits.slice(7)
  if (/^[01]/.test(areaCode) || /^[01]/.test(exchange)) {
    return 'Enter a valid US cell phone number before starting check-in.'
  }
  if (areaCode === '555' || (exchange === '555' && /^01\d\d$/.test(lineNumber))) {
    return 'The seeded 555 demo number cannot receive texts. Save the patient’s real cell phone, then start check-in.'
  }

  return ''
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
