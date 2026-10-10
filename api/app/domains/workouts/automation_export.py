"""Owner-only, paged exports of retained automation state; never raw captures."""

from sqlalchemy import func, select, text

from app.domains.workouts.automation_models import (
    WorkoutCoachMessage,
    WorkoutImport,
    WorkoutProposal,
)


async def export_automation_page(db, user_id, generation, limit, offset):
    if not await db.scalar(text("SELECT to_regclass('public.workouts_import_jobs') IS NOT NULL")):
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
        rows = (
            await db.scalars(
                select(model)
                .where(*owner)
                .order_by(model.created_at.desc(), model.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
        totals[name] = await db.scalar(select(func.count()).select_from(model).where(*owner))
        datasets[name] = [
            {field: getattr(row, field) for field in fields} | {"created_at": row.created_at}
            for row in rows
        ]
    return datasets, totals
