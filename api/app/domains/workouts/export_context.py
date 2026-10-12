"""Scalar inventory and bounded copied metadata for one private RR source only."""

import json
from contextvars import ContextVar
from types import MappingProxyType

from sqlalchemy import func, select, text

from app.domains.workouts.lifecycle import optional_table_exists
from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsActivity,
    WorkoutsProgram,
    WorkoutsProgramVersion,
    WorkoutsSession,
    WorkoutVersion,
)

source_context: ContextVar["SnapshotSourceContext | None"] = ContextVar(
    "workouts_private_export_source", default=None
)


def datasets():
    # All names/models are server constants; no arbitrary columns/ORM payloads.
    from app.domains.workouts.activity_log_models import WorkoutsActivityLog
    from app.domains.workouts.automation_models import (
        WorkoutCoachMessage,
        WorkoutImport,
        WorkoutProposal,
    )
    from app.domains.workouts.connection_models import (
        RecipeConnectionReceipt,
        WorkoutCopyReceipt,
        WorkoutShare,
    )
    from app.domains.workouts.health_models import (
        HealthConnection,
        HealthExportIntent,
        HealthObservation,
    )
    from app.domains.workouts.import_usage_models import WorkoutImportUsage
    from app.domains.workouts.library_organization_models import (
        WorkoutLibraryCollection,
        WorkoutLibraryCollectionMember,
        WorkoutLibraryDuplicateReceipt,
        WorkoutLibraryOrganization,
    )
    from app.domains.workouts.measurement_models import WorkoutsMeasurement
    from app.domains.workouts.recipe_grant_models import WorkoutsRecipeGrantEpoch

    return (
        (None, "workouts", WorkoutRecord),
        (None, "workout_versions", WorkoutVersion),
        (None, "programs", WorkoutsProgram),
        (None, "program_versions", WorkoutsProgramVersion),
        (None, "sessions", WorkoutsSession),
        (None, "activities", WorkoutsActivity),
        ("workouts_import_jobs", "imports", WorkoutImport),
        ("workouts_import_jobs", "proposals", WorkoutProposal),
        ("workouts_import_jobs", "coach_messages", WorkoutCoachMessage),
        ("workouts_health_connections", "health_connections", HealthConnection),
        ("workouts_health_connections", "health_observations", HealthObservation),
        ("workouts_health_connections", "health_owned_writes", HealthExportIntent),
        ("workouts_shares", "recipe_connection_receipts", RecipeConnectionReceipt),
        ("workouts_shares", "published_training_shares", WorkoutShare),
        ("workouts_shares", "training_copy_receipts", WorkoutCopyReceipt),
        ("workouts_library_organization", "library_organization", WorkoutLibraryOrganization),
        ("workouts_library_organization", "library_collections", WorkoutLibraryCollection),
        (
            "workouts_library_organization",
            "library_collection_members",
            WorkoutLibraryCollectionMember,
        ),
        (
            "workouts_library_organization",
            "library_duplicate_receipts",
            WorkoutLibraryDuplicateReceipt,
        ),
        ("workouts_measurements", "measurements", WorkoutsMeasurement),
        ("workouts_activity_log", "completed_activity_log", WorkoutsActivityLog),
        ("workouts_recipe_grant_epochs", "recipe_grant_epoch", WorkoutsRecipeGrantEpoch),
        ("workouts_import_usage", "import_allowance_receipts", WorkoutImportUsage),
    )


class SnapshotSourceContext:
    def __init__(self, db, transaction, owner, generation, tables, totals):
        self._db, self._transaction = db, transaction
        self._owner, self._generation = owner, generation
        self.tables = frozenset(tables)
        self.totals = MappingProxyType(dict(totals))
        self._metadata_json = None
        self._guarded_page = None
        self._closed = False

    @property
    def owner(self):
        return self._owner

    @property
    def generation(self):
        return self._generation

    @classmethod
    async def prepare(cls, db, owner, generation):
        transaction = db.sync_session.get_transaction()
        if transaction is None or not transaction.is_active:
            raise ValueError("Private export source requires a live transaction")
        connection = await db.connection()
        if (
            await connection.get_isolation_level() != "REPEATABLE READ"
            or await db.scalar(text("SHOW transaction_read_only")) != "on"
        ):
            raise ValueError("Private export source requires readonly repeatable read")
        tables, totals = set(), {}
        for gate, name, model in datasets():
            if gate and not await optional_table_exists(db, gate):
                continue
            if gate:
                tables.add(gate)
            predicate = [model.app_user_id == owner]
            # Content-free allowance survives product-only deletion and spans
            # generations by design; its legacy export is owner-only.
            if name != "import_allowance_receipts":
                predicate.append(model.generation == generation)
            totals[name] = await db.scalar(
                select(func.count()).select_from(model).where(*predicate)
            )
        return cls(db, transaction, owner, generation, tables, totals)

    def assert_scope(self, db, owner, generation):
        if (
            self._closed
            or db is not self._db
            or owner != self.owner
            or generation != self.generation
            or db.sync_session.get_transaction() is not self._transaction
            or not self._transaction.is_active
        ):
            raise ValueError("Private export source context changed")

    def approve_page(self, db, owner, generation, limit, offset):
        self.assert_scope(db, owner, generation)
        self._guarded_page = (limit, offset)

    def require_guard(self, db, owner, generation, limit, offset):
        self.assert_scope(db, owner, generation)
        if self._guarded_page != (limit, offset):
            raise ValueError("Guard private JSON before source projection")

    def should_fetch(self, name, offset):
        return offset < self.totals[name]

    def static_metadata(self):
        # A fresh copy per page never aliases retained ORM dictionaries/models.
        return json.loads(self._metadata_json) if self._metadata_json is not None else None

    def capture_static(self, metadata):
        if self._closed or self._guarded_page is None:
            raise ValueError("Guard private JSON before capturing static metadata")
        if self._metadata_json is None:
            self._metadata_json = json.dumps(metadata, separators=(",", ":"))

    def close(self):
        self._metadata_json = None
        self._guarded_page = None
        self._closed = True
        self._db = self._transaction = None
