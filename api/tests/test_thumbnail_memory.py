"""Actual image pipelines in fresh processes, with no provider or storage writes."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

PROGRAM = r"""
import asyncio, json, os, resource, subprocess, sys
from pathlib import Path
from app.services.storage import StorageService
from app.services.cover_selection import CoverCandidate, _prepare

def resident():
    if sys.platform == 'linux':
        return int(Path('/proc/self/statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE')
    return int(subprocess.check_output(['ps', '-o', 'rss=', '-p', str(os.getpid())])) * 1024
def peak():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024)

data=Path(sys.argv[1]).read_bytes()
baseline, initial_peak = resident(), peak()
retained=[]
async def run():
    for iteration in range(8):
        if sys.argv[2]=='thumbnail':
            rows=await StorageService()._prepare_thumbnail_variants(data, 'image/jpeg')
            assert (rows['hero'].width, rows['hero'].height)==(1280,1280)
            assert (rows['list'].width, rows['list'].height)==(640,640)
            assert len(rows['hero'].data)<=500*1024 and len(rows['list'].data)<=200*1024
            del rows
        else:
            candidate=CoverCandidate('source',data,'platform_thumbnail')
            rows=await asyncio.to_thread(_prepare,[candidate],'youtube',8)
            assert len(rows)==1 and rows[0].candidate is candidate
            del rows, candidate
        retained.append(resident())
asyncio.run(run())
print(json.dumps({'peak_increment':peak()-initial_peak,'retained_increment':max(retained)-baseline,
                 'repeat_growth':retained[-1]-retained[0]}))
"""


@pytest.mark.skipif(sys.platform not in {"darwin", "linux"}, reason="RSS probe supports API Linux and local macOS")
@pytest.mark.parametrize("pipeline", ["thumbnail", "cover"])
def test_16mp_jpeg_pipeline_peak_and_repeated_retention_are_bounded(tmp_path, pipeline):
    path = tmp_path / "large.jpg"
    with Image.new("RGB", (4000, 4000), (225, 165, 55)) as image:
        draw = ImageDraw.Draw(image)
        for y in range(0, 4000, 80):
            for x in range(0, 4000, 80):
                if (x // 80 + y // 80) % 2:
                    draw.rectangle((x, y, x + 79, y + 79), fill=(60, 125, 180))
        image.save(path, format="JPEG", quality=85)
    assert path.stat().st_size < 5 * 1024 * 1024
    environment = os.environ | {
        "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
        "DATABASE_URL": "postgresql://test:test@127.0.0.1:1/hafa_recipes_thumbnail_memory_test",
        "OPENAI_API_KEY": "synthetic-thumbnail-test-key",
        "ENVIRONMENT": "test",
        "S3_ENABLED": "false",
        "SENTRY_DSN": "",
    }
    result = subprocess.run(
        [sys.executable, "-c", PROGRAM, str(path), pipeline],
        env=environment,
        capture_output=True,
        text=True,
        timeout=45,
        check=True,
    )
    measured = json.loads(result.stdout.strip().splitlines()[-1])
    # The previous full-size copy chain used ~200 MiB additional memory for
    # this same16MP geometry. These are process increments, not Render RSS gates.
    assert measured["peak_increment"] < 100 * 1024 * 1024, measured
    assert measured["retained_increment"] < 100 * 1024 * 1024, measured
    assert measured["repeat_growth"] < 32 * 1024 * 1024, measured
