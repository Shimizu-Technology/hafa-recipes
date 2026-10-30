"""Adopt the optional expansion only when this request's database has it."""

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm.attributes import set_committed_value

from app.models.meal_plan import MealPlanEntry


async def supports_planned_servings(db):
    if "planned_servings_supported" not in db.info:
        db.info["planned_servings_supported"] = bool(
            await db.scalar(
                text("""
            SELECT EXISTS (SELECT 1 FROM pg_attribute
            WHERE attrelid=to_regclass('meal_plan_entries') AND attname='planned_servings'
            AND atttypid='integer'::regtype AND NOT attisdropped)
        """)
            )
        )
    return db.info["planned_servings_supported"]


async def require_planned_servings(db, value):
    if value is not None and not await supports_planned_servings(db):
        raise HTTPException(
            status_code=503,
            detail="Serving edits are temporarily unavailable. Your existing plan is unchanged; try again later.",
        )


async def load_planned_servings(db, entries):
    entries = [entry for entry in entries if isinstance(entry, MealPlanEntry)]
    if not entries:
        return
    values = {}
    if await supports_planned_servings(db):
        values = dict(
            (
                await db.execute(
                    select(MealPlanEntry.id, MealPlanEntry.planned_servings).where(
                        MealPlanEntry.id.in_([entry.id for entry in entries])
                    )
                )
            ).all()
        )
    for entry in entries:
        set_committed_value(entry, "planned_servings", values.get(entry.id))
