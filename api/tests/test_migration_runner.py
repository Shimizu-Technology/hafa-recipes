"""Release-contract tests for the active migration runner."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from migrations import run as migration_runner


@pytest.mark.asyncio
async def test_runner_executes_every_active_migration_in_order(monkeypatch):
    calls: list[str] = []

    def load(module_name: str):
        async def run_migration():
            calls.append(module_name)

        return SimpleNamespace(run_migration=run_migration)

    monkeypatch.setattr(migration_runner, "import_module", load)

    await migration_runner.run_migrations()

    assert calls == list(migration_runner.ACTIVE_MIGRATIONS)
    assert migration_runner.ACTIVE_MIGRATIONS[-1].startswith(
        f"migrations.{migration_runner.LATEST_MIGRATION:03d}_"
    )


@pytest.mark.asyncio
async def test_runner_stops_at_first_failed_migration(monkeypatch):
    calls: list[str] = []
    failed_module = migration_runner.ACTIVE_MIGRATIONS[2]

    def load(module_name: str):
        async def run_migration():
            calls.append(module_name)
            if module_name == failed_module:
                raise RuntimeError("synthetic migration failure")

        return SimpleNamespace(run_migration=run_migration)

    monkeypatch.setattr(migration_runner, "import_module", load)

    with pytest.raises(RuntimeError, match="synthetic migration failure"):
        await migration_runner.run_migrations()

    assert calls == list(migration_runner.ACTIVE_MIGRATIONS[:3])


def test_render_uses_only_the_versioned_migration_runner():
    render_config = (
        Path(__file__).resolve().parents[2] / "render.yaml"
    ).read_text(encoding="utf-8")

    assert "preDeployCommand: python -m migrations.run" in render_config
    assert "python -m migrations.022_add_admin_moderation" not in render_config


def test_runner_tracks_the_latest_numbered_migration_file():
    migrations_directory = Path(migration_runner.__file__).resolve().parent
    discovered_versions = [
        int(path.name[:3])
        for path in migrations_directory.glob("[0-9][0-9][0-9]_*.py")
    ]

    assert max(discovered_versions) == migration_runner.LATEST_MIGRATION
