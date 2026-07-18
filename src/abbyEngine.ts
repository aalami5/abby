import type { AbbyCase, AbbyRun, EncounterRecord, FhirResource, IntakeAnswer, PatientSignal, ToolEvent } from './types'

const today = '2026-07-18'

export async function loadRecords(): Promise<EncounterRecord[]> {
  const response = await fetch('/data/synthetic-ambient-fhir-25.json')
  if (!response.ok) {
    throw new Error(`Could not load synthetic encounters: ${response.status}`)
  }
  return response.json()
}

export function buildCase(record: EncounterRecord): AbbyCase {
  const patientName = getPatientName(record)
  const signals = deriveSignals(record)
  const intake = buildIntake(record, signals)
  const openQuestions = buildOpenQuestions(record, signals)
  const actionItems = buildActionItems(record, signals)
  const fhirBundle = buildFhirBundle(record, intake, signals, actionItems)
  const evalScores = buildEvalScores(record, fhirBundle, signals, actionItems)

  return {
    record,
    patientName,
    age: ageFromBirthDate(record.patient_context.patient.birthDate),
    initials: initialsFor(patientName),
    intake,
    signals,
    openQuestions,
    actionItems,
    fhirBundle,
    evalScores,
  }
}

export function createRun(abbyCase: AbbyCase, channel: AbbyRun['patientChannel'] = 'sms'): AbbyRun {
  const createdAt = `${today}T15:00:00Z`
  const safetyHold = abbyCase.signals.some((signal) => signal.severity === 'high')

  return {
    id: `run-${abbyCase.record.metadata.encounter_id}`,
    caseId: abbyCase.record.id,
    stage: 'brief-ready',
    createdAt,
    updatedAt: createdAt,
    patientChannel: channel,
    requiresApproval: true,
    safetyHold,
    followUpQueued: false,
    writeBackComplete: false,
    transcript: abbyCase.intake,
    toolEvents: buildInitialToolEvents(abbyCase, createdAt, channel, safetyHold),
  }
}

export function approveRun(run: AbbyRun, approvedBy = 'Clinician'): AbbyRun {
  const approvedAt = `${today}T15:08:00Z`
  return {
    ...run,
    stage: 'approved',
    approvedAt,
    approvedBy,
    updatedAt: approvedAt,
    toolEvents: run.toolEvents.map((event) => (
      event.tool === 'fhir' || event.tool === 'scheduler'
        ? { ...event, status: 'ready' as const, detail: event.detail.replace('Waiting on clinician approval.', 'Approved and ready to execute.') }
        : event
    )),
  }
}

export function executeApprovedRun(run: AbbyRun, abbyCase: AbbyCase): AbbyRun {
  const executedAt = `${today}T15:11:00Z`
  const shouldSchedule = shouldQueueFollowUp(abbyCase)
  return {
    ...run,
    stage: 'executed',
    updatedAt: executedAt,
    writeBackComplete: true,
    followUpQueued: shouldSchedule,
    toolEvents: run.toolEvents.map((event) => {
      if (event.tool === 'fhir') {
        return {
          ...event,
          status: 'success' as const,
          detail: `Mock write-back completed for ${bundleEntryCount(abbyCase.fhirBundle)} FHIR resources.`,
          timestamp: executedAt,
        }
      }
      if (event.tool === 'scheduler') {
        return {
          ...event,
          status: shouldSchedule ? 'success' as const : 'blocked' as const,
          detail: shouldSchedule
            ? 'Follow-up scheduling task queued for care-team review.'
            : 'No scheduling criteria met for this case.',
          timestamp: executedAt,
        }
      }
      return event
    }),
  }
}

