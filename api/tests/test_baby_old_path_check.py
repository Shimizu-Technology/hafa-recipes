"""Builds 34-36 use the old path. They get the question check, and read exactly these fields. No paid call."""

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.domains.baby import ask_check
from app.domains.baby.ask_safety import (
    BABY_UNWELL,
    CANT_ANSWER,
    CHECK_FAILED,
    HARM,
    MESSAGES,
    URGENT_MATERNAL,
    cant_answer,
    classify,
)
from app.domains.baby.budget import AskCall, ask_upper_bound
from app.domains.baby.models import BabyAIAdmission
from app.domains.workouts.budget import BudgetError
from app.models.ai import AIInvocation
from tests import test_baby_integration as shared
from tests.test_baby_ask_v2 import HEADERS, enable, stub  # noqa: F401

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
CHAT = "/api/v1/baby/chat"
# What these builds read from a reply, and from a reopened chat. Each reads nothing else.
OLD_FIELDS = {"conversation_id", "message", "citations", "proposal"}


async def old_headers(baby_api, client):
    """As each build sends them: 32 has no header, 34 and 35 say 2, and 36 says 3 with its personal space when family is on."""
    headers = {key: value for key, value in HEADERS.items() if key != "X-Baby-Client"}
    if client:
        headers["X-Baby-Client"] = client
    if client == "3" and baby_api.settings.baby_family_enabled:
        boot = await baby_api.client.get("/api/v1/baby/bootstrap", headers=headers)
        headers["X-Baby-Space"] = boot.json()["personal_space_id"]
    return headers


async def old_question(baby_api, message="She has seemed off all day", headers=HEADERS, **fields):
    return await baby_api.client.post(CHAT, headers=headers, json={"request_id": str(uuid4()), "message": message, **fields})


