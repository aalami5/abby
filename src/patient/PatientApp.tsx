import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Headphones, LockKeyhole, Mic, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { loadPatientBootstrap, loadPatientPlan, sendPatientMessage, sendPatientOtp, verifyPatientOtp } from './patientApi'
import type { PatientBootstrap, PatientMessage, PatientPlan } from './patientTypes'
import './patient.css'

const PatientVoiceRoom = lazy(() => import('./PatientVoiceRoom').then((module) => ({ default: module.PatientVoiceRoom })))

export function PatientApp({ careId }: { careId: string }) {
  const [bootstrap, setBootstrap] = useState<PatientBootstrap>()
  const [token, setToken] = useState(() => window.sessionStorage.getItem(`abby.patient.${careId}`) ?? '')
  const [plan, setPlan] = useState<PatientPlan>()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadPatientBootstrap(careId)
      .then((result) => {
        setBootstrap(result)
        if (result.verificationMode === 'demo' && careId === 'demo-cardiovascular') setPhone('+1 555 012 0011')
      })
      .catch((caught: unknown) => setError(messageOf(caught)))
  }, [careId])

  useEffect(() => {
    if (!token) return
    loadPatientPlan(token)
      .then(setPlan)
      .catch(() => {
        window.sessionStorage.removeItem(`abby.patient.${careId}`)
        setToken('')
      })
  }, [careId, token])

  async function sendCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await sendPatientOtp(careId, phone)
      setOtpSent(true)
      setDemoCode(result.demoCode ?? '')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await verifyPatientOtp(careId, phone, code)
      window.sessionStorage.setItem(`abby.patient.${careId}`, result.token)
      setToken(result.token)
      setPlan(await loadPatientPlan(result.token))
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!bootstrap && !error) return <PatientLoading />
  if (!bootstrap) return <PatientLinkError message={error} />
  if (!token || !plan) {
    return (
      <PatientVerification
        bootstrap={bootstrap}
        phone={phone}
        setPhone={setPhone}
        code={code}
        setCode={setCode}
        otpSent={otpSent}
        demoCode={demoCode}
        error={error}
        busy={busy}
        onSend={sendCode}
        onVerify={verifyCode}
        onBack={() => { setOtpSent(false); setCode(''); setError('') }}
      />
    )
  }
  return <PatientConversation token={token} plan={plan} />
}

