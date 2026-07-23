import { googlePersistenceLabel, readGoogleJson, writeGoogleJson } from './googleCloudStore.js'
import records from '../public/data/synthetic-ambient-fhir-25.json' with { type: 'json' }

type Role = 'admin' | 'superadmin' | 'provider' | 'patient'

type DirectoryPerson = {
  id: string
  name: string
  phone: string
  roles: Role[]
  specialty?: string
  abbyInstructions?: string
  abbyInstructionsTitle?: string
  abbyInstructionsSourceFile?: string
  abbyInstructionsSourcePath?: string
  abbyInstructionsSourceUrl?: string
  abbyInstructionsAudience?: string
  primaryProviderId?: string
  gender?: string
  birthDate?: string
  city?: string
  state?: string
  visitTitle?: string
  sourceRecordId?: string
  synthetic?: boolean
  createdAt: string
  updatedAt: string
}

type AgentInstructionReference = {
  id: string
  title: string
  sourceFile: string
  sourcePath: string
  sourceUrl: string
  audience: string
  ownerPersonId: string
  instructionField: 'abbyInstructions'
  updatedAt: string
}

type DirectoryStore = {
  people: DirectoryPerson[]
  agentInstructionReferences?: AgentInstructionReference[]
  otp: Record<string, { code: string; expiresAt: string; verifiedAt?: string }>
}

type TwilioVerifyConfig = {
  accountSid: string
  authToken: string
  verifyServiceSid: string
}

type TwilioMessagingConfig = {
  accountSid: string
  authToken: string
  messagingServiceSid?: string
  fromNumber?: string
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
const store = ((globalThis as AbbyGlobal).abbyDirectoryStore ??= { people: seedPeople(), agentInstructionReferences: seedAgentInstructionReferences(), otp: {} })

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
        const normalized = await writeStore(current)
        response.status(200).json({
          ...toResponse(normalized),
          otp: {
            mode: otpMode(),
            phone,
            demoCode: hasTwilioOtp() ? undefined : code,
          },
        })
        return
      }

      if (body.action === 'verify-otp') {
        const phone = normalizePhone(body.phone)
        const code = typeof body.code === 'string' ? body.code.trim() : ''
        const challenge = current.otp[phone]
        const verified = otpMode() === 'twilio-verify'
          ? await verifyOtp(phone, code)
          : isStoredOtpValid(challenge, code)
        if (!verified) {
          response.status(401).json({ error: 'Invalid or expired code' })
          return
        }
        if (challenge) challenge.verifiedAt = new Date().toISOString()
        const normalized = await writeStore(current)
        response.status(200).json({ ...toResponse(normalized), session: { phone, roles: normalized.people.find((person) => person.phone === phone)?.roles ?? [] } })
        return
      }

      const person = normalizePerson(body.person, current.people)
      const existingIndex = current.people.findIndex((item) => isSameDirectoryPerson(item, person))
      if (existingIndex >= 0) current.people[existingIndex] = { ...current.people[existingIndex], ...person, updatedAt: new Date().toISOString() }
      else current.people.unshift(person)
      const normalized = await writeStore(current)
      response.status(200).json(toResponse(normalized))
      return
    }

    if (request.method === 'DELETE') {
      const body = parseBody(request.body)
      const id = typeof body.id === 'string' ? body.id : ''
      const phone = normalizePhone(body.phone)
      const before = current.people.length
      current.people = current.people.filter((person) => person.id !== id && person.phone !== phone)
      const normalized = await writeStore(current)
      response.status(200).json({ ...toResponse(normalized), removed: before - normalized.people.length })
      return
    }

    response.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

