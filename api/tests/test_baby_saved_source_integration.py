"""Save two image originals without processing; retry/edit keep private uploads."""

from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import func, select

from app.domains.baby import storage
from app.domains.baby.models import BabyAIAdmission, BabyAttachment, BabyImport, BabyRecord
from app.domains.baby.provider import BabyProvider
from app.domains.baby.schemas import RecordCreate
from app.models.ai import AIInvocation
from tests import test_baby_integration as shared

baby_api = shared.baby_api


@pytest.mark.parametrize(
    "status", [None, "saved", "queued", "processing", "ready", "incomplete", "failed", "cancelled"]
)
def test_source_states_remain_explicit_and_preserved(status):
    source = RecordCreate(
        kind="source", title="Source", occurred_at=datetime.now(UTC), data={"status": status}
    )
    assert source.data["status"] == status


@pytest.mark.parametrize("status", ["complete", "completed", "", "unknown", "SAVED"])
def test_source_state_contract_still_rejects_unknown_states(status):
    with pytest.raises(ValidationError):
        RecordCreate(
            kind="source", title="Source", occurred_at=datetime.now(UTC), data={"status": status}
        )


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_two_image_only_saved_source_create_replay_edit_retains_actual_private_uploads(
    baby_api,
    monkeypatch,
    tmp_path,
):
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            environment="test",
            baby_local_storage_dir=str(tmp_path),
        ),
    )
    extract, transcribe = (
        AsyncMock(side_effect=AssertionError("Save must not process")),
        AsyncMock(side_effect=AssertionError("Save must not transcribe")),
    )
    monkeypatch.setattr(BabyProvider, "extract", extract)
    monkeypatch.setattr(BabyProvider, "transcribe", transcribe)
    c = baby_api.client
    assets, metadata = [], []
    # HEIC is normalized on the native client before upload. Exercise its actual
    # supported JPEG wire representation alongside the independently shared PNG.
    for name, format_, mime in [
        ("shared.png", "PNG", "image/png"),
        ("normalized-heic.jpg", "JPEG", "image/jpeg"),
    ]:
        image = BytesIO()
        Image.new("RGB", (24, 24), "white").save(image, format_)
        identifier = str(uuid4())
        response = await c.post(
            "/api/v1/baby/attachments",
            headers={
                **shared.GEN,
                "Idempotency-Key": identifier,
            },
            files={"file": (name, image.getvalue(), mime)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["id"] == identifier
        assets.append(identifier)
        metadata.append(response.json())
    request = shared.payload(
        "source",
        title="Saved source",
        body="",
        data={
            "status": "saved",
            "topics": [],
            "attachment_ids": assets,
        },
    )
    created = await c.post("/api/v1/baby/records", headers=shared.GEN, json=request)
    replay = await c.post("/api/v1/baby/records", headers=shared.GEN, json=request)
    assert created.status_code == replay.status_code == 200, (created.text, replay.text)
    # PostgreSQL returns timestamps in UTC; replay preserves the same instant.
    assert datetime.fromisoformat(created.json()["occurred_at"]) == datetime.fromisoformat(
        replay.json()["occurred_at"]
    )
    assert {k: v for k, v in created.json().items() if k != "occurred_at"} == {
        k: v for k, v in replay.json().items() if k != "occurred_at"
    }
    assert created.json()["id"] == request["id"] and created.json()["revision"] == 1
    assert created.json()["data"]["status"] == "saved"
    assert created.json()["data"]["attachment_ids"] == assets
    assert created.json()["data"]["source_text"] is None
    edited = await c.patch(
        f"/api/v1/baby/records/{request['id']}",
        headers=shared.GEN,
        json={
            "revision": 1,
            "title": "Edited saved source",
            "data": {**created.json()["data"], "topics": ["Original images"]},
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 2 and edited.json()["data"]["status"] == "saved"
    invalid = await c.patch(
        f"/api/v1/baby/records/{request['id']}",
        headers=shared.GEN,
        json={"revision": 2, "data": {"status": "completed", "attachment_ids": assets}},
    )
    assert invalid.status_code == 422
    reopened = await c.get(f"/api/v1/baby/records/{request['id']}")
    assert reopened.json() == edited.json()
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyRecord)) == 1
        rows = list(await db.scalars(select(BabyAttachment)))
        assert len(rows) == 2 and all(row.state == "ready" for row in rows)
        for row in rows:
            private_path = tmp_path / row.object_key
            assert private_path.is_file()
            authorized = await c.get(f"/api/v1/baby/attachments/{row.id}")
            assert authorized.status_code == 200 and authorized.content == private_path.read_bytes()
            assert authorized.headers["cache-control"] == "private, no-store"
            assert (
                await c.get(f"/api/v1/baby/attachments/{row.id}", headers={"X-Test-Owner": "other"})
            ).status_code == 404
        assert await db.scalar(select(func.count()).select_from(BabyImport)) == 0
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission)) == 0
        assert await db.scalar(select(func.count()).select_from(AIInvocation)) == 0
    for identifier, original in zip(assets, metadata, strict=True):
        assert (await c.get(f"/api/v1/baby/attachments/{identifier}/metadata")).json() == original
    extract.assert_not_awaited()
    transcribe.assert_not_awaited()


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_pre_upgrade_source_creation_replay_preserves_original_fingerprint(baby_api):
    from app.domains.baby.lifecycle import digest

    request = shared.payload("source", data={"summary": "Original summary"})
    normalized = RecordCreate.model_validate(request).model_dump(mode="json")
    for field in ["key_points", "steps", "creator", "platform", "thumbnail_url"]:
        normalized["data"].pop(field, None)
    # Store the exact pre-upgrade fingerprint, not one generated by new schemas.
    async with baby_api.sessions() as db:
        db.add(BabyRecord(**RecordCreate.model_validate(request).model_dump(), app_user_id="owner",
                          generation=1, revision=1, creation_hash=digest(normalized),
                          created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        await db.commit()
    response = await baby_api.client.post("/api/v1/baby/records", headers=shared.GEN, json=request)
    assert response.status_code == 200 and response.json()["id"] == request["id"]
    changed = await baby_api.client.post("/api/v1/baby/records", headers=shared.GEN,
                                        json={**request, "data": {**request["data"], "key_points": ["New claim"]}})
    assert changed.status_code == 409
