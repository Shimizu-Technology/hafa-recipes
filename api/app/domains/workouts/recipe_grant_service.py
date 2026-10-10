"""Scoped Recipes permissions cannot restore unrelated health/AI permissions."""

from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.domains.workouts.lifecycle import membership_for, now, optional_table_exists
from app.domains.workouts.models import WorkoutsGrant
from app.domains.workouts.recipe_grant_models import WorkoutsRecipeGrantEpoch

RECIPE_SCOPES = frozenset({"recipes_library_context", "recipes_meal_plan_context"})


def recipe_scope_subset(scopes):
    """Callers pass validated scope strings, never client-selected owner IDs."""
    return set(scopes) & RECIPE_SCOPES


async def current_recipe_revision(db, owner, generation):
    revision = await db.scalar(
        select(WorkoutsRecipeGrantEpoch.revision).where(
            WorkoutsRecipeGrantEpoch.app_user_id == owner,
            WorkoutsRecipeGrantEpoch.generation == generation,
        )
    )
    return revision or 0


async def advance_recipe_grant_revision(db, owner, generation, previous_scopes, next_scopes):
    """Root generic grant hook, inside its existing owner-locked transaction.

    Change only the epoch, never scope rows. Changes to health/AI alone do not
    invalidate an independent Recipes choice. ABA revocations advance even when
    the new scope set is empty. This helper does not commit or acquire another
    lock; every writer must use the same AppUser lock first.
    """
    if recipe_scope_subset(previous_scopes) == recipe_scope_subset(next_scopes):
        return await current_recipe_revision(db, owner, generation)
    epoch = await db.get(WorkoutsRecipeGrantEpoch, (owner, generation), populate_existing=True)
    if epoch is None:
        epoch = WorkoutsRecipeGrantEpoch(app_user_id=owner, generation=generation, revision=1)
        db.add(epoch)
    else:
        epoch.revision += 1
        epoch.updated_at = now()
    await db.flush()
    return epoch.revision


async def require_recipe_epoch_schema(db):
    if not await optional_table_exists(db, "workouts_recipe_grant_epochs"):
        raise HTTPException(
            503, "recipe_grant_epoch_unavailable", headers={"Cache-Control": "no-store"}
        )


async def recipe_grant_snapshot(db, owner, generation):
    rows = (
        await db.scalars(
            select(WorkoutsGrant)
            .where(
                WorkoutsGrant.app_user_id == owner,
                WorkoutsGrant.generation == generation,
                WorkoutsGrant.scope.in_(RECIPE_SCOPES),
            )
            .order_by(WorkoutsGrant.scope)
        )
    ).all()
    scopes = {row.scope for row in rows}
    return {
        "generation": generation,
        "revision": await current_recipe_revision(db, owner, generation),
        "library_context": "recipes_library_context" in scopes,
        "meal_plan_context": "recipes_meal_plan_context" in scopes,
        "scopes": [{"scope": row.scope, "granted_at": row.granted_at} for row in rows],
    }


async def get_recipe_grants(db, owner, generation):
    # A coherent revision+choice read cannot mix before/after states. The owner
    # lock matches all grant writes/deletion, but this GET does not create rows.
    await membership_for(db, owner, generation=generation, write=True)
    await require_recipe_epoch_schema(db)
    return await recipe_grant_snapshot(db, owner, generation)


async def replace_recipe_grants(
    db, owner, generation, *, expected_revision, library_context, meal_plan_context
):
    await membership_for(db, owner, generation=generation, write=True)
    await require_recipe_epoch_schema(db)
    current = await recipe_grant_snapshot(db, owner, generation)
    if current["revision"] != expected_revision:
        # Check before no-op: a delayed equal-looking command after ABA is stale.
        raise HTTPException(
            409,
            "Recipe connection choices changed; refresh before saving",
            headers={"Cache-Control": "no-store"},
        )
    wanted = set()
    if library_context:
        wanted.add("recipes_library_context")
    if meal_plan_context:
        wanted.add("recipes_meal_plan_context")
    previous = {row["scope"] for row in current["scopes"]}
    if previous == wanted:
        return current
    await advance_recipe_grant_revision(db, owner, generation, previous, wanted)
    removed = previous - wanted
    if removed:
        await db.execute(
            delete(WorkoutsGrant).where(
                WorkoutsGrant.app_user_id == owner,
                WorkoutsGrant.generation == generation,
                WorkoutsGrant.scope.in_(removed),
            )
        )
    for scope in wanted - previous:
        db.add(WorkoutsGrant(app_user_id=owner, generation=generation, scope=scope))
    await db.flush()
    return await recipe_grant_snapshot(db, owner, generation)


async def erase_recipe_grant_epochs(db, owner):
    """Root calls inside the existing full product-erasure owner transaction."""
    await db.execute(
        delete(WorkoutsRecipeGrantEpoch).where(WorkoutsRecipeGrantEpoch.app_user_id == owner)
    )


async def export_recipe_grant_epoch(db, owner, generation):
    row = await db.get(WorkoutsRecipeGrantEpoch, (owner, generation))
    return (
        []
        if row is None
        else [
            {"generation": row.generation, "revision": row.revision, "updated_at": row.updated_at}
        ]
    )


async def verify_recipe_grant_schema(engine, settings):
    if not settings.workouts_api_enabled:
        return
    async with engine.connect() as connection:
        if not await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        ) or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=41)")
        ):
            raise RuntimeError("Recipes grant epoch migration041 is required")
        columns = set(
            (
                await connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='workouts_recipe_grant_epochs'"
                    )
                )
            ).scalars()
        )
        if columns != set(WorkoutsRecipeGrantEpoch.__table__.columns.keys()):
            raise RuntimeError("Recipes grant epoch schema is incomplete")
        if not await connection.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
            WHERE conrelid='public.workouts_recipe_grant_epochs'::regclass AND contype='f'
            AND confrelid='public.app_users'::regclass AND confdeltype='c' AND convalidated)""")
        ):
            raise RuntimeError("Recipes grant epoch owner cascade is missing")
        if not await connection.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_trigger
            WHERE tgrelid='public.workouts_recipe_grant_epochs'::regclass
            AND tgname='monotonic_workouts_recipe_epoch' AND tgenabled IN ('O','A')
            AND tgfoid='public.protect_workouts_recipe_epoch'::regproc AND NOT tgisinternal)""")
        ):
            raise RuntimeError("Recipes grant epoch monotonic trigger is missing")
