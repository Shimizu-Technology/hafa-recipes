"""Separate-container socket workloads. Reports metadata, never bodies or tokens."""

import argparse
import asyncio
import base64
import json
import time
from datetime import datetime
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx

from capacity.events import STAGES
from capacity.media_identity import video_url
from capacity.safety import OWNERS
from capacity.statistics import nearest_rank
from capacity.transport import TEXT

BASE = "http://127.0.0.1:18047"
PREFIX = "/api/v1/workouts"
REQUEST_LABELS = {
    "capacity/legal-operation",
    "/up",
    "recipes/list",
    "recipes/search",
    "recipes/detail",
    "recipes/text",
    "recipes/ocr",
    "recipes/manual-write",
    "recipes/video-submit",
    "recipes/chat-context",
    "recipes/chat",
    "recipes/job-poll",
    "capacity/checkpoint",
    "workouts/library",
    "workouts/activity-list",
    "workouts/activity-write",
    "workouts/coach",
    "workouts/manual-workout",
    "workouts/session-write",
    "workouts/session-replay",
    "workouts/import-submit",
    "workouts/import-poll",
    "workouts/import-accept",
    "workouts/export-build",
    "workouts/export-page",
    "workouts/export-remove",
    "workouts/bulk-boundary",
    "workouts/chunked-boundary",
    "workouts/oversized",
    "workouts/unauthenticated-boundary",
}
PROTECTED = {
    "/up",
    "recipes/list",
    "recipes/search",
    "recipes/detail",
    "recipes/chat",
    "recipes/manual-write",
}


class AcceptanceFailure(RuntimeError):
    pass


def protected_acceptance(report):
    routes = report["routes"]
    categories = {
        label: {
            "count": routes.get(label, {}).get("count", 0),
            "unexpected": routes.get(label, {}).get("unexpected", 0),
            "statuses": routes.get(label, {}).get("statuses", {}),
        }
        for label in sorted(PROTECTED)
    }
    failures = [
        label
        for label, row in categories.items()
        if row["count"] == 0 or row["unexpected"] or set(row["statuses"]) != {"200"}
    ]
    return {
        "passed": not failures,
        "failed_categories": failures,
        "categories": categories,
    }


def headers(owner):
    return {
        "X-Capacity-User": owner,
        "X-Hafa-Account-ID": owner,
        "X-Workouts-Generation": "1",
    }


def percentile(values, fraction):
    return nearest_rank(values, fraction)


