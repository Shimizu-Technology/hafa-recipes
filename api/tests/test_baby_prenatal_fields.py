"""Optional visit metadata is verbatim and survives clients that omit it."""
from datetime import datetime

import pytest
from pydantic import ValidationError

from app.domains.baby.router import PATCH_ADDITIONS, kept_additions
from app.domains.baby.schemas import EventData
from tests import test_baby_integration as shared
from tests.test_baby_events import allow_events, save

baby_api = shared.baby_api


def test_visit_fields_are_optional_and_do_not_change_old_creation_hashes():
    data = EventData(timezone="Pacific/Guam").model_dump(mode="json")
    assert not set(PATCH_ADDITIONS["event"]).intersection(data)


def test_old_client_patch_retains_words_and_snapshot_and_explicit_clear_works():
    original = {"clinician_age": "  12w6d per clinic  ", "results": "GBS swab done — result pending", "due_date_snapshot": "2026-12-10", "result_status": "pending"}
    saved = EventData(timezone="Pacific/Guam", **original).model_dump(mode="json")
    assert all(saved[key] == value for key, value in original.items())
    patched = kept_additions(saved, {"timezone": "Pacific/Guam"}, PATCH_ADDITIONS["event"])
    assert all(patched[key] == value for key, value in original.items())
    assert kept_additions(saved, {"results": None}, PATCH_ADDITIONS["event"])["results"] is None
    with pytest.raises(ValidationError):
        EventData(timezone="Pacific/Guam", result_status="positive")




@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_old_build_omission_preserves_saved_history(baby_api):
    await allow_events(baby_api)
    first, _ = await save(baby_api, "event", occurred_at="2026-11-08T00:00:00+10:00", data={"timezone": "Pacific/Guam", "clinician_age": "35 weeks per clinic", "results": "GBS swab done", "due_date_snapshot": "2026-12-10"})
    assert first.status_code == 200, first.text
    row = first.json()
    changed = await baby_api.client.patch(f"/api/v1/baby/records/{row['id']}", headers={**shared.GEN, "X-Baby-Client": "2"}, json={"revision": row["revision"], "data": {"timezone": "Pacific/Guam", "location": "Clinic"}})
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["clinician_age"] == "35 weeks per clinic"
    assert changed.json()["data"]["results"] == "GBS swab done"
    assert changed.json()["data"]["due_date_snapshot"] == "2026-12-10"


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_pasted_replay_keeps_first_capture_and_historical_due_date(baby_api):
    await allow_events(baby_api)
    source = {"text": "First test 💛", "start": 0, "end": 13, "original": True}
    first, body = await save(baby_api, "journal", body=source["text"], data={"paste_origin": source})
    assert first.status_code == 200, first.text
    body["occurred_at"] = "2026-11-08T00:00:00+10:00"
    body["title"] = "Another capture title"
    replay = await baby_api.client.post("/api/v1/baby/records", headers={**shared.GEN, "X-Baby-Client": "2"}, json=body)
    assert replay.status_code == 200, replay.text
    assert datetime.fromisoformat(replay.json()["occurred_at"]) == datetime.fromisoformat(first.json()["occurred_at"])
    body["body"] = "Different words"
    assert (await baby_api.client.post("/api/v1/baby/records", headers={**shared.GEN, "X-Baby-Client": "2"}, json=body)).status_code == 409


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_saved_defaults_read_beyond_the_phone_cache_and_do_not_mix_owners(baby_api):
    await allow_events(baby_api)
    saved, _ = await save(baby_api, "event", data={"timezone": "Pacific/Guam", "provider_default": True, "provider_default_at": 1794000000000, "doctor": "Dr Test", "location": "Test Clinic"})
    assert saved.status_code == 200, saved.text
    response = await baby_api.client.post("/api/v1/baby/visit-defaults/read", headers={**shared.GEN, "X-Baby-Client": "2"})
    assert response.status_code == 200, response.text
    assert response.json() == {"doctor": "Dr Test", "location": "Test Clinic"}
    foreign = await baby_api.client.post("/api/v1/baby/visit-defaults/read", headers={**shared.GEN, "X-Test-Owner": "other", "X-Baby-Client": "2"})
    assert foreign.json() is None
