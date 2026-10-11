"""Bounded dietary projections; never send recipe notes or health/profile data."""

import math
from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import load_only

from app.domains.workouts.connection_models import RecipeConnectionReceipt
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import WorkoutsConsent, WorkoutsGrant
from app.domains.workouts.schemas import DomainModel
from app.models.meal_plan import MealPlanEntry
from app.models.recipe import Recipe, SavedRecipe
from app.moderation import accessible_recipe_conditions, public_recipe_conditions
from app.recipe_estimates import source_is_incomplete

RECIPE_SCOPES = frozenset({"recipes_library_context", "recipes_meal_plan_context"})


class DietaryIngredient(DomainModel):
    name: str
    quantity: str | None
    unit: str | None


class RecipeDietaryContext(DomainModel):
    id: UUID
    title: str
    servings: int | None
    ingredients: list[DietaryIngredient]
    incomplete: bool
    nutrition: dict[str, float | None]
    nutrition_basis: Literal["source", "recipe_servings", "whole_recipe"] | None
    nutrition_status: Literal["current", "stale", "unverified", "unavailable"]


class MealDietaryContext(DomainModel):
    id: UUID
    date: date
    meal_type: Literal["breakfast", "lunch", "dinner", "snack"]
    planned_servings: str | None
    recipe: RecipeDietaryContext


class RecipeConnectionContext(DomainModel):
    receipt_id: UUID
    scopes: list[str]
    start_date: date
    end_date: date
    library: list[RecipeDietaryContext] = Field(default_factory=list)
    meal_plan: list[MealDietaryContext] = Field(default_factory=list)
    notice: str = "Dietary context only. Nutrition is source-provided or estimated; incomplete/stale values need review."


