import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bot, ClipboardList, Send, Sparkles, Stethoscope, UserRound } from 'lucide-react'
import type { AbbyCase, AbbyRun, DirectoryResponse } from './types'
import { buildChatContext, initialAbbyMessage, type AbbyChatMessage } from './chatTypes'
import { sendChatMessage } from './apiClient'

type PatientChatProps = {
  abbyCase: AbbyCase
  directory: DirectoryResponse | null
  run?: AbbyRun
  onLaunch: () => void
  isRunBusy: boolean
  patientOnly?: boolean
}

export function PatientChat({ abbyCase, directory, run, onLaunch, isRunBusy, patientOnly = false }: PatientChatProps) {
  const provider = useMemo(() => {
    if (!directory) return undefined
    const patient = directory.people.find((person) => person.sourceRecordId === abbyCase.record.id)
    return directory.people.find((person) => person.id === patient?.primaryProviderId) ?? directory.people.find((person) => person.roles.includes('provider'))
  }, [abbyCase.record.id, directory])
  const context = useMemo(() => buildChatContext(abbyCase, provider), [abbyCase, provider])
  const storageKey = `abby.chat.${abbyCase.record.id}`
  const [messages, setMessages] = useState<AbbyChatMessage[]>(() => readStoredMessages(storageKey, abbyCase, provider))
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(readStoredMessages(storageKey, abbyCase, provider))
    setDraft('')
    setError('')
  }, [abbyCase, provider, storageKey])

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(messages))
  }, [messages, storageKey])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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

  return (
    <section className={`chat-layout ${patientOnly ? 'patient-only-chat' : ''}`} aria-label="Patient chat with Abby">
      <div className="chat-surface">
        <div className="chat-date-pill">
          <Sparkles size={14} />
          <span>{formatDate(messages[0]?.timestamp)}</span>
        </div>
        <div className="chat-thread">
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

      {!patientOnly && (
        <aside className="chat-context-panel" aria-label="Visit context">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Abby context</p>
              <h2>{context.specialist.specialty}</h2>
            </div>
            <Stethoscope size={20} />
          </div>
          <p className="body-copy">
            Abby is answering on behalf of {context.specialist.name}. The reply uses the synthetic chart, visit note, AVS, and current patient message.
          </p>
          <div className="chat-context-list">
            {abbyCase.signals.slice(0, 4).map((signal) => (
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
          <div className="safety-note">
            <AlertTriangle size={17} />
            <span>Urgent symptoms should be escalated to emergency care or the specialist's office.</span>
          </div>
          <div className="run-summary chat-run-summary">
            <span className={`pill ${run ? 'now' : 'next'}`}>{run ? run.stage : 'no run'}</span>
            <button type="button" onClick={onLaunch} disabled={isRunBusy}>
              <ClipboardList size={16} /> {run ? 'Refresh brief' : 'Prepare brief'}
            </button>
          </div>
        </aside>
      )}
    </section>
  )
}

function readStoredMessages(storageKey: string, abbyCase: AbbyCase, provider: Parameters<typeof initialAbbyMessage>[1]): AbbyChatMessage[] {
  const stored = window.localStorage.getItem(storageKey)
  if (!stored) return [initialAbbyMessage(abbyCase, provider)]
  try {
    const parsed = JSON.parse(stored) as AbbyChatMessage[]
    return parsed.length ? parsed : [initialAbbyMessage(abbyCase, provider)]
  } catch {
    window.localStorage.removeItem(storageKey)
    return [initialAbbyMessage(abbyCase, provider)]
  }
}

function createMessageId(prefix: string): string {
  if ('randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(timestamp?: string): string {
  if (!timestamp) return 'Today'
  return new Date(timestamp).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}
