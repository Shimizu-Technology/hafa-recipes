from app.domains.workouts.privacy import redact_workouts_event, redact_workouts_transaction


def test_private_request_diagnostic_has_no_source_or_health_content():
    event = {
        "event_id": "trace",
        "environment": "test",
        "level": "error",
        "request": {
            "url": "https://api.example/api/v1/workouts/profile?weight=80",
            "data": {"weight": 80},
            "headers": {"Authorization": "private"},
        },
        "exception": {"values": [{"value": "private provider transcript"}]},
        "breadcrumbs": [{"message": "private source URL"}],
        "contexts": {"health": {"age": 40}},
        "user": {"id": "private"},
        "extra": {"profile": "private"},
        "tags": {"source": "private"},
    }
    clean = redact_workouts_event(event)
    assert clean == {
        "event_id": "trace",
        "environment": "test",
        "level": "error",
        "message": "Workouts request failed",
        "tags": {"product": "workouts"},
    }
    assert redact_workouts_transaction(event) is None


def test_private_transaction_name_is_protected_without_request_metadata():
    event = {"transaction": "/api/v1/workouts/imports/{id}", "extra": {"secret": 1}}
    assert "extra" not in redact_workouts_event(event)
    assert redact_workouts_transaction(event) is None


def test_recipe_telemetry_retains_existing_behavior():
    event = {"request": {"url": "https://api.example/api/recipes"}, "exception": {}}
    assert redact_workouts_event(event) is event
    assert redact_workouts_transaction(event) is event


def test_workout_worker_context_protects_background_errors():
    from app.ai_governance import ai_request_context

    with ai_request_context(route="/api/v1/workouts/imports"):
        event = {"exception": {"values": [{"value": "private SQL parameter"}]}}
        assert "exception" not in redact_workouts_event(event)
        assert redact_workouts_transaction(event) is None


def test_workouts_capability_tokens_are_excluded_from_access_logs():
    import logging

    from app.domains.workouts.privacy import WorkoutsAccessLogFilter

    guard = WorkoutsAccessLogFilter()
    private = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        "%s",
        (
            "127.0.0.1",
            "GET",
            "/api/v1/workouts/shared/private-token?source=private",
            "HTTP/1.1",
            200,
        ),
        None,
    )
    assert guard.filter(private) is False
    public = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        "%s",
        ("127.0.0.1", "GET", "/api/recipes", "HTTP/1.1", 200),
        None,
    )
    assert guard.filter(public) is True


def test_shared_media_logging_suppresses_private_workout_source(capsys):
    from app.ai_governance import ai_request_context
    from app.services.video import _media_log

    with ai_request_context(route="/api/v1/workouts/imports"):
        _media_log("private workout source URL")
    assert capsys.readouterr().out == ""
    with ai_request_context(route="recipe_chat"):
        _media_log("existing Recipes diagnostic")
    assert capsys.readouterr().out == "existing Recipes diagnostic\n"


def test_public_instructions_survive_projection_and_private_notes_never_do():
    from app.domains.workouts.schemas import WorkoutContent
    from app.domains.workouts.sharing_service import project_workout

    original = {"title": "Source circuit", "instructions": ["Rest after each round."],
                "notes": ["Private injury note"], "blocks": [{"id": "flow", "label": "Flow",
                "exercises": [{"name": "Row", "reps_min": 5, "per_side": True,
                               "instructions": "Keep your heels planted.", "notes": "My private cue"}]}]}
    projected, incomplete = project_workout(original)
    assert not incomplete
    copied = WorkoutContent.model_validate(projected).model_dump(mode="json")
    assert copied["instructions"] == original["instructions"]
    assert copied["blocks"][0]["exercises"][0]["instructions"] == "Keep your heels planted."
    assert copied["notes"] == []
    assert copied["blocks"][0]["exercises"][0]["notes"] is None
    legacy, _ = project_workout({"title": "Old", "notes": ["Keep this private"], "blocks": []})
    assert not legacy.get("instructions") and legacy["notes"] == []


def test_omitted_instructions_follow_unique_exercises_after_reorder_but_explicit_clears_win():
    from app.domains.workouts.instruction_compat import preserve_instructions
    from app.domains.workouts.schemas import WorkoutContent

    original = {"title": "Source", "instructions": ["Rest after rounds"], "notes": ["Private"],
                "blocks": [{"id": "flow", "label": "Flow", "exercises": [
                    {"name": "Row", "instructions": "Squeeze at the top"},
                    {"name": "Squat", "instructions": "Keep heels down"}]}]}
    older = WorkoutContent.model_validate({"title": "Changed", "blocks": [{"id": "flow", "label": "Flow",
        "exercises": [{"name": "Squat", "reps_min": 10}, {"name": "Row", "notes": "New private note"}]}]})
    result = preserve_instructions(older, original)
    assert result.instructions == original["instructions"]
    assert [exercise.instructions for exercise in result.blocks[0].exercises] == ["Keep heels down", "Squeeze at the top"]
    assert result.blocks[0].exercises[1].notes == "New private note"
    clear = older.model_dump(mode="json") | {"instructions": []}
    clear["blocks"][0]["exercises"][0]["instructions"] = None
    cleared = preserve_instructions(WorkoutContent.model_validate(clear), original)
    assert cleared.instructions == [] and cleared.blocks[0].exercises[0].instructions is None
    assert cleared.blocks[0].exercises[1].instructions == "Squeeze at the top"
    replaced = WorkoutContent.model_validate({"title": "New", "blocks": [{"id": "flow", "label": "Flow",
        "exercises": [{"name": "Press"}]}]})
    assert preserve_instructions(replaced, original).blocks[0].exercises[0].instructions is None


def test_ambiguous_legacy_exercises_require_refresh_instead_of_attaching_the_wrong_cue():
    import pytest
    from fastapi import HTTPException

    from app.domains.workouts.instruction_compat import preserve_instructions
    from app.domains.workouts.schemas import WorkoutContent

    original = {"title": "Repeated", "blocks": [{"id": "flow", "label": "Flow", "exercises": [
        {"name": "Squat", "instructions": "First cue"}, {"name": "Squat", "instructions": "Second cue"}]}]}
    older = WorkoutContent.model_validate({"title": "Repeated", "blocks": [{"id": "flow", "label": "Flow",
        "exercises": [{"name": "Squat"}, {"name": "Squat"}]}]})
    with pytest.raises(HTTPException) as error:
        preserve_instructions(older, original)
    assert error.value.status_code == 409
    current = WorkoutContent.model_validate(original)
    assert preserve_instructions(current, original).blocks[0].exercises[1].instructions == "Second cue"


def test_old_content_hashes_are_unchanged_when_new_instructions_are_absent():
    from app.domains.workouts.router import validated_workout
    from app.domains.workouts.schemas import WorkoutContent

    content = validated_workout(WorkoutContent(title="Legacy", blocks=[{"id": "main", "label": "Main",
        "exercises": [{"name": "Squat", "notes": "Only private"}]}]))
    assert "instructions" not in content
    assert "instructions" not in content["blocks"][0]["exercises"][0]
