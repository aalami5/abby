import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Building2,
  CalendarCheck,
  Check,
  ChevronDown,
  ClipboardList,
  Database,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
  Settings,
  ShieldCheck,
  Stethoscope,
  UsersRound,
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
type AdminSection = 'dashboard' | 'users' | 'patients'
type WorkspaceRole = 'admin' | 'coach' | 'kaiser'

const menuItems: Array<
  | { id: 'dashboard' | 'users' | 'patients' | 'chat' | 'brief'; label: string; icon: typeof LayoutDashboard }
  | { id: 'programs' | 'analytics' | 'settings'; label: string; icon: typeof LayoutDashboard; disabled: true }
> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: UsersRound },
  { id: 'patients', label: 'Patients', icon: UserRound },
  { id: 'chat', label: 'Patient chat', icon: MessageSquareText },
  { id: 'brief', label: 'Provider brief', icon: Stethoscope },
  { id: 'programs', label: 'Programs', icon: ClipboardList, disabled: true },
  { id: 'analytics', label: 'Analytics', icon: Activity, disabled: true },
  { id: 'settings', label: 'Settings', icon: Settings, disabled: true },
]

const directoryRoleOptions: Array<{ value: DirectoryRole; label: string }> = [
  { value: 'patient', label: 'Patient' },
  { value: 'provider', label: 'Provider' },
  { value: 'superadmin', label: 'Superadmin' },
]

const workspaceRoleOptions: Array<{ value: WorkspaceRole; label: string; description: string }> = [
  { value: 'admin', label: 'Admin', description: 'All programs' },
  { value: 'coach', label: 'Coach', description: 'Assigned programs' },
  { value: 'kaiser', label: 'Kaiser', description: 'Get Set dashboard' },
]

