import { googlePersistenceLabel, hasGoogleCloudDb, readGoogleJson, writeGoogleJson } from './googleCloudStore.js'

type AbbyRun = {
  id: string
  caseId: string
  stage: string
  updatedAt: string
  [key: string]: unknown
}

type RunsStore = {
  runsByCase: Record<string, AbbyRun>
}

type AbbyGlobal = typeof globalThis & {
  abbyRunsStore?: RunsStore
}

type VercelRequest = {
  method?: string
  body?: unknown
}

type VercelResponse = {
  status: (code: number) => { json: (body: unknown) => void }
}

const firestoreDocumentId = 'runs-v1'
const store = ((globalThis as AbbyGlobal).abbyRunsStore ??= { runsByCase: {} })

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const current = await readRunsStore()

    if (request.method === 'GET') {
      response.status(200).json(toResponse(current))
      return
    }

    if (request.method === 'POST') {
      const body = parseBody(request.body)
      const run = normalizeRun(body.run)
      current.runsByCase[run.caseId] = current.runsByCase[run.caseId] ?? run
      await writeRunsStore(current)
      response.status(200).json(toResponse(current))
      return
    }

    if (request.method === 'PATCH') {
      const body = parseBody(request.body)
      const run = normalizeRun(body.run)
      const existing = current.runsByCase[run.caseId]

      if (!existing || existing.id !== run.id) {
        response.status(404).json({ error: 'Run not found' })
        return
      }

      if (body.action === 'execute' && existing.stage !== 'approved') {
        response.status(409).json({ error: 'Run must be approved before execution' })
        return
      }

      current.runsByCase[run.caseId] = run
      await writeRunsStore(current)
      response.status(200).json(toResponse(current))
      return
    }

    if (request.method === 'DELETE') {
      const body = parseBody(request.body)
      const caseId = typeof body.caseId === 'string' ? body.caseId : ''
      if (!caseId) {
        response.status(400).json({ error: 'caseId is required' })
        return
      }
      delete current.runsByCase[caseId]
      await writeRunsStore(current)
      response.status(200).json(toResponse(current))
      return
    }

    response.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

function toResponse(current: RunsStore) {
  return {
    service: 'abby',
    persistence: googlePersistenceLabel(),
    warning: hasGoogleCloudDb() ? undefined : 'Demo persistence survives warm serverless instances. Add Google Cloud Firestore for durable production storage.',
    runsByCase: current.runsByCase,
  }
}

function parseBody(body: unknown) {
  if (typeof body === 'string') return JSON.parse(body) as Record<string, unknown>
  if (body && typeof body === 'object') return body as Record<string, unknown>
  return {}
}

function normalizeRun(value: unknown): AbbyRun {
  if (!value || typeof value !== 'object') throw new Error('run is required')
  const run = value as AbbyRun
  if (!run.id || !run.caseId || !run.stage || !run.updatedAt) throw new Error('run is missing required fields')
  return run
}

async function readRunsStore(): Promise<RunsStore> {
  return readGoogleJson(firestoreDocumentId, store)
}

async function writeRunsStore(nextStore: RunsStore): Promise<void> {
  store.runsByCase = nextStore.runsByCase
  await writeGoogleJson(firestoreDocumentId, nextStore)
}
