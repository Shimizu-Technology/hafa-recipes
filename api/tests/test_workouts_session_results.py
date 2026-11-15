"""Scores remain optional, explicit, immutable and tied to the pinned parts."""

import hashlib
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

from app.domains.workouts.router import EnrollmentResponse, SessionRequest
from app.domains.workouts.session_results import PartResult, validate_snapshot
from tests.test_workouts_data_integration import (  # noqa: F401
    DATABASE_URL,
    GENERATION,
    data_api,
    session_payload,
    workout,
)

BASE = dict(client_session_id="11111111-1111-4111-8111-111111111111",
            workout_id="22222222-2222-4222-8222-222222222222", workout_revision=1,
            started_at="2026-11-17T00:00:00Z", finished_at="2026-11-17T01:00:00Z", status="completed")


def test_old_request_hash_is_unchanged():
    content = SessionRequest(**BASE).model_dump(mode="json")
    assert hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == "5b5b64d89cd607c476ad654ce29c7d44583f826f3192122a1d6dee5fb03a9ecf"
    assert not {"results", "segments", "recorded_on", "apple_workout_uuid"} & content.keys()
    assert "session_results_v1" in EnrollmentResponse.model_fields["features"].default_factory()


@pytest.mark.parametrize("result", [
    {"kind": "rounds_reps", "rounds": 3, "reps": 12},
    {"kind": "rounds_reps", "buy_in_done": False, "distance_meters": 600},
    {"kind": "time", "time_seconds": 522},
    {"kind": "time", "capped": True, "rounds": 2, "reps": 14},
    {"kind": "load", "load": 80, "load_unit": "kg"},
    {"kind": "reps", "reps": 30}, {"kind": "completed"},
])
def test_score_shapes_and_no_inferred_scaling(result):
    assert PartResult(block_id="a", **result).scaling is None


@pytest.mark.parametrize("changes", [
    {"kind": "rounds_reps", "rounds": 3},
    {"kind": "rounds_reps", "rounds": True, "reps": 0},
    {"kind": "rounds_reps", "rounds": "3", "reps": 0},
    {"kind": "time", "time_seconds": -1},
    {"kind": "time", "capped": True, "rounds": 2},
    {"kind": "load", "load": 80},
    {"kind": "completed", "load_unit": "kg"},
    {"kind": "completed", "capped": True},
    {"kind": "reps", "reps": 20, "calories": 3},
    {"kind": "rounds_reps", "buy_in_done": False, "distance_meters": 600, "rounds": 1},
    {"kind": "completed", "started_at": BASE["started_at"]},
    {"kind": "completed", "started_at": BASE["finished_at"], "ended_at": BASE["started_at"]},
])
def test_invalid_scores(changes):
    with pytest.raises(ValidationError):
        PartResult(block_id="a", **changes)


@pytest.mark.parametrize("mode,kind,ok", [
    ("amrap", "rounds_reps", True), ("amrap", "time", False),
    ("for_time", "time", True), ("for_time", "rounds_reps", False),
    ("emom", "reps", True), ("emom", "completed", True),
    ("work_rest", "completed", True), (None, "load", True), (None, "time", False),
])
def test_result_kind_against_snapshot(mode, kind, ok):
    values = {"rounds_reps": {"rounds": 3, "reps": 12}, "time": {"time_seconds": 522},
              "reps": {"reps": 20}, "load": {"load": 80, "load_unit": "kg"}, "completed": {}}[kind]
    request = SessionRequest(**BASE, results=[{"block_id": "a", "kind": kind, **values}])
    snapshot = {"blocks": [{"id": "a", "execution": {"mode": mode}, "exercises": []}]}
    if ok:
        validate_snapshot(request, snapshot)
    else:
        with pytest.raises(HTTPException):
            validate_snapshot(request, snapshot)
    snapshot["blocks"][0]["score_kind"] = "none"
    with pytest.raises(HTTPException):
        validate_snapshot(request, snapshot)


