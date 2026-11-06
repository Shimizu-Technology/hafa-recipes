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
