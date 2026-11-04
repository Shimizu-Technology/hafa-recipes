"""Date ranges on /records and /search: half-open instants, whatever offset they arrive in."""

from typing import get_args

import pytest

from app.domains.baby.schemas import Kind
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
API = "/api/v1/baby"
GEN = shared.GEN
ROUTES = (("/records", {}), ("/search", {"q": "Notes"}))
DAY = "2026-11-02T00:00:00+10:00"
NEXT_DAY = "2026-11-03T00:00:00+10:00"


async def seed(baby_api, *moments):
    ids = {}
    for moment in moments:
        body = shared.payload("journal", occurred_at=moment)
        assert (await baby_api.client.post(f"{API}/records", headers=GEN, json=body)).status_code == 200
        ids[moment] = body["id"]
    return ids


async def listed(baby_api, route, params, **query):
    response = await baby_api.client.get(f"{API}{route}", params={**params, **query})
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize(("route", "params"), ROUTES)
async def test_range_includes_its_start_and_excludes_its_end(baby_api, route, params):
    ids = await seed(
        baby_api,
        "2026-11-01T23:59:59+10:00",
        DAY,
        "2026-11-02T23:59:59+10:00",
        NEXT_DAY,
    )
    found = await listed(baby_api, route, params, occurred_from=DAY, occurred_to=NEXT_DAY)
    assert {item["id"] for item in found["items"]} == {ids[DAY], ids["2026-11-02T23:59:59+10:00"]}
    assert found["total"] == 2
    # Consecutive days share no entry and miss none.
    after = await listed(baby_api, route, params, occurred_from=NEXT_DAY)
    assert [item["id"] for item in after["items"]] == [ids[NEXT_DAY]]
    before = await listed(baby_api, route, params, occurred_to=DAY)
    assert [item["id"] for item in before["items"]] == [ids["2026-11-01T23:59:59+10:00"]]


@pytest.mark.parametrize(("route", "params"), ROUTES)
async def test_offsets_name_the_same_instants(baby_api, route, params):
    ids = await seed(baby_api, DAY, NEXT_DAY)
    found = await listed(
        baby_api, route, params,
        occurred_from="2026-11-01T14:00:00Z", occurred_to="2026-11-02T04:00:00-10:00",
    )
    assert [item["id"] for item in found["items"]] == [ids[DAY]]


@pytest.mark.parametrize(("route", "params"), ROUTES)
@pytest.mark.parametrize(
    "query",
    [
        {"occurred_from": "2026-11-02T00:00:00"},
        {"occurred_to": "2026-11-02T00:00:00"},
        {"occurred_from": "2026-11-02"},
        {"occurred_from": "soon"},
        {"occurred_from": NEXT_DAY, "occurred_to": DAY},
        {"occurred_from": DAY, "occurred_to": DAY},
    ],
)
async def test_unusable_ranges_are_refused(baby_api, route, params, query):
    response = await baby_api.client.get(f"{API}{route}", params={**params, **query})
    assert response.status_code == 422


async def test_ranges_combine_with_other_filters_and_stay_scoped(baby_api):
    c = baby_api.client
    await seed(baby_api, DAY, "2026-11-02T01:00:00+10:00", "2026-11-02T02:00:00+10:00")
    diaper = shared.payload("diaper", occurred_at=DAY, data={"type": "wet"})
    assert (await c.post(f"{API}/records", headers=GEN, json=diaper)).status_code == 200
    window = {"occurred_from": DAY, "occurred_to": NEXT_DAY}
    page = await listed(baby_api, "/records", window, kind="journal", limit=2)
    assert (page["total"], len(page["items"]), page["has_more"]) == (3, 2, True)
    assert (await listed(baby_api, "/records", window, kinds=["diaper"]))["total"] == 1
    other = await c.get(f"{API}/records", params=window, headers={"X-Test-Owner": "other"})
    assert other.json()["total"] == 0


@pytest.mark.parametrize(("route", "params"), ROUTES)
async def test_kinds_can_name_every_kind_and_no_more(baby_api, route, params):
    kinds = list(get_args(Kind))
    assert len(kinds) > 8
    found = await baby_api.client.get(f"{API}{route}", params={**params, "kinds": kinds})
    assert found.status_code == 200
    extra = await baby_api.client.get(f"{API}{route}", params={**params, "kinds": [*kinds, "journal"]})
    assert extra.status_code == 422
