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
