import { approveRun, createRun, executeApprovedRun, getPatientName, loadRecords } from './abbyEngine'
import type { AbbyChatContext, AbbyChatMessage, AbbyChatResponse } from './chatTypes'
import type { AbbyCase, AbbyRun, DirectoryPerson, DirectoryResponse, EncounterRecord } from './types'

type RunsResponse = {
  persistence: string
  runsByCase: Record<string, AbbyRun>
}

type CheckInResponse = {
  mode: 'twilio' | 'demo'
  status: string
  message: string
  twilioMessageSid?: string
  twilioErrorCode?: number
  twilioErrorMessage?: string
  detail?: string
}

const localRunsStorageKey = 'abby.demo.runs'
const localDirectoryStorageKey = 'abby.demo.directory'
const seededAt = '2026-07-18T19:30:00Z'

class AbbyApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AbbyApiError'
    this.status = status
  }
}

function readLocalRuns(): Record<string, AbbyRun> {
  const stored = window.localStorage.getItem(localRunsStorageKey)
  if (!stored) return {}
  try {
    return JSON.parse(stored) as Record<string, AbbyRun>
  } catch {
    window.localStorage.removeItem(localRunsStorageKey)
    return {}
  }
}

function writeLocalRuns(runsByCase: Record<string, AbbyRun>) {
  window.localStorage.setItem(localRunsStorageKey, JSON.stringify(runsByCase))
}

function defaultDirectory(): DirectoryResponse {
  return toLocalDirectoryResponse([oliverAdmin()])
}

async function readLocalDirectory(): Promise<DirectoryResponse> {
  const seeded = await seededDirectory()
  const stored = window.localStorage.getItem(localDirectoryStorageKey)
  if (!stored) return seeded
  try {
    return normalizeSeededDirectory(JSON.parse(stored) as DirectoryResponse, seeded.people)
  } catch {
    window.localStorage.removeItem(localDirectoryStorageKey)
    return seeded
  }
}

function writeLocalDirectory(directory: DirectoryResponse) {
  window.localStorage.setItem(localDirectoryStorageKey, JSON.stringify(directory))
}

function toLocalDirectoryResponse(people: DirectoryPerson[], extra: Partial<DirectoryResponse> = {}): DirectoryResponse {
  const sorted = [...people].sort((a, b) => {
    const priority = Number(hasAdminRole(b)) - Number(hasAdminRole(a))
    return priority || a.name.localeCompare(b.name)
  })
  const admins = sorted.filter(hasAdminRole).length
  return {
    persistence: 'browser-fallback',
    auth: 'mock-otp',
    people: sorted,
    agentInstructionReferences: seedAgentInstructionReferences(),
    counts: {
      people: sorted.length,
      admins,
      superadmins: admins,
      providers: sorted.filter((person) => person.roles.includes('provider')).length,
      patients: sorted.filter((person) => person.roles.includes('patient')).length,
    },
    ...extra,
  }
}

function normalizePhone(value?: string): string {
  const trimmed = (value ?? '').trim()
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  return digits ? `+${digits}` : ''
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new AbbyApiError(detail ? `Abby API returned ${response.status}: ${detail}` : `Abby API returned ${response.status}`, response.status)
  }
  return response.json() as Promise<T>
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown; message?: unknown }
    const detail = payload.error ?? payload.message
    return typeof detail === 'string' ? detail : ''
  } catch {
    return ''
  }
}

export async function loadRuns(): Promise<RunsResponse> {
  try {
    return await requestJson<RunsResponse>('/api/runs')
  } catch {
    return { persistence: 'browser-fallback', runsByCase: readLocalRuns() }
  }
}

export async function launchRun(abbyCase: AbbyCase, channel: AbbyRun['patientChannel'] = 'sms'): Promise<RunsResponse> {
  const nextRun = createRun(abbyCase, channel)
  try {
    return await requestJson<RunsResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ run: nextRun }),
    })
  } catch {
    const runsByCase = readLocalRuns()
    runsByCase[abbyCase.record.id] = runsByCase[abbyCase.record.id] ?? nextRun
    writeLocalRuns(runsByCase)
    return { persistence: 'browser-fallback', runsByCase }
  }
}

export async function approveCloudRun(abbyCase: AbbyCase, run: AbbyRun): Promise<RunsResponse> {
  const nextRun = approveRun(run, 'Demo clinician')
  try {
    return await requestJson<RunsResponse>('/api/runs', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'approve', run: nextRun }),
    })
  } catch {
    const runsByCase = readLocalRuns()
    runsByCase[abbyCase.record.id] = nextRun
    writeLocalRuns(runsByCase)
    return { persistence: 'browser-fallback', runsByCase }
  }
}

