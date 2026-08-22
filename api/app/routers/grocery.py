"""Grocery list API endpoints with shared list support."""

import secrets
import string
from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.grocery_sync import grocery_account_scope_id, grocery_mutation_hash
from app.models.grocery import (
    GroceryItem,
    GroceryList,
    GroceryListInvite,
    GroceryListMember,
    GroceryMutationReceipt,
)
from app.models.identity import AppUser

router = APIRouter(prefix="/api/grocery", tags=["grocery"])


# ============================================================
# Helper Functions
# ============================================================

def generate_invite_code(length: int = 8) -> str:
    """Generate a random invite code like 'ABC12345'."""
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))


async def get_user_list(db: AsyncSession, user_id: str) -> Optional[GroceryList]:
    """Get the user's current grocery list (the one they're a member of).
    
    If user is somehow a member of multiple lists (data inconsistency),
    returns the most recently joined one.
    """
    result = await db.execute(
        select(GroceryList)
        .join(GroceryListMember)
        .where(GroceryListMember.user_id == user_id)
        .options(selectinload(GroceryList.members))
        .order_by(GroceryListMember.joined_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _lock_membership_owner(db: AsyncSession, user_id: str) -> None:
    """Serialize list resolution with every transition for this stable account."""

    await db.scalar(
        select(AppUser.id).where(AppUser.id == user_id).with_for_update()
    )


async def get_or_create_user_list(db: AsyncSession, user: ClerkUser) -> GroceryList:
    """Get the user's list, or create one if they don't have one."""
    # Account deletion and every membership transition lock this same row.
    # Keep it through list resolution so callers cannot retain stale access.
    await _lock_membership_owner(db, user.id)
    grocery_list = await get_user_list(db, user.id)
    
    if not grocery_list:
        # Create a new list for this user
        grocery_list = GroceryList(name="Grocery List")
        db.add(grocery_list)
        await db.flush()  # Get the ID
        
        # Add user as member
        member = GroceryListMember(
            list_id=grocery_list.id,
            user_id=user.id,
            display_name=user.display_name
        )
        db.add(member)
        await db.commit()
        # Commit is required because read endpoints may create the first list.
        # Reacquire the account lock and resolve again so a transition that won
        # the small post-commit window cannot leave the caller with stale scope.
        await _lock_membership_owner(db, user.id)
        grocery_list = await get_user_list(db, user.id)
        if grocery_list is None:
            raise RuntimeError("Grocery list membership disappeared during creation")
    
    return grocery_list


# ============================================================
# Pydantic Schemas
# ============================================================

class GroceryItemCreate(BaseModel):
    """Request to add a grocery item."""
    name: str = Field(..., min_length=1, max_length=255, description="Item name (max 255 characters)")
    quantity: Optional[str] = Field(None, max_length=50)
    unit: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=255)
    recipe_id: Optional[UUID] = None
    recipe_title: Optional[str] = Field(None, max_length=255)


class GroceryItemUpdate(BaseModel):
    """Request to update a grocery item."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    quantity: Optional[str] = Field(None, max_length=50)
    unit: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=255)
    checked: Optional[bool] = None


class GroceryItemResponse(BaseModel):
    """Grocery item response."""
    id: UUID
    name: str
    quantity: Optional[str] = None
    unit: Optional[str] = None
    notes: Optional[str] = None
    checked: bool
    recipe_id: Optional[UUID] = None
    recipe_title: Optional[str] = None
    added_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class AddFromRecipeRequest(BaseModel):
    """Request to add ingredients from a recipe."""
    recipe_id: UUID
    recipe_title: str = Field(..., max_length=255)
    ingredients: list[GroceryItemCreate]


class GroceryListMemberResponse(BaseModel):
    """Member of a grocery list."""
    user_id: str
    display_name: Optional[str] = None
    joined_at: datetime
    is_you: bool = False
    
    model_config = ConfigDict(from_attributes=True)


class GroceryListResponse(BaseModel):
    """Grocery list info with members."""
    id: UUID
    name: str
    is_shared: bool
    members: list[GroceryListMemberResponse]
    revision: int
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class GroceryListInviteResponse(BaseModel):
    """Invite response with code and deep link."""
    invite_code: str
    deep_link: str
    list_name: str
    created_by_name: Optional[str] = None


class InvitePreviewResponse(BaseModel):
    """Preview of an invite (for join screen)."""
    list_name: str
    member_count: int
    members: list[str]  # Display names of current members
    created_by_name: Optional[str] = None
    is_valid: bool = True
    already_member: bool = False


class GroceryMutationOperation(str, Enum):
    """Replay-safe operations supported by the synchronization contract."""

    ADD = "add"
    UPDATE = "update"
    SET_CHECKED = "set_checked"
    DELETE = "delete"


class GroceryMutationRequest(BaseModel):
    """One idempotent, desired-state grocery mutation."""

    mutation_id: UUID
    operation: GroceryMutationOperation
    list_id: UUID
    item_id: UUID
    item: Optional[GroceryItemCreate] = None
    changes: Optional[GroceryItemUpdate] = None
    checked: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_operation_payload(self):
        if self.operation is GroceryMutationOperation.ADD:
            valid = self.item is not None and self.changes is None and self.checked is None
        elif self.operation is GroceryMutationOperation.UPDATE:
            valid = (
                self.item is None
                and self.changes is not None
                and bool(self.changes.model_fields_set)
                and "checked" not in self.changes.model_fields_set
                and self.checked is None
                and not (
                    "name" in self.changes.model_fields_set
                    and self.changes.name is None
                )
            )
        elif self.operation is GroceryMutationOperation.SET_CHECKED:
            valid = self.item is None and self.changes is None and self.checked is not None
        else:
            valid = self.item is None and self.changes is None and self.checked is None

        if not valid:
            raise ValueError(f"Invalid payload for grocery operation '{self.operation.value}'")
        return self


class GrocerySnapshotResponse(BaseModel):
    """Atomic account/list scope and item state for offline clients and widgets."""

    account_scope_id: str
    list: GroceryListResponse
    items: list[GroceryItemResponse]
    total: int
    unchecked: int
    checked: int
    server_time: datetime


class GroceryMutationResponse(BaseModel):
    """Mutation acknowledgement plus the authoritative post-mutation state."""

    mutation_id: UUID
    replayed: bool
    snapshot: GrocerySnapshotResponse


# ============================================================
# List Management Endpoints
# ============================================================

@router.get("/list", response_model=GroceryListResponse)
async def get_list_info(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Get info about the user's grocery list, including members."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    # Get members with display names
    members_result = await db.execute(
        select(GroceryListMember).where(GroceryListMember.list_id == grocery_list.id)
    )
    members = members_result.scalars().all()
    
    return GroceryListResponse(
        id=grocery_list.id,
        name=grocery_list.name,
        is_shared=len(members) > 1,
        members=[
            GroceryListMemberResponse(
                user_id=m.user_id,
                display_name=m.display_name,
                joined_at=m.joined_at,
                is_you=m.user_id == user.id
            )
            for m in members
        ],
        revision=grocery_list.revision,
        created_at=grocery_list.created_at,
        updated_at=grocery_list.updated_at,
    )


@router.post("/list/invite", response_model=GroceryListInviteResponse)
async def create_invite(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Generate an invite link to share the grocery list."""
    grocery_list = await get_or_create_user_list(db, user)
    
    # Generate unique invite code
    invite_code = generate_invite_code()
    
    # Create invite
    invite = GroceryListInvite(
        list_id=grocery_list.id,
        invite_code=invite_code,
        created_by=user.id
    )
    db.add(invite)
    await db.commit()
    
    return GroceryListInviteResponse(
        invite_code=invite_code,
        deep_link=f"hafarecipes://grocery/join/{invite_code}",
        list_name=grocery_list.name,
        created_by_name=user.display_name
    )


@router.get("/list/invite/{code}", response_model=InvitePreviewResponse)
async def get_invite_preview(
    code: str,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Get preview of an invite (for join confirmation screen)."""
    # Find the invite
    result = await db.execute(
        select(GroceryListInvite)
        .where(GroceryListInvite.invite_code == code.upper())
        .options(selectinload(GroceryListInvite.grocery_list))
    )
    invite = result.scalar_one_or_none()
    
    if not invite:
        return InvitePreviewResponse(
            list_name="",
            member_count=0,
            members=[],
            is_valid=False
        )
    
    # Get members
    members_result = await db.execute(
        select(GroceryListMember).where(GroceryListMember.list_id == invite.list_id)
    )
    members = members_result.scalars().all()
    
    # Check if user is already a member
    already_member = any(m.user_id == user.id for m in members)
    
    # Get creator's name
    creator = next((m for m in members if m.user_id == invite.created_by), None)
    
    return InvitePreviewResponse(
        list_name=invite.grocery_list.name,
        member_count=len(members),
        members=[m.display_name or "A chef" for m in members],
        created_by_name=creator.display_name if creator else None,
        is_valid=True,
        already_member=already_member
    )


@router.post("/list/join/{code}")
async def join_list(
    code: str,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Accept an invite and join a shared grocery list."""
    await _lock_membership_owner(db, user.id)
    # Find the invite
    result = await db.execute(
        select(GroceryListInvite)
        .where(GroceryListInvite.invite_code == code.upper())
    )
    invite = result.scalar_one_or_none()
    
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    
    # Check if user is already a member
    existing_member = await db.execute(
        select(GroceryListMember).where(
            GroceryListMember.list_id == invite.list_id,
            GroceryListMember.user_id == user.id
        )
    )
    if existing_member.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You're already a member of this list")
    
    # Archive user's current personal items (if they have any)
    current_list = await get_user_list(db, user.id)
    list_ids = {invite.list_id}
    if current_list:
        list_ids.add(current_list.id)
    locked_lists = await _lock_grocery_lists(db, list_ids)
    target_list = locked_lists.get(invite.list_id)
    if target_list is None:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    if current_list:
        current_list = locked_lists[current_list.id]
        # Archive their personal items
        await db.execute(
            update(GroceryItem)
            .where(
                GroceryItem.list_id == current_list.id,
                GroceryItem.user_id == user.id
            )
            .values(archived=True)
        )
        
        # Remove them from their current list
        await db.execute(
            delete(GroceryListMember).where(
                GroceryListMember.list_id == current_list.id,
                GroceryListMember.user_id == user.id
            )
        )
        
        # If the old list is now empty, delete it
        remaining_members = await db.execute(
            select(func.count(GroceryListMember.user_id))
            .where(GroceryListMember.list_id == current_list.id)
        )
        if remaining_members.scalar() == 0:
            await db.execute(delete(GroceryList).where(GroceryList.id == current_list.id))
        else:
            current_list.revision += 1
    
    # Add user to the new list
    new_member = GroceryListMember(
        list_id=invite.list_id,
        user_id=user.id,
        display_name=user.display_name
    )
    db.add(new_member)
    
    # Mark invite as accepted
    invite.accepted_by = user.id
    invite.accepted_at = datetime.now(timezone.utc)
    target_list.revision += 1
    
    await db.commit()
    
    return {"message": "Successfully joined the grocery list!"}


@router.delete("/list/leave")
async def leave_list(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Leave a shared grocery list. Your archived personal items will be restored."""
    await _lock_membership_owner(db, user.id)
    current_list = await get_user_list(db, user.id)
    
    if not current_list:
        raise HTTPException(status_code=404, detail="You're not in a grocery list")
    current_list = await _lock_grocery_list(db, current_list.id)
    
    # Get member count
    members_result = await db.execute(
        select(func.count(GroceryListMember.user_id))
        .where(GroceryListMember.list_id == current_list.id)
    )
    member_count = members_result.scalar()
    
    if member_count <= 1:
        raise HTTPException(status_code=400, detail="You can't leave a list when you're the only member")
    
    # Remove user from the list
    await db.execute(
        delete(GroceryListMember).where(
            GroceryListMember.list_id == current_list.id,
            GroceryListMember.user_id == user.id
        )
    )
    
    # Create a new personal list for the user
    new_list = GroceryList(name="Grocery List")
    db.add(new_list)
    await db.flush()
    
    # Add user as member
    new_member = GroceryListMember(
        list_id=new_list.id,
        user_id=user.id,
        display_name=user.display_name
    )
    db.add(new_member)
    
    # Restore their archived items to the new list
    await db.execute(
        update(GroceryItem)
        .where(
            GroceryItem.user_id == user.id,
            GroceryItem.archived.is_(True)
        )
        .values(archived=False, list_id=new_list.id)
    )
    current_list.revision += 1
    
    await db.commit()
    
    return {"message": "Left the shared list. Your personal items have been restored."}


@router.delete("/list/members/{member_user_id}")
async def remove_member(
    member_user_id: str,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Remove a member from the shared grocery list."""
    await _lock_membership_owner(db, member_user_id)
    current_list = await get_user_list(db, user.id)
    
    if not current_list:
        raise HTTPException(status_code=404, detail="You're not in a grocery list")
    current_list = await _lock_grocery_list(db, current_list.id)
    
    # Check if target user is a member
    target_member = await db.execute(
        select(GroceryListMember).where(
            GroceryListMember.list_id == current_list.id,
            GroceryListMember.user_id == member_user_id
        )
    )
    if not target_member.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User is not a member of this list")
    
    if member_user_id == user.id:
        raise HTTPException(status_code=400, detail="Use the leave endpoint to remove yourself")
    
    # Remove the member
    await db.execute(
        delete(GroceryListMember).where(
            GroceryListMember.list_id == current_list.id,
            GroceryListMember.user_id == member_user_id
        )
    )
    
    # Create a new personal list for the removed user and restore their items
    new_list = GroceryList(name="Grocery List")
    db.add(new_list)
    await db.flush()
    
    new_member = GroceryListMember(
        list_id=new_list.id,
        user_id=member_user_id,
        display_name=None  # We don't have their display name here
    )
    db.add(new_member)
    
    # Restore their archived items
    await db.execute(
        update(GroceryItem)
        .where(
            GroceryItem.user_id == member_user_id,
            GroceryItem.archived.is_(True)
        )
        .values(archived=False, list_id=new_list.id)
    )
    current_list.revision += 1
    
    await db.commit()
    
    return {"message": "Member removed from the list"}


# ============================================================
# Item Endpoints
# ============================================================


async def _build_grocery_snapshot(
    db: AsyncSession,
    grocery_list: GroceryList,
    user: ClerkUser,
) -> GrocerySnapshotResponse:
    """Read one authoritative list snapshot inside the caller's transaction."""

    members = (
        await db.execute(
            select(GroceryListMember)
            .where(GroceryListMember.list_id == grocery_list.id)
            .order_by(GroceryListMember.joined_at, GroceryListMember.user_id)
        )
    ).scalars().all()
    items = (
        await db.execute(
            select(GroceryItem)
            .where(
                GroceryItem.list_id == grocery_list.id,
                GroceryItem.archived.is_(False),
            )
            .order_by(GroceryItem.checked, GroceryItem.created_at.desc(), GroceryItem.id)
        )
    ).scalars().all()
    unchecked = sum(not item.checked for item in items)

    return GrocerySnapshotResponse(
        account_scope_id=grocery_account_scope_id(user.id),
        list=GroceryListResponse(
            id=grocery_list.id,
            name=grocery_list.name,
            is_shared=len(members) > 1,
            members=[
                GroceryListMemberResponse(
                    user_id=member.user_id,
                    display_name=member.display_name,
                    joined_at=member.joined_at,
                    is_you=member.user_id == user.id,
                )
                for member in members
            ],
            revision=grocery_list.revision,
            created_at=grocery_list.created_at,
            updated_at=grocery_list.updated_at,
        ),
        items=[GroceryItemResponse.model_validate(item) for item in items],
        total=len(items),
        unchecked=unchecked,
        checked=len(items) - unchecked,
        server_time=datetime.now(timezone.utc),
    )


async def _mutation_item(
    db: AsyncSession,
    grocery_list: GroceryList,
    item_id: UUID,
) -> GroceryItem:
    item = (
        await db.execute(
            select(GroceryItem).where(
                GroceryItem.id == item_id,
                GroceryItem.list_id == grocery_list.id,
                GroceryItem.archived.is_(False),
            )
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


async def _lock_grocery_list(
    db: AsyncSession,
    list_id: UUID,
) -> GroceryList:
    """Serialize all list mutations so revision increments cannot be lost."""

    return (
        await db.execute(
            select(GroceryList)
            .where(GroceryList.id == list_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _lock_grocery_lists(
    db: AsyncSession,
    list_ids: set[UUID],
) -> dict[UUID, GroceryList]:
    """Lock multiple lists in UUID order to prevent reciprocal-join deadlocks."""

    lists = (
        await db.execute(
            select(GroceryList)
            .where(GroceryList.id.in_(list_ids))
            .order_by(GroceryList.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    return {grocery_list.id: grocery_list for grocery_list in lists}


@router.get("/snapshot", response_model=GrocerySnapshotResponse)
async def get_grocery_snapshot(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Return account-scoped list metadata, revision, counts, and items atomically."""

    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    return await _build_grocery_snapshot(db, grocery_list, user)


@router.post("/sync", response_model=GroceryMutationResponse)
async def sync_grocery_mutation(
    mutation: GroceryMutationRequest,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Apply a hash-bound mutation once and return the authoritative list snapshot."""

    grocery_list = await get_or_create_user_list(db, user)
    if grocery_list.id != mutation.list_id:
        raise HTTPException(
            status_code=409,
            detail="Grocery list scope changed; refresh before retrying",
        )
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    payload_hash = grocery_mutation_hash(
        mutation.model_dump(
            mode="json",
            exclude={"mutation_id"},
            exclude_none=True,
            exclude_unset=True,
        )
    )
    receipt = await db.get(
        GroceryMutationReceipt,
        {"list_id": grocery_list.id, "mutation_id": mutation.mutation_id},
    )
    if receipt:
        if (
            receipt.actor_user_id != user.id
            or receipt.operation != mutation.operation.value
            or receipt.request_hash != payload_hash
        ):
            raise HTTPException(
                status_code=409,
                detail="Mutation ID was already used with different input",
            )
        return GroceryMutationResponse(
            mutation_id=mutation.mutation_id,
            replayed=True,
            snapshot=await _build_grocery_snapshot(db, grocery_list, user),
        )

    if mutation.operation is GroceryMutationOperation.ADD:
        existing_item = await db.get(GroceryItem, mutation.item_id)
        if existing_item:
            raise HTTPException(status_code=409, detail="Item ID already exists")
        assert mutation.item is not None
        db.add(
            GroceryItem(
                id=mutation.item_id,
                user_id=user.id,
                list_id=grocery_list.id,
                name=mutation.item.name,
                quantity=mutation.item.quantity,
                unit=mutation.item.unit,
                notes=mutation.item.notes,
                recipe_id=mutation.item.recipe_id,
                recipe_title=mutation.item.recipe_title,
                added_by_name=user.display_name,
                checked=False,
            )
        )
    elif mutation.operation is GroceryMutationOperation.UPDATE:
        item = await _mutation_item(db, grocery_list, mutation.item_id)
        assert mutation.changes is not None
        for field, value in mutation.changes.model_dump(exclude_unset=True).items():
            setattr(item, field, value)
    elif mutation.operation is GroceryMutationOperation.SET_CHECKED:
        item = await _mutation_item(db, grocery_list, mutation.item_id)
        assert mutation.checked is not None
        item.checked = mutation.checked
    else:
        item = await _mutation_item(db, grocery_list, mutation.item_id)
        await db.delete(item)

    grocery_list.revision += 1
    db.add(
        GroceryMutationReceipt(
            list_id=grocery_list.id,
            mutation_id=mutation.mutation_id,
            actor_user_id=user.id,
            operation=mutation.operation.value,
            request_hash=payload_hash,
        )
    )
    await db.flush()
    await db.refresh(grocery_list)
    snapshot = await _build_grocery_snapshot(db, grocery_list, user)
    await db.commit()
    return GroceryMutationResponse(
        mutation_id=mutation.mutation_id,
        replayed=False,
        snapshot=snapshot,
    )


@router.get("/", response_model=list[GroceryItemResponse])
async def get_grocery_items(
    include_checked: bool = Query(default=True, description="Include checked items"),
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """
    Get the user's grocery list items.
    
    Returns items from the user's current list (personal or shared).
    Ordered by: unchecked first, then by creation date.
    """
    grocery_list = await get_or_create_user_list(db, user)
    
    query = select(GroceryItem).where(
        GroceryItem.list_id == grocery_list.id,
        GroceryItem.archived.is_(False)
    )
    
    if not include_checked:
        query = query.where(GroceryItem.checked.is_(False))
    
    # Order: unchecked first, then by created_at desc
    query = query.order_by(GroceryItem.checked, GroceryItem.created_at.desc())
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    return items


@router.get("/count")
async def get_grocery_count(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Get count of grocery items (total and unchecked)."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    # Total count
    total_result = await db.execute(
        select(func.count(GroceryItem.id)).where(
            GroceryItem.list_id == grocery_list.id,
            GroceryItem.archived.is_(False)
        )
    )
    total = total_result.scalar()
    
    # Unchecked count
    unchecked_result = await db.execute(
        select(func.count(GroceryItem.id)).where(
            GroceryItem.list_id == grocery_list.id,
            GroceryItem.archived.is_(False),
            GroceryItem.checked.is_(False)
        )
    )
    unchecked = unchecked_result.scalar()
    
    return {
        "total": total,
        "unchecked": unchecked,
        "checked": total - unchecked
    }


@router.post("/", response_model=GroceryItemResponse)
async def add_grocery_item(
    item: GroceryItemCreate,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Add a single item to the grocery list."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    new_item = GroceryItem(
        user_id=user.id,
        list_id=grocery_list.id,
        name=item.name,
        quantity=item.quantity,
        unit=item.unit,
        notes=item.notes,
        recipe_id=item.recipe_id,
        recipe_title=item.recipe_title,
        added_by_name=user.display_name,
        checked=False,
    )
    
    db.add(new_item)
    grocery_list.revision += 1
    await db.commit()
    await db.refresh(new_item)
    
    return new_item


@router.post("/from-recipe", response_model=list[GroceryItemResponse])
async def add_from_recipe(
    request: AddFromRecipeRequest,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """
    Add all ingredients from a recipe to the grocery list.
    
    This is a batch operation that adds multiple items at once.
    """
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    new_items = []
    
    for ingredient in request.ingredients:
        new_item = GroceryItem(
            user_id=user.id,
            list_id=grocery_list.id,
            name=ingredient.name,
            quantity=ingredient.quantity,
            unit=ingredient.unit,
            notes=ingredient.notes,
            recipe_id=request.recipe_id,
            recipe_title=request.recipe_title,
            added_by_name=user.display_name,
            checked=False,
        )
        db.add(new_item)
        new_items.append(new_item)
    
    grocery_list.revision += 1
    await db.commit()
    
    # Refresh all items to get their IDs
    for item in new_items:
        await db.refresh(item)
    
    return new_items


@router.put("/{item_id}", response_model=GroceryItemResponse)
async def update_grocery_item(
    item_id: UUID,
    item_update: GroceryItemUpdate,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Update a grocery item. Any member of the shared list can update items."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    result = await db.execute(
        select(GroceryItem).where(
            GroceryItem.id == item_id,
            GroceryItem.list_id == grocery_list.id,
            GroceryItem.archived.is_(False)
        )
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # Update fields
    if item_update.name is not None:
        item.name = item_update.name
    if item_update.quantity is not None:
        item.quantity = item_update.quantity
    if item_update.unit is not None:
        item.unit = item_update.unit
    if item_update.notes is not None:
        item.notes = item_update.notes
    if item_update.checked is not None:
        item.checked = item_update.checked
    
    grocery_list.revision += 1
    await db.commit()
    await db.refresh(item)
    
    return item


@router.put("/{item_id}/toggle", response_model=GroceryItemResponse)
async def toggle_grocery_item(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Toggle the checked status of a grocery item. Any member can toggle."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    result = await db.execute(
        select(GroceryItem).where(
            GroceryItem.id == item_id,
            GroceryItem.list_id == grocery_list.id,
            GroceryItem.archived.is_(False)
        )
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    item.checked = not item.checked
    grocery_list.revision += 1
    await db.commit()
    await db.refresh(item)
    
    return item


@router.delete("/{item_id}")
async def delete_grocery_item(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Delete a single grocery item. Any member can delete items."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    result = await db.execute(
        select(GroceryItem).where(
            GroceryItem.id == item_id,
            GroceryItem.list_id == grocery_list.id,
            GroceryItem.archived.is_(False)
        )
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    await db.delete(item)
    grocery_list.revision += 1
    await db.commit()
    
    return {"message": "Item deleted", "id": str(item_id)}


@router.delete("/clear/checked")
async def clear_checked_items(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Delete all checked items from the grocery list."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    result = await db.execute(
        delete(GroceryItem).where(
            GroceryItem.list_id == grocery_list.id,
            GroceryItem.archived.is_(False),
            GroceryItem.checked.is_(True)
        ).returning(GroceryItem.id)
    )
    deleted_ids = result.scalars().all()
    grocery_list.revision += 1
    await db.commit()
    
    return {
        "message": f"Cleared {len(deleted_ids)} checked items",
        "count": len(deleted_ids)
    }


@router.delete("/clear/all")
async def clear_all_items(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Delete all items from the grocery list."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    result = await db.execute(
        delete(GroceryItem).where(
            GroceryItem.list_id == grocery_list.id,
            GroceryItem.archived.is_(False)
        ).returning(GroceryItem.id)
    )
    deleted_ids = result.scalars().all()
    grocery_list.revision += 1
    await db.commit()
    
    return {
        "message": f"Cleared {len(deleted_ids)} items",
        "count": len(deleted_ids)
    }


@router.delete("/clear/recipe/{recipe_id}")
async def clear_recipe_items(
    recipe_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user)
):
    """Delete all items from a specific recipe in the grocery list."""
    grocery_list = await get_or_create_user_list(db, user)
    grocery_list = await _lock_grocery_list(db, grocery_list.id)
    
    result = await db.execute(
        delete(GroceryItem).where(
            GroceryItem.list_id == grocery_list.id,
            GroceryItem.archived.is_(False),
            GroceryItem.recipe_id == recipe_id
        ).returning(GroceryItem.id)
    )
    deleted_ids = result.scalars().all()
    grocery_list.revision += 1
    await db.commit()
    
    return {
        "message": f"Cleared {len(deleted_ids)} items from recipe",
        "count": len(deleted_ids),
        "recipe_id": str(recipe_id)
    }
