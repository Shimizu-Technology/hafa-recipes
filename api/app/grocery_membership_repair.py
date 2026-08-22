"""Repair provably empty duplicate grocery-list memberships.

This is a narrowly scoped operational repair for empty default lists created by
legacy migration concurrency. It is dry-run by default, expectation-locked in
apply mode, transactional, idempotent, and records an append-only audit row for
every removed empty list.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.db.database import engine

DEFAULT_LIST_NAME = "Grocery List"
REPAIR_REASON = "remove provably empty duplicate lists created by legacy migration concurrency"
LOCK_NAME = "hafa:grocery-membership-repair:v1"


class GroceryMembershipRepairBlocked(RuntimeError):
    """Raised when a repair cannot prove that every duplicate list is empty."""


@dataclass(frozen=True)
class MembershipFact:
    user_id: str
    list_id: UUID
    joined_at: datetime | None
    member_count: int
    total_items: int
    invite_count: int
    default_name: bool

    @property
    def safe_to_remove(self) -> bool:
        return (
            self.member_count == 1
            and self.total_items == 0
            and self.invite_count == 0
            and self.default_name
        )


def _actor_hash(user_id: str) -> str:
    return hashlib.sha256(
        f"hafa:grocery-membership-repair:v1:{user_id}".encode("utf-8")
    ).hexdigest()[:16]


async def _tables_exist(connection: AsyncConnection) -> bool:
    required = (
        "grocery_lists",
        "grocery_list_members",
        "grocery_items",
        "grocery_list_invites",
    )
    existing = set(
        (
            await connection.execute(
                text("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name IN (
                          'grocery_lists',
                          'grocery_list_members',
                          'grocery_items',
                          'grocery_list_invites'
                      )
                """),
            )
        )
        .scalars()
        .all()
    )
    return existing == set(required)


async def _load_duplicate_facts(connection: AsyncConnection) -> list[MembershipFact]:
    rows = (
        (
            await connection.execute(
                text("""
                SELECT
                    m.user_id,
                    m.list_id,
                    m.joined_at,
                    (SELECT COUNT(*)
                     FROM grocery_list_members lm
                     WHERE lm.list_id = m.list_id) AS member_count,
                    (SELECT COUNT(*)
                     FROM grocery_items gi
                     WHERE gi.list_id = m.list_id) AS total_items,
                    (SELECT COUNT(*)
                     FROM grocery_list_invites inv
                     WHERE inv.list_id = m.list_id) AS invite_count,
                    gl.name = :default_name AS default_name
                FROM grocery_list_members m
                JOIN grocery_lists gl ON gl.id = m.list_id
                WHERE m.user_id IN (
                    SELECT user_id
                    FROM grocery_list_members
                    GROUP BY user_id
                    HAVING COUNT(*) > 1
                )
                ORDER BY m.user_id, m.joined_at NULLS LAST, m.list_id
            """),
                {"default_name": DEFAULT_LIST_NAME},
            )
        )
        .mappings()
        .all()
    )
    return [
        MembershipFact(
            user_id=row["user_id"],
            list_id=row["list_id"],
            joined_at=row["joined_at"],
            member_count=row["member_count"],
            total_items=row["total_items"],
            invite_count=row["invite_count"],
            default_name=row["default_name"],
        )
        for row in rows
    ]


def _build_plan(facts: list[MembershipFact]) -> dict[str, Any]:
    by_user: dict[str, list[MembershipFact]] = {}
    for fact in facts:
        by_user.setdefault(fact.user_id, []).append(fact)

    unsafe = [fact for fact in facts if not fact.safe_to_remove]
    users = []
    for user_id, memberships in by_user.items():
        keep = memberships[0]
        users.append(
            {
                "actor_hash": _actor_hash(user_id),
                "keep_list_id": str(keep.list_id),
                "remove_list_ids": [str(fact.list_id) for fact in memberships[1:]],
            }
        )

    return {
        "duplicate_users": len(by_user),
        "duplicate_memberships": len(facts),
        "remove_lists": sum(len(user["remove_list_ids"]) for user in users),
        "unsafe_lists": len(unsafe),
        "users": users,
    }


def _validate_plan(
    plan: dict[str, Any],
    *,
    expected_users: int | None,
    expected_memberships: int | None,
) -> None:
    if plan["unsafe_lists"]:
        raise GroceryMembershipRepairBlocked(
            "Repair stopped: at least one duplicate list contains user data, "
            "invite history, another member, or a custom name"
        )
    if expected_users is None or expected_memberships is None:
        raise GroceryMembershipRepairBlocked(
            "Apply mode requires --expected-users and --expected-memberships"
        )
    if plan["duplicate_users"] != expected_users:
        raise GroceryMembershipRepairBlocked(
            "Repair stopped: duplicate user count changed "
            f"(expected {expected_users}, found {plan['duplicate_users']})"
        )
    if plan["duplicate_memberships"] != expected_memberships:
        raise GroceryMembershipRepairBlocked(
            "Repair stopped: duplicate membership count changed "
            f"(expected {expected_memberships}, found {plan['duplicate_memberships']})"
        )