function App() {
  const [records, setRecords] = useState<EncounterRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState<View>('admin')
  const [adminSection, setAdminSection] = useState<AdminSection>('dashboard')
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole>('admin')
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
            <img src="/abby-logo.jpg" alt="" />
          </div>
        </div>

        <nav className="nav" aria-label="Abby admin navigation">
          {menuItems.map((item) => {
            const Icon = item.icon
            const active = (
              (item.id === 'dashboard' && view === 'admin' && adminSection === 'dashboard') ||
              (item.id === 'users' && view === 'admin' && adminSection === 'users') ||
              (item.id === 'patients' && view === 'admin' && adminSection === 'patients') ||
              (item.id === 'chat' && view === 'patient') ||
              (item.id === 'brief' && view === 'provider')
            )
            const selectItem = () => {
              if ('disabled' in item) return
              if (item.id === 'dashboard' || item.id === 'users' || item.id === 'patients') {
                setAdminSection(item.id)
                setView('admin')
                return
              }
              if (item.id === 'chat') {
                setView('patient')
                return
              }
              if (item.id === 'brief') {
                setView('provider')
                return
              }
              setAdminSection('dashboard')
              setView('admin')
            }

            return (
              <button
                key={item.id}
                type="button"
                className={active ? 'active' : ''}
                onClick={selectItem}
                disabled={'disabled' in item}
                title={item.label}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <Database size={18} />
          <span>{persistence === 'browser-fallback' ? 'Local fallback' : 'Cloud demo'}</span>
        </div>
      </aside>

      <section className="workspace">
        <Header
          abbyCase={abbyCase}
          run={activeRun}
          persistence={persistence}
          view={view}
          directory={directory}
          selectedRole={selectedRole}
          onSelectedRoleChange={setSelectedRole}
        />
        {view !== 'admin' && (
          <div className="case-bar">
            <label htmlFor="case-select">Synthetic case</label>
            <select id="case-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {records.map((record) => (
                <option key={record.id} value={record.id}>{record.metadata.visit_title}</option>
              ))}
            </select>
          </div>
        )}
        {runError && <div className="runtime-error">{runError}</div>}
        {view === 'admin' && directory && (
          <AdminView
            directory={directory}
            adminSection={adminSection}
            onAdminSectionChange={setAdminSection}
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
  selectedRole,
  onSelectedRoleChange,
}: {
  abbyCase: AbbyCase
  run?: AbbyRun
  persistence: string
  view: View
  directory: DirectoryResponse | null
  selectedRole: WorkspaceRole
  onSelectedRoleChange: (role: WorkspaceRole) => void
}) {
  const { record } = abbyCase
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false)
  const selectedRoleOption = workspaceRoleOptions.find((role) => role.value === selectedRole) ?? workspaceRoleOptions[0]
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="org-select" aria-label="Selected workspace">
          <Building2 size={18} />
          <span>Abby</span>
          <ChevronDown size={17} />
        </button>
        <div className="role-menu-shell">
          <button
            type="button"
            className={`role-select ${isRoleMenuOpen ? 'open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={isRoleMenuOpen}
            onClick={() => setIsRoleMenuOpen((open) => !open)}
          >
            <ShieldCheck size={18} />
            <span>{selectedRoleOption.label}</span>
            <ChevronDown size={17} />
          </button>
          {isRoleMenuOpen && (
            <div className="role-dropdown" role="menu">
              {workspaceRoleOptions.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={role.value === selectedRole}
                  className={role.value === selectedRole ? 'selected' : ''}
                  onClick={() => {
                    onSelectedRoleChange(role.value)
                    setIsRoleMenuOpen(false)
                  }}
                >
                  <span>
                    <strong>{role.label}</strong>
                    <small>{role.description}</small>
                  </span>
                  {role.value === selectedRole && <Check size={18} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="topbar-account" aria-label="Current user">
        <UserRound size={19} />
        <div>
          <span>{selectedRoleOption.label}</span>
          <strong>Oliver Aalami</strong>
        </div>
        <button type="button" title="Logout" aria-label="Logout">
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>

      {view !== 'admin' && (
        <div className="status-strip desktop-status">
          <span>{Object.values(record.metadata.related_resource_counts).reduce((sum, count) => sum + count, 0)} FHIR inputs</span>
          <span>{abbyCase.signals.length} signals</span>
          <span>{run ? `run ${run.stage}` : 'no active run'}</span>
          <span>{persistence}</span>
        </div>
      )}
      {view === 'admin' && directory && (
        <div className="status-strip desktop-status">
          <span>{directory.counts.superadmins} superadmin</span>
          <span>{directory.counts.providers} providers</span>
          <span>{directory.counts.patients} patients</span>
        </div>
      )}
    </header>
  )
}

function AdminView({
  directory,
  adminSection,
  onAdminSectionChange,
  onDirectoryChange,
  onOpenPatient,
}: {
  directory: DirectoryResponse
  adminSection: AdminSection
  onAdminSectionChange: (section: AdminSection) => void
  onDirectoryChange: (directory: DirectoryResponse) => void
  onOpenPatient: (recordId: string) => void
}) {
  const [form, setForm] = useState({
    id: '',
    name: '',
    phone: '',
    roles: ['patient'] as DirectoryRole[],
    createdAt: '',
  })
  const [adminMessage, setAdminMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const users = directory.people
  const patients = directory.people.filter((person) => person.roles.includes('patient'))
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
    onAdminSectionChange(person.roles.includes('patient') ? 'patients' : 'users')
    setAdminMessage(`Editing ${person.name}`)
  }

  return (
    <section className="content-grid admin-clean-grid">
      {adminSection === 'dashboard' && (
        <div className="admin-dashboard-placeholder">
          <div className="panel dashboard-intro">
            <p className="eyebrow">Dashboard</p>
            <h1>Welcome back.</h1>
            <p>Platform overview for Abby.</p>
          </div>
          <div className="admin-metrics">
            <div className="panel admin-metric-card">
              <UsersRound size={22} />
              <span>Total users</span>
              <strong>{users.length}</strong>
            </div>
            <div className="panel admin-metric-card">
              <ShieldCheck size={22} />
              <span>Superadmins</span>
              <strong>{directory.counts.superadmins}</strong>
            </div>
            <div className="panel admin-metric-card">
              <Stethoscope size={22} />
              <span>Providers</span>
              <strong>{directory.counts.providers}</strong>
            </div>
            <div className="panel admin-metric-card">
              <UserRound size={22} />
              <span>Patients</span>
              <strong>{directory.counts.patients}</strong>
            </div>
          </div>
        </div>
      )}

      {adminSection === 'users' && (
        <div className="admin-directory-workspace">
          <form className="panel person-form compact-patient-form" onSubmit={savePerson}>
            <div className="panel-title-row">
              <div>
                <p className="eyebrow">Users</p>
                <h2>{isEditing ? 'Edit user' : 'Add user'}</h2>
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
            <label>
              <span>Role</span>
              <select value={form.roles[0] ?? 'patient'} onChange={(event) => setForm({ ...form, roles: [event.target.value as DirectoryRole] })} required>
                {directoryRoleOptions.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={isSaving}>
              {isEditing ? <Save size={16} /> : <Plus size={16} />}
              {isEditing ? 'Save' : 'Add'}
            </button>
            {adminMessage && <div className="admin-message">{adminMessage}</div>}
          </form>

          <UserRoster
            users={users}
            eyebrow="Users"
            title={`${users.length} directory users`}
            ariaLabel="Users"
            onEdit={editPerson}
            onOpenPatient={onOpenPatient}
          />
        </div>
      )}

      {adminSection === 'patients' && (
        <div className="admin-directory-workspace patients-only-workspace">
          <UserRoster
            users={patients}
            eyebrow="Patients"
            title={`${patients.length} patients`}
            ariaLabel="Patients"
            onEdit={editPerson}
            onOpenPatient={onOpenPatient}
          />
        </div>
      )}
    </section>
  )
}

function UserRoster({
  users,
  eyebrow,
  title,
  ariaLabel,
  onEdit,
  onOpenPatient,
}: {
  users: DirectoryPerson[]
  eyebrow: string
  title: string
  ariaLabel: string
  onEdit: (person: DirectoryPerson) => void
  onOpenPatient: (recordId: string) => void
}) {
  return (
    <div className="panel patient-roster">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <UserRound size={20} />
      </div>
      <div className="patient-table" role="table" aria-label={ariaLabel}>
        <div className="patient-table-head" role="row">
          <span>Name</span>
          <span>Role</span>
          <span>Cell phone</span>
          <span>Context</span>
          <span>Action</span>
        </div>
        {users.map((user) => {
          return (
            <div className="patient-table-row" role="row" key={user.id}>
              <div className="patient-name-cell">
                <strong>{user.name}</strong>
                <span>{user.sourceRecordId ? 'Abridge synthetic record' : 'Directory user'}</span>
              </div>
              <div className="role-badges" data-label="Role">
                {user.roles.map((role) => <span className="role-badge" key={role}>{roleLabel(role)}</span>)}
              </div>
              <span className="phone-value" data-label="Cell">{user.phone}</span>
              <span data-label="Context">
                {user.sourceRecordId
                  ? `${user.birthDate ? `${ageFromBirthDate(user.birthDate)} yrs` : 'Age unknown'}${user.gender ? `, ${user.gender}` : ''} · ${user.visitTitle ?? 'Synthetic encounter'}`
                  : user.specialty ?? 'Manual directory entry'}
              </span>
              <div className="patient-actions">
                {user.sourceRecordId && (
                  <button type="button" className="quiet-button" onClick={() => onOpenPatient(user.sourceRecordId ?? '')}>
                    Open
                  </button>
                )}
                <button type="button" className="edit-button" onClick={() => onEdit(user)}>
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

function roleLabel(role: DirectoryRole): string {
  return directoryRoleOptions.find((option) => option.value === role)?.label ?? role
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
