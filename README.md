# Abby

Abby is a local hackathon prototype for a patient-state agent that sits around Abridge workflows.

The app uses the synthetic Abridge ambient/FHIR dataset to demonstrate:

- admin/operator outreach setup
- superadmin user, patient, provider, and multi-role directory setup
- phone-number OTP authentication flow with Twilio Verify-ready endpoints
- transcript-grounded patient intake
- provider Action Briefs
- FHIR-shaped patient-generated data
- mocked tool-connected workflows
- an eval harness for safety and quality gates
- clinician approval gating before write-back or scheduling
- server-side run lifecycle endpoints with browser fallback
- FHIR Bundle JSON export

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

Use `vercel dev` instead of the Vite-only command when testing the complete
patient flow locally, because OTP, Claude, and LiveKit token routes run as
Vercel Functions.

The provider portal remains at `/`. The new standalone patient experience is
available at:

```text
/care/demo-cardiovascular
```

The synthetic cardiovascular demo uses `+1 555 012 0011`. When Twilio is not
configured, the verification screen displays a one-click local demo code.

## Cloud

Current Vercel deployment:

```text
https://abby-mocha.vercel.app
```

Health and capability endpoints:

```text
https://abby-mocha.vercel.app/api/health
https://abby-mocha.vercel.app/api/capabilities
https://abby-mocha.vercel.app/api/runs
https://abby-mocha.vercel.app/api/directory
https://abby-mocha.vercel.app/api/chat
```

Run state uses the `/api/runs` lifecycle API. Superadmin people, role, patient, provider, and OTP state use `/api/directory`. Patient chat uses `/api/chat`, which calls Claude server-side. In production, the APIs use Google Cloud Firestore when the Google service-account environment variables are configured; otherwise they fall back to serverless memory, which is enough to prove the flow but not durable across cold starts.

The mobile patient app uses `/api/patient-session`, `/api/patient-context`,
`/api/patient-chat`, and `/api/livekit-token`. Its chart context is assembled on
the server and its short-lived session is bound to the care link. See
`docs/ARCHITECTURE.md` for the complete trust boundary.

## Data

The prototype reads synthetic data from:

```text
public/data/synthetic-ambient-fhir-25.json
```

No real patient data is included.

## Secrets

Use `.env.example` as the template. Do not commit real API keys.

Required for patient chat:

```text
ANTHROPIC_API_KEY
ABBY_CLAUDE_MODEL=claude-sonnet-4-6
```

`CLAUDE_API_KEY` is accepted as a fallback when `ANTHROPIC_API_KEY` is not set.

Optional Google Cloud Firestore env vars:

```text
GOOGLE_CLOUD_PROJECT
GOOGLE_CLIENT_EMAIL
GOOGLE_PRIVATE_KEY
GOOGLE_FIRESTORE_DATABASE=(default)
ABBY_FIRESTORE_COLLECTION=abby_app_state
```

Optional Twilio OTP env vars:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SERVICE_SID_ABBY
```
