"""Meal planning API endpoints."""

import hashlib
import json
from datetime import date, datetime, timedelta
from fractions import Fraction
from typing import List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.models.grocery import GroceryItem, GroceryMutationReceipt
from app.models.meal_plan import MealPlanEntry
from app.models.recipe import Recipe
from app.moderation import accessible_recipe_conditions, is_publicly_viewable
from app.plan_quantities import scaled_plan_quantity
from app.plan_schema import load_planned_servings, require_planned_servings
from app.recipe_review import review_response_fields
from app.routers.grocery import _lock_grocery_list, get_or_create_user_list

router = APIRouter(prefix="/api/meal-plans", tags=["meal-plans"])


# ============================================================
# Pydantic Schemas
# ============================================================

class MealPlanEntryCreate(BaseModel):
    """Request to add a meal to the plan."""
    date: date
    meal_type: str  # breakfast, lunch, dinner, snack
    recipe_id: UUID
    recipe_title: str
    recipe_thumbnail: Optional[str] = None
    notes: Optional[str] = None
    servings: Optional[str] = None
    planned_servings: Optional[int] = Field(default=None, ge=1, le=1000)


class MealPlanEntryUpdate(BaseModel):
    """Request to update a meal plan entry."""
    meal_type: Optional[str] = None
    date: Optional[date] = None
    notes: Optional[str] = None
    servings: Optional[str] = None
    planned_servings: Optional[int] = Field(default=None, ge=1, le=1000)


class MealPlanEntryResponse(BaseModel):
    """Meal plan entry response."""
    id: UUID
    date: date
    meal_type: str
    recipe_id: UUID
    recipe_title: str
    recipe_thumbnail: Optional[str] = None
    notes: Optional[str] = None
    servings: Optional[str] = None
    planned_servings: Optional[int] = Field(default=None, ge=1, le=1000)
    recipe_review_state: Optional[
        Literal["source_incomplete", "needs_review", "ready"]
    ] = None
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class DayMeals(BaseModel):
    """All meals for a single day."""
    date: date
    breakfast: List[MealPlanEntryResponse] = []
    lunch: List[MealPlanEntryResponse] = []
    dinner: List[MealPlanEntryResponse] = []
    snack: List[MealPlanEntryResponse] = []


class WeekPlanResponse(BaseModel):
    """A full week's meal plan."""
    week_start: date
    week_end: date
    days: List[DayMeals]


class AddToGroceryRequest(BaseModel):
    """Request to add meal plan ingredients to grocery list."""
    start_date: date
    end_date: date
    preview_token: Optional[str] = None
    mutation_id: Optional[UUID] = None
    list_id: Optional[UUID] = None
    review: Optional[dict] = None


# ============================================================
# Helper Functions
# ============================================================

def get_week_bounds(target_date: date) -> tuple[date, date]:
    """Get the Monday and Sunday of the week containing target_date."""
    # Monday = 0, Sunday = 6
    days_since_monday = target_date.weekday()
    week_start = target_date - timedelta(days=days_since_monday)
    week_end = week_start + timedelta(days=6)
    return week_start, week_end


def _normalized_quantity(quantity: object) -> Optional[str]:
    """Normalize stated quantities without preserving legacy null sentinels."""
    if isinstance(quantity, str):
        normalized = quantity.strip()
        return normalized if normalized and normalized.lower() != "null" else None
    if isinstance(quantity, (int, float)) and not isinstance(quantity, bool):
        return str(quantity)
    return None


def _has_stated_quantity(quantity: object) -> bool:
    return _normalized_quantity(quantity) is not None


async def get_accessible_recipe(
    db: AsyncSession,
    recipe_id: UUID,
    user: ClerkUser,
) -> Optional[Recipe]:
    """Return a recipe if the user owns it or it passes current public policy."""
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    recipe = result.scalar_one_or_none()

    if not recipe:
        return None

    if recipe.user_id == user.id:
        return recipe
    return recipe if await is_publicly_viewable(db, recipe, user.id) else None


def meal_plan_entry_response(
    entry: MealPlanEntry,
    recipe: Recipe,
) -> MealPlanEntryResponse:
    """Attach current recipe readiness without persisting a stale snapshot."""
    return MealPlanEntryResponse.model_validate(entry).model_copy(
        update={"recipe_review_state": review_response_fields(recipe, include_evidence=False)["review_state"]}
    )


