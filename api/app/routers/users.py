"""User management endpoints - account deletion for Apple compliance."""

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.config import get_settings
from app.db import get_db
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
from app.services.clerk import ClerkBackendClient
from app.services.storage import storage_service

router = APIRouter(prefix="/api/users", tags=["users"])
settings = get_settings()


async def _delete_clerk_users(identities: list[tuple[str, str]]) -> bool:
    """Delete every issuer-scoped Clerk alias for the local account."""
    deleted_all = True
    for issuer, clerk_user_id in identities:
        environment = settings.clerk_environment_for_issuer(issuer)
        if environment is None or not environment.secret_key:
            deleted_all = False
            continue
        deleted_all = (
            await ClerkBackendClient(environment, timeout=20.0).delete_user(clerk_user_id)
            and deleted_all
        )
    return deleted_all


@router.delete("/me")
async def delete_account(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """
    Delete the current user's account and associated data.

    This permanently deletes local app data and, when CLERK_SECRET_KEY is configured,
    also deletes the Clerk account record.
    """
    user_id = user.id
    identity_result = await db.execute(
        select(ClerkIdentity.issuer, ClerkIdentity.clerk_user_id).where(
            ClerkIdentity.app_user_id == user_id
        )
    )
    clerk_identities = [(row[0], row[1]) for row in identity_result.all()]

    try:
        recipe_result = await db.execute(select(Recipe.id).where(Recipe.user_id == user_id))
        recipe_ids = [row[0] for row in recipe_result.all()]

        list_result = await db.execute(
            select(GroceryListMember.list_id).where(GroceryListMember.user_id == user_id)
        )
        list_ids = [row[0] for row in list_result.all()]

        collection_result = await db.execute(select(Collection.id).where(Collection.user_id == user_id))
        collection_ids = [row[0] for row in collection_result.all()]

        # S3 cleanup is best-effort; database deletion should not be blocked by storage issues.
        for recipe_id in recipe_ids:
            try:
                await storage_service.delete_thumbnail(recipe_id)
            except Exception as e:
                print(f"Warning: Failed to delete thumbnail for {recipe_id}: {e}")
        try:
            await storage_service.delete_prefix(f"chat-images/{user_id}/")
        except Exception as e:
            print(f"Warning: Failed to delete chat images for {user_id}: {e}")

        if collection_ids:
            await db.execute(delete(CollectionRecipe).where(CollectionRecipe.collection_id.in_(collection_ids)))

        if recipe_ids:
            await db.execute(delete(CollectionRecipe).where(CollectionRecipe.recipe_id.in_(recipe_ids)))
            await db.execute(delete(RecipeVersion).where(RecipeVersion.recipe_id.in_(recipe_ids)))
            await db.execute(delete(RecipeNote).where(RecipeNote.recipe_id.in_(recipe_ids)))
            await db.execute(delete(SavedRecipe).where(SavedRecipe.recipe_id.in_(recipe_ids)))
            await db.execute(delete(ExtractionJob).where(ExtractionJob.recipe_id.in_(recipe_ids)))
            await db.execute(delete(MealPlanEntry).where(MealPlanEntry.recipe_id.in_(recipe_ids)))

        # User-owned/supporting data.
        await db.execute(delete(SavedRecipe).where(SavedRecipe.user_id == user_id))
        await db.execute(delete(RecipeNote).where(RecipeNote.user_id == user_id))
        await db.execute(delete(MealPlanEntry).where(MealPlanEntry.user_id == user_id))
        await db.execute(delete(ExtractionJob).where(ExtractionJob.user_id == user_id))
        await db.execute(delete(Collection).where(Collection.user_id == user_id))
        await db.execute(delete(GroceryItem).where(GroceryItem.user_id == user_id))
        await db.execute(delete(GroceryListInvite).where(GroceryListInvite.created_by == user_id))
        await db.execute(delete(GroceryListMember).where(GroceryListMember.user_id == user_id))
        await db.execute(delete(Recipe).where(Recipe.user_id == user_id))
        await db.execute(delete(ClerkIdentity).where(ClerkIdentity.app_user_id == user_id))
        await db.execute(delete(AppUser).where(AppUser.id == user_id))

        # Delete grocery lists that are now empty after this user leaves/deletes account.
        if list_ids:
            remaining_members = await db.execute(
                select(GroceryListMember.list_id).where(GroceryListMember.list_id.in_(list_ids))
            )
            non_empty_list_ids = {row[0] for row in remaining_members.all()}
            empty_list_ids = [list_id for list_id in list_ids if list_id not in non_empty_list_ids]
            if empty_list_ids:
                await db.execute(delete(GroceryListInvite).where(GroceryListInvite.list_id.in_(empty_list_ids)))
                await db.execute(delete(GroceryItem).where(GroceryItem.list_id.in_(empty_list_ids)))
                await db.execute(delete(GroceryList).where(GroceryList.id.in_(empty_list_ids)))

        await db.commit()

    except Exception as e:
        await db.rollback()
        sentry_sdk.capture_exception(e)
        print(f"❌ Failed to delete local account data for {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to delete account. Please try again.",
        )

    clerk_deleted = False
    try:
        clerk_deleted = await _delete_clerk_users(clerk_identities)
    except Exception as e:
        sentry_sdk.capture_exception(e)
        print(f"⚠️ Local account data deleted, but Clerk deletion failed for {user_id}: {e}")

    return {
        "message": "Account deleted successfully",
        "deleted": {
            "recipes": len(recipe_ids),
            "collections": len(collection_ids),
        },
        "clerk_deleted": clerk_deleted,
    }
