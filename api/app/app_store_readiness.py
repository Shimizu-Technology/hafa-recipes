"""Privacy-bounded release audits and explicit App Review account provisioning."""

import argparse
import asyncio
import json
import os
import re
from dataclasses import asdict, dataclass
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.clerk_transition import PRODUCTION_APP_USER_PATTERN, TransitionResult
from app.config import ClerkEnvironment, get_settings
from app.db.database import AsyncSessionLocal
from app.identity_lock import lock_clerk_subject
from app.models.identity import AppUser, ClerkIdentity
from app.services.clerk import ClerkBackendClient

ENVIRONMENT_NAME_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,80}$")
PRIVATE_RELAY_DOMAIN = "@privaterelay.appleid.com"


@dataclass(frozen=True)
class AppStoreReadinessSummary:
    mapped_users: int
    durable_sign_in_users: int
    email_recoverable_users: int
    private_relay_recovery_users: int
    invalid_identity_users: int
    reviewer_status: str


def _production_environment() -> ClerkEnvironment:
    environment = next(
        (item for item in get_settings().clerk_environments if item.is_production),
        None,
    )
    if environment is None or not environment.secret_key:
        raise ValueError("A configured production Clerk environment is required")
    return environment


def _environment_value(name: str, *, required: bool) -> str | None:
    if ENVIRONMENT_NAME_PATTERN.fullmatch(name) is None:
        raise ValueError("Credential environment-variable names must be uppercase identifiers")
    value = (os.environ.get(name) or "").strip()
    if required and not value:
        raise ValueError(f"Required environment variable {name} is not configured")
    return value or None


def _normalized_email(email: str) -> str:
    normalized = email.strip().lower()
    local, separator, domain = normalized.rpartition("@")
    if not separator or not local or "." not in domain or any(char.isspace() for char in normalized):
        raise ValueError("The App Review account must use a valid dedicated email address")
    return normalized


async def app_store_readiness_summary(
    db: AsyncSession,
    production: ClerkEnvironment,
    *,
    reviewer_email: str | None = None,
) -> AppStoreReadinessSummary:
    """Report only counts and reviewer readiness; never expose customer identifiers."""
    profiles = await ClerkBackendClient(production).list_users()
    profiles_by_subject = {profile.clerk_user_id: profile for profile in profiles}
    identities = (
        await db.execute(select(ClerkIdentity).where(ClerkIdentity.issuer == production.issuer))
    ).scalars().all()

    durable = 0
    recoverable = 0
    private_relay = 0
    invalid = 0
    for identity in identities:
        profile = profiles_by_subject.get(identity.clerk_user_id)
        if (
            profile is None
            or not profile.email_verified
            or profile.external_id != identity.app_user_id
        ):
            invalid += 1
            continue
        if profile.password_enabled or profile.verified_providers:
            durable += 1
        else:
            recoverable += 1
            if profile.email.endswith(PRIVATE_RELAY_DOMAIN):
                private_relay += 1

    reviewer_status = "not_configured"
    if reviewer_email is not None:
        normalized_email = _normalized_email(reviewer_email)
        candidates = [profile for profile in profiles if profile.email == normalized_email]
        if len(candidates) != 1:
            reviewer_status = "missing" if not candidates else "conflict"
        else:
            reviewer = candidates[0]
            identity = next(
                (item for item in identities if item.clerk_user_id == reviewer.clerk_user_id),
                None,
            )
            if (
                identity is None
                or not reviewer.email_verified
                or reviewer.external_id != identity.app_user_id
                or PRODUCTION_APP_USER_PATTERN.fullmatch(identity.app_user_id) is None
            ):
                reviewer_status = "invalid_identity"
            elif not reviewer.password_enabled:
                reviewer_status = "password_missing"
            else:
                legacy_identity = await db.scalar(
                    select(ClerkIdentity.id).where(
                        ClerkIdentity.app_user_id == identity.app_user_id,
                        ClerkIdentity.issuer != production.issuer,
                    )
                )
                reviewer_status = "invalid_identity" if legacy_identity else "ready"

    return AppStoreReadinessSummary(
        mapped_users=len(identities),
        durable_sign_in_users=durable,
        email_recoverable_users=recoverable,
        private_relay_recovery_users=private_relay,
        invalid_identity_users=invalid,
        reviewer_status=reviewer_status,
    )


