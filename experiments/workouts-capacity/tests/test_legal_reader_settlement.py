"""Actual request bookkeeping with held HTTP transport; no sockets/providers."""

import asyncio
import json

import httpx
import pytest
from capacity import legal_driver
from capacity.driver import BASE, Driver
from capacity.legal_contract import BOOLEANS, CASES, COUNTS


async def prepared(tmp_path, monkeypatch):
    driver = Driver(tmp_path)
    await driver.client.aclose()
    held = asyncio.Event()
    release = asyncio.Event()
    final_case = asyncio.Event()
    up_count = 0
    cases_count = 0

    async def response(request):
        nonlocal up_count, cases_count
        if request.url.path == "/up":
            up_count += 1
            if up_count == 9:  # A later turn after all eight healthy readers.
                held.set()
                await release.wait()
            return httpx.Response(200, json={"status": "healthy"})
        if request.url.path == "/capacity/legal/operation":
            cases_count += 1
            case = json.loads(request.content)["case"]
            if cases_count == len(CASES):
                await held.wait()
                final_case.set()
            value = {
                **dict.fromkeys(BOOLEANS, True),
                **dict.fromkeys(
                    ("normalized", "stored", "distinct_recipe_count"), COUNTS[case]
                ),
                "normalizer_peak": 2,
                "frames": 1,
                "scene_calls": 1,
                "scene_child_count": 1,
            }
            return httpx.Response(200, json=value)
        if request.url.path == "/api/recipes/":
            return httpx.Response(200, json={"items": [{"id": "synthetic"}]})
        return httpx.Response(200, json={"synthetic": True})

    driver.client = httpx.AsyncClient(
        base_url=BASE, transport=httpx.MockTransport(response)
    )
    monkeypatch.setattr(legal_driver, "Driver", lambda _: driver)
    monkeypatch.setattr(legal_driver, "READER_STAGGER_SECONDS", 0)
    monkeypatch.setattr(legal_driver, "READER_PERIOD_SECONDS", 0.02)
    return driver, held, release, final_case


@pytest.mark.asyncio
async def test_final_case_does_not_omit_held_up_read_and_drains_before_success(
    tmp_path, monkeypatch
):
    driver, held, release, final = await prepared(tmp_path, monkeypatch)
    output = tmp_path / "legal.json"
    task = asyncio.create_task(legal_driver.run(tmp_path, output))
    try:
        await asyncio.wait_for(final.wait(), 2)
        assert held.is_set() and not task.done()
        before = json.loads(output.read_text())
        assert not before["completed"]
        release.set()
        await asyncio.wait_for(task, 2)
        after = json.loads(output.read_text())
        assert after["completed"] and after["failure_type"] is None
        up = after["routes"]["/up"]
        actual_up = [row for row in driver.results if row["route"] == "/up"]
        assert up["count"] == len(actual_up) >= 9
        assert up["unexpected"] == 0 and set(up["statuses"]) == {"200"}
        assert driver.client.is_closed and driver.trace_stream.closed
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("interruption", ["drain_deadline", "load_deadline", "cancel"])
@pytest.mark.asyncio
async def test_interruption_settles_and_saves_cancelled_request_as_failure(
    tmp_path, monkeypatch, interruption
):
    driver, _held, _release, final = await prepared(tmp_path, monkeypatch)
    monkeypatch.setattr(
        legal_driver, "DRAIN_SECONDS", 0.02 if interruption == "drain_deadline" else 30
    )
    monkeypatch.setattr(
        legal_driver, "LOAD_SECONDS", 0.05 if interruption == "load_deadline" else 300
    )
    output = tmp_path / "legal.json"
    task = asyncio.create_task(legal_driver.run(tmp_path, output))
    await asyncio.wait_for(final.wait(), 2)
    if interruption == "cancel":
        task.cancel()
    with pytest.raises((TimeoutError, asyncio.CancelledError)):
        await asyncio.wait_for(task, 2)
    after = json.loads(output.read_text())
    assert not after["completed"] and after["failure_type"] == "matrix_incomplete"
    assert after["routes"]["/up"]["statuses"]["0"] == 1
    assert after["routes"]["/up"]["unexpected"] == 1
    assert after["routes"]["/up"]["count"] == len(
        [row for row in driver.results if row["route"] == "/up"]
    )
    assert driver.client.is_closed and driver.trace_stream.closed
    events = [
        json.loads(line)
        for line in (tmp_path / "legal.json.requests.jsonl").read_text().splitlines()
    ]
    assert any(
        event["route"] == "/up" and event["event"] == "failed" and event["status"] == 0
        for event in events
    )
