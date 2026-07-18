import { googlePersistenceLabel, readGoogleJson, writeGoogleJson } from './googleCloudStore.js'

type Role = 'superadmin' | 'provider' | 'patient'

type DirectoryPerson = {
  id: string
  name: string
  phone: string
  roles: Role[]
  specialty?: string
  primaryProviderId?: string
  createdAt: string
  updatedAt: string
}

type DirectoryStore = {
  people: DirectoryPerson[]
  otp: Record<string, { code: string; expiresAt: string; verifiedAt?: string }>
}

type AbbyGlobal = typeof globalThis & {
  abbyDirectoryStore?: DirectoryStore
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

const firestoreDocumentId = 'directory-v1'
const seededAt = '2026-07-18T19:30:00Z'
const store = ((globalThis as AbbyGlobal).abbyDirectoryStore ??= {
  people: [
    {
      id: 'person-oliver-aalami',
      name: 'Oliver Aalami',
      phone: '+16503153236',
      roles: ['superadmin'],
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: 'person-maya-chen',
      name: 'Maya Chen',
      phone: '+14155550118',
      roles: ['provider'],
      specialty: 'Care Navigation',
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: 'person-lena-morales',
      name: 'Lena Morales',
      phone: '+14155550124',
      roles: ['patient'],
      primaryProviderId: 'person-maya-chen',
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: 'person-sam-patel',
      name: 'Sam Patel',
      phone: '+14155550142',
      roles: ['patient', 'provider'],
      specialty: 'Physical Therapy',
      primaryProviderId: 'person-oliver-aalami',
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  ],
  otp: {},
})

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const current = await readStore()

    if (request.method === 'GET') {
      response.status(200).json(toResponse(current))
      return
    }

    if (request.method === 'POST') {
      const body = parseBody(request.body)
      if (body.action === 'send-otp') {
        const phone = normalizePhone(body.phone)
        const code = String(Math.floor(100000 + Math.random() * 900000))
        current.otp[phone] = { code, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }
        await sendOtp(phone, code)
        await writeStore(current)
        response.status(200).json({ ...toResponse(current), otp: { mode: hasTwilioVerify() ? 'twilio-verify' : 'mock', phone, demoCode: hasTwilioVerify() ? undefined : code } })
        return
      }

      if (body.action === 'verify-otp') {
        const phone = normalizePhone(body.phone)
        const code = typeof body.code === 'string' ? body.code.trim() : ''
        const challenge = current.otp[phone]
        const verified = hasTwilioVerify()
          ? await verifyOtp(phone, code)
          : Boolean(challenge && challenge.code === code && new Date(challenge.expiresAt).getTime() >= Date.now())
        if (!verified) {
          response.status(401).json({ error: 'Invalid or expired code' })
          return
        }
        challenge.verifiedAt = new Date().toISOString()
        await writeStore(current)
        response.status(200).json({ ...toResponse(current), session: { phone, roles: current.people.find((person) => person.phone === phone)?.roles ?? [] } })
        return
      }

      const person = normalizePerson(body.person, current.people)
      const existingIndex = current.people.findIndex((item) => item.id === person.id || item.phone === person.phone)
      if (existingIndex >= 0) current.people[existingIndex] = { ...current.people[existingIndex], ...person, updatedAt: new Date().toISOString() }
      else current.people.unshift(person)
      await writeStore(current)
      response.status(200).json(toResponse(current))
      return
    }

    if (request.method === 'DELETE') {
      const body = parseBody(request.body)
      const id = typeof body.id === 'string' ? body.id : ''
      const phone = normalizePhone(body.phone)
      const before = current.people.length
      current.people = current.people.filter((person) => person.id !== id && person.phone !== phone)
      await writeStore(current)
      response.status(200).json({ ...toResponse(current), removed: before - current.people.length })
      return
    }

    response.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

function toResponse(current: DirectoryStore) {
  const people = [...current.people].sort((a, b) => {
    const priority = Number(b.roles.includes('superadmin')) - Number(a.roles.includes('superadmin'))
    return priority || a.name.localeCompare(b.name)
  })
  return {
    service: 'abby',
    persistence: googlePersistenceLabel(),
    auth: hasTwilioVerify() ? 'twilio-verify' : 'mock-otp',
    people,
    counts: {
      people: people.length,
      superadmins: people.filter((person) => person.roles.includes('superadmin')).length,
      providers: people.filter((person) => person.roles.includes('provider')).length,
      patients: people.filter((person) => person.roles.includes('patient')).length,
    },
  }
}

function parseBody(body: unknown) {
  if (typeof body === 'string') return JSON.parse(body) as Record<string, unknown>
  if (body && typeof body === 'object') return body as Record<string, unknown>
  return {}
}

function normalizePerson(value: unknown, people: DirectoryPerson[]): DirectoryPerson {
  if (!value || typeof value !== 'object') throw new Error('person is required')
  const input = value as Partial<DirectoryPerson>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const phone = normalizePhone(input.phone)
  const roles = normalizeRoles(input.roles)
  if (!name) throw new Error('name is required')
  if (!phone) throw new Error('phone is required')
  if (!roles.length) throw new Error('at least one role is required')
  const existing = people.find((person) => person.id === input.id || person.phone === phone)
  const now = new Date().toISOString()
  return {
    id: input.id || existing?.id || `person-${slugify(name)}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    phone,
    roles,
    specialty: typeof input.specialty === 'string' ? input.specialty.trim() : undefined,
    primaryProviderId: typeof input.primaryProviderId === 'string' ? input.primaryProviderId : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function normalizeRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<Role>(['superadmin', 'provider', 'patient'])
  return [...new Set(value.filter((role): role is Role => typeof role === 'string' && allowed.has(role as Role)))]
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  return digits ? `+${digits}` : ''
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user'
}

async function readStore(): Promise<DirectoryStore> {
  return readGoogleJson(firestoreDocumentId, store)
}

async function writeStore(nextStore: DirectoryStore): Promise<void> {
  store.people = nextStore.people
  store.otp = nextStore.otp
  await writeGoogleJson(firestoreDocumentId, nextStore)
}

async function sendOtp(phone: string, _code: string) {
  if (!hasTwilioVerify()) return
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? ''
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? ''
  const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID ?? ''
  const twilioResponse = await fetch(`https://verify.twilio.com/v2/Services/${verifySid}/Verifications`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Channel: 'sms' }),
  })
  if (!twilioResponse.ok) throw new Error(`Twilio returned ${twilioResponse.status}`)
}

async function verifyOtp(phone: string, code: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? ''
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? ''
  const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID ?? ''
  const twilioResponse = await fetch(`https://verify.twilio.com/v2/Services/${verifySid}/VerificationCheck`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Code: code }),
  })
  const payload = await twilioResponse.json() as { status?: string }
  return twilioResponse.ok && payload.status === 'approved'
}

function hasTwilioVerify() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID)
}