export async function executeCloudRun(abbyCase: AbbyCase, run: AbbyRun): Promise<RunsResponse> {
  const nextRun = executeApprovedRun(run, abbyCase)
  try {
    return await requestJson<RunsResponse>('/api/runs', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'execute', run: nextRun }),
    })
  } catch {
    const runsByCase = readLocalRuns()
    runsByCase[abbyCase.record.id] = nextRun
    writeLocalRuns(runsByCase)
    return { persistence: 'browser-fallback', runsByCase }
  }
}

export async function sendChatMessage(input: { messages: AbbyChatMessage[]; context: AbbyChatContext }): Promise<AbbyChatResponse> {
  return requestJson<AbbyChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function sendPatientCheckIn(input: {
  patient: DirectoryPerson
  provider?: DirectoryPerson
}): Promise<CheckInResponse> {
  return requestJson<CheckInResponse>('/api/check-in', {
    method: 'POST',
    body: JSON.stringify({
      patientId: input.patient.id,
      patientName: input.patient.name,
      patientPhone: input.patient.phone,
      providerName: input.provider?.id === 'person-oliver-aalami' ? 'Dr. Oliver Aalami' : (input.provider?.name ?? 'Dr. Oliver Aalami'),
      specialty: input.provider?.specialty ?? 'Vascular Surgery',
      chatUrl: patientVerificationUrl(input.patient),
    }),
  })
}

function patientVerificationUrl(patient: DirectoryPerson): string | undefined {
  if (!patient.sourceRecordId || typeof window === 'undefined') return undefined
  const url = new URL(window.location.origin)
  url.searchParams.set('role', 'patient')
  url.searchParams.set('verify', '1')
  url.searchParams.set('patient', patient.sourceRecordId)
  return url.toString()
}

export async function loadDirectory(): Promise<DirectoryResponse> {
  try {
    const remote = await requestJson<DirectoryResponse>('/api/directory')
    const normalized = normalizeSeededDirectory(remote, remote.people)
    writeLocalDirectory(normalized)
    return normalized
  } catch {
    return readLocalDirectory()
  }
}

export async function saveDirectoryPerson(person: Partial<DirectoryPerson>): Promise<DirectoryResponse> {
  try {
    const nextDirectory = await requestJson<DirectoryResponse>('/api/directory', {
      method: 'POST',
      body: JSON.stringify({ person }),
    })
    writeLocalDirectory(nextDirectory)
    return nextDirectory
  } catch {
    const current = await readLocalDirectory()
    const phone = normalizePhone(person.phone)
    const now = new Date().toISOString()
    const existing = current.people.find((item) => (
      (person.id && item.id === person.id) ||
      (person.sourceRecordId && item.sourceRecordId === person.sourceRecordId) ||
      item.phone === phone
    ))
    const nextPerson = {
      ...existing,
      id: person.id ?? existing?.id ?? `person-${Date.now()}`,
      name: person.name ?? existing?.name ?? 'New person',
      phone,
      roles: normalizeDirectoryRoles(person.roles ?? existing?.roles ?? ['patient']),
      specialty: person.specialty ?? existing?.specialty,
      abbyInstructions: person.abbyInstructions ?? existing?.abbyInstructions,
      abbyInstructionsTitle: person.abbyInstructionsTitle ?? existing?.abbyInstructionsTitle,
      abbyInstructionsSourceFile: person.abbyInstructionsSourceFile ?? existing?.abbyInstructionsSourceFile,
      abbyInstructionsSourcePath: person.abbyInstructionsSourcePath ?? existing?.abbyInstructionsSourcePath,
      abbyInstructionsSourceUrl: person.abbyInstructionsSourceUrl ?? existing?.abbyInstructionsSourceUrl,
      abbyInstructionsAudience: person.abbyInstructionsAudience ?? existing?.abbyInstructionsAudience,
      primaryProviderId: person.primaryProviderId ?? existing?.primaryProviderId,
      gender: person.gender ?? existing?.gender,
      birthDate: person.birthDate ?? existing?.birthDate,
      city: person.city ?? existing?.city,
      state: person.state ?? existing?.state,
      visitTitle: person.visitTitle ?? existing?.visitTitle,
      sourceRecordId: person.sourceRecordId ?? existing?.sourceRecordId,
      synthetic: person.synthetic ?? existing?.synthetic,
      createdAt: person.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now,
    } satisfies DirectoryPerson
    const people = current.people.filter((item) => item.id !== nextPerson.id && item.phone !== phone)
    const next = toLocalDirectoryResponse([nextPerson, ...people])
    const seeded = await seededDirectory()
    const normalized = normalizeSeededDirectory(next, seeded.people)
    writeLocalDirectory(normalized)
    return normalized
  }
}

export async function sendDirectoryOtp(phone: string): Promise<DirectoryResponse> {
  try {
    return await requestJson<DirectoryResponse>('/api/directory', {
      method: 'POST',
      body: JSON.stringify({ action: 'send-otp', phone }),
    })
  } catch (error) {
    if (error instanceof AbbyApiError) throw error
    const current = await readLocalDirectory()
    return toLocalDirectoryResponse(current.people, { otp: { mode: 'mock', phone: normalizePhone(phone), demoCode: '123456' } })
  }
}

export async function verifyDirectoryOtp(phone: string, code: string): Promise<DirectoryResponse> {
  try {
    return await requestJson<DirectoryResponse>('/api/directory', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify-otp', phone, code }),
    })
  } catch (error) {
    if (error instanceof AbbyApiError) throw error
    if (code !== '123456') throw new Error('Invalid or expired code')
    const current = await readLocalDirectory()
    const normalizedPhone = normalizePhone(phone)
    return toLocalDirectoryResponse(current.people, {
      session: {
        phone: normalizedPhone,
        roles: code === '123456' ? (current.people.find((person) => person.phone === normalizedPhone)?.roles ?? []) : [],
      },
    })
  }
}

