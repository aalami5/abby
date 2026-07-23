import type { AbbyCase, DirectoryPerson } from './types'
import { providerDisplayName } from './providerNames'

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
    directoryPersonId?: string
    sourceRecordId?: string
    name: string
    age: number
    gender?: string
    city?: string
    state?: string
    visitTitle: string
    visitType: string
    careSetting: 'inpatient' | 'outpatient' | 'other'
    conditions: string[]
    medications: string[]
    signals: Array<{ label: string; value: string; severity: string; source: string }>
    openQuestions: string[]
    actionItems: string[]
    transcriptExcerpt: string
    noteExcerpt: string
    afterVisitSummaryExcerpt: string
    fhirEncounter: unknown
    fhirResources: Record<string, unknown[]>
  }
  specialist: {
    id?: string
    name: string
    specialty: string
    abbyInstructions?: string
  }
}

export type AbbyChatResponse = {
  message: AbbyChatMessage
  model: string
}

export function chatStorageKey(recordId: string, providerId?: string, checkInId = 'current'): string {
  return `abby.chat.v3.${recordId}.${providerId || 'default-provider'}.${checkInId}`
}

export function buildChatContext(abbyCase: AbbyCase, provider?: DirectoryPerson, directoryPatient?: DirectoryPerson): AbbyChatContext {
  const address = abbyCase.record.patient_context.patient.address?.[0]
  const specialist = provider
    ? {
        name: providerDisplayName(provider.name),
        specialty: provider.specialty || inferSpecialty(abbyCase.record.metadata.visit_title),
      }
    : {
        name: `the ${inferSpecialty(abbyCase.record.metadata.visit_title)} specialist`,
        specialty: inferSpecialty(abbyCase.record.metadata.visit_title),
      }

  return {
    patient: {
      id: abbyCase.record.metadata.patient_id,
      directoryPersonId: directoryPatient?.id,
      sourceRecordId: abbyCase.record.id,
      name: abbyCase.patientName,
      age: abbyCase.age,
      gender: abbyCase.record.patient_context.patient.gender,
      city: address?.city,
      state: address?.state,
      visitTitle: abbyCase.record.metadata.visit_title,
      visitType: abbyCase.record.metadata.visit_type,
      careSetting: inferCareSetting(abbyCase.record.metadata.visit_type, abbyCase.record.metadata.visit_title),
      conditions: abbyCase.record.patient_context.longitudinal_summary.condition_labels.slice(0, 8),
      medications: abbyCase.record.patient_context.longitudinal_summary.medication_labels.slice(0, 8),
      signals: abbyCase.signals,
      openQuestions: abbyCase.openQuestions,
      actionItems: abbyCase.actionItems,
      transcriptExcerpt: excerpt(abbyCase.record.transcript, 1800),
      noteExcerpt: excerpt(abbyCase.record.note, 1600),
      afterVisitSummaryExcerpt: excerpt(abbyCase.record.after_visit_summary, 1400),
      fhirEncounter: abbyCase.record.encounter_fhir.encounter,
      fhirResources: abbyCase.record.encounter_fhir.related_resources,
    },
    specialist: {
      id: provider?.id,
      ...specialist,
      abbyInstructions: provider?.abbyInstructions,
    },
  }
}

export function initialAbbyMessage(abbyCase: AbbyCase, provider?: DirectoryPerson): AbbyChatMessage {
  const specialist = provider ? providerDisplayName(provider.name) : `your ${inferSpecialty(abbyCase.record.metadata.visit_title)} specialist`
  const specialty = provider?.specialty || inferSpecialty(abbyCase.record.metadata.visit_title)
  const first = abbyCase.patientName.split(' ')[0] || 'there'
  const setting = inferCareSetting(abbyCase.record.metadata.visit_type, abbyCase.record.metadata.visit_title)
  const content = setting === 'inpatient'
    ? `Hi ${first}, I am Abby, ${specialist}'s assistant. I am checking in for your ${specialty.toLowerCase()} team while you are in the hospital. How do you feel compared with yesterday?`
    : `Hi ${first}, I am Abby, ${specialist}'s assistant. I will help with a quick ${specialty.toLowerCase()} check-in before your visit. What brings you in, and what is your main concern today?`
  return {
    id: `abby-welcome-${abbyCase.record.id}`,
    sender: 'abby',
    content,
    timestamp: new Date().toISOString(),
  }
}

export function providerPreVisitMessage(abbyCase: AbbyCase, provider?: DirectoryPerson): AbbyChatMessage {
  const specialist = provider ? providerDisplayName(provider.name) : `your ${inferSpecialty(abbyCase.record.metadata.visit_title)} specialist`
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

function inferCareSetting(visitType: string, visitTitle: string): 'inpatient' | 'outpatient' | 'other' {
  const value = `${visitType} ${visitTitle}`.trim().toLowerCase()
  if (/inpatient|hospital|admission|admitted|unit|ward|icu/.test(value)) return 'inpatient'
  if (/outpatient|ambulatory|clinic|office|follow-up|follow up|visit/.test(value)) return 'outpatient'
  return 'other'
}

function excerpt(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 1).trim()}...`
}
