"""Privacy and opt-in boundaries of the public-fixture evaluation runner."""

import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path

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


def test_remote_program_has_no_persistent_image_or_database_writer():
    script = runner.remote_program("# exact selector source\n", [], {})
    compile(script, "<remote-evaluation>", "exec")
    assert "record_ai_invocation = collect" in script
    assert "AsyncSession" not in script
    assert ".write(" not in script
    assert "COVER_EVAL " in script
