"""Dry-run-first tooling for the Clerk development-to-production transition."""

import argparse
import asyncio
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ClerkEnvironment, get_settings
from app.db.database import AsyncSessionLocal
from app.models.identity import AppUser, ClerkIdentity, ClerkMigrationGrant
from app.services.clerk import ClerkBackendClient, ClerkProfile


@dataclass(frozen=True)
class TransitionResult:
    app_user_id: str
    status: str
    clerk_user_id: str | None = None
    detail: str | None = None


@dataclass(frozen=True)
class BridgeAdoptionSummary:
    since: str
    active_users: int
    covered_users: int
    coverage_percent: float | None


async def bridge_adoption_summary(
    db: AsyncSession,
    *,
    development_issuer: str,
    since: datetime,
) -> BridgeAdoptionSummary:
    """Return aggregate bridge coverage without exposing user or grant identifiers."""
    if since.tzinfo is None:
        raise ValueError("bridge adoption timestamp must include a timezone")
    active = (
        select(ClerkIdentity.app_user_id.label("app_user_id"))
        .where(
            ClerkIdentity.issuer == development_issuer,
            ClerkIdentity.last_authenticated_at >= since,
        )
        .distinct()
        .subquery()
    )
    covered = (
        select(ClerkMigrationGrant.app_user_id.label("app_user_id"))
        .where(
            ClerkMigrationGrant.created_at >= since,
            ClerkMigrationGrant.redeemed_at.is_(None),
            ClerkMigrationGrant.expires_at > func.now(),
        )
        .distinct()
        .subquery()
    )
    row = (
        await db.execute(
            select(
                func.count(active.c.app_user_id),
                func.count(covered.c.app_user_id),
            ).select_from(
                active.outerjoin(
                    covered,
                    active.c.app_user_id == covered.c.app_user_id,
                )
            )
        )
    ).one()
    active_users = int(row[0])
    covered_users = int(row[1])
    coverage_percent = round(100.0 * covered_users / active_users, 1) if active_users else None
    return BridgeAdoptionSummary(
        since=since.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        active_users=active_users,
        covered_users=covered_users,
        coverage_percent=coverage_percent,
    )


async def _app_users(db: AsyncSession) -> list[AppUser]:
    result = await db.execute(select(AppUser).order_by(AppUser.id))
    return list(result.scalars())


async def _identities_for_issuer(
    db: AsyncSession,
    issuer: str,
) -> dict[str, ClerkIdentity]:
    result = await db.execute(select(ClerkIdentity).where(ClerkIdentity.issuer == issuer))
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

    remote = {
        profile.clerk_user_id: profile
        for profile in await ClerkBackendClient(environment).list_users()
    }
    identities = await _identities_for_issuer(db, environment.issuer)
    results: list[TransitionResult] = []
    for app_user in await _app_users(db):
        identity = identities.get(app_user.id)
        if identity and identity.clerk_user_id != app_user.id:
            results.append(
                TransitionResult(
                    app_user.id, "conflict", detail="development subject differs from stable ID"
                )
            )
            continue

        profile = remote.get(app_user.id)
        if profile is None:
            results.append(
                TransitionResult(app_user.id, "missing", detail="development Clerk user not found")
            )
            continue
        if not profile.email_verified:
            results.append(
                TransitionResult(
                    app_user.id, "conflict", profile.clerk_user_id, "primary email is not verified"
                )
            )
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
            results.append(
                TransitionResult(
                    app_user.id, "conflict", profile.clerk_user_id, "identity changed concurrently"
                )
            )
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
            results.append(
                TransitionResult(app_user.id, "missing", detail="development Clerk user not found")
            )
            continue
        if not development_profile.email_verified:
            results.append(
                TransitionResult(
                    app_user.id, "conflict", detail="development primary email is not verified"
                )
            )
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
            candidate is None or existing_identity.clerk_user_id != candidate.clerk_user_id
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
                results.append(
                    TransitionResult(
                        app_user.id, "failed", detail="production user creation was not confirmed"
                    )
                )
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
                    results.append(
                        TransitionResult(
                            app_user.id,
                            "failed",
                            detail="production external ID update was not confirmed",
                        )
                    )
                    continue

        if existing_identity:
            results.append(TransitionResult(app_user.id, "unchanged", candidate.clerk_user_id))
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
            results.append(
                TransitionResult(
                    app_user.id,
                    "conflict",
                    candidate.clerk_user_id,
                    "identity could not be attached",
                )
            )
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


async def _run(
    command: str,
    apply: bool,
    *,
    summary_only: bool,
    since: datetime | None,
) -> int:
    async with AsyncSessionLocal() as db:
        if command == "bridge-adoption":
            if since is None:
                raise ValueError("bridge-adoption requires --since")
            if apply:
                raise ValueError("bridge-adoption is read-only and does not accept --apply")
            summary = await bridge_adoption_summary(
                db,
                development_issuer=_environment("development").issuer,
                since=since,
            )
            print(json.dumps(asdict(summary), sort_keys=True))
            return 0
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

    if not summary_only:
        for result in results:
            print(json.dumps(asdict(result), sort_keys=True))
    counts: dict[str, int] = {}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
    print(json.dumps({"mode": "apply" if apply else "dry-run", "counts": counts}, sort_keys=True))
    return 1 if any(result.status in {"conflict", "failed", "missing"} for result in results) else 0


def _parse_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be an ISO 8601 timestamp") from error
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("must include a timezone")
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("audit-development", "provision-production", "bridge-adoption"),
    )
    parser.add_argument("--apply", action="store_true", help="Apply the planned additive changes")
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print only aggregate result counts for identity inventory commands",
    )
    parser.add_argument(
        "--since",
        type=_parse_timestamp,
        help="Bridge-release timestamp for the aggregate adoption report",
    )
    args = parser.parse_args()
    try:
        exit_code = asyncio.run(
            _run(
                args.command,
                args.apply,
                summary_only=args.summary_only,
                since=args.since,
            )
        )
    except (ValueError, RuntimeError, httpx.HTTPError) as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__}))
        raise SystemExit(1) from error
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
