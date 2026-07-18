from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    RunContext,
    TurnHandlingOptions,
    cli,
    function_tool,
    inference,
    room_io,
)
from livekit.plugins import ai_coustics, anthropic, elevenlabs

from .backend import BackendClient
from .prompt import build_instructions

logger = logging.getLogger("abby-agent")
load_dotenv(".env.local")


class AbbyAgent(Agent):
    def __init__(self, backend: BackendClient, trusted_context: dict) -> None:
        self.backend = backend
        super().__init__(
            llm=anthropic.LLM(
                model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
                temperature=0.2,
                parallel_tool_calls=False,
            ),
            instructions=build_instructions(trusted_context),
        )

    @function_tool
    async def record_patient_question(self, context: RunContext, question: str) -> str:
        """Record a question the approved care context cannot answer."""
        del context
        await self.backend.record_event("patient_question", question)
        return "The question was securely recorded for the care team."

    @function_tool
    async def record_teach_back(self, context: RunContext, patient_summary: str) -> str:
        """Record the patient's explanation after a teach-back question."""
        del context
        await self.backend.record_event("teach_back", patient_summary)
        return "The patient's explanation was recorded."

    @function_tool
    async def execute_approved_action(
        self, context: RunContext, action_id: str, input_summary: str
    ) -> str:
        """Execute an action using its exact approved care-plan identifier."""
        del context
        result = await self.backend.execute_action(action_id, {"summary": input_summary})
        receipt_mode = result.get("receipt", {}).get("mode", "unknown")
        return f"The approved action returned status {receipt_mode}."

    @function_tool
    async def escalate_concern(
        self, context: RunContext, escalation_rule_id: str, patient_message: str
    ) -> str:
        """Escalate through an exact rule identifier in the approved care plan."""
        del context
        await self.backend.record_event("escalation", patient_message, escalation_rule_id)
        return "The concern was escalated to the care team under the approved rule."


server = AgentServer()


@server.rtc_session(agent_name="abby-care-agent")
async def abby_care_agent(ctx: JobContext):
    try:
        metadata = json.loads(getattr(ctx.job, "metadata", "") or "{}")
        care_id = metadata["careId"]
        session_id = metadata["sessionId"]
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        logger.error("Agent dispatch metadata is missing required identifiers")
        raise RuntimeError("invalid agent dispatch metadata") from error

    backend = BackendClient(care_id, session_id)
    trusted_context = await backend.get_context()
    ctx.log_context_fields = {
        "room": ctx.room.name,
        "care_id": care_id,
        "session_id": session_id,
        "workflow": trusted_context.get("workflow", "unknown"),
    }

    session = AgentSession(
        stt=elevenlabs.STT(
            model_id="scribe_v2_realtime", language_code="en", enable_logging=False
        ),
        tts=elevenlabs.TTS(
            model="eleven_flash_v2_5",
            voice_id=os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),
            language="en",
            enable_logging=False,
        ),
        turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector()),
        preemptive_generation=True,
    )
    await session.start(
        agent=AbbyAgent(backend, trusted_context),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=ai_coustics.audio_enhancement(
                    model=ai_coustics.EnhancerModel.QUAIL_VF_S
                )
            )
        ),
    )
    await ctx.connect()
    session.generate_reply(
        instructions=(
            "Greet the patient briefly and explain that you follow the "
            "clinician-approved care plan."
        )
    )


if __name__ == "__main__":
    cli.run_app(server)
