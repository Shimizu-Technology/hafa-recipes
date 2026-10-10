"""Private library organization and intentional independent workout copies."""

import base64
import copy
import hashlib
import json
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import Field, StrictBool, field_validator, model_validator
from sqlalchemy import String, cast, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import JSONPATH

from app.domains.workouts.library_organization_models import (
    WorkoutLibraryCollection,
    WorkoutLibraryCollectionMember,
    WorkoutLibraryDuplicateReceipt,
    WorkoutLibraryOrganization,
)
from app.domains.workouts.library_organization_service import (
    active_library_condition,
    organization_for,
    overlay_organizations,
    owned_workout,
    refresh_source_metadata,
    source_key,
)
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import WorkoutRecord, WorkoutVersion
from app.domains.workouts.router import Database, Generation, User, bounded_content
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.security import WorkoutsRoute

router = APIRouter(prefix="/api/v1/workouts", tags=["workouts-library"], route_class=WorkoutsRoute)


def label(value, maximum):
    if not isinstance(value, str):
        raise ValueError("A text label is required")
    value = value.strip()
    if (
        not value
        or len(value) > maximum
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise ValueError(f"Use a nonblank label of at most {maximum} characters")
    return value


class OrganizationUpdate(DomainModel):
    expected_revision: int = Field(strict=True, ge=0, le=2_147_483_647)
    favorite: StrictBool | None = None
    archived: StrictBool | None = None
    tags: list[str] | None = Field(default=None, max_length=20)
    collection_ids: list[UUID] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def require_changes(self):
        changes = self.model_fields_set - {"expected_revision"}
        if not changes or any(getattr(self, name) is None for name in changes):
            raise ValueError("Provide at least one organization change; null is not a change")
        if self.tags is not None:
            self.tags = [label(item, 40) for item in self.tags]
            if len({item.casefold() for item in self.tags}) != len(self.tags):
                raise ValueError("Tags must be unique ignoring letter case")
        if self.collection_ids is not None and len(set(self.collection_ids)) != len(
            self.collection_ids
        ):
            raise ValueError("Collection IDs must be unique")
        return self


class CollectionCreate(DomainModel):
    title: str

    @field_validator("title")
    @classmethod
    def valid_title(cls, value):
        return label(value, 100)


class CollectionUpdate(CollectionCreate):
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_647)


class DuplicateRequest(DomainModel):
    request_id: UUID
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    title: str | None = None
    copy_organization: StrictBool = True

    @model_validator(mode="after")
    def valid_title(self):
        if "title" in self.model_fields_set:
            self.title = label(self.title, 200)
        return self


async def collection(db, owner, generation, identifier):
    row = await db.scalar(
        select(WorkoutLibraryCollection).where(
            WorkoutLibraryCollection.id == identifier,
            WorkoutLibraryCollection.app_user_id == owner,
            WorkoutLibraryCollection.generation == generation,
        )
    )
    if row is None:
        raise HTTPException(404, "Collection not found")
    return row


async def collection_response(db, row):
    count = await db.scalar(
        select(func.count())
        .select_from(WorkoutLibraryCollectionMember)
        .where(
            WorkoutLibraryCollectionMember.collection_id == row.id,
            WorkoutLibraryCollectionMember.app_user_id == row.app_user_id,
            WorkoutLibraryCollectionMember.generation == row.generation,
        )
    )
    return collection_payload(row, count)


