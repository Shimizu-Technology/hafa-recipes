"""Older chats stay on the scoped search. Everything she logs as care belongs in the Care scope."""

from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domains.baby.chat import retrieve
from app.domains.baby.schemas import ChatRequest
from tests import test_baby_integration as shared
from tests.test_baby_ask_tools import HEADERS, add

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
GUAM = ZoneInfo("Pacific/Guam")
LOGS = [
    ("pumping", {"amount": 90, "unit": "ml"}),
    ("temperature", {"value": 37.1, "unit": "c"}),
    ("growth", {"weight": 3.4, "weight_unit": "kg"}),
    ("contraction", {}),
    ("kick_session", {"count": 10}),
    ("custom", {"label": "Blood pressure"}),
]


async def scoped(baby_api, *, legacy=False, **fields):
    async with baby_api.sessions() as db:
        found, _, _ = await retrieve(db, "owner", 1, ChatRequest(request_id=uuid4(), message="What did I log?", scope="care", **fields), GUAM, legacy=legacy)
    return [row["id"] for row in found]


@pytest.mark.parametrize(("kind", "data"), LOGS)
async def test_the_care_scope_finds_every_kind_of_log(baby_api, kind, data):
    baby_api.settings.baby_new_kinds_enabled = True
    entry = await add(baby_api, HEADERS, kind=kind, title=f"A {kind} log", data=data)
    assert entry in await scoped(baby_api)


@pytest.mark.parametrize(("kind", "data"), LOGS)
async def test_a_chat_focused_on_a_log_opens_it_in_the_care_scope(baby_api, kind, data):
    baby_api.settings.baby_new_kinds_enabled = True
    entry = await add(baby_api, HEADERS, kind=kind, title=f"A {kind} log", data=data)
    assert entry in await scoped(baby_api, record_id=entry)


@pytest.mark.parametrize(("kind", "data"), LOGS)
async def test_an_old_build_still_sees_only_the_kinds_it_knows(baby_api, kind, data):
    baby_api.settings.baby_new_kinds_enabled = True
    entry = await add(baby_api, HEADERS, kind=kind, title=f"A {kind} log", data=data)
    assert entry not in await scoped(baby_api, legacy=True)


async def test_the_care_scope_still_leaves_out_saved_posts_and_the_journal(baby_api):
    post = await add(baby_api, HEADERS, kind="source", title="A post", data={"source_text": "What did I log?"})
    journal = await add(baby_api, HEADERS, kind="journal", title="Night", body="What did I log?")
    found = await scoped(baby_api)
    assert post not in found and journal not in found
