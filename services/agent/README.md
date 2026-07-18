# Abby LiveKit voice worker

The voice worker is based on LiveKit's Python Agent Starter. It uses Claude for
reasoning, ElevenLabs Scribe for realtime transcription, ElevenLabs Flash for
speech, and LiveKit for low-latency media and interruption handling.

The room dispatch contains only care/session identifiers. The worker retrieves
the trusted, clinician-approved plan from the Abby API before speaking.

```bash
cp .env.example .env.local
uv sync
uv run python -m abby_agent.agent download-files
uv run python -m abby_agent.agent dev
```
