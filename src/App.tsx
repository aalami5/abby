import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarCheck,
  Check,
  ChevronDown,
  ClipboardList,
  Database,
  LogOut,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Stethoscope,
  type LucideIcon,
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
  sendDirectoryOtp,
  sendPatientCheckIn,
  verifyDirectoryOtp,
} from './apiClient'
import type { AbbyCase, AbbyRun, DirectoryPerson, DirectoryResponse, DirectoryRole, EncounterRecord } from './types'

type View = 'admin' | 'patient' | 'provider'
type AdminSection = 'users' | 'patients' | 'settings'
type DirectoryUserFilter = 'providers' | 'patients' | 'admins'

const menuItems: Array<
  { id: 'users' | 'patients' | 'chat' | 'brief' | 'settings'; label: string; icon: LucideIcon }
> = [
  { id: 'users', label: 'Users', icon: UsersRound },
  { id: 'patients', label: 'Patients', icon: UserRound },
  { id: 'chat', label: 'Patient chat', icon: MessageSquareText },
  { id: 'brief', label: 'App Instructions', icon: Stethoscope },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const directoryRoleOptions: Array<{ value: DirectoryRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'patient', label: 'Patient' },
  { value: 'provider', label: 'Provider' },
]

const directoryFilterOptions: Array<{
  value: DirectoryUserFilter
  label: string
  description: string
  role: DirectoryRole
  icon: typeof UsersRound
}> = [
  { value: 'providers', label: 'Providers', description: 'Care team users', role: 'provider', icon: Stethoscope },
  { value: 'patients', label: 'Patients', description: 'Patient directory', role: 'patient', icon: UserRound },
  { value: 'admins', label: 'Admins', description: 'Workspace access', role: 'admin', icon: ShieldCheck },
]

const medicalSpecialtyOptions = [
  'Allergy and Immunology',
  'Anesthesiology',
  'Cardiology',
  'Cardiothoracic Surgery',
  'Colon and Rectal Surgery',
  'Critical Care Medicine',
  'Dermatology',
  'Emergency Medicine',
  'Endocrinology, Diabetes and Metabolism',
  'Family Medicine',
  'Gastroenterology',
  'General Surgery',
  'Geriatric Medicine',
  'Hematology',
  'Hospice and Palliative Medicine',
  'Infectious Disease',
  'Internal Medicine',
  'Interventional Cardiology',
  'Medical Genetics and Genomics',
  'Medical Oncology',
  'Nephrology',
  'Neurological Surgery',
  'Neurology',
  'Nuclear Medicine',
  'Obstetrics and Gynecology',
  'Occupational and Environmental Medicine',
  'Ophthalmology',
  'Orthopaedic Surgery',
  'Otolaryngology - Head and Neck Surgery',
  'Pathology',
  'Pediatrics',
  'Physical Medicine and Rehabilitation',
  'Plastic Surgery',
  'Preventive Medicine',
  'Psychiatry',
  'Pulmonary Disease',
  'Radiation Oncology',
  'Radiology',
  'Rheumatology',
  'Sleep Medicine',
  'Sports Medicine',
  'Thoracic Surgery',
  'Urology',
  'Vascular Surgery',
]

