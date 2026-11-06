"""Ask's priced models and per-call reservations, kept apart from the shared budget."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from app.ai_governance import ai_request_context
from app.config import get_settings
from app.domains.baby import ask_gate, budget, provider
from app.domains.baby.budget import (
    ASK_MAX_ATTEMPTS,
    GLOBAL_DAILY_CAP,
    MAX_RESEARCH_CALLS,
    MAX_TOOL_ROUNDS,
    OWNER_DAILY_CAP,
    AskCall,
    QuestionBudget,
    ask_upper_bound,
    reserve,
    reserve_ask,
    upper_bound,
)
from app.domains.baby.models import BabyAIAdmission
from app.domains.baby.provider import BabyProvider
from app.domains.workouts.budget import (
    AUTHORIZED_CAP_MICROUSD,
    BudgetError,
    BudgetPolicy,
    ProviderEnvelope,
    admission_upper_bound,
)
from tests import test_baby_integration as shared

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)
CALL = AskCall(model="gpt-6-luna", input_bytes=20_000, max_output_tokens=2_000)


def question(owner="owner"):
    return ai_request_context(request_id="r", user_id=owner, job_id=None, route="/api/v1/baby/chat")


def test_a_small_call_reserves_its_own_size_at_cache_write_rates():
    # 22,000 tokens at $0.125 and 2,000 at $0.50 per million.
    assert ask_upper_bound(CALL) == 2750 + 1000


def test_each_search_adds_its_call_fee_and_a_context_of_results():
    searched = AskCall(model="gpt-6-luna", input_bytes=1_000, max_output_tokens=2_000, searches=2)
    # Three 128,000-token turns cross long-context pricing; retain both search fees.
    assert ask_upper_bound(searched) == 96_000 + 1500 + 20_000


@pytest.mark.parametrize(
    ("model", "code"),
    [
        ("unpriced-fixture-model", "workouts_ai_model_unpriced"),
        ("gpt-5.6-luna", "workouts_ai_model_unpriced"),
        ("claude-haiku-5-5", "workouts_ai_model_unpriced"),
    ],
)
def test_a_model_off_the_ask_list_fails_closed(model, code):
    with pytest.raises(BudgetError) as failure:
        ask_upper_bound(AskCall(model=model, input_bytes=1, max_output_tokens=1))
    assert failure.value.code == code


@pytest.mark.parametrize(
    "change",
    [
        {"endpoint": "chat_completions"},
        {"service_tier": "priority"},
        {"sdk_max_retries": 2},
        {"max_output_tokens": 0},
        {"max_output_tokens": 8_001},
        {"searches": 3},
        {"input_bytes": 271_000},
    ],
)
def test_a_call_shape_the_prices_do_not_bound_is_refused(change):
    values = {"model": "gpt-6-luna", "input_bytes": 1_000, "max_output_tokens": 100, **change}
    with pytest.raises(BudgetError) as failure:
        ask_upper_bound(AskCall(**values))
    assert failure.value.code == "workouts_ai_envelope_unsupported"


def test_a_question_stops_after_five_tool_rounds_and_one_answer():
    count = QuestionBudget()
    for _ in range(MAX_TOOL_ROUNDS):
        assert count.tools_allowed
        count.start_round()
    assert not count.tools_allowed
    count.start_round()
    with pytest.raises(BudgetError):
        count.start_round()


def test_a_question_cannot_research_without_end():
    count = QuestionBudget()
    for _ in range(MAX_RESEARCH_CALLS):
        count.start_research()
    with pytest.raises(BudgetError):
        count.start_research()


def test_workouts_still_refuses_the_new_models():
    envelope = ProviderEnvelope(endpoint="chat_completions", max_output_tokens=100)
    policy = BudgetPolicy(
        enabled=True, budget_24h_microusd=min(GLOBAL_DAILY_CAP, AUTHORIZED_CAP_MICROUSD),
        model_pricing=get_settings().ai_model_pricing,
    )
    for model in budget.BABY_MODEL_PRICES:
        with pytest.raises(BudgetError) as failure:
            admission_upper_bound("workout_extraction", model, envelope, policy)
        assert failure.value.code == "workouts_ai_model_unpriced"


def test_the_existing_path_keeps_its_amount_and_its_model_list():
    # Whole context at $0.20 x 2.5 and 2,400 output at $1.20 x 1.5.
    assert upper_bound("baby_chat", "gpt-5.6-luna") == 525_000 + 4_320
    # With the flag off, a new model is still refused here, exactly as before Ask V2 existed.
    for model in (*budget.BABY_MODEL_PRICES, "unpriced-fixture-model"):
        with pytest.raises(BudgetError) as failure:
            upper_bound("baby_chat", model)
        assert failure.value.code == "workouts_ai_model_unpriced"


def test_usage_can_price_every_listed_model():
    assert set(budget.BABY_MODEL_PRICES) <= set(get_settings().ai_model_pricing)


async def test_a_withdrawn_gate_stops_before_and_after_the_reservation(monkeypatch):
    monkeypatch.setattr(BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(
        provider, "get_settings",
        lambda: type("S", (), {"is_ai_capability_enabled": staticmethod(lambda _: True)})(),
    )
    reserved = AsyncMock()
    monkeypatch.setattr(provider, "reserve_ask", reserved)
    order = []

    async def gate():
        order.append(reserved.await_count)
        if len(order) == 2:
            raise PermissionError

    with pytest.raises(PermissionError):
        await BabyProvider(gate=gate).admit_ask_call("baby_ask", CALL)
    assert order == [0, 1]


async def test_budget_refusal_keeps_only_the_safe_class(monkeypatch):
    monkeypatch.setattr(BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(
        provider, "get_settings",
        lambda: type("S", (), {"is_ai_capability_enabled": staticmethod(lambda _: True)})(),
    )
    monkeypatch.setattr(
        provider, "reserve_ask", AsyncMock(side_effect=BudgetError("workouts_ai_budget_exceeded"))
    )
    baby = BabyProvider()
    with pytest.raises(BudgetError):
        await baby.admit_ask_call("baby_ask", CALL)
    assert baby.budget_error.code == "workouts_ai_budget_exceeded"


async def consented(baby_api, monkeypatch, owner="owner"):
    monkeypatch.setattr(budget, "AsyncSessionLocal", baby_api.sessions)
    headers = {**shared.GEN, "X-Test-Owner": owner}
    assert (await baby_api.client.post("/api/v1/baby/bootstrap", headers={"X-Test-Owner": owner})).status_code == 200
    monkeypatch.setattr(ask_gate, "get_settings", lambda: type("S", (), {"baby_ask_v2_enabled": True})())
    body = {"ai_consent": True, "acknowledge_ai_consent_version": ask_gate.ASK_CONSENT_VERSION}
    assert (await baby_api.client.patch("/api/v1/baby/profile", headers=headers, json=body)).status_code == 200


async def admissions(baby_api):
    async with baby_api.sessions() as db:
        return list(await db.scalars(select(BabyAIAdmission).order_by(BabyAIAdmission.created_at)))


@needs_database
async def test_each_call_reserves_a_row_under_its_capability(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    with question():
        await reserve_ask("baby_ask", CALL)
        await reserve_ask("baby_research", AskCall("gpt-6-luna", 500, 1_000, searches=1))
    rows = await admissions(baby_api)
    assert [(row.app_user_id, row.capability) for row in rows] == [
        ("owner", "baby_ask"), ("owner", "baby_research"),
    ]
    assert rows[0].reserved_microusd == ask_upper_bound(CALL)


@needs_database
async def test_no_consent_reserves_nothing(baby_api, monkeypatch):
    monkeypatch.setattr(budget, "AsyncSessionLocal", baby_api.sessions)
    with question(), pytest.raises(BudgetError):
        await reserve_ask("baby_ask", CALL)
    assert await admissions(baby_api) == []


@needs_database
@pytest.mark.parametrize("capability", ["baby_chat", "not_a_capability"])
async def test_only_ask_capabilities_use_the_ask_ledger(baby_api, monkeypatch, capability):
    await consented(baby_api, monkeypatch)
    with question(), pytest.raises(BudgetError):
        await reserve_ask(capability, CALL)
    assert await admissions(baby_api) == []


@needs_database
async def test_one_persons_ask_limit_leaves_the_other_alone(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    await consented(baby_api, monkeypatch, "other")
    async with baby_api.sessions() as db:
        db.add(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_ask",
                               reserved_microusd=OWNER_DAILY_CAP))
        await db.commit()
    with question(), pytest.raises(BudgetError) as failure:
        await reserve_ask("baby_ask", CALL)
    assert failure.value.code == "workouts_ai_budget_exceeded"
    with question("other"):
        await reserve_ask("baby_ask", CALL)


@needs_database
async def test_global_spend_includes_erased_accounts(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    async with baby_api.sessions() as db:
        db.add(BabyAIAdmission(app_user_id=None, generation=1, capability="baby_ask",
                               reserved_microusd=GLOBAL_DAILY_CAP))
        await db.commit()
    with question(), pytest.raises(BudgetError) as failure:
        await reserve_ask("baby_ask", CALL)
    assert failure.value.code == "workouts_ai_budget_exceeded"


@needs_database
async def test_the_attempt_limit_counts_only_ask_calls(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    async with baby_api.sessions() as db:
        db.add_all(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_ask",
                                   reserved_microusd=1) for _ in range(ASK_MAX_ATTEMPTS))
        await db.commit()
    with question(), pytest.raises(BudgetError):
        await reserve_ask("baby_ask", CALL)
    with question():
        await reserve("baby_chat", "gpt-5.6-luna")


@needs_database
async def test_dollars_are_one_ceiling_per_person_across_every_baby_capability(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    async with baby_api.sessions() as db:
        db.add(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_chat",
                               reserved_microusd=OWNER_DAILY_CAP))
        await db.commit()
    with question(), pytest.raises(BudgetError) as failure:
        await reserve_ask("baby_ask", CALL)
    assert failure.value.code == "workouts_ai_budget_exceeded"
    with question(), pytest.raises(BudgetError):
        await reserve("baby_chat", "gpt-5.6-luna")


@needs_database
async def test_ask_spending_counts_against_the_existing_path_too(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    async with baby_api.sessions() as db:
        db.add(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_ask",
                               reserved_microusd=OWNER_DAILY_CAP))
        await db.commit()
    with question(), pytest.raises(BudgetError) as failure:
        await reserve("baby_chat", "gpt-5.6-luna")
    assert failure.value.code == "workouts_ai_budget_exceeded"


@needs_database
@pytest.mark.parametrize("capability", ["baby_ask", "baby_chat", "baby_extraction", "baby_transcription"])
async def test_the_global_ceiling_is_one_across_every_capability_and_erased_accounts(baby_api, monkeypatch, capability):
    await consented(baby_api, monkeypatch)
    async with baby_api.sessions() as db:
        db.add(BabyAIAdmission(app_user_id=None, generation=1, capability=capability,
                               reserved_microusd=GLOBAL_DAILY_CAP))
        await db.commit()
    with question(), pytest.raises(BudgetError):
        await reserve_ask("baby_ask", CALL)
    with question(), pytest.raises(BudgetError):
        await reserve("baby_chat", "gpt-5.6-luna")


@needs_database
async def test_attempt_counters_stay_separate(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    async with baby_api.sessions() as db:
        db.add_all(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_chat",
                                   reserved_microusd=1) for _ in range(budget.MAX_ATTEMPTS))
        await db.commit()
    with question():
        await reserve_ask("baby_ask", CALL)
    with question(), pytest.raises(BudgetError):
        await reserve("baby_chat", "gpt-5.6-luna")


@needs_database
async def test_twelve_at_once_for_the_last_of_the_ceiling_admit_exactly_one(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    amount = ask_upper_bound(CALL)
    async with baby_api.sessions() as db:
        db.add(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_chat",
                               reserved_microusd=OWNER_DAILY_CAP - amount))
        await db.commit()

    async def one():
        with question():
            try:
                await reserve_ask("baby_ask", CALL)
                return True
            except BudgetError:
                return False

    assert sum(await asyncio.gather(*(one() for _ in range(12)))) == 1
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.sum(BabyAIAdmission.reserved_microusd))) == OWNER_DAILY_CAP


def test_the_ceilings_are_six_dollars_a_person_and_ten_overall():
    assert (budget.OWNER_DAILY_CAP, budget.GLOBAL_DAILY_CAP) == (6_000_000, 10_000_000)


def test_import_reserves_its_actual_text_image_and_output_envelope():
    # 7000 text/framing + 5*3001 bounded high-detail image tokens, with the
    # existing 2.5x/1.5x headroom, including all 6000 requested output tokens.
    amount = upper_bound("baby_extraction", "gpt-5.6-luna", input_bytes=5000,
                         image_count=5, max_output_tokens=6000)
    assert amount == 21803 and amount < 535800
    assert upper_bound("baby_extraction", "gpt-5.6-luna", input_bytes=5000,
                       image_count=5, max_output_tokens=2400) < amount
    with pytest.raises(BudgetError):
        upper_bound("baby_extraction", "unknown", input_bytes=1)


@needs_database
async def test_metered_import_settles_actual_cost_and_keeps_attempt(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    with question():
        ticket = await reserve("baby_extraction", "gpt-5.6-luna", input_bytes=5000,
                               image_count=5, max_output_tokens=6000)
    usage = {"usage":{"prompt_tokens":3000, "completion_tokens":1000,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0}}}
    await budget.settle(ticket, usage)
    await budget.settle(ticket, usage)  # delivery/re-entry does not double-charge
    rows = await admissions(baby_api)
    assert len(rows) == 1 and rows[0].reserved_microusd == 1800
    assert rows[0].capability == "baby_extraction"
    # Ask uses the very same aggregate after the released reservation.
    with question():
        await reserve_ask("baby_ask", CALL)
    assert len(await admissions(baby_api)) == 2


@needs_database
@pytest.mark.parametrize("usage", [None, {}, {"usage":{"prompt_tokens":1000}},
    {"usage":{"prompt_tokens":True,"completion_tokens":1}},
    {"usage":{"prompt_tokens":1,"completion_tokens":-1}},
    {"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":2}}}])
async def test_unmetered_or_invalid_usage_keeps_entire_reservation(baby_api, monkeypatch, usage):
    await consented(baby_api, monkeypatch)
    with question():
        ticket = await reserve("baby_extraction", "gpt-5.6-luna", input_bytes=5000,
                               image_count=5, max_output_tokens=6000)
    await budget.settle(ticket, usage)
    assert (await admissions(baby_api))[0].reserved_microusd == ticket.amount


@needs_database
async def test_unexpected_overrun_is_charged_and_stops_the_call(baby_api, monkeypatch):
    await consented(baby_api, monkeypatch)
    with question():
        ticket = await reserve("baby_extraction", "gpt-5.6-luna", input_bytes=1, max_output_tokens=1)
    with pytest.raises(BudgetError, match="workouts_ai_usage_invalid"):
        await budget.settle(ticket, {"usage":{"prompt_tokens":1000000,"completion_tokens":1}})
    assert (await admissions(baby_api))[0].reserved_microusd > ticket.amount


def test_the_safety_check_counts_as_ask_in_budget_and_attempts():
    # Two checks on top of up to five tool rounds and a final answer, for fifty questions a day.
    assert "baby_safety" in budget.ASK_CAPABILITIES and budget.ASK_MAX_ATTEMPTS == 400

@needs_database
@pytest.mark.parametrize("details,input_tokens,output_tokens,expected",[
    ({"cached_tokens":1000,"cache_write_tokens":1500},3000,100,615),
    ({"cached_tokens":1000},3000,100,640),
    ({"cached_tokens":50000,"cache_write_tokens":100000},300000,1000,113800),
])
async def test_settlement_prices_cached_writes_and_long_context(baby_api,monkeypatch,details,input_tokens,output_tokens,expected):
    await consented(baby_api,monkeypatch)
    with question():
        ticket=await reserve("baby_extraction","gpt-5.6-luna",input_bytes=input_tokens,max_output_tokens=6000)
    await budget.settle(ticket,{"usage":{"prompt_tokens":input_tokens,"completion_tokens":output_tokens,"prompt_tokens_details":details}})
    assert (await admissions(baby_api))[0].reserved_microusd==expected


@needs_database
async def test_stale_low_price_configuration_cannot_release_below_published_floor(baby_api,monkeypatch):
    await consented(baby_api,monkeypatch)
    with question():
        ticket=await reserve("baby_extraction","gpt-5.6-luna",input_bytes=5000,max_output_tokens=6000)
    configured=get_settings().model_copy(update={"ai_model_pricing":{"gpt-5.6-luna":{
        "input_per_million":.001,"output_per_million":.001,"cached_input_per_million":0}}})
    monkeypatch.setattr(budget,"get_settings",lambda:configured)
    await budget.settle(ticket,{"usage":{"prompt_tokens":3000,"completion_tokens":1000,"prompt_tokens_details":{"cache_write_tokens":0}}})
    assert (await admissions(baby_api))[0].reserved_microusd==1800
