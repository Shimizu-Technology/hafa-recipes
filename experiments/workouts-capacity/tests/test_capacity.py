"""Source/readiness only; never starts a server, container, database or provider."""

import base64
import json

import httpx
import pytest
from capacity import metrics, plan
from capacity.fixtures import generate
from capacity.safety import FAKE_KEY, ensure
from capacity.transport import ProviderTransport, workout


def test_safety_refuses_any_real_service_or_wrong_database():
    env = plan.environment()
    assert ensure(env) is env
    assert len(base64.urlsafe_b64decode(env["WORKOUTS_SHARE_ENCRYPTION_KEY"])) == 32
    for key, value in [
        ("ENVIRONMENT", "production"),
        ("DATABASE_URL", "postgresql://localhost/production"),
        ("OPENAI_API_KEY", "real-looking-key"),
        ("SENTRY_DSN", "https://example.test"),
        ("AWS_ACCESS_KEY_ID", "credential"),
        (
            "WORKOUTS_AI_BUDGET_DATABASE_URL",
            "postgresql://postgres:capacity_local_only@remote.example/hafa_workouts_capacity_test",
        ),
        (
            "WORKOUTS_AI_BUDGET_DATABASE_URL",
            env["DATABASE_URL"] + "?host=remote.example",
        ),
        (
            "WORKOUTS_AI_BUDGET_DATABASE_URL",
            env["DATABASE_URL"].replace("capacity_local_only", "wrong"),
        ),
        ("DATABASE_URL", env["DATABASE_URL"].replace("capacity_local_only", "wrong")),
    ]:
        with pytest.raises(RuntimeError):
            ensure({**env, key: value})
    assert env["OPENAI_API_KEY"] == FAKE_KEY


def test_filtered_context_never_copies_git_env_or_dependency_caches(tmp_path):
    repository = tmp_path / "repo"
    for folder in [
        "api/app",
        "api/migrations",
        "experiments/workouts-capacity/capacity",
    ]:
        (repository / folder).mkdir(parents=True)
        (repository / folder / "source.py").write_text("pass")
        (repository / folder / ".env").write_text("must not be copied")
        (repository / folder / "__pycache__").mkdir()
        (repository / folder / "__pycache__/secret.pyc").write_bytes(b"cache")
    (repository / "api/requirements.txt").write_text("pypdf==6.20.0")
    (repository / "experiments/workouts-capacity/Dockerfile").write_text("FROM scratch")
    import subprocess

    subprocess.run(["git", "init", "-q", str(repository)], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "add",
            "api/app/source.py",
            "api/migrations/source.py",
            "api/requirements.txt",
            "experiments/workouts-capacity/capacity/source.py",
            "experiments/workouts-capacity/Dockerfile",
        ],
        check=True,
    )
    (repository / "api/app/.env.production").write_text(
        "private untracked configuration"
    )
    (repository / "api/app/untracked-private.json").write_text("private untracked data")
    files = plan.prepare_context(repository, tmp_path / "context")
    assert set(files) == {
        "Dockerfile",
        "api/requirements.txt",
        "api/app/source.py",
        "api/migrations/source.py",
        "capacity/source.py",
    }
    with pytest.raises(RuntimeError):
        plan.prepare_context(repository, tmp_path / "context")


async def test_synthetic_http_keeps_workout_payload_path_and_blocks_unknown_egress():
    transport = ProviderTransport(delay=0)
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            json={
                "model": "fixture",
                "messages": [
                    {
                        "role": "system",
                        "content": "You extract workout prescriptions from untrusted source material.",
                    },
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": "provided_text"}],
                    },
                ],
            },
        )
        body = json.loads(response.json()["choices"][0]["message"]["content"])
        assert body["blocks"][0]["exercises"][0]["sets"] == 3
        with pytest.raises(RuntimeError, match="blocked"):
            await client.get("https://private.example.test")
        with pytest.raises(RuntimeError, match="blocked"):
            await client.post("https://api.openai.com/v1/unrecognized", json={})
    assert transport.calls["extraction"] == 1


