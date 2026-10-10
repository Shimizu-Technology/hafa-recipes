"""Independent JSON consumers based on inspected mobile TypeScript interfaces.

2.6.4 is a source candidate, not a verified mapping to a distributed binary.
These models deliberately ignore additive fields, as the JavaScript client does,
but require the existing keys and types. Keep these separate from app models:
otherwise a breaking server edit could update both sides of the assertion.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class Consumer(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)


class Ingredient264(Consumer):
    name: str
    quantity: str | None
    unit: str | None


class Component264(Consumer):
    name: str
    ingredients: list[Ingredient264]
    steps: list[str]


class Times264(Consumer):
    prep: str | None
    cook: str | None
    total: str | None


class NutritionValues264(Consumer):
    calories: int | float | None
    protein: int | float | None
    carbs: int | float | None
    fat: int | float | None
    fiber: int | float | None
    sugar: int | float | None
    sodium: int | float | None


class Nutrition264(Consumer):
    perServing: NutritionValues264
    total: NutritionValues264


class Media264(Consumer):
    thumbnail: str | None


class Extracted264(Consumer):
    title: str
    sourceUrl: str
    servings: int | float | None
    times: Times264
    components: list[Component264]
    ingredients: list[Ingredient264]
    steps: list[str]
    equipment: list[str] | None
    tags: list[str]
    media: Media264
    totalEstimatedCost: int | float | None
    costLocation: str
    nutrition: Nutrition264


class Recipe264(Consumer):
    id: str
    source_url: str
    source_type: str
    extracted: Extracted264
    thumbnail_url: str | None
    extraction_method: str | None
    extraction_quality: str | None
    has_audio_transcript: bool
    created_at: str
    user_id: str | None
    extractor_display_name: str | None
    is_public: bool


class Recipe2611(Recipe264):
    thumbnail_pending: bool = False
    thumbnail_pending_until: str | None = None
    review_state: Literal["source_incomplete", "needs_review", "ready"] | None = None
    content_revision: int | None = None


class ListItem264(Consumer):
    id: str
    title: str
    source_url: str
    source_type: str
    thumbnail_url: str | None
    extraction_quality: str | None
    has_audio_transcript: bool
    tags: list[str]
    servings: int | float | None
    total_time: str | None
    created_at: str
    user_id: str | None
    extractor_display_name: str | None
    is_public: bool


class Page264(Consumer):
    items: list[ListItem264]
    total: int
    limit: int
    offset: int
    has_more: bool


class Job264(Consumer):
    id: str
    url: str
    status: Literal[
        "queued", "claimed", "processing", "completed", "failed", "cancelled", "expired"
    ]
    progress: int
    current_step: str
    message: str
    recipe_id: str | None
    error_message: str | None


class Job2611(Job264):
    job_kind: Literal["extract", "reextract"] = "extract"
    requested_is_public: bool = False
    can_save_draft: bool = False
    error_code: str | None = None
    review_state: Literal["source_incomplete", "needs_review", "ready"] | None = None


class WidgetList264(Consumer):
    id: str
    name: str
    is_shared: bool
    revision: int
    created_at: str
    updated_at: str


class WidgetItem264(Consumer):
    id: str
    name: str
    quantity: str | None
    unit: str | None
    notes: str | None
    checked: bool
    recipe_id: str | None
    recipe_title: str | None
    added_by_name: str | None
    created_at: str
    updated_at: str


class WidgetSnapshot264(Consumer):
    account_scope_id: str
    list: WidgetList264
    items: list[WidgetItem264]
    total: int
    unchecked: int
    checked: int
    server_time: str
