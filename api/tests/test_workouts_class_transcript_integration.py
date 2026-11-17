"""A screenshot class import whose only note is the screenshot notice ends ready.

The class and its model answers are synthetic; see test_workouts_class_transcript.
"""

# ruff: noqa: F811 -- imported fixtures are registered by pytest
from uuid import uuid4

import pytest

from app.domains.workouts.class_extraction import SCREENSHOT_NOTICE
from app.domains.workouts.extraction import WorkoutExtractor
from tests.test_workouts_automation_integration import automation_api, consent  # noqa: F401
from tests.test_workouts_class_transcript import Provider
from tests.test_workouts_data_integration import DATABASE_URL, GENERATION, data_api  # noqa: F401

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


async def test_a_screenshot_class_with_only_the_screenshot_notice_is_a_ready_job(automation_api):
    api = automation_api
    await consent(api)
    provider = Provider()
    api.worker.extractor = WorkoutExtractor(provider)
    image = {"base64_data": PNG, "mime_type": "image/png"}
    response = await api.client.post("/api/v1/workouts/imports", headers=GENERATION, json={
        "request_id": str(uuid4()),
        "source": {"kind": "images", "images": [image, image], "class_parts": True, "class_rows": True,
                   "ai_consent": True}})
    assert response.status_code == 202, response.text
    assert await api.worker.tick()
    job = (await api.client.get("/api/v1/workouts/imports/" + response.json()["id"])).json()
    assert provider.calls == ["transcribe", "extract"]
    assert job["status"] == "ready", job
    assert job["result"]["warnings"] == [] and job["result"]["source"]["coverage_notes"] == [SCREENSHOT_NOTICE]
    assert [block["label"][:1] for block in job["result"]["workout"]["blocks"]] == ["A", "B", "C"]