async function seededDirectory(): Promise<DirectoryResponse> {
  try {
    const records = await loadRecords()
    return toLocalDirectoryResponse([oliverAdmin(), ...records.map(syntheticPatient)])
  } catch {
    return defaultDirectory()
  }
}

function normalizeSeededDirectory(current: DirectoryResponse, seededPeople: DirectoryPerson[]): DirectoryResponse {
  const seedIds = new Set(seededPeople.map((person) => person.id))
  const byId = new Map(current.people.map((person) => [person.id, person]))
  const bySourceRecordId = new Map(current.people.filter((person) => person.sourceRecordId).map((person) => [person.sourceRecordId, person]))
  const people = seededPeople.map((seed) => {
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
  for (const person of current.people) {
    if (
      !seedIds.has(person.id) &&
      !people.some((item) => (
        item.id === person.id ||
        item.phone === person.phone ||
        Boolean(person.sourceRecordId && item.sourceRecordId === person.sourceRecordId) ||
        (!person.sourceRecordId && person.roles.includes('patient') && normalizeName(person.name) === normalizeName(item.name))
      ))
    ) {
      people.push(person)
    }
  }
  return toLocalDirectoryResponse(people, {
    otp: current.otp,
    session: current.session,
  })
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
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
      'Keep patient-facing language concise, calm, and action-oriented.',
    ].join('\n'),
    createdAt: seededAt,
    updatedAt: seededAt,
  }
}

function seedAgentInstructionReferences(): DirectoryResponse['agentInstructionReferences'] {
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

function hasAdminRole(person: DirectoryPerson): boolean {
  return person.roles.some((role) => ['admin', 'superadmin'].includes(String(role)))
}

function normalizeDirectoryRoles(roles: DirectoryPerson['roles']): DirectoryPerson['roles'] {
  return roles.map((role) => String(role) === 'superadmin' ? 'admin' : role)
}

function mergeSeedRoles(seedRoles: DirectoryPerson['roles'], existingRoles: DirectoryPerson['roles']): DirectoryPerson['roles'] {
  return [...new Set([...seedRoles, ...normalizeDirectoryRoles(existingRoles)])]
}

function syntheticPatient(record: EncounterRecord, index: number): DirectoryPerson {
  const patient = record.patient_context.patient
  const address = patient.address?.[0]
  return {
    id: `patient-${record.metadata.patient_id}`,
    name: getPatientName(record),
    phone: `+1555012${String(index + 1).padStart(4, '0')}`,
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
}

function isCardiovascularPatient(record: EncounterRecord): boolean {
  const searchable = [
    record.metadata.visit_title,
    ...record.patient_context.longitudinal_summary.condition_labels,
  ].join(' ')
  return /\b(cardiovascular|cardiac|cardio|heart|coronary|ischemic|myocardial|infarction|hypertension|hyperlipidemia|vascular|stroke|angina|atrial|metabolic syndrome)\b/i.test(searchable)
}
