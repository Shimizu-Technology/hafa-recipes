"""Optional visit metadata is verbatim and survives clients that omit it."""
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
