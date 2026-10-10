"""Bounded direct-helper matrix plus staggered protected real socket reads."""

import argparse
import asyncio
import json
import os
import time
from pathlib import Path

from capacity.driver import Driver
from capacity.legal_contract import CASES


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

    async def read(index):
        # Match all eight baseline readers: four calls/turn, 16-second period.
        await asyncio.sleep(index * 2)
        while True:
            started = time.monotonic()
            await driver.lightweight(index, False)
            save()
            await asyncio.sleep(max(0, 16 - (time.monotonic() - started)))

    try:
        async with asyncio.timeout(300):
            readers = [asyncio.create_task(read(index)) for index in range(8)]
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
            completed = True
            save()
    except BaseException:
        failure = True
        save()
        raise
    finally:
        for task in readers:
            task.cancel()
        await asyncio.gather(*readers, return_exceptions=True)
        if driver.trace_stream:
            driver.trace_stream.close()
        await driver.client.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default="/fixtures")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    asyncio.run(run(args.directory, args.output))
