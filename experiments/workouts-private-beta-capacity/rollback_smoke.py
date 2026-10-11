"""Existing urllib read smoke and exact row fingerprints; no source body output."""

import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

import asyncpg
from capacity.safety import DATABASE_URL, OWNERS, ensure

ensure()


async def fingerprint():
    db = await asyncpg.connect(DATABASE_URL)
    try:
        ledger = await db.fetchval(
            "SELECT array_agg(version ORDER BY version) FROM workouts_schema_migrations"
        )
        if ledger != list(range(34, 45)):
            raise RuntimeError("Expected complete optional034–044 ledger")
        tables = await db.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'workouts_%' ORDER BY tablename"
        )
        result = {}
        for item in tables:
            name = item["tablename"]
            # Only the independently seeded optional domain's identifiers.
            if not name.replace("_", "").isalnum() or not name.startswith("workouts_"):
                raise RuntimeError("Unexpected synthetic table identifier")
            row = await db.fetchrow(
                f'''SELECT count(*) AS count, md5(COALESCE(string_agg(hash,'' ORDER BY hash),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) AS hash FROM "{name}" t) hashed_rows'''
            )
            result[name] = dict(row)
        if not result or "workouts_export_jobs" in result:
            raise RuntimeError("Expected pre045 expanded schema")
        return result
    finally:
        await db.close()


def read(path):
    with urlopen(
        Request(
            "http://127.0.0.1:18047" + path, headers={"X-Capacity-User": OWNERS[0]}
        ),
        timeout=5,
    ) as response:
        assert response.status == 200
        return json.load(response)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("fingerprint", "smoke"))
    parser.add_argument("--output", required=True)
    parser.add_argument("--before")
    args = parser.parse_args()
    if Path(args.output).exists():
        raise RuntimeError("Fresh rollback receipt required")
    if args.mode == "fingerprint":
        value = asyncio.run(fingerprint())
    else:
        assert os.environ["WORKOUTS_API_ENABLED"] == "false"
        assert read("/up") == {"status": "ok"}
        products = read("/api/v1/platform")["products"]
        assert next(p for p in products if p["id"] == "recipes")["available"]
        assert not next(p for p in products if p["id"] == "workouts")["available"]
        listing = read("/api/recipes/?limit=1")
        assert listing["items"]
        read("/api/recipes/search?q=rice&limit=20")
        read("/api/recipes/" + listing["items"][0]["id"])
        before = json.loads(Path(args.before).read_text())
        after = asyncio.run(fingerprint())
        value = {
            "five_recipe_reads_passed": True,
            "workouts_data_preserved": before == after,
            "table_count": len(after),
            "rows": sum(row["count"] for row in after.values()),
        }
        assert value["workouts_data_preserved"]
    Path(args.output).write_text(json.dumps(value, indent=2) + "\n")
