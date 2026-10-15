"""Owner-scoped conflicts shared by direct and proposed date moves."""

from fastapi import HTTPException
from sqlalchemy import select

from app.domains.workouts.models import WorkoutsProgram


async def validate_other_program_dates(db, user_id, generation, program_id, content, changed_ids):
    dates = {
        item["date"] for item in content["proposal"]["sessions"] if item["id"] in changed_ids
    }
    if not dates:
        return
    programs = (
        await db.scalars(select(WorkoutsProgram).where(
            WorkoutsProgram.app_user_id == user_id,
            WorkoutsProgram.generation == generation,
            WorkoutsProgram.id != program_id,
        ))
    ).all()
    if any(
        program.content.get("proposal", {}).get("status") == "ready"
        and program.content.get("schedule_state", {}).get("status") != "paused"
        and any(item["date"] in dates for item in program.content["proposal"].get("sessions", []))
        for program in programs
    ):
        raise HTTPException(409, "Another plan already has a session on this date")
