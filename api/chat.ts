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
    age?: number
    gender?: string
    city?: string
    state?: string
    visitTitle?: string
    conditions?: string[]
    medications?: string[]
    signals?: Array<{ label?: string; value?: string; severity?: string; source?: string }>
    openQuestions?: string[]
    actionItems?: string[]
    transcriptExcerpt?: string
    noteExcerpt?: string
    afterVisitSummaryExcerpt?: string
  }
  specialist?: {
    name?: string
    specialty?: string
  }
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
const defaultModel = 'claude-sonnet-4-6'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
    if (!apiKey) {
      response.status(500).json({ error: 'Claude is not configured. Set ANTHROPIC_API_KEY in Vercel.' })
      return
    }

    const body = parseBody(request.body)
    const messages = normalizeMessages(body.messages)
    if (!messages.length) {
      response.status(400).json({ error: 'messages are required' })
      return
    }

    const context = normalizeContext(body.context)
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

    response.status(200).json({
      message: {
        id: `abby-${Date.now()}`,
        sender: 'abby',
        content: text,
        timestamp: new Date().toISOString(),
      },
      model: payload.model ?? process.env.ABBY_CLAUDE_MODEL ?? defaultModel,
    })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

function buildSystemPrompt(context: ChatContext): string {
  const patient = context.patient ?? {}
  const specialist = context.specialist ?? {}
  return [
    'You are Abby, a patient-facing clinical follow-up assistant.',
    `You act on behalf of ${specialist.name || 'the patient\'s specialist'}${specialist.specialty ? ` in ${specialist.specialty}` : ''}.`,
    'Be supportive, concise, and concrete. Use plain language. Ask at most one focused follow-up question when needed.',
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
      conditions: patient.conditions,
      medications: patient.medications,
      signals: patient.signals,
      openQuestions: patient.openQuestions,
      actionItems: patient.actionItems,
      transcriptExcerpt: patient.transcriptExcerpt,
      noteExcerpt: patient.noteExcerpt,
      afterVisitSummaryExcerpt: patient.afterVisitSummaryExcerpt,
    }, null, 2),
  ].join('\n')
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