def test_real_fixture_pdf_images_and_near_body_are_bounded_deterministic(tmp_path):
    from PIL import Image
    from pypdf import PdfReader

    first = generate(tmp_path / "one", media=False)
    second = generate(tmp_path / "two", media=False)
    assert first == second
    assert first["near-body.json"]["bytes"] < 3 * 1024 * 1024
    assert len(PdfReader(tmp_path / "one/source-30.pdf").pages) == 30
    assert "Squat" in PdfReader(tmp_path / "one/source-1.pdf").pages[0].extract_text()
    with Image.open(tmp_path / "one/image-limit.jpg") as image:
        assert image.width * image.height == 4_000_000
    with Image.open(tmp_path / "one/cover.jpg") as image:
        assert image.width * image.height == 16_000_000


def test_numeric_metrics_report_stop_without_reading_commands_or_environment(tmp_path):
    cg, proc = tmp_path / "cg", tmp_path / "proc"
    cg.mkdir()
    proc.mkdir()
    (cg / "memory.current").write_text(str(460 * 1024 * 1024))
    (cg / "memory.peak").write_text(str(470 * 1024 * 1024))
    (cg / "memory.events").write_text("oom 0\noom_kill 0\n")
    pid = proc / "123"
    pid.mkdir()
    (pid / "status").write_text(
        "Name:\tpython\nPPid:\t1\nVmRSS:\t1024 kB\nVmHWM:\t2048 kB\n"
    )
    (pid / "environ").write_text("must never appear")
    value = metrics.sample(cg, proc)
    assert value["stop_required"] and value["processes"][0]["rss_kib"] == 1024
    assert "must never appear" not in json.dumps(value)


def test_large_export_fixture_remains_inside_normal_content_limit():
    from capacity.fixtures import padding

    content = workout()
    content["notes"] = [padding(4000, n) for n in range(56)]
    assert len(json.dumps(content).encode()) < 240 * 1024


def test_report_never_turns_missing_samples_or_baseline_into_pass():
    from capacity.report import READS, evaluate

    route = {"p95_ms": 100, "p99_ms": 150, "unexpected": 0}
    ordinary = {"routes": {label: dict(route) for label in READS}}
    assert evaluate(ordinary, ordinary, [])["local_gate"] == "blocked"
    samples = [{"memory_peak": 400 * 1024 * 1024, "stop_required": False, "oom": 0}]
    assert evaluate(ordinary, ordinary, samples)["local_gate"] == "passed"
    unsafe = evaluate(
        ordinary, ordinary, [{"memory_peak": 470 * 1024 * 1024, "stop_required": True}]
    )
    assert unsafe["local_gate"] == "failed" and unsafe["r04_closed"] is False
    slow = {"routes": {label: {**route, "p95_ms": 130} for label in READS}}
    assert evaluate(ordinary, slow, samples)["local_gate"] == "failed"


async def test_driver_auth_scope_and_metadata_only_without_network(tmp_path):
    from capacity.driver import Driver
    from capacity.safety import OWNERS

    calls = []

    async def respond(request):
        calls.append(request)
        return httpx.Response(200, json={"private": "do not retain in report"})

    driver = Driver(tmp_path)
    await driver.client.aclose()
    driver.client = httpx.AsyncClient(
        base_url="http://127.0.0.1:18047", transport=httpx.MockTransport(respond)
    )
    try:
        await driver.request("GET", "/scope", OWNERS[1], label="scope")
        await driver.request("GET", "/scope", label="unauth", authenticated=False)
        assert calls[0].headers["X-Hafa-Account-ID"] == OWNERS[1]
        assert calls[0].headers["X-Workouts-Generation"] == "1"
        assert "X-Capacity-User" not in calls[1].headers
        assert "do not retain" not in json.dumps(driver.report())
    finally:
        await driver.client.aclose()


