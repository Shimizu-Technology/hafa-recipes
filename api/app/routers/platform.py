"""Public product discovery without identity, database, or health data."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings

router = APIRouter(prefix="/api/v1/platform", tags=["platform"])


class ProductInfo(BaseModel):
    id: Literal["recipes", "workouts"]
    name: str
    api_path: str
    available: bool
    website_url: str | None = None
    ios_store_url: str | None = None


class PlatformInfo(BaseModel):
    name: str = "Håfa"
    schema_version: Literal[1] = 1
    products: list[ProductInfo]


@router.get("", response_model=PlatformInfo)
async def platform_info() -> PlatformInfo:
    """Describe available products; internal tester access is never disclosed."""
    settings = get_settings()
    return PlatformInfo(
        products=[
            ProductInfo(
                id="recipes",
                name="Håfa Recipes",
                api_path="/api/recipes",
                available=True,
                website_url="https://hafa-recipes.com",
                ios_store_url="https://apps.apple.com/app/id6755892896",
            ),
            ProductInfo(
                id="workouts",
                name="Håfa Workouts",
                api_path="/api/v1/workouts",
                available=settings.workouts_api_enabled and settings.workouts_public_access_enabled,
            ),
        ]
    )
