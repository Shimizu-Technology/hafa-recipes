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


def test_render_runs_the_locked_repair_before_the_versioned_migration_runner():
    render_config = (
        Path(__file__).resolve().parents[2] / "render.yaml"
    ).read_text(encoding="utf-8")

    repair = "python -m app.grocery_membership_repair"
    migration_runner_command = "&& python -m migrations.run"
    assert repair in render_config
    assert migration_runner_command in render_config
    assert render_config.index(repair) < render_config.index(migration_runner_command)
    assert "--repair-id grocery-empty-list-dedup-2026-08-22" in render_config
    assert "--expected-users 11" in render_config
    assert "--expected-memberships 31" in render_config
    assert "python -m migrations.022_add_admin_moderation" not in render_config


def test_runner_registers_every_active_numbered_migration_file():
    migrations_directory = Path(migration_runner.__file__).resolve().parent
    first_active_version = int(
        migration_runner.ACTIVE_MIGRATIONS[0].removeprefix("migrations.")[:3]
    )
    discovered_modules = tuple(
        f"migrations.{path.stem}"
        for path in sorted(migrations_directory.glob("[0-9][0-9][0-9]_*.py"))
        if int(path.name[:3]) >= first_active_version
    )

    assert discovered_modules == migration_runner.ACTIVE_MIGRATIONS
    assert migration_runner.LATEST_MIGRATION == int(
        discovered_modules[-1].removeprefix("migrations.")[:3]
    )
