"""Dry-run-first tooling for the Clerk development-to-production transition."""

import argparse
import asyncio
import json
from dataclasses import asdict, dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ClerkEnvironment, get_settings
from app.db.database import AsyncSessionLocal
from app.models.identity import AppUser, ClerkIdentity
from app.services.clerk import ClerkBackendClient, ClerkProfile


@dataclass(frozen=True)
class TransitionResult:
    app_user_id: str
    status: str
    clerk_user_id: str | None = None
    detail: str | None = None


async def _app_users(db: AsyncSession) -> list[AppUser]:
    result = await db.execute(select(AppUser).order_by(AppUser.id))
    return list(result.scalars())


async def _identities_for_issuer(
    db: AsyncSession,
    issuer: str,
) -> dict[str, ClerkIdentity]:
    result = await db.execute(
        select(ClerkIdentity).where(ClerkIdentity.issuer == issuer)
    )
    return {identity.app_user_id: identity for identity in result.scalars()}


async def audit_development(
    db: AsyncSession,
    environment: ClerkEnvironment,
    *,
    apply: bool = False,
) -> list[TransitionResult]:
    """Validate stable users against Clerk development; repair missing aliases only."""
    if not environment.is_development or not environment.secret_key:
        raise ValueError("A configured development Clerk environment is required")

    remote = {profile.clerk_user_id: profile for profile in await ClerkBackendClient(environment).list_users()}
    identities = await _identities_for_issuer(db, environment.issuer)
    results: list[TransitionResult] = []
    for app_user in await _app_users(db):
        identity = identities.get(app_user.id)
        if identity and identity.clerk_user_id != app_user.id:
            results.append(TransitionResult(app_user.id, "conflict", detail="development subject differs from stable ID"))
            continue

        profile = remote.get(app_user.id)
        if profile is None:
            results.append(TransitionResult(app_user.id, "missing", detail="development Clerk user not found"))
            continue
        if not profile.email_verified:
            results.append(TransitionResult(app_user.id, "conflict", profile.clerk_user_id, "primary email is not verified"))
            continue
        if identity:
            results.append(TransitionResult(app_user.id, "unchanged", identity.clerk_user_id))
            continue
        if not apply:
            results.append(TransitionResult(app_user.id, "would_attach", profile.clerk_user_id))
            continue

        db.add(
            ClerkIdentity(
                app_user_id=app_user.id,
                issuer=environment.issuer,
                clerk_user_id=profile.clerk_user_id,
            )
        )
        try:
            await db.commit()
            results.append(TransitionResult(app_user.id, "attached", profile.clerk_user_id))
        except IntegrityError:
            await db.rollback()
            results.append(TransitionResult(app_user.id, "conflict", profile.clerk_user_id, "identity changed concurrently"))
    return results


def _production_candidate(
    app_user_id: str,
    development_profile: ClerkProfile,
    production_profiles: list[ClerkProfile],
) -> tuple[ClerkProfile | None, str | None]:
    candidates = {
        profile.clerk_user_id: profile
        for profile in production_profiles
        if profile.external_id == app_user_id or profile.email == development_profile.email
    }
    if len(candidates) > 1:
        return None, "multiple production users match stable ID or verified email"
    candidate = next(iter(candidates.values()), None)
    if candidate is None:
        return None, None
    if not candidate.email_verified:
        return None, "production primary email is not verified"
    if candidate.email != development_profile.email:
        return None, "production and development primary emails differ"
    if candidate.external_id and candidate.external_id != app_user_id:
        return None, "production external ID belongs to another stable user"
    return candidate, None