def test_actual_wrapper_imports_in_explicit_fake_environment_without_network_or_startup():
    import subprocess
    import sys

    environment = plan.environment()
    environment["PYTHONPATH"] = "api:experiments/workouts-capacity"
    environment["PATH"] = "/usr/bin:/bin"
    code = """
import socket

def denied(*args, **kwargs):
    raise AssertionError('Network/server operation forbidden in import readiness test')

socket.socket.connect = denied
socket.socket.connect_ex = denied
socket.socket.bind = denied
socket.socket.listen = denied
socket.create_connection = denied
socket.getaddrinfo = denied
import capacity.app as candidate
assert candidate.imports.workout_import_worker.task is None
assert sum(candidate.transport.calls.values()) == 0
from app.domains.workouts.automation_router import imports_router
assert any(getattr(route, 'path', None) == '/api/v1/workouts/imports' for route in imports_router.routes)
import asyncio,io
from PIL import Image
from app.services.storage import storage_service
from app.services.cover_selection import cover_selection_service
async def check_bound_traces():
    out=io.BytesIO()
    Image.new('RGB',(16,16),'white').save(out,format='PNG')
    variants=await storage_service._prepare_thumbnail_variants(out.getvalue(),'image/png')
    assert set(variants)=={'list','hero'}
    selection=await cover_selection_service.select([],{},'youtube')
    assert selection.candidate is None
asyncio.run(check_bound_traces())
assert sum(candidate.transport.calls.values()) == 0
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr


def test_context_refuses_tracked_private_config_and_symlinks_before_copy(tmp_path):
    import subprocess

    repository = tmp_path / "repo"
    (repository / "api/app").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(repository)], check=True)
    private = repository / "api/app/.env.production"
    private.write_text("private fixture")
    subprocess.run(
        ["git", "-C", str(repository), "add", "api/app/.env.production"], check=True
    )
    with pytest.raises(RuntimeError, match="Forbidden tracked"):
        plan.prepare_context(repository, tmp_path / "private-context")
    assert not (tmp_path / "private-context").exists()
    subprocess.run(
        ["git", "-C", str(repository), "rm", "--cached", "api/app/.env.production"],
        check=True,
        capture_output=True,
    )
    target = tmp_path / "outside.txt"
    target.write_text("private fixture")
    link = repository / "api/app/linked.py"
    link.symlink_to(target)
    subprocess.run(
        ["git", "-C", str(repository), "add", "api/app/linked.py"], check=True
    )
    with pytest.raises(RuntimeError, match="symlinks"):
        plan.prepare_context(repository, tmp_path / "linked-context")
    assert not (tmp_path / "linked-context").exists()


@pytest.mark.parametrize("cancelled", [False, True])
async def test_interrupted_driver_persists_partial_metadata_and_preserves_error(
    tmp_path, monkeypatch, cancelled
):
    import asyncio
    from types import SimpleNamespace

    from capacity import driver as module

    driver = module.Driver(tmp_path)
    await driver.client.aclose()
    error = asyncio.CancelledError if cancelled else httpx.ConnectError

    async def respond(_):
        raise error("private source and provider detail must not enter report")

    driver.client = httpx.AsyncClient(
        base_url="http://127.0.0.1:18047", transport=httpx.MockTransport(respond)
    )

    async def request_failure(*_):
        await driver.request("GET", "/probe", label="interrupted-probe")

    async def idle(*_):
        return None

    monkeypatch.setattr(driver, "lightweight", request_failure)
    monkeypatch.setattr(driver, "media_and_chat", idle)
    monkeypatch.setattr(driver, "poll", idle)
    monkeypatch.setattr(module, "Driver", lambda _: driver)
    output = tmp_path / "partial.json"
    args = SimpleNamespace(
        fixtures=tmp_path, profile="recipes-baseline", seconds=1, output=output
    )
    with pytest.raises(error):
        await module.run(args)
    report = json.loads(output.read_text())
    assert report["completed"] is False
    assert report["failure_type"] == error.__name__
    assert report["r04_closed"] is False
    assert "private source" not in output.read_text()
    if not cancelled:
        assert report["routes"]["interrupted-probe"]["statuses"]["0"] >= 1
    assert driver.client.is_closed


def test_real_backend_recipe_envelope_drives_detail_and_chat(tmp_path):
    """Use the backend's validated response schema; a guessed fixture hid this bug."""
    import subprocess
    import sys

    (tmp_path / "normal.jpg").write_bytes(b"mock-transport-only")
    env = plan.environment()
    env["PYTHONPATH"] = "api:experiments/workouts-capacity"
    env["PATH"] = "/usr/bin:/bin"
    env["CAPACITY_TEST_FIXTURES"] = str(tmp_path)
    code = """
import asyncio,json,os,socket
from datetime import datetime,timezone
from uuid import UUID
def denied(*a,**kw): raise AssertionError('Real network forbidden')
socket.socket.connect=denied
socket.create_connection=denied
socket.getaddrinfo=denied
import httpx
from app.models.schemas import RecipeListItem
from app.routers.recipes import PaginatedRecipes
from capacity.driver import Driver
identifier=UUID('a3333333-3333-4333-8333-333333333333')
item=RecipeListItem(id=identifier,title='Fixture',source_url='manual://fixture',source_type='manual',created_at=datetime.now(timezone.utc))
envelope=PaginatedRecipes(items=[item],total=1,limit=20,offset=0,has_more=False).model_dump(mode='json')
calls=[]
def response(request):
    calls.append((request.method,request.url.path))
    return httpx.Response(200,json=envelope if request.method=='GET' else {'job_id':str(identifier)})
async def main():
    driver=Driver(os.environ['CAPACITY_TEST_FIXTURES'])
    await driver.client.aclose()
    driver.client=httpx.AsyncClient(base_url='http://127.0.0.1:18047',transport=httpx.MockTransport(response))
    try:
        await driver.lightweight(0,False)
        await driver.media_and_chat(0,False)
        assert ('GET','/api/recipes/'+str(identifier)) in calls
        assert ('POST','/api/recipes/'+str(identifier)+'/chat') in calls
        assert driver.report()['routes']['recipes/detail']['count']==1
        assert driver.report()['routes']['recipes/chat']['count']==1
    finally: await driver.client.aclose()
asyncio.run(main())
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr


def test_protected_acceptance_rejects_private_detail_404_and_missing_categories():
    from capacity.driver import PROTECTED, protected_acceptance

    good = {
        "routes": {
            label: {"count": 2, "unexpected": 0, "statuses": {"200": 2}}
            for label in PROTECTED
        }
    }
    assert protected_acceptance(good)["passed"]
    good["routes"]["recipes/detail"] = {
        "count": 152,
        "unexpected": 152,
        "statuses": {"404": 152},
    }
    result = protected_acceptance(good)
    assert not result["passed"] and "recipes/detail" in result["failed_categories"]
    assert result["categories"]["recipes/detail"]["count"] == 152
    del good["routes"]["recipes/detail"]
    assert not protected_acceptance(good)["passed"]


def test_actual_mounted_private_recipe_resolves_optional_synthetic_owner_only():
    import subprocess
    import sys

    env = plan.environment()
    env["PYTHONPATH"] = "api:experiments/workouts-capacity"
    env["PATH"] = "/usr/bin:/bin"
    code = """