function buildInitialToolEvents(abbyCase: AbbyCase, createdAt: string, channel: AbbyRun['patientChannel'], safetyHold: boolean): ToolEvent[] {
  return [
    {
      id: 'verify',
      tool: 'verify',
      label: 'Identity verified',
      status: 'success',
      detail: `Mock ${channel === 'voice' ? 'voice' : 'SMS'} verification completed before clinical questions.`,
      timestamp: createdAt,
    },
    {
      id: 'twilio',
      tool: 'twilio',
      label: 'Patient outreach captured',
      status: 'success',
      detail: `${abbyCase.intake.length} transcript-grounded patient responses collected.`,
      timestamp: createdAt,
    },
    {
      id: 'safety',
      tool: 'safety',
      label: safetyHold ? 'Safety review required' : 'Safety gate passed',
      status: safetyHold ? 'pending' : 'success',
      detail: safetyHold
        ? 'High-priority signal detected; autonomous actions stay locked until clinician review.'
        : 'No high-priority red flags detected in the current synthetic run.',
      timestamp: createdAt,
    },
    {
      id: 'eval',
      tool: 'eval',
      label: 'Eval harness scored',
      status: abbyCase.evalScores.every((score) => score.score >= score.target) ? 'success' : 'pending',
      detail: `${abbyCase.evalScores.filter((score) => score.score >= score.target).length}/${abbyCase.evalScores.length} quality gates passing.`,
      timestamp: createdAt,
    },
    {
      id: 'fhir',
      tool: 'fhir',
      label: 'FHIR write-back',
      status: 'blocked',
      detail: 'Waiting on clinician approval.',
      timestamp: createdAt,
    },
    {
      id: 'scheduler',
      tool: 'scheduler',
      label: 'Follow-up scheduling',
      status: 'blocked',
      detail: 'Waiting on clinician approval.',
      timestamp: createdAt,
    },
  ]
}

export function shouldQueueFollowUp(abbyCase: AbbyCase): boolean {
  return abbyCase.actionItems.some((item) => /follow-up|scheduling/i.test(item)) || abbyCase.signals.some((signal) => signal.severity === 'high')
}

function bundleEntryCount(bundle: FhirResource): number {
  return Array.isArray(bundle.entry) ? bundle.entry.length : 0
}

export function getPatientName(record: EncounterRecord): string {
  const official = record.patient_context.patient.name?.[0]
  const given = official?.given?.[0] ?? 'Patient'
  const family = official?.family ?? ''
  return `${given} ${family}`.trim()
}

function ageFromBirthDate(birthDate?: string): number {
  if (!birthDate) return 0
  const birth = new Date(birthDate)
  const now = new Date(today)
  let age = now.getFullYear() - birth.getFullYear()
  const monthDelta = now.getMonth() - birth.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1
  return age
}

