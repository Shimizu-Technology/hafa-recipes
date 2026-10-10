"""Own empty synthetic database only; actual core and optional migration runners."""

import asyncio
import json
from uuid import uuid4

from capacity.fixtures import padding
from capacity.safety import OWNERS, ensure
from capacity.transport import recipe, workout

ensure()

from app.db.database import AsyncSessionLocal, Base, engine
from app.domains.workouts.models import WorkoutRecord, WorkoutVersion
from app.main import (
    app,  # noqa: F401 -- registers actual core model metadata; no startup called
)
from app.models import (  # noqa: F401
    ai,
    deletion,
    grocery,
    identity,
    meal_plan,
    moderation,
)
from app.models.identity import AppUser, ClerkIdentity
from app.models.recipe import Recipe
from app.models.schemas import RecipeExtracted
from app.publishing import PUBLISHING_DISCLOSURE_VERSION
from migrations.run import run_migrations
from sqlalchemy import text


async def seed():
    async with engine.begin() as db:
        if await db.scalar(text("SELECT to_regclass('public.recipes') IS NOT NULL")):
            raise RuntimeError(
                "Seed requires an empty owned database; it never resets an existing schema"
            )
        await db.run_sync(Base.metadata.create_all)
    await run_migrations()
    async with AsyncSessionLocal.begin() as db:
        for owner in OWNERS:
            db.add(
                AppUser(
                    id=owner,
                    publishing_disclosure_version=PUBLISHING_DISCLOSURE_VERSION,
                )
            )
        await db.flush()
        for owner in OWNERS:
            db.add(
                ClerkIdentity(
                    app_user_id=owner,
                    issuer="https://capacity.invalid",
                    clerk_user_id=owner,
                )
            )
        for index in range(1000):
            content = recipe()
            # Match the real manual-save schema; guessed JSON silently passed
            # list shaping but would fail an authenticated private detail read.
            content["sourceUrl"] = ""
            content["notes"] = padding(12000, index)
            RecipeExtracted.model_validate(content)
            db.add(
                Recipe(
                    user_id=OWNERS[index % 22],
                    source_url=f"manual://capacity-{index}",
                    source_type="manual",
                    is_public=False,
                    extracted=content,
                )
            )
        # Large export owners are separate from normal coach/context users.
        for owner, count, note_count in [(OWNERS[22], 190, 40), (OWNERS[23], 12, 56)]:
            for index in range(count):
                identifier = uuid4()
                content = workout()
                content.update(
                    id=str(identifier),
                    version=1,
                    provenance="user",
                    notes=[padding(4000, index * 60 + n) for n in range(note_count)],
                )
                if len(json.dumps(content).encode()) > 240 * 1024:
                    raise RuntimeError("Fixture exceeds normal saved-content bounds")
                db.add(
                    WorkoutRecord(
                        id=identifier,
                        app_user_id=owner,
                        generation=1,
                        revision=1,
                        content=content,
                    )
                )
                db.add(
                    WorkoutVersion(
                        workout_id=identifier,
                        app_user_id=owner,
                        generation=1,
                        revision=1,
                        content=content,
                    )
                )
        # Membership/profile/consent must be initialized before seeded owned rows.
        # The prepare HTTP phase does that before large exports are requested;
        # insert memberships here for FK/generation coherence, never production.
        from app.domains.workouts.lifecycle import now
        from app.domains.workouts.models import WorkoutsMembership

        for owner in OWNERS:
            db.add(
                WorkoutsMembership(
                    app_user_id=owner,
                    generation=1,
                    status="active",
                    adult_confirmed_at=now(),
                    deletion_acknowledged_at=now(),
                    disclosure_version=1,
                    enrolled_at=now(),
                )
            )
        await db.commit()
    async with engine.connect() as db:
        sizes = (
            await db.execute(
                text(
                    "SELECT relname,pg_total_relation_size(oid) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname"
                )
            )
        ).all()
    print(
        json.dumps(
            {"synthetic": True, "table_bytes": dict(sizes), "owners": len(OWNERS)}
        )
    )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