import asyncio,socket
from datetime import datetime,timezone
from types import SimpleNamespace
from uuid import uuid4
import httpx
from starlette.requests import Request

def denied(*a,**kw): raise AssertionError('Real network forbidden')
socket.socket.connect=denied
socket.getaddrinfo=denied
import capacity.app as candidate
from capacity.safety import OWNERS
from capacity.transport import recipe
from app.auth import get_current_user,get_optional_user
from app.db.database import get_db
from app.models.recipe import Recipe
identifier=uuid4()
row=Recipe(id=identifier,user_id=OWNERS[0],source_url='manual://fixture',source_type='manual',extracted={**recipe(),'sourceUrl':''},is_public=False,has_audio_transcript=False,created_at=datetime.now(timezone.utc),content_revision=1,moderation_status='active',review_state='ready')
class DB:
 async def execute(self,*args,**kw): return SimpleNamespace(scalar_one_or_none=lambda:row)
async def db(): yield DB()
candidate.app.dependency_overrides[get_db]=db
assert candidate.app.dependency_overrides[get_current_user] is candidate.identity
assert candidate.app.dependency_overrides[get_optional_user] is candidate.optional_identity
async def main():
 # The experiment intercepts every SDK AsyncClient at construction. This test
 # installs the ASGI transport afterward solely for its actual mounted route.
 async with httpx.AsyncClient(base_url='http://test') as client:
  client._transport=httpx.ASGITransport(app=candidate.app)
  owner=await client.get('/api/recipes/'+str(identifier),headers={'X-Capacity-User':OWNERS[0]})
  assert owner.status_code==200,owner.text
  assert owner.json()['is_owner'] is True
  for headers in [{},{'X-Capacity-User':'foreign-invalid'},{'X-Capacity-User':OWNERS[1]}]:
   denied_response=await client.get('/api/recipes/'+str(identifier),headers=headers)
   assert denied_response.status_code==404,denied_response.text
  required=await client.get('/api/recipes/',headers={'X-Capacity-User':'foreign-invalid'})
  assert required.status_code==401
  scope={'type':'http','headers':[]}
  assert await candidate.optional_identity(Request(scope)) is None
asyncio.run(main())
assert sum(candidate.transport.calls.values())==0
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
