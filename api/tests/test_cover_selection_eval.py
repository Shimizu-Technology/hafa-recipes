"""Privacy and opt-in boundaries of the public-fixture evaluation runner."""

import ast
import builtins
import hashlib
import importlib.util
import io
import json
import logging
import random
import subprocess
import sys
import types
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "cover_eval_runner", Path(__file__).parents[1] / "evals/run_cover_selection_eval.py"
)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def test_fixture_hash_mismatch_blocks_before_remote_execution(tmp_path):
    path = tmp_path / "public.jpg"
    path.write_bytes(b"changed fixture")
    manifest = {"assets": {"public": {"sha256": hashlib.sha256(b"expected fixture").hexdigest()}}}
    with pytest.raises(ValueError, match="reverify"):
        runner.load_images(manifest, tmp_path)


def test_preflight_defaults_to_zero_provider_calls(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(sys, "argv", ["runner", "--fixture-dir", str(tmp_path), "--cases", "E01"])
    monkeypatch.setattr(runner, "load_images", lambda *_: {})
    monkeypatch.setattr(
        runner.subprocess,
        "run",
        lambda *_args, **_kwargs: pytest.fail("preflight must not execute SSH"),
    )
    assert runner.main() == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "preflight_only"
    assert result["providerCalls"] == 0


@pytest.mark.parametrize(
    "argv",
    [
        ["--execute-remote"],
        ["--execute-remote", "--remote-host", "user@host; print-secret"],
        ["--cases", "unknown"],
    ],
)
def test_invalid_execution_arguments_do_not_acquire_fixtures(monkeypatch, tmp_path, argv):
    monkeypatch.setattr(sys, "argv", ["runner", "--fixture-dir", str(tmp_path), *argv])
    monkeypatch.setattr(
        runner, "load_images", lambda *_: pytest.fail("invalid args must stop before acquisition")
    )
    with pytest.raises(SystemExit) as exc:
        runner.main()
    assert exc.value.code == 2


def test_sharpness_transform_preserves_dimensions_and_changes_bytes():
    source = io.BytesIO()
    image = Image.new("RGB", (300, 400), "white")
    image.putpixel((150, 200), (0, 0, 0))
    image.save(source, format="JPEG")
    actual = runner.candidate_bytes(
        {"asset": "public", "transform": "blur14"}, {"public": source.getvalue()}
    )
    assert actual != source.getvalue()
    assert Image.open(io.BytesIO(actual)).size == (300, 400)


def test_remote_program_executes_nonempty_case_without_storage_access(monkeypatch, capsys):
    """Exercise the actual wrapper/selector with guarded persistence and fake HTTP."""
    import app
    from app import ai_governance, services

    source = (runner.API_ROOT / "app/services/cover_selection.py").read_text()
    image = Image.new("RGB", (256, 256))
    rng = random.Random(17)
    image.putdata([tuple(rng.randrange(256) for _ in range(3)) for _ in range(256 * 256)])
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    cases = [
        {
            "id": "isolation",
            "title": "Test dish",
            "ingredients": ["rice"],
            "platform": "tiktok",
            "expected": "c1",
            "candidates": [{"id": "c1", "asset": "public", "kind": "video_frame"}],
        }
    ]
    script = runner.remote_program(source, cases, {"public": buffer.getvalue()})
    tree = ast.parse(script)
    # The override must precede execution of the selector module and its case loop.
    override = next(
        index
        for index, node in enumerate(tree.body)
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Attribute) and target.attr == "record_ai_invocation"
            for target in node.targets
        )
    )
    module_execution = next(
        index
        for index, node in enumerate(tree.body)
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "exec"
    )
    assert override < module_execution

    class ForbiddenPersistence(types.ModuleType):
        def __getattr__(self, _name):
            pytest.fail("remote evaluation accessed production persistence")

    database_guard = ForbiddenPersistence("app.db")
    storage_guard = ForbiddenPersistence("app.services.storage")
    monkeypatch.setitem(sys.modules, "app.db", database_guard)
    monkeypatch.setitem(sys.modules, "app.services.storage", storage_guard)
    monkeypatch.setattr(app, "db", database_guard, raising=False)
    monkeypatch.setattr(services, "storage", storage_guard, raising=False)

    def forbidden(*_args, **_kwargs):
        pytest.fail("remote evaluation accessed a file")

    monkeypatch.setattr(builtins, "open", forbidden)
    monkeypatch.setattr(io, "open", forbidden)
    # Keep the test's preexisting governance/isolated namespace and log state intact.
    monkeypatch.setattr(ai_governance, "record_ai_invocation", ai_governance.record_ai_invocation)
    monkeypatch.setitem(
        sys.modules, "_isolated_cover_eval", types.ModuleType("_isolated_cover_eval")
    )
    response = httpx.Response(
        200,
        json={
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": json.dumps(
                            {
                                "selected_id": "c1",
                                "confidence": "high",
                                "grades": [
                                    {
                                        "candidate_id": "c1",
                                        "same_dish": 5,
                                        "finished_dish": 5,
                                        "clarity": 5,
                                        "crop": 5,
                                        "unobstructed": 5,
                                        "lighting": 5,
                                    }
                                ],
                            }
                        )
                    },
                }
            ],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10},
        },
    )
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    prior_logging_disable = logging.root.manager.disable
    try:
        exec(compile(script, "<remote-evaluation>", "exec"), {})
    finally:
        logging.disable(prior_logging_disable)
    result = json.loads(capsys.readouterr().out.removeprefix("COVER_EVAL "))
    assert result["passed"] is True
    assert result["actual"] == "c1"
    assert result["invocations"][0]["input_tokens"] == 20
    assert post.await_count == 1