function toResponse(current: DirectoryStore) {
  const people = [...current.people].sort((a, b) => {
    const priority = Number(hasAdminRole(b)) - Number(hasAdminRole(a))
    return priority || a.name.localeCompare(b.name)
  })
  const admins = people.filter(hasAdminRole).length
  return {
    service: 'abby',
    persistence: googlePersistenceLabel(),
    auth: otpMode() === 'twilio-verify' ? 'twilio-verify' : otpMode() === 'twilio-sms' ? 'twilio-sms' : 'mock-otp',
    people,
    agentInstructionReferences: current.agentInstructionReferences ?? seedAgentInstructionReferences(),
    counts: {
      people: people.length,
      admins,
      superadmins: admins,
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
  const existing = people.find((person) => (
    (input.id && person.id === input.id) ||
    (input.sourceRecordId && person.sourceRecordId === input.sourceRecordId) ||
    person.phone === phone
  ))
  const now = new Date().toISOString()
  return {
    id: input.id || existing?.id || `person-${slugify(name)}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    phone,
    roles,
    specialty: typeof input.specialty === 'string' ? input.specialty.trim() : existing?.specialty,
    abbyInstructions: typeof input.abbyInstructions === 'string' ? input.abbyInstructions : existing?.abbyInstructions,
    abbyInstructionsTitle: typeof input.abbyInstructionsTitle === 'string' ? input.abbyInstructionsTitle.trim() : existing?.abbyInstructionsTitle,
    abbyInstructionsSourceFile: typeof input.abbyInstructionsSourceFile === 'string' ? input.abbyInstructionsSourceFile.trim() : existing?.abbyInstructionsSourceFile,
    abbyInstructionsSourcePath: typeof input.abbyInstructionsSourcePath === 'string' ? input.abbyInstructionsSourcePath.trim() : existing?.abbyInstructionsSourcePath,
    abbyInstructionsSourceUrl: typeof input.abbyInstructionsSourceUrl === 'string' ? input.abbyInstructionsSourceUrl.trim() : existing?.abbyInstructionsSourceUrl,
    abbyInstructionsAudience: typeof input.abbyInstructionsAudience === 'string' ? input.abbyInstructionsAudience.trim() : existing?.abbyInstructionsAudience,
    primaryProviderId: typeof input.primaryProviderId === 'string' ? input.primaryProviderId : existing?.primaryProviderId,
    gender: typeof input.gender === 'string' ? input.gender.trim() : existing?.gender,
    birthDate: typeof input.birthDate === 'string' ? input.birthDate.trim() : existing?.birthDate,
    city: typeof input.city === 'string' ? input.city.trim() : existing?.city,
    state: typeof input.state === 'string' ? input.state.trim() : existing?.state,
    visitTitle: typeof input.visitTitle === 'string' ? input.visitTitle.trim() : existing?.visitTitle,
    sourceRecordId: typeof input.sourceRecordId === 'string' ? input.sourceRecordId : existing?.sourceRecordId,
    synthetic: Boolean(input.synthetic ?? existing?.synthetic),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function isSameDirectoryPerson(left: DirectoryPerson, right: DirectoryPerson): boolean {
  return (
    left.id === right.id ||
    Boolean(left.sourceRecordId && left.sourceRecordId === right.sourceRecordId) ||
    left.phone === right.phone
  )
}

function normalizeRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<Role>(['admin', 'superadmin', 'provider', 'patient'])
  return [...new Set(value.filter((role): role is Role => typeof role === 'string' && allowed.has(role as Role)).map((role) => role === 'superadmin' ? 'admin' : role))]
}

function mergeSeedRoles(seedRoles: Role[], existingRoles: Role[]): Role[] {
  const normalizedExisting = normalizeRoles(existingRoles)
  return [...new Set([...seedRoles, ...normalizedExisting])]
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
  const current = await readGoogleJson(firestoreDocumentId, store)
  const normalized = normalizeSeededStore(current)
  store.people = normalized.people
  store.agentInstructionReferences = normalized.agentInstructionReferences
  store.otp = normalized.otp
  if (JSON.stringify(current) !== JSON.stringify(normalized)) {
    await writeGoogleJson(firestoreDocumentId, normalized)
  }
  return normalized
}

async function writeStore(nextStore: DirectoryStore): Promise<DirectoryStore> {
  const normalized = normalizeSeededStore(nextStore)
  store.people = normalized.people
  store.agentInstructionReferences = normalized.agentInstructionReferences
  store.otp = normalized.otp
  await writeGoogleJson(firestoreDocumentId, normalized)
  return normalized
}

function normalizeSeededStore(current: DirectoryStore): DirectoryStore {
  const seeds = seedPeople()
  const seedIds = new Set(seeds.map((person) => person.id))
  const byId = new Map(current.people.map((person) => [person.id, person]))
  const bySourceRecordId = new Map(current.people.filter((person) => person.sourceRecordId).map((person) => [person.sourceRecordId, person]))
  const people = seeds.map((seed) => {
    const sameNamePatient = current.people
      .filter((person) => !person.sourceRecordId && person.roles.includes('patient') && normalizeName(person.name) === normalizeName(seed.name))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
    const existing = sameNamePatient ?? byId.get(seed.id) ?? (seed.sourceRecordId ? bySourceRecordId.get(seed.sourceRecordId) : undefined)
    return existing
      ? {
          ...seed,
          name: existing.name || seed.name,
          phone: existing.phone || seed.phone,
          roles: mergeSeedRoles(seed.roles, existing.roles),
          specialty: existing.specialty,
          abbyInstructions: existing.abbyInstructions ?? seed.abbyInstructions,
          abbyInstructionsTitle: existing.abbyInstructionsTitle ?? seed.abbyInstructionsTitle,
          abbyInstructionsSourceFile: existing.abbyInstructionsSourceFile ?? seed.abbyInstructionsSourceFile,
          abbyInstructionsSourcePath: existing.abbyInstructionsSourcePath ?? seed.abbyInstructionsSourcePath,
          abbyInstructionsSourceUrl: existing.abbyInstructionsSourceUrl ?? seed.abbyInstructionsSourceUrl,
          abbyInstructionsAudience: existing.abbyInstructionsAudience ?? seed.abbyInstructionsAudience,
          primaryProviderId: existing.primaryProviderId ?? seed.primaryProviderId,
          gender: existing.gender ?? seed.gender,
          birthDate: existing.birthDate ?? seed.birthDate,
          city: existing.city ?? seed.city,
          state: existing.state ?? seed.state,
          visitTitle: existing.visitTitle ?? seed.visitTitle,
          sourceRecordId: existing.sourceRecordId ?? seed.sourceRecordId,
          synthetic: existing.sourceRecordId ? existing.synthetic : seed.synthetic,
          createdAt: existing.createdAt || seed.createdAt,
          updatedAt: existing.updatedAt || seed.updatedAt,
        }
      : seed
  })
  const removedStarterIds = new Set(['person-maya-chen', 'person-lena-morales', 'person-sam-patel'])
  const additionalUsers = current.people.filter((person) => (
    !seedIds.has(person.id) &&
    !removedStarterIds.has(person.id) &&
    !people.some((seededPerson) => (
      person.id === seededPerson.id ||
      person.phone === seededPerson.phone ||
      Boolean(person.sourceRecordId && person.sourceRecordId === seededPerson.sourceRecordId) ||
      (!person.sourceRecordId && person.roles.includes('patient') && normalizeName(person.name) === normalizeName(seededPerson.name))
    ))
  ))
  for (const user of additionalUsers) {
    if (!people.some((person) => person.id === user.id || person.phone === user.phone)) people.push(user)
  }
  return {
    people,
    agentInstructionReferences: current.agentInstructionReferences?.length
      ? current.agentInstructionReferences
      : seedAgentInstructionReferences(),
    otp: current.otp ?? {},
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function seedAgentInstructionReferences(): AgentInstructionReference[] {
  return [
    {
      id: 'abby-app-instructions',
      title: 'Abby App Instructions',
      sourceFile: 'ABBY_INSTRUCTIONS.md',
      sourcePath: '/ABBY_INSTRUCTIONS.md',
      sourceUrl: 'https://github.com/aalami5/abby/blob/main/ABBY_INSTRUCTIONS.md',
      audience: 'provider-facing agent instructions',
      ownerPersonId: 'person-oliver-aalami',
      instructionField: 'abbyInstructions',
      updatedAt: seededAt,
    },
  ]
}

function seedPeople(): DirectoryPerson[] {
  return [oliverAdmin(), ...demoProviders(), ...syntheticPatients()]
}

function oliverAdmin(): DirectoryPerson {
  return {
    id: 'person-oliver-aalami',
    name: 'Oliver Aalami',
    phone: '+16503153236',
    roles: ['admin', 'provider', 'patient'],
    specialty: 'Vascular Surgery',
    primaryProviderId: 'person-oliver-aalami',
    abbyInstructionsTitle: 'Abby App Instructions',
    abbyInstructionsSourceFile: 'ABBY_INSTRUCTIONS.md',
    abbyInstructionsSourcePath: '/ABBY_INSTRUCTIONS.md',
    abbyInstructionsSourceUrl: 'https://github.com/aalami5/abby/blob/main/ABBY_INSTRUCTIONS.md',
    abbyInstructionsAudience: 'provider-facing agent instructions',
    abbyInstructions: [
      '# Abby App Instructions',
      '',
      'Provider: Dr. Oliver Aalami',
      'Specialty: Vascular Surgery',
      '',
      'Use a vascular-surgery lens for patient outreach and provider briefs.',
      'Prioritize cardiovascular risk, limb symptoms, wound status, medication adherence, and urgent red flags.',
      'Always adapt the patient-facing conversation to the care setting. Inpatient chats should use a rounding-style check-in about the hospital stay, overnight changes, acute symptom trajectory, comfort, and the patient\'s biggest concern that morning. Outpatient chats should use a pre-visit check-in about the primary symptom or visit reason, interval changes, symptom impact, medications, barriers, and priorities for the visit.',
      'Keep patient interviews focused: do not invent daily activity examples, hobbies, distances, or home details; ask one direct question per section and move on quickly.',
      'Keep patient-facing language concise, calm, and action-oriented.',
      'Do not start every reply with thanks or the patient name; use the name mainly in the greeting or when it sounds natural.',
    ].join('\n'),
    createdAt: seededAt,
    updatedAt: seededAt,
  }
}

function demoProviders(): DirectoryPerson[] {
  return [
    {
      id: 'person-maya-chen-cardiology',
      name: 'Maya Chen',
      phone: '+15550120051',
      roles: ['provider'],
      specialty: 'Cardiology',
      abbyInstructions: [
        'Provider: Dr. Maya Chen',
        'Specialty: Cardiology',
        'Focus on blood pressure, chest pain, dyspnea, edema, lipid control, medication adherence, and escalation for cardiac red flags.',
      ].join('\n'),
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: 'person-sam-patel-primary-care',
      name: 'Sam Patel',
      phone: '+15550120052',
      roles: ['provider'],
      specialty: 'Internal Medicine',
      abbyInstructions: [
        'Provider: Dr. Sam Patel',
        'Specialty: Internal Medicine',
        'Take a broad primary-care view. Reconcile medications, chronic conditions, preventive care gaps, and patient priorities for the visit.',
      ].join('\n'),
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: 'person-lena-morales-endocrinology',
      name: 'Lena Morales',
      phone: '+15550120053',
      roles: ['provider'],
      specialty: 'Endocrinology',
      abbyInstructions: [
        'Provider: Dr. Lena Morales',
        'Specialty: Endocrinology',
        'Prioritize diabetes control, medication side effects, hypoglycemia risk, weight change, thyroid symptoms, and lab follow-up.',
      ].join('\n'),
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  ]
}

function hasAdminRole(person: DirectoryPerson): boolean {
  return person.roles.some((role) => role === 'admin' || role === 'superadmin')
}

function syntheticPatients(): DirectoryPerson[] {
  return (records as Array<{
    id: string
    metadata: { patient_id: string; visit_title: string }
    patient_context: {
      longitudinal_summary?: { condition_labels?: string[] }
      patient: {
        gender?: string
        birthDate?: string
        name?: Array<{ family?: string; given?: string[] }>
        address?: Array<{ city?: string; state?: string }>
      }
    }
  }>).map((record, index) => {
    const patient = record.patient_context.patient
    const address = patient.address?.[0]
    return {
      id: `patient-${record.metadata.patient_id}`,
      name: patientName(patient),
      phone: syntheticPhone(index),
      roles: ['patient'],
      gender: patient.gender,
      birthDate: patient.birthDate,
      city: address?.city,
      state: address?.state,
      visitTitle: record.metadata.visit_title,
      primaryProviderId: isCardiovascularPatient(record) ? 'person-oliver-aalami' : undefined,
      sourceRecordId: record.id,
      synthetic: true,
      createdAt: seededAt,
      updatedAt: seededAt,
    }
  })
}

function isCardiovascularPatient(record: {
  metadata: { visit_title: string }
  patient_context: { longitudinal_summary?: { condition_labels?: string[] } }
}): boolean {
  const searchable = [
    record.metadata.visit_title,
    ...(record.patient_context.longitudinal_summary?.condition_labels ?? []),
  ].join(' ')
  return /\b(cardiovascular|cardiac|cardio|heart|coronary|ischemic|myocardial|infarction|hypertension|hyperlipidemia|vascular|stroke|angina|atrial|metabolic syndrome)\b/i.test(searchable)
}

function patientName(patient: { name?: Array<{ family?: string; given?: string[] }> }): string {
  const official = patient.name?.[0]
  return [official?.given?.[0], official?.family].filter(Boolean).join(' ') || 'Synthetic patient'
}

function syntheticPhone(index: number): string {
  return `+1555012${String(index + 1).padStart(4, '0')}`
}

async function sendOtp(phone: string, code: string) {
  if (hasTwilioMessaging()) {
    await sendOtpWithMessaging(phone, code)
    return
  }
  const twilio = getTwilioVerifyConfig()
  if (!twilio) return
  const twilioResponse = await fetch(`https://verify.twilio.com/v2/Services/${twilio.verifyServiceSid}/Verifications`, {
    method: 'POST',
    headers: {
      authorization: twilioAuthorization(twilio),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Channel: 'sms' }),
  })
  if (!twilioResponse.ok) throw new Error(`Twilio returned ${twilioResponse.status}`)
}