function initialsFor(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function deriveSignals(record: EncounterRecord): PatientSignal[] {
  const text = `${record.transcript}\n${record.note}\n${record.after_visit_summary}`.toLowerCase()
  const chartSignals = record.patient_context.longitudinal_summary.condition_labels.slice(0, 3).map((condition) => ({
    label: 'Chart context',
    value: condition.replace(/\s*\(.+\)$/, ''),
    severity: 'medium' as const,
    source: 'chart' as const,
  }))

  const rules: Array<[RegExp, PatientSignal]> = [
    [/short(ness)? of breath|hypox|oxygen|pneumonia|covid/, { label: 'Respiratory status', value: 'Needs same-day symptom check and escalation guardrails', severity: 'high', source: 'derived' }],
    [/pain|ache|migraine|headache|back pain|knee/, { label: 'Pain trajectory', value: 'Capture overnight change, function, and medication response', severity: 'medium', source: 'patient' }],
    [/discharge|home health|transport|transportation|caregiver|skilled nursing/, { label: 'Care barrier', value: 'Discharge readiness or follow-up logistics may block the plan', severity: 'high', source: 'derived' }],
    [/medication|dose|side effect|allergy|insulin|antibiotic|lisinopril/, { label: 'Medication issue', value: 'Confirm adherence, side effects, and refill needs', severity: 'medium', source: 'patient' }],
    [/depress|anxiety|stress|isolation|sleep/, { label: 'Behavioral health', value: 'Screen mood, sleep, safety, and support system', severity: 'medium', source: 'derived' }],
    [/pregnan|prenatal|trimester|obstetric/, { label: 'Pregnancy context', value: 'Capture warning signs, fetal movement, nausea, bleeding, and follow-up', severity: 'high', source: 'chart' }],
    [/diabetes|prediabetes|a1c|glucose|metabolic/, { label: 'Metabolic risk', value: 'Capture diet, glucose trend, barriers, and care gaps', severity: 'medium', source: 'chart' }],
  ]

  const matched = rules.filter(([pattern]) => pattern.test(text)).map(([, signal]) => signal)
  const all = [...matched, ...chartSignals]
  return all.slice(0, 6)
}

function buildIntake(record: EncounterRecord, signals: PatientSignal[]): IntakeAnswer[] {
  const firstPlanLine = extractPlanLine(record.note)
  const visit = record.metadata.visit_title.toLowerCase()
  const base: IntakeAnswer[] = [
    {
      prompt: 'What changed since the last encounter?',
      answer: summarizeTranscript(record.transcript),
      mapsTo: 'QuestionnaireResponse.item[change_since_visit]',
    },
    {
      prompt: 'What is the patient most worried about today?',
      answer: signals[0]?.value ?? record.metadata.visit_title,
      mapsTo: 'Observation[patient-priority]',
    },
    {
      prompt: 'What should the care team know before entering the room?',
      answer: firstPlanLine || 'Review chart context, patient goals, and barriers before the encounter.',
      mapsTo: 'Communication.payload',
    },
  ]

  if (visit.includes('inpatient') || visit.includes('admission')) {
    base.push({
      prompt: 'Is anything blocking discharge or safe recovery?',
      answer: 'Abby should confirm oxygen needs, walking tolerance, home support, transportation, and medication access.',
      mapsTo: 'Task[care-coordination]',
    })
  } else {
    base.push({
      prompt: 'Is follow-up needed?',
      answer: 'Abby prepares a follow-up recommendation for clinician approval, then triggers the scheduling tool.',
      mapsTo: 'ServiceRequest[follow-up]',
    })
  }

  return base
}

function summarizeTranscript(transcript: string): string {
  const patientLines = transcript
    .split('\n')
    .filter((line) => /^PT:|^FAMILY:/i.test(line.trim()))
    .map((line) => line.replace(/^PT:\s*|^FAMILY:\s*/i, '').trim())
    .filter(Boolean)
  const merged = patientLines.slice(0, 4).join(' ')
  return trimSentence(merged || transcript, 220)
}

function extractPlanLine(note: string): string {
  const planStart = note.search(/assessment|plan/i)
  const section = planStart >= 0 ? note.slice(planStart) : note
  const line = section
    .split('\n')
    .map((item) => item.replace(/^[-#*\d.\s]+/, '').trim())
    .find((item) => item.length > 40)
  return line ? trimSentence(line, 220) : ''
}

function trimSentence(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trim()}...`
}

function buildOpenQuestions(record: EncounterRecord, signals: PatientSignal[]): string[] {
  const questions = [
    'Any red flag symptoms that require same-day escalation?',
    'What is the patient goal for the next encounter?',
    'Which patient-reported items are new versus already in chart context?',
  ]
  if (signals.some((signal) => signal.label === 'Medication issue')) questions.push('Any missed doses, side effects, or refill/access barriers?')
  if (record.metadata.visit_title.toLowerCase().includes('inpatient')) questions.push('What must be true before discharge is safe?')
  return questions.slice(0, 5)
}

function buildActionItems(record: EncounterRecord, signals: PatientSignal[]): string[] {
  const items = [
    'Generate provider Action Brief with provenance links',
    'Write patient-generated updates into a FHIR Bundle',
    'Queue care-team review before EHR/Abridge write-back',
  ]
  if (signals.some((signal) => signal.severity === 'high')) items.unshift('Escalate high-risk patient signal for clinician review')
  if (/follow|general|annual|prenatal/i.test(record.metadata.visit_title)) items.push('Prepare follow-up scheduling recommendation for approval')
  return items
}

function buildFhirBundle(record: EncounterRecord, intake: IntakeAnswer[], signals: PatientSignal[], actionItems: string[]): FhirResource {
  const patientReference = `Patient/${record.patient_context.patient.id}`
  const encounterReference = `Encounter/${record.metadata.encounter_id}`

  const resources: FhirResource[] = [
    {
      resourceType: 'QuestionnaireResponse',
      id: `abby-qr-${record.metadata.encounter_id}`,
      status: 'completed',
      authored: today,
      subject: { reference: patientReference },
      encounter: { reference: encounterReference },
      item: intake.map((answer, index) => ({
        linkId: `abby-${index + 1}`,
        text: answer.prompt,
        answer: [{ valueString: answer.answer }],
        extension: [{ url: 'https://abby.ai/fhir/StructureDefinition/maps-to', valueString: answer.mapsTo }],
      })),
    },
    ...signals.map((signal, index) => ({
      resourceType: 'Observation',
      id: `abby-observation-${index + 1}`,
      status: 'preliminary',
      code: { text: signal.label },
      subject: { reference: patientReference },
      encounter: { reference: encounterReference },
      effectiveDateTime: today,
      valueString: signal.value,
      interpretation: [{ text: signal.severity }],
      derivedFrom: [{ reference: signal.source === 'chart' ? encounterReference : `QuestionnaireResponse/abby-qr-${record.metadata.encounter_id}` }],
    })),
    {
      resourceType: 'Communication',
      id: `abby-brief-${record.metadata.encounter_id}`,
      status: 'preparation',
      subject: { reference: patientReference },
      encounter: { reference: encounterReference },
      payload: [{ contentString: `Action brief: ${actionItems.join('; ')}` }],
    },
    {
      resourceType: 'Task',
      id: `abby-review-${record.metadata.encounter_id}`,
      status: 'requested',
      intent: 'order',
      description: 'Clinician review required before EHR write-back or scheduling action.',
      for: { reference: patientReference },
      encounter: { reference: encounterReference },
    },
    {
      resourceType: 'Provenance',
      id: `abby-provenance-${record.metadata.encounter_id}`,
      target: [
        { reference: `QuestionnaireResponse/abby-qr-${record.metadata.encounter_id}` },
        { reference: `Communication/abby-brief-${record.metadata.encounter_id}` },
      ],
      recorded: `${today}T00:00:00Z`,
      agent: [{ who: { display: 'Abby patient-state agent' } }],
      entity: [{ role: 'source', what: { display: 'Synthetic ambient transcript, note, AVS, and FHIR chart context' } }],
    },
  ]

  return {
    resourceType: 'Bundle',
    id: `abby-bundle-${record.metadata.encounter_id}`,
    type: 'collection',
    timestamp: `${today}T00:00:00Z`,
    entry: resources.map((resource) => ({ resource })),
  }
}

function buildEvalScores(record: EncounterRecord, bundle: FhirResource, signals: PatientSignal[], actionItems: string[]) {
  const entryCount = Array.isArray(bundle.entry) ? bundle.entry.length : 0
  const hasEscalation = actionItems.some((item) => /escalate|review/i.test(item))
  const hasProvenance = JSON.stringify(bundle).includes('Provenance')
  const hasNoKnownHallucination = signals.every((signal) => record.note.toLowerCase().includes(signal.value.toLowerCase().split(' ')[0]) || signal.source !== 'patient')

  return [
    { metric: 'FHIR completeness', score: Math.min(100, 62 + entryCount * 5), target: 85 },
    { metric: 'Escalation routing', score: hasEscalation ? 94 : 78, target: 90 },
    { metric: 'Provenance coverage', score: hasProvenance ? 96 : 40, target: 95 },
    { metric: 'No unsupported facts', score: hasNoKnownHallucination ? 92 : 84, target: 90 },
  ]
}
