"""Private image transport only; storage does not enable model vision."""

import base64
import binascii
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.exceptions import RequestValidationError
from pydantic import Field
from starlette.responses import JSONResponse, Response

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts import coach_attachments as images
from app.domains.workouts.router import Database, Generation, User
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.security import WorkoutsImportRoute, WorkoutsRoute

MAX_ENCODED_BYTES = 4 * ((images.MAX_BYTES + 2) // 3)


class PrivateImageUploadRoute(WorkoutsImportRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            configured = get_settings()
            if not configured.workouts_api_enabled:
                raise HTTPException(404, "Not found")
            if not configured.workouts_ai_enabled or not configured.is_ai_capability_enabled("workout_coach"):
                raise HTTPException(503, "Private coach image uploads are unavailable")
            try:
                return await original(request)
            except RequestValidationError:
                # FastAPI's default error includes invalid input; never echo photos.
                return JSONResponse({"detail": "Choose one supported image up to 2 MiB"},
                                    status_code=422, headers={"Cache-Control": "no-store"})

        return handler


router = APIRouter(prefix="/api/v1/workouts/coach", tags=["workouts"], route_class=WorkoutsRoute)
upload_router = APIRouter(prefix="/api/v1/workouts/coach", tags=["workouts"], route_class=PrivateImageUploadRoute)


class ImageUpload(DomainModel):
    base64_data: str = Field(strict=True, min_length=1, max_length=MAX_ENCODED_BYTES)
    content_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif"]


class ImageReceipt(DomainModel):
    id: UUID
    expires_at: datetime


class ImageRead(DomainModel):
    url: str
    expires_in: int


def attachment_sessions():
    return AsyncSessionLocal


@upload_router.post("/image-uploads/{upload_id}", response_model=ImageReceipt)
async def upload_image(upload_id: UUID, request: ImageUpload, user: User, generation: Generation,
                       sessions: Annotated[object, Depends(attachment_sessions)]):
    try:
        data = base64.b64decode(request.base64_data, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, "Choose one supported image up to 2 MiB") from None
    if len(data) > images.MAX_BYTES:
        raise HTTPException(422, "Choose one supported image up to 2 MiB")
    # upload owns its transactions; don't hold a separate request owner lock here.
    return await images.upload(sessions, user.id, generation, upload_id, data, request.content_type)


@router.get("/images/{attachment_id}", response_model=ImageRead)
async def read_image(attachment_id: UUID, user: User, db: Database, generation: Generation):
    return await images.read_url(db, user.id, generation, attachment_id)


@router.delete("/images/{attachment_id}", status_code=204)
async def delete_image(attachment_id: UUID, user: User, db: Database, generation: Generation):
    await images.retire(db, user.id, generation, attachment_id)
    await db.commit()
    return Response(status_code=204)


@router.delete("/image-uploads/{upload_id}", status_code=204)
async def discard_upload(upload_id: UUID, user: User, db: Database, generation: Generation):
    await images.retire_upload(db, user.id, generation, upload_id)
    await db.commit()
    return Response(status_code=204)
