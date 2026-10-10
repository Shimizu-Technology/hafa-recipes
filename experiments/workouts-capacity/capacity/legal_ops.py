"""Test-only direct real storage/media operations; never mounted in production."""

import asyncio
import contextvars
import os
import threading
import time
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from capacity.events import emit
from capacity.legal_contract import CASES
from capacity.media_identity import video_url

_OPERATION = contextvars.ContextVar("capacity_legal_operation", default=None)


class OperationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case: Literal[
        "single_rgba",
        "two_rgba",
        "two_palette",
        "wide_rgba",
        "rgba_ffmpeg",
        "palette_ffmpeg",
        "alpha_cover_ffmpeg",
        "cancel_normalizer",
        "cancel_media",
        "burst",
        "retained_cycles",
    ]


class Probe:
    def __init__(self):
        self.lock = threading.Lock()
        self.active = 0
        self.peak = 0
        self.entered = threading.Event()
        self.idle = threading.Event()
        self.idle.set()
        self.ffmpeg_started = asyncio.Event()
        self.children = []
        self.scene_calls = 0
        self.overlap = False
        self.barrier = None
        self.cover_active = False
        self.cover_overlap = False
        self.decoder_active = 0
        self.two_ffmpeg_overlap = False
        self.scene_child_count = 0

    def enter(self):
        with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
            self.idle.clear()

    def observe_overlap(self):
        # Called only under the probe lock: one simultaneous interval, not two maxima.
        alive = any(child.returncode is None for child in self.children)
        self.overlap |= self.decoder_active >= 1 and alive
        self.two_ffmpeg_overlap |= self.decoder_active >= 2 and alive
        self.cover_overlap |= self.cover_active and self.decoder_active >= 1 and alive

    def leave(self):
        with self.lock:
            self.active -= 1
            if self.active == 0:
                self.idle.set()


async def wait_thread(event, seconds=30):
    until = time.monotonic() + seconds
    while not event.is_set():
        if time.monotonic() >= until:
            raise RuntimeError("legal_worker_deadline")
        await asyncio.sleep(0.005)


