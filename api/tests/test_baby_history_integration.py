"""Full-history retrieval is independent of the newest all-kind bootstrap cache."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.domains.baby.models import BabyMembership, BabyRecord
from tests import test_baby_integration as shared
from tests.test_baby_integration import GEN, payload

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)


def fixture_record(kind, index, *, owner="owner", generation=1, child_id=None):
    stamp = datetime(2026, 10, 1, tzinfo=UTC) + timedelta(minutes=index)
    return BabyRecord(
        id=uuid4(),
        app_user_id=owner,
        generation=generation,
        kind=kind,
        title=f"{kind} {index}",
        body="Old hospital note",
        data={},
        revision=1,
        creation_hash="a" * 64,
        child_id=child_id,
        occurred_at=stamp,
        created_at=stamp,
        updated_at=stamp,
    )


async def test_old_journal_and_care_pages_are_not_hidden_behind_newer_sources(baby_api):
    async with baby_api.sessions() as db:
        db.add_all([fixture_record("source", 1000 + index) for index in range(125)])
        expected = [
            fixture_record(kind, index)
            for index, kind in enumerate(
                ["journal"] * 35 + ["question", "feeding", "sleep", "diaper"]
            )
        ]
        db.add_all(expected)
        await db.commit()
    c = baby_api.client
    bootstrap_page = (await c.get("/api/v1/baby/records?limit=100")).json()
    assert len(bootstrap_page["items"]) == 100
    assert {item["kind"] for item in bootstrap_page["items"]} == {"source"}
    filters = [("kinds", kind) for kind in ["journal", "question", "feeding", "sleep", "diaper"]]
    ids, offset, more = [], 0, True
    while more:
        response = await c.get(
            "/api/v1/baby/records", params=[*filters, ("limit", "10"), ("offset", str(offset))]
        )
        assert response.status_code == 200, response.text
        page = response.json()
        assert page["total"] == len(expected)
        ids.extend(item["id"] for item in page["items"])
        offset += len(page["items"])
        more = page["has_more"]
    assert len(ids) == len(set(ids)) == len(expected)
    assert set(ids) == {str(row.id) for row in expected}
    searched = await c.get(
        "/api/v1/baby/search", params=[*filters, ("q", "hospital"), ("limit", "100")]
    )
    assert searched.status_code == 200 and searched.json()["total"] == len(expected)


async def test_kind_groups_and_explicit_general_notes_obey_child_owner_and_generation(baby_api):
    c = baby_api.client
    first = (await c.post("/api/v1/baby/children", headers=GEN, json={"name": "First"})).json()[
        "id"
    ]
    second = (await c.post("/api/v1/baby/children", headers=GEN, json={"name": "Second"})).json()[
        "id"
    ]
    for kind, child in [
        ("journal", first),
        ("question", None),
        ("journal", second),
        ("source", first),
    ]:
        created = await c.post(
            "/api/v1/baby/records",
            headers=GEN,
            json=payload(kind, child_id=child, body="Hospital question"),
        )
        assert created.status_code == 200, created.text
    assert (
        await c.post(
            "/api/v1/baby/records",
            headers={**GEN, "X-Test-Owner": "other"},
            json=payload(body="Hospital question"),
        )
    ).status_code == 200
    filters = [("kinds", "journal"), ("kinds", "question"), ("child_id", first)]
    exact = await c.get("/api/v1/baby/records", params=filters)
    assert exact.json()["total"] == 1
    general = await c.get("/api/v1/baby/records", params=[*filters, ("include_general", "true")])
    assert general.json()["total"] == 2
    assert {item["child_id"] for item in general.json()["items"]} == {first, None}
    search = await c.get(
        "/api/v1/baby/search", params=[*filters, ("include_general", "true"), ("q", "Hospital")]
    )
    assert search.json()["total"] == 2
    foreign = await c.get(
        "/api/v1/baby/records",
        headers={"X-Test-Owner": "other"},
        params=[*filters, ("include_general", "true")],
    )
    assert foreign.status_code == 404
    async with baby_api.sessions() as db:
        member = await db.scalar(
            select(BabyMembership).where(BabyMembership.app_user_id == "owner")
        )
        member.generation = 2
        current = fixture_record("journal", 99, generation=2)
        db.add(current)
        await db.commit()
    result = await c.get(
        "/api/v1/baby/records", params=[("kinds", "journal"), ("include_general", "true")]
    )
    assert result.json()["total"] == 1 and result.json()["items"][0]["id"] == str(current.id)


@pytest.mark.parametrize("path", ["/records", "/search?q=hospital"])
async def test_kind_group_filters_are_bounded_and_unambiguous(baby_api, path):
    separator = "&" if "?" in path else "?"
    for invalid in ["kinds=invalid", "kind=journal&kinds=journal", "&".join(["kinds=journal"] * 9)]:
        response = await baby_api.client.get("/api/v1/baby" + path + separator + invalid)
        assert response.status_code == 422, response.text
