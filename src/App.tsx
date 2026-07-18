import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BadgeCheck,
  Bot,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  Database,
  FileJson,
  LayoutDashboard,
  MessageSquareText,
  Phone,
  Plus,
  ShieldCheck,
  Stethoscope,
  TestTube2,
  UserRound,
  Workflow,
} from 'lucide-react'
import './App.css'
import { buildCase, loadRecords } from './abbyEngine'
import {
  approveCloudRun,
  executeCloudRun,
  launchRun as launchCloudRun,
  loadDirectory,
  loadRuns,
  saveDirectoryPerson,
  sendDirectoryOtp,
  verifyDirectoryOtp,
} from './apiClient'
import type { AbbyCase, AbbyRun, DirectoryPerson, DirectoryResponse, DirectoryRole, EncounterRecord } from './types'

type View = 'plan' | 'admin' | 'patient' | 'provider' | 'fhir' | 'evals' | 'tools'

const views: Array<{ id: View; label: string; icon: typeof Workflow }> = [
  { id: 'plan', label: 'Plan', icon: Workflow },
  { id: 'admin', label: 'Admin', icon: LayoutDashboard },
  { id: 'patient', label: 'Patient', icon: MessageSquareText },
  { id: 'provider', label: 'Brief', icon: Stethoscope },
  { id: 'fhir', label: 'FHIR', icon: FileJson },
  { id: 'evals', label: 'Evals', icon: TestTube2 },
  { id: 'tools', label: 'Tools', icon: Bot },
]

const workstreams = [
  { name: 'FHIR patient-state spine', state: 'Now', detail: 'QuestionnaireResponse, Observation, Communication, Task, Provenance' },
  { name: 'Synthetic patient actors', state: 'Now', detail: 'Transcript-derived personas for repeatable role-play and demos' },
  { name: 'Provider Action Brief', state: 'Now', detail: 'What changed, what needs a decision, what can enter the note' },
  { name: 'Tool-connected agent layer', state: 'Next', detail: 'Twilio, EHR/FHIR, scheduler, Abridge context, eval harness' },
  { name: 'Voice and identity', state: 'Next', detail: 'Dedicated Abby Verify service, ElevenLabs Lauren B voice, secret-safe env vars' },
  { name: 'Payer/prior auth module', state: 'Roadmap', detail: 'Gather missing info now; automate payer portals later' },
]

const tools = [
  { name: 'FHIR write-back', icon: Database, status: 'Mocked', detail: 'Creates a structured Bundle ready for review before EHR/Abridge ingestion.' },
  { name: 'Twilio Verify + SMS', icon: Phone, status: 'Planned', detail: 'Use a dedicated Abby Verify service to avoid disrupting BEAMIT or Health Ally.' },
  { name: 'Follow-up scheduler', icon: CalendarCheck, status: 'Mocked', detail: 'Prepares appointment actions after clinician approval.' },
  { name: 'Safety gate', icon: ShieldCheck, status: 'Active', detail: 'High-risk symptoms route to review rather than autonomous action.' },
  { name: 'Eval harness', icon: BadgeCheck, status: 'Active', detail: 'Scores FHIR completeness, escalation, provenance, and unsupported facts.' },
]

