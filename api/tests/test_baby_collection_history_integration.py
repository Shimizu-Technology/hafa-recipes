"""Collection and topic retrieval uses complete scoped history before paging."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.domains.baby.models import BabyMembership
from tests import test_baby_integration as shared
from tests.test_baby_history_integration import fixture_record

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)


def source(index, **kwargs):
    row = fixture_record("source", index, **kwargs)
    row.body = "Hospital packing detail"
    row.data = {"status": "saved", "topics": ["Labor"]}
    return row


def collection(members, **kwargs):
    row = fixture_record("collection", -1, **kwargs)
    row.data = {"record_ids": [str(member.id) for member in members]}
    return row


async def test_collection_finds_old_members_and_topic_before_all_pagination(baby_api):
    members = [source(index) for index in range(43)]
    group = collection(members)
    async with baby_api.sessions() as db:
        # Identical search/topic words outside the collection must not inflate
        # totals or hide old members behind the latest 100 source cache.
        db.add_all([source(index + 1000) for index in range(125)] + members + [group])
        await db.commit()
    c = baby_api.client
    latest = (await c.get("/api/v1/baby/records?limit=100")).json()["items"]
    assert not {str(row.id) for row in members} & {row["id"] for row in latest}
    for path in ("/records", "/search"):
        offset, ids, more = 0, [], True
        while more:
            response = await c.get(
                "/api/v1/baby" + path,
                params={
                    "collection_id": str(group.id),
                    "topic": "Labor",
                    "q": "packing",
                    "limit": 10,
                    "offset": offset,
                },
            )
            assert response.status_code == 200, response.text
            page = response.json()
            assert page["total"] == 43 and all(row["kind"] == "source" for row in page["items"])
            ids.extend(row["id"] for row in page["items"])
            offset += len(page["items"])
            more = page["has_more"]
        assert len(ids) == len(set(ids)) == 43
        assert set(ids) == {str(row.id) for row in members}
    # Topic-only history also reaches all matching sources, not just a cache.
    topic = await c.get("/api/v1/baby/records", params={"topic": "Labor", "limit": 1})
    assert topic.json()["total"] == 168 and topic.json()["has_more"] is True
    assert (
        await c.get(
            "/api/v1/baby/search",
            params={
                "collection_id": str(group.id),
                "q": "packing",
                "topic": "labor",
            },
        )
    ).json()["total"] == 0  # Exact topic preserves case-sensitive UI semantics.


async def test_collection_search_composes_child_general_topic_and_owner_generation(baby_api):
    c = baby_api.client
    first = (
        await c.post("/api/v1/baby/children", headers=shared.GEN, json={"name": "First"})
    ).json()["id"]
    second = (
        await c.post("/api/v1/baby/children", headers=shared.GEN, json={"name": "Second"})
    ).json()["id"]
    exact, general = source(1, child_id=UUID(first)), source(2)
    other_child, wrong_topic = source(3, child_id=UUID(second)), source(4, child_id=UUID(first))
    wrong_topic.data = {"topics": ["Laboratory"]}
    foreign, old_generation = source(5, owner="other"), source(6, generation=2)
    deleted = source(7)
    deleted.deleted_at = datetime.now(UTC)
    journal = fixture_record("journal", 8, child_id=UUID(first))
    group = collection(
        [exact, general, other_child, wrong_topic, foreign, old_generation, deleted, journal]
    )
    # Foreign/generation links emulate stale stored IDs. They must never grant
    # visibility even if present in a collection's membership array.
    async with baby_api.sessions() as db:
        db.add_all(
            [
                exact,
                general,
                other_child,
                wrong_topic,
                foreign,
                old_generation,
                deleted,
                journal,
                source(100, child_id=UUID(first)),
                group,
            ]
        )
        await db.commit()
    for path in ("/records", "/search"):
        filters = {
            "collection_id": str(group.id),
            "kind": "source",
            "child_id": first,
            "q": "packing",
            "topic": "Labor",
            "limit": 1,
        }
        response = await c.get("/api/v1/baby" + path, params=filters)
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1 and response.json()["items"][0]["id"] == str(exact.id)
        assert response.json()["has_more"] is False
        together = await c.get("/api/v1/baby" + path, params={**filters, "include_general": True})
        assert together.json()["total"] == 2 and together.json()["has_more"] is True
        next_page = await c.get(
            "/api/v1/baby" + path, params={**filters, "include_general": True, "offset": 1}
        )
        assert {together.json()["items"][0]["id"], next_page.json()["items"][0]["id"]} == {
            str(exact.id),
            str(general.id),
        }
        assert next_page.json()["has_more"] is False
    unrestricted = await c.get("/api/v1/baby/records", params={"collection_id": str(group.id)})
    assert {row["id"] for row in unrestricted.json()["items"]} == {
        str(row.id) for row in [exact, general, other_child, wrong_topic]
    }


@pytest.mark.parametrize("path", ["/records", "/search"])
async def test_collection_visibility_and_kind_filters_are_strict(baby_api, path):
    live_source = source(1)
    empty, foreign, deleted = collection([]), collection([], owner="other"), collection([])
    deleted.deleted_at = datetime.now(UTC)
    async with baby_api.sessions() as db:
        db.add_all([live_source, empty, foreign, deleted])
        await db.commit()
    c = baby_api.client
    for identifier in (foreign.id, deleted.id, live_source.id, uuid4()):
        result = await c.get(
            "/api/v1/baby" + path, params={"q": "packing", "collection_id": str(identifier)}
        )
        assert result.status_code == 404, result.text
    result = await c.get(
        "/api/v1/baby" + path,
        params={"q": "packing", "collection_id": str(empty.id)},
        headers={"X-Test-Owner": "other"},
    )
    assert result.status_code == 404
    for filters in [{"kind": "journal"}, [("kinds", "source"), ("kinds", "journal")]]:
        params = [
            ("q", "packing"),
            ("collection_id", str(empty.id)),
            *(list(filters.items()) if isinstance(filters, dict) else filters),
        ]
        assert (await c.get("/api/v1/baby" + path, params=params)).status_code == 422
    result = await c.get(
        "/api/v1/baby" + path,
        params={"q": "packing", "collection_id": str(empty.id), "kinds": "source"},
    )
    assert result.json() == {"items": [], "total": 0, "has_more": False}
    for topic in ("", "x" * 81):
        assert (
            await c.get("/api/v1/baby" + path, params={"q": "packing", "topic": topic})
        ).status_code == 422
    assert (
        await c.get("/api/v1/baby" + path, params={"q": "packing", "collection_id": "not-a-uuid"})
    ).status_code == 422


async def test_old_generation_collection_and_members_cannot_return_after_new_generation(baby_api):
    old_source = source(1)
    old_collection = collection([old_source])
    current_collection = collection([old_source], generation=2)
    async with baby_api.sessions() as db:
        member = await db.scalar(
            select(BabyMembership).where(BabyMembership.app_user_id == "owner")
        )
        member.generation = 2
        db.add_all([old_source, old_collection, current_collection])
        await db.commit()
    for path in ("/records", "/search"):
        stale = await baby_api.client.get(
            "/api/v1/baby" + path, params={"q": "packing", "collection_id": str(old_collection.id)}
        )
        assert stale.status_code == 404
        fresh = await baby_api.client.get(
            "/api/v1/baby" + path,
            params={"q": "packing", "collection_id": str(current_collection.id)},
        )
        assert fresh.status_code == 200 and fresh.json() == {
            "items": [],
            "total": 0,
            "has_more": False,
        }
