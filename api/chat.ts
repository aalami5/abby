import { googlePersistenceLabel, readGoogleJson, writeGoogleJson } from './googleCloudStore.js'
import records from '../public/data/synthetic-ambient-fhir-25.json' with { type: 'json' }

type ChatSender = 'patient' | 'abby'

type ChatMessage = {
  id?: string
  sender: ChatSender
  content: string
  timestamp?: string
}

type ChatContext = {
  patient?: {
    name?: string
    id?: string
    directoryPersonId?: string
    sourceRecordId?: string
    age?: number
    gender?: string
    city?: string
    state?: string
    visitTitle?: string
    conditions?: string[]
    medications?: string[]
    signals?: Array<{ label?: string; value?: string; severity?: string; source?: string }>
    openQuestions?: string[]
    actionItems?: string[]
    transcriptExcerpt?: string
    noteExcerpt?: string
    afterVisitSummaryExcerpt?: string
  }
  specialist?: {
    name?: string
    specialty?: string
    abbyInstructions?: string
  }
}

type DirectoryPerson = {
  id: string
  name: string
  phone: string
  roles: Array<'admin' | 'superadmin' | 'provider' | 'patient'>
  specialty?: string
  abbyInstructions?: string
  primaryProviderId?: string
  sourceRecordId?: string
  createdAt: string
  updatedAt: string
}

type DirectoryStore = {
  people: DirectoryPerson[]
  agentInstructionReferences?: unknown[]
  otp?: Record<string, unknown>
}

type ChatHistoryStore = {
  conversations: Record<string, {
    patientPersonId?: string
    patientSourceRecordId?: string
    providerPersonId?: string
    providerName?: string
    specialty?: string
    messages: ChatMessage[]
    updatedAt: string
  }>
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

const anthropicVersion = '2023-06-01'
const defaultModel = 'claude-sonnet-5'
const directoryDocumentId = 'directory-v1'
const patientChatDocumentId = 'patient-chat-v1'
const seededAt = '2026-07-18T19:30:00Z'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const body = parseBody(request.body)
    const messages = normalizeMessages(body.messages)
    if (!messages.length) {
      response.status(400).json({ error: 'messages are required' })
      return
    }

    const context = await resolveServerContext(normalizeContext(body.context))
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
    if (!apiKey) {
      const message = fallbackCheckInReply(context)
      await writeChatHistory(context, [...messages, message])
      response.status(200).json({
        message,
        model: 'abby-fallback',
        persistence: googlePersistenceLabel(),
      })
      return
    }

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': anthropicVersion,
      },
      body: JSON.stringify({
        model: process.env.ABBY_CLAUDE_MODEL || defaultModel,
        max_tokens: 520,
        system: buildSystemPrompt(context),
        messages: messages.map((message) => ({
          role: message.sender === 'patient' ? 'user' : 'assistant',
          content: message.content,
        })),
      }),
    })

    const payload = await anthropicResponse.json() as {
      content?: Array<{ type?: string; text?: string }>
      error?: { message?: string }
      model?: string
    }

    if (!anthropicResponse.ok) {
      response.status(anthropicResponse.status).json({ error: payload.error?.message ?? `Claude returned ${anthropicResponse.status}` })
      return
    }

    const text = payload.content?.find((item) => item.type === 'text')?.text?.trim()
    if (!text) {
      response.status(502).json({ error: 'Claude returned an empty response' })
      return
    }

    const message = {
      id: `abby-${Date.now()}`,
      sender: 'abby' as const,
      content: text,
      timestamp: new Date().toISOString(),
    }
    await writeChatHistory(context, [...messages, message])

    response.status(200).json({
      message,
      model: payload.model ?? process.env.ABBY_CLAUDE_MODEL ?? defaultModel,
      persistence: googlePersistenceLabel(),
    })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

async function resolveServerContext(context: ChatContext): Promise<ChatContext> {
  const directory = await readGoogleJson(directoryDocumentId, seedDirectoryStore())
  const patient = findDirectoryPatient(directory.people, context)
  const provider = findDirectoryProvider(directory.people, patient, context)
  if (!provider) return context
  return {
    ...context,
    patient: {
      ...context.patient,
      directoryPersonId: patient?.id ?? context.patient?.directoryPersonId,
      sourceRecordId: patient?.sourceRecordId ?? context.patient?.sourceRecordId,
    },
    specialist: {
      name: provider.name,
      specialty: provider.specialty || context.specialist?.specialty || 'care',
      abbyInstructions: provider.abbyInstructions,
    },
  }
}

function findDirectoryPatient(people: DirectoryPerson[], context: ChatContext): DirectoryPerson | undefined {
  const patient = context.patient
  if (!patient) return undefined
  return people.find((person) => (
    person.roles.includes('patient') && (
      person.id === patient.directoryPersonId ||
      person.sourceRecordId === patient.sourceRecordId ||
      person.id === `patient-${patient.id}` ||
      normalizeName(person.name) === normalizeName(patient.name ?? '')
    )
  ))
}

function findDirectoryProvider(people: DirectoryPerson[], patient: DirectoryPerson | undefined, context: ChatContext): DirectoryPerson | undefined {
  return (
    people.find((person) => person.id === patient?.primaryProviderId && person.roles.includes('provider')) ||
    people.find((person) => person.roles.includes('provider') && normalizeName(person.name) === normalizeName(context.specialist?.name ?? '')) ||
    people.find((person) => person.roles.includes('provider'))
  )
}

