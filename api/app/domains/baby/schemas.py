"""Bounded, explicit wire schemas; source claims never become care instructions."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal, get_args
from urllib.parse import urlsplit
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    StrictBool,
    field_validator,
    model_serializer,
    model_validator,
)

from app.domains.baby.feeds import instant, reduce_feed, with_derived
from app.domains.baby.recurrence import falls_on, is_start
from app.domains.baby.sessions import with_session

# Matches the mobile source kind label; keep API capture and processing defaults together.
DEFAULT_SOURCE_TITLE = "Saved source"

Kind = Literal[
    "source", "journal", "feeding", "sleep", "diaper", "routine", "question", "collection",
    "event", "contraction", "kick_session", "pumping", "medicine", "temperature", "growth",
    "milestone", "custom",
]
# Writable only after migration 055 widens ck_baby_record_kind, and never by an older client.
NEW_KINDS = (
    "event", "contraction", "kick_session", "pumping", "medicine", "temperature", "growth",
    "milestone", "custom",
)
V1_KINDS = tuple(kind for kind in get_args(Kind) if kind not in NEW_KINDS)
Revision = Annotated[int, Field(strict=True, ge=1, le=2_147_483_647)]


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Profile(DomainModel):
    # Read back from stored JSON, so a release rolled back to must still open what a later one saved.
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    family_disclosures: list[dict] = Field(default_factory=list, exclude_if=lambda value: not value)
    # The F10 gate's own notes: which installations reported from a family-capable build, when this
    # account was last seen on an older one, and when she said that phone is updated or gone.
    family_phones: dict[str, str] = Field(default_factory=dict, exclude_if=lambda value: not value)
    older_client_at: str | None = Field(default=None, exclude_if=lambda value: value is None)
    older_client_confirmed_at: str | None = Field(default=None, exclude_if=lambda value: value is None)
    display_name: str = Field(default="", max_length=120)
    timezone: str = Field(default="Pacific/Guam", max_length=80)
    ai_consent: StrictBool = False
    auto_process_shares: StrictBool = False
    auto_process_epoch: Annotated[int, Field(strict=True, ge=0)] = 0
    # Which disclosure this person acknowledged. Only the acknowledgment below raises it.
    ai_consent_version: Annotated[int, Field(strict=True, ge=0)] = 0

    @field_validator("timezone")
    @classmethod
    def timezone_known(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Choose a valid timezone") from None
        return value


# Stored with the profile and never sent back: a client that saves what it read can't touch them.
SERVER_PROFILE_FIELDS = {"family_disclosures", "family_phones", "older_client_at", "older_client_confirmed_at"}


class ProfilePatch(DomainModel):
    family_disclosures: object = Field(default=None, exclude=True)
    auto_process_epoch: object = Field(default=None, exclude=True)
    display_name: str | None = Field(default=None, max_length=120)
    timezone: str | None = Field(default=None, max_length=80)
    ai_consent: StrictBool | None = None
    auto_process_shares: StrictBool | None = None
    # Apps send their whole cached profile back, so this field never changes anything.
    ai_consent_version: Annotated[int, Field(strict=True, ge=0)] | None = None
    acknowledge_ai_consent_version: Annotated[int, Field(strict=True, ge=1)] | None = None


TrackerId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
MAX_TRACKERS = 40


class ChildDetails(BaseModel):
    """Optional setup answers. Unknown keys are ignored, so a newer client can't fail an older API."""

    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    sex: Literal["girl", "boy"] | None = None
    weight_at_birth_g: int | None = Field(default=None, strict=True, ge=100, le=10000)
    length_at_birth_cm: float | None = Field(default=None, strict=True, ge=15, le=80)
    weeks_at_birth: int | None = Field(default=None, strict=True, ge=20, le=45)
    feeding: Literal["nursing", "bottle", "both"] | None = None
    tracking: dict[TrackerId, StrictBool] | None = Field(default=None, max_length=MAX_TRACKERS)

    @field_validator("length_at_birth_cm")
    @classmethod
    def one_decimal(cls, value):
        return None if value is None else round(value, 1)