def organize_by_day(
    entries: List[tuple[MealPlanEntry, Recipe]],
    week_start: date,
    week_end: date,
) -> List[DayMeals]:
    """Organize entries into days with meal slots."""
    # Create a dict for quick lookup
    entries_by_date = {}
    for entry, recipe in entries:
        if entry.date not in entries_by_date:
            entries_by_date[entry.date] = {"breakfast": [], "lunch": [], "dinner": [], "snack": []}
        meal_type = entry.meal_type.lower()
        if meal_type in entries_by_date[entry.date]:
            entries_by_date[entry.date][meal_type].append(
                meal_plan_entry_response(entry, recipe)
            )
    
    # Build the response for each day of the week
    days = []
    current_date = week_start
    while current_date <= week_end:
        day_meals = entries_by_date.get(current_date, {"breakfast": [], "lunch": [], "dinner": [], "snack": []})
        days.append(DayMeals(
            date=current_date,
            breakfast=day_meals["breakfast"],
            lunch=day_meals["lunch"],
            dinner=day_meals["dinner"],
            snack=day_meals["snack"],
        ))
        current_date += timedelta(days=1)
    
    return days


# ============================================================
# Endpoints
# ============================================================


def _recipe_plan_entries_statement(
    recipe_id: UUID,
    user_id: str,
    first_date: date,
    limit: int,
):
    """Build the bounded, policy-scoped recipe relationship query."""
    return (
        select(MealPlanEntry, Recipe)
        .options(load_only(
            Recipe.review_state, Recipe.extracted, Recipe.extraction_evidence,
            Recipe.source_type, Recipe.extraction_method, Recipe.content_revision,
        ))
        .join(Recipe, Recipe.id == MealPlanEntry.recipe_id)
        .where(
            MealPlanEntry.user_id == user_id,
            MealPlanEntry.recipe_id == recipe_id,
            MealPlanEntry.date >= first_date,
            *accessible_recipe_conditions(user_id),
        )
        .order_by(
            MealPlanEntry.date,
            MealPlanEntry.meal_type,
            MealPlanEntry.created_at,
        )
        .limit(limit)
    )

