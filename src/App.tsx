import { Fragment, type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  CalendarCheck,
  Check,
  ChevronDown,
  ClipboardList,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Stethoscope,
  UsersRound,
  UserRound,
  X,
} from 'lucide-react'
import './App.css'
import { buildCase, loadRecords } from './abbyEngine'
import { PatientChat } from './PatientChat'
import { providerDisplayName } from './providerNames'
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
type AdminSection = 'users' | 'patients'
type DirectoryUserFilter = 'providers' | 'patients' | 'admins'

const directoryRoleOptions: Array<{ value: DirectoryRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'patient', label: 'Patient' },
  { value: 'provider', label: 'Provider' },
]

const pageRoleOptions = directoryRoleOptions.map((role) => ({
  ...role,
  label: `${role.label} page`,
}))

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
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [view, setView] = useState<View>('admin')
  const [adminSection, setAdminSection] = useState<AdminSection>('users')
  const [selectedRole, setSelectedRole] = useState<DirectoryRole>('admin')
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
        const deepLink = patientChatDeepLink(loadedRecords)
        setRecords(loadedRecords)
        setSelectedId(deepLink.recordId ?? loadedRecords[1]?.id ?? loadedRecords[0]?.id ?? '')
        setSelectedProviderId(deepLink.providerId ?? '')
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
  const activeRun = abbyCase ? runsByCase[abbyCase.record.id] : undefined

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
    if (selectedRole === 'provider' && view !== 'provider') {
      setView('provider')
      return
    }
    if (view === 'provider' && selectedRole !== 'provider') {
      setView('admin')
      if (selectedRole === 'admin') setAdminSection('users')
    }
  }, [adminSection, selectedRole, view])

  useEffect(() => {
    if (!directory || selectedProviderId) return
    const defaultProviderId = providerIdForRecord(selectedId, directory)
    if (defaultProviderId) setSelectedProviderId(defaultProviderId)
  }, [directory, selectedId, selectedProviderId])

  const applyRunResponse = (response: Awaited<ReturnType<typeof loadRuns>>) => {
    setRunsByCase(response.runsByCase)
    setPersistence(response.persistence)
    setRunError('')
  }

  const selectPatientChatRecord = (recordId: string) => {
    setSelectedId(recordId)
    const defaultProviderId = providerIdForRecord(recordId, directory)
    if (defaultProviderId) setSelectedProviderId(defaultProviderId)
    updatePatientChatUrl(recordId, defaultProviderId || selectedProviderId)
  }

  const selectPatientChatProvider = (providerId: string) => {
    setSelectedProviderId(providerId)
    updatePatientChatUrl(selectedId, providerId)
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
    <main className={`app-shell ${view === 'patient' ? 'patient-shell' : ''}`}>
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
        {runError && <div className="runtime-error">{runError}</div>}
        {view === 'admin' && directory && (
          <AdminView
            directory={directory}
            adminSection={adminSection}
            onAdminSectionChange={setAdminSection}
            onDirectoryChange={setDirectory}
            onOpenPatient={(recordId) => {
              setSelectedId(recordId)
              const defaultProviderId = providerIdForRecord(recordId, directory)
              if (defaultProviderId) setSelectedProviderId(defaultProviderId)
              updatePatientChatUrl(recordId, defaultProviderId || selectedProviderId)
              setView('patient')
            }}
          />
        )}
        {view === 'patient' && (
          <PatientChat
            abbyCase={abbyCase}
            records={records}
            selectedRecordId={selectedId}
            directory={directory}
            run={activeRun}
            onLaunch={() => launchRun(abbyCase)}
            isRunBusy={isRunBusy}
            selectedProviderId={selectedProviderId}
            onRecordChange={selectPatientChatRecord}
            onProviderChange={selectPatientChatProvider}
            patientOnly={selectedRole === 'patient'}
          />
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
            onOpenPatient={(recordId, providerId) => {
              setSelectedId(recordId)
              const defaultProviderId = providerId || providerIdForRecord(recordId, directory)
              if (defaultProviderId) setSelectedProviderId(defaultProviderId)
              updatePatientChatUrl(recordId, defaultProviderId || selectedProviderId)
              setView('patient')
            }}
          />
        )}
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
  selectedRole: DirectoryRole
  onSelectedRoleChange: (role: DirectoryRole) => void
}) {
  const { record } = abbyCase
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false)
  const selectedRoleOption = pageRoleOptions.find((role) => role.value === selectedRole) ?? pageRoleOptions[0]
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-brand" aria-label="Abby logo">
          <img src="/abby-logo.jpg" alt="" />
        </div>
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
              {pageRoleOptions.map((role) => (
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
  onOpenPatient: (recordId: string, providerId?: string) => void
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
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId)
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
      const submittedPhone = normalizePhoneForSms(patientForm.phone)
      const savedPhone = normalizePhoneForSms(savedPatient?.phone ?? '')
      if (!savedPatient || savedPhone !== submittedPhone) {
        setPatientMessage(`Save did not persist. Abby returned ${savedPatient?.phone || 'no phone'} instead of ${submittedPhone}.`)
        return
      }
      if (savedPatient) {
        setPatientForm(personToPatientForm(savedPatient))
      }
      setSelectedPatientId('')
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
            providers={providers}
            onEdit={selectPatient}
            onOpenPatient={onOpenPatient}
            selectedUserId={selectedPatientId}
            inlineEditForm={patientForm}
            inlineEditMessage={patientMessage}
            isInlineEditSaving={isPatientSaving}
            onInlineEditFormChange={setPatientForm}
            onInlineEditSubmit={saveSelectedPatient}
            onCancelInlineEdit={() => {
              setSelectedPatientId('')
              setPatientMessage('')
            }}
          />
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
  providers = [],
  assigningPatientIds = {},
  onAssignProvider,
  inlineEditForm,
  inlineEditMessage,
  isInlineEditSaving = false,
  onInlineEditFormChange,
  onInlineEditSubmit,
  onCancelInlineEdit,
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
  onOpenPatient: (recordId: string, providerId?: string) => void
  selectedUserId?: string
  onSelect?: (person: DirectoryPerson) => void
  providers?: DirectoryPerson[]
  assigningPatientIds?: Record<string, boolean>
  onAssignProvider?: (person: DirectoryPerson, primaryProviderId: string) => void
  inlineEditForm?: PatientFormState
  inlineEditMessage?: string
  isInlineEditSaving?: boolean
  onInlineEditFormChange?: (form: PatientFormState) => void
  onInlineEditSubmit?: (event: FormEvent<HTMLFormElement>) => void
  onCancelInlineEdit?: () => void
}) {
  const hasInlineEdit = Boolean(selectedUserId && inlineEditForm && onInlineEditFormChange && onInlineEditSubmit)

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
      <div className={`patient-table ${hasInlineEdit ? 'is-editing' : ''}`} role="table" aria-label={ariaLabel}>
        <div className="patient-table-head" role="row">
          <span>Name</span>
          <span>Role</span>
          <span>Cell phone</span>
          <span>Context</span>
          <span>Action</span>
        </div>
        {users.map((user) => {
          const isInlineEditing = selectedUserId === user.id && inlineEditForm && onInlineEditFormChange && onInlineEditSubmit
          const userDisplayName = user.roles.includes('provider') ? providerDisplayName(user.name) : user.name
          return (
            <Fragment key={user.id}>
            <div className={`patient-table-row ${isInlineEditing ? 'expanded' : hasInlineEdit ? 'dimmed' : ''}`} role="row">
              {onSelect ? (
                <button
                  type="button"
                  className={`patient-name-cell patient-select-button ${selectedUserId === user.id ? 'selected' : ''}`}
                  onClick={() => onSelect(user)}
                  aria-label={`Select ${userDisplayName}`}
                >
                  <strong>{userDisplayName}</strong>
                  <span>{user.sourceRecordId ? 'Abridge synthetic record' : 'Directory user'}</span>
                </button>
              ) : (
                <div className="patient-name-cell">
                  <strong>{userDisplayName}</strong>
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
                {user.roles.includes('patient') && providers.length > 0 && onAssignProvider && (
                  <label className="inline-provider-select">
                    <span>Assigned provider</span>
                    <select
                      value={user.primaryProviderId ?? ''}
                      onChange={(event) => onAssignProvider(user, event.target.value)}
                      disabled={assigningPatientIds[user.id]}
                      aria-label={`Assigned provider for ${user.name}`}
                    >
                      <option value="">Unassigned</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>{providerDisplayName(provider.name)}</option>
                      ))}
                    </select>
                  </label>
                )}
                {user.sourceRecordId && (
                  <button type="button" className="quiet-button" onClick={() => onOpenPatient(user.sourceRecordId ?? '')}>
                    Open
                  </button>
                )}
                <button type="button" className="edit-button" onClick={() => onEdit(user)}>
                  <Pencil size={15} /> {isInlineEditing ? 'Editing' : 'Edit'}
                </button>
              </div>
            </div>
            {isInlineEditing && (
              <form className="inline-patient-editor" onSubmit={onInlineEditSubmit}>
                <div className="inline-editor-grid">
                  <label>
                    <span>Name</span>
                    <input value={inlineEditForm.name} onChange={(event) => onInlineEditFormChange({ ...inlineEditForm, name: event.target.value })} required />
                  </label>
                  <label>
                    <span>Cell phone</span>
                    <input value={inlineEditForm.phone} onChange={(event) => onInlineEditFormChange({ ...inlineEditForm, phone: event.target.value })} required />
                  </label>
                  <label>
                    <span>Date of birth</span>
                    <input type="date" value={inlineEditForm.birthDate} onChange={(event) => onInlineEditFormChange({ ...inlineEditForm, birthDate: event.target.value })} />
                  </label>
                  <label>
                    <span>Gender</span>
                    <select value={inlineEditForm.gender} onChange={(event) => onInlineEditFormChange({ ...inlineEditForm, gender: event.target.value })}>
                      <option value="">Unset</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="other">Other</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </label>
                  <label>
                    <span>City</span>
                    <input value={inlineEditForm.city} onChange={(event) => onInlineEditFormChange({ ...inlineEditForm, city: event.target.value })} />
                  </label>
                  <label>
                    <span>State</span>
                    <input value={inlineEditForm.state} onChange={(event) => onInlineEditFormChange({ ...inlineEditForm, state: event.target.value.toUpperCase().slice(0, 2) })} maxLength={2} />
                  </label>
                  <label className="wide-field">
                    <span>Visit context</span>
                    <input value={inlineEditForm.visitTitle} onChange={(event) => onInlineEditFormChange({ ...inlineEditForm, visitTitle: event.target.value })} />
                  </label>
                  <label className="wide-field">
                    <span>Assigned provider</span>
                    <select value={inlineEditForm.primaryProviderId} onChange={(event) => onInlineEditFormChange({ ...inlineEditForm, primaryProviderId: event.target.value })}>
                      <option value="">Unassigned</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>{providerDisplayName(provider.name)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="inline-editor-actions">
                  <button type="button" className="quiet-button" onClick={onCancelInlineEdit}>Cancel</button>
                  {inlineEditMessage && <span>{inlineEditMessage}</span>}
                  <button type="submit" className="edit-button" disabled={isInlineEditSaving}>
                    <Save size={15} /> {isInlineEditSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </form>
            )}
            </Fragment>
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

function roleLabel(role: DirectoryRole): string {
  return directoryRoleOptions.find((option) => option.value === role)?.label ?? role
}

function normalizePhoneForSms(phone: string): string {
  const trimmed = phone.trim()
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  return digits ? `+${digits}` : ''
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

function patientChatDeepLink(records: EncounterRecord[]): { recordId?: string; providerId?: string; openPatientChat: boolean } {
  const params = new URLSearchParams(window.location.search)
  const requestedRecordId = params.get('patient') || params.get('recordId') || params.get('caseId') || ''
  const providerId = params.get('provider') || params.get('providerId') || undefined
  const recordId = resolvePatientRecordId(requestedRecordId, records)
  return {
    recordId,
    providerId,
    openPatientChat: params.get('role') === 'patient' || params.get('view') === 'patient' || params.get('view') === 'chat',
  }
}

function resolvePatientRecordId(requestedRecordId: string, records: EncounterRecord[]): string | undefined {
  if (records.some((record) => record.id === requestedRecordId)) return requestedRecordId
  const aliasMatch = /^record-(\d+)$/i.exec(requestedRecordId.trim())
  if (!aliasMatch) return undefined
  const index = Number(aliasMatch[1]) - 1
  return records[index]?.id
}

function providerIdForRecord(recordId: string, directory: DirectoryResponse | null): string {
  if (!directory) return ''
  const patient = directory.people.find((person) => person.roles.includes('patient') && person.sourceRecordId === recordId)
  return patient?.primaryProviderId || directory.people.find((person) => person.roles.includes('provider'))?.id || ''
}

function updatePatientChatUrl(recordId: string, providerId?: string) {
  const params = new URLSearchParams(window.location.search)
  params.set('role', 'patient')
  params.set('patient', recordId)
  if (providerId) params.set('provider', providerId)
  else params.delete('provider')
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
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
  onOpenPatient: (recordId: string, providerId?: string) => void
}) {
  const providers = directory.people.filter((person) => person.roles.includes('provider'))
  const defaultProvider = providers.find((person) => person.id === 'person-oliver-aalami') ?? providers[0]
  const [selectedProviderId, setSelectedProviderId] = useState(defaultProvider?.id ?? '')
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? defaultProvider
  const assignedPatients = useMemo(
    () => directory.people
      .filter((person) => person.roles.includes('patient'))
      .filter((person) => person.id !== selectedProvider?.id),
    [directory.people, selectedProvider?.id],
  )
  const [providerForm, setProviderForm] = useState(() => personToProviderForm(selectedProvider))
  const [providerMessage, setProviderMessage] = useState('')
  const [checkInNotice, setCheckInNotice] = useState('')
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
            <h2>{providerDisplayName(selectedProvider.name)}</h2>
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
                <option key={provider.id} value={provider.id}>{providerDisplayName(provider.name)}</option>
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
            <span>Contact phone</span>
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
                <small>{patient.sourceRecordId ? 'Web chat ready' : 'No linked synthetic visit'}</small>
              </div>
              <div className="provider-patient-actions">
                {patient.sourceRecordId && (
                  <button type="button" className="quiet-button" onClick={() => onOpenPatient(patient.sourceRecordId ?? '', selectedProvider.id)}>
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
