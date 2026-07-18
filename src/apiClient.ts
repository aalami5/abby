import { approveRun, createRun, executeApprovedRun, getPatientName, loadRecords } from './abbyEngine'
import type { AbbyChatContext, AbbyChatMessage, AbbyChatResponse } from './chatTypes'
import type { AbbyCase, AbbyRun, DirectoryPerson, DirectoryResponse, EncounterRecord } from './types'

type RunsResponse = {
  persistence: string
  runsByCase: Record<string, AbbyRun>
}

const localRunsStorageKey = 'abby.demo.runs'
const localDirectoryStorageKey = 'abby.demo.directory'
const seededAt = '2026-07-18T19:30:00Z'

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
    throw new Error(`Abby API returned ${response.status}`)
  }
  return response.json() as Promise<T>
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

export async function loadDirectory(): Promise<DirectoryResponse> {
  try {
    return await requestJson<DirectoryResponse>('/api/directory')
  } catch {
    return readLocalDirectory()
  }
}

export async function saveDirectoryPerson(person: Partial<DirectoryPerson>): Promise<DirectoryResponse> {
  try {
    return await requestJson<DirectoryResponse>('/api/directory', {
      method: 'POST',
      body: JSON.stringify({ person }),
    })
  } catch {
    const current = await readLocalDirectory()
    const phone = normalizePhone(person.phone)
    const now = new Date().toISOString()
    const existing = current.people.find((item) => item.id === person.id || item.phone === phone)
    const nextPerson = {
      ...existing,
      id: person.id ?? existing?.id ?? `person-${Date.now()}`,
      name: person.name ?? existing?.name ?? 'New person',
      phone,
      roles: normalizeDirectoryRoles(person.roles ?? existing?.roles ?? ['patient']),
      specialty: person.specialty ?? existing?.specialty,
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
    writeLocalDirectory(next)
    return next
  }
}

export async function sendDirectoryOtp(phone: string): Promise<DirectoryResponse> {
  try {
    return await requestJson<DirectoryResponse>('/api/directory', {
      method: 'POST',
      body: JSON.stringify({ action: 'send-otp', phone }),
    })
  } catch {
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
  } catch {
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
  const people = seededPeople.map((seed) => {
    const existing = byId.get(seed.id)
    return existing
      ? {
          ...seed,
          name: existing.name || seed.name,
          phone: existing.phone || seed.phone,
          roles: existing.roles.length ? normalizeDirectoryRoles(existing.roles) : seed.roles,
          specialty: existing.specialty,
          primaryProviderId: existing.primaryProviderId,
          gender: existing.gender,
          birthDate: existing.birthDate,
          city: existing.city,
          state: existing.state,
          visitTitle: existing.visitTitle,
          sourceRecordId: existing.sourceRecordId,
          synthetic: existing.synthetic,
          createdAt: existing.createdAt || seed.createdAt,
          updatedAt: existing.updatedAt || seed.updatedAt,
        }
      : seed
  })
  for (const person of current.people) {
    if (!seedIds.has(person.id) && !people.some((item) => item.id === person.id || item.phone === person.phone)) {
      people.push(person)
    }
  }
  return toLocalDirectoryResponse(people, {
    otp: current.otp,
    session: current.session,
  })
}

function oliverAdmin(): DirectoryPerson {
  return {
    id: 'person-oliver-aalami',
    name: 'Oliver Aalami',
    phone: '+16503153236',
    roles: ['admin'],
    createdAt: seededAt,
    updatedAt: seededAt,
  }
}

function hasAdminRole(person: DirectoryPerson): boolean {
  return person.roles.some((role) => ['admin', 'superadmin'].includes(String(role)))
}

function normalizeDirectoryRoles(roles: DirectoryPerson['roles']): DirectoryPerson['roles'] {
  return roles.map((role) => String(role) === 'superadmin' ? 'admin' : role)
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
    sourceRecordId: record.id,
    synthetic: true,
    createdAt: seededAt,
    updatedAt: seededAt,
  }
}
