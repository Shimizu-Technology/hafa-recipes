"""Exact owner-scoped erasure/export hooks for parent integration."""

from sqlalchemy import delete, select

from app.domains.workouts.connection_models import (
    RecipeConnectionReceipt,
    WorkoutCopyReceipt,
    WorkoutShare,
    WorkoutSharePreview,
)


async def erase_connections_data(db, app_user_id: str):
    """Call while holding the AppUser lock inside product data deletion.

    Recipient copies are owned by the recipient and deliberately survive another
    owner's link revocation/deletion. No public token or external media remains.
    """
    for model in (RecipeConnectionReceipt, WorkoutCopyReceipt, WorkoutSharePreview, WorkoutShare):
        await db.execute(delete(model).where(model.app_user_id == app_user_id))


async def connection_export_page(db, app_user_id: str, generation: int, *, limit=10, offset=0):
    """Private user export excludes all bearer credentials and token ciphertext."""
    datasets = {}
    for name, model in (
        ("recipe_connection_receipts", RecipeConnectionReceipt),
        ("published_training_shares", WorkoutShare),
        ("training_copy_receipts", WorkoutCopyReceipt),
    ):
        rows = (
            await db.scalars(
                select(model)
                .where(model.app_user_id == app_user_id, model.generation == generation)
                .order_by(model.created_at, model.id)
                .limit(limit)
                .offset(offset)
            )
        ).all()
        datasets[name] = [
            {
                "id": str(row.id),
                "created_at": row.created_at.isoformat(),
                **(
                    {
                        "purpose": row.purpose,
                        "scopes": row.scopes,
                        "recipe_ids": row.recipe_ids,
                        "meal_plan_ids": row.meal_plan_ids,
                    }
                    if model is RecipeConnectionReceipt
                    else {
                        "kind": row.kind,
                        "snapshot": row.snapshot,
                        "snapshot_digest": row.snapshot_digest,
                        "expires_at": row.expires_at.isoformat(),
                        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
                    }
                    if model is WorkoutShare
                    else {
                        "kind": row.kind,
                        "record_id": str(row.record_id),
                        "source_share_id": str(row.share_id),
                        "snapshot_digest": row.snapshot_digest,
                        "attribution": row.attribution,
                    }
                ),
            }
            for row in rows
        ]
    return datasets