function App() {
  const [records, setRecords] = useState<EncounterRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState<View>('admin')
  const [adminSection, setAdminSection] = useState<AdminSection>('users')
  const [selectedRole, setSelectedRole] = useState<DirectoryRole>('admin')
  const [loadingError, setLoadingError] = useState('')
  const [runsByCase, setRunsByCase] = useState<Record<string, AbbyRun>>({})
  const [persistence, setPersistence] = useState('loading')
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null)
  const [runError, setRunError] = useState('')
  const [isRunBusy, setIsRunBusy] = useState(false)
  const [verifiedPatientRecordIds, setVerifiedPatientRecordIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    async function initialize() {
      try {
        const [loadedRecords, loadedRuns, loadedDirectory] = await Promise.all([loadRecords(), loadRuns(), loadDirectory()])
        const deepLink = patientChatDeepLink(loadedRecords)
        setRecords(loadedRecords)
        setSelectedId(deepLink.recordId ?? loadedRecords[1]?.id ?? loadedRecords[0]?.id ?? '')
        if (deepLink.openPatientChat) setSelectedRole('patient')
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
  const selectedDirectoryPatient = useMemo(
    () => directory?.people.find((person) => person.roles.includes('patient') && person.sourceRecordId === abbyCase?.record.id),
    [abbyCase?.record.id, directory],
  )
  const activeRun = abbyCase ? runsByCase[abbyCase.record.id] : undefined
  const navItems = useMemo(
    () => {
      if (selectedRole === 'patient') return menuItems.filter((item) => item.id === 'chat')
      if (selectedRole === 'admin') return menuItems.filter((item) => item.id === 'users' || item.id === 'settings')
      if (selectedRole === 'provider') return menuItems.filter((item) => item.id === 'brief' || item.id === 'settings')
      return menuItems
    },
    [selectedRole],
  )

  useEffect(() => {
    if (selectedRole === 'patient' && view !== 'patient') {
      setView('patient')
      return
    }
    if (selectedRole === 'admin' && view !== 'admin') {
      setView('admin')
      setAdminSection('users')
      return
    }
    if (selectedRole === 'provider' && (view === 'patient' || (view === 'admin' && adminSection !== 'settings'))) {
      setView('provider')
      return
    }
    if (view === 'provider' && selectedRole !== 'provider') {
      setView('admin')
      if (selectedRole === 'admin') setAdminSection('users')
    }
  }, [adminSection, selectedRole, view])

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
          {navItems.map((item) => {
            const Icon = item.icon
            const active = (
              (item.id === 'users' && view === 'admin' && adminSection === 'users') ||
              (item.id === 'patients' && view === 'admin' && adminSection === 'patients') ||
              (item.id === 'chat' && view === 'patient') ||
              (item.id === 'brief' && view === 'provider') ||
              (item.id === 'settings' && view === 'admin' && adminSection === 'settings')
            )
            const selectItem = () => {
              if (item.id === 'users' || item.id === 'patients' || item.id === 'settings') {
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
              setAdminSection('users')
              setView('admin')
            }

            return (
              <button
                key={item.id}
                type="button"
                className={active ? 'active' : ''}
                onClick={selectItem}
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
        {view !== 'admin' && selectedRole !== 'patient' && (
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
        {view === 'patient' && (
          selectedRole === 'patient' && !verifiedPatientRecordIds.has(abbyCase.record.id)
            ? (
              <PatientVerificationGate
                patient={selectedDirectoryPatient}
                recordId={abbyCase.record.id}
                onDirectoryChange={setDirectory}
                onVerified={(recordId) => {
                  setVerifiedPatientRecordIds((current) => {
                    const next = new Set(current)
                    next.add(recordId)
                    return next
                  })
                }}
              />
            )
            : (
              <PatientChat
                abbyCase={abbyCase}
                directory={directory}
                run={activeRun}
                onLaunch={() => launchRun(abbyCase)}
                isRunBusy={isRunBusy}
                patientOnly={selectedRole === 'patient'}
              />
            )
        )}
        {view === 'provider' && directory && (
          <ProviderView
            directory={directory}
            abbyCase={abbyCase}
            run={activeRun}
            onDirectoryChange={setDirectory}
            onApprove={approveActiveRun}
            onExecute={executeActiveRun}
            isRunBusy={isRunBusy}
            onOpenPatient={(recordId) => {
              setSelectedId(recordId)
              setView('patient')
            }}
          />
        )}
      </section>
    </main>
  )
}

function PatientVerificationGate({
  patient,
  recordId,
  onDirectoryChange,
  onVerified,
}: {
  patient?: DirectoryPerson
  recordId: string
  onDirectoryChange: (directory: DirectoryResponse) => void
  onVerified: (recordId: string) => void
}) {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState('Preparing verification...')
  const [isSending, setIsSending] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  const sendCode = useCallback(async () => {
    if (!patient?.phone) {
      setStatus('This patient does not have a phone number on file.')
      return
    }
    setIsSending(true)
    try {
      const nextDirectory = await sendDirectoryOtp(patient.phone)
      onDirectoryChange(nextDirectory)
      setStatus(`Verification code sent to ${maskedPhone(patient.phone)}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSending(false)
    }
  }, [onDirectoryChange, patient?.phone])

  useEffect(() => {
    void sendCode()
  }, [sendCode])

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!patient?.phone || !code.trim()) return
    setIsVerifying(true)
    try {
      const nextDirectory = await verifyDirectoryOtp(patient.phone, code)
      onDirectoryChange(nextDirectory)
      onVerified(recordId)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <section className="content-grid patient-verification-workspace">
      <form className="panel otp-panel patient-verification-panel" onSubmit={verifyCode}>
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">Patient verification</p>
            <h2>Enter your code</h2>
          </div>
          <ShieldCheck size={22} />
        </div>
        <p className="verification-copy">
          Abby needs to verify this phone before opening the check-in chat.
        </p>
        <label>
          <span>Verification code</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            required
          />
        </label>
        <div className="otp-row">
          <button type="button" className="secondary" onClick={sendCode} disabled={isSending || !patient?.phone}>
            {isSending ? 'Sending...' : 'Resend'}
          </button>
          <span>{status}</span>
          <button type="submit" disabled={isVerifying || code.trim().length < 4 || !patient?.phone}>
            {isVerifying ? 'Checking...' : 'Verify'}
          </button>
        </div>
      </form>
    </section>
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
  selectedRole: DirectoryRole
  onSelectedRoleChange: (role: DirectoryRole) => void
}) {
  const { record } = abbyCase
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false)
  const selectedRoleOption = directoryRoleOptions.find((role) => role.value === selectedRole) ?? directoryRoleOptions[0]
  return (
    <header className="topbar">
      <div className="topbar-left">
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
              {directoryRoleOptions.map((role) => (
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
          <span>{adminCount(directory)} admins</span>
          <span>{directory.counts.providers} providers</span>
          <span>{directory.counts.patients} patients</span>
        </div>
      )}
    </header>
  )
}

function SaveNotice({ message }: { message: string }) {
  return (
    <div className="save-notice" role="status" aria-live="polite">
      <Check size={17} />
      <span>{message}</span>
    </div>
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
  const [userFilter, setUserFilter] = useState<DirectoryUserFilter>('patients')
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [patientForm, setPatientForm] = useState({
    id: '',
    name: '',
    phone: '',
    gender: '',
    birthDate: '',
    city: '',
    state: '',
    visitTitle: '',
    primaryProviderId: '',
    sourceRecordId: '',
    synthetic: false,
    createdAt: '',
  })
  const [adminMessage, setAdminMessage] = useState('')
  const [patientMessage, setPatientMessage] = useState('')
  const [patientSaveNotice, setPatientSaveNotice] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isPatientSaving, setIsPatientSaving] = useState(false)
  const patients = directory.people.filter((person) => person.roles.includes('patient'))
  const providers = directory.people.filter((person) => person.roles.includes('provider'))
  const activeFilter = directoryFilterOptions.find((option) => option.value === userFilter) ?? directoryFilterOptions[0]
  const filteredUsers = directory.people.filter((person) => hasDirectoryRole(person, activeFilter.role))
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? patients[0]
  const isEditing = Boolean(form.id)

  useEffect(() => {
    if (!selectedPatient) return
    setSelectedPatientId(selectedPatient.id)
    setPatientForm(personToPatientForm(selectedPatient))
  }, [selectedPatient])

  useEffect(() => {
    if (!patientSaveNotice) return
    const timeout = window.setTimeout(() => setPatientSaveNotice(''), 2200)
    return () => window.clearTimeout(timeout)
  }, [patientSaveNotice])

  const savePerson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSaving(true)
    try {
      const nextDirectory = await saveDirectoryPerson({
        id: form.id || undefined,
        name: form.name,
        phone: form.phone,
        roles: normalizeDirectoryRoles(form.roles),
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
    setForm({ id: '', name: '', phone: '', roles: [activeFilter.role], createdAt: '' })
  }

  const editPerson = (person: DirectoryPerson) => {
    if (person.roles.includes('patient')) {
      selectPatient(person)
      onAdminSectionChange('patients')
      setAdminMessage('')
      return
    }
    setForm({
      id: person.id,
      name: person.name,
      phone: person.phone,
      roles: normalizeDirectoryRoles(person.roles),
      createdAt: person.createdAt,
    })
    const nextFilter = filterForPerson(person)
    setUserFilter(nextFilter)
    onAdminSectionChange(adminSection === 'patients' && person.roles.includes('patient') ? 'patients' : 'users')
    setAdminMessage(`Editing ${person.name}`)
  }

  const selectPatient = (patient: DirectoryPerson) => {
    setSelectedPatientId(patient.id)
    setPatientForm(personToPatientForm(patient))
    setPatientMessage('')
  }

  const saveSelectedPatient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsPatientSaving(true)
    try {
      const nextDirectory = await saveDirectoryPerson({
        id: patientForm.id,
        name: patientForm.name,
        phone: patientForm.phone,
        roles: ['patient'],
        gender: patientForm.gender,
        birthDate: patientForm.birthDate,
        city: patientForm.city,
        state: patientForm.state,
        visitTitle: patientForm.visitTitle,
        primaryProviderId: patientForm.primaryProviderId,
        sourceRecordId: patientForm.sourceRecordId,
        synthetic: patientForm.synthetic,
        createdAt: patientForm.createdAt || undefined,
      })
      onDirectoryChange(nextDirectory)
      const savedPatient = nextDirectory.people.find((person) => person.id === patientForm.id)
      if (savedPatient) {
        setSelectedPatientId(savedPatient.id)
        setPatientForm(personToPatientForm(savedPatient))
      }
      setPatientMessage(`${savedPatient?.name ?? patientForm.name} saved`)
      setPatientSaveNotice(`${savedPatient?.name ?? patientForm.name} saved`)
    } catch (error) {
      setPatientMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsPatientSaving(false)
    }
  }

  return (
    <section className="content-grid admin-clean-grid">
      {patientSaveNotice && <SaveNotice message={patientSaveNotice} />}
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
            users={filteredUsers}
            eyebrow="Users"
            title={`${filteredUsers.length} ${activeFilter.label.toLowerCase()}`}
            emptyLabel={activeFilter.label.toLowerCase()}
            ariaLabel={activeFilter.label}
            filters={directoryFilterOptions.map((option) => ({
              ...option,
              count: directory.people.filter((person) => hasDirectoryRole(person, option.role)).length,
            }))}
            activeFilter={userFilter}
            onFilterChange={(nextFilter) => {
              setUserFilter(nextFilter)
              const nextRole = directoryFilterOptions.find((option) => option.value === nextFilter)?.role ?? 'provider'
              if (!isEditing) setForm((current) => ({ ...current, roles: [nextRole] }))
            }}
            onEdit={editPerson}
            onOpenPatient={onOpenPatient}
          />
        </div>
      )}

      {adminSection === 'patients' && (
        <div className="patient-detail-workspace">
          <UserRoster
            users={patients}
            eyebrow="Patients"
            title={`${patients.length} patients`}
            ariaLabel="Patients"
            onEdit={selectPatient}
            onOpenPatient={onOpenPatient}
            selectedUserId={selectedPatient?.id}
            onSelect={selectPatient}
          />
          <PatientDetailPanel
            patient={selectedPatient}
            providers={providers}
            form={patientForm}
            message={patientMessage}
            isSaving={isPatientSaving}
            onFormChange={setPatientForm}
            onSubmit={saveSelectedPatient}
            onOpenPatient={onOpenPatient}
          />
        </div>
      )}

      {adminSection === 'settings' && (
        <div className="settings-workspace">
          <div className="panel settings-panel">
            <div className="panel-title-row">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>Workspace settings</h2>
              </div>
              <Settings size={20} />
            </div>
            <div className="settings-list">
              <div>
                <strong>Demo mode</strong>
                <span>Abby is configured for the current portal demo.</span>
              </div>
              <div>
                <strong>Patient messaging</strong>
                <span>Pre-visit messages are routed into the selected patient's chat thread.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function personToPatientForm(person: DirectoryPerson) {
  return {
    id: person.id,
    name: person.name,
    phone: person.phone,
    gender: person.gender ?? '',
    birthDate: person.birthDate ?? '',
    city: person.city ?? '',
    state: person.state ?? '',
    visitTitle: person.visitTitle ?? '',
    primaryProviderId: person.primaryProviderId ?? '',
    sourceRecordId: person.sourceRecordId ?? '',
    synthetic: Boolean(person.synthetic),
    createdAt: person.createdAt,
  }
}

type PatientFormState = ReturnType<typeof personToPatientForm>

function UserRoster({
  users,
  eyebrow,
  title,
  emptyLabel,
  ariaLabel,
  filters,
  activeFilter,
  onFilterChange,
  onEdit,
  onOpenPatient,
  selectedUserId,
  onSelect,
}: {
  users: DirectoryPerson[]
  eyebrow: string
  title: string
  emptyLabel?: string
  ariaLabel: string
  filters?: Array<(typeof directoryFilterOptions)[number] & { count: number }>
  activeFilter?: DirectoryUserFilter
  onFilterChange?: (filter: DirectoryUserFilter) => void
  onEdit: (person: DirectoryPerson) => void
  onOpenPatient: (recordId: string) => void
  selectedUserId?: string
  onSelect?: (person: DirectoryPerson) => void
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
      {filters && activeFilter && onFilterChange && (
        <div className="directory-filter-bar" aria-label="Filter users by role">
          {filters.map((filter) => {
            const Icon = filter.icon
            return (
              <button
                key={filter.value}
                type="button"
                className={filter.value === activeFilter ? 'selected' : ''}
                onClick={() => onFilterChange(filter.value)}
              >
                <Icon size={18} />
                <span>
                  <strong>{filter.label}</strong>
                  <small>{filter.description}</small>
                </span>
                <b>{filter.count}</b>
              </button>
            )
          })}
        </div>
      )}
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
              {onSelect ? (
                <button
                  type="button"
                  className={`patient-name-cell patient-select-button ${selectedUserId === user.id ? 'selected' : ''}`}
                  onClick={() => onSelect(user)}
                  aria-label={`Select ${user.name}`}
                >
                  <strong>{user.name}</strong>
                  <span>{user.sourceRecordId ? 'Abridge synthetic record' : 'Directory user'}</span>
                </button>
              ) : (
                <div className="patient-name-cell">
                  <strong>{user.name}</strong>
                  <span>{user.sourceRecordId ? 'Abridge synthetic record' : 'Directory user'}</span>
                </div>
              )}
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
        {!users.length && (
          <div className="empty-roster">
            <strong>No {emptyLabel ?? title.toLowerCase()} yet</strong>
            <span>Add one from the form on the left.</span>
          </div>
        )}
      </div>
    </div>
  )
}

function PatientDetailPanel({
  patient,
  providers,
  form,
  message,
  isSaving,
  onFormChange,
  onSubmit,
  onOpenPatient,
}: {
  patient?: DirectoryPerson
  providers: DirectoryPerson[]
  form: PatientFormState
  message: string
  isSaving: boolean
  onFormChange: (form: PatientFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onOpenPatient: (recordId: string) => void
}) {
  if (!patient) {
    return (
      <div className="panel patient-detail-panel empty-patient-detail">
        <p className="eyebrow">Patient profile</p>
        <h2>No patient selected</h2>
      </div>
    )
  }

  return (
    <form className="panel patient-detail-panel" onSubmit={onSubmit}>
      <div className="panel-title-row patient-detail-title">
        <div>
          <p className="eyebrow">Patient profile</p>
          <h2>{patient.name}</h2>
        </div>
        {form.sourceRecordId && (
          <button type="button" className="quiet-button" onClick={() => onOpenPatient(form.sourceRecordId)}>
            <MessageSquareText size={16} /> Open chat
          </button>
        )}
      </div>

      <div className="patient-detail-meta">
        <span>{form.birthDate ? `${ageFromBirthDate(form.birthDate)} yrs` : 'Age unknown'}</span>
        <span>{form.gender || 'Gender unset'}</span>
        <span>{[form.city, form.state].filter(Boolean).join(', ') || 'Location unset'}</span>
      </div>

      <div className="patient-form-grid">
        <label>
          <span>Name</span>
          <input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} required />
        </label>
        <label>
          <span>Cell phone</span>
          <input value={form.phone} onChange={(event) => onFormChange({ ...form, phone: event.target.value })} required />
        </label>
        <label>
          <span>Date of birth</span>
          <input type="date" value={form.birthDate} onChange={(event) => onFormChange({ ...form, birthDate: event.target.value })} />
        </label>
        <label>
          <span>Gender</span>
          <select value={form.gender} onChange={(event) => onFormChange({ ...form, gender: event.target.value })}>
            <option value="">Unset</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>
          <span>City</span>
          <input value={form.city} onChange={(event) => onFormChange({ ...form, city: event.target.value })} />
        </label>
        <label>
          <span>State</span>
          <input value={form.state} onChange={(event) => onFormChange({ ...form, state: event.target.value.toUpperCase().slice(0, 2) })} maxLength={2} />
        </label>
        <label className="wide-field">
          <span>Visit context</span>
          <input value={form.visitTitle} onChange={(event) => onFormChange({ ...form, visitTitle: event.target.value })} />
        </label>
        <label className="wide-field">
          <span>Primary provider</span>
          <select value={form.primaryProviderId} onChange={(event) => onFormChange({ ...form, primaryProviderId: event.target.value })}>
            <option value="">Unassigned</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="patient-detail-actions">
        <button type="submit" disabled={isSaving}>
          <Save size={16} /> Save patient
        </button>
        {message && <div className="admin-message">{message}</div>}
      </div>
    </form>
  )
}

function roleLabel(role: DirectoryRole): string {
  return directoryRoleOptions.find((option) => option.value === role)?.label ?? role
}

function maskedPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const lastFour = digits.slice(-4)
  return lastFour ? `***-***-${lastFour}` : 'the phone on file'
}

function hasDirectoryRole(person: DirectoryPerson, role: DirectoryRole): boolean {
  if (role === 'admin') return person.roles.some((personRole) => ['admin', 'superadmin'].includes(String(personRole)))
  return person.roles.includes(role)
}

function filterForPerson(person: DirectoryPerson): DirectoryUserFilter {
  if (hasDirectoryRole(person, 'admin')) return 'admins'
  if (person.roles.includes('provider')) return 'providers'
  return 'patients'
}

function adminCount(directory: DirectoryResponse): number {
  return directory.counts.admins ?? directory.counts.superadmins
}

function normalizeDirectoryRoles(roles: DirectoryRole[]): DirectoryRole[] {
  return roles.map((role) => String(role) === 'superadmin' ? 'admin' : role)
}

function ageFromBirthDate(birthDate: string): number {
  const birth = new Date(birthDate)
  const now = new Date('2026-07-18')
  let age = now.getFullYear() - birth.getFullYear()
  const monthDelta = now.getMonth() - birth.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1
  return age
}

function patientChatDeepLink(records: EncounterRecord[]): { recordId?: string; openPatientChat: boolean } {
  const params = new URLSearchParams(window.location.search)
  const requestedRecordId = params.get('patient') || params.get('recordId') || params.get('caseId') || ''
  const recordId = records.some((record) => record.id === requestedRecordId) ? requestedRecordId : undefined
  return {
    recordId,
    openPatientChat: params.get('role') === 'patient' || params.get('view') === 'patient' || params.get('view') === 'chat',
  }
}

function ProviderView({
  directory,
  abbyCase,
  run,
  onDirectoryChange,
  onApprove,
  onExecute,
  isRunBusy,
  onOpenPatient,
}: {
  directory: DirectoryResponse
  abbyCase: AbbyCase
  run?: AbbyRun
  onDirectoryChange: (directory: DirectoryResponse) => void
  onApprove: () => void
  onExecute: () => void
  isRunBusy: boolean
  onOpenPatient: (recordId: string) => void
}) {
  const providers = directory.people.filter((person) => person.roles.includes('provider'))
  const defaultProvider = providers.find((person) => person.id === 'person-oliver-aalami') ?? providers[0]
  const [selectedProviderId, setSelectedProviderId] = useState(defaultProvider?.id ?? '')
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? defaultProvider
  const assignedPatients = useMemo(
    () => selectedProvider
      ? directory.people.filter((person) => person.roles.includes('patient') && person.primaryProviderId === selectedProvider.id)
      : [],
    [directory.people, selectedProvider],
  )
  const [providerForm, setProviderForm] = useState(() => personToProviderForm(selectedProvider))
  const [providerMessage, setProviderMessage] = useState('')
  const [checkInNotice, setCheckInNotice] = useState('')
  const [patientPhoneDrafts, setPatientPhoneDrafts] = useState<Record<string, string>>({})
  const [preVisitStatusByPatient, setPreVisitStatusByPatient] = useState<Record<string, string>>({})
  const [busyCheckIns, setBusyCheckIns] = useState<Record<string, boolean>>({})
  const [busyPhoneSaves, setBusyPhoneSaves] = useState<Record<string, boolean>>({})
  const [isProviderSaving, setIsProviderSaving] = useState(false)

  useEffect(() => {
    if (!selectedProvider) return
    setSelectedProviderId(selectedProvider.id)
    setProviderForm(personToProviderForm(selectedProvider))
  }, [selectedProvider])

  useEffect(() => {
    if (!checkInNotice) return
    const timeout = window.setTimeout(() => setCheckInNotice(''), 2200)
    return () => window.clearTimeout(timeout)
  }, [checkInNotice])

  useEffect(() => {
    setPatientPhoneDrafts((current) => {
      const next = { ...current }
      for (const patient of assignedPatients) {
        if (!(patient.id in next)) next[patient.id] = patient.phone
      }
      return next
    })
  }, [assignedPatients])

  const saveProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedProvider) return
    setIsProviderSaving(true)
    try {
      const nextDirectory = await saveDirectoryPerson({
        id: providerForm.id,
        name: providerForm.name,
        phone: providerForm.phone,
        roles: providerForm.roles,
        specialty: providerForm.specialty,
        abbyInstructions: providerForm.abbyInstructions,
        createdAt: providerForm.createdAt || undefined,
      })
      onDirectoryChange(nextDirectory)
      setProviderMessage(`${providerForm.name} updated`)
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsProviderSaving(false)
    }
  }

  const phoneDraftForPatient = (patient: DirectoryPerson) => patientPhoneDrafts[patient.id] ?? patient.phone

  const persistPatientPhone = async (patient: DirectoryPerson): Promise<DirectoryPerson> => {
    const nextPhone = phoneDraftForPatient(patient)
    if (nextPhone.trim() === patient.phone.trim()) return patient
    const nextDirectory = await saveDirectoryPerson({ ...patient, phone: nextPhone })
    onDirectoryChange(nextDirectory)
    const savedPatient = nextDirectory.people.find((person) => person.id === patient.id) ?? { ...patient, phone: nextPhone }
    setPatientPhoneDrafts((current) => ({ ...current, [patient.id]: savedPatient.phone }))
    return savedPatient
  }

  const savePatientPhone = async (patient: DirectoryPerson) => {
    setBusyPhoneSaves((current) => ({ ...current, [patient.id]: true }))
    setPreVisitStatusByPatient((current) => ({ ...current, [patient.id]: 'Saving phone...' }))
    try {
      await persistPatientPhone(patient)
      setPreVisitStatusByPatient((current) => ({ ...current, [patient.id]: 'Phone saved' }))
      setCheckInNotice('Phone saved')
    } catch (error) {
      setPreVisitStatusByPatient((current) => ({
        ...current,
        [patient.id]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setBusyPhoneSaves((current) => ({ ...current, [patient.id]: false }))
    }
  }

  const startCheckIn = async (patient: DirectoryPerson) => {
    setBusyCheckIns((current) => ({ ...current, [patient.id]: true }))
    setPreVisitStatusByPatient((current) => ({ ...current, [patient.id]: 'Sending check-in...' }))
    try {
      const savedPatient = await persistPatientPhone(patient)
      const result = await sendPatientCheckIn({ patient: savedPatient, provider: selectedProvider })
      const failed = result.mode === 'twilio' && ['failed', 'undelivered'].includes(result.status)
      const status = result.mode === 'twilio'
        ? failed
          ? `Twilio SMS ${result.status}: ${result.twilioErrorMessage ?? result.twilioErrorCode ?? 'delivery failed'}`
          : `Twilio SMS ${result.status}`
        : 'Demo message ready; configure Twilio to send'
      setPreVisitStatusByPatient((current) => ({ ...current, [patient.id]: status }))
      setCheckInNotice(failed ? 'Check-in failed' : 'Check-in sent')
    } catch (error) {
      setPreVisitStatusByPatient((current) => ({
        ...current,
        [patient.id]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setBusyCheckIns((current) => ({ ...current, [patient.id]: false }))
    }
  }

  if (!selectedProvider) {
    return (
      <section className="content-grid">
        <div className="panel empty-patient-detail">
          <p className="eyebrow">Provider</p>
          <h2>No provider yet</h2>
        </div>
      </section>
    )
  }

  return (
    <section className="content-grid provider-workspace">
      {checkInNotice && <SaveNotice message={checkInNotice} />}
      <form className="panel provider-profile-panel" onSubmit={saveProvider}>
        <div className="panel-title-row patient-detail-title">
          <div>
            <p className="eyebrow">Provider profile</p>
            <h2>{selectedProvider.name}</h2>
          </div>
          {providers.length > 1 && (
            <select
              value={selectedProvider.id}
              onChange={(event) => {
                setSelectedProviderId(event.target.value)
                setProviderMessage('')
              }}
              aria-label="Select provider"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="patient-form-grid">
          <label>
            <span>Name</span>
            <input value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} required />
          </label>
          <label>
            <span>Cell phone for two-factor authentication</span>
            <input value={providerForm.phone} onChange={(event) => setProviderForm({ ...providerForm, phone: event.target.value })} required />
          </label>
          <label className="wide-field">
            <span>Specialty</span>
            <select value={providerForm.specialty} onChange={(event) => setProviderForm({ ...providerForm, specialty: event.target.value })}>
              <option value="">Unset</option>
              {medicalSpecialtyOptions.map((specialty) => (
                <option key={specialty} value={specialty}>{specialty}</option>
              ))}
            </select>
          </label>
          <label className="wide-field">
            <span>App Instructions</span>
            <textarea
              value={providerForm.abbyInstructions}
              onChange={(event) => setProviderForm({ ...providerForm, abbyInstructions: event.target.value })}
              spellCheck={false}
            />
          </label>
        </div>

        <div className="patient-detail-actions">
          <button type="submit" disabled={isProviderSaving}>
            <Save size={16} /> Save provider
          </button>
          {providerMessage && <div className="admin-message">{providerMessage}</div>}
        </div>
      </form>

      <div className="panel provider-panel-list">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">Patient panel</p>
            <h2>{assignedPatients.length} assigned patients</h2>
          </div>
          <UserRound size={20} />
        </div>
        <div className="provider-patient-list">
          {assignedPatients.map((patient) => (
            <div className="provider-patient-row" key={patient.id}>
              <div>
                <strong>{patient.name}</strong>
                <span>{patient.visitTitle ?? 'Patient'}</span>
                {preVisitStatusByPatient[patient.id] && <small>{preVisitStatusByPatient[patient.id]}</small>}
              </div>
              <div className="provider-phone-editor">
                <label>
                  <span>Cell phone</span>
                  <input
                    value={phoneDraftForPatient(patient)}
                    onChange={(event) => setPatientPhoneDrafts((current) => ({ ...current, [patient.id]: event.target.value }))}
                    placeholder="+1 650 555 0100"
                  />
                </label>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => savePatientPhone(patient)}
                  disabled={busyPhoneSaves[patient.id] || phoneDraftForPatient(patient).trim() === patient.phone.trim()}
                >
                  <Save size={15} /> Save phone
                </button>
              </div>
              <div className="provider-patient-actions">
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => startCheckIn(patient)}
                  disabled={busyCheckIns[patient.id]}
                >
                  <Send size={15} /> Start check-in
                </button>
                {patient.sourceRecordId && (
                  <button type="button" className="quiet-button" onClick={() => onOpenPatient(patient.sourceRecordId ?? '')}>
                    Open chat
                  </button>
                )}
              </div>
            </div>
          ))}
          {!assignedPatients.length && (
            <div className="empty-roster">
              <strong>No assigned patients</strong>
              <span>Assign patients from the Patients page.</span>
            </div>
          )}
        </div>
      </div>

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

function personToProviderForm(person?: DirectoryPerson) {
  return {
    id: person?.id ?? '',
    name: person?.name ?? '',
    phone: person?.phone ?? '',
    roles: person?.roles ?? (['provider'] as DirectoryRole[]),
    specialty: person?.specialty ?? '',
    abbyInstructions: person?.abbyInstructions ?? '',
    createdAt: person?.createdAt ?? '',
  }
}

export default App
