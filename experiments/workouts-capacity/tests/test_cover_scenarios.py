"""Actual cover-worker branches and guarded ASGI helper; external boundaries fake."""

import asyncio
import base64
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from capacity.cover_scenarios import CoverScenarios, install
from capacity.plan import environment
from capacity.safety import OWNERS


@pytest.fixture
def source(monkeypatch):
    for key, value in environment().items():
        monkeypatch.setenv(key, value)
    from app.config import get_settings

    get_settings.cache_clear()
    from app import cover_jobs
    from app.models.recipe import ExtractionJob, Recipe
    from app.services.cover_selection import CoverCandidate
    from app.services.video import VideoFrame

    monkeypatch.setattr(cover_jobs, "candidate_cache", cover_jobs.CandidateCache())
    monkeypatch.setattr(
        type(cover_jobs.storage_service), "is_enabled", property(lambda _: True)
    )
    yield cover_jobs, Recipe, ExtractionJob, CoverCandidate, VideoFrame
    get_settings.cache_clear()


class MemoryDB:
    def __init__(self, saved):
        self.saved, self.pending = saved, {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.pending.clear()  # Uncommitted operations do not survive cancellation.

    def add(self, value):
        self.pending[type(value), value.id] = value

    async def get(self, model, identifier):
        return self.pending.get(
            (model, identifier), self.saved.get((model, identifier))
        )

    async def scalar(self, statement):
        model = statement.column_descriptions[0]["entity"]
        return next(value for (kind, _), value in self.saved.items() if kind is model)

    async def flush(self):
        return None

    async def commit(self):
        self.saved.update(self.pending)
        self.pending.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("cached", [True, False])
async def test_actual_worker_enhance_reuses_cache_or_extracts_real_fallback_branch(
    source, monkeypatch, cached
):
    jobs, Recipe, ExtractionJob, Candidate, Frame = source
    import io

    from app.image_validation import validate_image_bytes
    from capacity.media_identity import video_url
    from capacity.transport import recipe
    from PIL import Image

    output = io.BytesIO()
    Image.new("RGB", (16, 16), (20, 160, 70)).save(output, format="JPEG")
    photo = output.getvalue()
    saved_recipe = Recipe(
        id=uuid4(),
        user_id=OWNERS[21],
        source_url=video_url("baseline", 99),
        source_type="youtube",
        content_revision=1,
        extracted={**recipe(), "sourceUrl": video_url("baseline", 99)},
        extraction_method="basic",
        is_public=False,
    )
    job = ExtractionJob(
        id=uuid4(),
        user_id=OWNERS[21],
        url=saved_recipe.source_url,
        target_recipe_id=saved_recipe.id,
        recipe_id=saved_recipe.id,
        job_kind="cover",
        status="processing",
        lease_token="synthetic-token",
        notes=json.dumps({"revision": 1, "sourceThumbnail": None, "parentJob": None}),
    )
    saved = {(Recipe, saved_recipe.id): saved_recipe, (ExtractionJob, job.id): job}
    factory = lambda: MemoryDB(saved)
    monkeypatch.setattr(jobs, "AsyncSessionLocal", factory)

    async def no_lock(*args):
        return None

    monkeypatch.setattr(jobs, "acquire_recipe_media_lock", no_lock)

    async def fetch(*args):
        return validate_image_bytes(photo, max_bytes=10 * 1024 * 1024)

    monkeypatch.setattr(jobs.storage_service, "fetch_thumbnail_source", fetch)
    fallback_calls = []

    async def fallback_frames(url):
        assert url == saved_recipe.source_url
        fallback_calls.append(url)
        return SimpleNamespace(frames=[Frame(1.0, base64.b64encode(photo).decode())])

    monkeypatch.setattr(jobs.video_service, "extract_cover_frames", fallback_frames)

    async def metadata(*args):
        return SimpleNamespace(thumbnail="https://capacity.invalid/photo")

    monkeypatch.setattr(jobs.video_service, "get_video_metadata_ytdlp", metadata)
    selections = []

    async def select(candidates, *args):
        selections.append(candidates)
        return SimpleNamespace(
            candidate=candidates[0], error_code=None, provenance={"synthetic": True}
        )

    monkeypatch.setattr(jobs.cover_selection_service, "select", select)
    worker = jobs.CoverJobWorker()

    async def store(*args, **kwargs):
        return "https://capacity.invalid/stored"  # External storage boundary.

    monkeypatch.setattr(worker, "_store_candidate", store)
    cache = jobs.candidate_cache
    if cached:
        cache.remember(
            job.id, [Candidate("cached", photo, "video_frame", timestamp_seconds=1.0)]
        )
    scenarios = CoverScenarios("baseline")
    scenarios.observe(worker, cache)
    if not cached:
        scenarios.fallback.add(job.id)
    # Execute unchanged actual _enhance AND _finish, including row/lease fencing.
    await worker._enhance(job.id, job.lease_token)
    assert job.status == "completed" and selections
    assert len(fallback_calls) == (0 if cached else 1)
    assert [candidate.source_kind for candidate in selections[0]] == [
        "platform_thumbnail",
        "video_frame",
    ]
    snapshot = await scenarios.snapshot(factory)
    kind = "cached" if cached else "fallback"
    assert snapshot[kind] == {"observed": 1, "completed": 1, "linked_recipes": 1}
    assert scenarios.active.get() is None
    cache.take(job.id)  # Cleanup outside _enhance cannot invent another reuse.
    assert (job.id in scenarios.reused) is cached


@pytest.mark.asyncio
async def test_actual_worker_cancelled_or_failed_does_not_invent_completed_reuse(
    source, monkeypatch
):
    jobs, _, _, Candidate, _ = source
    for error in (asyncio.CancelledError(), RuntimeError("synthetic failure")):
        cache = jobs.CandidateCache()
        identity = uuid4()
        cache.remember(identity, [Candidate("cached", b"synthetic", "video_frame")])

        class Worker:
            async def _enhance(self, job_id, token, cache=cache, error=error):
                cache.take(job_id)
                raise error

        worker = Worker()
        scenarios = CoverScenarios("baseline")
        scenarios.observe(worker, cache)
        with pytest.raises(type(error)):
            await worker._enhance(identity, "token")
        assert scenarios.active.get() is None
        assert scenarios.reused == {identity}  # Observed use does not imply success.


@pytest.mark.asyncio
async def test_guarded_fallback_handler_real_enqueue_one_owned_private_job_no_cache_clear(
    source, monkeypatch
):
    from fastapi import FastAPI, HTTPException, Request

    jobs, Recipe, ExtractionJob, Candidate, _ = source
    saved, wakes = {}, []
    factory = lambda: MemoryDB(saved)
    worker = SimpleNamespace(
        _enhance=jobs.cover_job_worker._enhance, wake=lambda: wakes.append(True)
    )
    untouched = uuid4()
    jobs.candidate_cache.remember(
        untouched, [Candidate("other", b"untouched", "video_frame")]
    )

    async def identity(request: Request):
        owner = request.headers.get("X-Capacity-User")
        if owner not in OWNERS:
            raise HTTPException(401)
        return SimpleNamespace(id=owner)

    app = FastAPI()
    scenarios = install(
        app,
        identity,
        "baseline",
        session_factory=factory,
        worker=worker,
        cache=jobs.candidate_cache,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://capacity.invalid"
    ) as client:

        async def request(body, owner=OWNERS[21]):
            return await client.post(
                "/capacity/cover-fallback",
                headers={"X-Capacity-User": owner},
                json=body,
            )

        assert (await request({"phase": "baseline"}, "foreign")).status_code == 401
        assert (await request({"phase": "baseline"}, OWNERS[20])).status_code == 403
        assert (await request({"phase": "mixed"})).status_code == 409
        assert (
            await request({"phase": "baseline", "source_url": "http://foreign.invalid"})
        ).status_code == 422
        response = await request({"phase": "baseline"})
        assert response.status_code == 200
        assert (await request({"phase": "baseline"})).status_code == 409
    records = [item for (kind, _), item in saved.items() if kind is Recipe]
    cover = [item for (kind, _), item in saved.items() if kind is ExtractionJob]
    assert len(records) == len(cover) == len(wakes) == 1
    assert not records[0].is_public and records[0].user_id == OWNERS[21]
    assert cover[0].job_kind == "cover" and cover[0].target_recipe_id == records[0].id
    assert jobs.candidate_cache.take(cover[0].id) == []
    assert jobs.candidate_cache.take(untouched)[0].image_data == b"untouched"
    assert scenarios.fallback == {cover[0].id}


def test_scenario_mount_refuses_untrusted_environment_and_nonphase(source, monkeypatch):
    from fastapi import FastAPI

    monkeypatch.setenv("CAPACITY_COVER_SCENARIOS", "false")
    assert install(FastAPI(), None, "baseline") is None
    monkeypatch.setenv("CAPACITY_COVER_SCENARIOS", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "real-secret-not-permitted")
    with pytest.raises(RuntimeError, match="Real provider credentials"):
        install(FastAPI(), None, "baseline")
    monkeypatch.setenv("OPENAI_API_KEY", environment()["OPENAI_API_KEY"])
    with pytest.raises(RuntimeError, match="Explicit cover experiment phase"):
        install(FastAPI(), None, "diagnostic")


@pytest.mark.asyncio
@pytest.mark.parametrize("cancelled", [True, False])
async def test_fallback_interruption_rolls_back_and_unlocks_without_false_success(
    source, cancelled
):
    from fastapi import FastAPI

    jobs, Recipe, ExtractionJob, _, _ = source
    saved, wakes = {}, []
    entered, release = asyncio.Event(), asyncio.Event()
    interrupt = [True]

    class InterruptedDB(MemoryDB):
        async def flush(self):
            if interrupt[0]:
                entered.set()
                await release.wait()
                if not cancelled:
                    raise OSError("synthetic DB error")

    async def identity():
        return SimpleNamespace(id=OWNERS[21])

    app = FastAPI()
    worker = SimpleNamespace(
        _enhance=jobs.cover_job_worker._enhance, wake=lambda: wakes.append(True)
    )
    scenario = install(
        app,
        identity,
        "baseline",
        session_factory=lambda: InterruptedDB(saved),
        worker=worker,
        cache=jobs.candidate_cache,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://capacity.invalid"
    ) as client:
        task = asyncio.create_task(
            client.post("/capacity/cover-fallback", json={"phase": "baseline"})
        )
        await asyncio.wait_for(entered.wait(), 2)
        duplicate = await client.post(
            "/capacity/cover-fallback", json={"phase": "baseline"}
        )
        assert duplicate.status_code == 409
        if cancelled:
            task.cancel()
        else:
            release.set()
        with pytest.raises(asyncio.CancelledError if cancelled else OSError):
            await task
        assert saved == {} and wakes == [] and scenario.fallback == set()
        interrupt[0] = False
        recovered = await client.post(
            "/capacity/cover-fallback", json={"phase": "baseline"}
        )
        assert recovered.status_code == 200
    assert len([key for key in saved if key[0] is Recipe]) == 1
    assert len([key for key in saved if key[0] is ExtractionJob]) == 1
    assert len(wakes) == len(scenario.fallback) == 1
