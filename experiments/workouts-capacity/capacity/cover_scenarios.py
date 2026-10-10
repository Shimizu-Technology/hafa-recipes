"""Test-only durable cache-absent cover recovery; no production route imports."""

import asyncio
import contextvars
import os
from types import SimpleNamespace
from typing import Annotated, Literal
from uuid import NAMESPACE_URL, uuid5

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from capacity.events import emit
from capacity.media_identity import video_url
from capacity.safety import OWNERS, ensure
from capacity.transport import recipe


class FallbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phase: Literal["baseline", "mixed"]


class CoverScenarios:
    def __init__(self, phase):
        self.phase = phase
        self.reused = set()
        self.fallback = set()
        self.active = contextvars.ContextVar("capacity_cover_job", default=None)

    def observe(self, worker, cache):
        original_take, original_enhance = cache.take, worker._enhance

        def take(job_id):
            candidates = original_take(job_id)
            if self.active.get() == job_id and any(
                candidate.source_kind != "platform_thumbnail"
                for candidate in candidates
            ):
                self.reused.add(job_id)
                emit("cover_cache_reuse", self.phase, "end")
            return candidates

        async def enhance(job_id, token):
            current = self.active.set(job_id)
            try:
                return await original_enhance(job_id, token)
            finally:
                self.active.reset(current)

        cache.take, worker._enhance = take, enhance

    async def snapshot(self, session_factory):
        from app.models.recipe import ExtractionJob, Recipe

        result = {
            "cached": {
                "observed": len(self.reused),
                "completed": 0,
                "linked_recipes": 0,
            },
            "fallback": {
                "observed": len(self.fallback),
                "completed": 0,
                "linked_recipes": 0,
            },
        }
        async with session_factory() as db:
            for name, identities in [
                ("cached", self.reused),
                ("fallback", self.fallback),
            ]:
                links = set()
                for identifier in identities:
                    job = await db.get(ExtractionJob, identifier)
                    if (
                        job
                        and job.status == "completed"
                        and job.recipe_id == job.target_recipe_id
                    ):
                        result[name]["completed"] += 1
                        saved = await db.get(Recipe, job.recipe_id)
                        if (
                            saved
                            and saved.user_id == job.user_id
                            and saved.source_url == job.url
                        ):
                            links.add(saved.id)
                result[name]["linked_recipes"] = len(links)
        return result


def install(app, identity, phase, session_factory=None, worker=None, cache=None):
    if os.environ.get("CAPACITY_COVER_SCENARIOS") != "true":
        return None
    ensure()
    if phase not in ("baseline", "mixed"):
        raise RuntimeError("Explicit cover experiment phase required")
    from app import cover_jobs
    from app.db.database import AsyncSessionLocal
    from app.models.recipe import Recipe
    from app.models.schemas import RecipeExtracted

    session_factory = session_factory or AsyncSessionLocal
    worker = worker or cover_jobs.cover_job_worker
    cache = cache or cover_jobs.candidate_cache
    scenarios = CoverScenarios(phase)
    scenarios.observe(worker, cache)
    lock = asyncio.Lock()

    @app.post("/capacity/cover-fallback")
    async def fallback(
        body: FallbackRequest, owner: Annotated[object, Depends(identity)]
    ):
        # Fixed owner, phase and content; no arbitrary URLs/IDs/data accepted.
        if owner.id != OWNERS[21]:
            raise HTTPException(403, "Synthetic scenario owner required")
        if body.phase != phase:
            raise HTTPException(409, "Synthetic scenario phase mismatch")
        if lock.locked():
            raise HTTPException(409, "Synthetic scenario already requested")
        async with lock:
            identifier = uuid5(NAMESPACE_URL, "capacity-cover-fallback:" + phase)
            async with session_factory() as db:
                if await db.get(Recipe, identifier):
                    raise HTTPException(409, "Synthetic scenario already requested")
                source = video_url(phase, 99)
                content = {**recipe(), "sourceUrl": source}
                content = RecipeExtracted.model_validate(content).model_dump(
                    mode="json"
                )
                saved = Recipe(
                    id=identifier,
                    user_id=owner.id,
                    source_url=source,
                    source_type="youtube",
                    content_revision=1,
                    is_public=False,
                    extracted=content,
                    extraction_method="basic",
                )
                db.add(saved)
                await db.flush()
                # Empty transient candidates model recovery after loss of cache.
                # Never clear another job's cache or replace a production helper.
                job = cover_jobs.enqueue_cover_job(
                    db,
                    saved,
                    SimpleNamespace(
                        thumbnail_url=None, cover_frames=[], cover_images=[]
                    ),
                )
                if job is None:
                    raise HTTPException(503, "Synthetic cover recovery unavailable")
                await db.commit()
                scenarios.fallback.add(job.id)
            worker.wake()
            return {"job_id": str(job.id)}  # Local handle, never uploaded.

    return scenarios
