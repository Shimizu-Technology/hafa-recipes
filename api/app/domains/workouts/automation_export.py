"""Owner-only, paged exports of retained automation state; never raw captures."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.domains.workouts.export_context import SnapshotSourceContext

from sqlalchemy import func, select, text

from app.domains.workouts.automation_models import (
    WorkoutCoachMessage,
    WorkoutImport,
    WorkoutProposal,
)


async def export_automation_page(
    db, user_id, generation, limit, offset, *, source_context: "SnapshotSourceContext | None" = None
):
    if source_context is not None:
        source_context.require_guard(db, user_id, generation, limit, offset)
    if not (
        "workouts_import_jobs" in source_context.tables
        if source_context is not None
        else await db.scalar(text("SELECT to_regclass('public.workouts_import_jobs') IS NOT NULL"))
    ):
        return {}, {}
    datasets, totals = {}, {}
    for name, model, fields in (
        (
            "imports",
            WorkoutImport,
            ("id", "status", "attempt_count", "result", "expires_at", "accepted_workout_id"),
        ),
        (
            "proposals",
            WorkoutProposal,
            (
                "id",
                "kind",
                "profile_revision",
                "target_id",
                "target_revision",
                "content",
                "expires_at",
                "accepted_record_id",
                "accepted_at",
            ),
        ),
        (
            "coach_messages",
            WorkoutCoachMessage,
            (
                "id",
                "request_id",
                "user_message",
                "assistant_message",
                "proposals",
                "used_health_context",
            ),
        ),
    ):
        owner = (model.app_user_id == user_id, model.generation == generation)
        # Select only the exported projection. Loading whole import ORM rows
        # would decode up to ten retained 3 MiB image/document captures despite
        # the snapshot's SQL memory guard deliberately excluding those payloads.
        rows = (
            []
            if source_context is not None and not source_context.should_fetch(name, offset)
            else (
                (
                    await db.execute(
                        select(*(getattr(model, field) for field in fields), model.created_at)
                        .where(*owner)
                        .order_by(model.created_at.desc(), model.id.desc())
                        .limit(limit)
                        .offset(offset)
                    )
                )
                .mappings()
                .all()
            )
        )
        totals[name] = (
            source_context.totals[name]
            if source_context is not None
            else await db.scalar(select(func.count()).select_from(model).where(*owner))
        )
        datasets[name] = [
            {field: row[field] for field in fields} | {"created_at": row["created_at"]}
            for row in rows
        ]
    return datasets, totals
