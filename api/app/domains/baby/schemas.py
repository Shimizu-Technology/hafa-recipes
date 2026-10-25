"""Bounded, explicit wire schemas; source claims never become care instructions."""

from datetime import date
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)

# Matches the mobile source kind label; keep API capture and processing defaults together.
DEFAULT_SOURCE_TITLE = "Saved source"

Kind = Literal[
    "source", "journal", "feeding", "sleep", "diaper", "routine", "question", "collection"
]
Revision = Annotated[int, Field(strict=True, ge=1, le=2_147_483_647)]


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Profile(DomainModel):
    display_name: str = Field(default="", max_length=120)
    timezone: str = Field(default="Pacific/Guam", max_length=80)
    ai_consent: StrictBool = False
    auto_process_shares: StrictBool = False
    auto_process_epoch: Annotated[int, Field(strict=True, ge=0)] = 0

    @field_validator("timezone")
    @classmethod
    def timezone_known(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Choose a valid timezone") from None
        return value


class ProfilePatch(DomainModel):
    display_name: str | None = Field(default=None, max_length=120)
    timezone: str | None = Field(default=None, max_length=80)
    ai_consent: StrictBool | None = None
    auto_process_shares: StrictBool | None = None


class ChildCreate(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=120)
    birth_date: date | None = None
    due_date: date | None = None

    @field_validator("name")
    @classmethod
    def meaningful_name(cls, value):
        if not value.strip():
            raise ValueError("Enter a name")
        return value.strip()


class ChildPatch(DomainModel):
    revision: Revision
    name: str | None = Field(default=None, min_length=1, max_length=120)
    birth_date: date | None = None
    due_date: date | None = None


class Evidence(DomainModel):
    location: str = Field(min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=12000)


class SourceData(DomainModel):
    url: str | None = Field(default=None, max_length=2000)
    topics: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(
        default_factory=list, max_length=30
    )
    source_text: str | None = Field(default=None, max_length=100000)
    summary: str | None = Field(default=None, max_length=12000)
    key_points: list[Annotated[str, Field(min_length=1, max_length=600)]] = Field(
        default_factory=list, max_length=12, exclude_if=lambda value: not value
    )
    steps: list[Annotated[str, Field(min_length=1, max_length=600)]] = Field(
        default_factory=list, max_length=30, exclude_if=lambda value: not value
    )
    # Omit empty additions on the wire to preserve pre-upgrade creation hashes.
    creator: str | None = Field(
        default=None, max_length=240, exclude_if=lambda value: value is None
    )
    platform: str | None = Field(
        default=None, max_length=80, exclude_if=lambda value: value is None
    )
    thumbnail_url: str | None = Field(
        default=None, max_length=2000, exclude_if=lambda value: value is None
    )
    evidence: list[Evidence] = Field(default_factory=list, max_length=100)
    status: (
        Literal["saved", "queued", "processing", "ready", "incomplete", "failed", "cancelled"]
        | None
    ) = None
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=8)
    coverage_notes: list[Annotated[str, Field(max_length=300)]] = Field(
        default_factory=list, max_length=30
    )

    @field_validator("thumbnail_url")
    @classmethod
    def public_thumbnail(cls, value):
        if value is None:
            return value
        import ipaddress

        cls.public_scheme(value)
        hostname = urlsplit(value).hostname.lower().rstrip(".")
        if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(
            (".local", ".internal", ".localhost")
        ):
            raise ValueError("Use a public thumbnail URL")
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            address = None
        if address is not None and not address.is_global:
            raise ValueError("Use a public thumbnail URL")
        return value

    @field_validator("url")
    @classmethod
    def public_scheme(cls, value):
        if value is None:
            return value
        parts = urlsplit(value)
        if (
            parts.scheme not in {"https", "http"}
            or not parts.hostname
            or parts.username
            or parts.password
        ):
            raise ValueError("Use a public http or https URL")
        return value


