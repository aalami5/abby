import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, AudioLines, Bot, Camera, ChevronDown, ClipboardList, FileText, Folder, HelpCircle, Mic, Play, Send, Sparkles, UserRound } from 'lucide-react'
import type { AbbyCase, AbbyRun, DirectoryResponse, EncounterRecord } from './types'
import { buildChatContext, chatStorageKey, createMessageId, initialAbbyMessage, type AbbyChatMessage } from './chatTypes'
import { sendChatMessage } from './apiClient'
import { providerDisplayName, titleProviderPossessives } from './providerNames'

type PatientChatProps = {
  abbyCase: AbbyCase
  records: EncounterRecord[]
  selectedRecordId: string
  directory: DirectoryResponse | null
  run?: AbbyRun
  onLaunch: () => void
  isRunBusy: boolean
  selectedProviderId?: string
  onRecordChange: (recordId: string) => void
  onProviderChange: (providerId: string) => void
  patientOnly?: boolean
}

export function PatientChat({
  abbyCase,
  records,
  selectedRecordId,
  directory,
  run,
  onLaunch,
  isRunBusy,
  selectedProviderId,
  onRecordChange,
  onProviderChange,
  patientOnly = false,
}: PatientChatProps) {
  const directoryPatient = useMemo(() => (
    directory?.people.find((person) => person.sourceRecordId === abbyCase.record.id)
  ), [abbyCase.record.id, directory])
  const providers = useMemo(() => (
    directory?.people.filter((person) => person.roles.includes('provider')) ?? []
  ), [directory])
  const provider = useMemo(() => {
    if (!directory) return undefined
    return (
      providers.find((person) => person.id === selectedProviderId) ??
      providers.find((person) => person.id === directoryPatient?.primaryProviderId) ??
      providers[0]
    )
  }, [directory, directoryPatient?.primaryProviderId, providers, selectedProviderId])
  const context = useMemo(() => buildChatContext(abbyCase, provider, directoryPatient), [abbyCase, provider, directoryPatient])
  const patientDisplayName = context.patient.name.trim() || 'patient'
  const activeCheckInKey = activeCheckInStorageKey(abbyCase.record.id, provider?.id)
  const [checkInId, setCheckInId] = useState(() => readActiveCheckInId(activeCheckInKey))
  const storageKey = chatStorageKey(abbyCase.record.id, provider?.id, checkInId)
  const [messages, setMessages] = useState<AbbyChatMessage[]>(() => readStoredMessages(storageKey, abbyCase, provider, providers))
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const liveBrief = useMemo(() => buildLiveVisitBrief(messages, abbyCase), [abbyCase, messages])

  useEffect(() => {
    const nextCheckInId = readActiveCheckInId(activeCheckInKey)
    setCheckInId(nextCheckInId)
    setMessages(readStoredMessages(chatStorageKey(abbyCase.record.id, provider?.id, nextCheckInId), abbyCase, provider, providers))
    setDraft('')
    setError('')
  }, [abbyCase, activeCheckInKey, provider, providers])

  useEffect(() => {
    window.localStorage.setItem(activeCheckInKey, checkInId)
    window.localStorage.setItem(storageKey, JSON.stringify(messages))
  }, [activeCheckInKey, checkInId, messages, storageKey])

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' })
  }, [messages, isSending])

  const submitMessage = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const content = draft.trim()
    if (!content || isSending) return
    const patientMessage: AbbyChatMessage = {
      id: createMessageId('patient'),
      sender: 'patient',
      content,
      timestamp: new Date().toISOString(),
    }
    const nextMessages = [...messages, patientMessage]
    setMessages(nextMessages)
    setDraft('')
    setError('')
    setIsSending(true)

    try {
      const reply = await sendChatMessage({ messages: nextMessages, context })
      setMessages((current) => [...current, reply.message])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setIsSending(false)
    }
  }

  const startFreshCheckIn = () => {
    const nextCheckInId = createCheckInId()
    const nextMessages = [initialAbbyMessage(abbyCase, provider)]
    window.localStorage.setItem(activeCheckInKey, nextCheckInId)
    window.localStorage.setItem(chatStorageKey(abbyCase.record.id, provider?.id, nextCheckInId), JSON.stringify(nextMessages))
    setCheckInId(nextCheckInId)
    setMessages(nextMessages)
    setDraft('')
    setError('')
    onLaunch()
  }

  return (
    <section className={`chat-layout ${patientOnly ? 'patient-only-chat' : ''}`} aria-label="Patient chat with Abby">
      <div className="chat-surface">
        <div className="patient-chat-demo-controls" aria-label="Demo selectors">
          <label>
            <span>Patient</span>
            <select value={selectedRecordId} onChange={(event) => onRecordChange(event.target.value)}>
              {records.map((record, index) => (
                <option key={record.id} value={record.id}>
                  {patientOptionLabel(record, index)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Provider</span>
            <select value={provider?.id ?? ''} onChange={(event) => onProviderChange(event.target.value)}>
              {providers.map((person) => (
                <option key={person.id} value={person.id}>
                  {providerDisplayName(person.name)}{person.specialty ? `, ${person.specialty}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="start-check-in-button" onClick={startFreshCheckIn} disabled={isRunBusy}>
            <Play size={17} />
            <span>Start check-in</span>
          </button>
        </div>
        <div className="chat-date-pill">
          <Sparkles size={14} />
          <span>{formatDate(messages[0]?.timestamp)}</span>
        </div>
        <div className="chat-thread" ref={threadRef}>
          {messages.map((message) => (
            <article key={message.id} className={`chat-message ${message.sender}`}>
              <div className="chat-avatar" aria-hidden="true">
                {message.sender === 'patient' ? <UserRound size={18} /> : <Bot size={18} />}
              </div>
              <div className="chat-bubble">
                <p>{message.content}</p>
                <time>{formatTime(message.timestamp)}</time>
              </div>
            </article>
          ))}
          {isSending && (
            <article className="chat-message abby">
              <div className="chat-avatar" aria-hidden="true"><Bot size={18} /></div>
              <div className="chat-bubble waiting">
                <span />
                <span />
                <span />
              </div>
            </article>
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>
        {error && <div className="chat-error">{error}</div>}
        <form className="chat-composer" onSubmit={submitMessage}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submitMessage()
              }
            }}
            placeholder="Message Abby"
            aria-label="Message Abby"
            disabled={isSending}
            rows={3}
          />
          <button type="submit" disabled={!draft.trim() || isSending} title="Send message" aria-label="Send message">
            <Send size={18} />
          </button>
        </form>
      </div>

      <aside className="chat-context-panel live-brief-panel" aria-label="Live visit brief">
        <EpicHaikuBrief
          abbyCase={abbyCase}
          liveBrief={liveBrief}
          patientDisplayName={patientDisplayName}
          patientPhone={directoryPatient?.phone}
          providerName={providerDisplayName(context.specialist.name)}
          run={run}
          isRunBusy={isRunBusy}
          onLaunch={onLaunch}
        />
        {!patientOnly && (
          <div className="chat-context-list">
            {abbyCase.signals.slice(0, 3).map((signal) => (
              <div className="signal" key={`${signal.label}-${signal.value}`}>
                <span className={`severity ${signal.severity}`}>{signal.severity}</span>
                <div>
                  <strong>{signal.label}</strong>
                  <p>{signal.value}</p>
                </div>
                <small>{signal.source}</small>
              </div>
            ))}
          </div>
        )}
      </aside>
    </section>
  )
}

function EpicHaikuBrief({
  abbyCase,
  liveBrief,
  patientDisplayName,
  patientPhone,
  providerName,
  run,
  isRunBusy,
  onLaunch,
}: {
  abbyCase: AbbyCase
  liveBrief: ReturnType<typeof buildLiveVisitBrief>
  patientDisplayName: string
  patientPhone?: string
  providerName: string
  run?: AbbyRun
  isRunBusy: boolean
  onLaunch: () => void
}) {
  const patient = abbyCase.record.patient_context.patient
  const gender = patient.gender ? patient.gender.slice(0, 1).toUpperCase() : 'U'
  const birthDate = patient.birthDate ? formatShortDate(patient.birthDate) : 'DOB unknown'
  const mrn = abbyCase.record.metadata.patient_id.replace(/^patient-?/i, '').slice(0, 8).toUpperCase()
  const phone = patientPhone || '650-924-8833 (H)'
  const setting = formatVisitSetting(abbyCase.record.metadata.visit_type)

  return (
    <div className="haiku-frame" aria-label="Epic Haiku style live brief preview">
      <div className="haiku-status">
        <strong>9:56</strong>
        <span>5G</span>
      </div>
      <header className="haiku-patient-header">
        <button type="button" className="haiku-close" aria-label="Close preview">x</button>
        <div className="haiku-avatar">
          <UserRound size={34} />
          <span><Camera size={13} /></span>
        </div>
        <div className="haiku-patient-copy">
          <strong>{patientDisplayName}</strong>
          <span>{gender} {abbyCase.age} year old ({birthDate}) MRN: {mrn}...</span>
          <span>{phone}</span>
          <span>PCP: {providerName}</span>
        </div>
        <div className="haiku-epic">Epic</div>
        <HelpCircle className="haiku-help" size={16} />
      </header>
      <div className="haiku-title">Abridge Inside</div>
      <main className="haiku-brief-body">
        <button type="button" className="haiku-floating-mic" aria-label="Ambient recording"><Mic size={18} /></button>
        <div className="haiku-watermark">A</div>
        <div className="haiku-brief-card">
          <p className="haiku-brief-kicker">Live visit brief</p>
          <h3>{setting} check-in</h3>
          <BriefNarrative summary={liveBrief.summary} />
          <div className="live-brief-mini-sections">
            <BriefSection title="Medications" items={liveBrief.medications} empty="Medication details not yet captured." />
            <BriefSection title="Smoking" items={liveBrief.smoking} empty="Smoking status not yet captured." />
          </div>
        </div>
      </main>
      <div className="haiku-record-bar">
        <button type="button" className="haiku-note-settings">
          <FileText size={22} />
          <span>NOTE SETTINGS</span>
        </button>
        <button type="button" className="haiku-record-button" aria-label="Record">
          <Mic size={23} />
        </button>
        <button type="button" className="haiku-create-note" onClick={onLaunch} disabled={isRunBusy}>
          <ArrowRight size={23} />
          <span>{run ? 'REFRESH NOTE' : 'CREATE NOTE'}</span>
        </button>
        <time>00:00</time>
      </div>
      <nav className="haiku-tabs" aria-label="Haiku tabs">
        <Folder className="active-folder" size={25} />
        <ChevronDown size={23} />
        <span><FileText size={24} />Summary</span>
        <span className="active"><AudioLines size={26} />Abridge Inside</span>
        <span><ClipboardList size={24} />Encounters</span>
      </nav>
    </div>
  )
}

function BriefNarrative({ summary }: { summary: string }) {
  return (
    <section className="live-brief-summary">
      <p>{summary}</p>
    </section>
  )
}

function BriefSection({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="live-brief-section">
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </section>
  )
}

function buildLiveVisitBrief(messages: AbbyChatMessage[], abbyCase: AbbyCase) {
  const patientMessages = messages.filter((message) => message.sender === 'patient').map((message) => message.content.trim()).filter(Boolean)
  const latest = patientMessages.at(-1)
  const allPatientText = patientMessages.join(' ')
  const setting = formatVisitSetting(abbyCase.record.metadata.visit_type)
  const isInpatient = setting === 'Inpatient'
  const visitReason = buildVisitReason(patientMessages, abbyCase, isInpatient)
  const biggestComplaint = latest ? [summarizePatientConcern(patientMessages)] : []
  const intervalChanges = extractMatchingAnswers(patientMessages, /(night|overnight|today|morning|worse|better|same|changed|new|started|since)/i, patientMessages)
  const symptoms = extractMatchingAnswers(patientMessages, /(pain|breath|short|nausea|vomit|fever|chill|dizzy|weak|numb|swelling|bleed|sleep|appetite|walk|bathroom|chest|cough)/i)
  const followUp = [
    ...extractMatchingAnswers(patientMessages, /(worried|concern|question|need|want|help|call|doctor|nurse|team|med|medicine|discharge|home)/i),
    ...(patientMessages.length ? [`Continue ${setting.toLowerCase()} check-in; ${patientMessages.length} patient answer${patientMessages.length === 1 ? '' : 's'} captured.`] : []),
  ]
  const medicationItems = buildMedicationItems(patientMessages, abbyCase)
  const smokingItems = buildSmokingItems(patientMessages)

  return {
    summary: buildBriefSummary({
      visitReasonTitle: isInpatient ? 'Admitting diagnosis' : 'Reason for visit',
      visitReason: visitReason[0],
      biggestComplaint: biggestComplaint[0],
      intervalChanges: dedupeBriefItems(intervalChanges.length ? intervalChanges : patientMessages.slice(0, 1).map(summarizePatientAnswer)),
      symptoms: dedupeBriefItems(symptoms),
      followUp: dedupeBriefItems(followUp),
      setting,
      answerCount: patientMessages.length,
    }),
    medications: medicationItems,
    smoking: smokingItems,
    rawText: allPatientText,
  }
}

function buildBriefSummary({
  visitReasonTitle,
  visitReason,
  biggestComplaint,
  intervalChanges,
  symptoms,
  followUp,
  setting,
  answerCount,
}: {
  visitReasonTitle: string
  visitReason: string
  biggestComplaint?: string
  intervalChanges: string[]
  symptoms: string[]
  followUp: string[]
  setting: string
  answerCount: number
}): string {
  if (!answerCount) {
    return `${visitReasonTitle}: ${visitReason || 'not yet captured'}. Waiting for the patient's first update.`
  }

  const updates = dedupeBriefItems([
    biggestComplaint,
    ...intervalChanges,
    ...symptoms,
  ].filter(isNonEmptyString).map(normalizeClinicalUpdate))
  const patientUpdate = joinBriefClauses(updates) || 'the patient has started the check-in'
  const followUpContext = followUp.find((item) => !/Continue .* check-in/i.test(item))
  const followUpSentence = followUpContext ? `Priority: ${normalizeClinicalUpdate(followUpContext)}.` : ''

  return [
    `${visitReasonTitle}: ${visitReason || `${setting.toLowerCase()} check-in`}.`,
    `Update: ${patientUpdate}.`,
    followUpSentence,
  ].filter(Boolean).join(' ')
}

function buildMedicationItems(messages: string[], abbyCase: AbbyCase): string[] {
  const medicationAnswers = messages.flatMap(extractMedicationKeywords)
  if (medicationAnswers.length) return dedupeBriefItems(medicationAnswers)

  const chartMedications = abbyCase.record.patient_context.longitudinal_summary.medication_labels
    .filter(isPertinentMedication)
    .map(cleanClinicalPhrase)
    .map(formatMedicationLabel)
    .filter(Boolean)
    .slice(0, 3)
  if (chartMedications.length) return [`Chart: ${chartMedications.join('; ')}`]
  return []
}

function isPertinentMedication(value: string): boolean {
  return /\b(?:aspirin|plavix|clopidogrel|eliquis|apixaban|xarelto|rivaroxaban|warfarin|coumadin|statin|simvastatin|atorvastatin|rosuvastatin|pravastatin|lovastatin)\b/i.test(value)
}

function extractMedicationKeywords(value: string): string[] {
  const normalized = value.toLowerCase()
  const medications = [
    { pattern: /\baspirin\b/, label: 'aspirin' },
    { pattern: /\b(?:atorvastatin|lipitor)\b/, label: 'atorvastatin' },
    { pattern: /\b(?:rosuvastatin|crestor)\b/, label: 'rosuvastatin' },
    { pattern: /\bsimvastatin\b/, label: 'simvastatin' },
    { pattern: /\bpravastatin\b/, label: 'pravastatin' },
    { pattern: /\blovastatin\b/, label: 'lovastatin' },
    { pattern: /\b(?:plavix|clopidogrel)\b/, label: 'clopidogrel' },
    { pattern: /\b(?:eliquis|apixaban)\b/, label: 'apixaban' },
    { pattern: /\b(?:xarelto|rivaroxaban)\b/, label: 'rivaroxaban' },
    { pattern: /\b(?:coumadin|warfarin)\b/, label: 'warfarin' },
  ]
    .filter((medication) => medication.pattern.test(normalized))
    .map((medication) => medication.label)

  if (!medications.length && /\bstatins?\b/.test(normalized)) return ['statin therapy']
  return medications
}

function formatMedicationLabel(value: string): string {
  const normalized = value
    .replace(/\bMG\b/g, 'mg')
    .replace(/\bOral Tablet\b/gi, '')
    .replace(/\bcalcium\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return extractMedicationKeywords(normalized)[0] ?? normalized
}

function buildSmokingItems(messages: string[]): string[] {
  const smokingAnswer = messages.findLast((message) => /(smok|cigarette|vape|tobacco|nicotine|never smoked|non[- ]?smoker)/i.test(message))
  return smokingAnswer ? [summarizeSmokingStatus(smokingAnswer)] : []
}

function summarizeSmokingStatus(value: string): string {
  const normalized = value.toLowerCase()
  const quitMatch = normalized.match(/\b(?:quit|stopped)\s+smoking\s+((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:years?|months?|weeks?)\s+ago)\b/)
  if (quitMatch) return `former smoker; quit ${quitMatch[1]}`
  if (/\b(?:never smoked|never smoker|non[- ]?smoker)\b/.test(normalized)) return 'never smoker'
  if (/\b(?:quit|stopped)\b/.test(normalized)) return 'former smoker'
  if (/\b(?:current|still|yes)\b.*\b(?:smok|cigarette|vape|tobacco|nicotine)\b/.test(normalized)) return 'current tobacco use'
  if (/\bno\b.*\b(?:smok|cigarette|vape|tobacco|nicotine)\b/.test(normalized)) return 'no current tobacco use'
  return normalizeClinicalUpdate(value)
}

function buildVisitReason(messages: string[], abbyCase: AbbyCase, isInpatient: boolean): string[] {
  const chartReason = chartVisitReason(abbyCase)
  if (isInpatient && chartReason) return [chartReason]
  const interviewReason = patientInterviewReason(messages)
  return dedupeBriefItems([interviewReason, chartReason].filter(Boolean))
}

function chartVisitReason(abbyCase: AbbyCase): string {
  const titleReason = reasonFromVisitTitle(abbyCase.record.metadata.visit_title)
  const encounter = abbyCase.record.encounter_fhir.encounter
  const reasonCode = firstCodeText(encounter.reasonCode)
  const encounterType = firstCodeText(encounter.type)
  return cleanClinicalPhrase(titleReason || reasonCode || encounterType || abbyCase.record.metadata.visit_type || abbyCase.record.metadata.visit_title)
}

function reasonFromVisitTitle(title: string): string {
  const parts = title.split(/\s+(?:\u2013|\u2014|-)\s+/)
  return parts.length > 1 ? parts.slice(1).join(' - ') : title
}

function firstCodeText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (typeof item?.text === 'string') return item.text
    const coding = item?.coding
    if (Array.isArray(coding)) {
      const display = coding.find((entry) => typeof entry?.display === 'string')?.display
      if (display) return display
    }
  }
  return ''
}

function cleanClinicalPhrase(value: string): string {
  return value
    .replace(/\s*\((?:disorder|procedure|finding|situation)\)\s*$/i, '')
    .replace(/^inpatient admission\s+(?:for|with)\s+/i, '')
    .replace(/^outpatient visit\s+(?:for|with)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function patientInterviewReason(messages: string[]): string {
  const answer = messages.findLast((message) => /\b(came in|admitted|here for|visit is for|appointment is for|reason is|because)\b/i.test(message))
  if (!answer) return ''
  return summarizePatientConcern(messages, answer)
}

function extractMatchingAnswers(messages: string[], pattern: RegExp, contextMessages = messages): string[] {
  return messages.filter((message) => pattern.test(message)).slice(-3).map((message) => summarizePatientConcern(contextMessages, message))
}

function summarizePatientConcern(messages: string[], answer = messages.at(-1) ?? ''): string {
  const compact = answer.replace(/\s+/g, ' ').trim()
  const symptomSummary = summarizeSymptomContext(messages)
  const symptomContext = symptomSummary.text
  const trajectory = describeTrajectory(compact, symptomSummary.count > 1)
  if (symptomContext && trajectory && !mentionsSymptom(compact)) {
    return `${symptomContext} ${trajectory}.`
  }
  if (symptomContext && isVagueConcern(compact)) return symptomContext
  return summarizePatientAnswer(compact)
}

function summarizePatientAnswer(answer: string): string {
  const compact = answer.replace(/\s+/g, ' ').trim()
  if (compact.length <= 130) return compact
  return `${compact.slice(0, 127).trim()}...`
}

function normalizeBriefSentence(value: string): string {
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/^(?:hi|hello|hey)[,!.\s]+/i, '')
    .replace(/^(?:i am|i'm)\s+(?:having|here for|coming in for)\s+/i, '')
    .replace(/^i\s+(?:have|had|am having|was having|came in for|came in because|am here because|want to talk about)\s+/i, '')
    .replace(/^my\s+/i, '')
    .replace(/[.\s]+$/g, '')
    .trim()
  return normalized ? lowerFirst(normalized) : ''
}

function normalizeClinicalUpdate(value: string): string {
  const normalized = normalizeBriefSentence(value)
    .replace(/\bi\s+(?:would like to|want to|need to)\s+know\s+what\s+is\s+causing\s+(?:this|the|my)?\s*/gi, 'asks cause of ')
    .replace(/\band\s+what\s+i\s+can\s+do\s+about\s+it\b/gi, 'and management')
    .replace(/\bi\s+(?:would like to|want to|need to)\s+(?:know|understand)\b/gi, 'asks about')
    .replace(/\bi\s+(?:would like to|want to|need)\b/gi, 'requests')
    .replace(/\bi\s+(?:am|was|'m)\b/gi, 'is')
    .replace(/\bi\s+(?:have|had)\b/gi, 'has')
    .replace(/\bi\s+can\b/gi, 'can')
    .replace(/\bmy\b/gi, 'the')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[.\s]+$/g, '')
    .trim()

  return normalized ? lowerFirst(normalized) : ''
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value)
}

function lowerFirst(value: string): string {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value
}

function joinBriefClauses(items: string[]): string {
  const clauses = items.filter(Boolean).slice(0, 3)
  if (!clauses.length) return ''
  if (clauses.length === 1) return clauses[0]
  if (clauses.length === 2) return `${clauses[0]}; ${clauses[1]}`
  return `${clauses[0]}; ${clauses[1]}; ${clauses[2]}`
}

function summarizeSymptomContext(messages: string[]): { text: string; count: number } {
  const joined = messages.join(' ').toLowerCase()
  let symptoms = [
    { pattern: /(?:hard time|trouble|difficulty|shortness of breath|catching my breath|breath(?:ing)?)/i, label: 'Breathing difficulty' },
    { pattern: /chest pain|chest pressure|chest tightness/i, label: 'chest pain' },
    { pattern: /leg pain|calf pain|foot pain|toe pain/i, label: 'leg/foot pain' },
    { pattern: /abdominal pain|belly pain|stomach pain/i, label: 'abdominal pain' },
    { pattern: /\bpain\b/i, label: 'pain' },
    { pattern: /swelling|edema/i, label: 'swelling' },
    { pattern: /nausea|vomit/i, label: 'nausea/vomiting' },
    { pattern: /fever|chills/i, label: 'fever/chills' },
    { pattern: /dizzy|weak|weakness/i, label: 'dizziness/weakness' },
    { pattern: /bleed|bleeding/i, label: 'bleeding' },
  ].filter((symptom) => symptom.pattern.test(joined)).map((symptom) => symptom.label)
  if (symptoms.length > 1) symptoms = symptoms.filter((symptom) => symptom !== 'pain')
  const uniqueSymptoms = Array.from(new Set(symptoms)).slice(0, 3)
  return {
    text: formatSymptomPhrase(uniqueSymptoms),
    count: uniqueSymptoms.length,
  }
}

function formatSymptomPhrase(symptoms: string[]): string {
  if (!symptoms.length) return ''
  if (symptoms.length === 1) return capitalize(symptoms[0])
  if (symptoms.length === 2) return `${capitalize(symptoms[0])} and ${symptoms[1]}`
  return `${capitalize(symptoms.slice(0, -1).join(', '))}, and ${symptoms.at(-1)}`
}

function describeTrajectory(answer: string, plural: boolean): string {
  const compact = answer.toLowerCase()
  if (/worse|worsening|harder|more difficult|increased|more intense/.test(compact)) return plural ? 'seem worse' : 'seems worse'
  if (/better|improving|improved|less/.test(compact)) return plural ? 'seem better' : 'seems better'
  if (/\bsame\b|unchanged|no change|not changed|similar/.test(compact)) return plural ? 'are about the same' : 'is about the same'
  return ''
}

function mentionsSymptom(answer: string): boolean {
  return /(pain|breath|short|nausea|vomit|fever|chill|dizzy|weak|numb|swelling|bleed|sleep|appetite|walk|bathroom|chest|cough|leg|foot|toe|abdomen|belly|stomach)/i.test(answer)
}

function isVagueConcern(answer: string): boolean {
  return /^(it|this|that|they|things?)\b/i.test(answer) || answer.split(/\s+/).length <= 7
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

function dedupeBriefItems(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean))).slice(0, 4)
}

function patientOptionLabel(record: EncounterRecord, index: number): string {
  const patient = record.patient_context.patient.name?.[0]
  const name = [patient?.given?.[0], patient?.family].filter(Boolean).join(' ') || `Patient ${index + 1}`
  const visit = record.metadata.visit_title || 'Visit'
  const setting = formatVisitSetting(record.metadata.visit_type)
  return `${name} - ${visit} - ${setting}`
}

function formatVisitSetting(visitType: string): string {
  const normalized = visitType.trim().toLowerCase()
  if (/inpatient|hospital|admission|admitted/.test(normalized)) return 'Inpatient'
  if (/outpatient|ambulatory|clinic|office/.test(normalized)) return 'Outpatient'
  return visitType || 'Visit'
}

function activeCheckInStorageKey(recordId: string, providerId?: string): string {
  return `abby.chat.activeCheckIn.${recordId}.${providerId || 'default-provider'}`
}

function readActiveCheckInId(activeCheckInKey: string): string {
  const stored = window.localStorage.getItem(activeCheckInKey)
  if (stored) return stored
  const nextCheckInId = createCheckInId()
  window.localStorage.setItem(activeCheckInKey, nextCheckInId)
  return nextCheckInId
}

function createCheckInId(): string {
  return createMessageId('check-in').replace(/^check-in-/, '')
}

function readStoredMessages(storageKey: string, abbyCase: AbbyCase, provider: Parameters<typeof initialAbbyMessage>[1], providers: Parameters<typeof normalizeStoredWelcomeMessage>[3]): AbbyChatMessage[] {
  const stored = window.localStorage.getItem(storageKey)
  if (!stored) return [initialAbbyMessage(abbyCase, provider)]
  try {
    const parsed = JSON.parse(stored) as AbbyChatMessage[]
    return parsed.length ? normalizeStoredWelcomeMessage(parsed, abbyCase, provider, providers) : [initialAbbyMessage(abbyCase, provider)]
  } catch {
    window.localStorage.removeItem(storageKey)
    return [initialAbbyMessage(abbyCase, provider)]
  }
}

function normalizeStoredWelcomeMessage(messages: AbbyChatMessage[], abbyCase: AbbyCase, provider: Parameters<typeof initialAbbyMessage>[1], providers: Array<{ name?: string }>): AbbyChatMessage[] {
  const [firstMessage, ...rest] = messages
  if (!firstMessage || firstMessage.sender !== 'abby') return messages

  const providerNames = Array.from(new Set([provider?.name, ...providers.map((person) => person.name)].filter(Boolean) as string[]))
  const normalizedContent = titleProviderPossessives(firstMessage.content, providerNames)
  const shouldRegenerateWelcome = Boolean(provider?.name) && normalizedContent !== firstMessage.content
  if (normalizedContent === firstMessage.content) return messages

  return [
    {
      ...firstMessage,
      content: shouldRegenerateWelcome ? initialAbbyMessage(abbyCase, provider).content : normalizedContent,
    },
    ...rest,
  ]
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(timestamp?: string): string {
  if (!timestamp) return 'Today'
  return new Date(timestamp).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatShortDate(value: string): string {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${Number(month)}/${Number(day)}/${year}`
}
