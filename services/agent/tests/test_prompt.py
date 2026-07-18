from abby_agent.prompt import build_instructions


def test_prompt_contains_the_clinical_boundary() -> None:
    prompt = build_instructions(
        {
            "workflow": "post_visit_followthrough",
            "providerName": "Dr. Test",
            "facts": ["Approved fact"],
            "allowedActions": [],
            "escalationRules": [],
        }
    )
    assert "Never diagnose" in prompt
    assert "Approved fact" in prompt
    assert "Dr. Test" in prompt