class FeedingData(DomainModel):
    method: Literal["breast", "bottle", "other"]
    amount: float | None = Field(default=None, ge=0, le=10000)
    unit: Literal["ml", "oz"] | None = None
    side: Literal["left", "right", "both"] | None = None
    duration_minutes: float | None = Field(default=None, ge=0, le=1440)

    @model_validator(mode="after")
    def amount_requires_unit(self):
        if self.amount is not None and self.unit is None:
            raise ValueError("Choose a unit for the amount")
        return self


class SleepData(DomainModel):
    end_at: AwareDatetime | None = None


class DiaperData(DomainModel):
    type: Literal["wet", "dirty", "both", "dry"]


class RoutineItem(DomainModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=500)
    done: StrictBool = False


class RoutineData(DomainModel):
    routine_type: Literal["checklist", "schedule"]
    items: list[RoutineItem] = Field(default_factory=list, max_length=200)
    reminder_at: AwareDatetime | None = None
    timezone: str | None = Field(default=None, max_length=80)
    repeat: Literal["none", "daily", "weekly"] = "none"
    enabled: StrictBool = False

    @model_validator(mode="after")
    def valid_reminder(self):
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("Checklist item IDs must be unique")
        if self.timezone:
            Profile.timezone_known(self.timezone)
        if self.enabled and (not self.reminder_at or not self.timezone):
            raise ValueError("An enabled reminder needs a time and timezone")
        return self


class JournalData(DomainModel):
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=20)
    provenance: Literal["caregiver_observation", "clinician_instruction"] = "caregiver_observation"


class CollectionData(DomainModel):
    record_ids: list[UUID] = Field(default_factory=list, max_length=500)


DATA_MODELS = {
    "source": SourceData,
    "feeding": FeedingData,
    "sleep": SleepData,
    "diaper": DiaperData,
    "routine": RoutineData,
    "journal": JournalData,
    "question": JournalData,
    "collection": CollectionData,
}


class RecordCreate(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    kind: Kind
    title: str = Field(min_length=1, max_length=240)
    body: str = Field(default="", max_length=100000)
    child_id: UUID | None = None
    occurred_at: AwareDatetime
    data: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_content(self):
        self.data = DATA_MODELS[self.kind].model_validate(self.data).model_dump(mode="json")
        if not self.title.strip():
            raise ValueError("Enter a title")
        if self.kind == "sleep" and self.data.get("end_at"):
            if SleepData.model_validate(self.data).end_at < self.occurred_at:
                raise ValueError("Sleep cannot end before it starts")
        return self


class RecordPatch(DomainModel):
    revision: Revision
    title: str | None = Field(default=None, min_length=1, max_length=240)
    body: str | None = Field(default=None, max_length=100000)
    child_id: UUID | None = None
    occurred_at: AwareDatetime | None = None
    data: dict | None = None


class ImportCreate(DomainModel):
    automatic: StrictBool = False
    automatic_epoch: Annotated[int, Field(strict=True, ge=0)] = 0
    record_id: UUID | None = None
    id: UUID
    url: str | None = Field(default=None, max_length=2000)
    text: str | None = Field(default=None, max_length=30000)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=8)
    child_id: UUID | None = None
    topics: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(
        default_factory=list, max_length=30
    )

    @model_validator(mode="after")
    def needs_source(self):
        if not (
            self.record_id or self.url or (self.text and self.text.strip()) or self.attachment_ids
        ):
            raise ValueError("Add a link, text, or attachment")
        SourceData.public_scheme(self.url)
        return self


class ChatRequest(DomainModel):
    conversation_id: UUID | None = None
    request_id: UUID = Field(default_factory=uuid4)
    message: str = Field(min_length=1, max_length=4000)
    scope: Literal["all", "library", "journal", "care"] = "all"
    record_id: UUID | None = None
    child_id: UUID | None = None

    @field_validator("message")
    @classmethod
    def meaningful_message(cls, value):
        if not value.strip():
            raise ValueError("Enter a message")
        return value.strip()
