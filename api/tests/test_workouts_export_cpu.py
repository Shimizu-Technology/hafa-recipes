"""Pure CPU parity and deterministic worker settlement; not a latency benchmark."""

import asyncio
import threading
from contextvars import ContextVar
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from asyncpg.pgproto.pgproto import UUID as PgUUID
from fastapi import HTTPException

from app.domains.workouts import export_cpu, export_service
from app.domains.workouts.export_service import ExportResponse, ExportSnapshotPage


def projection():
    at = datetime(2026, 10, 12, tzinfo=timezone.utc)
    return ExportResponse(
        generated_at=at,
        enrollment={
            "enrolled": True,
            "generation": 1,
            "adult_confirmed": True,
            "shared_account_deletion_acknowledged": True,
            "enrolled_at": at,
        },
        profile=None,
        profile_revision=0,
        ai_consent={"accepted": False, "accepted_at": None, "disclosure_version": 1},
        grants=[],
        datasets={
            "workouts": [
                {
                    "id": str(uuid4()),
                    "content": {
                        "title": "Private fixture",
                        "notes": ["é full private content" * 1000],
                        "blocks": [
                            {
                                "id": "one",
                                "label": "Strength",
                                "exercises": [
                                    {"name": "Squat", "sets": 3, "reps_min": 8, "reps_max": 12}
                                ],
                            }
                        ],
                    },
                }
            ]
        },
        totals={"workouts": 1},
        has_more={"workouts": False},
        offset=0,
        limit=10,
    )


def binding():
    return SimpleNamespace(id=uuid4(), app_user_id="owner", generation=1)


def test_private_scalar_copy_has_no_mutable_alias_and_rejects_objects():
    original = projection().model_dump()
    captured = export_cpu.freeze_payload(original)
    original["datasets"]["workouts"][0]["content"]["title"] = "changed"
    copied = export_cpu.thaw_payload(captured)
    assert copied["datasets"]["workouts"][0]["content"]["title"] == "Private fixture"
    copied["datasets"]["workouts"].clear()
    assert len(export_cpu.thaw_payload(captured)["datasets"]["workouts"]) == 1
    with pytest.raises(TypeError):
        captured["offset"] = 4
    with pytest.raises(TypeError):
        export_cpu.freeze_payload({"database_session": object()})
    with pytest.raises(TypeError):
        export_cpu.freeze_payload({1: "not a JSON key"})


async def test_full_page_crypto_and_typed_encoded_response_parity():
    projected, snapshot, key = projection(), binding(), b"E" * 32
    payload = export_cpu.freeze_payload(projected.model_dump())
    associated = export_service.aad(snapshot, 0)
    content = projected.model_dump_json().encode()
    count, cipher = await export_cpu.run_cpu(
        export_service.encode_page, payload, key, associated, len(content), len(content)
    )
    assert count == len(content)
    assert export_service.unseal(key, snapshot, 0, cipher) == content
    assert b"Private fixture" not in cipher
    typed = await export_cpu.run_cpu(
        export_service.decode_page, key, associated, cipher, snapshot.id, 0, 1, False
    )
    expected = ExportSnapshotPage(snapshot_id=snapshot.id, page=0, page_count=1, export=projected)
    assert typed == expected
    encoded = await export_cpu.run_cpu(
        export_service.decode_page, key, associated, cipher, snapshot.id, 0, 1, True
    )
    assert encoded == expected.model_dump_json().encode()
    assert ExportSnapshotPage.model_validate_json(encoded) == typed
    assert (
        await export_cpu.run_cpu(
            export_service.decode_page, key, associated, cipher, snapshot.id, None, 1, False
        )
        == projected
    )
    for wrong_key, wrong_aad in [(b"Z" * 32, associated), (key, associated + b"foreign")]:
        with pytest.raises(export_service.InvalidTag):
            await export_cpu.run_cpu(
                export_service.decode_page,
                wrong_key,
                wrong_aad,
                cipher,
                snapshot.id,
                0,
                1,
                True,
            )


async def test_actual_driver_uuid_projection_roundtrips_without_alias_or_json_change():
    projected, snapshot, key = projection(), binding(), b"E" * 32
    identifier = PgUUID(str(uuid4()))
    projected.datasets["imports"] = [{"id": identifier, "accepted_workout_id": identifier}]
    projected.totals["imports"] = 1
    projected.has_more["imports"] = False
    original = projected.model_dump_json().encode()
    assert type(projected.model_dump()["datasets"]["imports"][0]["id"]) is PgUUID
    payload = export_cpu.freeze_payload(projected.model_dump())
    copied = export_cpu.thaw_payload(payload)["datasets"]["imports"][0]["id"]
    assert type(copied) is UUID and copied == identifier
    associated = export_service.aad(snapshot, 0)
    count, ciphertext = await export_cpu.run_cpu(
        export_service.encode_page, payload, key, associated, len(original), len(original)
    )
    assert count == len(original)
    assert export_service.unseal(key, snapshot, 0, ciphertext) == original
    encoded = await export_cpu.run_cpu(
        export_service.decode_page, key, associated, ciphertext, snapshot.id, 0, 1, True
    )
    expected = ExportSnapshotPage(snapshot_id=snapshot.id, page=0, page_count=1, export=projected)
    assert encoded == expected.model_dump_json().encode()


@pytest.mark.parametrize("boundary", ["page", "total"])
def test_original_plaintext_limit_rejects_before_encryption(monkeypatch, boundary):
    projected = projection()
    length = len(projected.model_dump_json().encode())

    def forbidden(*_):
        raise AssertionError("Oversized plaintext reached encryption")

    monkeypatch.setattr(export_service, "seal_bytes", forbidden)
    with pytest.raises(HTTPException) as caught:
        export_service.encode_page(
            export_cpu.freeze_payload(projected.model_dump()),
            b"E" * 32,
            b"aad",
            length - (boundary == "page"),
            length - (boundary == "total"),
        )
    assert caught.value.status_code == 413
    assert caught.value.detail == "export_snapshot_too_large"


@pytest.mark.parametrize("fail", [False, True])
async def test_actual_worker_cancellation_settles_before_return_without_context_copy(fail):
    loop = asyncio.get_running_loop()
    entered, release = asyncio.Event(), threading.Event()
    private_context = ContextVar("private_export_test", default=None)
    token = private_context.set(object())
    loop_thread = threading.get_ident()
    calls = []

    def held():
        calls.append(threading.get_ident())
        assert threading.get_ident() != loop_thread
        assert private_context.get() is None
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(5)
        if fail:
            raise ValueError("Private error must not mask cancellation")
        return b"private result"

    pending = asyncio.create_task(export_cpu.run_cpu(held))
    try:
        await asyncio.wait_for(entered.wait(), 5)
        pending.cancel()
        await asyncio.sleep(0)
        pending.cancel()
        await asyncio.sleep(0)
        assert not pending.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(pending, 5)
        assert len(calls) == 1
    finally:
        release.set()
        if not pending.done():
            await asyncio.gather(pending, return_exceptions=True)
        private_context.reset(token)
