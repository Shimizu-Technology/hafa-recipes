"""Opt-in durable receipts; ordinary snapshot201/legacy exports remain intact."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.domains.workouts.export_job_schemas import ExportJobReceipt, ExportJobRequest
from app.domains.workouts.export_job_worker import export_job_worker
from app.domains.workouts.router import Generation, User
from app.domains.workouts.security import WorkoutsRoute


class ExportJobRoute(WorkoutsRoute):
    max_body_bytes = 4096

    def get_route_handler(self):
        original = super().get_route_handler()

        async def guarded(request: Request):
            settings = get_settings()
            if not settings.workouts_api_enabled or not settings.workouts_export_jobs_enabled:
                raise HTTPException(404, "Not found")
            try:
                return await original(request)
            except (SQLAlchemyError, RuntimeError):
                raise HTTPException(503, "export_jobs_unavailable") from None

        return guarded


router = APIRouter(
    prefix="/api/v1/workouts/export/jobs", tags=["workouts-export"], route_class=ExportJobRoute
)
coordinator = export_job_worker.coordinator


@router.post("", response_model=ExportJobReceipt, status_code=202)
async def enqueue_export(body: ExportJobRequest, user: User, generation: Generation):
    receipt = await coordinator.admit(user, generation, body.request_id)
    export_job_worker.notify()
    return receipt


@router.get("/by-request/{request_id}", response_model=ExportJobReceipt)
async def find_export(request_id: UUID, user: User, generation: Generation):
    return await coordinator.receipt(user, generation, request_id=request_id)


@router.get("/{job_id}", response_model=ExportJobReceipt)
async def get_export(job_id: UUID, user: User, generation: Generation):
    return await coordinator.receipt(user, generation, job_id)


@router.post("/{job_id}/cancel", response_model=ExportJobReceipt)
async def cancel_export(job_id: UUID, user: User, generation: Generation):
    receipt = await coordinator.cancel(user, generation, job_id)
    export_job_worker.cancel_job(job_id)
    return receipt