function App() {
  const [records, setRecords] = useState<EncounterRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState<View>('admin')
  const [loadingError, setLoadingError] = useState('')
  const [runsByCase, setRunsByCase] = useState<Record<string, AbbyRun>>({})
  const [persistence, setPersistence] = useState('loading')
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null)
  const [runError, setRunError] = useState('')
  const [isRunBusy, setIsRunBusy] = useState(false)

  useEffect(() => {
    async function initialize() {
      try {
        const [loadedRecords, loadedRuns, loadedDirectory] = await Promise.all([loadRecords(), loadRuns(), loadDirectory()])
        setRecords(loadedRecords)
        setSelectedId(loadedRecords[1]?.id ?? loadedRecords[0]?.id ?? '')
        setRunsByCase(loadedRuns.runsByCase)
        setPersistence(loadedRuns.persistence)
        setDirectory(loadedDirectory)
      } catch (error) {
        setLoadingError(error instanceof Error ? error.message : String(error))
      }
    }
    initialize()
  }, [])

  const selectedRecord = useMemo(() => records.find((record) => record.id === selectedId) ?? records[0], [records, selectedId])
  const abbyCase = useMemo(() => (selectedRecord ? buildCase(selectedRecord) : null), [selectedRecord])
  const activeRun = abbyCase ? runsByCase[abbyCase.record.id] : undefined

  const applyRunResponse = (response: Awaited<ReturnType<typeof loadRuns>>) => {
    setRunsByCase(response.runsByCase)
    setPersistence(response.persistence)
    setRunError('')
  }

  const launchRun = async (nextCase: AbbyCase, nextView: View = 'patient') => {
    setIsRunBusy(true)
    try {
      applyRunResponse(await launchCloudRun(nextCase))
      setView(nextView)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRunBusy(false)
    }
  }

  const approveActiveRun = async () => {
    if (!abbyCase || !activeRun) return
    setIsRunBusy(true)
    try {
      applyRunResponse(await approveCloudRun(abbyCase, activeRun))
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRunBusy(false)
    }
  }

  const executeActiveRun = async () => {
    if (!abbyCase || !activeRun || activeRun.stage !== 'approved') return
    setIsRunBusy(true)
    try {
      applyRunResponse(await executeCloudRun(abbyCase, activeRun))
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRunBusy(false)
    }
  }

  if (loadingError) {
    return <main className="loading">Could not load Abby data: {loadingError}</main>
  }

  if (!abbyCase) {
    return <main className="loading">Loading Abby workspace...</main>
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-label="Abby logo">
            <span className="brand-letter brand-a">A</span>
            <span className="brand-letter">B</span>
            <span className="brand-letter">B</span>
            <span className="brand-letter brand-y">Y</span>
          </div>
          <div>
            <strong>Abby</strong>
            <span>care follow-up</span>
          </div>
        </div>

        {view !== 'admin' && (
          <>
            <label className="selector-label" htmlFor="case-select">Synthetic case</label>
            <select id="case-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {records.map((record) => (
                <option key={record.id} value={record.id}>{record.metadata.visit_title}</option>
              ))}
            </select>
          </>
        )}

        <nav className="nav" aria-label="Abby surfaces">
          {views.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)} title={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <Activity size={18} />
          <span>{persistence === 'browser-fallback' ? 'Local fallback, synthetic data only' : 'Cloud demo, synthetic data only'}</span>
        </div>
      </aside>

      <section className="workspace">
        <Header abbyCase={abbyCase} run={activeRun} persistence={persistence} view={view} directory={directory} />
        {runError && <div className="runtime-error">{runError}</div>}
        {view === 'plan' && <PlanView />}
        {view === 'admin' && directory && <AdminView directory={directory} onDirectoryChange={setDirectory} />}
        {view === 'patient' && <PatientView abbyCase={abbyCase} run={activeRun} onLaunch={() => launchRun(abbyCase)} isRunBusy={isRunBusy} />}
        {view === 'provider' && <ProviderView abbyCase={abbyCase} run={activeRun} onApprove={approveActiveRun} onExecute={executeActiveRun} isRunBusy={isRunBusy} />}
        {view === 'fhir' && <FhirView abbyCase={abbyCase} run={activeRun} />}
        {view === 'evals' && <EvalView abbyCase={abbyCase} run={activeRun} />}
        {view === 'tools' && <ToolView run={activeRun} />}
      </section>
    </main>
  )
}

