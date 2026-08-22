"""Provisioning and least-privilege endpoints for the native iOS widget."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.grocery_sync import grocery_account_scope_id
from app.models.grocery import (
    GroceryList,
    GroceryListMember,
    GroceryWidgetCredential,
)
from app.routers.grocery import (
    GroceryMutationRequest,
    GrocerySnapshotResponse,
    _build_grocery_snapshot,
    _lock_grocery_list,
    _lock_membership_owner,
    get_or_create_user_list,
    sync_grocery_mutation,
)
from app.widget_credentials import (
    MAX_WIDGET_INSTALLATIONS_PER_USER,
    WIDGET_CREDENTIAL_SCOPE,
    WIDGET_CREDENTIAL_SCOPES,
    WIDGET_CREDENTIAL_TTL,
    WidgetCredentialContext,
    get_widget_credential,
    issue_widget_token,
    utc_now,
    widget_installation_hash,
)

router = APIRouter(prefix="/api/grocery/widget", tags=["grocery-widget"])


class WidgetCredentialIssueRequest(BaseModel):
    """One opaque installation ID generated and retained by the native app."""

    installation_id: UUID
    model_config = ConfigDict(extra="forbid")


class WidgetCredentialResponse(BaseModel):
    credential_id: UUID
    token: str
    list_id: UUID
    account_scope_id: str
    scopes: tuple[str, ...]
    issued_at: datetime
    expires_at: datetime


class WidgetGroceryListResponse(BaseModel):
    id: UUID
    name: str
    is_shared: bool
    revision: int
    created_at: datetime
    updated_at: datetime


class WidgetGroceryItemResponse(BaseModel):
    id: UUID
    name: str
    quantity: str | None = None
    unit: str | None = None
    notes: str | None = None
    checked: bool
    recipe_id: UUID | None = None
    recipe_title: str | None = None
    added_by_name: str | None = None
    created_at: datetime
    updated_at: datetime


class WidgetGrocerySnapshotResponse(BaseModel):
    """Widget-safe snapshot that excludes stable member identifiers."""

    account_scope_id: str
    list: WidgetGroceryListResponse
    items: list[WidgetGroceryItemResponse]
    total: int
    unchecked: int
    checked: int
    server_time: datetime


class WidgetSetCheckedRequest(BaseModel):
    mutation_id: UUID
    list_id: UUID
    item_id: UUID
    checked: bool
    model_config = ConfigDict(extra="forbid")


class WidgetMutationResponse(BaseModel):
    mutation_id: UUID
    replayed: bool
    snapshot: WidgetGrocerySnapshotResponse


def _widget_snapshot(snapshot: GrocerySnapshotResponse) -> WidgetGrocerySnapshotResponse:
    """Remove member IDs and return only fields the extension can render."""

    return WidgetGrocerySnapshotResponse(
        account_scope_id=snapshot.account_scope_id,
        list=WidgetGroceryListResponse(
            id=snapshot.list.id,
            name=snapshot.list.name,
            is_shared=snapshot.list.is_shared,
            revision=snapshot.list.revision,
            created_at=snapshot.list.created_at,
            updated_at=snapshot.list.updated_at,
        ),
        items=[
            WidgetGroceryItemResponse(
                id=item.id,
                name=item.name,
                quantity=item.quantity,
                unit=item.unit,
                notes=item.notes,
                checked=item.checked,
                recipe_id=item.recipe_id,
                recipe_title=item.recipe_title,
                added_by_name=item.added_by_name,
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
            for item in snapshot.items
        ],
        total=snapshot.total,
        unchecked=snapshot.unchecked,
        checked=snapshot.checked,
        server_time=snapshot.server_time,
    )


async def _bound_widget_list(
    db: AsyncSession,
    context: WidgetCredentialContext,
) -> tuple[GroceryList, ClerkUser]:
    """Revalidate the exact membership after the credential/user locks."""

    credential = context.credential
    member = (
        await db.execute(
            select(GroceryListMember).where(
                GroceryListMember.user_id == credential.app_user_id,
                GroceryListMember.list_id == credential.list_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(
            status_code=409,
            detail="Widget list scope changed; open the app to reconnect the widget",
        )
    grocery_list = await _lock_grocery_list(db, credential.list_id)
    actor = ClerkUser(
        id=credential.app_user_id,
        clerk_user_id="widget",
        clerk_issuer="widget",
        clerk_environment="widget",
        first_name=member.display_name,
    )
    return grocery_list, actor


@router.post(
    "/credentials",
    response_model=WidgetCredentialResponse,
    status_code=status.HTTP_201_CREATED,
)
async def issue_grocery_widget_credential(
    request: WidgetCredentialIssueRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Issue or rotate the capability for one authenticated iOS installation."""

    grocery_list = await get_or_create_user_list(db, user)
    now = utc_now()
    installation_hash = widget_installation_hash(request.installation_id)

    await db.execute(
        delete(GroceryWidgetCredential).where(
            GroceryWidgetCredential.app_user_id == user.id,
            or_(
                GroceryWidgetCredential.revoked_at.is_not(None),
                GroceryWidgetCredential.expires_at <= now,
            ),
        )
    )
    existing = (
        await db.execute(
            select(GroceryWidgetCredential)
            .where(
                GroceryWidgetCredential.app_user_id == user.id,
                GroceryWidgetCredential.installation_hash == installation_hash,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing is None:
        active_count = await db.scalar(
            select(func.count())
            .select_from(GroceryWidgetCredential)
            .where(GroceryWidgetCredential.app_user_id == user.id)
        )
        if active_count >= MAX_WIDGET_INSTALLATIONS_PER_USER:
            raise HTTPException(
                status_code=409,
                detail="Too many active widget installations",
            )
        existing = GroceryWidgetCredential(
            id=uuid4(),
            app_user_id=user.id,
            list_id=grocery_list.id,
            installation_hash=installation_hash,
            token_hash="pending",
            scope=WIDGET_CREDENTIAL_SCOPE,
            issued_at=now,
            expires_at=now + WIDGET_CREDENTIAL_TTL,
        )
        db.add(existing)

    token, token_hash = issue_widget_token(existing.id)
    existing.list_id = grocery_list.id
    existing.token_hash = token_hash
    existing.scope = WIDGET_CREDENTIAL_SCOPE
    existing.issued_at = now
    existing.expires_at = now + WIDGET_CREDENTIAL_TTL
    existing.last_used_at = None
    existing.revoked_at = None
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"

    return WidgetCredentialResponse(
        credential_id=existing.id,
        token=token,
        list_id=grocery_list.id,
        account_scope_id=grocery_account_scope_id(user.id),
        scopes=WIDGET_CREDENTIAL_SCOPES,
        issued_at=existing.issued_at,
        expires_at=existing.expires_at,
    )


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_grocery_widget_credential(
    credential_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Revoke one installation without exposing whether another user owns it."""

    await _lock_membership_owner(db, user.id)
    credential = (
        await db.execute(
            select(GroceryWidgetCredential)
            .where(
                GroceryWidgetCredential.id == credential_id,
                GroceryWidgetCredential.app_user_id == user.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if credential is None:
        raise HTTPException(status_code=404, detail="Widget credential not found")
    if credential.revoked_at is None:
        credential.revoked_at = utc_now()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_current_widget_session(
    db: AsyncSession = Depends(get_db),
    context: WidgetCredentialContext = Depends(get_widget_credential),
):
    """Allow the capability to revoke itself during sign-out cleanup."""

    context.credential.revoked_at = utc_now()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/snapshot", response_model=WidgetGrocerySnapshotResponse)
async def get_widget_grocery_snapshot(
    db: AsyncSession = Depends(get_db),
    context: WidgetCredentialContext = Depends(get_widget_credential),
):
    grocery_list, actor = await _bound_widget_list(db, context)
    snapshot = await _build_grocery_snapshot(db, grocery_list, actor)
    response = _widget_snapshot(snapshot)
    await db.commit()
    return response


@router.post("/set-checked", response_model=WidgetMutationResponse)
async def set_widget_grocery_item_checked(
    request: WidgetSetCheckedRequest,
    db: AsyncSession = Depends(get_db),
    context: WidgetCredentialContext = Depends(get_widget_credential),
):
    """Apply one replay-safe desired checked state with no broader write scope."""

    credential = context.credential
    if request.list_id != credential.list_id:
        raise HTTPException(
            status_code=409,
            detail="Widget list scope changed; open the app to reconnect the widget",
        )
    _, actor = await _bound_widget_list(db, context)
    result = await sync_grocery_mutation(
        GroceryMutationRequest(
            mutation_id=request.mutation_id,
            operation="set_checked",
            list_id=request.list_id,
            item_id=request.item_id,
            checked=request.checked,
        ),
        db,
        actor,
    )
    # Fresh mutations commit inside the shared durable synchronization path;
    # replay responses do not, so commit again to persist the bounded touch.
    await db.commit()
    return WidgetMutationResponse(
        mutation_id=result.mutation_id,
        replayed=result.replayed,
        snapshot=_widget_snapshot(result.snapshot),
    )
