import { approveRun, createRun, executeApprovedRun } from './abbyEngine'
import type { AbbyCase, AbbyRun, DirectoryPerson, DirectoryResponse } from './types'

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
  const people: DirectoryPerson[] = [
    {
      id: 'person-oliver-aalami',
      name: 'Oliver Aalami',
      phone: '+16503153236',
      roles: ['superadmin'],
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: 'person-maya-chen',
      name: 'Maya Chen',
      phone: '+14155550118',
      roles: ['provider'],
      specialty: 'Care Navigation',
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: 'person-lena-morales',
      name: 'Lena Morales',
      phone: '+14155550124',
      roles: ['patient'],
      primaryProviderId: 'person-maya-chen',
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: 'person-sam-patel',
      name: 'Sam Patel',
      phone: '+14155550142',
      roles: ['patient', 'provider'],
      specialty: 'Physical Therapy',
      primaryProviderId: 'person-oliver-aalami',
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  ]
  return toLocalDirectoryResponse(people)
}

function readLocalDirectory(): DirectoryResponse {
  const stored = window.localStorage.getItem(localDirectoryStorageKey)
  if (!stored) return defaultDirectory()
  try {
    return JSON.parse(stored) as DirectoryResponse
  } catch {
    window.localStorage.removeItem(localDirectoryStorageKey)
    return defaultDirectory()
  }
}

function writeLocalDirectory(directory: DirectoryResponse) {
  window.localStorage.setItem(localDirectoryStorageKey, JSON.stringify(directory))
}

function toLocalDirectoryResponse(people: DirectoryPerson[], extra: Partial<DirectoryResponse> = {}): DirectoryResponse {
  const sorted = [...people].sort((a, b) => {
    const priority = Number(b.roles.includes('superadmin')) - Number(a.roles.includes('superadmin'))
    return priority || a.name.localeCompare(b.name)
  })
  return {
    persistence: 'browser-fallback',
    auth: 'mock-otp',
    people: sorted,
    counts: {
      people: sorted.length,
      superadmins: sorted.filter((person) => person.roles.includes('superadmin')).length,
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
    const current = readLocalDirectory()
    const phone = normalizePhone(person.phone)
    const now = new Date().toISOString()
    const nextPerson = {
      id: person.id ?? `person-${Date.now()}`,
      name: person.name ?? 'New person',
      phone,
      roles: person.roles ?? ['patient'],
      specialty: person.specialty,
      primaryProviderId: person.primaryProviderId,
      createdAt: person.createdAt ?? now,
      updatedAt: now,
    } satisfies DirectoryPerson
    const people = current.people.filter((item) => item.phone !== phone)
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
    const current = readLocalDirectory()
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
    const current = readLocalDirectory()
    const normalizedPhone = normalizePhone(phone)
    return toLocalDirectoryResponse(current.people, {
      session: {
        phone: normalizedPhone,
        roles: code === '123456' ? (current.people.find((person) => person.phone === normalizedPhone)?.roles ?? []) : [],
      },
    })
  }
}