def collection_payload(row, count):
    return {
        "id": row.id,
        "generation": row.generation,
        "revision": row.revision,
        "title": row.title,
        "workout_count": count,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def unique_title(db, owner, generation, title, exclude=None):
    query = select(WorkoutLibraryCollection.id).where(
        WorkoutLibraryCollection.app_user_id == owner,
        WorkoutLibraryCollection.generation == generation,
        WorkoutLibraryCollection.title_key == title.casefold(),
    )
    if exclude:
        query = query.where(WorkoutLibraryCollection.id != exclude)
    if await db.scalar(query):
        raise HTTPException(409, "A collection with this name already exists")


@router.get("/collections")
async def list_collections(user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation)
    rows = (
        await db.execute(
            select(WorkoutLibraryCollection, func.count(WorkoutLibraryCollectionMember.workout_id))
            .outerjoin(
                WorkoutLibraryCollectionMember,
                (WorkoutLibraryCollectionMember.collection_id == WorkoutLibraryCollection.id)
                & (WorkoutLibraryCollectionMember.app_user_id == user.id)
                & (WorkoutLibraryCollectionMember.generation == generation),
            )
            .where(
                WorkoutLibraryCollection.app_user_id == user.id,
                WorkoutLibraryCollection.generation == generation,
            )
            .group_by(WorkoutLibraryCollection.id)
            .order_by(WorkoutLibraryCollection.title_key, WorkoutLibraryCollection.id)
        )
    ).all()
    # One grouped query; the write cap keeps this intentional list bounded.
    return [collection_payload(row, count) for row, count in rows]


@router.post("/collections", status_code=201)
async def create_collection(
    payload: CollectionCreate, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    count = await db.scalar(
        select(func.count())
        .select_from(WorkoutLibraryCollection)
        .where(
            WorkoutLibraryCollection.app_user_id == user.id,
            WorkoutLibraryCollection.generation == generation,
        )
    )
    if count >= 100:
        raise HTTPException(422, "The library supports up to 100 collections")
    await unique_title(db, user.id, generation, payload.title)
    row = WorkoutLibraryCollection(
        app_user_id=user.id,
        generation=generation,
        revision=1,
        title=payload.title,
        title_key=payload.title.casefold(),
    )
    db.add(row)
    await db.flush()
    result = await collection_response(db, row)
    await db.commit()
    return result


@router.put("/collections/{collection_id}")
async def update_collection(
    collection_id: UUID, payload: CollectionUpdate, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await collection(db, user.id, generation, collection_id)
    if row.revision != payload.expected_revision:
        raise HTTPException(409, "Collection changed; refresh before saving")
    await unique_title(db, user.id, generation, payload.title, row.id)
    row.title, row.title_key = payload.title, payload.title.casefold()
    row.revision += 1
    row.updated_at = now()
    await db.flush()
    result = await collection_response(db, row)
    await db.commit()
    return result


@router.delete("/collections/{collection_id}", status_code=204)
async def remove_collection(
    collection_id: UUID,
    user: User,
    db: Database,
    generation: Generation,
    expected_revision: int = Query(ge=1, le=2_147_483_647),
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await collection(db, user.id, generation, collection_id)
    if row.revision != expected_revision:
        raise HTTPException(409, "Collection changed; refresh before removing")
    # Removing a collection changes each member's organization, so invalidate
    # stale metadata revisions before the FK cascade unlinks memberships.
    member_ids = select(WorkoutLibraryCollectionMember.workout_id).where(
        WorkoutLibraryCollectionMember.collection_id == row.id,
        WorkoutLibraryCollectionMember.app_user_id == user.id,
        WorkoutLibraryCollectionMember.generation == generation,
    )
    await db.execute(
        update(WorkoutLibraryOrganization)
        .where(
            WorkoutLibraryOrganization.workout_id.in_(member_ids),
            WorkoutLibraryOrganization.app_user_id == user.id,
            WorkoutLibraryOrganization.generation == generation,
        )
        .values(revision=WorkoutLibraryOrganization.revision + 1, updated_at=now())
    )
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)


@router.get("/library/{workout_id}/organization")
async def get_organization(workout_id: UUID, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation)
    row = await owned_workout(db, user.id, generation, workout_id)
    return (await overlay_organizations(db, [row]))[0]["organization"]


@router.put("/library/{workout_id}/organization")
async def update_organization(
    workout_id: UUID, payload: OrganizationUpdate, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_workout(db, user.id, generation, workout_id)
    metadata = await organization_for(db, row)
    if (metadata.revision if metadata else 0) != payload.expected_revision:
        raise HTTPException(409, "Library organization changed; refresh before saving")
    if payload.collection_ids is not None:
        for identifier in payload.collection_ids:
            await collection(db, user.id, generation, identifier)
    if metadata is None:
        metadata = await refresh_source_metadata(db, row)
    else:
        metadata.revision += 1
    for name in ("favorite", "archived", "tags"):
        if name in payload.model_fields_set:
            setattr(metadata, name, getattr(payload, name))
    if payload.tags is not None:
        metadata.tag_keys = [tag.casefold() for tag in payload.tags]
    metadata.updated_at = now()
    if payload.collection_ids is not None:
        await db.execute(
            delete(WorkoutLibraryCollectionMember).where(
                WorkoutLibraryCollectionMember.workout_id == row.id,
                WorkoutLibraryCollectionMember.app_user_id == user.id,
                WorkoutLibraryCollectionMember.generation == generation,
            )
        )
        for identifier in payload.collection_ids:
            db.add(
                WorkoutLibraryCollectionMember(
                    collection_id=identifier,
                    workout_id=row.id,
                    app_user_id=user.id,
                    generation=generation,
                )
            )
    await db.flush()
    result = (await overlay_organizations(db, [row]))[0]["organization"]
    await db.commit()
    return result


def cursor_digest(owner, generation, filters):
    return hashlib.sha256(
        json.dumps([owner, generation, filters], sort_keys=True).encode()
    ).hexdigest()


def encode_cursor(row, digest):
    return (
        base64.urlsafe_b64encode(
            json.dumps(
                {"created_at": row.created_at.isoformat(), "id": str(row.id), "filters": digest}
            ).encode()
        )
        .decode()
        .rstrip("=")
    )


def decode_cursor(value, digest):
    try:
        data = json.loads(
            base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        )
        if not isinstance(data, dict) or set(data) != {"created_at", "id", "filters"}:
            raise ValueError()
        timestamp, identifier = datetime.fromisoformat(data["created_at"]), UUID(data["id"])
        if timestamp.tzinfo is None:
            raise ValueError()
    except (ValueError, TypeError, KeyError, UnicodeDecodeError) as exc:
        raise HTTPException(422, "Invalid library cursor") from exc
    if data["filters"] != digest:
        raise HTTPException(409, "Library filters or data generation changed; restart the search")
    return timestamp, identifier


@router.get("/library/search")
async def search_library(
    user: User,
    db: Database,
    generation: Generation,
    q: str = Query(default="", max_length=100),
    equipment: str | None = Query(default=None, max_length=100),
    kind: Literal["exercise", "accessory", "session", "program"] | None = None,
    favorite_only: bool = False,
    include_archived: bool = False,
    archived_only: bool = False,
    collection_id: UUID | None = None,
    tags: list[str] = Query(default=[], max_length=20),
    limit: int = Query(default=25, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    cursor: str | None = Query(default=None, max_length=512),
):
    await membership_for(db, user.id, generation=generation)
    try:
        tags = sorted({label(tag, 40).casefold() for tag in tags})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if collection_id:
        await collection(db, user.id, generation, collection_id)
    conditions = [WorkoutRecord.app_user_id == user.id, WorkoutRecord.generation == generation]
    meta = WorkoutLibraryOrganization
    metadata_scope = [
        meta.workout_id == WorkoutRecord.id,
        meta.app_user_id == user.id,
        meta.generation == generation,
    ]
    if archived_only:
        conditions.append(exists().where(*metadata_scope, meta.archived.is_(True)))
    elif not include_archived:
        conditions.append(active_library_condition())
    if favorite_only:
        conditions.append(exists().where(*metadata_scope, meta.favorite.is_(True)))
    if tags:
        conditions.append(exists().where(*metadata_scope, meta.tag_keys.contains(tags)))
    if collection_id:
        conditions.append(
            exists().where(
                WorkoutLibraryCollectionMember.workout_id == WorkoutRecord.id,
                WorkoutLibraryCollectionMember.app_user_id == user.id,
                WorkoutLibraryCollectionMember.generation == generation,
                WorkoutLibraryCollectionMember.collection_id == collection_id,
            )
        )
    if kind:
        conditions.append(WorkoutRecord.content["kind"].astext == kind)
    if equipment:
        equipment = equipment.strip()
        escaped_equipment = equipment.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(
            or_(
                cast(WorkoutRecord.content["equipment_required"], String).ilike(
                    f"%{escaped_equipment}%", escape="\\"
                ),
                cast(WorkoutRecord.content["equipment_optional"], String).ilike(
                    f"%{escaped_equipment}%", escape="\\"
                ),
            )
        )
    q = q.strip()
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        conditions.append(
            or_(
                WorkoutRecord.content["title"].astext.ilike(pattern, escape="\\"),
                cast(
                    func.jsonb_path_query_array(
                        WorkoutRecord.content, cast("$.blocks[*].exercises[*].name", JSONPATH)
                    ),
                    String,
                ).ilike(pattern, escape="\\"),
                exists().where(
                    *metadata_scope, cast(meta.tags, String).ilike(pattern, escape="\\")
                ),
            )
        )
    digest = cursor_digest(
        user.id,
        generation,
        {
            "q": q,
            "equipment": equipment,
            "kind": kind,
            "favorite": favorite_only,
            "include_archived": include_archived,
            "archived_only": archived_only,
            "collection": str(collection_id) if collection_id else None,
            "tags": tags,
        },
    )
    total = await db.scalar(select(func.count()).select_from(WorkoutRecord).where(*conditions))
    query = select(WorkoutRecord).where(*conditions)
    if cursor:
        if offset:
            raise HTTPException(422, "Use a cursor or offset, not both")
        timestamp, identifier = decode_cursor(cursor, digest)
        query = query.where(
            or_(
                WorkoutRecord.created_at < timestamp,
                (WorkoutRecord.created_at == timestamp) & (WorkoutRecord.id < identifier),
            )
        )
    rows = (
        await db.scalars(
            query.order_by(WorkoutRecord.created_at.desc(), WorkoutRecord.id.desc())
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    return {
        "items": await overlay_organizations(db, rows[:limit]),
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": len(rows) > limit,
        "next_cursor": encode_cursor(rows[limit - 1], digest) if len(rows) > limit else None,
    }


@router.get("/library/duplicate-sources")
async def duplicate_sources(
    user: User,
    db: Database,
    generation: Generation,
    source_url: str = Query(max_length=4000),
    exclude_id: UUID | None = None,
):
    await membership_for(db, user.id, generation=generation)
    try:
        parsed = urlsplit(source_url)
        parsed.port
    except ValueError as exc:
        raise HTTPException(422, "Invalid source URL") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        raise HTTPException(422, "Use an http(s) source URL without credentials")
    key = source_key(source_url)
    if key is None:
        raise HTTPException(422, "Invalid source URL")
    # Indexed candidates plus a bounded legacy fallback. Verify against current
    # content so a missed edit hook can never report an obsolete source as equal.
    meta = WorkoutLibraryOrganization
    rows = (
        await db.execute(
            select(
                WorkoutRecord.id,
                WorkoutRecord.revision,
                WorkoutRecord.content["title"].astext.label("title"),
                WorkoutRecord.content["source_url"].astext.label("source_url"),
                func.coalesce(meta.archived, False).label("archived"),
            )
            .outerjoin(
                meta,
                (meta.workout_id == WorkoutRecord.id)
                & (meta.app_user_id == user.id)
                & (meta.generation == generation),
            )
            .where(
                WorkoutRecord.app_user_id == user.id,
                WorkoutRecord.generation == generation,
                or_(meta.source_key == key, meta.workout_id.is_(None)),
                WorkoutRecord.id != exclude_id if exclude_id else True,
            )
            .order_by(WorkoutRecord.created_at.desc(), WorkoutRecord.id.desc())
            .limit(1001)
        )
    ).all()
    matches = [row for row in rows[:1000] if source_key(row.source_url) == key]
    return {
        "advisory": True,
        "matches": [
            {
                "id": str(row.id),
                "title": row.title,
                "revision": row.revision,
                "archived": row.archived,
            }
            for row in matches[:50]
        ],
        "has_more": len(rows) > 1000 or len(matches) > 50,
    }


@router.post("/library/{workout_id}/duplicate", status_code=201)
async def duplicate_workout(
    workout_id: UUID,
    payload: DuplicateRequest,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
):
    await membership_for(db, user.id, generation=generation, write=True)
    digest = hashlib.sha256(
        json.dumps([str(workout_id), payload.model_dump(mode="json")], sort_keys=True).encode()
    ).hexdigest()
    receipt = await db.scalar(
        select(WorkoutLibraryDuplicateReceipt).where(
            WorkoutLibraryDuplicateReceipt.app_user_id == user.id,
            WorkoutLibraryDuplicateReceipt.generation == generation,
            WorkoutLibraryDuplicateReceipt.request_id == payload.request_id,
        )
    )
    if receipt:
        if receipt.request_hash != digest:
            raise HTTPException(409, "Duplicate request ID was already used with different details")
        destination = await db.scalar(
            select(WorkoutRecord).where(
                WorkoutRecord.id == receipt.destination_workout_id,
                WorkoutRecord.app_user_id == user.id,
                WorkoutRecord.generation == generation,
            )
        )
        if destination is None:
            raise HTTPException(
                410, "The copied workout was removed; create a new request to copy again"
            )
        response.status_code = 200
        return (await overlay_organizations(db, [destination]))[0]
    source = await owned_workout(db, user.id, generation, workout_id)
    if source.revision != payload.expected_revision:
        raise HTTPException(409, "Workout changed; refresh before making a copy")
    content = copy.deepcopy(source.content)
    identifier = uuid4()
    content.update(id=str(identifier), version=1, parent_version_id=None)
    if payload.title is not None:
        content["title"] = payload.title
    content = bounded_content(content)
    destination = WorkoutRecord(
        id=identifier, app_user_id=user.id, generation=generation, revision=1, content=content
    )
    db.add(destination)
    await db.flush()
    db.add(
        WorkoutVersion(
            app_user_id=user.id,
            generation=generation,
            workout_id=identifier,
            revision=1,
            content=content,
        )
    )
    metadata = await refresh_source_metadata(db, destination)
    metadata.duplicate_of_workout_id, metadata.duplicate_of_revision = source.id, source.revision
    if payload.copy_organization:
        original = await organization_for(db, source)
        if original:
            metadata.tags, metadata.tag_keys = list(original.tags), list(original.tag_keys)
        links = (
            await db.scalars(
                select(WorkoutLibraryCollectionMember.collection_id).where(
                    WorkoutLibraryCollectionMember.workout_id == source.id,
                    WorkoutLibraryCollectionMember.app_user_id == user.id,
                    WorkoutLibraryCollectionMember.generation == generation,
                )
            )
        ).all()
        for collection_id in links:
            db.add(
                WorkoutLibraryCollectionMember(
                    collection_id=collection_id,
                    workout_id=identifier,
                    app_user_id=user.id,
                    generation=generation,
                )
            )
    db.add(
        WorkoutLibraryDuplicateReceipt(
            app_user_id=user.id,
            generation=generation,
            request_id=payload.request_id,
            request_hash=digest,
            source_workout_id=source.id,
            source_revision=source.revision,
            destination_workout_id=identifier,
        )
    )
    await db.flush()
    result = (await overlay_organizations(db, [destination]))[0]
    await db.commit()
    return result
