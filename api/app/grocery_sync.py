"""Durable grocery synchronization primitives and startup verification."""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

from sqlalchemy import text

from app.db.database import AsyncSessionLocal

GROCERY_SYNC_OPERATIONS = frozenset({"add", "update", "set_checked", "delete"})
GROCERY_ACCOUNT_NAMESPACE = b"hafa-recipes:grocery-account-scope:v1\0"


def grocery_account_scope_id(user_id: str) -> str:
    """Return a stable opaque local-cache namespace without exposing owner IDs."""

    digest = hashlib.sha256(GROCERY_ACCOUNT_NAMESPACE + user_id.encode("utf-8")).digest()
    encoded = base64.urlsafe_b64encode(digest[:18]).decode("ascii").rstrip("=")
    return f"gacct_{encoded}"


def grocery_mutation_hash(payload: dict[str, Any]) -> str:
    """Return a stable digest so one mutation ID cannot be reused with new input."""

    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


async def verify_grocery_sync_schema(session_factory=AsyncSessionLocal) -> None:
    """Fail startup before serving when migration 023 is incomplete."""

    async with session_factory() as db:
        migration_applied = await db.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM schema_migrations WHERE version = 23
            )
        """))
        revision_ready = await db.scalar(text("""
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'grocery_lists'
                  AND column_name = 'revision'
                  AND is_nullable = 'NO'
            )
        """))
        receipt_table_ready = await db.scalar(text("""
            SELECT to_regclass('public.grocery_mutation_receipts') IS NOT NULL
        """))
        membership_unique = await db.scalar(text("""
            SELECT EXISTS (
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = 'uq_grocery_list_members_user_id'
                  AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
            )
        """))
        receipt_constraints = set(
            (
                await db.execute(text("""
                    SELECT conname
                    FROM pg_constraint
                    WHERE conrelid = 'grocery_mutation_receipts'::regclass
                      AND convalidated
                """))
            ).scalars().all()
        ) if receipt_table_ready else set()

        required_constraints = {
            "pk_grocery_mutation_receipts",
            "fk_grocery_mutation_receipts_list",
            "fk_grocery_mutation_receipts_actor",
            "ck_grocery_mutation_receipts_operation",
        }
        if not (
            migration_applied
            and revision_ready
            and receipt_table_ready
            and membership_unique
            and required_constraints.issubset(receipt_constraints)
        ):
            raise RuntimeError("Database migration 023 is missing or incomplete")
