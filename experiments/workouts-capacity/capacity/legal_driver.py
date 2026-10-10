"""Bounded direct-helper matrix plus staggered protected real socket reads."""

import argparse
import asyncio
import json
import os
import time
from pathlib import Path

from capacity.driver import Driver
from capacity.legal_contract import CASES

LOAD_SECONDS = 300
DRAIN_SECONDS = 30
READER_COUNT = 8
READER_STAGGER_SECONDS = 2
READER_PERIOD_SECONDS = 16


def write_snapshot(output, value):
    temporary = Path(str(output) + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temporary, output)


async def run(directory, output):
    driver = Driver(directory)
    driver.phase = "baseline"  # Same already-warm API and instrumented methods.
    driver.begin_trace(output)
    results = {}
    completed = False
    readers = []
    failure = False
    stop_turns = asyncio.Event()

    def save():
        write_snapshot(
            output,
            {
                **driver.report(),
                "completed": completed,
                "failure_type": "matrix_incomplete" if failure else None,
                "cases": results,
            },
        )

    async def pause_or_stop(seconds):
        try:
            await asyncio.wait_for(stop_turns.wait(), timeout=seconds)
            return True
        except asyncio.TimeoutError:
            return False

    async def read(index):
        # Match all eight baseline readers: four calls/turn, 16-second period.
        if await pause_or_stop(index * READER_STAGGER_SECONDS):
            return
        while not stop_turns.is_set():
            started = time.monotonic()
            await driver.lightweight(index, False)
            save()
            if await pause_or_stop(
                max(0, READER_PERIOD_SECONDS - (time.monotonic() - started))
            ):
                return

    try:
        async with asyncio.timeout(LOAD_SECONDS):
            readers = [
                asyncio.create_task(read(index)) for index in range(READER_COUNT)
            ]
            for case in CASES:
                response = await driver.request(
                    "POST",
                    "/capacity/legal/operation",
                    label="capacity/legal-operation",
                    json={"case": case},
                )
                if response.status_code != 200:
                    raise RuntimeError("legal_operation_failed")
                if any(task.done() for task in readers):
                    raise RuntimeError("legal_protected_reader_failed")
                results[case] = response.json()
                save()
            stop_turns.set()
            await asyncio.wait_for(asyncio.gather(*readers), timeout=DRAIN_SECONDS)
            completed = True
    except BaseException:
        failure = True
        raise
    finally:
        stop_turns.set()
        for task in readers:
            task.cancel()
        await asyncio.gather(*readers, return_exceptions=True)
        try:
            save()  # Only after request cancellation/drain has recorded its outcomes.
        finally:
            if driver.trace_stream:
                driver.trace_stream.close()
            await driver.client.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default="/fixtures")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    asyncio.run(run(args.directory, args.output))