function Header({
  abbyCase,
  run,
  persistence,
  view,
  directory,
}: {
  abbyCase: AbbyCase
  run?: AbbyRun
  persistence: string
  view: View
  directory: DirectoryResponse | null
}) {
  const { record } = abbyCase
  if (view === 'admin' && directory) {
    return (
      <header className="topbar">
        <div className="patient-chip" aria-label="Superadmin workspace">
          <div className="avatar"><ShieldCheck size={19} /></div>
          <div>
            <strong>Superadmin</strong>
            <span>People directory, multi-role access, patients, providers, and phone login</span>
          </div>
        </div>
        <div className="status-strip">
          <span>{directory.counts.people} people</span>
          <span>{directory.counts.providers} providers</span>
          <span>{directory.counts.patients} patients</span>
          <span>{directory.auth}</span>
          <span>{directory.persistence}</span>
        </div>
      </header>
    )
  }

  return (
    <header className="topbar">
      <div className="patient-chip" aria-label="Selected patient">
        <div className="avatar">{abbyCase.initials}</div>
        <div>
          <strong>{abbyCase.patientName}</strong>
          <span>{abbyCase.age} yrs, {record.patient_context.patient.gender ?? 'unknown'} · {record.metadata.visit_title}</span>
        </div>
      </div>
      <div className="status-strip">
        <span>{Object.values(record.metadata.related_resource_counts).reduce((sum, count) => sum + count, 0)} FHIR inputs</span>
        <span>{abbyCase.signals.length} signals</span>
        <span>{run ? `run ${run.stage}` : 'no active run'}</span>
        <span>{persistence}</span>
        <span>{abbyCase.evalScores.filter((item) => item.score >= item.target).length}/{abbyCase.evalScores.length} evals passing</span>
      </div>
    </header>
  )
}