@pytest.mark.parametrize("changes", [
    {"results": [{"block_id": "a", "kind": "completed"}] * 2},
    {"results": [{"block_id": "a", "kind": "completed", "started_at": "2026-11-16T23:59:54Z", "ended_at": BASE["finished_at"]}]},
    {"segments": [{"block_id": "a", "kind": "round", "index": 1, "started_at": BASE["started_at"], "ended_at": "2026-11-17T01:00:06Z"}]},
    {"segments": [{"block_id": "a", "kind": "round", "index": 1, "started_at": BASE["started_at"], "ended_at": BASE["finished_at"]}] * 2},
    {"heart_rate": {"avg": 180, "max": 160, "source": "apple_watch"}},
    {"segments": [{"block_id": "a", "kind": "round", "index": 1, "started_at": BASE["started_at"], "ended_at": BASE["finished_at"], "avg_hr": 251}]},
])
def test_intervals_and_hr_rejected(changes):
    with pytest.raises(ValidationError):
        SessionRequest(**BASE, **changes)


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_scores_retry_correction_and_legacy_client(data_api):  # noqa: F811
    api = data_api
    saved = await workout(api)
    original = session_payload(saved, results=[{"block_id": "strength", "kind": "load", "load": 80, "load_unit": "kg", "scaling": "rx"}], active_seconds=600,
                               recorded_on="watch", apple_workout_uuid=str(uuid4()), activity_type="cross_training")
    created = await api.client.post("/api/v1/workouts/sessions", json=original, headers=GENERATION)
    assert created.status_code == 201, created.text
    replay = await api.client.post("/api/v1/workouts/sessions", json=original, headers=GENERATION)
    assert replay.status_code == 200 and replay.json()["id"] == created.json()["id"]
    correction = {**original, "client_session_id": str(uuid4()), "supersedes_session_id": created.json()["id"], "active_seconds": 500,
                  "results": [{"block_id": "strength", "kind": "load", "load": 70, "load_unit": "kg", "scaling": "scaled"}]}
    corrected = await api.client.post("/api/v1/workouts/sessions", json=correction, headers=GENERATION)
    assert corrected.status_code == 201, corrected.text
    before = await api.client.get(f'/api/v1/workouts/sessions/{created.json()["id"]}')
    assert before.json()["content"]["results"] == created.json()["content"]["results"]
    assert corrected.json()["content"]["active_seconds"] == 500
    invalid = {**original, "client_session_id": str(uuid4()), "results": [{"block_id": "foreign", "kind": "completed"}]}
    assert (await api.client.post("/api/v1/workouts/sessions", json=invalid, headers=GENERATION)).status_code == 422
    legacy = await api.client.post("/api/v1/workouts/sessions", json=session_payload(saved), headers=GENERATION)
    assert legacy.status_code == 201 and "results" not in legacy.json()["content"]
    from app.domains.workouts.models import WorkoutRecord
    from app.domains.workouts.router import append_workout_version
    async with api.sessions.begin() as db:
        row = await db.get(WorkoutRecord, saved["id"])
        await append_workout_version(db, row, {**row.content, "programming": {"source_kind": "gym"}})
        saved["revision"] = row.revision
    default = await api.client.post("/api/v1/workouts/sessions", json=session_payload(saved), headers=GENERATION)
    assert default.status_code == 201 and default.json()["content"]["activity_type"] is None



@pytest.mark.parametrize("environment,source,ok", [
    ("outdoor", "gps", True), ("treadmill", "prescribed", True),
    ("treadmill", "edited", True), ("outdoor", "edited", True),
    ("treadmill", "gps", False), (None, "gps", False),
    ("outdoor", None, False), (None, None, False),
])
def test_run_distance_provenance(environment, source, ok):
    segment = dict(block_id="a", kind="run", index=1, started_at=BASE["started_at"],
                   ended_at=BASE["finished_at"], distance_meters=400,
                   run_environment=environment, distance_source=source)
    if ok:
        assert SessionRequest(**BASE, segments=[segment]).segments[0].distance_source == source
    else:
        with pytest.raises(ValidationError):
            SessionRequest(**BASE, segments=[segment])


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_hr_opt_in_and_revocation(data_api):  # noqa: F811
    api = data_api
    saved = await workout(api)
    consent = "/api/v1/workouts/health-summary-consent"
    assert (await api.client.get(consent)).json() == {"available": False, "enabled": False}
    assert (await api.client.put(consent, json={"enabled": True}, headers=GENERATION)).status_code == 503
    payload = session_payload(saved, heart_rate={"avg": 120, "max": 160, "source": "apple_watch"})
    assert (await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)).status_code == 403
    # Simulate only migration063's grant capability in the disposable test DB.
    async with api.sessions.begin() as db:
        from app.domains.workouts.heart_rate_erasure import install_heart_rate_erasure
        await install_heart_rate_erasure(db)
        await db.execute(text("ALTER TABLE workouts_grants DROP CONSTRAINT ck_workouts_grant_scope"))
        await db.execute(text("ALTER TABLE workouts_grants ADD CONSTRAINT ck_workouts_grant_scope CHECK (scope IN ('health_workout_summary_store'))"))
    assert "health_workout_summary_v1" in (await api.client.get("/api/v1/workouts/enrollment")).json()["features"]
    assert (await api.client.put(consent, json={"enabled": True}, headers=GENERATION)).status_code == 200
    accepted = await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)
    assert accepted.status_code == 201 and accepted.json()["content"]["heart_rate"]["avg"] == 120
    assert (await api.client.put(consent, json={"enabled": False}, headers=GENERATION)).status_code == 200
    payload["client_session_id"] = str(uuid4())
    assert (await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)).status_code == 403
    # Segment-only HR is subject to the same grant.
    payload.pop("heart_rate")
    payload["segments"] = [{"block_id": "strength", "kind": "part", "index": 1,
                            "started_at": payload["started_at"], "ended_at": payload["finished_at"], "avg_hr": 120}]
    assert (await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)).status_code == 403


