"""Upload/citation regressions using generated images and disposable PostgreSQL."""

import importlib
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.domains.baby.attachments import validate_payload
from app.domains.baby.chat import clean_assistant_message, display_excerpt, message_response
from app.image_validation import ImageValidationError, validate_image_bytes
from tests import test_baby_integration as shared

baby_api = shared.baby_api
DATABASE_URL = shared.DATABASE_URL

migration = importlib.import_module("migrations.052_allow_baby_media_cleanup")


def heif_bytes():
    # The production image-validation import registers the Pillow HEIF codec.
    exif = Image.Exif()
    exif[0x010E] = "Private metadata"
    with BytesIO() as output, Image.new("RGB", (32, 16), "red") as image:
        image.save(output, format="HEIF", exif=exif)
        return output.getvalue()


@pytest.mark.parametrize("mime", ["image/heic", "image/heif"])
async def test_heif_normalizes_to_metadata_free_webp_without_changing_other_callers(mime):
    payload = heif_bytes()
    with pytest.raises(ImageValidationError, match="Unsupported image format"):
        validate_image_bytes(payload, max_bytes=1024 * 1024, declared_content_type=mime)
    with pytest.raises(ImageValidationError, match="declared type"):
        validate_image_bytes(
            payload, max_bytes=1024 * 1024, declared_content_type="image/png", allow_heif=True
        )
    data, actual = await validate_payload(payload, mime)
    assert actual == "image/webp"
    with Image.open(BytesIO(data)) as image:
        assert image.format == "WEBP" and image.size == (32, 16)
        assert not image.getexif() and "exif" not in image.info


@pytest.mark.parametrize(
    "raw,expected",
    [
        (
            "Advice \ue200cite\ue202record-uuid\ue201 . More \ue200cite\ue202a\ue202b\ue201!",
            "Advice. More!",
        ),
        ("Keep \ue2ffwords\ue201, please.", "Keep words, please."),
        ("First line\nSecond \ue200cite\ue202unfinished", "First line\nSecond"),
    ],
)
def test_clean_assistant_citations_and_stored_response(raw, expected):
    assert clean_assistant_message(raw) == expected
    row = SimpleNamespace(
        id=uuid4(),
        conversation_id=uuid4(),
        role="assistant",
        created_at=None,
        content={"message": raw, "citations": [{"id": "record-uuid"}]},
    )
    assert message_response(row)["content"] == expected
    assert message_response(row)["citations"] == row.content["citations"]
    row.role = "user"
    assert message_response(row)["content"] == raw


def test_source_excerpt_prefers_organized_content_and_falls_back_when_empty():
    row = SimpleNamespace(
        kind="source",
        title="Feeding notes",
        body="",
        data={
            "source_text": "Log in / Register / Skip Ribbon Commands",
            "summary": "Feeding notes\nThe source describes feeding cues.",
            "key_points": ["Watch for early cues.", "Pause when the baby turns away."],
        },
    )
    assert display_excerpt(row, ["Log in"]) == (
        "The source describes feeding cues.\n\nWatch for early cues.\n\n"
        "Pause when the baby turns away."
    )
    row.data["summary"] = "x" * 1500
    assert display_excerpt(row, []) == "x" * 1000
    row.data.update(summary="", key_points=["A useful point."])
    assert display_excerpt(row, []) == "A useful point."
    row.data.update(summary="", key_points=[])
    assert display_excerpt(row, []) == row.data["source_text"]


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_migration_restores_real_constraint_and_uploads_heic(baby_api, monkeypatch, tmp_path):
    from app.domains.baby import storage

    engine = baby_api.engine
    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM schema_migrations WHERE version=52"))
        await connection.execute(
            text("ALTER TABLE deletion_cleanup_jobs DROP CONSTRAINT ck_deletion_cleanup_kind")
        )
        await connection.execute(
            text("""ALTER TABLE deletion_cleanup_jobs ADD CONSTRAINT
            ck_deletion_cleanup_kind CHECK (kind IN ('account','recipe','workout_media'))""")
        )
    configured = SimpleNamespace(baby_api_enabled=False, environment="production")
    monkeypatch.delenv("MIGRATION_052_RESTORE_POINT", raising=False)
    await migration.run_migration(configured=configured, migration_engine=engine)
    configured.baby_api_enabled = True
    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM schema_migrations WHERE version=50"))
    with pytest.raises(RuntimeError, match="050 must precede052"):
        await migration.run_migration(configured=configured, migration_engine=engine)
    async with engine.begin() as connection:
        await connection.execute(
            text("INSERT INTO schema_migrations VALUES (50,'test Baby baseline')")
        )
    with pytest.raises(RuntimeError, match="MIGRATION_052_RESTORE_POINT"):
        await migration.run_migration(configured=configured, migration_engine=engine)
    monkeypatch.setenv("MIGRATION_052_RESTORE_POINT", "local-synthetic-restore-test")
    prepare, calls = migration.prepare, []

    async def interrupted(connection, settings):
        calls.append(True)
        if len(calls) == 2:
            raise RuntimeError("Synthetic interruption before validation")
        return await prepare(connection, settings)

    monkeypatch.setattr(migration, "prepare", interrupted)
    with pytest.raises(RuntimeError, match="Synthetic interruption"):
        await migration.run_migration(configured=configured, migration_engine=engine)
    async with engine.begin() as connection:
        assert await connection.scalar(
            text("""SELECT NOT convalidated FROM pg_constraint
            WHERE conrelid='deletion_cleanup_jobs'::regclass AND conname='ck_deletion_cleanup_kind'""")
        )
    monkeypatch.setattr(migration, "prepare", prepare)
    await migration.run_migration(configured=configured, migration_engine=engine)
    monkeypatch.delenv("MIGRATION_052_RESTORE_POINT")
    await migration.run_migration(configured=configured, migration_engine=engine)
    async with engine.begin() as connection:
        assert await connection.scalar(
            text("""SELECT convalidated FROM pg_constraint
            WHERE conrelid='deletion_cleanup_jobs'::regclass AND conname='ck_deletion_cleanup_kind'""")
        )
        for kind in ("account", "recipe", "workout_media", "baby_media"):
            await connection.execute(
                text("""INSERT INTO deletion_cleanup_jobs(id,kind,app_user_id)
                VALUES(:id,:kind,'owner')"""),
                {"id": uuid4(), "kind": kind},
            )
    with pytest.raises(IntegrityError):
        async with engine.begin() as connection:
            await connection.execute(
                text("""INSERT INTO deletion_cleanup_jobs(id,kind,app_user_id)
                VALUES(:id,'unknown','owner')"""),
                {"id": uuid4()},
            )
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(environment="test", baby_local_storage_dir=str(tmp_path)),
    )
    response = await baby_api.client.post(
        "/api/v1/baby/attachments",
        headers={"X-Baby-Generation": "1", "Idempotency-Key": str(uuid4())},
        files={"file": ("IMG_0111.heic", heif_bytes(), "image/heic")},
    )
    assert response.status_code == 200, response.text
    saved = await baby_api.client.get("/api/v1/baby/attachments/" + response.json()["id"])
    assert saved.status_code == 200 and saved.headers["content-type"] == "image/webp"
    with Image.open(BytesIO(saved.content)) as image:
        assert image.format == "WEBP" and not image.getexif()
