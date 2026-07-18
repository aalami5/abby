import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import records from '../public/data/synthetic-ambient-fhir-25.json' with { type: 'json' }
import { readGoogleJson, writeGoogleJson } from './googleCloudStore.js'

type SyntheticRecord = (typeof records)[number]

type StoredRun = {
  id: string
  caseId: string
  stage: string
  approvedAt?: string
  approvedBy?: string
  transcript?: Array<{ prompt?: string; answer?: string }>
}

type RunsStore = { runsByCase: Record<string, StoredRun> }

type PatientSessionClaims = {
  careId: string
  recordId: string
  patientId: string
  issuedAt: number
  expiresAt: number
}

export type PatientPlan = {
  workflow: 'pre_visit_intake' | 'post_visit_followthrough'
  patientFirstName: string
  providerName: string
  visitTitle: string
  visitDate: string
  approvedBy?: string
  approvedAt?: string
  facts: string[]
  education: Array<{ id: string; title: string; content: string }>
  allowedActions: Array<{ id: string; type: string; label: string; instructions: string }>
  escalationRules: Array<{ id: string; severity: string; trigger: string; patientMessage: string }>
  openingMessage: string
  suggestedReplies: string[]
  history?: Array<{ id: string; sender: 'patient' | 'abby'; content: string; timestamp: string }>
}

type AuditEvent = {
  id: string
  careId: string
  recordId: string
  sessionId?: string
  type: string
  content: unknown
  createdAt: string
}

type AuditStore = { events: AuditEvent[] }

const providerName = 'Dr. Oliver Aalami'
const runFallback = ((globalThis as typeof globalThis & { abbyRunsStore?: RunsStore }).abbyRunsStore ??= { runsByCase: {} })
const auditFallback = ((globalThis as typeof globalThis & { abbyPatientAudit?: AuditStore }).abbyPatientAudit ??= { events: [] })

export function normalizeCareId(value: unknown): string {
  return typeof value === 'string' ? decodeURIComponent(value).trim().slice(0, 160) : ''
}

export function resolveRecord(careId: string): SyntheticRecord {
  const record = records.find((item) =>
    item.id === careId
    || item.metadata.patient_id === careId
    || (careId === 'demo-cardiovascular' && item.metadata.visit_title.includes('geriatric cardiometabolic')),
  )
  if (!record) throw new PatientApiError(404, 'care_link_not_found')
  return record
}

export async function buildPatientPlan(careId: string): Promise<PatientPlan> {
  const record = resolveRecord(careId)
  const store = await readGoogleJson<RunsStore>('runs-v1', runFallback)
  const run = store.runsByCase[record.id]
  const postVisit = run?.stage === 'approved' || run?.stage === 'executed'
  const name = record.patient_context.patient.name?.[0]
  const patientFirstName = name?.given?.[0] ?? 'there'
  const planLines = extractPlanLines(record.after_visit_summary || record.note)
  const facts = [
    `Your visit was for ${record.metadata.visit_title.toLowerCase()}.`,
    ...planLines.slice(0, 3),
  ]

  if (!postVisit) {
    return {
      workflow: 'pre_visit_intake',
      patientFirstName,
      providerName,
      visitTitle: record.metadata.visit_title,
      visitDate: record.metadata.date,
      facts: [],
      education: [],
      allowedActions: [],
      escalationRules: standardEscalations(),
      openingMessage: `Hi ${patientFirstName}, I’m Abby. I’ll help ${providerName} prepare for your visit. You can talk or type, and you can replay anything I say. What would you most like the care team to understand today?`,
      suggestedReplies: ['My symptoms changed', 'I have a medication question', 'Something else'],
    }
  }

  return {
    workflow: 'post_visit_followthrough',
    patientFirstName,
    providerName,
    visitTitle: record.metadata.visit_title,
    visitDate: record.metadata.date,
    approvedBy: run.approvedBy ?? providerName,
    approvedAt: run.approvedAt,
    facts,
    education: [{
      id: 'visit-plan-review',
      title: 'Your clinician-approved plan',
      content: planLines.slice(0, 3).join(' '),
    }],
    allowedActions: [
      {
        id: 'request-follow-up',
        type: 'schedule_follow_up',
        label: 'Request a follow-up appointment',
        instructions: 'Record the patient’s preferred timing for care-team scheduling review.',
      },
      {
        id: 'send-question-to-care-team',
        type: 'care_team_question',
        label: 'Send a question to the care team',
        instructions: 'Record the patient’s exact question without adding clinical conclusions.',
      },
    ],
    escalationRules: standardEscalations(),
    openingMessage: `Hi ${patientFirstName}, I’m Abby. I’m here to help you follow the plan ${providerName} approved after your visit. Would you like me to explain the plan, check what you understood, or help with a next step?`,
    suggestedReplies: ['Explain my plan', 'Check my understanding', 'Help with a next step'],
  }
}

