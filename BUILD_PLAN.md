# Abby Implementation Plan

## Product Direction

Abby is the patient-state agent for Abridge: it reads chart context, interviews the patient, writes structured FHIR-backed updates, prepares an action-oriented provider brief, coordinates approved next steps through tools, and evaluates every run against known synthetic cases.

## Phase 1: Hackathon Spine

- Load the Abridge synthetic ambient/FHIR dataset locally.
- Build transcript-derived synthetic patient actors.
- Generate a structured patient-state bundle with `QuestionnaireResponse`, `Observation`, `Communication`, `Task`, and `Provenance`.
- Show a provider Action Brief focused on changes, decisions, open questions, and note-ready text.
- Add mocked tool actions for FHIR write-back, Twilio/Verify, scheduling, and safety review.
- Add an eval dashboard that scores completeness, escalation, provenance, and unsupported facts.
- Add a run lifecycle: queued outreach, verified intake, Action Brief ready, clinician approved, approved tools executed.
- Persist demo runs locally and allow FHIR Bundle JSON export for handoff/review.

## Phase 2: Real Agent Runtime

- Replace deterministic mock derivation with Claude-backed patient actor and Abby interviewer.
- Store the Anthropic key only in secrets as `ANTHROPIC_API_KEY`.
- Store ElevenLabs voice config as `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`.
- Add dedicated Abby Twilio Verify service variables instead of reusing BEAMIT or Health Ally services.
- Persist runs to Google Cloud Firestore with FHIR Bundle versioning and provenance.

## Phase 3: Tool Integration

- Read chart context through FHIR APIs or an EHR sandbox.
- Write generated patient-state resources only after clinician approval.
- Trigger scheduling recommendations after provider approval.
- Keep prior authorization as roadmap: gather missing data first, automate payer portals later.

## Phase 4: Evaluation and Safety

- Create expected outputs for every synthetic case.
- Score red flag detection, escalation/no-escalation, FHIR resource quality, provider brief quality, and hallucination resistance.
- Block autonomous write-back for high-risk or low-confidence outputs.
- Keep an audit log of every answer, source, generated resource, and approving clinician.