function PatientConversation({ token, plan }: { token: string; plan: PatientPlan }) {
  const [messages, setMessages] = useState<PatientMessage[]>(
    plan.history?.length
      ? plan.history
      : [{
          id: 'abby-opening',
          sender: 'abby',
          content: plan.openingMessage,
          timestamp: new Date().toISOString(),
        }],
  )
  const [suggestions, setSuggestions] = useState(plan.suggestedReplies)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [speakingId, setSpeakingId] = useState('')
  const [voiceOpen, setVoiceOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function send(content: string) {
    const clean = content.trim()
    if (!clean || busy) return
    const patientMessage: PatientMessage = { id: `patient-${Date.now()}`, sender: 'patient', content: clean, timestamp: new Date().toISOString() }
    const nextMessages = [...messages, patientMessage]
    setMessages(nextMessages)
    setDraft('')
    setSuggestions([])
    setError('')
    setBusy(true)
    try {
      const result = await sendPatientMessage(token, nextMessages)
      setMessages((current) => [...current, result.message])
      setSuggestions(result.suggestedReplies)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  function replay(message: PatientMessage) {
    window.speechSynthesis.cancel()
    if (speakingId === message.id) {
      setSpeakingId('')
      return
    }
    const utterance = new SpeechSynthesisUtterance(message.content)
    utterance.rate = 0.92
    utterance.onend = () => setSpeakingId('')
    utterance.onerror = () => setSpeakingId('')
    setSpeakingId(message.id)
    window.speechSynthesis.speak(utterance)
  }

  return (
    <div className="patient-app-shell">
      <header className="patient-app-header">
        <a className="patient-brand" href="#top" aria-label="Abby home">
          <img src="/brand/abby-mark-circle.png" alt="" />
          <div><strong>abby</strong><span>{plan.workflow === 'post_visit_followthrough' ? 'Your follow-through' : 'Before your visit'}</span></div>
        </a>
        <div className="patient-secure-state"><ShieldCheck size={16} /><span>Private</span></div>
      </header>

      <div className="patient-plan-strip">
        <div><Sparkles size={16} /><span>{plan.workflow === 'post_visit_followthrough' ? 'Plan approved by' : 'Preparing for'} <strong>{plan.providerName}</strong></span></div>
        <small>{plan.visitTitle}</small>
      </div>

      <main className="patient-thread" id="top">
        <div className="patient-day-label">Today</div>
        {messages.map((message) => (
          <article className={`patient-message ${message.sender}`} key={message.id}>
            {message.sender === 'abby' && <img className="patient-message-avatar" src="/brand/abby-mark-circle.png" alt="Abby" />}
            <div className="patient-message-content">
              <div className="patient-message-bubble"><p>{message.content}</p></div>
              {message.sender === 'abby' && (
                <button className={`replay-message ${speakingId === message.id ? 'playing' : ''}`} type="button" aria-pressed={speakingId === message.id} onClick={() => replay(message)}>
                  {speakingId === message.id ? <><span className="audio-bars"><i /><i /><i /></span> Playing</> : <><RotateCcw size={18} /> Listen again</>}
                </button>
              )}
            </div>
          </article>
        ))}
        {busy && (
          <article className="patient-message abby">
            <img className="patient-message-avatar" src="/brand/abby-mark-circle.png" alt="" />
            <div className="patient-message-bubble patient-thinking"><i /><i /><i /></div>
          </article>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="patient-input-dock">
        {error && <div className="patient-chat-error">{error}</div>}
        {suggestions.length > 0 && (
          <div className="patient-suggestions" aria-label="Suggested responses">
            {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}
          </div>
        )}
        <form className="patient-composer" onSubmit={(event) => { event.preventDefault(); void send(draft) }}>
          <button className="patient-voice-button" type="button" onClick={() => setVoiceOpen(true)} aria-label="Start realtime voice conversation"><Mic size={23} /></button>
          <label><span className="sr-only">Message Abby</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask Abby anything about your care…" rows={1} /></label>
          <button className="patient-send-button" type="submit" disabled={!draft.trim() || busy} aria-label="Send message"><ArrowUp size={21} /></button>
        </form>
        <button className="voice-invitation" type="button" onClick={() => setVoiceOpen(true)}><Headphones size={15} /> Prefer to talk? Start a live voice conversation</button>
      </footer>
      {voiceOpen && (
        <Suspense fallback={<div className="voice-loading-screen"><div className="voice-loading-orb"><span /><span /><span /></div><h1>Opening voice…</h1></div>}>
          <PatientVoiceRoom token={token} providerName={plan.providerName} onClose={() => setVoiceOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

type VerificationProps = {
  bootstrap: PatientBootstrap
  phone: string
  setPhone: (value: string) => void
  code: string
  setCode: (value: string) => void
  otpSent: boolean
  demoCode: string
  error: string
  busy: boolean
  onSend: (event: FormEvent) => void
  onVerify: (event: FormEvent) => void
  onBack: () => void
}

function PatientVerification(props: VerificationProps) {
  return (
    <main className="patient-entry-page">
      <section className="patient-entry-card">
        <img className="patient-entry-logo" src="/brand/abby-mark-circle.png" alt="Abby" />
        <span className="patient-entry-kicker"><LockKeyhole size={15} /> Private care link</span>
        <h1>{props.otpSent ? 'Enter your code' : 'Welcome to Abby'}</h1>
        <p>{props.otpSent ? `We sent a six-digit code to the phone ending ${props.bootstrap.phoneHint}.` : `${props.bootstrap.providerName} has shared a private care conversation with you.`}</p>
        <div className="patient-visit-card"><span>Care visit</span><strong>{props.bootstrap.visitTitle}</strong><small>{props.bootstrap.providerName}</small></div>
        {props.error && <div className="patient-entry-error" role="alert">{props.error}</div>}
        {!props.otpSent ? (
          <form onSubmit={props.onSend}>
            <label><span>Mobile phone</span><input type="tel" autoComplete="tel" value={props.phone} onChange={(event) => props.setPhone(event.target.value)} placeholder="(555) 555-0123" required /></label>
            <button type="submit" disabled={props.busy}>{props.busy ? 'Sending securely…' : 'Text me a code'}</button>
          </form>
        ) : (
          <form onSubmit={props.onVerify}>
            <label><span>Six-digit code</span><input className="patient-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={props.code} onChange={(event) => props.setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" required /></label>
            {props.demoCode && <button className="demo-code-button" type="button" onClick={() => props.setCode(props.demoCode)}><Check size={15} /> Use demo code {props.demoCode}</button>}
            <button type="submit" disabled={props.busy || props.code.length !== 6}>{props.busy ? 'Verifying…' : 'Open my care conversation'}</button>
            <button className="patient-text-button" type="button" onClick={props.onBack}>Use a different phone</button>
          </form>
        )}
        <small className="patient-privacy-copy"><ShieldCheck size={14} /> Your care link does not contain medical details.</small>
      </section>
    </main>
  )
}

function PatientLoading() {
  return <main className="patient-entry-page"><div className="patient-loading"><img src="/brand/abby-mark-circle.png" alt="Abby" /><span /><p>Opening your private care link…</p></div></main>
}

function PatientLinkError({ message }: { message: string }) {
  return <main className="patient-entry-page"><section className="patient-entry-card"><img className="patient-entry-logo" src="/brand/abby-mark-circle.png" alt="Abby" /><h1>We couldn’t open this link</h1><p>{message}</p><small>Please contact your care team for a new invitation.</small></section></main>
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : String(value)
}