@pytest.mark.parametrize("mode", [None, "amrap", "for_time", "emom", "work_rest"])
@pytest.mark.parametrize("kind,values", [
    ("rounds_reps", {"rounds": 1, "reps": 2}), ("time", {"time_seconds": 42}),
    ("load", {"load": 80, "load_unit": "kg"}), ("reps", {"reps": 20}),
    ("distance", {"distance_meters": 400}), ("calories", {"calories": 20}),
])
def test_explicit_score_kind_overrides_format_and_auto_supports_distance_calories(mode, kind, values):
    request = SessionRequest(**BASE, results=[{"block_id": "a", "kind": kind, **values}])
    block = {"id": "a", "execution": {"mode": mode}, "score_kind": kind if kind not in {"distance", "calories"} else "auto"}
    validate_snapshot(request, {"blocks": [block]})
    block["score_kind"] = "reps" if kind != "reps" else "load"
    with pytest.raises(HTTPException):
        validate_snapshot(request, {"blocks": [block]})


def test_clock_skew_is_clamped_and_inter_part_rest_belongs_to_preceding_part():
    request = SessionRequest(**BASE,
        results=[{"block_id": "a", "kind": "reps", "reps": 1, "started_at": "2026-11-16T23:59:57Z", "ended_at": "2026-11-17T00:15:00Z"}],
        segments=[{"block_id": "a", "kind": "part", "index": 1, "started_at": "2026-11-16T23:59:56Z", "ended_at": "2026-11-17T00:15:04Z"},
                  {"block_id": "a", "kind": "rest", "index": 1, "started_at": "2026-11-17T00:15:00Z", "ended_at": "2026-11-17T00:18:00Z"}])
    validate_snapshot(request, {"blocks": [{"id": "a"}]})
    assert request.results[0].started_at == request.started_at
    assert request.segments[0].ended_at == request.results[0].ended_at
    assert request.segments[1].ended_at > request.results[0].ended_at


