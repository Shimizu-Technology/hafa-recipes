"""Actual PostgreSQL bounds and execution plans before private JSON is decoded."""

import importlib
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select, text

from app.domains.workouts.export_service import MAX_PAGE_BYTES, guard_projection_memory
from app.domains.workouts.models import WorkoutRecord
from tests.test_workouts_data_integration import (
    DATABASE_URL,
    data_api,  # noqa: F401 -- isolated real PostgreSQL fixture
    enroll,
    settings,
)

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


async def records(api, contents, *, owner="owner", generation=1, start=0):
    api.engine.sync_engine.hide_parameters = True
    async with api.sessions.begin() as db:
        db.add_all(
            WorkoutRecord(
                id=UUID(int=start + index + 1),
                app_user_id=owner,
                generation=generation,
                revision=1,
                content=content,
                created_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=index),
            )
            for index, content in enumerate(contents)
        )


def plan_nodes(node):
    yield node
    for child in node.get("Plans", []):
        yield from plan_nodes(child)


@pytest.mark.parametrize("offset", [0, 90, 180])
async def test_page_bytes_match_legacy_sql_and_json_rendering_is_bounded(data_api, offset):  # noqa: F811
    api = data_api
    await enroll(api)
    await records(api, [{"notes": ["Synthetic note " + "x" * 3985] * 40}] * 190)
    observed = []

    def capture(connection, cursor, statement, parameters, context, many):
        if "octet_length" in statement and "FROM workouts_library\n" in statement:
            observed.append((statement, parameters))

    event.listen(api.engine.sync_engine, "before_cursor_execute", capture)
    try:
        async with api.sessions() as db:
            await guard_projection_memory(db, "owner", 1, 10, offset)
    finally:
        event.remove(api.engine.sync_engine, "before_cursor_execute", capture)
    assert len(observed) == 1
    statement, parameters = observed[0]
    async with api.engine.connect() as connection:
        actual = (await connection.exec_driver_sql(statement, parameters)).scalar_one()
        legacy = await connection.scalar(
            text("""SELECT COALESCE(SUM(size),0) FROM
            (SELECT COALESCE(octet_length(content::text),0) AS size
             FROM workouts_library WHERE app_user_id=:owner AND generation=:generation
             ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset) selected"""),
            {"owner": "owner", "generation": 1, "limit": 10, "offset": offset},
        )
        assert actual == legacy and actual > 1_000_000
        explained = (
            await connection.exec_driver_sql(
                "EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) " + statement, parameters
            )
        ).scalar_one()
    # The old plan renders content on a scan of all 190 records. Assert the
    # observable work bound, without relying on a particular CTE/scan name.
    rendering = [
        node
        for node in plan_nodes(explained[0]["Plan"])
        if any("octet_length" in output for output in node.get("Output", []))
    ]
    assert rendering
    assert all(node["Actual Rows"] <= 10 for node in rendering)


