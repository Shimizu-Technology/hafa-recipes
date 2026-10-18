"""Read-only aggregate admission diagnostics using the existing verified admin gate."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import ClerkUser
from app.config import get_settings
from app.domains.workouts.budget import BudgetError, BudgetGuard, BudgetPolicy
from app.domains.workouts.security import WorkoutsRoute
from app.moderation import require_admin

router = APIRouter(prefix="/api/admin/workouts", tags=["admin-workouts"], route_class=WorkoutsRoute)


@router.get("/ai-budget")
async def ai_budget_diagnostics(
    admin: Annotated[ClerkUser, Depends(require_admin)],
    limit: int = Query(default=50, ge=1, le=50),
):
    del admin
    try:
        settings = get_settings()
        if not settings.workouts_ai_budget_enforced:
            return {"enforced": False, "accounting": "ai_invocations",
                    "historical_admissions_preserved": True}
        result = await BudgetGuard(BudgetPolicy.from_settings(settings)).diagnostics(limit=limit)
        return {**result, "enforced": True}
    except BudgetError as exc:
        raise HTTPException(exc.status_code, exc.code) from None
    except Exception:
        raise HTTPException(503, "workouts_ai_budget_unavailable") from None