export function patientPhoneHint(careId: string): string {
  const configured = configuredDemoPhone(careId)
  if (configured) return `••• ••• ${configured.slice(-4)}`
  const record = resolveRecord(careId)
  const index = records.findIndex((item) => item.id === record.id)
  return `••• ••• ${String(index + 1).padStart(4, '0')}`
}

export function expectedPatientPhone(careId: string): string {
  const configured = configuredDemoPhone(careId)
  if (configured) return configured
  const record = resolveRecord(careId)
  const index = records.findIndex((item) => item.id === record.id)
  return `+1555012${String(index + 1).padStart(4, '0')}`
}

function configuredDemoPhone(careId: string): string {
  if (careId !== 'demo-cardiovascular') return ''
  return normalizePhone(process.env.ABBY_DEMO_PATIENT_PHONE)
}

export function normalizePhone(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.startsWith('+')) return `+${raw.slice(1).replace(/\D/g, '')}`
  const digits = raw.replace(/\D/g, '')
  return digits.length === 10 ? `+1${digits}` : digits ? `+${digits}` : ''
}

export function createPatientSession(careId: string): string {
  const record = resolveRecord(careId)
  const now = Math.floor(Date.now() / 1000)
  const claims: PatientSessionClaims = {
    careId,
    recordId: record.id,
    patientId: record.metadata.patient_id,
    issuedAt: now,
    expiresAt: now + 30 * 60,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function requirePatientSession(request: { headers?: Record<string, string | string[] | undefined> }): PatientSessionClaims {
  const raw = header(request, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1] ?? ''
  const [payload, signature] = raw.split('.')
  if (!payload || !signature) throw new PatientApiError(401, 'patient_verification_required')
  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(signature)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new PatientApiError(401, 'invalid_patient_session')
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PatientSessionClaims
  if (claims.expiresAt <= Math.floor(Date.now() / 1000)) throw new PatientApiError(401, 'patient_session_expired')
  const record = resolveRecord(claims.careId)
  if (record.id !== claims.recordId || record.metadata.patient_id !== claims.patientId) {
    throw new PatientApiError(401, 'invalid_patient_session')
  }
  return claims
}

export function requireAgentSecret(request: { headers?: Record<string, string | string[] | undefined> }) {
  const configured = process.env.ABBY_AGENT_SERVICE_SECRET ?? ''
  const supplied = header(request, 'x-abby-agent-secret')
  const expected = Buffer.from(configured)
  const actual = Buffer.from(supplied)
  if (!configured || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new PatientApiError(401, 'invalid_agent_credentials')
  }
}

export async function appendAuditEvent(input: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<AuditEvent> {
  const store = await readGoogleJson<AuditStore>('patient-audit-v1', auditFallback)
  const event = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }
  store.events.push(event)
  store.events = store.events.slice(-500)
  auditFallback.events = store.events
  await writeGoogleJson('patient-audit-v1', store)
  return event
}

export async function loadConversationHistory(careId: string) {
  const store = await readGoogleJson<AuditStore>('patient-audit-v1', auditFallback)
  return store.events
    .filter((event) => event.careId === careId && event.type === 'patient_chat_turn')
    .slice(-10)
    .flatMap((event) => {
      const content = event.content as { patient?: unknown; abby?: unknown }
      const messages: Array<{
        id: string
        sender: 'patient' | 'abby'
        content: string
        timestamp: string
      }> = []
      if (typeof content.patient === 'string') {
        messages.push({
          id: `${event.id}-patient`,
          sender: 'patient',
          content: content.patient,
          timestamp: event.createdAt,
        })
      }
      if (typeof content.abby === 'string') {
        messages.push({
          id: `${event.id}-abby`,
          sender: 'abby',
          content: content.abby,
          timestamp: event.createdAt,
        })
      }
      return messages
    })
}

export function sendApiError(response: ApiResponse, error: unknown) {
  if (error instanceof PatientApiError) {
    response.status(error.status).json({ error: error.code })
    return
  }
  console.error('Abby patient API error', error)
  response.status(500).json({ error: 'internal_error' })
}

export class PatientApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export type ApiRequest = {
  method?: string
  body?: unknown
  query?: Record<string, string | string[] | undefined>
  headers?: Record<string, string | string[] | undefined>
}

export type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void }
}

function header(request: ApiRequest, name: string): string {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function sign(payload: string): string {
  const secret = process.env.ABBY_SESSION_SECRET
    ?? (process.env.VERCEL_ENV === 'production' ? '' : 'abby-local-session-secret')
  if (!secret) throw new PatientApiError(503, 'patient_sessions_not_configured')
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function extractPlanLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^[-#*\d.\s]+/, '').trim())
    .filter((line) => line.length >= 30 && line.length <= 280)
    .slice(0, 5)
}

function standardEscalations() {
  return [{
    id: 'urgent-symptoms',
    severity: 'urgent',
    trigger: 'New chest pressure, severe trouble breathing, fainting, stroke symptoms, severe bleeding, suicidal thoughts, or rapidly worsening symptoms.',
    patientMessage: 'This may need urgent medical attention. Call local emergency services now and follow your care team’s emergency instructions.',
  }]
}