function PlanView() {
  return (
    <section className="content-grid plan-grid">
      <div className="panel thesis-panel">
        <p className="eyebrow">Implementation thesis</p>
        <h1>Build Abby as a patient-state operating layer, not a form bot.</h1>
        <p>
          Abby reads clinical context, interviews the patient, writes structured FHIR-backed updates, coordinates next steps through tools, and evaluates every run against transcript-derived cases.
        </p>
      </div>

      <div className="panel">
        <p className="eyebrow">Build sequence</p>
        <div className="timeline">
          {workstreams.map((item, index) => (
            <div className="timeline-row" key={item.name}>
              <div className="step-number">{index + 1}</div>
              <div>
                <strong>{item.name}</strong>
                <p>{item.detail}</p>
              </div>
              <span className={`pill ${item.state.toLowerCase()}`}>{item.state}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function PatientView({ abbyCase, run, onLaunch, isRunBusy }: { abbyCase: AbbyCase; run?: AbbyRun; onLaunch: () => void; isRunBusy: boolean }) {
  const transcript = run?.transcript ?? abbyCase.intake

  return (
    <section className="content-grid two-col">
      <div className="phone-surface" aria-label="Patient conversation preview">
        <div className="phone-top">
          <div className="avatar small">{abbyCase.initials}</div>
          <div>
            <strong>Abby intake</strong>
            <span>Verified patient channel</span>
          </div>
        </div>
        <div className="message-list">
          {transcript.map((item, index) => (
            <div key={item.prompt} className="message-pair">
              <div className="bubble abby">{item.prompt}</div>
              <div className="bubble patient">{item.answer}</div>
              <span className="map-label">{item.mapsTo}</span>
              {index < transcript.length - 1 && <ChevronRight className="flow-arrow" size={14} />}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <p className="eyebrow">Synthetic patient actor</p>
        <h2>{run ? 'Run transcript captured' : 'Transcript-grounded role play'}</h2>
        <p className="body-copy">
          The patient actor should answer from the ambient transcript, note, AVS, and FHIR chart context, then refuse unsupported facts. This keeps demos repeatable and turns the Abridge dataset into test infrastructure.
        </p>
        <div className="run-summary">
          <span className={`pill ${run ? 'now' : 'next'}`}>{run ? run.stage : 'not launched'}</span>
          <span>{run ? `${run.patientChannel.toUpperCase()} verified` : 'Ready to launch synthetic outreach'}</span>
          <button type="button" onClick={onLaunch} disabled={isRunBusy}><MessageSquareText size={16} /> {run ? 'Open run' : 'Launch run'}</button>
        </div>
        <div className="signal-list">
          {abbyCase.signals.map((signal) => (
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
      </div>
    </section>
  )
}

function AdminView({
  directory,
  onDirectoryChange,
}: {
  directory: DirectoryResponse
  onDirectoryChange: (directory: DirectoryResponse) => void
}) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    roles: ['patient'] as DirectoryRole[],
    specialty: '',
    primaryProviderId: '',
  })
  const [otpPhone, setOtpPhone] = useState(directory.people.find((person) => person.roles.includes('superadmin'))?.phone ?? directory.people[0]?.phone ?? '')
  const [otpCode, setOtpCode] = useState('')
  const [adminMessage, setAdminMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const providers = directory.people.filter((person) => person.roles.includes('provider'))
  const patients = directory.people.filter((person) => person.roles.includes('patient'))

  const toggleRole = (role: DirectoryRole) => {
    setForm((current) => {
      const roles = current.roles.includes(role)
        ? current.roles.filter((item) => item !== role)
        : [...current.roles, role]
      return { ...current, roles }
    })
  }

  const savePerson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSaving(true)
    try {
      const nextDirectory = await saveDirectoryPerson({
        name: form.name,
        phone: form.phone,
        roles: form.roles,
        specialty: form.specialty || undefined,
        primaryProviderId: form.primaryProviderId || undefined,
      })
      onDirectoryChange(nextDirectory)
      setAdminMessage(`${form.name} saved`)
      setForm({ name: '', phone: '', roles: ['patient'], specialty: '', primaryProviderId: '' })
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  const sendOtp = async () => {
    setIsSaving(true)
    try {
      const nextDirectory = await sendDirectoryOtp(otpPhone)
      onDirectoryChange(nextDirectory)
      setAdminMessage(nextDirectory.otp?.demoCode ? `Mock OTP: ${nextDirectory.otp.demoCode}` : 'OTP sent by Twilio')
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  const verifyOtp = async () => {
    setIsSaving(true)
    try {
      const nextDirectory = await verifyDirectoryOtp(otpPhone, otpCode)
      onDirectoryChange(nextDirectory)
      setAdminMessage(`Verified ${otpPhone}`)
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="content-grid admin-simple-grid">
      <div className="panel admin-hero">
        <p className="eyebrow">Superadmin</p>
        <h1>People, patients, providers.</h1>
        <div className="metric-strip">
          <Metric label="People" value={directory.counts.people} />
          <Metric label="Providers" value={directory.counts.providers} />
          <Metric label="Patients" value={directory.counts.patients} />
          <Metric label="Superadmins" value={directory.counts.superadmins} />
        </div>
      </div>

      <form className="panel person-form" onSubmit={savePerson}>
        <p className="eyebrow">Add person</p>
        <h2>One profile can hold multiple roles</h2>
        <label>
          <span>Name</span>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Jane Doe" required />
        </label>
        <label>
          <span>Phone</span>
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+1 650 555 0100" required />
        </label>
        <div className="role-toggle" aria-label="Roles">
          {(['superadmin', 'provider', 'patient'] as DirectoryRole[]).map((role) => (
            <button key={role} type="button" className={form.roles.includes(role) ? 'selected' : ''} onClick={() => toggleRole(role)}>
              {role}
            </button>
          ))}
        </div>
        {form.roles.includes('provider') && (
          <label>
            <span>Specialty</span>
            <input value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} placeholder="Vascular Surgery" />
          </label>
        )}
        {form.roles.includes('patient') && (
          <label>
            <span>Primary provider</span>
            <select value={form.primaryProviderId} onChange={(event) => setForm({ ...form, primaryProviderId: event.target.value })}>
              <option value="">Unassigned</option>
              {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
            </select>
          </label>
        )}
        <button type="submit" disabled={isSaving || !form.roles.length}><Plus size={16} /> Add person</button>
      </form>

      <div className="panel otp-panel">
        <p className="eyebrow">Phone auth</p>
        <h2>{directory.auth === 'twilio-verify' ? 'Twilio OTP live' : 'Mock OTP until Twilio is connected'}</h2>
        <label>
          <span>Phone</span>
          <input value={otpPhone} onChange={(event) => setOtpPhone(event.target.value)} />
        </label>
        <div className="otp-row">
          <button type="button" onClick={sendOtp} disabled={isSaving || !otpPhone}><Phone size={16} /> Send OTP</button>
          <input value={otpCode} onChange={(event) => setOtpCode(event.target.value)} placeholder="Code" inputMode="numeric" />
          <button type="button" onClick={verifyOtp} disabled={isSaving || !otpCode}>Verify</button>
        </div>
        <p className="body-copy">Auth mode: {directory.auth}. Storage: {directory.persistence}.</p>
        {adminMessage && <div className="admin-message">{adminMessage}</div>}
      </div>

      <PeopleList title="Providers" people={providers} />
      <PeopleList title="Patients" people={patients} providers={providers} />
      <PeopleList title="All people" people={directory.people} />
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function PeopleList({ title, people, providers = [] }: { title: string; people: DirectoryPerson[]; providers?: DirectoryPerson[] }) {
  return (
    <div className="panel people-panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">{title}</p>
          <h2>{people.length} total</h2>
        </div>
        <UserRound size={20} />
      </div>
      <div className="people-list">
        {people.map((person) => {
          const primaryProvider = providers.find((provider) => provider.id === person.primaryProviderId)
          return (
            <div className="person-row" key={person.id}>
              <div>
                <strong>{person.name}</strong>
                <span>{person.phone}</span>
              </div>
              <div className="person-tags">
                {person.roles.map((role) => <span key={role}>{role}</span>)}
                {person.specialty && <span>{person.specialty}</span>}
                {primaryProvider && <span>{primaryProvider.name}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProviderView({
  abbyCase,
  run,
  onApprove,
  onExecute,
  isRunBusy,
}: {
  abbyCase: AbbyCase
  run?: AbbyRun
  onApprove: () => void
  onExecute: () => void
  isRunBusy: boolean
}) {
  return (
    <section className="content-grid two-col">
      <div className="panel action-brief">
        <p className="eyebrow">Provider Action Brief</p>
        <h2>{abbyCase.record.metadata.visit_title}</h2>
        <div className="brief-section">
          <strong>What changed</strong>
          <p>{abbyCase.intake[0].answer}</p>
        </div>
        <div className="brief-section">
          <strong>Decisions and actions</strong>
          {abbyCase.actionItems.map((item) => <p key={item}>· {item}</p>)}
        </div>
        <div className="brief-section">
          <strong>Open questions</strong>
          {abbyCase.openQuestions.map((item) => <p key={item}>· {item}</p>)}
        </div>
      </div>

      <div className="panel note-ready">
        <p className="eyebrow">Note-ready insert</p>
        <h2>Patient-reported interval update</h2>
        <p>
          Abby completed identity-verified outreach and generated structured patient-reported context for clinician review. Highest-priority signal: {abbyCase.signals[0]?.label.toLowerCase()} - {abbyCase.signals[0]?.value}.
        </p>
        <div className="run-summary">
          <span className={`pill ${run?.stage === 'executed' ? 'now' : 'next'}`}>{run?.stage ?? 'launch needed'}</span>
          <span>{run?.safetyHold ? 'Safety hold requires clinician review' : 'No safety hold'}</span>
          <span>{run?.writeBackComplete ? 'FHIR write-back complete' : 'FHIR write-back locked'}</span>
        </div>
        <div className="approval-row">
          <button type="button" onClick={onApprove} disabled={isRunBusy || !run || run.stage === 'approved' || run.stage === 'executed'}>
            <ClipboardList size={16} /> Approve brief
          </button>
          <button type="button" className="secondary" onClick={onExecute} disabled={isRunBusy || !run || run.stage !== 'approved'}>
            <CalendarCheck size={16} /> Execute approved tools
          </button>
        </div>
      </div>
    </section>
  )
}

function FhirView({ abbyCase, run }: { abbyCase: AbbyCase; run?: AbbyRun }) {
  const pretty = JSON.stringify(abbyCase.fhirBundle, null, 2)
  const exportBundle = () => {
    const blob = new Blob([pretty], { type: 'application/fhir+json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${abbyCase.fhirBundle.id ?? 'abby-fhir-bundle'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="content-grid single-col">
      <div className="panel fhir-panel">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">Structured patient-generated data</p>
            <h2>FHIR Bundle preview</h2>
          </div>
          <div className="bundle-actions">
            <span className="pill now">{Array.isArray(abbyCase.fhirBundle.entry) ? abbyCase.fhirBundle.entry.length : 0} resources</span>
            <span className="pill next">{run?.writeBackComplete ? 'written' : 'review required'}</span>
            <button type="button" onClick={exportBundle}><Database size={16} /> Export JSON</button>
          </div>
        </div>
        <pre>{pretty}</pre>
      </div>
    </section>
  )
}

function EvalView({ abbyCase, run }: { abbyCase: AbbyCase; run?: AbbyRun }) {
  return (
    <section className="content-grid two-col">
      <div className="panel">
        <p className="eyebrow">Eval harness</p>
        <h2>Run-level quality gates</h2>
        <div className="score-list">
          {abbyCase.evalScores.map((item) => (
            <div className="score-row" key={item.metric}>
              <div>
                <strong>{item.metric}</strong>
                <span>target {item.target}</span>
              </div>
              <meter min="0" max="100" value={item.score} />
              <b>{item.score}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <p className="eyebrow">Expected outputs</p>
        <h2>Case checklist</h2>
        <ul className="check-list">
          <li>Correct chief concern and visit type</li>
          <li>No hallucinated chart facts</li>
          <li>Escalation when red flags appear</li>
          <li>FHIR resources have provenance</li>
          <li>Provider brief is action-oriented</li>
          <li>Write-back requires clinician approval</li>
        </ul>
        <div className="tool-ledger mini-ledger">
          {(run?.toolEvents ?? []).map((event) => (
            <div className="tool-event" key={event.id}>
              <span className={`event-dot ${event.status}`} />
              <div>
                <strong>{event.label}</strong>
                <p>{event.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ToolView({ run }: { run?: AbbyRun }) {
  return (
    <section className="content-grid single-col">
      <div className="tool-grid">
        {tools.map((tool) => {
          const Icon = tool.icon
          return (
            <div className="panel tool-panel" key={tool.name}>
              <div className="tool-icon"><Icon size={20} /></div>
              <span className="pill next">{tool.status}</span>
              <h2>{tool.name}</h2>
              <p>{tool.detail}</p>
            </div>
          )
        })}
      </div>
      <div className="panel">
        <p className="eyebrow">Tool execution ledger</p>
        <h2>{run ? `Run ${run.id}` : 'No run launched'}</h2>
        <div className="tool-ledger">
          {(run?.toolEvents ?? []).map((event) => (
            <div className="tool-event" key={event.id}>
              <span className={`event-dot ${event.status}`} />
              <div>
                <strong>{event.label}</strong>
                <p>{event.detail}</p>
              </div>
              <small>{event.timestamp}</small>
            </div>
          ))}
          {!run && <p className="body-copy">Launch an intake from the Admin or Patient surface to populate the mocked MCP/tool trail.</p>}
        </div>
      </div>
    </section>
  )
}

export default App