@pytest.mark.parametrize("name", ["Run", "1000m Run", "Treadmill", "Running"])
def test_distance_run_buy_in_requires_environment(name):
    snapshot = {"blocks": [{"id": "a", "exercises": [{"segment": "buy_in", "name": name, "distance_meters": 1000}]}]}
    segment = dict(block_id="a", kind="buy_in", index=1, started_at=BASE["started_at"], ended_at=BASE["finished_at"], distance_meters=600)
    with pytest.raises(HTTPException, match="Outdoor or Treadmill"):
        validate_snapshot(SessionRequest(**BASE, segments=[segment]), snapshot)
    for environment, source in [("outdoor", "gps"), ("treadmill", "prescribed")]:
        validate_snapshot(SessionRequest(**BASE, segments=[{**segment, "run_environment": environment, "distance_source": source}]), snapshot)
    snapshot["blocks"][0]["exercises"][0]["name"] = "Row"
    validate_snapshot(SessionRequest(**BASE, segments=[segment]), snapshot)


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_apple_workout_id_remains_available_to_coach(data_api):  # noqa: F811
    from app.domains.workouts.coach_actions import current_actuals, health_derived

    saved = await workout(data_api)
    response = await data_api.client.post("/api/v1/workouts/sessions", json=session_payload(saved, apple_workout_uuid=str(uuid4())), headers=GENERATION)
    assert response.status_code == 201, response.text
    async with data_api.sessions() as db:
        rows = await current_actuals(db, "owner", 1, workout_id=saved["id"])
    assert [str(row.id) for row in rows] == [response.json()["id"]]
    assert not health_derived(rows[0].content)


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_hr_delete_is_fenced_private_idempotent_and_covers_corrections(data_api, monkeypatch):  # noqa: F811
    from app.domains.workouts import export_service
    from app.domains.workouts.models import WorkoutsSession

    api = data_api
    saved = await workout(api)
    async with api.sessions.begin() as db:
        from app.domains.workouts.heart_rate_erasure import install_heart_rate_erasure
        await install_heart_rate_erasure(db)
        await db.execute(text("ALTER TABLE workouts_grants DROP CONSTRAINT ck_workouts_grant_scope"))
        await db.execute(text("ALTER TABLE workouts_grants ADD CONSTRAINT ck_workouts_grant_scope CHECK (scope IN ('health_workout_summary_store'))"))
    consent = "/api/v1/workouts/health-summary-consent"
    await api.client.put(consent, json={"enabled": True}, headers=GENERATION)
    payload = session_payload(saved, heart_rate={"avg": 120, "max": 160, "source": "apple_watch"})
    payload["segments"] = [{"block_id": "strength", "kind": "part", "index": 1, "started_at": payload["started_at"], "ended_at": payload["finished_at"], "avg_hr": 120, "max_hr": 160}]
    first = await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)
    assert first.status_code == 201, first.text
    correction = {**payload, "client_session_id": str(uuid4()), "supersedes_session_id": first.json()["id"]}
    corrected = await api.client.post("/api/v1/workouts/sessions", json=correction, headers=GENERATION)
    assert corrected.status_code == 201, corrected.text
    async with api.sessions.begin() as db:
        db.add(WorkoutsSession(app_user_id="other", generation=1, client_session_id=uuid4(), request_hash="fixture", content=payload))
    invalidated = []
    original = export_service.invalidate_export_snapshots
    async def track(db, owner, generation):
        invalidated.append((owner, generation))
        await original(db, owner, generation)
    monkeypatch.setattr(export_service, "invalidate_export_snapshots", track)
    assert (await api.client.delete(consent, headers={"X-Workouts-Generation": "2"})).status_code == 409
    deleted = await api.client.delete(consent, headers=GENERATION)
    assert deleted.status_code == 200 and deleted.json() == {"enabled": False, "deleted_sessions": 2}, deleted.text
    assert invalidated == [("owner", 1)]
    assert (await api.client.get(consent)).json()["enabled"] is False
    assert (await api.client.delete(consent, headers=GENERATION)).json()["deleted_sessions"] == 0
    async with api.sessions() as db:
        rows = (await db.execute(text("SELECT app_user_id, content FROM workouts_sessions"))).all()
    for owner, content in rows:
        if owner == "owner":
            assert "heart_rate" not in content
            assert not {"avg_hr", "max_hr"} & content["segments"][0].keys()
            assert content["actuals"] == first.json()["content"]["actuals"]
        else:
            assert content["heart_rate"] == payload["heart_rate"]
    # A queued replay must neither conflict nor restore deleted HR.
    replay = await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)
    assert replay.status_code == 200 and "heart_rate" not in replay.json()["content"]


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_hr_erasure_guard_keeps_scores_identity_and_prescriptions_immutable(data_api):  # noqa: F811
    from sqlalchemy.exc import DBAPIError

    from app.domains.workouts.heart_rate_erasure import install_heart_rate_erasure

    saved = await workout(data_api)
    created = await data_api.client.post("/api/v1/workouts/sessions", json=session_payload(saved), headers=GENERATION)
    assert created.status_code == 201
    async with data_api.sessions.begin() as db:
        await install_heart_rate_erasure(db)
    for change in ["content = jsonb_set(content, '{status}', '\"partial\"')", "request_hash = 'changed'"]:
        async with data_api.sessions.begin() as db:
            with pytest.raises(DBAPIError, match="immutable"):
                await db.execute(text("UPDATE workouts_sessions SET " + change))
            await db.rollback()
    async with data_api.sessions.begin() as db:
        with pytest.raises(DBAPIError, match="immutable"):
            await db.execute(text("UPDATE workouts_library_versions SET content = content - 'title'"))
        await db.rollback()