class ChildCreate(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=120)
    birth_date: date | None = None
    due_date: date | None = None
    # Checked by clean_child_details, so a bad value gets its own plain-word answer.
    details: dict | None = None

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
    details: dict | None = None


class Evidence(DomainModel):
    location: str = Field(min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=12000)


PregnancyWeek = Annotated[int, Field(strict=True, ge=0, le=45)]
AgeWeeks = Annotated[int, Field(strict=True, ge=0, le=520)]
Stage = Literal["pregnancy", "postpartum", "baby"]


class SourceRelevance(DomainModel):
    """When a saved tip applies, only as the source states it. Unknowns stay null.

    An open bound (null min or max) means the source gave no start or end.
    Baby age is stored in weeks; ``baby_age_unit`` records how it was stated.
    """

    stage: Stage | None = None
    pregnancy_week_min: PregnancyWeek | None = None
    pregnancy_week_max: PregnancyWeek | None = None
    baby_age_min_weeks: AgeWeeks | None = None
    baby_age_max_weeks: AgeWeeks | None = None
    baby_age_unit: Literal["weeks", "months"] | None = None
    quote: str | None = Field(default=None, max_length=300)
    origin: Literal["source", "user"] = "source"

    @model_validator(mode="after")
    def ordered_ranges(self):
        for low, high in (
            (self.pregnancy_week_min, self.pregnancy_week_max),
            (self.baby_age_min_weeks, self.baby_age_max_weeks),
        ):
            if low is not None and high is not None and low > high:
                raise ValueError("A timing range must start before it ends")
        return self

    @property
    def empty(self):
        return all(
            value is None
            for value in (
                self.stage,
                self.pregnancy_week_min,
                self.pregnancy_week_max,
                self.baby_age_min_weeks,
                self.baby_age_max_weeks,
            )
        )


class CategorySuggestion(DomainModel):
    """An AI-proposed category. It is never applied until the user accepts it."""

    name: str = Field(min_length=1, max_length=80)
    collection_id: UUID | None = None
    confidence: float = Field(ge=0, le=1)
    status: Literal["pending", "accepted", "dismissed"] = "pending"

    @field_validator("name")
    @classmethod
    def meaningful_name(cls, value):
        if not value.strip():
            raise ValueError("Enter a category name")
        return value.strip()


class SourceData(DomainModel):
    just_me: StrictBool = Field(default=False, exclude_if=lambda value: not value)
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
    relevance: SourceRelevance | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    suggested_category: CategorySuggestion | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def drop_empty_relevance(self):
        # Empty user timing is kept: it records that the parent cleared it.
        if self.relevance is not None and self.relevance.empty and self.relevance.origin != "user":
            self.relevance = None
        return self

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


