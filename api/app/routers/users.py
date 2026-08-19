"""User management endpoints, including durable account deletion."""

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.config import get_settings
from app.db import get_db
from app.deletion_cleanup import deletion_cleanup_worker, hash_auth_identity
from app.media_lifecycle import acquire_recipe_media_lock
from app.models.deletion import DeletedAuthIdentity, DeletionCleanupJob
from app.models.grocery import GroceryItem, GroceryList, GroceryListInvite, GroceryListMember
from app.models.identity import AppUser, ClerkIdentity
from app.models.meal_plan import MealPlanEntry
from app.models.recipe import (
    Collection,
    CollectionRecipe,
    ExtractionJob,
    Recipe,
    RecipeNote,
    RecipeVersion,
    SavedRecipe,
)
from app.services.storage import storage_service

router = APIRouter(prefix="/api/users", tags=["users"])
settings = get_settings()


def _account_cleanup_response(job: DeletionCleanupJob, recipe_count: int = 0) -> dict:
    return {
        "message": "Account data deleted; external cleanup is being finalized",
        "deleted": {"recipes": recipe_count},
        "cleanup": {
            "id": str(job.id),
            "status": job.status,
            "clerk_accounts": job.clerk_target_count,
            "storage_prefixes": job.storage_prefix_count,
        },
    }


@router.delete("/me", status_code=status.HTTP_202_ACCEPTED)
async def delete_account(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Atomically erase local account data and queue retryable external cleanup."""
    user_id = user.id

    try:
        app_user_result = await db.execute(
            select(AppUser).where(AppUser.id == user_id).with_for_update()
        )
        app_user = app_user_result.scalar_one_or_none()
        if app_user is None:
            existing_result = await db.execute(
                select(DeletionCleanupJob).where(
                    DeletionCleanupJob.kind == "account",
                    DeletionCleanupJob.app_user_id == user_id,
                )
            )
            existing_job = existing_result.scalar_one_or_none()
            if existing_job is None:
                await db.rollback()
                raise HTTPException(status_code=404, detail="Account not found")
            response = _account_cleanup_response(existing_job)
            await db.rollback()
            return response

        identity_result = await db.execute(
            select(ClerkIdentity.issuer, ClerkIdentity.clerk_user_id).where(
                ClerkIdentity.app_user_id == user_id
            )
        )
        clerk_identities = [
            {"issuer": issuer, "clerk_user_id": clerk_user_id}
            for issuer, clerk_user_id in identity_result.all()
        ]

        recipe_result = await db.execute(select(Recipe.id).where(Recipe.user_id == user_id))
        recipe_ids = [row[0] for row in recipe_result.all()]
        for recipe_id in sorted(recipe_ids, key=str):
            await acquire_recipe_media_lock(db, recipe_id)
        collection_result = await db.execute(
            select(Collection.id).where(Collection.user_id == user_id)
        )
        collection_ids = [row[0] for row in collection_result.all()]
        list_result = await db.execute(
            select(GroceryListMember.list_id).where(GroceryListMember.user_id == user_id)
        )
        list_ids = [row[0] for row in list_result.all()]

        storage_prefixes = [
            prefix
            for recipe_id in recipe_ids
            for prefix in storage_service.thumbnail_prefixes(recipe_id)
        ]
        storage_prefixes.append(f"chat-images/{user_id}/")

        cleanup_job = DeletionCleanupJob(
            kind="account",
            app_user_id=user_id,
            clerk_identities=clerk_identities,
            storage_prefixes=storage_prefixes,
            clerk_target_count=len(clerk_identities),
            storage_prefix_count=len(storage_prefixes),
            max_attempts=settings.deletion_cleanup_max_attempts,
        )
        db.add(cleanup_job)
        await db.flush()

        for identity in clerk_identities:
            db.add(
                DeletedAuthIdentity(
                    deletion_job_id=cleanup_job.id,
                    issuer=identity["issuer"],
                    clerk_user_id_hash=hash_auth_identity(
                        identity["issuer"], identity["clerk_user_id"]
                    ),
                )
            )

        if collection_ids:
            await db.execute(
                delete(CollectionRecipe).where(
                    CollectionRecipe.collection_id.in_(collection_ids)
                )
            )

        if recipe_ids:
            await db.execute(
                delete(CollectionRecipe).where(CollectionRecipe.recipe_id.in_(recipe_ids))
            )
            await db.execute(
                delete(RecipeVersion).where(RecipeVersion.recipe_id.in_(recipe_ids))
            )
            await db.execute(delete(RecipeNote).where(RecipeNote.recipe_id.in_(recipe_ids)))
            await db.execute(delete(SavedRecipe).where(SavedRecipe.recipe_id.in_(recipe_ids)))
            await db.execute(
                delete(ExtractionJob).where(
                    or_(
                        ExtractionJob.recipe_id.in_(recipe_ids),
                        ExtractionJob.target_recipe_id.in_(recipe_ids),
                    )
                )
            )
            await db.execute(
                delete(MealPlanEntry).where(MealPlanEntry.recipe_id.in_(recipe_ids))
            )

        # Remove or anonymize every remaining user reference before AppUser.
        await db.execute(delete(SavedRecipe).where(SavedRecipe.user_id == user_id))
        await db.execute(delete(RecipeNote).where(RecipeNote.user_id == user_id))
        await db.execute(delete(MealPlanEntry).where(MealPlanEntry.user_id == user_id))
        await db.execute(delete(ExtractionJob).where(ExtractionJob.user_id == user_id))
        await db.execute(delete(Collection).where(Collection.user_id == user_id))
        await db.execute(delete(GroceryItem).where(GroceryItem.user_id == user_id))
        await db.execute(
            delete(GroceryListInvite).where(
                or_(
                    GroceryListInvite.created_by == user_id,
                    GroceryListInvite.accepted_by == user_id,
                )
            )
        )
        await db.execute(delete(GroceryListMember).where(GroceryListMember.user_id == user_id))
        await db.execute(
            update(RecipeVersion)
            .where(RecipeVersion.created_by == user_id)
            .values(created_by=None)
        )
        await db.execute(delete(Recipe).where(Recipe.user_id == user_id))

        if list_ids:
            remaining_members = await db.execute(
                select(GroceryListMember.list_id).where(GroceryListMember.list_id.in_(list_ids))
            )
            non_empty_list_ids = set(remaining_members.scalars().all())
            empty_list_ids = [list_id for list_id in list_ids if list_id not in non_empty_list_ids]
            if empty_list_ids:
                await db.execute(
                    delete(GroceryListInvite).where(
                        GroceryListInvite.list_id.in_(empty_list_ids)
                    )
                )
                await db.execute(
                    delete(GroceryItem).where(GroceryItem.list_id.in_(empty_list_ids))
                )
                await db.execute(delete(GroceryList).where(GroceryList.id.in_(empty_list_ids)))

        await db.execute(delete(ClerkIdentity).where(ClerkIdentity.app_user_id == user_id))
        await db.execute(delete(AppUser).where(AppUser.id == user_id))
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as error:
        await db.rollback()
        sentry_sdk.capture_exception(error)
        raise HTTPException(
            status_code=500,
            detail="Failed to delete account. Please try again.",
        ) from error

    deletion_cleanup_worker.wake()
    return _account_cleanup_response(cleanup_job, len(recipe_ids))
