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
    visitType?: string
    careSetting?: 'inpatient' | 'outpatient' | 'other'
    conditions?: string[]
    medications?: string[]
    signals?: Array<{ label?: string; value?: string; severity?: string; source?: string }>
    openQuestions?: string[]
    actionItems?: string[]
    transcriptExcerpt?: string
    noteExcerpt?: string
    afterVisitSummaryExcerpt?: string
    fhirEncounter?: unknown
    fhirResources?: Record<string, unknown[] | undefined>
  }
  specialist?: {
    id?: string
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
    patientName?: string
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
      const message = fallbackCheckInReply(context, messages)
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
  const sourceRecordId = patient?.sourceRecordId ?? context.patient?.sourceRecordId
  const sourceRecord = findSourceRecord(sourceRecordId)
  if (!provider) return context
  return {
    ...context,
    patient: {
      ...context.patient,
      directoryPersonId: patient?.id ?? context.patient?.directoryPersonId,
      sourceRecordId,
      name: context.patient?.name ?? patient?.name ?? patientName(sourceRecord?.patient_context.patient ?? {}),
      visitTitle: sourceRecord?.metadata.visit_title ?? context.patient?.visitTitle,
      visitType: sourceRecord?.metadata.visit_type ?? context.patient?.visitType,
      careSetting: inferCareSetting(
        sourceRecord?.metadata.visit_type ?? context.patient?.visitType,
        sourceRecord?.metadata.visit_title ?? context.patient?.visitTitle,
        context.patient?.careSetting,
      ),
      conditions: sourceRecord?.patient_context.longitudinal_summary.condition_labels ?? context.patient?.conditions,
      medications: sourceRecord?.patient_context.longitudinal_summary.medication_labels ?? context.patient?.medications,
      transcriptExcerpt: context.patient?.transcriptExcerpt ?? excerpt(sourceRecord?.transcript, 1800),
      noteExcerpt: context.patient?.noteExcerpt ?? excerpt(sourceRecord?.note, 1600),
      afterVisitSummaryExcerpt: context.patient?.afterVisitSummaryExcerpt ?? excerpt(sourceRecord?.after_visit_summary, 1400),
      fhirEncounter: context.patient?.fhirEncounter ?? sourceRecord?.encounter_fhir.encounter,
      fhirResources: context.patient?.fhirResources ?? sourceRecord?.encounter_fhir.related_resources,
    },
    specialist: {
      id: provider.id,
      name: providerDisplayName(provider.name),
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
    people.find((person) => person.id === context.specialist?.id && person.roles.includes('provider')) ||
    people.find((person) => person.id === patient?.primaryProviderId && person.roles.includes('provider')) ||
    people.find((person) => person.roles.includes('provider') && normalizeName(person.name) === normalizeName(context.specialist?.name ?? '')) ||
    people.find((person) => person.roles.includes('provider'))
  )
}

function findSourceRecord(sourceRecordId?: string) {
  if (!sourceRecordId) return undefined
  return (records as unknown as Array<{
    id: string
    metadata: { visit_title: string; visit_type: string }
    patient_context: {
      longitudinal_summary: { condition_labels: string[]; medication_labels: string[] }
      patient: { name?: Array<{ family?: string; given?: string[] }> }
    }
    encounter_fhir: { encounter: unknown; related_resources: Record<string, unknown[] | undefined> }
    transcript: string
    note: string
    after_visit_summary: string
  }>).find((record) => record.id === sourceRecordId)
}

async function writeChatHistory(context: ChatContext, messages: ChatMessage[]) {
  const patient = context.patient
  const key = patient?.sourceRecordId || patient?.directoryPersonId || patient?.id
  if (!key) return
  const current = await readGoogleJson<ChatHistoryStore>(patientChatDocumentId, { conversations: {} })
  current.conversations[key] = {
    patientPersonId: patient.directoryPersonId,
    patientSourceRecordId: patient.sourceRecordId,
    patientName: patient.name,
    providerPersonId: context.specialist?.id,
    providerName: context.specialist?.name,
    specialty: context.specialist?.specialty,
    messages: messages.slice(-64),
    updatedAt: new Date().toISOString(),
  }
  await writeGoogleJson(patientChatDocumentId, current)
}

const inpatientCheckInQuestions = [
  'How do you feel compared with yesterday?',
  'Any problems or new symptoms overnight?',
  'How is your pain?',
  'Are you eating, using the bathroom, and getting out of bed?',
  'What is your biggest concern today?',
]

const outpatientCheckInQuestions = [
  'What brings you in, and what is your main concern today?',
  'How has that main symptom or problem changed since we last saw you?',
  'How is that symptom or problem affecting your daily activities?',
  'Any new symptoms or major health changes?',
  'How is the current treatment working?',
  'What questions do you want answered today?',
  'Are you on any blood thinners (aspirin, Plavix, Eliquis, others)? If yes, which one?',
  'Are you smoking? If yes, which one?',
  'Are you on a cholesterol medicine? If yes, which one?',
]

function fallbackCheckInReply(context: ChatContext, messages: ChatMessage[]): ChatMessage & { id: string; timestamp: string } {
  const patient = context.patient ?? {}
  const specialist = context.specialist ?? {}
  const patientName = firstName(patient.name) || 'there'
  const specialty = specialist.specialty?.trim().toLowerCase() || 'care'
  const careSetting = inferCareSetting(patient.visitType, patient.visitTitle, patient.careSetting)
  const questions = careSetting === 'inpatient' ? inpatientCheckInQuestions : outpatientCheckInQuestions
  const answeredCount = messages.filter((message) => message.sender === 'patient').length
  const nextQuestion = questions[answeredCount]
  const specialistName = providerDisplayName(specialist.name)
  const checkInClosing = `Thank you, ${specialistName} looks forward to seeing you!`
  const content = nextQuestion ? nextQuestion : checkInClosing
  const greeting = careSetting === 'inpatient'
    ? `Hi ${patientName}, I am Abby, ${specialistName}'s assistant. I am checking in for your ${specialty} team while you are in the hospital.`
    : `Hi ${patientName}, I am Abby, ${specialistName}'s assistant. I am checking in before your ${specialty} visit.`
  return {
    id: `abby-fallback-${Date.now()}`,
    sender: 'abby',
    content: answeredCount === 0 && nextQuestion ? `${greeting} ${nextQuestion}` : content,
    timestamp: new Date().toISOString(),
  }
}

function firstName(name: unknown): string {
  return typeof name === 'string' ? name.trim().split(/\s+/)[0] || '' : ''
}

function providerDisplayName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return 'the care team'
  if (/^dr\.\s+/i.test(trimmed)) return trimmed
  return `Dr. ${trimmed}`
}

