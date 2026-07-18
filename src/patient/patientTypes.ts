export type PatientWorkflow = 'pre_visit_intake' | 'post_visit_followthrough'

export type PatientPlan = {
  workflow: PatientWorkflow
  patientFirstName: string
  providerName: string
  visitTitle: string
  visitDate: string
  approvedBy?: string
  approvedAt?: string
  facts: string[]
  education: Array<{ id: string; title: string; content: string }>
  allowedActions: Array<{ id: string; type: string; label: string; instructions: string }>
  escalationRules: Array<{ id: string; severity: string; trigger: string; patientMessage: string }>
  openingMessage: string
  suggestedReplies: string[]
  history?: PatientMessage[]
}

export type PatientMessage = {
  id: string
  sender: 'patient' | 'abby'
  content: string
  timestamp: string
}

export type PatientBootstrap = {
  careId: string
  providerName: string
  practiceName: string
  visitTitle: string
  phoneHint: string
  verificationMode: 'sms' | 'demo'
}

export type VoiceConnection = {
  serverUrl: string
  roomName: string
  participantToken: string
  sessionId: string
  workflow: PatientWorkflow
}
