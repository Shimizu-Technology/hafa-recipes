"""One real export, unchanged protected Recipes cadence and five chat probes."""

import argparse
import asyncio
import json
import os
import signal
import time
from pathlib import Path

from capacity.driver import PREFIX, Driver
from capacity.safety import OWNERS

ROUTES = {
    "/up",
    "recipes/list",
    "recipes/detail",
    "recipes/search",
    "recipes/chat",
    "workouts/export-build",
    "workouts/export-page",
    "workouts/export-remove",
}

EXPORT_START_SECONDS = 48
CHAT_OFFSETS_SECONDS = (0, 32, 48.25, 96, 128)


class Probe(Driver):
    def __init__(self):
        super().__init__("/fixtures")
        self.origin = time.time()
        self.spans, self.pending = [], {}
        self.dropped = 0

    def trace(self, number, event, label, **values):
        if label not in ROUTES:
            return
        super().trace(number, event, label, **values)
        if event == "start":
            self.pending[number] = time.time()
        elif number in self.pending:
            start = self.pending.pop(number)
            if len(self.spans) < 384:
                self.spans.append(
                    {
                        "route": label,
                        "offset_ms": (start - self.origin) * 1000,
                        "duration_ms": values["milliseconds"],
                        "status": values.get("status", 0),
                    }
                )
            else:
                self.dropped += 1

    async def export(self):
        await asyncio.sleep(EXPORT_START_SECONDS)
        response = await self.request(
            "POST",
            PREFIX + "/export/snapshots",
            OWNERS[22],
            label="workouts/export-build",
            expected=(201,),
        )
        response.raise_for_status()
        manifest = response.json()
        if (
            manifest["page_count"] != 19
            or manifest["totals"]["workouts"] != 190
            or manifest["totals"]["workout_versions"] != 190
        ):
            raise RuntimeError("Exact diagnostic fixture required")
        self.manifest = manifest
        for page in range(19):
            response = await self.request(
                "GET",
                f"{PREFIX}/export/snapshots/{manifest['id']}/pages/{page}",
                OWNERS[22],
                label="workouts/export-page",
            )
            response.raise_for_status()
        removed = await self.request(
            "DELETE",
            PREFIX + "/export/snapshots/" + manifest["id"],
            OWNERS[22],
            label="workouts/export-remove",
            expected=(204,),
        )
        removed.raise_for_status()

    async def chat(self):
        response = await self.request("GET", "/api/recipes/?limit=1", OWNERS[0])
        identifier = response.json()["items"][0]["id"]
        for n in range(5):
            await asyncio.sleep(
                max(0, self.started + CHAT_OFFSETS_SECONDS[n] - time.monotonic())
            )
            response = await self.request(
                "POST",
                f"/api/recipes/{identifier}/chat",
                OWNERS[0],
                label="recipes/chat",
                json={"message": "How can I prepare this?"},
            )
            response.raise_for_status()

    async def readers(self, index):
        await asyncio.sleep(index * 2)
        until = self.started + 160
        while time.monotonic() < until:
            started = time.monotonic()
            await self.lightweight(index, False)
            await asyncio.sleep(max(0, 16 - (time.monotonic() - started)))


def save(path, report):
    target = Path(path)
    temporary = Path(str(target) + ".tmp")
    temporary.write_text(json.dumps(report, allow_nan=False))
    os.replace(temporary, target)


async def run(output):
    probe = Probe()
    probe.begin_trace(output)
    probe.trace_stream.write(json.dumps({"origin_timestamp": probe.origin}) + "\n")
    probe.trace_stream.flush()
    save(output, {"completed": False, "origin_timestamp": probe.origin})
    probe.started = time.monotonic()
    report = {"completed": False}
    tasks = []
    try:
        tasks = [asyncio.create_task(probe.readers(i)) for i in range(8)]
        tasks += [
            asyncio.create_task(probe.export()),
            asyncio.create_task(probe.chat()),
        ]
        async with asyncio.timeout(180):
            await asyncio.gather(*tasks)
            measurements = await probe.request(
                "GET", "/capacity/export-diagnostic", OWNERS[22]
            )
            status = await probe.request("GET", "/capacity/status")
            report.update(
                metrics=measurements.json(), status=status.json(), completed=True
            )
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # All in-flight requests have settled before the final atomic snapshot.
        report.update(
            routes=probe.report()["routes"],
            percentile_method="nearest_rank",
            spans=probe.spans,
            dropped_spans=probe.dropped,
            origin_timestamp=probe.origin,
            unsettled_requests=len(probe.pending),
        )
        save(output, report)
        probe.trace_stream.close()
        await probe.client.aclose()


async def entry(output):
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, task.cancel)
    try:
        await run(output)
    finally:
        loop.remove_signal_handler(signal.SIGTERM)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    asyncio.run(entry(args.output))


if __name__ == "__main__":
    try:
        main()
    except BaseException:  # noqa: BLE001 - never print response/URL/identifier/traceback
        raise SystemExit(2) from None
