"""Pinned complete export schema for the isolated owner22 mixed fixture only."""

# Kept independent of API imports so the host coordinator remains stdlib-only.
# The source-parity regression binds every name to export_context.datasets().
DATASET_NAMES = frozenset(
    {
        "workouts",
        "workout_versions",
        "programs",
        "program_versions",
        "sessions",
        "activities",
        "imports",
        "proposals",
        "coach_messages",
        "health_connections",
        "health_observations",
        "health_owned_writes",
        "recipe_connection_receipts",
        "published_training_shares",
        "training_copy_receipts",
        "library_organization",
        "library_collections",
        "library_collection_members",
        "library_duplicate_receipts",
        "measurements",
        "completed_activity_log",
        "recipe_grant_epoch",
        "import_allowance_receipts",
    }
)


def expected_totals():
    return {
        name: 190 if name in {"workouts", "workout_versions"} else 0
        for name in sorted(DATASET_NAMES)
    }


def valid_totals(totals):
    return (
        isinstance(totals, dict)
        and set(totals) == DATASET_NAMES
        and all(type(value) is int for value in totals.values())
        and totals == expected_totals()
    )


def valid_page_schema(data, page):
    datasets, has_more = data.get("datasets"), data.get("has_more")
    return (
        isinstance(datasets, dict)
        and set(datasets) == DATASET_NAMES
        and all(isinstance(rows, list) for rows in datasets.values())
        and all(
            len(rows) == (10 if name in {"workouts", "workout_versions"} else 0)
            for name, rows in datasets.items()
        )
        and isinstance(has_more, dict)
        and set(has_more) == DATASET_NAMES
        and all(type(value) is bool for value in has_more.values())
        and has_more
        == {
            name: page < 18 if name in {"workouts", "workout_versions"} else False
            for name in DATASET_NAMES
        }
    )
