"""The new Ask's calls through a provider's passing 429 or 5xx. No paid call: a local stub answers at the HTTP layer."""

import httpx
import pytest
from sqlalchemy import select

from app.domains.baby.models import BabyAIAdmission
from tests import test_baby_integration as shared
from tests.test_baby_ask_v2 import answered, ask, enable, stub  # noqa: F401

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


@pytest.mark.parametrize("status", [429, 500, 502, 503])
async def test_a_passing_failure_on_the_answer_is_tried_again(baby_api, stub, status):  # noqa: F811
    await enable(baby_api)
    stub.replies = [httpx.Response(status, text="busy"), answered("Came through")]
    result = await ask(baby_api)
    assert result.status_code == 200 and result.json()["message"] == "Came through"
    assert len(stub.sent) == 2
    async with baby_api.sessions() as db:
        kept = list(await db.scalars(select(BabyAIAdmission).where(BabyAIAdmission.capability == "baby_ask")))
    assert len(kept) == 2  # A retry can't get round the ceilings.


async def test_three_failures_on_the_answer_end_it(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [httpx.Response(503, text="busy") for _ in range(3)] + [answered("Too late")]
    assert (await ask(baby_api)).status_code == 503
    assert len(stub.sent) == 3


async def test_the_provider_refusing_the_answer_is_not_tried_again(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [httpx.Response(400, text="bad"), answered("Too late")]
    assert (await ask(baby_api)).status_code == 503
    assert len(stub.sent) == 1


async def test_a_search_that_fails_is_not_tried_again(baby_api, stub):  # noqa: F811
    from tests.test_baby_ask_research import post_question, research_bodies, research_call

    await enable(baby_api)
    stub.replies = [research_call(), httpx.Response(503, text="down"), answered("Here is what your entries say.")]
    result = await post_question(baby_api, "How should babies sleep?")
    assert result.json()["message"].startswith("Here is what your entries say.")
    assert len(research_bodies(stub)) == 1


def passing_failures(fake, *statuses):
    """The check says these first, and then its usual answer."""
    remaining, real = list(statuses), fake.check_reply

    def reply(body):
        if remaining:
            fake.checks.append(body)
            return httpx.Response(remaining.pop(0), text="busy")
        return real(body)

    fake.check_reply = reply


@pytest.mark.parametrize("statuses", [(503,), (429,), (500, 502)])
async def test_a_passing_failure_on_the_check_is_tried_again(baby_api, stub, statuses):  # noqa: F811
    await enable(baby_api)
    passing_failures(stub, *statuses)
    response = await ask(baby_api, message="Please tell me about this")
    assert response.status_code == 200 and response.json()["message"] == "Stub answer"
    assert len(stub.checks) == len(statuses) + 2  # Those tries, and then the question and the answer.


async def test_three_failures_on_the_check_still_mean_no_answer(baby_api, stub):  # noqa: F811
    from app.domains.baby.ask_safety import CANT_ANSWER

    await enable(baby_api)
    passing_failures(stub, 503, 503, 503)
    body = (await ask(baby_api, message="Please tell me about this")).json()
    assert body["help"] == CANT_ANSWER and stub.sent == [] and len(stub.checks) == 3


async def test_the_tries_all_fit_inside_the_checks_time_limit(baby_api, stub, monkeypatch):  # noqa: F811
    from app.domains.baby import ask_check, provider
    from app.domains.baby.ask_safety import CANT_ANSWER

    await enable(baby_api)
    monkeypatch.setattr(ask_check, "CHECK_SECONDS", 0.05)
    monkeypatch.setattr(provider, "RETRY_DELAYS", (5, 5))
    passing_failures(stub, 503)
    body = (await ask(baby_api, message="Please tell me about this")).json()
    assert body["help"] == CANT_ANSWER and stub.sent == []
