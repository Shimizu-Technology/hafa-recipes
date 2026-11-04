"""F3 uses synthetic unequal generations and includes erased/tombstoned rows."""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, func, select, text
from sqlalchemy.exc import DBAPIError

from app.baby_space_backfill import MODELS, BackfillConflict, backfill
from app.domains.baby import models as m
from app.domains.baby.lifecycle import now
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


async def legacy_fixture(api):
    async with api.sessions() as db:
        await db.execute(delete(m.BabySpace))
        for owner, generation in (("owner", 2), ("other", 7)):
            member = await db.get(m.BabyMembership, owner)
            member.generation = generation
            # Include historical generations as well as deleted/retired rows.
            common = dict(app_user_id=owner, generation=generation - 1)
            conversation = m.BabyConversation(id=uuid4(), title="Synthetic", **common)
            db.add(conversation)
            await db.flush()
            db.add_all([
                m.BabyChild(name="Synthetic", creation_hash="x", deleted_at=now(), **common),
                m.BabyRecord(kind="journal", title="Synthetic", body="", data={},
                             occurred_at=now(), creation_hash="x", deleted_at=now(), **common),
                m.BabyAttachment(name="Synthetic", mime_type="image/png", size=1,
                                 object_key="synthetic", byte_hash="x", state="deleted", **common),
                m.BabyImport(consent_epoch=0, creation_hash="x", request={}, status="cancelled",
                             record_id=uuid4(), **common),
                m.BabyMessage(conversation_id=conversation.id, role="user", content={}, **common),
                BabyShareCredential(installation_hash=owner, token_hash=owner, expires_at=now(),
                                    revoked_at=now(), **common),
                BabyShareCapture(creation_hash="x", request={}, record_id=uuid4(),
                                 status="saved", created_at=now(), **common),
            ])
        await db.commit()


async def snapshot(api):
    async with api.sessions() as db:
        return {model.__tablename__: [(r.id, r.app_user_id, r.generation, r.space_id, r.change_seq)
                for r in await db.scalars(select(model).order_by(model.id))] for model in MODELS}


async def test_dry_run_apply_rerun_and_append_only_audit(baby_api):
    await legacy_fixture(baby_api)
    before = await snapshot(baby_api)
    options = dict(migration_engine=baby_api.engine, configured=baby_api.settings)
    dry = await backfill(**options)
    assert dry["mode"] == "dry-run" and dry["spaces_created"] == 2
    assert dry["rows_assigned"] == dry["rows_sequenced"] == 16
    assert await snapshot(baby_api) == before
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(m.BabySpace)) == 0
        assert await db.scalar(text("SELECT to_regclass('baby_space_backfill_audit')")) is None
    applied = await backfill(apply=True, **options)
    assert applied["spaces_created"] == 2 and applied["null_space_ids"] == 0
    after = await snapshot(baby_api)
    for table, rows in after.items():
        assert [(r[0], r[1], r[2]) for r in rows] == [(r[0], r[1], r[2]) for r in before[table]]
        assert all(r[3] is not None and r[4] > 0 for r in rows)
    async with baby_api.sessions() as db:
        for owner, generation in (("owner", 2), ("other", 7)):
            member = await db.get(m.BabyMembership, owner)
            space = await db.get(m.BabySpace, member.personal_space_id)
            seqs = [r[4] for rows in after.values() for r in rows if r[1] == owner]
            assert space.generation == generation
            assert len(set(seqs)) == 8 and max(seqs) == space.change_seq
    assert (await backfill(**options))["changes"] == 0
    assert (await backfill(apply=True, **options))["changes"] == 0
    assert await snapshot(baby_api) == after
    async with baby_api.sessions() as db:
        assert await db.scalar(text("SELECT count(*) FROM baby_space_backfill_audit")) == 2
    for sql in ("DELETE FROM baby_space_backfill_audit", "UPDATE baby_space_backfill_audit SET restore_point='x'",
                "TRUNCATE baby_space_backfill_audit"):
        with pytest.raises(DBAPIError, match="append-only"):
            async with baby_api.engine.begin() as db:
                await db.execute(text(sql))
    # A pre-F2 instance can still add an unstamped row; the required final rerun catches it.
    async with baby_api.sessions() as db:
        db.add(m.BabyRecord(app_user_id="owner", generation=2, kind="journal", title="Late",
                            data={}, occurred_at=now(), creation_hash="late"))
        await db.commit()
    late = await backfill(apply=True, **options)
    assert late["rows_assigned"] == late["rows_sequenced"] == 1
    assert (await backfill(apply=True, **options))["changes"] == 0


@pytest.mark.parametrize("conflict", ["foreign_space", "generation", "pointer", "sequence", "member", "extra_member"])
async def test_conflicts_stop_atomically_without_audit_or_owner_rewrite(baby_api, conflict):
    await legacy_fixture(baby_api)
    options = dict(migration_engine=baby_api.engine, configured=baby_api.settings)
    await backfill(apply=True, **options)
    async with baby_api.sessions() as db:
        owner, other = [await db.get(m.BabyMembership, actor) for actor in ("owner", "other")]
        row = await db.scalar(select(BabyShareCapture).where(BabyShareCapture.app_user_id == "owner"))
        if conflict == "foreign_space":
            row.space_id = other.personal_space_id
        elif conflict == "generation":
            (await db.get(m.BabySpace, owner.personal_space_id)).generation = 99
        elif conflict == "pointer":
            owner.personal_space_id = other.personal_space_id
        elif conflict == "sequence":
            row.change_seq = await db.scalar(select(m.BabyRecord.change_seq).where(m.BabyRecord.app_user_id == "owner"))
        elif conflict == "extra_member":
            db.add(m.BabySpaceMember(space_id=owner.personal_space_id, app_user_id="other", role="parent"))
        else:
            (await db.get(m.BabySpaceMember, (owner.personal_space_id, "owner"))).role = "caregiver"
        await db.commit()
    before = await snapshot(baby_api)
    for apply in (False, True):
        with pytest.raises(BackfillConflict):
            await backfill(apply=apply, **options)
        assert await snapshot(baby_api) == before
    async with baby_api.sessions() as db:
        assert await db.scalar(text("SELECT count(*) FROM baby_space_backfill_audit")) == 1


async def test_production_apply_requires_restore_point(monkeypatch):
    monkeypatch.delenv("BABY_SPACE_BACKFILL_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="RESTORE_POINT"):
        await backfill(apply=True, configured=SimpleNamespace(environment="production"))


async def test_audit_failure_rolls_back_all_assignments(baby_api):
    await legacy_fixture(baby_api)
    before = await snapshot(baby_api)

    def fail_audit(conn, cursor, statement, parameters, context, executemany):
        if "INSERT INTO baby_space_backfill_audit" in statement:
            raise RuntimeError("injected audit failure")

    event.listen(baby_api.engine.sync_engine, "before_cursor_execute", fail_audit)
    try:
        with pytest.raises(RuntimeError, match="injected audit"):
            await backfill(apply=True, migration_engine=baby_api.engine, configured=baby_api.settings)
    finally:
        event.remove(baby_api.engine.sync_engine, "before_cursor_execute", fail_audit)
    assert await snapshot(baby_api) == before
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(m.BabySpace)) == 0
        assert await db.scalar(text("SELECT to_regclass('baby_space_backfill_audit')")) is None
