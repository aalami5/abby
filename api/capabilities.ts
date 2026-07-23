const capabilities = [
  {
    id: 'patient-intake',
    label: 'Transcript-grounded patient intake',
    status: 'implemented',
  },
  {
    id: 'fhir-bundle',
    label: 'FHIR Bundle generation and export',
    status: 'implemented',
  },
  {
    id: 'approval-gate',
    label: 'Clinician approval before write-back or scheduling',
    status: 'implemented',
  },
  {
    id: 'tool-ledger',
    label: 'Mock tool execution ledger',
    status: 'implemented',
  },
  {
    id: 'persistent-runs',
    label: 'Server-side run lifecycle API',
    status: 'implemented',
  },
  {
    id: 'role-directory',
    label: 'Admin, provider, and patient directory',
    status: 'implemented',
  },
  {
    id: 'phone-otp-auth',
    label: 'Web patient chat without phone verification',
    status: 'implemented',
  },
  {
    id: 'durable-storage',
    label: 'Google Cloud Firestore-ready durable run and directory storage',
    status: 'ready-for-env',
  },
  {
    id: 'real-tools',
    label: 'Claude and FHIR sandbox connectors',
    status: 'next',
  },
]

export default function handler(_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  response.status(200).json({
    service: 'abby',
    capabilities,
  })
}
