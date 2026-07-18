export type FhirResource = {
  resourceType: string
  id?: string
  status?: string
  code?: {
    text?: string
    coding?: Array<{ display?: string; code?: string }>
  }
  valueQuantity?: { value?: number; unit?: string }
  valueString?: string
  effectiveDateTime?: string
  authoredOn?: string
  description?: string
  [key: string]: unknown
}

export type EncounterRecord = {
  id: string
  metadata: {
    patient_id: string
    encounter_id: string
    date: string
    visit_title: string
    visit_type: string
    related_resource_counts: Record<string, number>
  }
  patient_context: {
    patient: {
      id: string
      name?: Array<{ family?: string; given?: string[]; prefix?: string[] }>
      gender?: string
      birthDate?: string
      address?: Array<{ city?: string; state?: string }>
    }
    longitudinal_summary: {
      resource_counts: Record<string, number>
      condition_labels: string[]
      medication_labels: string[]
    }
  }
  encounter_fhir: {
    encounter: FhirResource
    related_resources: Record<string, FhirResource[]>
  }
  transcript: string
  note: string
  after_visit_summary: string
  after_visit_summary_provenance: unknown
}

export type PatientSignal = {
  label: string
  value: string
  severity: 'low' | 'medium' | 'high'
  source: 'patient' | 'chart' | 'derived'
}

export type IntakeAnswer = {
  prompt: string
  answer: string
  mapsTo: string
}

export type RunStage = 'queued' | 'identity' | 'intake' | 'brief-ready' | 'approved' | 'executed'

export type ToolEvent = {
  id: string
  tool: 'verify' | 'twilio' | 'safety' | 'fhir' | 'scheduler' | 'eval'
  label: string
  status: 'blocked' | 'pending' | 'ready' | 'success'
  detail: string
  timestamp: string
}

export type AbbyRun = {
  id: string
  caseId: string
  stage: RunStage
  createdAt: string
  updatedAt: string
  approvedAt?: string
  approvedBy?: string
  patientChannel: 'sms' | 'voice'
  requiresApproval: boolean
  safetyHold: boolean
  followUpQueued: boolean
  writeBackComplete: boolean
  transcript: IntakeAnswer[]
  toolEvents: ToolEvent[]
}

export type AbbyCase = {
  record: EncounterRecord
  patientName: string
  age: number
  initials: string
  intake: IntakeAnswer[]
  signals: PatientSignal[]
  openQuestions: string[]
  actionItems: string[]
  fhirBundle: FhirResource
  evalScores: Array<{ metric: string; score: number; target: number }>
}

export type DirectoryRole = 'admin' | 'provider' | 'patient'

export type DirectoryPerson = {
  id: string
  name: string
  phone: string
  roles: DirectoryRole[]
  specialty?: string
  abbyInstructions?: string
  abbyInstructionsTitle?: string
  abbyInstructionsSourceFile?: string
  abbyInstructionsSourcePath?: string
  abbyInstructionsSourceUrl?: string
  abbyInstructionsAudience?: string
  primaryProviderId?: string
  gender?: string
  birthDate?: string
  city?: string
  state?: string
  visitTitle?: string
  sourceRecordId?: string
  synthetic?: boolean
  createdAt: string
  updatedAt: string
}

export type AgentInstructionReference = {
  id: string
  title: string
  sourceFile: string
  sourcePath: string
  sourceUrl: string
  audience: string
  ownerPersonId: string
  instructionField: keyof Pick<DirectoryPerson, 'abbyInstructions'>
  updatedAt: string
}

export type DirectoryResponse = {
  persistence: string
  auth: 'twilio-verify' | 'twilio-sms' | 'mock-otp'
  people: DirectoryPerson[]
  agentInstructionReferences: AgentInstructionReference[]
  counts: {
    people: number
    admins?: number
    superadmins: number
    providers: number
    patients: number
  }
  otp?: {
    mode: 'twilio-verify' | 'twilio-sms' | 'mock'
    phone: string
    demoCode?: string
  }
  session?: {
    phone: string
    roles: DirectoryRole[]
  }
}