def test_watch_active_time_clock_skew_is_clamped_without_changing_legacy_hashes():
    request = SessionRequest(**BASE, active_seconds=3603, active_intervals=[{
        "started_at": "2026-11-16T23:59:58Z", "ended_at": "2026-11-17T01:00:02Z"}])
    assert request.active_seconds == 3600
    assert request.active_intervals[0].started_at == request.started_at
    assert request.active_intervals[0].ended_at == request.finished_at
    with pytest.raises(ValidationError):
        SessionRequest(**BASE, active_seconds=3606)



def test_collapsed_active_intervals_are_dropped_but_zero_segments_remain_valid():
    request = SessionRequest(**BASE, active_seconds=3600, active_intervals=[
        {"started_at": "2026-11-16T23:59:58Z", "ended_at": BASE["started_at"]},
        {"started_at": BASE["started_at"], "ended_at": BASE["finished_at"]}],
        segments=[{"block_id": "a", "kind": "part", "index": 1, "started_at": BASE["started_at"], "ended_at": BASE["started_at"]}])
    assert len(request.active_intervals) == 1 and request.active_seconds == 3600
    assert request._sync_warnings
    assert request.segments[0].started_at == request.segments[0].ended_at
    assert not {"warnings", "_sync_warnings", "_legacy_active_intervals"} & request.model_dump().keys()


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_collapsed_interval_upload_replay_and_legacy_health_export(data_api):  # noqa: F811
    from app.domains.workouts.health_service import actual_for_export
    from app.domains.workouts.models import WorkoutsSession

    api = data_api
    saved = await workout(api)
    payload = session_payload(saved, active_seconds=1200, active_intervals=[
        {"started_at": "2026-10-09T23:59:58Z", "ended_at": "2026-10-10T00:00:00Z"},
        {"started_at": "2026-10-10T00:00:00Z", "ended_at": "2026-10-10T00:20:00Z"}])
    response = await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)
    assert response.status_code == 201, response.text
    assert response.json()["warnings"] and len(response.json()["content"]["active_intervals"]) == 1
    replay = await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)
    assert replay.status_code == 200 and replay.json()["warnings"]
    request = SessionRequest(**payload)
    legacy = {**request.model_dump(mode="json"), "active_intervals": request._legacy_active_intervals}
    legacy["client_session_id"] = str(uuid4())
    digest = hashlib.sha256(json.dumps(legacy, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    async with api.sessions.begin() as db:
        row = WorkoutsSession(app_user_id="owner", generation=1, client_session_id=legacy["client_session_id"], request_hash=digest,
                              source_workout_id=saved["id"], content=legacy)
        db.add(row)
        await db.flush()
        identifier = row.id
    old_payload = {**payload, "client_session_id": legacy["client_session_id"]}
    assert (await api.client.post("/api/v1/workouts/sessions", json=old_payload, headers=GENERATION)).status_code == 200
    async with api.sessions() as db:
        _, actual, reason = await actual_for_export(db, "owner", 1, identifier)
    assert reason is None and len(actual["active_intervals"]) == 1


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_collapsed_interval_advances_legacy_replay_normalization(data_api):  # noqa: F811
    from app.domains.workouts.models import WorkoutsSession

    api = data_api
    saved = await workout(api)
    start = "2026-10-10T00:00:00Z"
    end = "2026-10-10T00:01:00Z"
    first = {"started_at": start, "ended_at": "2026-10-10T00:00:58Z"}
    payload = session_payload(saved, started_at=start, finished_at=end, active_seconds=58, active_intervals=[
        first,
        {"started_at": end, "ended_at": "2026-10-10T00:01:02Z"},
        {"started_at": "2026-10-10T00:00:59Z", "ended_at": end},
    ])
    request = SessionRequest(**payload)
    # Explicitly reproduce the stored pre-drop representation, independently
    # of the new validator's compatibility reconstruction.
    expected_intervals = [first, {"started_at": end, "ended_at": end}, {"started_at": end, "ended_at": end}]
    assert request._legacy_active_intervals == expected_intervals
    assert request.model_dump(mode="json")["active_intervals"] == [first]
    assert request.active_seconds == 58 and request._sync_warnings
    legacy = {**request.model_dump(mode="json"), "active_intervals": expected_intervals}
    digest = hashlib.sha256(json.dumps(legacy, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    async with api.sessions.begin() as db:
        row = WorkoutsSession(app_user_id="owner", generation=1, client_session_id=payload["client_session_id"], request_hash=digest,
                              source_workout_id=saved["id"], content=legacy)
        db.add(row)
        await db.flush()
        identifier = str(row.id)
    replay = await api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == identifier
    assert replay.json()["content"] == legacy
    assert replay.json()["warnings"]
