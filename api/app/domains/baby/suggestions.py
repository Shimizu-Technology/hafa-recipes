"""Explicit user decisions on suggested categories. Processing never files a source."""

from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.domains.baby.access import access_for, touch
from app.domains.baby.dependencies import Access, Database, Generation, User
from app.domains.baby.lifecycle import digest, now
from app.domains.baby.models import BabyRecord
from app.domains.baby.processing import comparable
from app.domains.baby.schemas import (
    CollectionData,
    RecordCreate,
    SuggestionBatch,
    SuggestionDecision,
)
from app.domains.baby.security import BabyRoute

router = APIRouter(route_class=BabyRoute)
DECIDED = {"accept": "accepted", "dismiss": "dismissed"}


@router.post("/records/{identifier}/suggested-category")
async def decide_one(
    identifier: UUID, body: SuggestionDecision, user: User, db: Database, generation: Generation,
    access: Access = None,
):
    batch = SuggestionBatch(
        action=body.action, items=[{"record_id": identifier, "revision": body.revision}]
    )
    return await decide(batch, user, db, generation, access=access)


@router.post("/suggested-categories")
async def decide_many(body: SuggestionBatch, user: User, db: Database, generation: Generation,
                      access: Access = None):
    return await decide(body, user, db, generation, access=access)


async def decide(body, user, db, generation, *, access=None):
    from app.domains.baby.router import record_response

    if access is None:
        access = await access_for(db, user.id, generation=generation, write=True)
    access.check_generation(generation)
    member = access.member
    owner_rows = select(BabyRecord).where(
        access.condition(BabyRecord),
        BabyRecord.deleted_at.is_(None),
    )
    sources = {
        row.id: row
        for row in await db.scalars(
            owner_rows.where(
                BabyRecord.kind == "source",
                BabyRecord.id.in_([item.record_id for item in body.items]),
            )
        )
    }
    if access.enabled:
        for source in sorted(sources.values(), key=lambda row: row.id):
            if source.space_id != access.target.id:
                await access.row(db, BabyRecord, source.id, write=True)
    collections, created = None, set()
    results, changed_sources, changed_collections = [], {}, {}
    for item in body.items:
        source = sources.get(item.record_id)
        suggestion = (source.data.get("suggested_category") if source else None) or {}
        outcome = {"record_id": str(item.record_id), "status": "unavailable"}
        results.append(outcome)
        if source is None:
            continue
        if suggestion.get("status") == DECIDED[body.action]:
            # A replay after a lost response is already done, at any revision.
            outcome.update(status=DECIDED[body.action], collection_id=suggestion.get("collection_id"))
            continue
        if source.revision != item.revision:
            outcome["status"] = "conflict"
            continue
        if suggestion.get("status") != "pending":
            outcome["status"] = "no_suggestion"
            continue
        decision = {**suggestion, "status": DECIDED[body.action]}
        if body.action == "accept":
            if collections is None:
                collections = list(
                    await db.scalars(
                        owner_rows.where(BabyRecord.kind == "collection",
                                         (BabyRecord.space_id == access.target.id) if access.enabled else True).order_by(
                            BabyRecord.created_at, BabyRecord.id
                        )
                    )
                )
            target = category_for(collections, suggestion)
            if target is None:
                target = new_category(user.id, generation, suggestion["name"],
                                      access.target.id if access.enabled else member.personal_space_id)
                db.add(target)
                await touch(target, access.target)
                collections.append(target)
                created.add(target.id)
            try:
                members = CollectionData.model_validate(target.data).record_ids
            except ValidationError:
                # Nothing is saved: the whole request rolls back.
                raise HTTPException(
                    422, "This category could not be updated; choose another category"
                ) from None
            if source.id not in members:
                if len(members) >= 500:
                    outcome["status"] = "category_full"
                    continue
                target.data = {
                    **target.data,
                    "record_ids": [*target.data.get("record_ids", []), str(source.id)],
                }
                if target.id not in changed_collections and target.id not in created:
                    target.revision += 1
                target.updated_at = now()
                changed_collections[target.id] = target
                await touch(target, access.target)
            decision.update(collection_id=str(target.id), name=target.title[:80])
            outcome["collection_id"] = str(target.id)
        source.data = {**source.data, "suggested_category": decision}
        source.revision, source.updated_at = source.revision + 1, now()
        changed_sources[source.id] = source
        await touch(source, access.target)
        outcome["status"] = DECIDED[body.action]
    await db.flush()
    await db.commit()
    return {
        "results": results,
        "records": [record_response(row, access) for row in changed_sources.values()],
        "collections": [record_response(row, access) for row in changed_collections.values()],
    }


def category_for(collections, suggestion):
    """The suggested category if it still exists, else the same name, else none."""
    by_id = {str(row.id): row for row in collections}
    if suggestion.get("collection_id") in by_id:
        return by_id[suggestion["collection_id"]]
    name = comparable(suggestion["name"])
    return next((row for row in collections if name and comparable(row.title) == name), None)


def new_category(owner, generation, name, space_id):
    created = RecordCreate(
        id=uuid4(), kind="collection", title=name, occurred_at=now(), data={"record_ids": []}
    )
    return BabyRecord(
        **created.model_dump(),
        app_user_id=owner,
        space_id=space_id,
        generation=generation,
        revision=1,
        creation_hash=digest(created.model_dump(mode="json")),
        created_at=now(),
        updated_at=now(),
    )
