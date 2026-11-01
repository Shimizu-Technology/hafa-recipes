"""Stated timing relevance and suggested categories: the AI proposes, the user files."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from app.domains.baby import processing
from app.domains.baby.provider import ExtractionOutput
from app.domains.baby.runtime import BabyWorker, keep_user_decisions
from app.domains.baby.schemas import RecordCreate, SourceData
from tests import test_baby_integration as shared

baby_api = shared.baby_api
GEN = shared.GEN
needs_database = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)
TEA = "When you get to 37 weeks, start the pregnancy tea. Ask your provider first."


class Provider:
    enabled = True

    def __init__(self, **output):
        self.output, self.categories = output, None

    async def extract(self, source, categories=None):
        self.categories = categories
        return ExtractionOutput(title="Pregnancy tea", summary="The creator says.", **self.output)


async def organize(text, *, categories=(), **output):
    async def gate():
        pass

    provider = Provider(**output)
    result = await processing.process_capture(
        {"text": text, "categories": list(categories)},
        [],
        provider,
        may_use_ai=True,
        gate=gate,
    )
    return result, provider


async def test_stated_week_is_captured_with_its_quote():
    result, _ = await organize(
        TEA,
        relevance={
            "stage": "pregnancy",
            "pregnancy_week_min": 37,
            "pregnancy_week_max": None,
            "quote": "When you get to 37 weeks",
        },
    )
    assert result["status"] == "ready"
    assert result["data"]["relevance"] == {
        "stage": "pregnancy",
        "pregnancy_week_min": 37,
        "pregnancy_week_max": None,
        "baby_age_min_weeks": None,
        "baby_age_max_weeks": None,
        "baby_age_unit": None,
        "quote": "When you get to 37 weeks",
        "origin": "source",
    }


async def test_a_single_stated_week_applies_from_then_on():
    result, _ = await organize(
        "How I make my tea #37weekspregnant",
        relevance={
            "stage": "pregnancy",
            "pregnancy_week_min": 37,
            "pregnancy_week_max": 37,
            "quote": "#37weekspregnant",
        },
    )
    assert result["data"]["relevance"]["pregnancy_week_min"] == 37
    assert result["data"]["relevance"]["pregnancy_week_max"] is None


@pytest.mark.parametrize(
    "relevance",
    [
        None,
        # Timing the source never said: the quote is not in what was read.
        {"stage": "pregnancy", "pregnancy_week_min": 36, "quote": "From 36 weeks onward"},
        {"stage": "pregnancy", "pregnancy_week_min": 37},
        {"stage": "pregnancy", "quote": ""},
        # Stated but contentless timing stays missing.
        {"stage": None, "quote": "Ask your provider first"},
    ],
)
async def test_unstated_timing_stays_missing(relevance):
    result, _ = await organize(TEA, relevance=relevance)
    assert result["status"] == "ready"
    assert "relevance" not in result["data"]


async def test_months_trimesters_and_malformed_values():
    months, _ = await organize(
        "Tips for 0-3 months: contact naps are fine.",
        relevance={
            "stage": "baby",
            "baby_age_min": 0,
            "baby_age_max": 3,
            "baby_age_unit": "months",
            "quote": "Tips for 0-3 months",
        },
    )
    assert months["data"]["relevance"]["baby_age_min_weeks"] == 0
    assert months["data"]["relevance"]["baby_age_max_weeks"] == 13
    assert months["data"]["relevance"]["baby_age_unit"] == "months"
    trimester, _ = await organize(
        "Third-trimester stretches for back pain",
        relevance={
            "stage": "pregnancy",
            "pregnancy_week_min": 28.0,
            "pregnancy_week_max": 40,
            "quote": "third trimester",
        },
    )
    assert trimester["data"]["relevance"]["pregnancy_week_min"] == 28
    assert trimester["data"]["relevance"]["pregnancy_week_max"] == 40
    malformed, _ = await organize(
        "At 6 weeks the baby may cluster feed",
        relevance={
            "stage": "toddler",
            "pregnancy_week_min": 40,
            "pregnancy_week_max": 30,
            "baby_age_min": "six",
            "baby_age_max": 6,
            "quote": "At 6 weeks",
        },
    )
    # An age without a stated unit and reversed or invalid bounds are dropped;
    # the rest of the organized source is unaffected.
    assert malformed["status"] == "ready" and malformed["title"] == "Pregnancy tea"
    assert "relevance" not in malformed["data"]


async def test_category_suggestion_prefers_existing_categories_and_never_files():
    existing = {"id": str(uuid4()), "title": "Labor prep"}
    result, provider = await organize(
        TEA,
        categories=[existing],
        suggested_category={"name": "labor PREP", "confidence": 0.82},
    )
    assert provider.categories == ["Labor prep"]
    assert result["data"]["suggested_category"] == {
        "name": "Labor prep",
        "collection_id": existing["id"],
        "confidence": 0.82,
        "status": "pending",
    }
    fresh, _ = await organize(TEA, suggested_category={"name": "Pregnancy teas", "confidence": 1})
    assert fresh["data"]["suggested_category"]["collection_id"] is None
    for invalid in ({"name": "Teas", "confidence": 1.5}, {"name": " ", "confidence": 0.5}, "Teas"):
        dropped, _ = await organize(TEA, suggested_category=invalid)
        assert "suggested_category" not in dropped["data"]


def test_old_payloads_and_hashes_are_unchanged():
    data = {"url": "https://example.com/a", "topics": ["Sleep"], "status": "saved"}
    record = RecordCreate(
        kind="source", title="Saved", occurred_at=datetime.now(UTC), data=data
    )
    assert set(record.data) == set(SourceData().model_dump(mode="json")) - {
        "key_points", "steps", "creator", "platform", "thumbnail_url",
    }
    assert "relevance" not in record.data and "suggested_category" not in record.data
    with pytest.raises(ValidationError):
        SourceData(relevance={"pregnancy_week_min": 38, "pregnancy_week_max": 30})
    with pytest.raises(ValidationError):
        SourceData(relevance={"pregnancy_week_min": "37"})
    assert SourceData(relevance={"origin": "user"}).relevance is None


def test_reprocessing_keeps_user_timing_and_decided_suggestions():
    organized = {
        "relevance": {"stage": "baby"},
        "suggested_category": {"name": "Sleep", "confidence": 0.5, "status": "pending"},
        "summary": "New",
    }
    assert keep_user_decisions({}, organized) == organized
    kept = keep_user_decisions(
        {
            "relevance": {"stage": "pregnancy", "origin": "user"},
            "suggested_category": {"name": "Feeding", "status": "dismissed"},
        },
        organized,
    )
    assert kept == {"summary": "New"}


def source(title, relevance=None, **data):
    return shared.payload(
        "source",
        title=title,
        data={**data, **({"relevance": relevance} if relevance else {})},
    )


async def create(c, body, owner="owner"):
    response = await c.post(
        "/api/v1/baby/records", headers={**GEN, "X-Test-Owner": owner}, json=body
    )
    assert response.status_code == 200, response.text
    return response.json()


async def titles(c, **params):
    response = await c.get("/api/v1/baby/records", params={"limit": 100, **params})
    assert response.status_code == 200, response.text
    return [item["title"] for item in response.json()["items"]], response.json()


@needs_database
async def test_week_and_age_boundaries(baby_api):
    c = baby_api.client
    for body in [
        source("Tea from 37", {"stage": "pregnancy", "pregnancy_week_min": 37}),
        source("Third trimester", {"pregnancy_week_min": 28, "pregnancy_week_max": 40}),
        source("Any pregnancy", {"stage": "pregnancy"}),
        source("Until 36", {"pregnancy_week_max": 36}),
        source("First three months", {"stage": "baby", "baby_age_min_weeks": 0, "baby_age_max_weeks": 13}),
        source("Six months on", {"baby_age_min_weeks": 26}),
        source("Postpartum", {"stage": "postpartum"}),
        source("No timing"),
        shared.payload("journal", title="Journal"),
    ]:
        await create(c, body)
    await create(c, source("Other owner tea", {"stage": "pregnancy"}), owner="other")
    now36, body = await titles(c, timing="now", pregnancy_week=36)
    assert sorted(now36) == ["Any pregnancy", "Third trimester", "Until 36"]
    assert body["timing"] == {"mode": "now", "stage": "pregnancy", "pregnancy_week": 36, "basis": "query"}
    now37, _ = await titles(c, timing="now", pregnancy_week=37)
    assert sorted(now37) == ["Any pregnancy", "Tea from 37", "Third trimester"]
    now27, _ = await titles(c, timing="now", pregnancy_week=27)
    assert sorted(now27) == ["Any pregnancy", "Until 36"]
    upcoming27, _ = await titles(c, timing="upcoming", pregnancy_week=27)
    assert upcoming27 == ["Third trimester", "Tea from 37"]
    assert (await titles(c, timing="upcoming", pregnancy_week=27, within_weeks=1))[0] == [
        "Third trimester"
    ]
    assert (await titles(c, timing="upcoming", pregnancy_week=36, within_weeks=1))[0] == [
        "Tea from 37"
    ]
    assert sorted((await titles(c, timing="now", baby_age_weeks=13))[0]) == [
        "First three months", "Postpartum",
    ]
    assert sorted((await titles(c, timing="now", baby_age_weeks=14))[0]) == ["Postpartum"]
    assert (await titles(c, timing="upcoming", baby_age_weeks=14))[0] == ["Six months on"]
    assert sorted((await titles(c, timing="now", baby_age_weeks=26))[0]) == [
        "Postpartum", "Six months on",
    ]
    assert sorted((await titles(c, stage="pregnancy"))[0]) == ["Any pregnancy", "Tea from 37"]
    # Old list requests are unchanged and carry no timing envelope.
    everything, plain = await titles(c)
    assert len(everything) == 9 and "timing" not in plain
    for params in (
        {"pregnancy_week": 30},
        {"timing": "now", "pregnancy_week": 30, "baby_age_weeks": 2},
        {"timing": "now", "pregnancy_week": 46},
        {"timing": "soon", "pregnancy_week": 30},
    ):
        assert (await c.get("/api/v1/baby/records", params=params)).status_code == 422


@needs_database
async def test_timing_comes_from_the_childs_due_or_birth_date(baby_api):
    c = baby_api.client
    await create(c, source("Tea from 37", {"stage": "pregnancy", "pregnancy_week_min": 37}))
    await create(c, source("Newborn", {"stage": "baby", "baby_age_max_weeks": 4}))
    no_child = await c.get("/api/v1/baby/records", params={"timing": "now"})
    assert no_child.status_code == 422
    today = datetime.now(ZoneInfo("Pacific/Guam")).date()
    child = (
        await c.post(
            "/api/v1/baby/children",
            headers=GEN,
            json={"name": "Baby", "due_date": (today + timedelta(days=39)).isoformat()},
        )
    ).json()
    upcoming, body = await titles(c, timing="upcoming")
    assert upcoming == ["Tea from 37"]
    assert body["timing"] == {
        "mode": "upcoming",
        "stage": "pregnancy",
        "pregnancy_week": 34,
        "pregnancy_day": 3,
        "child_id": child["id"],
        "basis": "child",
        "today": today.isoformat(),
    }
    born = await c.patch(
        f"/api/v1/baby/children/{child['id']}",
        headers=GEN,
        json={"revision": child["revision"], "birth_date": (today - timedelta(days=20)).isoformat()},
    )
    assert born.status_code == 200
    now, body = await titles(c, timing="now", timing_child_id=child["id"])
    assert now == ["Newborn"] and body["timing"]["baby_age_weeks"] == 2
    await c.post(
        "/api/v1/baby/children",
        headers=GEN,
        json={"name": "Second", "birth_date": "2019-05-01"},
    )
    assert (await c.get("/api/v1/baby/records", params={"timing": "now"})).status_code == 422
    other = (
        await c.post(
            "/api/v1/baby/children",
            headers={**GEN, "X-Test-Owner": "other"},
            json={"name": "Other", "due_date": today.isoformat()},
        )
    ).json()
    assert (
        await c.get(
            "/api/v1/baby/records", params={"timing": "now", "timing_child_id": other["id"]}
        )
    ).status_code == 404


@needs_database
async def test_timing_is_user_editable_and_old_clients_keep_new_fields(baby_api):
    c = baby_api.client
    suggestion = {"name": "Teas", "confidence": 0.7, "status": "pending"}
    record = await create(
        c,
        source(
            "Tea",
            {"stage": "pregnancy", "pregnancy_week_min": 37, "quote": "at 37 weeks"},
            suggested_category=suggestion,
        ),
    )
    url = f"/api/v1/baby/records/{record['id']}"
    # An older client sends only the fields it knows about.
    legacy = await c.patch(
        url,
        headers=GEN,
        json={"revision": record["revision"], "data": {"topics": ["Tea"], "status": "saved"}},
    )
    assert legacy.status_code == 200, legacy.text
    data = legacy.json()["data"]
    assert data["topics"] == ["Tea"]
    assert data["relevance"]["pregnancy_week_min"] == 37
    assert data["relevance"]["origin"] == "source"
    assert data["suggested_category"] == {**suggestion, "collection_id": None}
    echoed = await c.patch(
        url, headers=GEN, json={"revision": legacy.json()["revision"], "data": data}
    )
    assert echoed.json()["data"]["relevance"]["origin"] == "source"
    edited = await c.patch(
        url,
        headers=GEN,
        json={
            "revision": echoed.json()["revision"],
            "data": {**data, "relevance": {"stage": "pregnancy", "pregnancy_week_min": 36}},
        },
    )
    assert edited.status_code == 200
    assert edited.json()["data"]["relevance"]["pregnancy_week_min"] == 36
    assert edited.json()["data"]["relevance"]["origin"] == "user"
    cleared = await c.patch(
        url,
        headers=GEN,
        json={"revision": edited.json()["revision"], "data": {**data, "relevance": None}},
    )
    assert "relevance" not in cleared.json()["data"]
    invalid = await c.patch(
        url,
        headers=GEN,
        json={
            "revision": cleared.json()["revision"],
            "data": {**data, "relevance": {"pregnancy_week_min": 39, "pregnancy_week_max": 37}},
        },
    )
    assert invalid.status_code == 422


@needs_database
async def test_processing_suggests_but_never_files(baby_api):
    c = baby_api.client
    category = await create(
        c, shared.payload("collection", title="Labor prep", data={"record_ids": []})
    )
    provider = Provider(
        suggested_category={"name": "Labor Prep", "confidence": 0.9},
        relevance={"stage": "pregnancy", "pregnancy_week_min": 37, "quote": "at 37 weeks"},
    )

    async def processor(request, assets, _provider, **kwargs):
        return await processing.process_capture(
            request, assets, provider, may_use_ai=True, gate=kwargs["gate"]
        )

    body = {"id": str(uuid4()), "text": "Pack the hospital bag at 37 weeks."}
    created = (await c.post("/api/v1/baby/imports", headers=GEN, json=body)).json()
    assert await BabyWorker(baby_api.sessions, processor=processor).tick()
    assert provider.categories == ["Labor prep"]
    record = (await c.get(f"/api/v1/baby/records/{created['record_id']}")).json()
    assert record["data"]["suggested_category"] == {
        "name": "Labor prep",
        "collection_id": category["id"],
        "confidence": 0.9,
        "status": "pending",
    }
    assert record["data"]["relevance"]["pregnancy_week_min"] == 37
    unchanged = (await c.get(f"/api/v1/baby/records/{category['id']}")).json()
    assert unchanged["data"]["record_ids"] == [] and unchanged["revision"] == category["revision"]
    inbox, _ = await titles(c, uncategorized="true", kind="source")
    assert inbox == [record["title"]]


@needs_database
async def test_accept_bulk_accept_dismiss_and_ownership(baby_api):
    c = baby_api.client
    labor = await create(
        c, shared.payload("collection", title="Labor prep", data={"record_ids": []})
    )

    def suggested(title, name, collection_id=None):
        return source(
            title,
            suggested_category={
                "name": name,
                "confidence": 0.8,
                "collection_id": collection_id,
            },
        )

    one = await create(c, suggested("Bag list", "Labor prep", labor["id"]))
    two = await create(c, suggested("Tea", "Pregnancy teas"))
    three = await create(c, suggested("More tea", "pregnancy TEAS"))
    four = await create(c, suggested("Sleep", "Sleep"))
    plain = await create(c, source("Nothing suggested"))
    theirs = await create(c, suggested("Theirs", "Labor prep"), owner="other")

    single = await c.post(
        f"/api/v1/baby/records/{one['id']}/suggested-category",
        headers=GEN,
        json={"revision": one["revision"]},
    )
    assert single.status_code == 200, single.text
    assert single.json()["results"] == [
        {"record_id": one["id"], "status": "accepted", "collection_id": labor["id"]}
    ]
    assert single.json()["collections"][0]["data"]["record_ids"] == [one["id"]]
    assert single.json()["collections"][0]["revision"] == labor["revision"] + 1
    replay = await c.post(
        f"/api/v1/baby/records/{one['id']}/suggested-category",
        headers=GEN,
        json={"revision": one["revision"]},
    )
    assert replay.json()["results"][0]["status"] == "accepted"
    assert replay.json()["records"] == [] and replay.json()["collections"] == []

    bulk = await c.post(
        "/api/v1/baby/suggested-categories",
        headers=GEN,
        json={
            "items": [
                {"record_id": two["id"], "revision": two["revision"]},
                {"record_id": three["id"], "revision": three["revision"]},
                {"record_id": four["id"], "revision": four["revision"] + 1},
                {"record_id": plain["id"], "revision": plain["revision"]},
                {"record_id": theirs["id"], "revision": theirs["revision"]},
                {"record_id": str(uuid4()), "revision": 1},
            ]
        },
    )
    assert bulk.status_code == 200, bulk.text
    results = bulk.json()["results"]
    assert [item["status"] for item in results] == [
        "accepted", "accepted", "conflict", "no_suggestion", "unavailable", "unavailable",
    ]
    # Two sources proposing the same new name share one new category.
    assert results[0]["collection_id"] == results[1]["collection_id"]
    teas = bulk.json()["collections"]
    assert len(teas) == 1 and teas[0]["title"] == "Pregnancy teas"
    assert sorted(teas[0]["data"]["record_ids"]) == sorted([two["id"], three["id"]])
    accepted = (await c.get(f"/api/v1/baby/records/{three['id']}")).json()
    assert accepted["data"]["suggested_category"]["status"] == "accepted"
    assert accepted["data"]["suggested_category"]["name"] == "Pregnancy teas"
    assert accepted["revision"] == three["revision"] + 1

    dismissed = await c.post(
        f"/api/v1/baby/records/{four['id']}/suggested-category",
        headers=GEN,
        json={"revision": four["revision"], "action": "dismiss"},
    )
    assert dismissed.json()["results"][0]["status"] == "dismissed"
    assert dismissed.json()["collections"] == []
    inbox, _ = await titles(c, uncategorized="true", kind="source")
    assert sorted(inbox) == ["Nothing suggested", "Sleep"]
    # The other owner's source and categories are untouched.
    other = await c.get(
        f"/api/v1/baby/records/{theirs['id']}", headers={"X-Test-Owner": "other"}
    )
    assert other.json()["data"]["suggested_category"]["status"] == "pending"
    other_categories = await c.get(
        "/api/v1/baby/records", params={"kind": "collection"}, headers={"X-Test-Owner": "other"}
    )
    assert other_categories.json()["total"] == 0
    duplicate = await c.post(
        "/api/v1/baby/suggested-categories",
        headers=GEN,
        json={"items": [{"record_id": two["id"], "revision": 1}] * 2},
    )
    assert duplicate.status_code == 422