class FeedAction(DomainModel):
    id: UUID
    action: Literal["start", "switch", "finish"]
    at: AwareDatetime
    side: Literal["left", "right"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    # The revision this tap produced, set by the API. A retry after a lost response can't be told
    # from the row alone, so this is how a phone knows which of its waiting edits to move on.
    revision: int | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def side_matches_action(self):
        if (self.action == "finish") != (self.side is None):
            raise ValueError("Start and switch name a side; finish does not")
        # A phone with a wrong clock must not hold "newest start" for a child far ahead.
        if self.at > datetime.now(UTC) + timedelta(days=1):
            raise ValueError("Check this phone's date and time")
        return self


class FeedActionRequest(FeedAction):
    id: UUID = Field(validation_alias="action_id")


class FeedingData(DomainModel):
    method: Literal["breast", "bottle", "other"]
    amount: float | None = Field(default=None, ge=0, le=10000)
    unit: Literal["ml", "oz"] | None = None
    side: Literal["left", "right", "both"] | None = None
    duration_minutes: float | None = Field(default=None, ge=0, le=1440)
    # Omit empty additions on the wire to preserve pre-upgrade creation hashes.
    state: Literal["running", "finished", "unknown_end"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    actions: list[FeedAction] = Field(
        default_factory=list, max_length=100, exclude_if=lambda value: not value
    )
    end_at: AwareDatetime | None = Field(default=None, exclude_if=lambda value: value is None)
    contents: Literal["breast_milk", "formula"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def amount_requires_unit(self):
        if self.amount is not None and self.unit is None:
            raise ValueError("Choose a unit for the amount")
        # A retried tap is one action, but one id can't mean two different taps.
        actions = {}
        for action in self.actions:
            prior = actions.setdefault(action.id, action)
            if (prior.action, prior.side, prior.at) != (action.action, action.side, action.at):
                raise ValueError("One feed action id was used for two different actions")
        self.actions = list(actions.values())
        # An older client can change the method while it keeps fields it never saw.
        if self.method != "breast":
            self.state, self.actions, self.end_at = None, [], None
        if self.method != "bottle":
            self.contents = None
        return self


class SleepData(DomainModel):
    end_at: AwareDatetime | None = None


class DiaperData(DomainModel):
    type: Literal["wet", "dirty", "both", "dry"]
    color: Literal["black", "green", "yellow", "brown", "red", "white"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def color_needs_poo(self):
        # An older client can change the type while it keeps the color it never saw.
        if self.type not in {"dirty", "both"}:
            self.color = None
        return self


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
    just_me: StrictBool = Field(default=False, exclude_if=lambda value: not value)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=20)
    provenance: Literal["caregiver_observation", "clinician_instruction"] = "caregiver_observation"
    # A question for a visit, or a note after it. Checked against the owner's events on save.
    event_id: UUID | None = Field(default=None, exclude_if=lambda value: value is None)


class CollectionData(DomainModel):
    just_me: StrictBool = Field(default=False, exclude_if=lambda value: not value)
    record_ids: list[UUID] = Field(default_factory=list, max_length=500)


Label = Annotated[str, Field(min_length=1, max_length=120)]


EventCategory = Literal["appointment", "family", "celebration", "milestone", "reminder", "other"]
# Outside these years a date is a typo, and calendar maths would overflow.
EVENT_YEARS = range(2000, 2101)
MAX_EVENT_DAYS = 366
MAX_CATEGORY_LABEL = 60


def labels(values):
    """Trimmed, non-blank and distinct ignoring case, in the order given."""
    if values is None:
        return None
    cleaned = [value.strip() for value in values]
    if not all(cleaned) or len({value.casefold() for value in cleaned}) != len(cleaned):
        raise ValueError("Each name must be filled in once")
    return cleaned


def trimmed_label(value):
    """Before the length is checked, since that's what's kept. Blank means none."""
    return value.strip() or None if isinstance(value, str) else value


class EventRecurrence(DomainModel):
    frequency: Literal["daily", "weekly", "monthly", "yearly"]
    interval: Annotated[int, Field(strict=True, ge=1, le=99)] = 1
    # The last day, on the event's own calendar, that an occurrence can start.
    until: date | None = None
    # Where the count starts when that's earlier than this event, as for a series split off another.
    anchor: date | None = Field(default=None, exclude_if=lambda value: value is None)

    @field_validator("until", "anchor")
    @classmethod
    def sensible_until(cls, value):
        if value is not None and value.year not in EVENT_YEARS:
            raise ValueError("Choose an end date between 2000 and 2100")
        return value


class EventOverrides(DomainModel):
    """What one occurrence changes. A new ``all_day`` needs a new ``start``.

    A field left out keeps the series' value. Null clears an ``end``, ``category``, ``category_label`` or ``location``;
    the others always have a value, so null is refused (clear ``attendees`` with an empty list).
    """

    start: AwareDatetime | None = None
    end: AwareDatetime | None = None
    all_day: StrictBool | None = None
    title: str | None = Field(default=None, min_length=1, max_length=240)
    category: EventCategory | None = None
    category_label: str | None = Field(default=None, max_length=MAX_CATEGORY_LABEL)
    location: str | None = Field(default=None, max_length=240)
    attendees: list[Label] | None = Field(default=None, max_length=30)

    @field_validator("start", "all_day", "title", "attendees", mode="before")
    @classmethod
    def not_cleared(cls, value):
        if value is None:
            raise ValueError("Give a value, or leave this out to keep the series' own")
        return value

    @field_validator("title")
    @classmethod
    def meaningful_title(cls, value):
        if not value.strip():
            raise ValueError("Enter a title")
        return value.strip()

    @field_validator("location")
    @classmethod
    def trimmed_location(cls, value):
        return value and value.strip()

    @field_validator("category_label", mode="before")
    @classmethod
    def trimmed_label(cls, value):
        return trimmed_label(value)

    @field_validator("attendees")
    @classmethod
    def distinct_attendees(cls, value):
        return labels(value)

    @model_validator(mode="after")
    def changes_something(self):
        if not self.model_fields_set:
            raise ValueError("Change something, or cancel this occurrence")
        if self.all_day is not None and self.start is None:
            raise ValueError("Choose a new start when changing all-day")
        return self

    @model_serializer(mode="wrap")
    def only_what_was_said(self, handler: SerializerFunctionWrapHandler):
        # Stored as given: a field left out and a field set to null mean different things.
        return {key: value for key, value in handler(self).items() if key in self.model_fields_set}


class EventException(DomainModel):
    original_start: AwareDatetime
    cancelled: StrictBool = False
    overrides: EventOverrides | None = None

    @model_validator(mode="after")
    def one_change(self):
        if self.cancelled == (self.overrides is not None):
            raise ValueError("Cancel this occurrence or change it")
        return self


class EventData(DomainModel):
    """``occurred_at`` is the start, and a missing ``child_id`` is the whole family.

    An all-day event starts at midnight on its own calendar, and its ``end`` (when there is
    one) is the midnight after its last day. Other ends are the moment it finishes.
    """

    end: AwareDatetime | None = None
    all_day: StrictBool = False
    timezone: str = Field(max_length=80)
    category: EventCategory | None = None
    # Her own name for the kind of event, typed once. Only a category of "other" or none shows it, so an older
    # build that changes the category changes what shows. Omitted when empty, as reminder_minutes is.
    category_label: str | None = Field(default=None, max_length=MAX_CATEGORY_LABEL, exclude_if=lambda value: value is None)
    location: str | None = Field(default=None, max_length=240)
    attendees: list[Label] = Field(default_factory=list, max_length=30)
    recurrence: EventRecurrence | None = None
    exceptions: list[EventException] = Field(default_factory=list, max_length=200)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=20)
    # Minutes before the start; for an all-day event, before 9 AM on its first day. Up to 4 weeks.
    # Omitted when empty, so a retried save of an older event keeps its creation hash.
    reminder_minutes: list[Annotated[int, Field(strict=True, ge=0, le=40320)]] = Field(
        default_factory=list, max_length=5, exclude_if=lambda value: not value
    )

    @field_validator("location")
    @classmethod
    def trimmed_location(cls, value):
        return value.strip() or None if value is not None else None

    @field_validator("category_label", mode="before")
    @classmethod
    def trimmed_label(cls, value):
        return trimmed_label(value)

    @field_validator("attendees")
    @classmethod
    def distinct_attendees(cls, value):
        return labels(value)

    @field_validator("reminder_minutes")
    @classmethod
    def distinct_reminders(cls, value):
        return sorted(set(value))

    @model_validator(mode="after")
    def valid_event(self):
        Profile.timezone_known(self.timezone)
        starts = [item.original_start for item in self.exceptions]
        if len(set(starts)) != len(starts):
            raise ValueError("Each occurrence can have one change")
        return self

    @property
    def rule(self):
        """(frequency, interval, until, anchor) for the repeat maths, or None."""
        repeat = self.recurrence
        return repeat and (repeat.frequency, repeat.interval, repeat.until, repeat.anchor)

    def without_orphans(self, start):
        """Drop the changes to dates this event no longer has, as when its start or repeat moves."""
        zone = ZoneInfo(self.timezone)
        self.exceptions = [
            item for item in self.exceptions
            if self.rule and is_start(start, zone, self.rule, item.original_start)
        ]
        return self

    def check_times(self, start):
        """The rules that need the start, which lives on the record."""
        if self.exceptions and self.recurrence is None:
            raise ValueError("Only a repeating event has occurrences to change")
        zone = ZoneInfo(self.timezone)
        check_span(start, self.end, self.all_day, zone)
        if self.recurrence and self.recurrence.until:
            if self.recurrence.until < start.astimezone(zone).date():
                raise ValueError("A repeat cannot end before the event starts")
        if self.recurrence and self.recurrence.anchor:
            repeat = self.recurrence
            if not falls_on(repeat.anchor, repeat.frequency, repeat.interval, start.astimezone(zone).date()):
                raise ValueError("The repeat must give the event's own start")
        for item in self.exceptions:
            if item.original_start < start:
                raise ValueError("An occurrence cannot come before the event starts")
            change = item.overrides
            if change is not None and (change.start or change.end):
                all_day = self.all_day if change.all_day is None else change.all_day
                check_span(change.start or item.original_start, change.end, all_day, zone)


def check_span(start, end, all_day, zone):
    if start.astimezone(zone).year not in EVENT_YEARS:
        raise ValueError("Choose a date between 2000 and 2100")
    if all_day and any(
        moment.astimezone(zone).time() != time() for moment in (start, end) if moment
    ):
        raise ValueError("An all-day event starts and ends at midnight")
    if end is not None:
        if end <= start:
            raise ValueError("An event must end after it starts")
        if end - start > timedelta(days=MAX_EVENT_DAYS):
            raise ValueError("An event can last up to a year")


class SessionAction(DomainModel):
    id: UUID
    action: Literal["tap", "undo", "finish"]
    at: AwareDatetime
    target: UUID | None = Field(default=None, exclude_if=lambda value: value is None)
    # As on FeedAction: the revision this action produced, set by the API.
    revision: int | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def target_matches_action(self):
        if (self.action == "undo") != (self.target is not None):
            raise ValueError("An undo names the action it takes back; nothing else names one")
        if self.at > datetime.now(UTC) + timedelta(days=1):
            raise ValueError("Check this phone's date and time")
        return self


class SessionActionRequest(SessionAction):
    id: UUID = Field(validation_alias="action_id")


class ContractionData(DomainModel):
    end_at: AwareDatetime | None = None
    session_actions: list[SessionAction] = Field(
        default_factory=list, max_length=20, exclude_if=lambda value: not value
    )

    @model_validator(mode="after")
    def only_stops(self):
        if any(item.action == "tap" for item in self.session_actions):
            raise ValueError("A contraction has no taps")
        return self


class KickSessionData(DomainModel):
    end_at: AwareDatetime | None = None
    count: Annotated[int, Field(strict=True, ge=0, le=1000)] = 0
    # Bounded by the same number as the count; omitted when empty, so creation hashes don't change.
    session_actions: list[SessionAction] = Field(
        default_factory=list, max_length=1000, exclude_if=lambda value: not value
    )


class PumpingData(DomainModel):
    end_at: AwareDatetime | None = None
    side: Literal["left", "right", "both"] | None = None
    amount: float | None = Field(default=None, ge=0, le=10000)
    unit: Literal["ml", "oz"] | None = None
    duration_minutes: float | None = Field(default=None, ge=0, le=1440)

    @model_validator(mode="after")
    def amount_requires_unit(self):
        if self.amount is not None and self.unit is None:
            raise ValueError("Choose a unit for the amount")
        return self


class MedicineData(DomainModel):
    name: str = Field(min_length=1, max_length=120)
    dose: str | None = Field(default=None, max_length=80)


class TemperatureData(DomainModel):
    value: float = Field(gt=0, le=130)
    unit: Literal["c", "f"]
    method: Literal["armpit", "rectal", "oral", "ear", "forehead", "other"] | None = None


class GrowthData(DomainModel):
    weight: float | None = Field(default=None, gt=0, le=500)
    weight_unit: Literal["kg", "lb"] | None = None
    length: float | None = Field(default=None, gt=0, le=300)
    length_unit: Literal["cm", "in"] | None = None
    head: float | None = Field(default=None, gt=0, le=100)
    head_unit: Literal["cm", "in"] | None = None

    @model_validator(mode="after")
    def measured_with_units(self):
        pairs = (
            (self.weight, self.weight_unit),
            (self.length, self.length_unit),
            (self.head, self.head_unit),
        )
        if all(value is None for value, _ in pairs):
            raise ValueError("Enter a measurement")
        if any(value is not None and unit is None for value, unit in pairs):
            raise ValueError("Choose a unit for each measurement")
        return self


class MilestoneData(DomainModel):
    milestone_id: str | None = Field(default=None, min_length=1, max_length=80)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=20)


class CustomData(DomainModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    value: float | None = Field(default=None, ge=-1000000, le=1000000)
    unit: str | None = Field(default=None, max_length=20)


DATA_MODELS = {
    "source": SourceData,
    "feeding": FeedingData,
    "sleep": SleepData,
    "diaper": DiaperData,
    "routine": RoutineData,
    "journal": JournalData,
    "question": JournalData,
    "collection": CollectionData,
    "event": EventData,
    "contraction": ContractionData,
    "kick_session": KickSessionData,
    "pumping": PumpingData,
    "medicine": MedicineData,
    "temperature": TemperatureData,
    "growth": GrowthData,
    "milestone": MilestoneData,
    "custom": CustomData,
}
# Where each kind that ends later keeps its end. Feeds are absent: clock differences
# between phones can put a finish before a start, and the reducer owns that.
END_FIELDS = {
    "sleep": "end_at", "event": "end", "contraction": "end_at", "kick_session": "end_at",
    "pumping": "end_at",
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
        if self.kind == "feeding" and self.data.get("actions"):
            # A feed's start is its time, so "newest start" can be read from the owner index.
            self.data = with_derived(self.data)
            started = reduce_feed(self.data["actions"])["started_at"]
            if started:
                self.occurred_at = instant(started)
        if self.kind == "event":
            EventData.model_validate(self.data).check_times(self.occurred_at)
        if self.data.get("session_actions"):
            self.data = with_session(self.kind, self.data, self.occurred_at)
        end_field = END_FIELDS.get(self.kind)
        if end_field and self.data.get(end_field):
            # The stored form is JSON; the validated form compares instants across offsets.
            if getattr(DATA_MODELS[self.kind].model_validate(self.data), end_field) < self.occurred_at:
                raise ValueError(f"{self.kind.replace('_', ' ').capitalize()} cannot end before it starts")
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
    # A later release's app sends these. After a rollback they're accepted and answered as an ordinary question.
    ask_v2: StrictBool = False
    focus_date: date | None = None

    @field_validator("message")
    @classmethod
    def meaningful_message(cls, value):
        if not value.strip():
            raise ValueError("Enter a message")
        return value.strip()


class SuggestionDecision(DomainModel):
    revision: Revision
    action: Literal["accept", "dismiss"] = "accept"


class SuggestionItem(DomainModel):
    record_id: UUID
    revision: Revision


class SuggestionBatch(DomainModel):
    action: Literal["accept", "dismiss"] = "accept"
    items: list[SuggestionItem] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def distinct_records(self):
        if len({item.record_id for item in self.items}) != len(self.items):
            raise ValueError("Each source can appear once")
        return self