def test_streamed_download_stops_at_limit_and_closes_response(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "MAX_FIXTURE_BYTES", 8)
    chunks_read = []
    closed = []

    class Response:
        def raise_for_status(self):
            pass

        def iter_bytes(self, *, chunk_size):
            assert chunk_size == runner.FIXTURE_READ_CHUNK_BYTES
            for index in range(3):
                chunks_read.append(index)
                yield b"abcd"
            pytest.fail("oversized stream was consumed after crossing limit")

    @contextmanager
    def stream(self, method, url):
        assert method == "GET"
        assert url == "https://public.test/image.jpg"
        try:
            yield Response()
        finally:
            closed.append(True)

    monkeypatch.setattr(httpx.Client, "stream", stream)
    manifest = {"assets": {"public": {"downloadUrl": "https://public.test/image.jpg"}}}
    with pytest.raises(ValueError, match="size limit"):
        runner.load_images(manifest, tmp_path)
    assert chunks_read == [0, 1, 2]
    assert closed == [True]
    assert not (tmp_path / "public.jpg").exists()


def test_cached_fixture_read_is_bounded_even_without_trusting_size(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "MAX_FIXTURE_BYTES", 8)
    path = tmp_path / "public.jpg"
    path.write_bytes(b"x" * 100)
    original_open = Path.open
    requested = []

    class BoundedReader:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self, size):
            requested.append(size)
            assert size == 9
            return b"x" * size

    def open_bounded(self, *args, **kwargs):
        return BoundedReader() if self == path else original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", open_bounded)
    with pytest.raises(ValueError, match="size limit"):
        runner.load_images({"assets": {"public": {}}}, tmp_path)
    assert requested == [9]


def test_remote_timeout_emits_only_sanitized_blocked_result(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "runner",
            "--fixture-dir",
            str(tmp_path),
            "--cases",
            "E01",
            "--execute-remote",
            "--remote-host",
            "user@host",
        ],
    )
    monkeypatch.setattr(runner, "load_images", lambda *_: {})
    monkeypatch.setattr(runner, "remote_program", lambda *_: "safe script")

    def timeout(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(
            ["ssh", "SECRET-COMMAND"],
            90,
            output=b"SECRET-STDOUT",
            stderr=b"SECRET-STDERR",
        )

    monkeypatch.setattr(runner.subprocess, "run", timeout)
    assert runner.main() == 2
    capture = capsys.readouterr()
    assert json.loads(capture.out) == {"status": "blocked", "reason": "remote_timeout"}
    assert "SECRET" not in capture.out + capture.err


def test_valid_streamed_fixture_is_verified_before_caching(monkeypatch, tmp_path):
    buffer = io.BytesIO()
    Image.new("RGB", (96, 96), "orange").save(buffer, format="JPEG")
    data = buffer.getvalue()
    original_client = httpx.Client
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=data))
    monkeypatch.setattr(
        httpx, "Client", lambda **kwargs: original_client(transport=transport, **kwargs)
    )
    manifest = {
        "assets": {
            "public": {
                "downloadUrl": "https://public.test/image.jpg",
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        }
    }
    actual = runner.load_images(manifest, tmp_path)
    assert actual["public"] == data
    assert (tmp_path / "public.jpg").read_bytes() == data
    (tmp_path / "public.jpg").unlink()
    manifest["assets"]["public"]["sha256"] = "wrong-content-hash"
    with pytest.raises(ValueError, match="reverify"):
        runner.load_images(manifest, tmp_path)
    assert not (tmp_path / "public.jpg").exists()
