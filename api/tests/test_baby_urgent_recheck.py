"""Independent reviewer probes: exact shipped replies on the floor and both Ask paths.

The original three probe files contain 147 distinct phrases; the report adds
named-child and control phrasings. Expected tiers follow AAP, fetched 2026-11-07.
Poison support is supplied by the held health-release PR, not the hotfix base.
"""
import json
from pathlib import Path
from uuid import uuid4

import pytest

from app.domains.baby import ask_check, ask_safety, provider
from tests import test_baby_integration as shared
from tests.test_baby_mixed_urgent import BABY_911, BABY_DOCTOR, BABY_ER, HEADERS, MATERNAL

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
CASES = json.loads(Path(__file__).with_name("baby_urgent_recheck_cases.json").read_text())["cases"]
STRINGS = {"baby_emergency": BABY_911, "baby_er": BABY_ER, "baby_unwell": BABY_DOCTOR,
           "urgent_maternal": MATERNAL, "none": None}
for baby in ("baby_emergency", "baby_er", "baby_unwell"):
    STRINGS["maternal_" + baby] = "\n\n".join((STRINGS[baby], MATERNAL) if baby == "baby_emergency" else (MATERNAL, STRINGS[baby]))


def expected(row):
    route = row["route"]
    if route in {"poisoning", "maternal_poisoning", "maternal_baby_emergency_poisoning"}:
        poison = ask_safety.MESSAGES[ask_safety.POISONING]
        return poison if route == "poisoning" else (
            MATERNAL + "\n\n" + poison if route == "maternal_poisoning" else STRINGS["maternal_baby_emergency"] + "\n\n" + poison
        )
    return STRINGS[route]


@pytest.mark.parametrize("row", CASES, ids=lambda row: row["question"])
def test_independent_recheck_table_exact_shipped_string(row):
    result = ask_safety.classify(row["question"], child_names=("Kai", "Nene"))
    assert (result.message if result else None) == expected(row)


@needs_database
@pytest.mark.parametrize("v2", [False, True])
@pytest.mark.parametrize("row", [row for row in CASES if row["route"] != "none"], ids=lambda row: row["question"])
async def test_recheck_urgent_table_on_both_actual_ask_paths(baby_api, monkeypatch, v2, row):
    wanted = expected(row)
    if "kai" in row["question"].lower():
        created = await baby_api.client.post("/api/v1/baby/children", headers=HEADERS, json={"id": str(uuid4()), "name": "Kai"})
        assert created.status_code == 200, created.text
    monkeypatch.setattr(provider.BabyProvider, "enabled", property(lambda _: False))
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS,
        json={"request_id": str(uuid4()), "message": row["question"], "ask_v2": v2})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["message"] == wanted
    assert body["citations"] == [] and body["proposal"] is None
    saved = await baby_api.client.get(f"/api/v1/baby/conversations/{body['conversation_id']}", headers=HEADERS)
    assert saved.json()["messages"][-1]["content"] == wanted


async def test_all_actual_model_prompts_include_the_same_aap_tiers(monkeypatch):
    captured = {}
    async def fake_json(self, **kwargs):
        captured.update(kwargs)
        return provider.AnswerOutput(message="Your saved entry.")
    monkeypatch.setattr(provider.BabyProvider, "json_call", fake_json)
    await provider.BabyProvider().answer(message="What did I save?", context=[], history=[], now_local="2026-11-07T12:00:00+10:00")
    for prompt in (captured["instructions"], ask_check.QUESTION_PROMPT, ask_safety.SAFETY_RULES):
        assert ask_safety.BABY_ROUTING_RULE in prompt
        assert "passed out" in prompt and "seizure lasting 5 minutes" in prompt
        assert "any trouble breathing in a baby under 1 year" in prompt
        assert "threw up green" in prompt
