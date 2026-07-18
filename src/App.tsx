import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CalendarCheck,
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Stethoscope,
  UserRound,
  X,
} from 'lucide-react'
import './App.css'
import { buildCase, loadRecords } from './abbyEngine'
import { PatientChat } from './PatientChat'
import {
  approveCloudRun,
  executeCloudRun,
  launchRun as launchCloudRun,
  loadDirectory,
  loadRuns,
  saveDirectoryPerson,
} from './apiClient'
import type { AbbyCase, AbbyRun, DirectoryPerson, DirectoryResponse, DirectoryRole, EncounterRecord } from './types'

type View = 'admin' | 'patient' | 'provider'

const views: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'admin', label: 'Superadmin', icon: LayoutDashboard },
  { id: 'patient', label: 'Chat', icon: MessageSquareText },
  { id: 'provider', label: 'Brief', icon: Stethoscope },
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
    <main className={`app-shell ${view === 'admin' ? 'admin-shell' : ''}`}>
      <aside className="sidebar">
        <div className={`brand ${view === 'admin' ? 'brand-only' : ''}`}>
          <div className="brand-mark" aria-label="Abby logo">
            <span className="brand-letter brand-a">A</span>
            <span className="brand-letter">B</span>
            <span className="brand-letter">B</span>
            <span className="brand-letter brand-y">Y</span>
          </div>
          <div className="brand-copy">
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

        {view !== 'admin' && (
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
        )}

        {view !== 'admin' && (
          <div className="sidebar-footer">
            <Activity size={18} />
            <span>{persistence === 'browser-fallback' ? 'Local fallback, synthetic data only' : 'Cloud demo, synthetic data only'}</span>
          </div>
        )}
      </aside>

      <section className="workspace">
        <Header abbyCase={abbyCase} run={activeRun} persistence={persistence} view={view} directory={directory} />
        {runError && <div className="runtime-error">{runError}</div>}
        {view === 'admin' && directory && (
          <AdminView
            directory={directory}
            onDirectoryChange={setDirectory}
            onOpenPatient={(recordId) => {
              setSelectedId(recordId)
              setView('patient')
            }}
          />
        )}
        {view === 'patient' && <PatientChat abbyCase={abbyCase} directory={directory} run={activeRun} onLaunch={() => launchRun(abbyCase)} isRunBusy={isRunBusy} />}
        {view === 'provider' && <ProviderView abbyCase={abbyCase} run={activeRun} onApprove={approveActiveRun} onExecute={executeActiveRun} isRunBusy={isRunBusy} />}
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
            <span>Oliver Aalami and the Abridge synthetic patient roster</span>
          </div>
        </div>
        <div className="status-strip">
          <span>{directory.counts.superadmins} superadmin</span>
          <span>{directory.counts.patients} patients</span>
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

