"""Shared account locks fence every Workouts write and future worker completion."""

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsActivity,
    WorkoutsConsent,
    WorkoutsGrant,
    WorkoutsMembership,
    WorkoutsProfile,
    WorkoutsProgram,
    WorkoutsSession,
)
from app.models.identity import AppUser


def now():
    return datetime.now(UTC)


async def lock_owner(db, app_user_id: str):
    # Same first lock as legacy DELETE /api/users/me. An in-flight write either
    # finishes before deletion or waits and observes that the owner is gone.
    owner = await db.scalar(select(AppUser.id).where(AppUser.id == app_user_id).with_for_update())
    if owner is None:
        raise HTTPException(404, "Account not found")


async def membership_for(db, app_user_id: str, *, generation=None, write=False, active=True):
    if write:
        await lock_owner(db, app_user_id)
    membership = await db.scalar(
        select(WorkoutsMembership)
        .where(
            WorkoutsMembership.app_user_id == app_user_id,
        )
        .execution_options(populate_existing=True)
    )
    if membership is None or (active and membership.status != "active"):
        raise HTTPException(409, "Explicit Workouts enrollment is required")
    if generation is not None and membership.generation != generation:
        raise HTTPException(409, "Workouts data generation changed; refresh before saving")
    return membership


async def erase_product_data(db, membership, requested_generation: int):
    if membership.status == "deleted" and requested_generation == membership.generation - 1:
        return membership  # Retry of the already-completed deletion.
    if requested_generation != membership.generation or membership.status != "active":
        raise HTTPException(409, "Workouts data generation changed; refresh before deleting")
    # Version records cascade from the library/program rows. The membership
    # tombstone remains so delayed offline writes cannot silently re-enroll.
    for model in (
        WorkoutsSession,
        WorkoutsActivity,
        WorkoutsConsent,
        WorkoutsGrant,
        WorkoutsProfile,
        WorkoutRecord,
        WorkoutsProgram,
    ):
        await db.execute(delete(model).where(model.app_user_id == membership.app_user_id))
    membership.generation += 1
    membership.status = "deleted"
    membership.deleted_at = now()
    await db.flush()
    return membership


def external_cleanup_targets(app_user_id: str) -> tuple[str, ...]:
    """No external Workouts media exists yet; never return a broad storage prefix.

    Future media must register exact owned objects and durable cleanup intent in
    the same deletion transaction, both here and in whole-Håfa-account deletion.
    """
    del app_user_id
    return ()