async function writeChatHistory(context: ChatContext, messages: ChatMessage[]) {
  const patient = context.patient
  const key = patient?.sourceRecordId || patient?.directoryPersonId || patient?.id
  if (!key) return
  const current = await readGoogleJson<ChatHistoryStore>(patientChatDocumentId, { conversations: {} })
  current.conversations[key] = {
    patientPersonId: patient.directoryPersonId,
    patientSourceRecordId: patient.sourceRecordId,
    providerName: context.specialist?.name,
    specialty: context.specialist?.specialty,
    messages: messages.slice(-64),
    updatedAt: new Date().toISOString(),
  }
  await writeGoogleJson(patientChatDocumentId, current)
}

function fallbackCheckInReply(context: ChatContext): ChatMessage & { id: string; timestamp: string } {
  const patient = context.patient ?? {}
  const specialist = context.specialist ?? {}
  const patientName = firstName(patient.name) || 'there'
  const specialty = specialist.specialty?.trim().toLowerCase() || 'care'
  return {
    id: `abby-fallback-${Date.now()}`,
    sender: 'abby',
    content: `Hi ${patientName}, I am Abby, checking in before your ${specialty} visit. What is the main thing you want Dr. Aalami to know today?`,
    timestamp: new Date().toISOString(),
  }
}

function firstName(name: unknown): string {
  return typeof name === 'string' ? name.trim().split(/\s+/)[0] || '' : ''
}

function buildSystemPrompt(context: ChatContext): string {
  const patient = context.patient ?? {}
  const specialist = context.specialist ?? {}
  return [
    'You are Abby, a patient-facing clinical follow-up assistant.',
    `You act on behalf of ${specialist.name || 'the patient\'s specialist'}${specialist.specialty ? ` in ${specialist.specialty}` : ''}.`,
    specialist.abbyInstructions ? `Follow these provider-specific Abby instructions from the Firestore directory:\n${specialist.abbyInstructions}` : '',
    'Be supportive, concise, and concrete. Use plain language. Ask at most one focused follow-up question when needed.',
    'Do not diagnose, prescribe, change medications, or claim clinician review has happened. Stay within the specialist and chart context provided.',
    'If the patient reports urgent symptoms such as chest pain, trouble breathing, severe weakness, fainting, stroke symptoms, severe bleeding, suicidal thoughts, or rapidly worsening symptoms, tell them to seek emergency care now or call local emergency services, and to contact their specialist.',
    'When a question needs clinician judgment, explain that Abby can pass the concern to the care team rather than making the decision.',
    '',
    'Patient and visit context:',
    JSON.stringify({
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      location: [patient.city, patient.state].filter(Boolean).join(', '),
      visitTitle: patient.visitTitle,
      conditions: patient.conditions,
      medications: patient.medications,
      signals: patient.signals,
      openQuestions: patient.openQuestions,
      actionItems: patient.actionItems,
      transcriptExcerpt: patient.transcriptExcerpt,
      noteExcerpt: patient.noteExcerpt,
      afterVisitSummaryExcerpt: patient.afterVisitSummaryExcerpt,
    }, null, 2),
  ].join('\n')
}

function parseBody(body: unknown) {
  if (typeof body === 'string') return JSON.parse(body) as Record<string, unknown>
  if (body && typeof body === 'object') return body as Record<string, unknown>
  return {}
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): ChatMessage | null => {
      if (!item || typeof item !== 'object') return null
      const input = item as Partial<ChatMessage>
      const sender = input.sender === 'patient' || input.sender === 'abby' ? input.sender : undefined
      const content = typeof input.content === 'string' ? input.content.trim() : ''
      if (!sender || !content) return null
      return { sender, content }
    })
    .filter((item): item is ChatMessage => Boolean(item))
    .slice(-16)
}

function normalizeContext(value: unknown): ChatContext {
  if (!value || typeof value !== 'object') return {}
  return value as ChatContext
}

function seedDirectoryStore(): DirectoryStore {
  return { people: [oliverAdmin(), ...syntheticPatients()], agentInstructionReferences: [], otp: {} }
}

function oliverAdmin(): DirectoryPerson {
  return {
    id: 'person-oliver-aalami',
    name: 'Oliver Aalami',
    phone: '+16503153236',
    roles: ['admin', 'provider', 'patient'],
    specialty: 'Vascular Surgery',
    primaryProviderId: 'person-oliver-aalami',
    abbyInstructions: [
      '# Abby App Instructions',
      '',
      'Provider: Dr. Oliver Aalami',
      'Specialty: Vascular Surgery',
      '',
      'Use a vascular-surgery lens for patient outreach and provider briefs.',
      'Prioritize cardiovascular risk, limb symptoms, wound status, medication adherence, and urgent red flags.',
      'Keep patient-facing language concise, calm, and action-oriented.',
    ].join('\n'),
    createdAt: seededAt,
    updatedAt: seededAt,
  }
}

function syntheticPatients(): DirectoryPerson[] {
  return (records as Array<{
    id: string
    metadata: { patient_id: string; visit_title: string }
    patient_context: {
      longitudinal_summary?: { condition_labels?: string[] }
      patient: { name?: Array<{ family?: string; given?: string[] }> }
    }
  }>).map((record, index) => ({
    id: `patient-${record.metadata.patient_id}`,
    name: patientName(record.patient_context.patient),
    phone: `+1555012${String(index + 1).padStart(4, '0')}`,
    roles: ['patient'],
    primaryProviderId: isCardiovascularPatient(record) ? 'person-oliver-aalami' : undefined,
    sourceRecordId: record.id,
    createdAt: seededAt,
    updatedAt: seededAt,
  }))
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

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
