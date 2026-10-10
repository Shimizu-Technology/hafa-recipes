"""Read-only aggregate admission diagnostics using the existing verified admin gate."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser
from app.config import get_settings
from app.db import get_db
from app.domains.workouts.budget import BudgetError, BudgetPolicy, budget_diagnostics
from app.domains.workouts.security import WorkoutsRoute
from app.moderation import require_admin

router = APIRouter(prefix="/api/admin/workouts", tags=["admin-workouts"], route_class=WorkoutsRoute)


@router.get("/ai-budget")
async def ai_budget_diagnostics(
    admin: Annotated[ClerkUser, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=50),
):
    del admin
    try:
        return await budget_diagnostics(db, BudgetPolicy.from_settings(get_settings()), limit=limit)
    except BudgetError as exc:
        raise HTTPException(exc.status_code, exc.code) from None
    except Exception:
        raise HTTPException(503, "workouts_ai_budget_unavailable") from None