function buildSystemPrompt(context: ChatContext): string {
  const patient = context.patient ?? {}
  const specialist = context.specialist ?? {}
  const careSetting = inferCareSetting(patient.visitType, patient.visitTitle, patient.careSetting)
  return [
    'You are Abby, a patient-facing clinical follow-up assistant.',
    `You act on behalf of ${specialist.name || 'the patient\'s specialist'}${specialist.specialty ? ` in ${specialist.specialty}` : ''}.`,
    patient.name ? `The patient's name is ${patient.name}. Use their first name naturally to make the conversation feel personal, especially in greetings and check-ins, without overusing it.` : '',
    `The care setting is ${careSetting}. Setting is key context and must shape the conversation.`,
    careSetting === 'inpatient'
      ? [
          'For inpatient chats, behave like a concise morning pre-rounding check-in for the care team.',
          'Do not frame questions around being at home, walking around the house, scheduling, or preparing for a future clinic visit.',
          'Keep the interaction extremely brief and aligned to rapid rounds.',
          'If discharge comes up, ask what feels like the biggest barrier to going home safely, but do not make discharge decisions.',
        ].join('\n')
      : [
          'For outpatient chats, use a pre-visit check-in style.',
          'Use the chart reason and patient interview to orient the questions to why the patient is coming in.',
          'Once the patient names a primary symptom or problem, keep follow-up questions anchored to that symptom until that section is complete.',
        ].join('\n'),
    specialist.abbyInstructions ? `Follow these provider-specific Abby instructions from the Firestore directory:\n${specialist.abbyInstructions}` : '',
    careSetting === 'inpatient'
      ? [
          'Use this exact inpatient question sequence for very rapid rounds.',
          'Ask one question per turn, in order, and do not add extra routine questions outside this list unless the patient reports an urgent safety issue that needs escalation.',
          'Spend no more than one or two focused questions on any item before moving to the next item.',
          ...inpatientCheckInQuestions.map((question, index) => `${index + 1}. ${question}`),
        ].join('\n')
      : [
          'Use the context the patient is coming in with, then use this exact outpatient / clinic question sequence.',
          'Ask one question per turn, in order, and do not add extra routine questions outside this list unless the patient reports an urgent safety issue that needs escalation.',
          'Spend no more than one or two focused questions on any item before moving to the next item.',
          'For items 2 and 3, replace "that main symptom or problem" with the patient\'s stated symptom when known, such as calf pain, wound drainage, swelling, shortness of breath, dizziness, or chest pain.',
          ...outpatientCheckInQuestions.map((question, index) => `${index + 1}. ${question}`),
        ].join('\n'),
    `After all required questions are answered, end the conversation with exactly: "Thank you, ${providerDisplayName(specialist.name)} looks forward to seeing you!"`,
    'Be supportive, concise, and concrete. Use plain language. Ask the next required question directly.',
    'Keep each reply to one or two short sentences unless urgent safety guidance is needed.',
    'Do not invent examples, activities, habits, hobbies, distances, neighborhood walks, gardening, work duties, or home details unless they are already in the chart context or the patient said them.',
    'Do not broaden into general lifestyle coaching during the interview. Capture the answer and move quickly to the next required section.',
    'Do not begin every reply with thanks or the patient name. After the opening greeting, vary acknowledgments and usually move directly to the next focused question.',
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
      visitType: patient.visitType,
      careSetting,
      conditions: patient.conditions,
      medications: patient.medications,
      signals: patient.signals,
      openQuestions: patient.openQuestions,
      actionItems: patient.actionItems,
      transcriptExcerpt: patient.transcriptExcerpt,
      noteExcerpt: patient.noteExcerpt,
      afterVisitSummaryExcerpt: patient.afterVisitSummaryExcerpt,
      fhirEncounter: patient.fhirEncounter,
      fhirResources: patient.fhirResources,
    }, null, 2),
  ].join('\n')
}

function inferCareSetting(visitType: unknown, visitTitle?: unknown, explicit?: unknown): 'inpatient' | 'outpatient' | 'other' {
  if (explicit === 'inpatient' || explicit === 'outpatient' || explicit === 'other') return explicit
  const value = [visitType, visitTitle]
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
    .toLowerCase()
  if (/inpatient|hospital|admission|admitted|unit|ward|icu/.test(value)) return 'inpatient'
  if (/outpatient|ambulatory|clinic|office|follow-up|follow up|visit/.test(value)) return 'outpatient'
  return 'other'
}

function excerpt(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 1).trim()}...`
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
  return { people: [oliverAdmin(), ...demoProviders(), ...syntheticPatients()], agentInstructionReferences: [], otp: {} }
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
