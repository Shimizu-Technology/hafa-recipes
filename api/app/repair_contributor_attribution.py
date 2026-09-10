"""Repair explicitly selected placeholder names, never recipe ownership.

Dry-run example (run from api/ with the intended database environment):
    python -m app.repair_contributor_attribution --reference-recipe UUID \
        --expected-name 'Contributor Name' --recipe UUID --recipe UUID

Adding --apply locks and updates only those exact recipe display snapshots.
Establish the production restore point before applying a production repair.
"""

import argparse
import asyncio
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.contributor_attribution import PLACEHOLDER_NAMES
from app.models.recipe import Recipe


async def repair_attribution(
    db: AsyncSession,
    *,
    reference_id: UUID,
    recipe_ids: list[UUID],
    expected_name: str,
    apply: bool = False,
) -> list[dict[str, str]]:
    """Verify every requested row before changing any snapshot; stop on conflict."""
    expected_name = expected_name.strip()
    targets = set(recipe_ids)
    if not targets or len(targets) > 100 or not expected_name or len(expected_name) > 100:
        raise ValueError("Provide 1–100 exact recipes and a valid expected name")
    if expected_name.lower() in PLACEHOLDER_NAMES:
        raise ValueError("The expected name must identify a contributor")
    query = select(Recipe).where(Recipe.id.in_(targets | {reference_id}))
    if apply:
        query = query.with_for_update()
    result = await db.execute(query)
    rows = {recipe.id: recipe for recipe in result.scalars().all()}
    if set(rows) != targets | {reference_id}:
        raise ValueError("A requested recipe was not found; no changes made")
    reference = rows[reference_id]
    if not reference.user_id or reference.extractor_display_name != expected_name:
        raise ValueError("Reference attribution does not match; no changes made")
    for recipe_id in targets:
        recipe = rows[recipe_id]
        if recipe.user_id != reference.user_id:
            raise ValueError("Recipe owners differ; no changes made")
        old_name = (recipe.extractor_display_name or "").strip()
        if old_name and old_name.lower() not in PLACEHOLDER_NAMES and old_name != expected_name:
            raise ValueError("A target already has another name; no changes made")
    report = []
    for recipe_id in sorted(targets, key=str):
        recipe = rows[recipe_id]
        changed = recipe.extractor_display_name != expected_name
        report.append(
            {
                "recipe_id": str(recipe_id),
                "action": ("updated" if apply else "would_update")
                if changed
                else "already_correct",
            }
        )
        if apply and changed:
            recipe.extractor_display_name = expected_name
    if apply:
        await db.commit()
    return report


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-recipe", type=UUID, required=True)
    parser.add_argument("--recipe", type=UUID, action="append", required=True)
    parser.add_argument("--expected-name", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    from app.db.database import AsyncSessionLocal, engine

    try:
        async with AsyncSessionLocal() as db:
            report = await repair_attribution(
                db,
                reference_id=args.reference_recipe,
                recipe_ids=args.recipe,
                expected_name=args.expected_name,
                apply=args.apply,
            )
            print(json.dumps({"mode": "apply" if args.apply else "dry_run", "recipes": report}))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
