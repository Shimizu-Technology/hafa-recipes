"""Numeric GC/loop delay within the existing API, no observer process or heap data."""

import asyncio
import contextlib
import gc
import time

from capacity.events import emit


class Diagnostics:
    def __init__(self, phase, clock=time.monotonic):
        self.phase, self.clock = phase, clock
        self.task = None
        self.gc_started = {}
        self.gc_collections = 0
        self.gc_total_ms = self.gc_max_ms = 0.0
        self.pending_gc_max_ms = 0.0
        self.loop_samples = 0
        self.loop_max_ms = 0.0
        self.loop_over100ms = 0

    def collection(self, event, info):
        generation = info.get("generation")
        if generation not in (0, 1, 2):
            return
        if event == "start":
            self.gc_started[generation] = self.clock()
        elif event == "stop" and generation in self.gc_started:
            duration = max(0, self.clock() - self.gc_started.pop(generation)) * 1000
            self.gc_collections += 1
            self.gc_total_ms += duration
            self.gc_max_ms = max(self.gc_max_ms, duration)
            self.pending_gc_max_ms = max(self.pending_gc_max_ms, duration)

    def snapshot(self):
        return {
            "loop_samples": self.loop_samples,
            "loop_max_ms": self.loop_max_ms,
            "loop_over100ms": self.loop_over100ms,
            "gc_collections": self.gc_collections,
            "gc_total_ms": self.gc_total_ms,
            "gc_max_ms": self.gc_max_ms,
            "interval_ms": 250,
        }

    async def probe(self):
        while True:
            started = self.clock()
            await asyncio.sleep(0.25)
            lag = max(0, self.clock() - started - 0.25) * 1000
            self.loop_samples += 1
            self.loop_max_ms = max(self.loop_max_ms, lag)
            self.loop_over100ms += lag >= 100
            gc_pause = self.pending_gc_max_ms
            self.pending_gc_max_ms = 0.0
            if gc_pause >= 20:
                emit("gc_pause", self.phase, "end", duration_ms=gc_pause)
            if lag >= 20:
                emit("loop_lag", self.phase, "end", duration_ms=lag)

    async def start(self):
        gc.callbacks.append(self.collection)
        self.task = asyncio.create_task(
            self.probe(), name="capacity-numeric-loop-probe"
        )

    async def stop(self):
        if self.collection in gc.callbacks:
            gc.callbacks.remove(self.collection)
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    def install(self, app):
        app.router.add_event_handler("startup", self.start)
        app.router.add_event_handler("shutdown", self.stop)