async def _attach_production_identity(
    db: AsyncSession,
    *,
    app_user_id: str,
    environment: ClerkEnvironment,
    clerk_user_id: str,
) -> bool:
    result = await db.execute(
        select(ClerkIdentity).where(
            ClerkIdentity.app_user_id == app_user_id,
            ClerkIdentity.issuer == environment.issuer,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing.clerk_user_id == clerk_user_id

    owner_result = await db.execute(
        select(ClerkIdentity).where(
            ClerkIdentity.issuer == environment.issuer,
            ClerkIdentity.clerk_user_id == clerk_user_id,
        )
    )
    if owner_result.scalar_one_or_none() is not None:
        return False

    db.add(
        ClerkIdentity(
            app_user_id=app_user_id,
            issuer=environment.issuer,
            clerk_user_id=clerk_user_id,
        )
    )
    try:
        await db.commit()
        return True
    except IntegrityError:
        await db.rollback()
        return False


async def provision_production(
    db: AsyncSession,
    development: ClerkEnvironment,
    production: ClerkEnvironment,
    *,
    apply: bool = False,
) -> list[TransitionResult]:
    """Create or attach production users; never delete or merge a user."""
    if not development.is_development or not development.secret_key:
        raise ValueError("A configured development Clerk environment is required")
    if not production.is_production or not production.secret_key:
        raise ValueError("A configured production Clerk environment is required")

    development_client = ClerkBackendClient(development)
    production_client = ClerkBackendClient(production)
    development_profiles = {
        profile.clerk_user_id: profile for profile in await development_client.list_users()
    }
    production_profiles = await production_client.list_users()
    development_identities = await _identities_for_issuer(db, development.issuer)
    production_identities = await _identities_for_issuer(db, production.issuer)
    results: list[TransitionResult] = []

    for app_user in await _app_users(db):
        development_identity = development_identities.get(app_user.id)
        if development_identity is None:
            results.append(
                TransitionResult(
                    app_user.id,
                    "missing",
                    detail="development identity alias is missing",
                )
            )
            continue
        if development_identity.clerk_user_id != app_user.id:
            results.append(
                TransitionResult(
                    app_user.id,
                    "conflict",
                    development_identity.clerk_user_id,
                    "development subject differs from stable ID",
                )
            )
            continue

        development_profile = development_profiles.get(app_user.id)
        if development_profile is None:
            results.append(TransitionResult(app_user.id, "missing", detail="development Clerk user not found"))
            continue
        if not development_profile.email_verified:
            results.append(TransitionResult(app_user.id, "conflict", detail="development primary email is not verified"))
            continue

        candidate, conflict = _production_candidate(
            app_user.id,
            development_profile,
            production_profiles,
        )
        if conflict:
            results.append(TransitionResult(app_user.id, "conflict", detail=conflict))
            continue

        existing_identity = production_identities.get(app_user.id)
        if existing_identity and (
            candidate is None
            or existing_identity.clerk_user_id != candidate.clerk_user_id
        ):
            results.append(
                TransitionResult(
                    app_user.id,
                    "conflict",
                    existing_identity.clerk_user_id,
                    "stored production identity does not match Clerk inventory",
                )
            )
            continue

        if candidate is None:
            if not apply:
                results.append(TransitionResult(app_user.id, "would_create"))
                continue
            candidate = await production_client.create_user(
                email=development_profile.email,
                external_id=app_user.id,
                first_name=development_profile.first_name,
                last_name=development_profile.last_name,
            )
            if (
                candidate is None
                or not candidate.email_verified
                or candidate.email != development_profile.email
                or candidate.external_id != app_user.id
            ):
                results.append(TransitionResult(app_user.id, "failed", detail="production user creation was not confirmed"))
                continue
            production_profiles.append(candidate)
            created = True
        else:
            created = False
            if candidate.external_id is None and apply:
                candidate = await production_client.set_external_id(
                    candidate.clerk_user_id,
                    app_user.id,
                )
                if candidate is None or candidate.external_id != app_user.id:
                    results.append(TransitionResult(app_user.id, "failed", detail="production external ID update was not confirmed"))
                    continue

        if existing_identity:
            results.append(
                TransitionResult(app_user.id, "unchanged", candidate.clerk_user_id)
            )
            continue

        if not apply:
            results.append(TransitionResult(app_user.id, "would_attach", candidate.clerk_user_id))
            continue

        attached = await _attach_production_identity(
            db,
            app_user_id=app_user.id,
            environment=production,
            clerk_user_id=candidate.clerk_user_id,
        )
        if not attached:
            results.append(TransitionResult(app_user.id, "conflict", candidate.clerk_user_id, "identity could not be attached"))
            continue
        results.append(
            TransitionResult(
                app_user.id,
                "created" if created else "attached",
                candidate.clerk_user_id,
            )
        )
    return results


def _environment(name: str) -> ClerkEnvironment:
    environment = next(
        (item for item in get_settings().clerk_environments if item.name == name),
        None,
    )
    if environment is None:
        raise ValueError(f"Clerk {name} environment is not configured")
    return environment


async def _run(command: str, apply: bool) -> int:
    async with AsyncSessionLocal() as db:
        if command == "audit-development":
            development = next(
                (item for item in get_settings().clerk_environments if item.is_development),
                None,
            )
            if development is None:
                raise ValueError("Clerk development environment is not configured")
            results = await audit_development(db, development, apply=apply)
        else:
            results = await provision_production(
                db,
                _environment("development"),
                _environment("production"),
                apply=apply,
            )

    for result in results:
        print(json.dumps(asdict(result), sort_keys=True))
    counts: dict[str, int] = {}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
    print(json.dumps({"mode": "apply" if apply else "dry-run", "counts": counts}, sort_keys=True))
    return 1 if any(result.status in {"conflict", "failed", "missing"} for result in results) else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("audit-development", "provision-production"))
    parser.add_argument("--apply", action="store_true", help="Apply the planned additive changes")
    args = parser.parse_args()
    try:
        exit_code = asyncio.run(_run(args.command, args.apply))
    except (ValueError, RuntimeError, httpx.HTTPError) as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__}))
        raise SystemExit(1) from error
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