async def _ensure_audit_schema(connection: AsyncConnection) -> None:
    await connection.execute(
        text("""
        CREATE TABLE IF NOT EXISTS grocery_membership_repair_audit (
            repair_id VARCHAR(96) NOT NULL,
            actor_hash VARCHAR(16) NOT NULL,
            kept_list_id UUID NOT NULL,
            removed_list_id UUID NOT NULL,
            reason VARCHAR(255) NOT NULL,
            before_facts JSONB NOT NULL,
            repaired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (repair_id, removed_list_id)
        )
    """)
    )
    await connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION prevent_grocery_membership_repair_audit_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'grocery_membership_repair_audit is append-only';
        END;
        $$ LANGUAGE plpgsql
    """)
    )
    await connection.execute(
        text("""
        DROP TRIGGER IF EXISTS grocery_membership_repair_audit_append_only
        ON grocery_membership_repair_audit
    """)
    )
    await connection.execute(
        text("""
        CREATE TRIGGER grocery_membership_repair_audit_append_only
        BEFORE UPDATE OR DELETE ON grocery_membership_repair_audit
        FOR EACH ROW
        EXECUTE FUNCTION prevent_grocery_membership_repair_audit_mutation()
    """)
    )


async def run_repair(
    *,
    apply: bool = False,
    repair_id: str | None = None,
    expected_users: int | None = None,
    expected_memberships: int | None = None,
    database_engine: AsyncEngine = engine,
) -> dict[str, Any]:
    """Inspect or repair only duplicate memberships backed by empty lists."""

    if apply and not repair_id:
        raise GroceryMembershipRepairBlocked("Apply mode requires --repair-id")
    if repair_id and len(repair_id) > 96:
        raise GroceryMembershipRepairBlocked("repair_id must be 96 characters or fewer")

    if not apply:
        async with database_engine.connect() as connection:
            if not await _tables_exist(connection):
                return {"status": "not_applicable", "apply": False}
            plan = _build_plan(await _load_duplicate_facts(connection))
        return {
            "status": (
                "unchanged"
                if plan["duplicate_users"] == 0
                else "blocked"
                if plan["unsafe_lists"]
                else "would_apply"
            ),
            "apply": False,
            **plan,
        }

    async with database_engine.begin() as connection:
        if not await _tables_exist(connection):
            return {"status": "not_applicable", "apply": True, "repair_id": repair_id}

        # A pre-deploy repair must fail safely instead of holding up the live API
        # indefinitely if an existing write transaction cannot drain promptly.
        await connection.execute(text("SET LOCAL lock_timeout = '15s'"))
        await connection.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_name))"),
            {"lock_name": LOCK_NAME},
        )
        await connection.execute(
            text("""
            LOCK TABLE
                grocery_list_members,
                grocery_lists,
                grocery_items,
                grocery_list_invites
            IN SHARE ROW EXCLUSIVE MODE
        """)
        )

        facts = await _load_duplicate_facts(connection)
        plan = _build_plan(facts)
        if not facts:
            return {
                "status": "unchanged",
                "apply": True,
                "repair_id": repair_id,
                **plan,
            }

        _validate_plan(
            plan,
            expected_users=expected_users,
            expected_memberships=expected_memberships,
        )
        await _ensure_audit_schema(connection)

        facts_by_list = {str(fact.list_id): fact for fact in facts}
        removed_list_ids: list[UUID] = []
        for user in plan["users"]:
            for removed_list_id_text in user["remove_list_ids"]:
                fact = facts_by_list[removed_list_id_text]
                removed_list_id = UUID(removed_list_id_text)
                removed_list_ids.append(removed_list_id)
                await connection.execute(
                    text("""
                        INSERT INTO grocery_membership_repair_audit (
                            repair_id,
                            actor_hash,
                            kept_list_id,
                            removed_list_id,
                            reason,
                            before_facts
                        ) VALUES (
                            :repair_id,
                            :actor_hash,
                            :kept_list_id,
                            :removed_list_id,
                            :reason,
                            CAST(:before_facts AS JSONB)
                        )
                    """),
                    {
                        "repair_id": repair_id,
                        "actor_hash": user["actor_hash"],
                        "kept_list_id": UUID(user["keep_list_id"]),
                        "removed_list_id": removed_list_id,
                        "reason": REPAIR_REASON,
                        "before_facts": json.dumps(
                            {
                                "member_count": fact.member_count,
                                "total_items": fact.total_items,
                                "invite_count": fact.invite_count,
                                "default_name": fact.default_name,
                                "joined_at": (
                                    fact.joined_at.isoformat() if fact.joined_at else None
                                ),
                            },
                            sort_keys=True,
                        ),
                    },
                )

        deleted = await connection.execute(
            text("DELETE FROM grocery_lists WHERE id = ANY(:list_ids)"),
            {"list_ids": removed_list_ids},
        )
        if deleted.rowcount != len(removed_list_ids):
            raise GroceryMembershipRepairBlocked(
                "Repair stopped: deleted list count did not match the locked plan"
            )

        remaining = await _load_duplicate_facts(connection)
        if remaining:
            raise GroceryMembershipRepairBlocked(
                "Repair stopped: duplicate memberships remain after the planned repair"
            )

        return {
            "status": "applied",
            "apply": True,
            "repair_id": repair_id,
            **plan,
        }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect or repair provably empty duplicate grocery lists"
    )
    parser.add_argument("--apply", action="store_true", help="Apply the locked plan")
    parser.add_argument("--repair-id", help="Stable audit batch identifier")
    parser.add_argument("--expected-users", type=int)
    parser.add_argument("--expected-memberships", type=int)
    return parser


async def _main() -> None:
    args = _build_parser().parse_args()
    result = await run_repair(
        apply=args.apply,
        repair_id=args.repair_id,
        expected_users=args.expected_users,
        expected_memberships=args.expected_memberships,
    )
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(_main())
