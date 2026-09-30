"""Account-private and household-shared pantry inventory."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.grocery_sync import grocery_mutation_hash
from app.models.grocery import GroceryItem
from app.models.pantry import (
    PantryCopyReceipt,
    PantryItem,
    PantryMutationReceipt,
    PantrySpace,
    PantryTransferReceipt,
)
from app.routers.grocery import _lock_grocery_list, get_or_create_user_list

router = APIRouter(prefix="/api/pantry", tags=["pantry"])


class PantryItemFields(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quantity: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=3)
    unit: str | None = Field(default=None, max_length=50)
    location: str | None = Field(default=None, max_length=50)
    date_kind: Literal["best_before", "use_by"] | None = None
    date_value: date | None = None
    notes: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def date_pair(self):
        if (self.date_kind is None) != (self.date_value is None):
            raise ValueError("Choose a date type and date together")
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Item name cannot be blank")
        return self


class PantryItemChanges(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=3)
    unit: str | None = Field(default=None, max_length=50)
    location: str | None = Field(default=None, max_length=50)
    date_kind: Literal["best_before", "use_by"] | None = None
    date_value: date | None = None
    notes: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def valid_name(self):
        if "name" in self.model_fields_set:
            if self.name is None or not self.name.strip():
                raise ValueError("Item name cannot be blank")
            self.name = self.name.strip()
        return self


class PantryItemResponse(PantryItemFields):
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PantrySnapshot(BaseModel):
    space_id: UUID
    scope: Literal["personal", "household"]
    list_id: UUID | None
    revision: int
    items: list[PantryItemResponse]
    transferred_grocery_item_ids: list[UUID]
    copied_personal_item_ids: list[UUID]
    server_time: datetime


class PantryMutationRequest(BaseModel):
    mutation_id: UUID
    space_id: UUID
    scope: Literal["active", "personal"] = "active"
    operation: Literal["add", "update", "delete"]
    item_id: UUID
    item: PantryItemFields | None = None
    changes: PantryItemChanges | None = None
    base_revision: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def shape(self):
        if self.operation == "add" and (self.item is None or self.changes is not None):
            raise ValueError("Add requires item fields")
        if self.operation == "update" and (self.changes is None or self.item is not None):
            raise ValueError("Update requires changed fields")
        if self.operation == "delete" and (self.item is not None or self.changes is not None):
            raise ValueError("Delete takes no item fields")
        if self.operation != "add" and self.base_revision is None:
            raise ValueError("Update and delete require a base revision")
        if self.changes is not None and not self.changes.model_fields_set:
            raise ValueError("Update must change at least one field")
        if self.changes is not None:
            fields = self.changes.model_fields_set
            if ("date_kind" in fields) != ("date_value" in fields):
                raise ValueError("Change the date type and date together")
        return self


class PantryMutationResponse(BaseModel):
    mutation_id: UUID
    replayed: bool
    snapshot: PantrySnapshot


class PantryTransferLine(BaseModel):
    grocery_item_id: UUID
    quantity: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=3)
    unit: str | None = Field(default=None, max_length=50)
    location: str | None = Field(default=None, max_length=50)
    date_kind: Literal["best_before", "use_by"] | None = None
    date_value: date | None = None

    @model_validator(mode="after")
    def date_pair(self):
        if (self.date_kind is None) != (self.date_value is None):
            raise ValueError("Choose a date type and date together")
        return self


class PantryTransferRequest(BaseModel):
    mutation_id: UUID
    space_id: UUID
    list_id: UUID
    items: list[PantryTransferLine] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_items(self):
        ids = [item.grocery_item_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each grocery item can appear only once")
        return self


class PantryCopyRequest(BaseModel):
    mutation_id: UUID
    space_id: UUID


async def _resolve_space(
    db: AsyncSession,
    user: ClerkUser,
    scope: Literal["active", "personal"],
) -> tuple[PantrySpace, UUID]:
    """Resolve membership under the stable user lock and lock the selected space."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    household = scope == "active" and grocery_list.household_enabled
    condition = (
        PantrySpace.grocery_list_id == grocery_list.id
        if household
        else PantrySpace.owner_user_id == user.id
    )
    space = (
        await db.execute(select(PantrySpace).where(condition).with_for_update())
    ).scalar_one_or_none()
    if space is None:
        space = PantrySpace(
            kind="household" if household else "personal",
            grocery_list_id=grocery_list.id if household else None,
            owner_user_id=None if household else user.id,
        )
        db.add(space)
        await db.commit()
        # Re-acquire the account/list locks after creation. A membership change
        # could otherwise make the newly created space stale before use.
        return await _resolve_space(db, user, scope)
    return space, grocery_list.id