class Driver:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.phase = "diagnostic"
        self.recipe_submission_ids = set()
        self.recipe_saved_links = set()
        self.checkpoints = {}
        self.results = []
        self.jobs = []
        self.recipe_jobs = []
        self.snapshots = []
        self.outcomes = {"workouts": {}, "recipes": {}, "accepted": set()}
        self.trace_stream = None
        self.phase = "diagnostic"
        self.request_number = 0
        self.client = httpx.AsyncClient(
            base_url=BASE, timeout=150, limits=httpx.Limits(max_connections=32)
        )

    def begin_trace(self, output):
        # Owned across concurrent reader tasks; run() closes it in finally.
        self.trace_stream = Path(str(output) + ".requests.jsonl").open("x")  # noqa: SIM115

    def trace(self, request_number, event, label, **numbers):
        if self.trace_stream:
            value = {
                "timestamp": time.time(),
                "phase": self.phase,
                "request_number": request_number,
                "event": event,
                "route": label if label in REQUEST_LABELS else "other",
                **numbers,
            }
            self.trace_stream.write(json.dumps(value) + "\n")
            self.trace_stream.flush()

    async def request(
        self,
        method,
        path,
        owner=OWNERS[0],
        *,
        label=None,
        expected=(200,),
        authenticated=True,
        **kwargs,
    ):
        started = time.monotonic()
        self.request_number += 1
        request_number = self.request_number
        self.trace(request_number, "start", label or path)
        try:
            response = await self.client.request(
                method, path, headers=headers(owner) if authenticated else {}, **kwargs
            )
            self.results.append(
                {
                    "route": label or path,
                    "milliseconds": (time.monotonic() - started) * 1000,
                    "status": response.status_code,
                    "expected": response.status_code in expected,
                    "bytes": len(response.content),
                }
            )
            self.trace(
                request_number,
                "end",
                label or path,
                status=response.status_code,
                milliseconds=(time.monotonic() - started) * 1000,
                bytes=len(response.content),
            )
            return response
        except BaseException:
            self.results.append(
                {
                    "route": label or path,
                    "milliseconds": (time.monotonic() - started) * 1000,
                    "status": 0,
                    "expected": False,
                    "bytes": 0,
                }
            )
            self.trace(
                request_number,
                "failed",
                label or path,
                status=0,
                milliseconds=(time.monotonic() - started) * 1000,
            )
            raise

    async def checkpoint(self, name):
        response = await self.request(
            "GET", "/capacity/status", label="capacity/checkpoint"
        )
        if response.status_code != 200:
            raise AcceptanceFailure("Synthetic metadata checkpoint unavailable")
        value = response.json()
        stages = value.get("stage_counts", {})
        counters = value.get("provider_attempts", {})
        counts = list(counters.values()) + [
            n for stage in stages.values() for n in stage.values()
        ]
        if (
            not value.get("synthetic")
            or set(counters) != {"extraction", "cover", "chat"}
            or set(stages) != STAGES
            or any(
                set(events) != {"start", "end", "failed"} for events in stages.values()
            )
            or any(type(n) is not int or not 0 <= n <= 1_000_000_000 for n in counts)
        ):
            raise AcceptanceFailure("Invalid synthetic metadata checkpoint")
        diagnostic = value.get("diagnostics", {})
        allowed = {
            "loop_samples",
            "loop_max_ms",
            "loop_over100ms",
            "gc_collections",
            "gc_total_ms",
            "gc_max_ms",
            "interval_ms",
        }
        if set(diagnostic) != allowed or any(
            type(n) not in (int, float) or not 0 <= n <= 1e12
            for n in diagnostic.values()
        ):
            raise AcceptanceFailure("Invalid numeric diagnostic metadata")
        self.checkpoints[name] = {
            "stage_counts": stages,
            "provider_attempts": counters,
            "diagnostics": diagnostic,
        }

    async def prepare(self):
        for owner in OWNERS:
            await self.request(
                "POST",
                PREFIX + "/enrollment",
                owner,
                json={
                    "adult_confirmed": True,
                    "shared_account_deletion_acknowledged": True,
                    "disclosure_version": 1,
                },
            )
            current = await self.request("GET", PREFIX + "/profile", owner)
            profile = current.json()
            if profile is None:
                saved = await self.client.put(
                    PREFIX + "/profile",
                    headers={
                        **headers(owner),
                        "If-Match": current.headers.get("X-Workouts-Revision", "0"),
                    },
                    json={
                        "adult_confirmed": True,
                        "equipment": [],
                        "available_days": [0, 2, 4],
                        "session_minutes": 30,
                        "timezone": "Pacific/Guam",
                        "readiness": "ready",
                    },
                )
                if saved.status_code != 200:
                    raise RuntimeError("Synthetic profile preparation failed")
            consent = await self.request(
                "PUT",
                PREFIX + "/ai-consent",
                owner,
                json={"accepted": True, "disclosure_version": 1},
            )
            if consent.status_code != 200:
                raise RuntimeError("Synthetic consent preparation failed")

    async def lightweight(self, index, mixed):
        owner = OWNERS[index % 22]
        await self.request("GET", "/up")
        listing = await self.request(
            "GET", "/api/recipes/?limit=20", owner, label="recipes/list"
        )
        await self.request(
            "GET", "/api/recipes/search?q=rice&limit=20", owner, label="recipes/search"
        )
        recipes = listing.json().get("items", []) if listing.status_code == 200 else []
        if recipes:
            await self.request(
                "GET", "/api/recipes/" + recipes[0]["id"], owner, label="recipes/detail"
            )
        if mixed:
            await self.request(
                "GET", PREFIX + "/library?limit=20", owner, label="workouts/library"
            )
            await self.request(
                "GET",
                PREFIX + "/activity-log?limit=50",
                owner,
                label="workouts/activity-list",
            )
        return recipes

    async def media_and_chat(self, index, mixed):
        owner = OWNERS[index % 22]
        await self.request(
            "POST",
            "/api/extract/text",
            owner,
            label="recipes/text",
            json={"text": "Cook one cup of rice with two cups of water. Serves two."},
        )
        with (self.directory / "normal.jpg").open("rb") as image:
            await self.request(
                "POST",
                "/api/extract/ocr",
                owner,
                label="recipes/ocr",
                files={"image": ("fixture.jpg", image, "image/jpeg")},
            )
        from capacity.transport import recipe

        await self.request(
            "POST",
            "/api/recipes/manual",
            owner,
            label="recipes/manual-write",
            data={"recipe_data": json.dumps(recipe())},
        )
        job = await self.request(
            "POST",
            "/api/extract/async",
            owner,
            label="recipes/video-submit",
            expected=(200, 202),
            json={
                "url": video_url(self.phase, index),
                "location": "Guam",
                "is_public": False,
            },
        )
        if job.status_code in (200, 202):
            identifier = job.json().get("job_id")
            if not identifier or identifier in self.recipe_submission_ids:
                raise AcceptanceFailure(
                    "Cold synthetic media did not create a distinct job"
                )
            self.recipe_submission_ids.add(identifier)
            self.recipe_jobs.append((owner, identifier))
        listing = await self.request(
            "GET", "/api/recipes/?limit=1", owner, label="recipes/chat-context"
        )
        if listing.status_code == 200 and listing.json().get("items"):
            identifier = listing.json()["items"][0]["id"]
            await self.request(
                "POST",
                f"/api/recipes/{identifier}/chat",
                owner,
                label="recipes/chat",
                json={"message": "How can I prepare this?"},
            )
        if not mixed:
            return
        today = datetime.now(ZoneInfo("Pacific/Guam")).date().isoformat()
        await self.request(
            "POST",
            PREFIX + "/activity-log",
            owner,
            label="workouts/activity-write",
            expected=(201,),
            json={
                "request_id": str(uuid4()),
                "kind": "walk",
                "date": today,
                "duration_minutes": 20,
                "strenuous": False,
            },
        )
        await self.request(
            "POST",
            PREFIX + "/coach/messages",
            owner,
            label="workouts/coach",
            json={
                "request_id": str(uuid4()),
                "message": "Help me understand my saved training.",
            },
        )
        source = {"kind": "text", "text": TEXT, "ai_consent": True}
        if index % 3 == 1:
            source = {
                "kind": "images",
                "images": [
                    {
                        "base64_data": base64.b64encode(
                            (self.directory / "workout-image.jpg").read_bytes()
                        ).decode(),
                        "mime_type": "image/jpeg",
                    }
                ],
                "ai_consent": True,
            }
        elif index % 3 == 2:
            source = {
                "kind": "document",
                "document_base64": base64.b64encode(
                    (self.directory / "source-30.pdf").read_bytes()
                ).decode(),
                "document_mime": "application/pdf",
                "ai_consent": True,
            }
        from capacity.transport import workout

        template = workout()
        template["provenance"] = "user"
        saved = await self.request(
            "POST",
            PREFIX + "/library",
            owner,
            label="workouts/manual-workout",
            expected=(201,),
            json=template,
        )
        if saved.status_code == 201:
            from datetime import timedelta, timezone

            finished = datetime.now(timezone.utc)
            actual = {
                "client_session_id": str(uuid4()),
                "workout_id": saved.json()["id"],
                "workout_revision": saved.json()["revision"],
                "started_at": (finished - timedelta(seconds=10)).isoformat(),
                "finished_at": finished.isoformat(),
                "activity_type": "general_fitness",
                "active_seconds": 10,
                "status": "completed",
                "actuals": [
                    {
                        "block_id": "main",
                        "exercise_index": 0,
                        "round_index": 1,
                        "set_index": n,
                        "side": None,
                        "completed": True,
                        "reps": 12,
                        "difficulty": "manageable",
                        "pain_reported": False,
                    }
                    for n in range(1, 4)
                ],
                "notes": "Explicit synthetic capacity actuals; not real exercise.",
            }
            first_actual = await self.request(
                "POST",
                PREFIX + "/sessions",
                owner,
                label="workouts/session-write",
                expected=(200, 201),
                json=actual,
            )
            replayed_actual = await self.request(
                "POST",
                PREFIX + "/sessions",
                owner,
                label="workouts/session-replay",
                expected=(200,),
                json=actual,
            )
            if (
                first_actual.status_code in (200, 201)
                and replayed_actual.status_code == 200
                and first_actual.json()["id"] != replayed_actual.json()["id"]
            ):
                raise RuntimeError("Synthetic session replay duplicated its record")
        request_id = str(uuid4())
        created = await self.request(
            "POST",
            PREFIX + "/imports",
            owner,
            label="workouts/import-submit",
            expected=(202, 429),
            json={"request_id": request_id, "source": source},
        )
        if created.status_code == 202:
            self.jobs.append((owner, created.json()["id"], request_id))
        snapshot = await self.request(
            "POST",
            PREFIX + "/export/snapshots",
            OWNERS[22],
            label="workouts/export-build",
            expected=(201, 429),
        )
        if snapshot.status_code == 201:
            manifest = snapshot.json()
            for page in range(manifest["page_count"]):
                response = await self.request(
                    "GET",
                    f"{PREFIX}/export/snapshots/{manifest['id']}/pages/{page}",
                    OWNERS[22],
                    label="workouts/export-page",
                    expected=(200, 429),
                )
                if response.status_code != 200:
                    break
            await self.request(
                "DELETE",
                f"{PREFIX}/export/snapshots/{manifest['id']}",
                OWNERS[22],
                label="workouts/export-remove",
                expected=(204,),
            )

    async def poll(self):
        for owner, identifier, _ in self.jobs:
            job = await self.request(
                "GET",
                PREFIX + "/imports/" + identifier,
                owner,
                label="workouts/import-poll",
            )
            if job.status_code != 200:
                continue
            self.outcomes["workouts"][identifier] = job.json()["status"]
            if job.json()["status"] in {"ready", "incomplete"} and job.json().get(
                "result", {}
            ).get("workout"):
                accepted = await self.request(
                    "POST",
                    PREFIX + "/imports/" + identifier + "/accept",
                    owner,
                    label="workouts/import-accept",
                    json={"acknowledge_warnings": True},
                )
                if accepted.status_code != 200:
                    raise AcceptanceFailure(
                        "Reviewed source could not be accepted; stop repeated retries"
                    )
                self.outcomes["accepted"].add(accepted.json()["id"])
        for owner, identifier in self.recipe_jobs:
            if identifier:
                current = await self.request(
                    "GET", "/api/jobs/" + identifier, owner, label="recipes/job-poll"
                )
                if current.status_code == 200:
                    self.outcomes["recipes"][identifier] = current.json()["status"]
                    if current.json()["status"] == "completed":
                        saved_id = current.json().get("recipe_id")
                        if not saved_id:
                            raise AcceptanceFailure(
                                "Completed cold media job has no saved recipe link"
                            )
                        self.recipe_saved_links.add(saved_id)

    async def boundaries(self, concurrency=8):
        raw = (self.directory / "near-body.json").read_text()
        body = json.loads(raw)

        async def upload(index):
            value = json.dumps({"request_id": str(uuid4()), **body}).encode()
            value += b" " * (3 * 1024 * 1024 - 128 - len(value))
            return await self.request(
                "POST",
                PREFIX + "/imports",
                OWNERS[index % 22],
                label="workouts/bulk-boundary",
                expected=(202, 429),
                content=value,
            )

        await asyncio.gather(*(upload(index) for index in range(concurrency)))
        await self.request(
            "POST",
            PREFIX + "/imports",
            label="workouts/oversized",
            expected=(413,),
            content=b"x" * (3 * 1024 * 1024 + 1),
        )

        async def chunked():
            value = json.dumps({"request_id": str(uuid4()), **body}).encode()
            value += b" " * (3 * 1024 * 1024 - 128 - len(value))
            for offset in range(0, len(value), 65536):
                yield value[offset : offset + 65536]
                await asyncio.sleep(0)

        await self.request(
            "POST",
            PREFIX + "/imports",
            label="workouts/chunked-boundary",
            expected=(202, 429),
            content=chunked(),
        )
        await self.request(
            "POST",
            PREFIX + "/imports",
            label="workouts/unauthenticated-boundary",
            expected=(401, 429),
            authenticated=False,
            content=json.dumps({"request_id": str(uuid4()), **body}).encode(),
        )
        await self.request(
            "POST",
            PREFIX + "/export/snapshots",
            OWNERS[23],
            label="workouts/export-oversized",
            expected=(413, 429),
        )

    async def restart_prepare(self, state_file):
        owner = OWNERS[0]
        payload = {
            "request_id": str(uuid4()),
            "source": {"kind": "text", "text": TEXT, "ai_consent": True},
        }
        response = await self.request(
            "POST",
            PREFIX + "/imports",
            owner,
            label="workouts/restart-submit",
            expected=(202,),
            json=payload,
        )
        if response.status_code != 202:
            raise RuntimeError("Restart fixture could not be admitted")
        identifier = response.json()["id"]
        for _ in range(100):
            current = await self.request(
                "GET",
                PREFIX + "/imports/" + identifier,
                owner,
                label="workouts/restart-poll",
            )
            if current.json()["status"] == "processing":
                Path(state_file).write_text(
                    json.dumps(
                        {
                            "owner": owner,
                            "generation": 1,
                            "id": identifier,
                            "payload": payload,
                            "synthetic": True,
                        }
                    )
                )
                return
            if current.json()["status"] in {"ready", "incomplete", "failed"}:
                raise RuntimeError(
                    "Job finished before fault; rerun with provider delay10s"
                )
            await asyncio.sleep(0.1)
        raise RuntimeError("Worker never reached processing")

    async def restart_check(self, state_file):
        state = json.loads(Path(state_file).read_text())
        if (
            state.get("synthetic") is not True
            or state["owner"] not in OWNERS
            or state["generation"] != 1
        ):
            raise RuntimeError("Invalid owned restart state")
        response = await self.request(
            "POST",
            PREFIX + "/imports",
            state["owner"],
            label="workouts/restart-replay",
            expected=(202,),
            json=state["payload"],
        )
        if response.json()["id"] != state["id"]:
            raise RuntimeError("Restart replay created a duplicate job")
        deadline = time.monotonic() + 360
        while time.monotonic() < deadline:
            current = await self.request(
                "GET",
                PREFIX + "/imports/" + state["id"],
                state["owner"],
                label="workouts/restart-poll",
            )
            value = current.json()
            if value["status"] in {"ready", "incomplete"} and value.get(
                "result", {}
            ).get("workout"):
                accepted = await self.request(
                    "POST",
                    PREFIX + "/imports/" + state["id"] + "/accept",
                    state["owner"],
                    label="workouts/restart-accept",
                    json={"acknowledge_warnings": True},
                )
                replay = await self.request(
                    "POST",
                    PREFIX + "/imports/" + state["id"] + "/accept",
                    state["owner"],
                    label="workouts/restart-accept-replay",
                    json={"acknowledge_warnings": True},
                )
                if accepted.json()["id"] != replay.json()["id"]:
                    raise RuntimeError("Restart acceptance duplicated the result")
                return
            if value["status"] in {"failed", "expired", "cancelled"}:
                raise RuntimeError("Interrupted source did not recover successfully")
            await asyncio.sleep(5)
        raise RuntimeError("Default300s lease did not recover inside360s")

    async def backpressure(self):
        owner = OWNERS[22]
        snapshot = await self.request(
            "POST",
            PREFIX + "/export/snapshots",
            owner,
            label="workouts/backpressure-build",
            expected=(201,),
        )
        if snapshot.status_code != 201:
            raise RuntimeError("Backpressure export could not be built")
        identifier = snapshot.json()["id"]
        import socket

        sock = socket.socket()
        sock.setblocking(False)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8192)
        await asyncio.get_running_loop().sock_connect(sock, ("127.0.0.1", 18047))
        reader, writer = await asyncio.open_connection(sock=sock, limit=8192)
        try:
            path = f"{PREFIX}/export/snapshots/{identifier}/pages/0"
            header_lines = "".join(
                f"{key}: {value}\r\n" for key, value in headers(owner).items()
            )
            writer.write(
                f"GET {path} HTTP/1.1\r\nHost: localhost\r\n{header_lines}Connection: close\r\n\r\n".encode()
            )
            await writer.drain()
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
            if not head.startswith(b"HTTP/1.1 200"):
                raise RuntimeError("Throttled page was not admitted")
            # StreamReader and SO_RCVBUF are small; leave the page unread while
            # checking the actual cross-replica response slot through sockets.
            secondary = await self.request(
                "GET",
                f"{PREFIX}/export/snapshots/{identifier}",
                owner,
                label="workouts/backpressure-denial",
                expected=(429,),
            )
            if secondary.status_code != 429:
                raise RuntimeError(
                    "Response already drained; fixture did not create backpressure"
                )
            await asyncio.sleep(
                32
            )  # Production response deadline30s, no altered clock.
        finally:
            writer.close()
            await writer.wait_closed()
        recovered = await self.request(
            "GET",
            f"{PREFIX}/export/snapshots/{identifier}",
            owner,
            label="workouts/backpressure-recovery",
        )
        if recovered.status_code != 200:
            raise RuntimeError("Response slot did not recover after stalled client")
        await self.request(
            "DELETE",
            f"{PREFIX}/export/snapshots/{identifier}",
            owner,
            label="workouts/export-remove",
            expected=(204,),
        )

    def report(self):
        grouped = {}
        for row in self.results:
            grouped.setdefault(row["route"], []).append(row)
        return {
            "percentile_method": "nearest_rank",
            "synthetic_providers": True,
            "auth_whitelist": True,
            "r04_closed": False,
            "saved_outcomes": {
                "accepted_workout_count": len(self.outcomes["accepted"]),
                "distinct_recipe_jobs_submitted": len(self.recipe_submission_ids),
                "distinct_saved_recipe_links": len(self.recipe_saved_links),
                "stage_checkpoints": self.checkpoints,
                **{
                    kind + "_states": {
                        state: list(self.outcomes[kind].values()).count(state)
                        for state in set(self.outcomes[kind].values())
                    }
                    for kind in ["workouts", "recipes"]
                },
            },
            "routes": {
                route: {
                    "count": len(rows),
                    "p50_ms": percentile([r["milliseconds"] for r in rows], 0.5),
                    "p95_ms": percentile([r["milliseconds"] for r in rows], 0.95),
                    "p99_ms": percentile([r["milliseconds"] for r in rows], 0.99),
                    "unexpected": sum(not r["expected"] for r in rows),
                    "statuses": {
                        str(status): sum(r["status"] == status for r in rows)
                        for status in {r["status"] for r in rows}
                    },
                }
                for route, rows in grouped.items()
            },
        }


