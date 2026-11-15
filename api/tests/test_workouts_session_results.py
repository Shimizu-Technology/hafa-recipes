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
    assert not {"results", "segments", "recorded_on", "health_workout_uuid"} & content.keys()
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
    {"results": [{"block_id": "a", "kind": "completed", "started_at": "2026-11-16T23:59:59Z", "ended_at": BASE["finished_at"]}]},
    {"segments": [{"block_id": "a", "kind": "round", "index": 1, "started_at": BASE["started_at"], "ended_at": "2026-11-17T01:00:01Z"}]},
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
                               recorded_on="watch", health_workout_uuid=str(uuid4()), activity_type="cross_training")
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
    assert default.status_code == 201 and default.json()["content"]["activity_type"] == "cross_training"



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
