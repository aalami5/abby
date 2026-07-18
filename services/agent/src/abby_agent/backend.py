from __future__ import annotations

import os
from typing import Any

import httpx


class BackendClient:
    def __init__(self, care_id: str, session_id: str) -> None:
        self.care_id = care_id
        self.session_id = session_id
        self.base_url = os.environ["ABBY_BACKEND_INTERNAL_URL"].rstrip("/")
        self.secret = os.environ["ABBY_AGENT_SERVICE_SECRET"]

    async def _post(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{self.base_url}/api/{endpoint}",
                json={"careId": self.care_id, "sessionId": self.session_id, **payload},
                headers={"x-abby-agent-secret": self.secret},
            )
            response.raise_for_status()
            return response.json()

    async def get_context(self) -> dict[str, Any]:
        return await self._post("agent-context", {})

    async def execute_action(self, action_id: str, action_input: dict[str, Any]) -> dict[str, Any]:
        return await self._post("agent-action", {"actionId": action_id, "input": action_input})

    async def record_event(
        self, event_type: str, content: str, escalation_rule_id: str | None = None
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"type": event_type, "content": content}
        if escalation_rule_id:
            payload["escalationRuleId"] = escalation_rule_id
        return await self._post("agent-event", payload)
