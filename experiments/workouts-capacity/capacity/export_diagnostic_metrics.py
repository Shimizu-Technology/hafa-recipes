"""Fixed numeric inclusive spans. No SQL, payloads, identifiers or exceptions."""

import contextlib
import contextvars
import time

STAGES = {
    "build_total",
    "source_inventory",
    "size_guard",
    "source_fetch_decode",
    "projection",
    "json_encode",
    "aes_encrypt",
    "page_writer_commit",
    "finalization",
}
active = contextvars.ContextVar("export_diagnostic_active", default=None)
stack = contextvars.ContextVar("export_diagnostic_stack", default=())


class Metrics:
    def __init__(self, wall=time.monotonic, cpu=time.thread_time):
        self.wall, self.cpu = wall, cpu
        self.origin = wall()
        self.origin_timestamp = time.time()
        self.source = None
        self.finalization = None
        self.complete = False
        self.pages = 0
        self.queries = 0
        self.spans = []
        self.dropped = 0
        self.stats = {
            s: {
                "calls": 0,
                "completed": 0,
                "failed": 0,
                "query_count": 0,
                "inclusive_wall_ms": 0.0,
                "max_wall_ms": 0.0,
                "sync_thread_cpu_ms": 0.0,
                "bytes": 0,
            }
            for s in STAGES
        }

    def begin(self, stage, sync=False):
        if stage not in STAGES:
            raise ValueError("Unknown numeric diagnostic stage")
        self.stats[stage]["calls"] += 1
        return {
            "stage": stage,
            "start": self.wall(),
            "cpu": self.cpu() if sync else None,
            "queries": 0,
            "bytes": 0,
        }

    def end(self, frame, failed=False):
        elapsed = max(0, self.wall() - frame["start"]) * 1000
        cpu = (
            max(0, self.cpu() - frame["cpu"]) * 1000 if frame["cpu"] is not None else 0
        )
        row = self.stats[frame["stage"]]
        row["failed" if failed else "completed"] += 1
        row["inclusive_wall_ms"] += elapsed
        row["max_wall_ms"] = max(row["max_wall_ms"], elapsed)
        row["sync_thread_cpu_ms"] += cpu
        row["query_count"] += frame["queries"]
        row["bytes"] += frame["bytes"]
        # Hundreds of source SQL awaits stay aggregate-only. Larger stage spans
        # retain offsets; bounded counts prevent public output growth.
        if frame["stage"] != "source_fetch_decode":
            if len(self.spans) < 160:
                self.spans.append(
                    {
                        "stage": frame["stage"],
                        "offset_ms": max(0, frame["start"] - self.origin) * 1000,
                        "duration_ms": elapsed,
                        "query_count": frame["queries"],
                        "sync_thread_cpu_ms": cpu,
                        "failed": failed,
                    }
                )
            else:
                self.dropped += 1

    @contextlib.contextmanager
    def measure(self, stage, sync=False):
        frame = self.begin(stage, sync)
        token = stack.set((*stack.get(), frame))
        failed = True
        try:
            yield frame
            failed = False
        finally:
            stack.reset(token)
            self.end(frame, failed)

    def query(self):
        self.queries += 1
        for frame in stack.get():
            frame["queries"] += 1
        if self.finalization is not None:
            self.finalization["queries"] += 1

    def snapshot(self):
        return {
            "complete": self.complete,
            "pages": self.pages,
            "query_count": self.queries,
            "origin_timestamp": self.origin_timestamp,
            "inclusive_timings": True,
            "summed_nested_timings": False,
            "dropped_spans": self.dropped,
            "stages": self.stats,
            "spans": self.spans,
        }
