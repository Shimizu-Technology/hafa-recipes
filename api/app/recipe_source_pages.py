"""Owner-only original scan pages. Optional schema never affects old clients."""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import Column, ForeignKey, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.config import get_settings
from app.db.database import Base, get_db
from app.image_validation import ImageValidationError, validate_image_bytes
from app.media_lifecycle import acquire_recipe_media_lock
from app.models.deletion import DeletionCleanupJob
from app.models.recipe import Recipe
from app.services.storage import storage_service

router = APIRouter(prefix="/api/recipes", tags=["recipes"])
MAX_PAGE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 30 * 1024 * 1024


class RecipeSourcePages(Base):
    __tablename__ = "recipe_source_pages"
    recipe_id = Column(PGUUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), primary_key=True)
    pages = Column(JSONB, nullable=False)


def source_prefix(recipe_id, batch=None):
    return f"recipe-originals/{UUID(str(recipe_id))}/" + (f"{UUID(str(batch))}/" if batch else "")


async def schema_ready(db):
    return bool(await db.scalar(text("SELECT to_regclass('public.recipe_source_pages') IS NOT NULL")))


async def owned_recipe(db, recipe_id, user):
    await acquire_recipe_media_lock(db, recipe_id)
    recipe = await db.scalar(select(Recipe).where(Recipe.id == recipe_id).with_for_update())
    if recipe is None or recipe.user_id != user.id:
        raise HTTPException(404, "Recipe not found")
    return recipe


def cleanup_job(user, prefix, *, delayed=False):
    return DeletionCleanupJob(kind="recipe", app_user_id=user.id, storage_prefixes=[prefix],
        storage_prefix_count=1, max_attempts=get_settings().deletion_cleanup_max_attempts,
        next_attempt_at=datetime.now(timezone.utc) + timedelta(hours=1) if delayed else None)


@router.get("/{recipe_id}/source-pages")
async def read_pages(recipe_id: UUID, db: AsyncSession = Depends(get_db), user: ClerkUser = Depends(get_current_user)):
    await owned_recipe(db, recipe_id, user)
    if not await schema_ready(db):
        return {"pages": []}
    row = await db.get(RecipeSourcePages, recipe_id)
    pages = []
    for index, page in enumerate(row.pages if row else []):
        if not storage_service.is_enabled:
            raise HTTPException(503, "Original pages are temporarily unavailable")
        url = storage_service.presign_client.generate_presigned_url("get_object", Params={
            "Bucket": storage_service.bucket_name, "Key": page["key"],
            "ResponseCacheControl": "private, no-store",
        }, ExpiresIn=60)
        pages.append({"page": index + 1, "url": url})
    return {"pages": pages}


@router.post("/{recipe_id}/source-pages", status_code=201)
async def upload_pages(recipe_id: UUID, files: list[UploadFile], db: AsyncSession = Depends(get_db), user: ClerkUser = Depends(get_current_user)):
    await owned_recipe(db, recipe_id, user)
    if not await schema_ready(db) or not storage_service.is_enabled:
        raise HTTPException(503, "Original page storage is not ready; keep your scan and retry")
    if not 1 <= len(files) <= 10:
        raise HTTPException(422, "Choose 1 to 10 original pages")
    if await db.get(RecipeSourcePages, recipe_id):
        raise HTTPException(409, "Original pages already saved")
    images, total = [], 0
    for file in files:
        data = await file.read(MAX_PAGE_BYTES + 1)
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(413, "Original pages exceed 30 MB")
        try:
            images.append(validate_image_bytes(data, max_bytes=MAX_PAGE_BYTES, allow_heif=True))
        except ImageValidationError as exc:
            raise HTTPException(422, str(exc)) from exc
    prefix = source_prefix(recipe_id, uuid4())
    receipt = cleanup_job(user, prefix, delayed=True)
    db.add(receipt)
    # A durable orphan receipt precedes every storage write, including process loss.
    await db.commit()
    await owned_recipe(db, recipe_id, user)
    if await db.get(RecipeSourcePages, recipe_id):
        raise HTTPException(409, "Original pages already saved")
    pages = [{"key": f"{prefix}{index + 1}"} for index in range(len(images))]
    def write():
        for page, image in zip(pages, images, strict=True):
            storage_service.client.put_object(Bucket=storage_service.bucket_name,
                Key=page["key"], Body=image.data, ContentType=image.content_type,
                CacheControl="private, no-store")
    task = asyncio.create_task(asyncio.to_thread(write))
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        # Do not release deletion's media lock while a storage write is still running.
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        raise
    db.add(RecipeSourcePages(recipe_id=recipe_id, pages=pages))
    receipt.status = "completed"
    receipt.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"count": len(pages)}


@router.delete("/{recipe_id}/source-pages", status_code=202)
async def remove_pages(recipe_id: UUID, db: AsyncSession = Depends(get_db), user: ClerkUser = Depends(get_current_user)):
    await owned_recipe(db, recipe_id, user)
    if await schema_ready(db):
        row = await db.get(RecipeSourcePages, recipe_id)
        if row:
            # Exact batch prefix: a later re-upload cannot be erased by this cleanup.
            db.add(cleanup_job(user, row.pages[0]["key"].rsplit("/", 1)[0] + "/"))
            await db.delete(row)
    await db.commit()
    return {"removed": True}