async def run(args):
    if Path(args.output).exists():
        raise RuntimeError(
            "Use a new phase output; historical evidence cannot be replaced"
        )
    driver = Driver(args.fixtures)
    completed = False
    failure_type = None
    try:
        driver.phase = (
            "baseline"
            if args.profile == "recipes-baseline"
            else "mixed"
            if args.profile == "mixed"
            else "boundaries"
            if args.profile == "upload-boundaries"
            else "diagnostic"
        )
        driver.begin_trace(args.output)
        if args.profile in {"recipes-baseline", "mixed"}:
            await driver.checkpoint("before")
        if args.profile != "recipes-baseline":
            await driver.prepare()
        if args.profile == "upload-boundaries":
            await driver.boundaries(args.concurrency)
        elif args.profile == "restart-prepare":
            await driver.restart_prepare(args.state)
        elif args.profile == "restart-check":
            await driver.restart_check(args.state)
        elif args.profile == "export-backpressure":
            await driver.backpressure()
        else:
            deadline = time.monotonic() + args.seconds
            mixed = args.profile == "mixed"
            driver.results.clear()  # Setup is recorded separately, not protected-route latency.

            async def reader(index):
                await asyncio.sleep(index * (3 if mixed else 2))
                while time.monotonic() < deadline:
                    started = time.monotonic()
                    await driver.lightweight(index, mixed)
                    # Eight readers, 4 or 6 HTTP calls/turn: approximately 2 req/s.
                    await asyncio.sleep(
                        max(0, (24 if mixed else 16) - (time.monotonic() - started))
                    )

            async def heavy():
                index = 0
                while time.monotonic() < deadline:
                    started = time.monotonic()
                    await driver.media_and_chat(index, mixed)
                    index += 1
                    await asyncio.sleep(max(0, 60 - (time.monotonic() - started)))

            async def polling():
                while time.monotonic() < deadline:
                    await driver.poll()
                    await asyncio.sleep(5)

            await asyncio.gather(*(reader(n) for n in range(8)), heavy(), polling())
            await driver.poll()
        if args.profile in {"recipes-baseline", "mixed"}:
            await driver.checkpoint("after")
            report = driver.report()
            if any(row["unexpected"] for row in report["routes"].values()):
                raise AcceptanceFailure("Unexpected status in mixed/baseline workload")
            stages = driver.checkpoints["after"]["stage_counts"]
            before = driver.checkpoints["before"]["stage_counts"]
            for stage in ("evidence_frames", "cover_frames", "cover_compare"):
                if stages.get(stage, {}).get("end", 0) <= before.get(stage, {}).get(
                    "end", 0
                ):
                    raise AcceptanceFailure(
                        "Cold media frame/cover work was not observed"
                    )
            if not driver.recipe_submission_ids or len(
                driver.outcomes["recipes"]
            ) != len(driver.recipe_submission_ids):
                raise AcceptanceFailure("Cold media saved outcomes are missing")
            if len(driver.recipe_saved_links) != len(driver.recipe_submission_ids):
                raise AcceptanceFailure("Cold media saved links are not distinct")
            if any(
                state != "completed" for state in driver.outcomes["recipes"].values()
            ):
                raise AcceptanceFailure("Cold media jobs have not drained")
        completed = True
        if (
            args.profile in {"recipes-baseline", "mixed"}
            and not protected_acceptance(driver.report())["passed"]
        ):
            raise AcceptanceFailure("Protected category missing or non-200 response")
    except BaseException as exc:
        # Preserve cancellation/transport failure while retaining partial numeric
        # evidence. Never serialize provider messages, source payloads or URLs.
        failure_type = type(exc).__name__
        raise
    finally:
        try:
            report = driver.report()
            report.update(completed=completed, failure_type=failure_type)
            if args.profile in {"recipes-baseline", "mixed"}:
                report["protected_acceptance"] = protected_acceptance(report)
            Path(args.output).write_text(json.dumps(report, indent=2))
            print(
                json.dumps(
                    {
                        "report_written": True,
                        "completed": completed,
                        "failure_type": failure_type,
                        "unexpected": sum(
                            r["unexpected"] for r in report["routes"].values()
                        ),
                    }
                )
            )
        finally:
            if driver.trace_stream:
                driver.trace_stream.close()
            await driver.client.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--profile",
        choices=[
            "recipes-baseline",
            "mixed",
            "upload-boundaries",
            "restart-prepare",
            "restart-check",
            "export-backpressure",
        ],
        required=True,
    )
    parser.add_argument("--seconds", type=int, default=300)
    parser.add_argument("--concurrency", type=int, choices=[4, 8, 16], default=8)
    parser.add_argument("--state", default="/results/restart-state.json")
    parser.add_argument("--fixtures", default="/fixtures")
    parser.add_argument("--output", default="/results/latency.json")
    args = parser.parse_args()
    if not 1 <= args.seconds <= 3600:
        raise SystemExit("Use a bounded1–3600second workload duration")
    asyncio.run(run(args))
