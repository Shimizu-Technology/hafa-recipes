"""Raw additive space DDL; old code continues using owner columns."""
import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from migrations._baby_expand import finish, prepare, verify

SPACE_TABLES = (
    "baby_children", "baby_records", "baby_attachments", "baby_imports",
    "baby_conversations", "baby_messages", "baby_share_credentials", "baby_share_captures",
)
SYNC_TABLES = ("baby_children", "baby_records", "baby_attachments")
DDL = (
    """CREATE TABLE IF NOT EXISTS baby_spaces (
        id UUID PRIMARY KEY, kind VARCHAR(16) NOT NULL,
        created_by VARCHAR(64) REFERENCES app_users(id) ON DELETE SET NULL,
        generation INTEGER NOT NULL CHECK (generation > 0),
        change_seq BIGINT NOT NULL DEFAULT 0 CHECK (change_seq >= 0),
        timezone VARCHAR(80) NOT NULL DEFAULT 'Pacific/Guam',
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        CONSTRAINT ck_baby_space_kind CHECK (kind IN ('personal','family')),
        CONSTRAINT ck_baby_space_status CHECK (status IN ('active','deleted')))""",
    """CREATE UNIQUE INDEX IF NOT EXISTS uq_baby_personal_space
        ON baby_spaces(created_by) WHERE kind='personal'""",
    """CREATE TABLE IF NOT EXISTS baby_space_members (
        space_id UUID NOT NULL REFERENCES baby_spaces(id) ON DELETE CASCADE,
        app_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        role VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'active',
        access_version INTEGER NOT NULL DEFAULT 1 CHECK (access_version > 0),
        PRIMARY KEY(space_id,app_user_id),
        CONSTRAINT ck_baby_member_role CHECK (role IN ('parent','caregiver')),
        CONSTRAINT ck_baby_member_status CHECK (status IN ('active','left','removed')))""",
    """CREATE INDEX IF NOT EXISTS ix_baby_space_members_actor
        ON baby_space_members(app_user_id,status)""",
    """CREATE TABLE IF NOT EXISTS baby_space_invites (
        id UUID PRIMARY KEY, space_id UUID NOT NULL REFERENCES baby_spaces(id) ON DELETE CASCADE,
        created_by VARCHAR(64) REFERENCES app_users(id) ON DELETE SET NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE, role VARCHAR(16) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
        CONSTRAINT ck_baby_invite_role CHECK (role IN ('parent','caregiver')))""",
    """CREATE INDEX IF NOT EXISTS ix_baby_space_invites_space ON baby_space_invites(space_id)""",
    """CREATE TABLE IF NOT EXISTS baby_moved_out (
        space_id UUID NOT NULL REFERENCES baby_spaces(id) ON DELETE CASCADE,
        seq BIGINT NOT NULL CHECK (seq > 0), record_id UUID NOT NULL,
        PRIMARY KEY(space_id,seq,record_id))""",
    """ALTER TABLE baby_memberships ADD COLUMN IF NOT EXISTS personal_space_id UUID
        REFERENCES baby_spaces(id) ON DELETE SET NULL""",
    *(f"""ALTER TABLE {table} ADD COLUMN IF NOT EXISTS space_id UUID
        REFERENCES baby_spaces(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS change_seq BIGINT""" for table in SPACE_TABLES),
    *(f"""CREATE INDEX IF NOT EXISTS ix_{table}_space_seq
        ON {table}(space_id,change_seq)""" for table in SPACE_TABLES),
    *(f"""ALTER TABLE {table} ADD COLUMN IF NOT EXISTS context_space_ids JSONB
        NOT NULL DEFAULT '[]'::jsonb""" for table in ("baby_conversations", "baby_messages")),
)
COLUMNS = {
    "baby_spaces": {"id": "uuid", "kind": "varchar", "created_by": "varchar",
        "generation": "int4", "change_seq": "int8", "timezone": "varchar", "status": "varchar"},
    "baby_space_members": {"space_id": "uuid", "app_user_id": "varchar", "role": "varchar",
        "status": "varchar", "access_version": "int4"},
    "baby_space_invites": {"id": "uuid", "space_id": "uuid", "created_by": "varchar",
        "token_hash": "varchar", "role": "varchar", "expires_at": "timestamptz",
        "used_at": "timestamptz", "revoked_at": "timestamptz"},
    "baby_moved_out": {"space_id": "uuid", "seq": "int8", "record_id": "uuid"},
    "baby_memberships": {"personal_space_id": "uuid"},
    **{table: {"space_id": "uuid", "change_seq": "int8"} for table in SPACE_TABLES},
}
for table in ("baby_conversations", "baby_messages"):
    COLUMNS[table]["context_space_ids"] = "jsonb"
CONSTRAINTS = {
    "baby_spaces": ("baby_spaces_pkey", "ck_baby_space_kind", "ck_baby_space_status"),
    "baby_space_members": ("baby_space_members_pkey", "ck_baby_member_role", "ck_baby_member_status"),
    "baby_space_invites": ("baby_space_invites_pkey", "ck_baby_invite_role"),
    "baby_moved_out": ("baby_moved_out_pkey",),
}
INDEXES = ("uq_baby_personal_space", "ix_baby_space_members_actor", "ix_baby_space_invites_space",
    *(f"ix_{table}_space_seq" for table in SPACE_TABLES))


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    async with (migration_engine or engine).begin() as db:
        recorded = await prepare(db, configured, 56, 55)
        if not recorded:
            for ddl in DDL:
                await db.execute(text(ddl))
        await verify(db, COLUMNS, CONSTRAINTS, INDEXES)
        # Frozen v1 checks enforce validated CASCADE space FKs, even before F2.
        from app.domains.baby.schema import schema_complete
        from migrations._baby_v1_schema import (
            BABY_SHARE_V1_TABLES,
            BABY_V1_ALLOWED_FORMS,
            BABY_V1_TABLES,
        )
        if not await schema_complete(db, tables=(*BABY_V1_TABLES, *BABY_SHARE_V1_TABLES),
                                     allowed_forms=BABY_V1_ALLOWED_FORMS):
            raise RuntimeError("Baby056 schema drift: v1 compatibility")
        await finish(db, 56, "Baby spaces expansion")


if __name__ == "__main__":
    asyncio.run(run_migration())