@router.get("/week", response_model=WeekPlanResponse)
async def get_week_plan(
    week_of: Optional[date] = Query(default=None, description="Any date in the target week (defaults to current week)"),
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """
    Get the meal plan for a specific week.
    
    Pass any date in the target week, or omit to get the current week.
    Returns Monday-Sunday with all meal slots.
    """
    target_date = week_of or date.today()
    week_start, week_end = get_week_bounds(target_date)
    
    # Fetch all entries for this week
    result = await db.execute(
        select(MealPlanEntry, Recipe)
        .options(load_only(
            Recipe.review_state, Recipe.extracted, Recipe.extraction_evidence,
            Recipe.source_type, Recipe.extraction_method, Recipe.content_revision,
        ))
        .join(Recipe, Recipe.id == MealPlanEntry.recipe_id)
        .where(
            MealPlanEntry.user_id == user.id,
            MealPlanEntry.date >= week_start,
            MealPlanEntry.date <= week_end,
            *accessible_recipe_conditions(user.id),
        )
        .order_by(MealPlanEntry.date, MealPlanEntry.meal_type, MealPlanEntry.created_at)
    )
    entries = result.all()
    await load_planned_servings(db, [entry for entry, _ in entries])
    
    # Organize by day
    days = organize_by_day(entries, week_start, week_end)
    
    return WeekPlanResponse(
        week_start=week_start,
        week_end=week_end,
        days=days
    )


@router.get("/day", response_model=DayMeals)
async def get_day_plan(
    target_date: Optional[date] = Query(default=None, description="Target date (defaults to today)"),
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Get the meal plan for a specific day."""
    target = target_date or date.today()
    
    result = await db.execute(
        select(MealPlanEntry, Recipe)
        .options(load_only(
            Recipe.review_state, Recipe.extracted, Recipe.extraction_evidence,
            Recipe.source_type, Recipe.extraction_method, Recipe.content_revision,
        ))
        .join(Recipe, Recipe.id == MealPlanEntry.recipe_id)
        .where(
            MealPlanEntry.user_id == user.id,
            MealPlanEntry.date == target,
            *accessible_recipe_conditions(user.id),
        )
        .order_by(MealPlanEntry.meal_type, MealPlanEntry.created_at)
    )
    entries = result.all()
    await load_planned_servings(db, [entry for entry, _ in entries])
    
    # Organize into meal slots
    meals = {"breakfast": [], "lunch": [], "dinner": [], "snack": []}
    for entry, recipe in entries:
        meal_type = entry.meal_type.lower()
        if meal_type in meals:
            meals[meal_type].append(
                meal_plan_entry_response(entry, recipe)
            )
    
    return DayMeals(
        date=target,
        breakfast=meals["breakfast"],
        lunch=meals["lunch"],
        dinner=meals["dinner"],
        snack=meals["snack"],
    )


@router.get("/recipe/{recipe_id}", response_model=List[MealPlanEntryResponse])
async def get_recipe_plan_entries(
    recipe_id: UUID,
    start_date: Optional[date] = Query(
        default=None,
        description="Earliest planned date (defaults to today)",
    ),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Return this user's upcoming meal-plan relationships for a recipe."""
    first_date = start_date or date.today()
    result = await db.execute(
        _recipe_plan_entries_statement(recipe_id, user.id, first_date, limit)
    )
    entries = result.all()
    await load_planned_servings(db, [entry for entry, _ in entries])
    return [meal_plan_entry_response(entry, recipe) for entry, recipe in entries]


@router.post("/", response_model=MealPlanEntryResponse)
async def add_meal(
    entry: MealPlanEntryCreate,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Add a recipe to a meal slot."""
    # Validate meal_type
    valid_meal_types = ["breakfast", "lunch", "dinner", "snack"]
    if entry.meal_type.lower() not in valid_meal_types:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid meal_type. Must be one of: {', '.join(valid_meal_types)}"
        )
    
    recipe = await get_accessible_recipe(db, entry.recipe_id, user)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    recipe_title = recipe.extracted.get("title") if recipe.extracted else entry.recipe_title

    await require_planned_servings(db, entry.planned_servings)
    new_entry = MealPlanEntry(
        user_id=user.id,
        date=entry.date,
        meal_type=entry.meal_type.lower(),
        recipe_id=entry.recipe_id,
        recipe_title=recipe_title or entry.recipe_title,
        recipe_thumbnail=entry.recipe_thumbnail,
        notes=entry.notes,
        servings=entry.servings,
        planned_servings=entry.planned_servings,
    )
    
    db.add(new_entry)
    await db.commit()
    await db.refresh(new_entry)
    await load_planned_servings(db, [new_entry])
    
    return meal_plan_entry_response(new_entry, recipe)


@router.put("/{entry_id}", response_model=MealPlanEntryResponse)
async def update_meal(
    entry_id: UUID,
    update: MealPlanEntryUpdate,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Update a meal plan entry (e.g., change date, notes, servings)."""
    result = await db.execute(
        select(MealPlanEntry).where(
            MealPlanEntry.id == entry_id,
            MealPlanEntry.user_id == user.id
        )
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(status_code=404, detail="Meal plan entry not found")
    recipe = await get_accessible_recipe(db, entry.recipe_id, user)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Meal plan entry not found")
    
    if update.meal_type is not None:
        valid_meal_types = ["breakfast", "lunch", "dinner", "snack"]
        if update.meal_type.lower() not in valid_meal_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid meal_type. Must be one of: {', '.join(valid_meal_types)}"
            )
        entry.meal_type = update.meal_type.lower()
    if update.date is not None:
        entry.date = update.date
    if update.notes is not None:
        entry.notes = update.notes
    await require_planned_servings(db, update.planned_servings)
    if update.planned_servings is not None:
        entry.planned_servings = update.planned_servings
    if update.servings is not None:
        entry.servings = update.servings
    
    await db.commit()
    await db.refresh(entry)
    await load_planned_servings(db, [entry])
    
    return meal_plan_entry_response(entry, recipe)


@router.delete("/{entry_id}")
async def delete_meal(
    entry_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Remove a recipe from the meal plan."""
    result = await db.execute(
        select(MealPlanEntry).where(
            MealPlanEntry.id == entry_id,
            MealPlanEntry.user_id == user.id
        )
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(status_code=404, detail="Meal plan entry not found")
    
    await db.delete(entry)
    await db.commit()
    
    return {"message": "Meal removed from plan", "id": str(entry_id)}


@router.delete("/day/{target_date}")
async def clear_day(
    target_date: date,
    meal_type: Optional[str] = Query(default=None, description="Clear only this meal type"),
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Clear all meals for a specific day (or just one meal type)."""
    query = delete(MealPlanEntry).where(
        MealPlanEntry.user_id == user.id,
        MealPlanEntry.date == target_date
    )
    
    if meal_type:
        query = query.where(MealPlanEntry.meal_type == meal_type.lower())
    
    result = await db.execute(query.returning(MealPlanEntry.id))
    deleted_ids = result.scalars().all()
    await db.commit()
    
    return {
        "message": f"Cleared {len(deleted_ids)} meals from {target_date}",
        "count": len(deleted_ids)
    }


async def plan_grocery_preview(request, db, user, grocery_list=None):
    grocery_list = grocery_list or await get_or_create_user_list(db, user)
    result = await db.execute(select(MealPlanEntry).where(
        MealPlanEntry.user_id == user.id, MealPlanEntry.date >= request.start_date,
        MealPlanEntry.date <= request.end_date,
    ).order_by(MealPlanEntry.date, MealPlanEntry.id))
    entries = result.scalars().all()
    await load_planned_servings(db, entries)
    recipes = {}
    for recipe_id in {entry.recipe_id for entry in entries}:
        recipe = await get_accessible_recipe(db, recipe_id, user)
        if recipe:
            recipes[recipe.id] = recipe
    items = []
    for entry in entries:
        recipe = recipes.get(entry.recipe_id)
        if not recipe or not recipe.extracted:
            continue
        for component in recipe.extracted.get("components", []):
            for ingredient in component.get("ingredients", []):
                quantity, unscaled = scaled_plan_quantity(
                    _normalized_quantity(ingredient.get("quantity")),
                    getattr(entry, "planned_servings", None), recipe.extracted.get("servings"),
                )
                items.append(dict(name=ingredient.get("name", "Unknown"), quantity=quantity,
                    unit=ingredient.get("unit"), notes=ingredient.get("notes"),
                    recipe_id=str(entry.recipe_id), recipe_title=entry.recipe_title, unscaled=unscaled))
    totals = {}
    for item in items:
        key = (item["name"].strip().casefold(), (item["unit"] or "").strip().casefold())
        total = totals.setdefault(key, dict(name=item["name"], unit=item["unit"], quantity=None, missing=0, uncombined=0))
        if item["quantity"] is None:
            total["missing"] += 1
        else:
            normalized, unknown = scaled_plan_quantity(item["quantity"], 1, 1)
            if unknown:
                total["uncombined"] += 1
            else:
                total["quantity"] = str(Fraction(total["quantity"] or "0") + Fraction(normalized))
    token = hashlib.sha256(json.dumps([user.id, str(grocery_list.id), str(request.start_date), str(request.end_date), items], sort_keys=True).encode()).hexdigest()
    return dict(list_id=str(grocery_list.id), totals=list(totals.values()), message=f"Added {len(items)} ingredients to grocery list" if items else "No meals planned in this date range", items=items, items_added=len(items), items_missing_amount=sum(i["quantity"] is None for i in items),
                items_unscaled=sum(i["unscaled"] for i in items), recipes_processed=len(recipes), preview_token=token)


@router.post("/to-grocery/preview")
async def preview_plan_grocery(request: AddToGroceryRequest, db: AsyncSession = Depends(get_db), user: ClerkUser = Depends(get_current_user)):
    """Read-only review of the same quantities the final addition will use."""
    return await plan_grocery_preview(request, db, user)


@router.post("/to-grocery")
async def add_plan_to_grocery(request: AddToGroceryRequest, db: AsyncSession = Depends(get_db), user: ClerkUser = Depends(get_current_user)):
    modern = request.mutation_id is not None or request.list_id is not None or request.review is not None
    if modern and not (request.mutation_id and request.list_id and request.review and request.preview_token):
        raise HTTPException(status_code=400, detail="Review this grocery addition before confirming it.")
    grocery_list = await get_or_create_user_list(db, user)  # Holds the membership/account lock.
    if modern and request.list_id != grocery_list.id:
        raise HTTPException(status_code=409, detail="Your household changed. Review this list before adding groceries.")
    grocery_list = await _lock_grocery_list(db, grocery_list.id)  # Refresh even an already loaded identity.
    if modern:
        # The exact reviewed result is carried by the client, bound to its receipt.
        # A first acceptance compares it to the authoritative calculation below.
        # Replays need no mutable recipe/plan reads or additional schema columns.
        try:
            serialized = json.dumps([user.id, str(request.list_id), str(request.start_date), str(request.end_date), request.preview_token, request.review], sort_keys=True, allow_nan=False)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid grocery review") from None
        if len(serialized) > 500_000:
            raise HTTPException(status_code=400, detail="This grocery review is too large.")
        request_hash = hashlib.sha256(serialized.encode()).hexdigest()
        receipt = await db.get(GroceryMutationReceipt, (grocery_list.id, request.mutation_id))
        if receipt:
            if receipt.actor_user_id != user.id or receipt.operation != "add" or receipt.request_hash != request_hash:
                raise HTTPException(status_code=409, detail="This grocery addition has different ingredients. Review again.")
            return {**request.review, "replayed": True}
    preview = await plan_grocery_preview(request, db, user, grocery_list)
    if request.preview_token and request.preview_token != preview["preview_token"] or modern and request.review != preview:
        raise HTTPException(status_code=409, detail="Your plan changed. Review the ingredients again.")
    if not preview["items"]:
        return preview
    if modern:
        db.add(GroceryMutationReceipt(list_id=grocery_list.id, mutation_id=request.mutation_id,
            actor_user_id=user.id, operation="add", request_hash=request_hash))
    for item in preview["items"]:
        db.add(GroceryItem(user_id=user.id, list_id=grocery_list.id, checked=False, added_by_name=user.display_name,
            **{key: UUID(value) if key == "recipe_id" else value for key, value in item.items() if key != "unscaled"}))
    grocery_list.revision = (getattr(grocery_list, "revision", 0) or 0) + 1
    await db.commit()
    return preview


@router.post("/copy-week")
async def copy_week(
    source_week: date = Query(..., description="Any date in the source week"),
    target_week: date = Query(..., description="Any date in the target week"),
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """
    Copy a week's meal plan to another week.
    
    Useful for repeating a good week or planning ahead.
    """
    source_start, source_end = get_week_bounds(source_week)
    target_start, target_end = get_week_bounds(target_week)
    
    if source_start == target_start:
        raise HTTPException(status_code=400, detail="Source and target weeks are the same")
    
    # Get source week entries
    result = await db.execute(
        select(MealPlanEntry)
        .join(Recipe, Recipe.id == MealPlanEntry.recipe_id)
        .where(
            MealPlanEntry.user_id == user.id,
            MealPlanEntry.date >= source_start,
            MealPlanEntry.date <= source_end,
            *accessible_recipe_conditions(user.id),
        )
    )
    source_entries = result.scalars().all()
    await load_planned_servings(db, source_entries)
    
    if not source_entries:
        return {"message": "No meals to copy from source week", "entries_copied": 0}
    
    # Calculate the day offset
    day_offset = (target_start - source_start).days
    
    # Create new entries for target week
    entries_copied = 0
    for entry in source_entries:
        new_date = entry.date + timedelta(days=day_offset)
        new_entry = MealPlanEntry(
            user_id=user.id,
            date=new_date,
            meal_type=entry.meal_type,
            recipe_id=entry.recipe_id,
            recipe_title=entry.recipe_title,
            recipe_thumbnail=entry.recipe_thumbnail,
            notes=entry.notes,
            servings=entry.servings,
        planned_servings=entry.planned_servings,
        )
        db.add(new_entry)
        entries_copied += 1
    
    await db.commit()
    
    return {
        "message": f"Copied {entries_copied} meals from {source_start} to {target_start}",
        "entries_copied": entries_copied,
        "target_week_start": target_start
    }
