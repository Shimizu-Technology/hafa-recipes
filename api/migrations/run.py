"""Run the complete active migration chain in a stable, versioned order."""

from __future__ import annotations

import asyncio
from importlib import import_module

ACTIVE_MIGRATIONS = (
    "migrations.016_add_stable_clerk_identities",
    "migrations.017_add_clerk_migration_grants",
    "migrations.018_add_durable_extraction_jobs",
    "migrations.019_add_durable_deletion_cleanup",
    "migrations.020_add_database_invariants",
    "migrations.021_add_ai_invocation_provenance",
    "migrations.022_add_admin_moderation",
    "migrations.023_add_grocery_sync_contract",
)
LATEST_MIGRATION = 23


async def run_migrations() -> None:
    """Run every active idempotent migration and stop at the first failure."""
    for module_name in ACTIVE_MIGRATIONS:
        migration = import_module(module_name)
        await migration.run_migration()

    print(f"Active migration chain complete through version {LATEST_MIGRATION}")


if __name__ == "__main__":
    asyncio.run(run_migrations())