async function sendOtpWithMessaging(phone: string, code: string) {
  const twilio = getTwilioMessagingConfig()
  if (!twilio) return
  const twilioResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: twilioAuthorization(twilio),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: phone,
      Body: `Your Abby verification code is ${code}. It expires in 10 minutes.`,
      ...(twilio.messagingServiceSid ? { MessagingServiceSid: twilio.messagingServiceSid } : { From: twilio.fromNumber ?? '' }),
    }),
  })
  if (!twilioResponse.ok) throw new Error(`Twilio returned ${twilioResponse.status}`)
}

async function verifyOtp(phone: string, code: string) {
  const twilio = getTwilioVerifyConfig()
  if (!twilio) return false
  const twilioResponse = await fetch(`https://verify.twilio.com/v2/Services/${twilio.verifyServiceSid}/VerificationCheck`, {
    method: 'POST',
    headers: {
      authorization: twilioAuthorization(twilio),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Code: code }),
  })
  const payload = await twilioResponse.json() as { status?: string }
  return twilioResponse.ok && payload.status === 'approved'
}

function isStoredOtpValid(challenge: DirectoryStore['otp'][string] | undefined, code: string) {
  return Boolean(challenge && challenge.code === code && new Date(challenge.expiresAt).getTime() >= Date.now())
}

