import type { AbbyCase, DirectoryPerson } from './types'

export type AbbyChatSender = 'patient' | 'abby'

export type AbbyChatMessage = {
  id: string
  sender: AbbyChatSender
  content: string
  timestamp: string
}

export type AbbyChatContext = {
  patient: {
    id: string
    name: string
    age: number
    gender?: string
    city?: string
    state?: string
    visitTitle: string
    conditions: string[]
    medications: string[]
    signals: Array<{ label: string; value: string; severity: string; source: string }>
    openQuestions: string[]
    actionItems: string[]
    transcriptExcerpt: string
    noteExcerpt: string
    afterVisitSummaryExcerpt: string
  }
  specialist: {
    name: string
    specialty: string
  }
}

export type AbbyChatResponse = {
  message: AbbyChatMessage
  model: string
}

export function chatStorageKey(recordId: string): string {
  return `abby.chat.${recordId}`
}

export function buildChatContext(abbyCase: AbbyCase, provider?: DirectoryPerson): AbbyChatContext {
  const address = abbyCase.record.patient_context.patient.address?.[0]
  const specialist = provider
    ? {
        name: provider.name,
        specialty: provider.specialty || inferSpecialty(abbyCase.record.metadata.visit_title),
      }
    : {
        name: `the ${inferSpecialty(abbyCase.record.metadata.visit_title)} specialist`,
        specialty: inferSpecialty(abbyCase.record.metadata.visit_title),
      }

  return {
    patient: {
      id: abbyCase.record.metadata.patient_id,
      name: abbyCase.patientName,
      age: abbyCase.age,
      gender: abbyCase.record.patient_context.patient.gender,
      city: address?.city,
      state: address?.state,
      visitTitle: abbyCase.record.metadata.visit_title,
      conditions: abbyCase.record.patient_context.longitudinal_summary.condition_labels.slice(0, 8),
      medications: abbyCase.record.patient_context.longitudinal_summary.medication_labels.slice(0, 8),
      signals: abbyCase.signals,
      openQuestions: abbyCase.openQuestions,
      actionItems: abbyCase.actionItems,
      transcriptExcerpt: excerpt(abbyCase.record.transcript, 1800),
      noteExcerpt: excerpt(abbyCase.record.note, 1600),
      afterVisitSummaryExcerpt: excerpt(abbyCase.record.after_visit_summary, 1400),
    },
    specialist,
  }
}

export function initialAbbyMessage(abbyCase: AbbyCase, provider?: DirectoryPerson): AbbyChatMessage {
  const specialist = provider?.name ?? `your ${inferSpecialty(abbyCase.record.metadata.visit_title)} specialist`
  return {
    id: `abby-welcome-${abbyCase.record.id}`,
    sender: 'abby',
    content: `Hi ${abbyCase.patientName.split(' ')[0] || 'there'}, I am Abby, checking in on behalf of ${specialist}. How are things going since your ${abbyCase.record.metadata.visit_title.toLowerCase()}?`,
    timestamp: new Date().toISOString(),
  }
}

export function providerPreVisitMessage(abbyCase: AbbyCase, provider?: DirectoryPerson): AbbyChatMessage {
  const specialist = provider?.name ?? `your ${inferSpecialty(abbyCase.record.metadata.visit_title)} specialist`
  return {
    id: `abby-previsit-${abbyCase.record.id}`,
    sender: 'abby',
    content: `Hi ${abbyCase.patientName.split(' ')[0] || 'there'}, Dr. ${specialist.replace(/^Dr\.\s*/i, '')} is looking forward to your visit. I am Abby, his assistant, and I would like to ask you a few questions before your visit.`,
    timestamp: new Date().toISOString(),
  }
}

export function createMessageId(prefix: string): string {
  if ('randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function inferSpecialty(visitTitle: string): string {
  const title = visitTitle.toLowerCase()
  if (/cardio|heart|hypertension|chest/.test(title)) return 'cardiology'
  if (/pulmon|respir|pneumonia|asthma|copd|oxygen/.test(title)) return 'pulmonology'
  if (/pregnan|prenatal|obstetric|postpartum/.test(title)) return 'obstetrics'
  if (/neuro|migraine|headache|seizure|stroke/.test(title)) return 'neurology'
  if (/ortho|knee|hip|fracture|joint|back/.test(title)) return 'orthopedics'
  if (/diabetes|metabolic|endocrine/.test(title)) return 'endocrinology'
  if (/behavior|depress|anxiety|psychiatry|mental/.test(title)) return 'behavioral health'
  return 'care team'
}

function excerpt(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 1).trim()}...`
}
