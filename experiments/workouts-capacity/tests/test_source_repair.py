"""Actual source/schema/handler checks, synthetic provider and storage only."""

import subprocess
import sys

from capacity import plan
from capacity.fixtures import generate
from capacity.media_identity import is_fixture_url, video_url
from capacity.source_facts import IMAGE_FACTS, PDF_FACTS, source_response


def test_image_evidence_reads_actual_location_without_guessing_ordinal():
    for index in (0, 1, 7):
        content = [
            {"type": "text", "text": f"Source location image:{index}"},
            {"type": "image_url", "image_url": {"url": "synthetic-only"}},
        ]
        raw = source_response(content)
        ex = raw["blocks"][0]["exercises"][0]
        assert ex["name"] == IMAGE_FACTS["name"]
        assert {e["location"] for e in ex["evidence"]} == {f"image:{index}"}
        assert ex["sets"] != PDF_FACTS["sets"]


def test_phase_video_identity_changes_canonical_identity_not_tracking_query():
    env = plan.environment()
    env["PYTHONPATH"] = "api:experiments/workouts-capacity"
    code = """
from capacity.media_identity import video_url,is_fixture_url
from app.source_urls import canonicalize_source
for index in range(5):
 b=video_url('baseline',index);m=video_url('mixed',index)
 assert len(b.split('v=')[1])==11 and is_fixture_url(b) and is_fixture_url(m)
 assert canonicalize_source(b).key != canonicalize_source(m).key
 assert canonicalize_source(b+'&utm_source=test').key == canonicalize_source(b).key
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert video_url("baseline", 0) != video_url("mixed", 0)
    assert not is_fixture_url(video_url("mixed", 0) + "&tracking=test")


def test_real_source_pipeline_and_import_review_contract_without_db_or_network(
    tmp_path,
):
    generate(tmp_path, media=False)
    env = plan.environment()
    env["PYTHONPATH"] = "api:experiments/workouts-capacity"
    env["CAPACITY_TEST_FIXTURES"] = str(tmp_path)
    code = """
import asyncio,json,os,socket
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from uuid import uuid4
def denied(*a,**kw):raise AssertionError('External network forbidden')
socket.socket.connect=denied
socket.getaddrinfo=denied
from capacity.source_check import check_sources
from capacity.source_facts import IMAGE_FACTS,prescription
from app.domains.workouts.extraction import SourceBundle,SourceImage,SourceMetadata,ground_workout
from app.domains.workouts import automation_router as route
from app.domains.workouts.schemas import WorkoutContent
from app.domains.workouts import library_organization_service as organization
from fastapi import HTTPException
async def main():
 report=await check_sources(os.environ['CAPACITY_TEST_FIXTURES'])
 assert report['passed'],report
 assert report['sources']['image']['status']=='incomplete'
 source=SourceBundle(SourceMetadata(platform='images'),images=[SourceImage('image:0','synthetic')])
 grounded,warnings,_=ground_workout(prescription('image:0',IMAGE_FACTS),source)
 assert not warnings and grounded.blocks[0].exercises[0].sets==4
 bad,bad_warnings,_=ground_workout(prescription('image:1',IMAGE_FACTS),source)
 assert bad.blocks[0].exercises[0].sets is None and bad_warnings
 grounded.capture_kind='images'
 row=SimpleNamespace(expires_at=datetime.now(timezone.utc)+timedelta(hours=1),status='incomplete',result={'workout':grounded.model_dump(mode='json'),'warnings':['Visual review required']},accepted_workout_id=None,payload={'synthetic':True})
 async def membership(*a,**kw):return None
 async def owned(*a,**kw):return row
 async def optional(*a,**kw):return None
 route.membership_for=membership;route.owned_record=owned
 organization.refresh_optional_source_metadata=optional
 class DB:
  def __init__(self):self.saved=[];self.commits=0
  def add(self,obj):
   obj.created_at=obj.updated_at=datetime.now(timezone.utc);self.saved.append(obj)
  async def commit(self):self.commits+=1
 db=DB();user=SimpleNamespace(id=uuid4())
 try:await route.accept_import(uuid4(),route.AcceptImport(),user,db,1)
 except HTTPException as e:assert e.status_code==422
 else:raise AssertionError('Image review must be intentional')
 saved=await route.accept_import(uuid4(),route.AcceptImport(acknowledge_warnings=True),user,db,1)
 assert saved.content['capture_kind']=='images' and saved.content['blocks'][0]['exercises'][0]['sets']==4
 assert db.commits==1 and len(db.saved)>=2
 # The unreadable-PDF fallback still lacks established source provenance;
 # acknowledgment must not manufacture a valid capture marker or recipe.
 fallback=prescription();fallback['provenance']='source'
 row.result={'workout':WorkoutContent.model_validate(fallback).model_dump(mode='json'),'warnings':['Unreadable source']};row.accepted_workout_id=None
 try:await route.accept_import(uuid4(),route.AcceptImport(acknowledge_warnings=True),user,db,1)
 except HTTPException as e:assert e.status_code==422
 else:raise AssertionError('Incomplete source validation was weakened')
 assert db.commits==1
asyncio.run(main())
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_native_diagnostic_refuses_architecture_mislabel_before_parsing(monkeypatch):
    from capacity import native_pdf

    monkeypatch.setenv("HAFACAPACITY_NATIVE_PDF_PROBE", "1")
    monkeypatch.setattr(native_pdf.platform, "machine", lambda: "x86_64")
    import pytest

    with pytest.raises(RuntimeError, match="native ARM"):
        native_pdf.main()


async def test_duplicate_recipe_job_is_a_cold_coverage_failure(tmp_path):
    import httpx
    import pytest
    from capacity.driver import AcceptanceFailure, Driver

    (tmp_path / "normal.jpg").write_bytes(b"mock transport image only")
    identifier = "a3333333-3333-4333-8333-333333333333"

    def respond(request):
        return httpx.Response(200, json={"job_id": identifier, "items": []})

    driver = Driver(tmp_path)
    await driver.client.aclose()
    driver.client = httpx.AsyncClient(
        base_url="http://127.0.0.1:18047", transport=httpx.MockTransport(respond)
    )
    try:
        await driver.media_and_chat(0, False)
        with pytest.raises(AcceptanceFailure, match="distinct job"):
            await driver.media_and_chat(1, False)
    finally:
        await driver.client.aclose()


async def test_numeric_diagnostics_preserve_gc_and_remove_task_callback():
    import asyncio
    import gc

    from capacity.diagnostics import Diagnostics

    moments = iter((1.0, 1.040))
    diagnostic = Diagnostics("diagnostic", clock=lambda: next(moments))
    diagnostic.collection("start", {"generation": 1, "private": "never retained"})
    diagnostic.collection("stop", {"generation": 1})
    snapshot = diagnostic.snapshot()
    assert snapshot["gc_collections"] == 1
    assert 39.9 < snapshot["gc_max_ms"] < 40.1
    assert "private" not in str(snapshot)
    active = Diagnostics("diagnostic")
    prior = list(gc.callbacks)
    await active.start()
    await asyncio.sleep(0)
    assert active.task is not None and active.collection in gc.callbacks
    await active.stop()
    assert active.task is None and gc.callbacks == prior
