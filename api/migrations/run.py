"""Run the complete active migration chain in a stable, versioned order."""

from __future__ import annotations

import asyncio
from importlib import import_module

from app.config import get_settings

ACTIVE_MIGRATIONS = (
    "migrations.016_add_stable_clerk_identities",
    "migrations.017_add_clerk_migration_grants",
    "migrations.018_add_durable_extraction_jobs",
    "migrations.019_add_durable_deletion_cleanup",
    "migrations.020_add_database_invariants",
    "migrations.021_add_ai_invocation_provenance",
    "migrations.022_add_admin_moderation",
    "migrations.023_add_grocery_sync_contract",
    "migrations.024_add_grocery_widget_credentials",
    "migrations.025_add_publishing_disclosure_version",
    "migrations.026_add_recipe_review_state",
    "migrations.027_add_recipe_correction_events",
    "migrations.028_add_thumbnail_backfill_audit",
    "migrations.029_allow_advisory_recipe_publishing",
    "migrations.030_add_capture_save_idempotency",
    "migrations.031_add_household_pantry",
    "migrations.032_add_share_import_credentials",
    "migrations.033_add_nutrition_backfill_audit",
)
LATEST_MIGRATION = 33
OPTIONAL_MIGRATIONS = (
    "migrations.034_add_workouts_domain",
    "migrations.035_add_workouts_automation",
    "migrations.036_add_workouts_health",
    "migrations.037_add_workouts_connections_sharing",
    "migrations.038_add_workouts_library_organization",
    "migrations.039_add_workouts_measurements",
    "migrations.040_add_workouts_ai_admission",
    "migrations.041_add_workouts_recipe_grant_epochs",
    "migrations.042_add_workouts_import_usage",
    "migrations.043_add_workouts_export_snapshots",
    "migrations.044_add_workouts_activity_log",
    "migrations.045_add_workouts_export_jobs",
)


async def run_migrations() -> None:
    """Run every active idempotent migration and stop at the first failure."""
    for module_name in ACTIVE_MIGRATIONS:
        migration = import_module(module_name)
        await migration.run_migration()

    if get_settings().workouts_api_enabled:
        for module_name in OPTIONAL_MIGRATIONS:
            migration = import_module(module_name)
            await migration.run_migration()

    print(f"Active migration chain complete through version {LATEST_MIGRATION}")


if __name__ == "__main__":
    asyncio.run(run_migrations())