def finite_value(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        return None
    return value if 0 <= value <= 1_000_000 else None


def bounded_text(value, length):
    return value[:length] if isinstance(value, str) else None


def project_recipe(recipe):
    extracted = recipe.extracted if isinstance(recipe.extracted, dict) else {}
    ingredient_values = extracted.get("ingredients")
    if not isinstance(ingredient_values, list) or not ingredient_values:
        ingredient_values = [
            ingredient
            for component in (extracted.get("components") or [])
            if isinstance(component, dict)
            for ingredient in (component.get("ingredients") or [])
        ]
    ingredients = []
    incomplete = source_is_incomplete(extracted, extraction_method=recipe.extraction_method)
    for value in ingredient_values[:25]:
        if not isinstance(value, dict) or not isinstance(value.get("name"), str):
            incomplete = True
            continue
        name = value["name"]
        quantity = value.get("quantity")
        if isinstance(quantity, (int, float)) and not isinstance(quantity, bool):
            quantity = str(quantity) if math.isfinite(quantity) else None
        unit = value.get("unit")
        if (
            len(name) > 120
            or (isinstance(quantity, str) and len(quantity) > 50)
            or (isinstance(unit, str) and len(unit) > 30)
        ):
            incomplete = True
        ingredients.append(
            DietaryIngredient(
                name=name[:120], quantity=bounded_text(quantity, 50), unit=bounded_text(unit, 30)
            )
        )
    if len(ingredient_values) > 25:
        incomplete = True
    nutrition_data = extracted.get("nutrition")
    nutrition_data = nutrition_data if isinstance(nutrition_data, dict) else {}
    values = nutrition_data.get("perServing")
    values = values if isinstance(values, dict) else {}
    nutrition = {
        key: finite_value(values.get(key))
        for key in ("calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium")
    }
    derived = extracted.get("derivedData")
    metadata = derived.get("nutrition", {}) if isinstance(derived, dict) else {}
    metadata = metadata if isinstance(metadata, dict) else {}
    status = metadata.get("status")
    if status not in {"current", "stale", "unverified", "unavailable"}:
        status = "unverified"
    if incomplete or not any(value is not None for value in nutrition.values()):
        status = "unavailable"
    if status in {"stale", "unavailable"}:
        nutrition = dict.fromkeys(nutrition, None)
    basis = nutrition_data.get("servingBasis")
    if basis not in {"source", "recipe_servings", "whole_recipe"}:
        basis = None
    servings = extracted.get("servings")
    if isinstance(servings, bool) or not isinstance(servings, int) or not 1 <= servings <= 1000:
        servings = None
    return RecipeDietaryContext(
        id=recipe.id,
        title=bounded_text(extracted.get("title"), 200) or "Untitled recipe",
        servings=servings,
        ingredients=ingredients,
        incomplete=incomplete,
        nutrition=nutrition,
        nutrition_basis=basis,
        nutrition_status=status,
    )


async def recipe_context(
    db, user_id, generation, *, purpose="view", recipe_ids=(), start_date=None, end_date=None
):
    if purpose not in {"view", "coach"}:
        raise HTTPException(422, "Unrecognized context purpose")
    await membership_for(db, user_id, generation=generation, write=True)
    grants = set(
        (
            await db.scalars(
                select(WorkoutsGrant.scope).where(
                    WorkoutsGrant.app_user_id == user_id,
                    WorkoutsGrant.generation == generation,
                    WorkoutsGrant.scope.in_(RECIPE_SCOPES),
                )
            )
        ).all()
    )
    if not grants:
        raise HTTPException(403, "Connect Recipes library or meal-plan context explicitly first")
    if purpose == "coach":
        consent = await db.get(WorkoutsConsent, user_id)
        if not consent or consent.generation != generation or not consent.accepted_at:
            raise HTTPException(403, "Current Workouts AI consent is required for coaching context")
    start_date = start_date or now().date()
    end_date = end_date or start_date + timedelta(days=6)
    if end_date < start_date or (end_date - start_date).days > 30:
        raise HTTPException(422, "Select a meal-plan range of at most 31 days")
    if len(recipe_ids) > 10:
        raise HTTPException(422, "Select at most 10 recipe IDs")
    library, meals = [], []
    if "recipes_library_context" in grants:
        access = or_(
            Recipe.user_id == user_id,
            and_(
                *public_recipe_conditions(user_id),
                exists(
                    select(SavedRecipe.id).where(
                        SavedRecipe.recipe_id == Recipe.id, SavedRecipe.user_id == user_id
                    )
                ),
            ),
        )
        query = (
            select(Recipe)
            .options(load_only(Recipe.id, Recipe.extracted, Recipe.extraction_method))
            .where(access)
        )
        if recipe_ids:
            query = query.where(Recipe.id.in_(recipe_ids))
        rows = (
            await db.scalars(query.order_by(Recipe.created_at.desc(), Recipe.id.desc()).limit(10))
        ).all()
        library = [project_recipe(row) for row in rows]
    if "recipes_meal_plan_context" in grants:
        rows = (
            await db.execute(
                select(MealPlanEntry, Recipe)
                .options(
                    load_only(Recipe.id, Recipe.extracted, Recipe.extraction_method),
                    load_only(
                        MealPlanEntry.id,
                        MealPlanEntry.date,
                        MealPlanEntry.meal_type,
                        MealPlanEntry.servings,
                    ),
                )
                .join(Recipe, Recipe.id == MealPlanEntry.recipe_id)
                .where(
                    MealPlanEntry.user_id == user_id,
                    MealPlanEntry.date >= start_date,
                    MealPlanEntry.date <= end_date,
                    *accessible_recipe_conditions(user_id),
                )
                .order_by(MealPlanEntry.date, MealPlanEntry.meal_type, MealPlanEntry.id)
                .limit(14)
            )
        ).all()
        meals = [
            MealDietaryContext(
                id=entry.id,
                date=entry.date,
                meal_type=entry.meal_type,
                planned_servings=entry.servings,
                recipe=project_recipe(recipe),
            )
            for entry, recipe in rows
            if entry.meal_type in {"breakfast", "lunch", "dinner", "snack"}
        ]
    receipt = RecipeConnectionReceipt(
        app_user_id=user_id,
        generation=generation,
        purpose=purpose,
        scopes=sorted(grants),
        recipe_ids=sorted(
            {str(item.id) for item in library} | {str(item.recipe.id) for item in meals}
        ),
        meal_plan_ids=[str(item.id) for item in meals],
    )
    db.add(receipt)
    await db.flush()
    return RecipeConnectionContext(
        receipt_id=receipt.id,
        scopes=sorted(grants),
        start_date=start_date,
        end_date=end_date,
        library=library,
        meal_plan=meals,
    )