function AdminView({
  directory,
  onDirectoryChange,
  onOpenPatient,
}: {
  directory: DirectoryResponse
  onDirectoryChange: (directory: DirectoryResponse) => void
  onOpenPatient: (recordId: string) => void
}) {
  const [adminTab, setAdminTab] = useState<'superadmin' | 'patients'>('patients')
  const [form, setForm] = useState({
    id: '',
    name: '',
    phone: '',
    roles: ['patient'] as DirectoryRole[],
    createdAt: '',
  })
  const [adminMessage, setAdminMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const patients = directory.people.filter((person) => person.roles.includes('patient'))
  const superadmins = directory.people.filter((person) => person.roles.includes('superadmin'))
  const isEditing = Boolean(form.id)

  const savePerson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSaving(true)
    try {
      const nextDirectory = await saveDirectoryPerson({
        id: form.id || undefined,
        name: form.name,
        phone: form.phone,
        roles: form.roles,
        createdAt: form.createdAt || undefined,
      })
      onDirectoryChange(nextDirectory)
      setAdminMessage(`${form.name} ${isEditing ? 'updated' : 'added'}`)
      resetForm()
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  const resetForm = () => {
    setForm({ id: '', name: '', phone: '', roles: ['patient'], createdAt: '' })
  }

  const editPerson = (person: DirectoryPerson) => {
    setForm({
      id: person.id,
      name: person.name,
      phone: person.phone,
      roles: person.roles,
      createdAt: person.createdAt,
    })
    setAdminTab('patients')
    setAdminMessage(`Editing ${person.name}`)
  }

  return (
    <section className="content-grid admin-simple-grid">
      <div className="admin-tabs" role="tablist" aria-label="Superadmin tabs">
        <button type="button" className={adminTab === 'superadmin' ? 'active' : ''} onClick={() => setAdminTab('superadmin')}>
          <ShieldCheck size={16} /> Superadmin
        </button>
        <button type="button" className={adminTab === 'patients' ? 'active' : ''} onClick={() => setAdminTab('patients')}>
          <UserRound size={16} /> Patients
        </button>
      </div>

      {adminTab === 'superadmin' && (
        <div className="panel superadmin-card">
          <p className="eyebrow">Superadmin</p>
          <h1>Oliver Aalami</h1>
          <div className="superadmin-line">
            <span>Cell</span>
            <strong>{superadmins[0]?.phone ?? '+16503153236'}</strong>
          </div>
          <div className="superadmin-line">
            <span>Access</span>
            <strong>superadmin</strong>
          </div>
          <div className="superadmin-line">
            <span>Patients</span>
            <strong>{patients.length} Abridge synthetic records</strong>
          </div>
        </div>
      )}

      {adminTab === 'patients' && (
        <>
          <form className="panel person-form compact-patient-form" onSubmit={savePerson}>
            <div className="panel-title-row">
              <div>
                <p className="eyebrow">Patients</p>
                <h2>{isEditing ? 'Edit patient cell' : 'Add patient'}</h2>
              </div>
              {isEditing && (
                <button className="icon-action" type="button" onClick={resetForm} title="Cancel edit" aria-label="Cancel edit">
                  <X size={18} />
                </button>
              )}
            </div>
            <label>
              <span>Name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Jane Doe" required />
            </label>
            <label>
              <span>Cell phone</span>
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+1 650 555 0100" required />
            </label>
            <button type="submit" disabled={isSaving}>
              {isEditing ? <Save size={16} /> : <Plus size={16} />}
              {isEditing ? 'Save' : 'Add'}
            </button>
            {adminMessage && <div className="admin-message">{adminMessage}</div>}
          </form>

          <PatientRoster patients={patients} onEdit={editPerson} onOpenPatient={onOpenPatient} />
        </>
      )}
    </section>
  )
}

function PatientRoster({
  patients,
  onEdit,
  onOpenPatient,
}: {
  patients: DirectoryPerson[]
  onEdit: (person: DirectoryPerson) => void
  onOpenPatient: (recordId: string) => void
}) {
  return (
    <div className="panel patient-roster">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">Patients</p>
          <h2>{patients.length} named Abridge synthetic patients</h2>
        </div>
        <UserRound size={20} />
      </div>
      <div className="patient-table" role="table" aria-label="Patients">
        <div className="patient-table-head" role="row">
          <span>Name</span>
          <span>Cell phone</span>
          <span>Age / sex</span>
          <span>Visit</span>
          <span>Action</span>
        </div>
        {patients.map((patient) => {
          return (
            <div className="patient-table-row" role="row" key={patient.id}>
              <div className="patient-name-cell">
                <strong>{patient.name}</strong>
                <span>{patient.sourceRecordId ? 'Abridge synthetic record' : 'Added patient'}</span>
              </div>
              <span className="phone-value" data-label="Cell">{patient.phone}</span>
              <span data-label="Age / sex">{patient.birthDate ? `${ageFromBirthDate(patient.birthDate)} yrs` : 'Age unknown'}{patient.gender ? `, ${patient.gender}` : ''}</span>
              <span data-label="Visit">{patient.visitTitle ?? 'Synthetic encounter'}</span>
              <div className="patient-actions">
                {patient.sourceRecordId && (
                  <button type="button" className="quiet-button" onClick={() => onOpenPatient(patient.sourceRecordId ?? '')}>
                    Open
                  </button>
                )}
                <button type="button" className="edit-button" onClick={() => onEdit(patient)}>
                  <Pencil size={15} /> Edit
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ageFromBirthDate(birthDate: string): number {
  const birth = new Date(birthDate)
  const now = new Date('2026-07-18')
  let age = now.getFullYear() - birth.getFullYear()
  const monthDelta = now.getMonth() - birth.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1
  return age
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

export default App
