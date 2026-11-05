"""Her own logs stay with her when a family is created."""
import re
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.domains.baby.models import BabyRecord, BabySpace
from app.domains.baby.moves import HER_LOG_LABELS
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests import test_baby_invites as invites

baby_api, enabled, pytestmark = invites.baby_api, invites.enabled, invites.pytestmark
API = "/api/v1/baby"


@pytest.fixture
async def invites_on(baby_api, enabled):
    baby_api.settings.baby_invites_enabled = baby_api.settings.baby_new_kinds_enabled = True
    return enabled


async def spaces_by_title(api):
    async with api.sessions() as db:
        kinds = {space.id: space.kind for space in await db.scalars(select(BabySpace))}
        return {row.title: kinds[row.space_id] for row in await db.scalars(select(BabyRecord))}


async def test_create_family_leaves_her_logs_in_her_personal_space(baby_api, invites_on):
    h = records.headers(invites_on, generation=1)
    bodies = [{**shared.payload("custom", title=label, data={"label": label}), "child_id": None} for label in sorted(HER_LOG_LABELS)]
    bodies.append({**shared.payload("custom", title="Walked", data={"label": "Walked"}), "child_id": None})
    for body in bodies:
        result = await baby_api.client.post(API + "/records", headers=h, json=body)
        assert result.status_code == 200, result.text
    await invites.create(baby_api, invites_on)
    placed = await spaces_by_title(baby_api)
    assert {placed[label] for label in HER_LOG_LABELS} == {"personal"}
    assert placed["Walked"] == "family", "A label she made up with no baby stays a shared log"


async def test_a_baby_log_under_the_same_label_still_follows_its_baby(baby_api, invites_on):
    h = records.headers(invites_on, generation=1)
    child = await baby_api.client.post(API + "/children", headers=h, json={"id": str(uuid4()), "name": "Mia"})
    assert child.status_code == 200, child.text
    body = {**shared.payload("custom", title="Baby's weight", data={"label": "My weight"}), "child_id": child.json()["id"]}
    assert (await baby_api.client.post(API + "/records", headers=h, json=body)).status_code == 200
    await invites.create(baby_api, invites_on)
    assert (await spaces_by_title(baby_api))["Baby's weight"] == "family"


def test_labels_match_the_app():
    source = (Path(__file__).parents[2] / "baby-mobile/lib/trackers.ts").read_text()
    labels = set(re.findall(r'dataLabel: "([^"]+)"[^\n]*about: "her"', source))
    assert labels == set(HER_LOG_LABELS)
