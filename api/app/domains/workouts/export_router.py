"""Authenticated private exports; temporary pages never enter public sharing."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Path, Response

from app.domains.workouts.export_response_gate import ExportReadRoute
from app.domains.workouts.export_service import (
    ExportManifest,
    ExportSnapshotPage,
    PrivateExportService,
)
from app.domains.workouts.router import Generation, User
from app.domains.workouts.security import WorkoutsRoute

router = APIRouter(
    prefix="/api/v1/workouts/export/snapshots", tags=["workouts-export"], route_class=WorkoutsRoute
)
read_router = APIRouter(
    prefix="/api/v1/workouts/export/snapshots",
    tags=["workouts-export"],
    route_class=ExportReadRoute,
)
private_exports = PrivateExportService()


@router.post("", response_model=ExportManifest, status_code=201)
async def create_snapshot(user: User, generation: Generation):
    return await private_exports.create(user, generation)


@read_router.get("/{snapshot_id}", response_model=ExportManifest)
async def get_snapshot(snapshot_id: UUID, user: User, generation: Generation):
    return await private_exports.read(user, generation, snapshot_id)


@read_router.get("/{snapshot_id}/pages/{page}", response_model=ExportSnapshotPage)
async def get_snapshot_page(
    snapshot_id: UUID, page: Annotated[int, Path(ge=0, lt=512)], user: User, generation: Generation
):
    return await private_exports.read(user, generation, snapshot_id, page=page)


@router.delete("/{snapshot_id}", status_code=204)
async def remove_snapshot(snapshot_id: UUID, user: User, generation: Generation):
    await private_exports.remove(user, generation, snapshot_id)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