def install(app, identity, storage, video, folder=Path("/fixtures")):
    if os.environ.get("CAPACITY_LEGAL_MATRIX") != "true":
        return
    if os.environ.get("WORKOUTS_API_ENABLED") != "false":
        raise RuntimeError("Legal matrix uses Recipes OFF baseline only")
    from app.services import storage as storage_module
    from app.services.cover_selection import CoverCandidate, _prepare

    original_normalize = storage_module.normalize_thumbnail_variants
    original_spawn = asyncio.create_subprocess_exec
    original_scene = video._write_scene_change_frames
    semaphore = asyncio.Lock()
    current_probe = None

    def normalize(*args, **kwargs):
        probe = current_probe
        if probe:
            probe.enter()
        try:
            if probe and probe.barrier:
                probe.barrier.wait(timeout=10)
            if probe:
                with probe.lock:
                    probe.decoder_active += 1
                    probe.observe_overlap()
                    probe.entered.set()
            try:
                return original_normalize(*args, **kwargs)
            finally:
                if probe:
                    with probe.lock:
                        probe.decoder_active -= 1
        finally:
            if probe:
                probe.leave()

    async def spawn(*args, **kwargs):
        child = await original_spawn(*args, **kwargs)
        probe = _OPERATION.get()
        if probe and args and args[0] == "ffmpeg":
            with probe.lock:
                probe.children.append(child)
                probe.scene_child_count += int(
                    any("gt(scene" in str(arg) for arg in args)
                )
                probe.observe_overlap()
                probe.ffmpeg_started.set()
        return child

    async def scene(*args, **kwargs):
        probe = _OPERATION.get()
        if probe:
            probe.scene_calls += 1
        return await original_scene(*args, **kwargs)

    storage_module.normalize_thumbnail_variants = normalize
    asyncio.create_subprocess_exec = spawn
    video._write_scene_change_frames = scene

    async def operation(case):
        nonlocal current_probe
        if current_probe is not None:
            raise RuntimeError("legal_prior_worker_unsettled")
        probe = Probe()
        current_probe = probe
        tasks = []

        def create(coroutine):
            task = asyncio.create_task(coroutine)
            tasks.append(task)
            return task

        token = _OPERATION.set(probe)
        initial_slots = video._media_slots._value  # Test-only exact permit observation.
        normalized = 0
        stored = 0
        frames = 0
        cancelled = False
        identifiers = set()

        async def thumbnail(name, index):
            nonlocal normalized, stored
            data = (folder / f"{name}.png").read_bytes()
            # Real method uses the unchanged two-worker executor and byte/pixel caps.
            variants = await storage._prepare_thumbnail_variants(data, "image/png")
            normalized += 1
            # Distinct synthetic identities; fake external storage, actual prepared bytes.
            recipe = UUID(int=100_000 + index)
            identifiers.add(recipe)
            result = await storage._store_thumbnail_variants(
                variants, recipe, media_lock_held=False
            )
            if not result:
                raise RuntimeError("legal_storage_failed")
            stored += 1

        async def media():
            nonlocal frames
            result = await video.extract_cover_frames(video_url("diagnostic", 90))
            if not result.success or not result.frames:
                raise RuntimeError("legal_frames_failed")
            frames += len(result.frames)

        async def pair(name, with_media=False):
            probe.barrier = threading.Barrier(2)
            workers = [create(thumbnail(name, 1)), create(thumbnail(name, 2))]
            await wait_thread(probe.entered)
            if with_media:
                workers.append(create(media()))
            await asyncio.gather(*workers)

        try:
            async with asyncio.timeout(60):
                if case == "single_rgba":
                    await thumbnail("rgba40", 1)
                elif case == "wide_rgba":
                    await thumbnail("wide40", 1)
                elif case in {
                    "two_rgba",
                    "two_palette",
                    "rgba_ffmpeg",
                    "palette_ffmpeg",
                }:
                    await pair(
                        "palette40" if "palette" in case else "rgba40", "ffmpeg" in case
                    )
                elif case == "alpha_cover_ffmpeg":
                    data = (folder / "alpha16.png").read_bytes()
                    candidate = CoverCandidate(
                        "synthetic_alpha", data, "platform_thumbnail"
                    )

                    async def cover():
                        def prepare():
                            probe.cover_active = True
                            try:
                                return _prepare([candidate], "youtube", 1)
                            finally:
                                probe.cover_active = False

                        prepared = await asyncio.to_thread(prepare)
                        if len(prepared) != 1:
                            raise RuntimeError("legal_cover_filtered")

                    await asyncio.gather(
                        create(cover()),
                        create(thumbnail("alpha16", 1)),
                        create(media()),
                    )
                elif case == "cancel_normalizer":
                    task = create(thumbnail("rgba40", 1))
                    await wait_thread(probe.entered)
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        cancelled = True
                    # The actual Python worker cannot be cancelled. Wait for it to settle.
                    await wait_thread(probe.idle, 45)
                elif case == "cancel_media":
                    task = create(media())
                    await asyncio.wait_for(probe.ffmpeg_started.wait(), 20)
                    if video._media_slots._value >= initial_slots or not any(
                        p.returncode is None for p in probe.children
                    ):
                        raise RuntimeError("legal_cancel_not_inflight")
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        cancelled = True
                elif case == "burst":
                    await asyncio.gather(
                        *(
                            create(thumbnail("palette40", index + 1))
                            for index in range(4)
                        )
                    )
                elif case == "retained_cycles":
                    for index in range(8):
                        await thumbnail(
                            "rgba40" if index % 2 == 0 else "palette40", index + 1
                        )
                else:
                    raise RuntimeError("legal_unknown_case")
            await wait_thread(probe.idle)
            result = {
                "completed": True,
                "normalized": normalized,
                "stored": stored,
                "distinct_recipe_count": len(identifiers),
                "frames": frames,
                "scene_calls": probe.scene_calls,
                "normalizer_peak": probe.peak,
                "normalizers_settled": probe.idle.is_set(),
                "cancelled": cancelled,
                "media_permits_restored": video._media_slots._value == initial_slots,
                "children_settled": all(
                    p.returncode is not None for p in probe.children
                ),
                "ffmpeg_overlap_observed": probe.overlap,
                "cover_ffmpeg_overlap_observed": probe.cover_overlap,
                "two_normalizers_ffmpeg_overlap_observed": probe.two_ffmpeg_overlap,
                "scene_child_count": probe.scene_child_count,
            }
            return result
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await wait_thread(probe.idle, 45)
            if probe.cover_active:
                raise RuntimeError("legal_cover_unsettled")
            current_probe = None
            _OPERATION.reset(token)

    @app.post("/capacity/legal/operation", dependencies=[Depends(identity)])
    async def legal_operation(body: OperationRequest):
        if semaphore.locked():
            raise HTTPException(429, "Synthetic operation already running")
        async with semaphore:
            started = time.monotonic()
            emit("legal_case", "baseline", "start", case_index=CASES.index(body.case))
            try:
                result = await operation(body.case)
                emit(
                    "legal_case",
                    "baseline",
                    "end",
                    case_index=CASES.index(body.case),
                    duration_ms=(time.monotonic() - started) * 1000,
                )
                return result
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - do not expose parser/provider errors
                emit(
                    "legal_case",
                    "baseline",
                    "failed",
                    case_index=CASES.index(body.case),
                    duration_ms=(time.monotonic() - started) * 1000,
                )
                raise HTTPException(500, "Synthetic legal operation failed") from None
