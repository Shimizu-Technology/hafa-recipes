"""Dry-run-first tooling for the Clerk development-to-production transition."""

import argparse
import asyncio
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ClerkEnvironment, get_settings
from app.db.database import AsyncSessionLocal
from app.identity_lock import lock_clerk_subject
from app.models.identity import AppUser, ClerkIdentity, ClerkMigrationGrant
from app.models.moderation import AdminAuditEvent
from app.services.clerk import ClerkBackendClient, ClerkProfile

PRODUCTION_APP_USER_PATTERN = re.compile(r"^app_[a-f0-9]{32}$")
CLERK_USER_PATTERN = re.compile(r"^user_[A-Za-z0-9_-]{1,59}$")
RECOVERY_AUDIT_ACTION = "identity.rebound"


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
            or_(
                ClerkMigrationGrant.redeemed_at.is_not(None),
                ClerkMigrationGrant.expires_at > func.now(),
            ),
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
    production = next(
        (item for item in get_settings().clerk_environments if item.is_production),
        None,
    )
    production_identities = (
        await _identities_for_issuer(db, production.issuer) if production is not None else {}
    )
    production_profiles = (
        {
            profile.clerk_user_id: profile
            for profile in await ClerkBackendClient(production).list_users()
        }
        if production is not None and production.secret_key
        else {}
    )
    results: list[TransitionResult] = []
    for app_user in await _app_users(db):
        identity = identities.get(app_user.id)
        production_identity = production_identities.get(app_user.id)
        if identity is None and PRODUCTION_APP_USER_PATTERN.fullmatch(app_user.id):
            production_profile = (
                production_profiles.get(production_identity.clerk_user_id)
                if production_identity is not None
                else None
            )
            if (
                production_identity is not None
                and production_profile is not None
                and production_profile.email_verified
                and production_profile.external_id == app_user.id
            ):
                results.append(
                    TransitionResult(app_user.id, "production_only", production_identity.clerk_user_id)
                )
            else:
                results.append(
                    TransitionResult(
                        app_user.id,
                        "conflict" if production_identity else "missing",
                        production_identity.clerk_user_id if production_identity else None,
                        "production-only identity does not match Clerk inventory"
                        if production_identity
                        else "production identity alias is missing",
                    )
                )
            continue
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
    production_profiles_by_subject = {
        profile.clerk_user_id: profile for profile in production_profiles
    }
    development_identities = await _identities_for_issuer(db, development.issuer)
    production_identities = await _identities_for_issuer(db, production.issuer)
    results: list[TransitionResult] = []

    for app_user in await _app_users(db):
        development_identity = development_identities.get(app_user.id)
        existing_identity = production_identities.get(app_user.id)
        if development_identity is None:
            if PRODUCTION_APP_USER_PATTERN.fullmatch(app_user.id) and existing_identity:
                production_profile = production_profiles_by_subject.get(
                    existing_identity.clerk_user_id
                )
                if (
                    production_profile
                    and production_profile.email_verified
                    and production_profile.external_id == app_user.id
                ):
                    results.append(
                        TransitionResult(
                            app_user.id, "production_only", existing_identity.clerk_user_id
                        )
                    )
                    continue
            results.append(
                TransitionResult(
                    app_user.id,
                    "conflict" if existing_identity else "missing",
                    existing_identity.clerk_user_id if existing_identity else None,
                    "production-only identity does not match Clerk inventory"
                    if existing_identity
                    else "development identity alias is missing",
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

        if existing_identity:
            candidate = production_profiles_by_subject.get(existing_identity.clerk_user_id)
            if (
                candidate is None
                or not candidate.email_verified
                or candidate.external_id != app_user.id
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
        else:
            candidate, conflict = _production_candidate(
                app_user.id,
                development_profile,
                production_profiles,
            )
            if conflict:
                results.append(TransitionResult(app_user.id, "conflict", detail=conflict))
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


async def rebind_production_identity(
    db: AsyncSession,
    production: ClerkEnvironment,
    *,
    app_user_id: str,
    from_clerk_user_id: str,
    to_clerk_user_id: str,
    actor_user_id: str,
    reason: str,
    apply: bool = False,
) -> TransitionResult:
    """Move one verified Apple login to an explicitly confirmed stable owner."""
    if not production.is_production or not production.secret_key:
        raise ValueError("A configured production Clerk environment is required")
    if not app_user_id or len(app_user_id) > 64 or not actor_user_id or len(actor_user_id) > 64:
        raise ValueError("Recovery requires exact application owner and operator IDs")
    if (
        CLERK_USER_PATTERN.fullmatch(from_clerk_user_id) is None
        or CLERK_USER_PATTERN.fullmatch(to_clerk_user_id) is None
        or from_clerk_user_id == to_clerk_user_id
    ):
        raise ValueError("Recovery requires distinct, exact production Clerk user IDs")
    reason = reason.strip()
    if not 3 <= len(reason) <= 500:
        raise ValueError("Recovery requires an audit reason between 3 and 500 characters")

    # Match onboarding's lock order before taking owner/alias row locks so an
    # explicit registration cannot claim the replacement account mid-recovery.
    await lock_clerk_subject(db, issuer=production.issuer, subject=to_clerk_user_id)

    owner = await db.scalar(
        select(AppUser).where(AppUser.id == app_user_id).with_for_update()
    )
    actor = await db.get(AppUser, actor_user_id)
    if owner is None or actor is None:
        await db.rollback()
        return TransitionResult(app_user_id, "conflict", detail="owner or operator does not exist")

    identity = await db.scalar(
        select(ClerkIdentity)
        .where(
            ClerkIdentity.app_user_id == app_user_id,
            ClerkIdentity.issuer == production.issuer,
        )
        .with_for_update()
    )
    if identity is None:
        await db.rollback()
        return TransitionResult(app_user_id, "conflict", detail="production identity is missing")
    legacy_identity = await db.scalar(
        select(ClerkIdentity.id).where(
            ClerkIdentity.app_user_id == app_user_id,
            ClerkIdentity.issuer != production.issuer,
            ClerkIdentity.clerk_user_id == app_user_id,
        )
    )
    if legacy_identity is None:
        await db.rollback()
        return TransitionResult(app_user_id, "conflict", detail="legacy owner identity is missing")

    client = ClerkBackendClient(production)
    old_profile = await client.get_user(from_clerk_user_id)
    new_profile = await client.get_user(to_clerk_user_id)
    if (
        old_profile is None
        or old_profile.clerk_user_id != from_clerk_user_id
        or new_profile is None
        or new_profile.clerk_user_id != to_clerk_user_id
    ):
        await db.rollback()
        return TransitionResult(app_user_id, "failed", detail="production users could not be verified")
    if not new_profile.email_verified or "apple" not in new_profile.verified_providers:
        await db.rollback()
        return TransitionResult(
            app_user_id,
            "conflict",
            to_clerk_user_id,
            "replacement account has no verified Apple connection",
        )

    if identity.clerk_user_id == to_clerk_user_id:
        await db.rollback()
        if new_profile.external_id == app_user_id:
            return TransitionResult(app_user_id, "unchanged", to_clerk_user_id)
        return TransitionResult(
            app_user_id, "conflict", to_clerk_user_id, "replacement external ID is inconsistent"
        )
    if identity.clerk_user_id != from_clerk_user_id:
        await db.rollback()
        return TransitionResult(app_user_id, "conflict", detail="production identity changed")
    if (
        not old_profile.email_verified
        or old_profile.external_id != app_user_id
        or old_profile.verified_providers
        or old_profile.password_enabled
    ):
        await db.rollback()
        return TransitionResult(
            app_user_id,
            "conflict",
            from_clerk_user_id,
            "original account is not an empty, trusted migration shell",
        )
    if new_profile.external_id is not None:
        await db.rollback()
        return TransitionResult(
            app_user_id,
            "conflict",
            to_clerk_user_id,
            "replacement account already has an external identity",
        )
    target_identity = await db.scalar(
        select(ClerkIdentity).where(
            ClerkIdentity.issuer == production.issuer,
            ClerkIdentity.clerk_user_id == to_clerk_user_id,
        )
    )
    if target_identity is not None:
        await db.rollback()
        return TransitionResult(
            app_user_id,
            "conflict",
            to_clerk_user_id,
            "replacement account belongs to another application user",
        )
    if not apply:
        await db.rollback()
        return TransitionResult(app_user_id, "would_rebind", to_clerk_user_id)

    retired_external_id = f"retired_{uuid4().hex}"
    try:
        await _set_verified_recovery_external_id(
            client,
            from_clerk_user_id,
            retired_external_id,
        )
        replacement_profile = await _set_verified_recovery_external_id(
            client,
            to_clerk_user_id,
            app_user_id,
        )
        if (
            not replacement_profile.email_verified
            or "apple" not in replacement_profile.verified_providers
        ):
            raise RuntimeError("replacement external ID could not be verified")

        identity.clerk_user_id = to_clerk_user_id
        db.add(
            AdminAuditEvent(
                actor_user_id=actor_user_id,
                action=RECOVERY_AUDIT_ACTION,
                target_type="user",
                target_id=app_user_id,
                reason=reason,
                before_summary={
                    "issuer": production.issuer,
                    "clerk_user_id": from_clerk_user_id,
                },
                after_summary={
                    "issuer": production.issuer,
                    "clerk_user_id": to_clerk_user_id,
                    "retired_external_id": retired_external_id,
                },
            )
        )
        await db.commit()
    except Exception as error:
        await db.rollback()
        try:
            observed_old = await client.get_user(from_clerk_user_id)
            observed_new = await client.get_user(to_clerk_user_id)
            if (
                observed_old is None
                or observed_old.clerk_user_id != from_clerk_user_id
                or observed_new is None
                or observed_new.clerk_user_id != to_clerk_user_id
            ):
                raise RuntimeError("production account state could not be confirmed")
            if observed_new.external_id == app_user_id:
                await _set_verified_recovery_external_id(
                    client,
                    to_clerk_user_id,
                    f"orphan_{uuid4().hex}",
                )
            elif observed_new.external_id != new_profile.external_id:
                raise RuntimeError("replacement external ID changed unexpectedly")

            observed_old = await client.get_user(from_clerk_user_id)
            if observed_old is None or observed_old.clerk_user_id != from_clerk_user_id:
                raise RuntimeError("original account state could not be confirmed")
            if observed_old.external_id != app_user_id:
                if observed_old.external_id != retired_external_id:
                    raise RuntimeError("original external ID changed unexpectedly")
                await _set_verified_recovery_external_id(
                    client,
                    from_clerk_user_id,
                    app_user_id,
                )

            restored_old = await client.get_user(from_clerk_user_id)
            restored_new = await client.get_user(to_clerk_user_id)
            if (
                restored_old is None
                or restored_old.external_id != app_user_id
                or restored_new is None
                or restored_new.external_id == app_user_id
            ):
                raise RuntimeError("stable owner restoration could not be confirmed")
        except Exception as compensation_error:
            raise RuntimeError(
                "Recovery compensation failed; stop and inspect production"
            ) from compensation_error
        return TransitionResult(
            app_user_id,
            "failed",
            to_clerk_user_id,
            f"recovery was rolled back after {type(error).__name__}",
        )

    return TransitionResult(app_user_id, "rebound", to_clerk_user_id)


async def _set_verified_recovery_external_id(
    client: ClerkBackendClient,
    clerk_user_id: str,
    external_id: str,
) -> ClerkProfile:
    """Resolve lost PATCH responses by checking the authoritative provider state."""
    mutation_error: Exception | None = None
    try:
        await client.set_external_id(clerk_user_id, external_id)
    except Exception as error:
        mutation_error = error

    try:
        confirmed = await client.get_user(clerk_user_id)
    except Exception as error:
        raise RuntimeError("Clerk external ID update outcome is unknown") from (
            mutation_error or error
        )
    if (
        confirmed is None
        or confirmed.clerk_user_id != clerk_user_id
        or confirmed.external_id != external_id
    ):
        raise RuntimeError("Clerk external ID update could not be confirmed") from mutation_error
    return confirmed


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
    app_user_id: str | None = None,
    from_clerk_user_id: str | None = None,
    to_clerk_user_id: str | None = None,
    actor_user_id: str | None = None,
    reason: str | None = None,
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
        if command == "rebind-production":
            if not all((app_user_id, from_clerk_user_id, to_clerk_user_id, actor_user_id, reason)):
                raise ValueError(
                    "rebind-production requires --app-user-id, --from-clerk-user-id, "
                    "--to-clerk-user-id, --actor-user-id, and --reason"
                )
            results = [
                await rebind_production_identity(
                    db,
                    _environment("production"),
                    app_user_id=app_user_id or "",
                    from_clerk_user_id=from_clerk_user_id or "",
                    to_clerk_user_id=to_clerk_user_id or "",
                    actor_user_id=actor_user_id or "",
                    reason=reason or "",
                    apply=apply,
                )
            ]
        elif command == "audit-development":
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
        choices=(
            "audit-development",
            "provision-production",
            "bridge-adoption",
            "rebind-production",
        ),
    )
    parser.add_argument("--apply", action="store_true", help="Apply the explicitly planned changes")
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
    parser.add_argument("--app-user-id", help="Exact existing stable application owner")
    parser.add_argument("--from-clerk-user-id", help="Exact currently attached production subject")
    parser.add_argument("--to-clerk-user-id", help="Exact verified Apple production subject")
    parser.add_argument("--actor-user-id", help="Stable application owner of the recovery operator")
    parser.add_argument("--reason", help="Required privacy-bounded operator audit reason")
    args = parser.parse_args()
    try:
        exit_code = asyncio.run(
            _run(
                args.command,
                args.apply,
                summary_only=args.summary_only,
                since=args.since,
                app_user_id=args.app_user_id,
                from_clerk_user_id=args.from_clerk_user_id,
                to_clerk_user_id=args.to_clerk_user_id,
                actor_user_id=args.actor_user_id,
                reason=args.reason,
            )
        )
    except (ValueError, RuntimeError, httpx.HTTPError) as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__}))
        raise SystemExit(1) from error
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