async def _snapshot(db: AsyncSession, space: PantrySpace) -> PantrySnapshot:
    items = (
        (
            await db.execute(
                select(PantryItem)
                .where(PantryItem.space_id == space.id)
                .order_by(PantryItem.date_value.asc().nullslast(), PantryItem.name, PantryItem.id)
            )
        )
        .scalars()
        .all()
    )
    transferred_ids = (
        (
            await db.execute(
                select(PantryTransferReceipt.grocery_item_id)
                .where(PantryTransferReceipt.space_id == space.id)
                .order_by(PantryTransferReceipt.grocery_item_id)
            )
        )
        .scalars()
        .all()
    )
    copied_ids = (
        (
            await db.execute(
                select(PantryCopyReceipt.personal_item_id)
                .where(PantryCopyReceipt.space_id == space.id)
                .order_by(PantryCopyReceipt.personal_item_id)
            )
        )
        .scalars()
        .all()
    )
    return PantrySnapshot(
        space_id=space.id,
        scope=space.kind,
        list_id=space.grocery_list_id,
        revision=space.revision,
        items=[PantryItemResponse.model_validate(item) for item in items],
        transferred_grocery_item_ids=list(transferred_ids),
        copied_personal_item_ids=list(copied_ids),
        server_time=datetime.now(timezone.utc),
    )


async def _receipt(
    db: AsyncSession,
    space: PantrySpace,
    user: ClerkUser,
    *,
    mutation_id: UUID,
    operation: str,
    request_hash: str,
) -> bool:
    existing = await db.get(
        PantryMutationReceipt,
        {"space_id": space.id, "mutation_id": mutation_id},
    )
    if existing:
        if (
            existing.actor_user_id != user.id
            or existing.operation != operation
            or existing.request_hash != request_hash
        ):
            raise HTTPException(status_code=409, detail="Mutation ID was used with different input")
        return True
    db.add(
        PantryMutationReceipt(
            space_id=space.id,
            mutation_id=mutation_id,
            actor_user_id=user.id,
            operation=operation,
            request_hash=request_hash,
        )
    )
    return False