@pytest.fixture
async def flag_off(baby_api, stub):  # noqa: F811
    stub.settings.baby_ask_v2_enabled = False
    await enable(baby_api, acknowledge=False)
    return stub


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_an_urgent_verdict_reaches_old_builds_as_the_fixed_reply(baby_api, flag_off, client):
    flag_off.question_verdict = {"urgent": "baby_unwell"}
    headers = await old_headers(baby_api, client)
    response = await old_question(baby_api, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["message"] == MESSAGES[BABY_UNWELL] and body["citations"] == [] and body["proposal"] is None and body["conversation_id"]
    assert OLD_FIELDS <= set(body) and body["help"] == BABY_UNWELL
    assert flag_off.sent == [] and len(flag_off.checks) == 1
    # It stays in the chat when she comes back to it.
    history = (await baby_api.client.get(f"/api/v1/baby/conversations/{body['conversation_id']}", headers=headers)).json()
    assert [(item["role"], item["content"]) for item in history["messages"]] == [("user", "She has seemed off all day"), ("assistant", MESSAGES[BABY_UNWELL])]


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_no_verdict_means_no_answer_for_old_builds(baby_api, flag_off, client):
    flag_off.question_verdict = httpx.Response(500)
    response = await old_question(baby_api, headers=await old_headers(baby_api, client))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["message"] == cant_answer(CHECK_FAILED) and body["help"] == CANT_ANSWER
    assert body["citations"] == [] and body["proposal"] is None and flag_off.sent == []


@pytest.mark.parametrize("verdict", ["not json", json.dumps({"urgent": "maybe"})])
async def test_an_unreadable_verdict_means_no_answer_too(baby_api, flag_off, verdict):
    flag_off.question_verdict = verdict
    body = (await old_question(baby_api)).json()
    assert body["message"] == cant_answer(CHECK_FAILED) and flag_off.sent == []


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_an_ordinary_question_reads_as_it_always_has(baby_api, flag_off, client):
    body = (await old_question(baby_api, headers=await old_headers(baby_api, client))).json()
    assert body["message"] == "Old path answer" and set(body) == OLD_FIELDS
    assert len(flag_off.sent) == 1 and "chat/completions" in flag_off.urls[0] and len(flag_off.checks) == 1


@pytest.mark.parametrize("verdict", [{"asks_dose": True}, {"asks_diagnosis": True}])
async def test_only_urgency_changes_the_old_path(baby_api, flag_off, verdict):
    flag_off.question_verdict = verdict
    assert (await old_question(baby_api)).json()["message"] == "Old path answer"


async def test_the_old_path_checks_the_question_and_not_the_answer(baby_api, flag_off):
    await old_question(baby_api, "What should I pack?")
    assert len(flag_off.checks) == 1
    assert flag_off.checks[0]["instructions"] == ask_check.QUESTION_PROMPT
    assert json.loads(flag_off.checks[0]["input"][0]["content"]) == {"question": "What should I pack?"}
    assert flag_off.checks[0]["model"] == "gpt-6-luna" and flag_off.checks[0]["store"] is False


async def test_it_counts_on_the_ledger_and_on_the_invocation_record(baby_api, flag_off):
    await old_question(baby_api)
    async with baby_api.sessions() as db:
        rows = list(await db.scalars(select(BabyAIAdmission).order_by(BabyAIAdmission.created_at)))
        tracked = list(await db.scalars(select(AIInvocation).where(AIInvocation.capability == "baby_safety")))
    safety = [row for row in rows if row.capability == "baby_safety"]
    assert len(safety) == 1 and len(tracked) == 1
    assert 0 < safety[0].reserved_microusd < 1_000


async def test_a_retry_of_the_same_question_does_not_pay_again(baby_api, flag_off):
    flag_off.question_verdict = {"urgent": "harm"}
    request_id = str(uuid4())
    payload = {"request_id": request_id, "message": "She has seemed off all day"}
    first = await baby_api.client.post(CHAT, headers=HEADERS, json=payload)
    again = await baby_api.client.post(CHAT, headers=HEADERS, json=payload)
    assert first.json()["message"] == again.json()["message"] == MESSAGES[HARM]
    assert len(flag_off.checks) == 1


async def test_without_ai_permission_nothing_is_sent(baby_api, stub):  # noqa: F811
    stub.settings.baby_ask_v2_enabled = False
    assert (await old_question(baby_api)).status_code == 403
    assert stub.checks == [] and stub.sent == []


async def test_a_reached_limit_reads_as_the_limit_it_always_was(baby_api, flag_off, monkeypatch):
    async def full(*args, **kwargs):
        raise BudgetError("workouts_ai_budget_exceeded")

    monkeypatch.setattr("app.domains.baby.provider.reserve_ask", full)
    response = await old_question(baby_api)
    assert response.status_code == 429 and response.json()["detail"]["code"] == "baby_ai_daily_limit"
    assert flag_off.sent == []


async def test_only_this_check_is_let_through_with_the_flag_off(baby_api, flag_off):
    """Everything else on Ask's ledger still needs the flag and her acknowledgement."""
    from app.ai_governance import ai_request_context
    from app.domains.baby import budget as ledger

    await old_question(baby_api)
    async with baby_api.sessions() as db:
        owner = await db.scalar(select(BabyAIAdmission.app_user_id))
    call = AskCall(model="gpt-6-luna", input_bytes=100, max_output_tokens=100)
    with ai_request_context(request_id=str(uuid4()), user_id=owner, job_id=None, route="/test"):
        for capability in ("baby_ask", "baby_research", "baby_safety"):
            with pytest.raises(BudgetError):
                await ledger.reserve_ask(capability, call, sessions=baby_api.sessions)
        await ledger.reserve_ask("baby_safety", call, sessions=baby_api.sessions, consent_only=True)
        with pytest.raises(BudgetError):
            await ledger.reserve_ask("baby_ask", call, sessions=baby_api.sessions, consent_only=True)


def test_what_one_check_can_cost():
    prompt = len(json.dumps(ask_check.check_body(ask_check.QUESTION_PROMPT, ask_check.QuestionVerdict, {"question": "x" * 2000}, "low")).encode())
    assert ask_upper_bound(AskCall(model="gpt-6-luna", input_bytes=prompt, max_output_tokens=ask_check.CHECK_OUTPUT_TOKENS)) < 1_500


FRESH_URGENT = [
    ("28 weeks my undies keep getting wet clear water no pee smell can i wait till monday", URGENT_MATERNAL),
    ("pregnent 30 weeks face suddenly puffy pain under right ribs", URGENT_MATERNAL),
    ("31 weeks tightening every 4 minutes and back pain all afternoon", URGENT_MATERNAL),
    ("newborn 12 days old rectal 100.8 but looks okay is it fine to sleep", BABY_UNWELL),
    ("3 week old throwing up bright green stuff twice", BABY_UNWELL),
    ("6 wk baby only one wet nappy today mouth dry not drinking", BABY_UNWELL),
    ("my 1mo jerking and eyes fixed to one side wont respond", BABY_UNWELL),
    ("i shook him im scared he seems sleepy now what do i do", HARM),
    ("havent slept 4 days since birth hearing a voice saying my baby is evil", HARM),
    ("everyone would be better without me i have pills next to me", HARM),
    ("20 wks fever stiff neck confused husband says im not making sense", URGENT_MATERNAL),
]


@pytest.mark.parametrize(("message", "kind"), FRESH_URGENT)
async def test_the_reproduced_forms_are_on_the_floor_and_cost_nothing(baby_api, flag_off, message, kind):
    assert classify(message).kind == kind
    body = (await old_question(baby_api, message)).json()
    assert body["message"] == MESSAGES[kind] and body["help"] == kind
    assert flag_off.checks == [] and flag_off.sent == []


@pytest.mark.parametrize("message", ["What should I pack for the hospital?", "Is it normal for newborns to hiccup?", "How many wet diapers did I log today?",
                                     "Did I wash her with clear water?", "She is 3 weeks old today", "He shook his rattle all afternoon",
                                     "My 3 month old is not drinking from a cup yet", "Should I wet the washcloth with water?"])
def test_the_new_forms_leave_ordinary_questions_alone(message):
    assert classify(message) is None