async def test_oversized_skipped_records_do_not_count_but_selected_later_record_rejects(data_api):  # noqa: F811
    api = data_api
    await enroll(api)
    huge = {"notes": ["x" * (MAX_PAGE_BYTES // 2 + 1)]}
    # Newest row is huge. It is selected at offset zero, skipped at offset one.
    await records(api, [{"notes": ["small"]}, huge])
    async with api.sessions() as db:
        with pytest.raises(HTTPException) as caught:
            await guard_projection_memory(db, "owner", 1, 1, 0)
        assert caught.value.status_code == 413
        assert caught.value.detail == "export_snapshot_too_large"
        await guard_projection_memory(db, "owner", 1, 1, 1)
    # Reverse the ordering: a huge value on a later selected page still rejects.
    async with api.sessions.begin() as db:
        newest = await db.get(WorkoutRecord, UUID(int=2))
        oldest = await db.get(WorkoutRecord, UUID(int=1))
        newest.content, oldest.content = oldest.content, newest.content
    async with api.sessions() as db:
        await guard_projection_memory(db, "owner", 1, 1, 0)
        with pytest.raises(HTTPException) as caught:
            await guard_projection_memory(db, "owner", 1, 1, 1)
        assert (caught.value.status_code, caught.value.detail) == (413, "export_snapshot_too_large")


async def test_owner_generation_and_empty_offset_with_missing_profile(data_api):  # noqa: F811
    api = data_api
    await enroll(api)
    await enroll(api, other=True)
    await records(api, [{"notes": ["small"]}])
    huge = {"notes": ["x" * (MAX_PAGE_BYTES // 2 + 1)]}
    await records(api, [huge], owner="other", start=10)
    await records(api, [huge], generation=2, start=20)
    async with api.sessions() as db:
        await guard_projection_memory(db, "owner", 1, 10, 0)
        await guard_projection_memory(db, "owner", 1, 10, 190)
        with pytest.raises(HTTPException) as caught:
            await guard_projection_memory(db, "owner", 2, 10, 0)
        assert caught.value.status_code == 413


async def test_cumulative_records_and_profile_reserve_remain_enforced(data_api):  # noqa: F811
    api = data_api
    await enroll(api)
    await records(api, [{"notes": ["x" * (MAX_PAGE_BYTES // 4)]}] * 2)
    async with api.sessions() as db:
        with pytest.raises(HTTPException) as caught:
            await guard_projection_memory(db, "owner", 1, 10, 0)
        assert caught.value.status_code == 413
    async with api.sessions.begin() as db:
        await db.execute(text("DELETE FROM workouts_library"))
        await db.execute(
            text("""INSERT INTO workouts_profiles(app_user_id,generation,revision,content)
             VALUES ('owner',1,1,CAST(:content AS jsonb))"""),
            {"content": json.dumps({"notes": "x" * (MAX_PAGE_BYTES // 2 + 1)})},
        )
    async with api.sessions() as db:
        with pytest.raises(HTTPException) as caught:
            await guard_projection_memory(db, "owner", 1, 10, 0)
        assert (caught.value.status_code, caught.value.detail) == (413, "export_snapshot_too_large")


async def test_null_optional_fields_and_no_client_jsonb_decoding(data_api):  # noqa: F811
    api = data_api
    await enroll(api)
    await importlib.import_module("migrations.035_add_workouts_automation").run_migration(
        configured=settings(), migration_engine=api.engine
    )
    await records(api, [{"notes": ["small"]}])
    async with api.sessions.begin() as db:
        await db.execute(
            text("""INSERT INTO workouts_import_jobs
            (id,app_user_id,generation,request_id,request_hash,payload,status,result,
             ai_accepted_at,expires_at,attempt_count)
            VALUES (:id,'owner',1,:request_id,'hash','{}'::jsonb,'queued',NULL,
             now(),now()+interval '1 hour',0)"""),
            {"id": UUID(int=500), "request_id": UUID(int=501)},
        )
    async with api.sessions() as db:
        connection = await db.connection()
        raw = await connection.get_raw_connection()

        def forbidden_decode(value):
            raise AssertionError("Size admission must not decode client JSONB")

        await raw.driver_connection.set_type_codec(
            "jsonb", schema="pg_catalog", encoder=json.dumps, decoder=forbidden_decode, format="text"
        )
        await guard_projection_memory(db, "owner", 1, 10, 0)
        # Confirm the assertion seam is effective for a real JSONB fetch.
        with pytest.raises(AssertionError, match="must not decode"):
            await db.scalar(select(WorkoutRecord.content))


async def test_coach_text_and_json_fields_are_all_in_the_same_page_bound(data_api, monkeypatch):  # noqa: F811
    api = data_api
    await enroll(api)
    await importlib.import_module("migrations.035_add_workouts_automation").run_migration(
        configured=settings(), migration_engine=api.engine
    )
    async with api.sessions.begin() as db:
        await db.execute(
            text("""INSERT INTO workouts_coach_messages
            (id,app_user_id,generation,request_id,request_hash,user_message,
             assistant_message,proposals,used_health_context)
            VALUES (:id,'owner',1,:request_id,'hash','user','assistant',
             CAST(:proposals AS jsonb),false)"""),
            {"id": UUID(int=600), "request_id": UUID(int=601), "proposals": '["proposal"]'},
        )
    from app.domains.workouts import export_service

    # TEXT sizes are 4 and 9; JSONB text is 12 bytes. Each individual field fits,
    # but their sum does not fit a 24-byte half-page reserve.
    monkeypatch.setattr(export_service, "MAX_PAGE_BYTES", 48)
    async with api.sessions() as db:
        with pytest.raises(HTTPException) as caught:
            await guard_projection_memory(db, "owner", 1, 1, 0)
        assert (caught.value.status_code, caught.value.detail) == (413, "export_snapshot_too_large")
        await guard_projection_memory(db, "owner", 1, 1, 1)


@pytest.mark.parametrize("dataset", ["health", "shares", "copies"])
async def test_ascending_export_pages_measure_the_projected_rows_before_decoding(data_api, dataset):  # noqa: F811
    api = data_api
    await enroll(api)
    for name in (
        "035_add_workouts_automation",
        "036_add_workouts_health",
        "037_add_workouts_connections_sharing",
    ):
        await importlib.import_module("migrations." + name).run_migration(
            configured=settings(workouts_health_sync_enabled=True), migration_engine=api.engine
        )
    from app.domains.workouts.connection_lifecycle import connection_export_page
    from app.domains.workouts.connection_models import WorkoutCopyReceipt, WorkoutShare
    from app.domains.workouts.health_models import HealthObservation
    from app.domains.workouts.health_service import export_health_page

    old = datetime(2026, 1, 1, tzinfo=timezone.utc)
    huge = {"notes": ["x" * (MAX_PAGE_BYTES // 2 + 1)]}
    models = []
    for index, content in enumerate([huge, {"notes": ["small"]}]):
        common = {
            "id": UUID(int=700 + index),
            "app_user_id": "owner",
            "generation": 1,
            "created_at": old + timedelta(seconds=index),
        }
        if dataset == "health":
            row = HealthObservation(
                **common,
                provider="apple_health",
                source_id=f"fixture-{index}",
                origin_id="synthetic",
                content_hash="hash",
                content=content,
            )
        elif dataset == "shares":
            row = WorkoutShare(
                **common,
                kind="workout",
                record_id=UUID(int=800),
                source_revision=1,
                token_hash=f"synthetic-hash-{index}",
                encrypted_token="synthetic-not-a-token",
                snapshot_digest="hash",
                expires_at=old + timedelta(days=1000),
                snapshot=content,
            )
        else:
            row = WorkoutCopyReceipt(
                **common,
                copy_request_id=UUID(int=810 + index),
                share_id=UUID(int=820),
                source_token_hash="synthetic-hash",
                request_hash="hash",
                kind="workout",
                snapshot_digest="hash",
                record_id=UUID(int=830),
                attribution=content,
            )
        models.append(row)
    async with api.sessions.begin() as db:
        db.add_all(models)
    async with api.sessions() as db:
        # Verify actual exporter ordering independently of the guard.
        if dataset == "health":
            projected = await export_health_page(db, "owner", 1, limit=1, offset=1)
            assert projected["observations"] == [{"notes": ["small"]}]
        else:
            projected = await connection_export_page(db, "owner", 1, limit=1, offset=1)
            name, field = (
                ("published_training_shares", "snapshot")
                if dataset == "shares"
                else ("training_copy_receipts", "attribution")
            )
            assert projected[name][0][field] == {"notes": ["small"]}
        with pytest.raises(HTTPException) as caught:
            await guard_projection_memory(db, "owner", 1, 1, 0)
        assert (caught.value.status_code, caught.value.detail) == (413, "export_snapshot_too_large")
        await guard_projection_memory(db, "owner", 1, 1, 1)