@router.get("/snapshot", response_model=PantrySnapshot)
async def get_pantry_snapshot(
    scope: Literal["active", "personal"] = "active",
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    space, _ = await _resolve_space(db, user, scope)
    return await _snapshot(db, space)


@router.post("/sync", response_model=PantryMutationResponse)
async def sync_pantry_mutation(
    mutation: PantryMutationRequest,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    space, _ = await _resolve_space(db, user, mutation.scope)
    if space.id != mutation.space_id:
        raise HTTPException(status_code=409, detail="Pantry scope changed; refresh before retrying")
    request_hash = grocery_mutation_hash(
        mutation.model_dump(
            mode="json",
            exclude={"mutation_id"},
            exclude_none=True,
            exclude_unset=True,
        )
    )
    replayed = await _receipt(
        db,
        space,
        user,
        mutation_id=mutation.mutation_id,
        operation=mutation.operation,
        request_hash=request_hash,
    )
    if replayed:
        return PantryMutationResponse(
            mutation_id=mutation.mutation_id,
            replayed=True,
            snapshot=await _snapshot(db, space),
        )
    if mutation.base_revision is not None and mutation.base_revision != space.revision:
        raise HTTPException(status_code=409, detail="Pantry changed; refresh and try again")
    if mutation.operation == "add":
        if await db.get(PantryItem, mutation.item_id):
            raise HTTPException(status_code=409, detail="Pantry item ID already exists")
        assert mutation.item is not None
        db.add(
            PantryItem(
                id=mutation.item_id,
                space_id=space.id,
                created_by_user_id=user.id,
                **mutation.item.model_dump(),
            )
        )
    else:
        item = (
            await db.execute(
                select(PantryItem).where(
                    PantryItem.id == mutation.item_id,
                    PantryItem.space_id == space.id,
                )
            )
        ).scalar_one_or_none()
        if item is None:
            raise HTTPException(status_code=404, detail="Pantry item not found")
        if mutation.operation == "delete":
            await db.delete(item)
        else:
            assert mutation.changes is not None
            for field, value in mutation.changes.model_dump(exclude_unset=True).items():
                setattr(item, field, value)
            if (item.date_kind is None) != (item.date_value is None):
                raise HTTPException(status_code=422, detail="Choose a date type and date together")
    space.revision += 1
    await db.flush()
    await db.refresh(space)
    snapshot = await _snapshot(db, space)
    await db.commit()
    return PantryMutationResponse(
        mutation_id=mutation.mutation_id,
        replayed=False,
        snapshot=snapshot,
    )


@router.post("/copy-personal", response_model=PantryMutationResponse)
async def copy_personal_pantry(
    request: PantryCopyRequest,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Explicitly copy private lots into the currently shared household pantry."""
    space, _ = await _resolve_space(db, user, "active")
    if space.kind != "household":
        raise HTTPException(status_code=409, detail="Join a household before copying pantry items")
    if request.space_id != space.id:
        raise HTTPException(
            status_code=409, detail="Household scope changed; refresh before retrying"
        )
    request_hash = grocery_mutation_hash({"space_id": str(request.space_id)})
    replayed = await _receipt(
        db,
        space,
        user,
        mutation_id=request.mutation_id,
        operation="copy",
        request_hash=request_hash,
    )
    if replayed:
        return PantryMutationResponse(
            mutation_id=request.mutation_id, replayed=True, snapshot=await _snapshot(db, space)
        )
    personal_space = (
        await db.execute(select(PantrySpace).where(PantrySpace.owner_user_id == user.id))
    ).scalar_one_or_none()
    if personal_space is not None:
        personal_items = (
            (await db.execute(select(PantryItem).where(PantryItem.space_id == personal_space.id)))
            .scalars()
            .all()
        )
        copied_ids = set(
            (
                await db.execute(
                    select(PantryCopyReceipt.personal_item_id).where(
                        PantryCopyReceipt.space_id == space.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        added = False
        for item in personal_items:
            if item.id in copied_ids:
                continue
            db.add(PantryCopyReceipt(space_id=space.id, personal_item_id=item.id))
            db.add(
                PantryItem(
                    space_id=space.id,
                    source_personal_item_id=item.id,
                    name=item.name,
                    quantity=item.quantity,
                    unit=item.unit,
                    location=item.location,
                    date_kind=item.date_kind,
                    date_value=item.date_value,
                    notes=item.notes,
                    created_by_user_id=user.id,
                )
            )
            added = True
        if added:
            space.revision += 1
    await db.flush()
    snapshot = await _snapshot(db, space)
    await db.commit()
    return PantryMutationResponse(
        mutation_id=request.mutation_id, replayed=False, snapshot=snapshot
    )


@router.post("/from-groceries", response_model=PantryMutationResponse)
async def transfer_checked_groceries(
    request: PantryTransferRequest,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    space, list_id = await _resolve_space(db, user, "active")
    if request.space_id != space.id or request.list_id != list_id:
        raise HTTPException(
            status_code=409, detail="Household scope changed; refresh before retrying"
        )
    request_hash = grocery_mutation_hash(
        request.model_dump(
            mode="json",
            exclude={"mutation_id"},
            exclude_none=True,
        )
    )
    replayed = await _receipt(
        db,
        space,
        user,
        mutation_id=request.mutation_id,
        operation="transfer",
        request_hash=request_hash,
    )
    if replayed:
        return PantryMutationResponse(
            mutation_id=request.mutation_id,
            replayed=True,
            snapshot=await _snapshot(db, space),
        )
    # Membership and the grocery list are locked by _resolve_space. Each source
    # must still be checked and must not have been transferred before.
    for line in request.items:
        grocery_item = (
            await db.execute(
                select(GroceryItem).where(
                    GroceryItem.id == line.grocery_item_id,
                    GroceryItem.list_id == list_id,
                    GroceryItem.archived.is_(False),
                )
            )
        ).scalar_one_or_none()
        if grocery_item is None or not grocery_item.checked:
            raise HTTPException(
                status_code=409, detail="A selected grocery item is no longer checked"
            )
        if await db.get(
            PantryTransferReceipt,
            {
                "space_id": space.id,
                "grocery_item_id": grocery_item.id,
            },
        ):
            raise HTTPException(status_code=409, detail="A selected item is already in the pantry")
        db.add(
            PantryTransferReceipt(
                space_id=space.id,
                grocery_item_id=grocery_item.id,
            )
        )
        db.add(
            PantryItem(
                space_id=space.id,
                name=grocery_item.name,
                quantity=line.quantity,
                unit=line.unit,
                location=line.location,
                date_kind=line.date_kind,
                date_value=line.date_value,
                created_by_user_id=user.id,
            )
        )
    space.revision += 1
    await db.flush()
    await db.refresh(space)
    snapshot = await _snapshot(db, space)
    await db.commit()
    return PantryMutationResponse(
        mutation_id=request.mutation_id,
        replayed=False,
        snapshot=snapshot,
    )
