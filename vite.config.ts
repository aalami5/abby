import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import agentAction from './api/agent-action.js'
import agentContext from './api/agent-context.js'
import agentEvent from './api/agent-event.js'
import capabilities from './api/capabilities.js'
import chat from './api/chat.js'
import directory from './api/directory.js'
import health from './api/health.js'
import livekitToken from './api/livekit-token.js'
import patientChat from './api/patient-chat.js'
import patientContext from './api/patient-context.js'
import patientSession from './api/patient-session.js'
import runs from './api/runs.js'

type LocalApiHandler = (request: LocalApiRequest, response: LocalApiResponse) => void | Promise<void>
type LocalApiRequest = IncomingMessage & {
  body?: unknown
  query?: Record<string, string>
}
type LocalApiResponse = {
  status: (code: number) => { json: (body: unknown) => void }
}

const localApiHandlers: Record<string, LocalApiHandler> = {
  '/api/agent-action': agentAction,
  '/api/agent-context': agentContext,
  '/api/agent-event': agentEvent,
  '/api/capabilities': capabilities,
  '/api/chat': chat,
  '/api/directory': directory,
  '/api/health': health,
  '/api/livekit-token': livekitToken,
  '/api/patient-chat': patientChat,
  '/api/patient-context': patientContext,
  '/api/patient-session': patientSession,
  '/api/runs': runs,
}

function localApiPlugin(): Plugin {
  return {
    name: 'abby-local-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const handler = localApiHandlers[url.pathname]
        if (!handler) return next()

        try {
          const localRequest = request as LocalApiRequest
          localRequest.query = Object.fromEntries(url.searchParams)
          localRequest.body = await readJsonBody(request)
          await handler(localRequest, jsonResponse(response))
        } catch (error) {
          if (response.writableEnded) return
          response.statusCode = 500
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'local_api_error' }))
        }
      })
    },
  }
}

function jsonResponse(response: ServerResponse): LocalApiResponse {
  return {
    status(code) {
      response.statusCode = code
      return {
        json(body) {
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body))
        },
      }
    },
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = Buffer.concat(chunks).toString('utf8').trim()
  if (!body) return undefined
  return JSON.parse(body)
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), localApiPlugin()],
  }
})