function hasTwilioVerify() {
  return Boolean(getTwilioVerifyConfig())
}

function hasTwilioMessaging() {
  return Boolean(getTwilioMessagingConfig())
}

function hasTwilioOtp() {
  return hasTwilioVerify() || hasTwilioMessaging()
}

function otpMode(): 'twilio-verify' | 'twilio-sms' | 'mock' {
  if (hasTwilioMessaging()) return 'twilio-sms'
  if (hasTwilioVerify()) return 'twilio-verify'
  return 'mock'
}

function getTwilioVerifyConfig(): TwilioVerifyConfig | undefined {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID_ABBY ?? process.env.TWILIO_VERIFY_SERVICE_SID
  if (!accountSid || !authToken || !verifyServiceSid) return undefined
  return { accountSid, authToken, verifyServiceSid }
}

function getTwilioMessagingConfig(): TwilioMessagingConfig | undefined {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID_ABBY ?? process.env.TWILIO_MESSAGING_SERVICE_SID
  const fromNumber = process.env.TWILIO_FROM_NUMBER_ABBY ?? process.env.TWILIO_FROM_NUMBER
  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) return undefined
  return { accountSid, authToken, messagingServiceSid, fromNumber }
}

function twilioAuthorization(config: TwilioVerifyConfig | TwilioMessagingConfig): string {
  return `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`
}