async def provision_app_review_account(
    db: AsyncSession,
    production: ClerkEnvironment,
    *,
    email: str,
    password: str | None,
    apply: bool = False,
) -> TransitionResult:
    """Provision one isolated production-only reviewer; never change an existing customer."""
    normalized_email = _normalized_email(email)
    client = ClerkBackendClient(production)
    candidates = [
        profile for profile in await client.list_users() if profile.email == normalized_email
    ]
    if len(candidates) > 1:
        return TransitionResult("reviewer", "conflict", detail="reviewer email is not unique")

    profile = candidates[0] if candidates else None
    if profile is not None:
        if (
            not profile.email_verified
            or not profile.password_enabled
            or PRODUCTION_APP_USER_PATTERN.fullmatch(profile.external_id or "") is None
        ):
            return TransitionResult(
                "reviewer",
                "conflict",
                detail="existing account is not an isolated password-enabled reviewer",
            )
    elif not apply:
        return TransitionResult("reviewer", "would_create")
    elif not password or len(password) < 12:
        return TransitionResult(
            "reviewer",
            "failed",
            detail="reviewer password must be at least 12 characters",
        )
    else:
        app_user_id = f"app_{uuid4().hex}"
        profile = await client.create_user(
            email=normalized_email,
            external_id=app_user_id,
            first_name="App",
            last_name="Reviewer",
            password=password,
        )
        if (
            profile is None
            or not profile.email_verified
            or profile.email != normalized_email
            or profile.external_id != app_user_id
            or not profile.password_enabled
        ):
            return TransitionResult(
                "reviewer", "failed", detail="password-enabled reviewer creation was not confirmed"
            )

    assert profile.external_id is not None
    await lock_clerk_subject(db, issuer=production.issuer, subject=profile.clerk_user_id)
    subject_identity = await db.scalar(
        select(ClerkIdentity).where(
            ClerkIdentity.issuer == production.issuer,
            ClerkIdentity.clerk_user_id == profile.clerk_user_id,
        )
    )
    if subject_identity is not None:
        if subject_identity.app_user_id != profile.external_id:
            await db.rollback()
            return TransitionResult("reviewer", "conflict", detail="reviewer identity changed")
        legacy_identity = await db.scalar(
            select(ClerkIdentity.id).where(
                ClerkIdentity.app_user_id == subject_identity.app_user_id,
                ClerkIdentity.issuer != production.issuer,
            )
        )
        if legacy_identity is not None:
            await db.rollback()
            return TransitionResult(
                "reviewer", "conflict", detail="reviewer account is not production-only"
            )
        await db.rollback()
        return TransitionResult("reviewer", "unchanged")

    owner = await db.get(AppUser, profile.external_id)
    if owner is not None:
        await db.rollback()
        return TransitionResult(
            "reviewer", "conflict", detail="reviewer stable owner already belongs to another user"
        )
    if not apply:
        await db.rollback()
        return TransitionResult("reviewer", "would_attach")

    db.add(AppUser(id=profile.external_id))
    db.add(
        ClerkIdentity(
            app_user_id=profile.external_id,
            issuer=production.issuer,
            clerk_user_id=profile.clerk_user_id,
        )
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return TransitionResult("reviewer", "conflict", detail="reviewer identity changed concurrently")
    return TransitionResult("reviewer", "created")


async def _run(args: argparse.Namespace) -> int:
    production = _production_environment()
    reviewer_email = _environment_value(
        args.reviewer_email_env,
        required=args.command == "provision-reviewer" or args.require_reviewer,
    )

    async with AsyncSessionLocal() as db:
        if args.command == "audit":
            if args.apply:
                raise ValueError("The release readiness audit is read-only")
            summary = await app_store_readiness_summary(
                db,
                production,
                reviewer_email=reviewer_email,
            )
            print(json.dumps(asdict(summary), sort_keys=True))
            return int(
                summary.invalid_identity_users > 0
                or (args.require_reviewer and summary.reviewer_status != "ready")
            )

        password = _environment_value(args.reviewer_password_env, required=args.apply)
        result = await provision_app_review_account(
            db,
            production,
            email=reviewer_email or "",
            password=password,
            apply=args.apply,
        )
        print(json.dumps({
            "mode": "apply" if args.apply else "dry-run",
            "status": result.status,
            **({"detail": result.detail} if result.detail else {}),
        }, sort_keys=True))
        return int(result.status in {"conflict", "failed", "missing"})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("audit", "provision-reviewer"))
    parser.add_argument("--apply", action="store_true", help="Apply an explicitly planned change")
    parser.add_argument("--require-reviewer", action="store_true")
    parser.add_argument("--reviewer-email-env", default="APP_REVIEW_EMAIL")
    parser.add_argument("--reviewer-password-env", default="APP_REVIEW_PASSWORD")
    args = parser.parse_args()
    try:
        raise SystemExit(asyncio.run(_run(args)))
    except (ValueError, RuntimeError, httpx.HTTPError) as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__}))
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
