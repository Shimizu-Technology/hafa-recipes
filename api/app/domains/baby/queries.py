"""Search over all owner/generation records, including retained source contents."""

from sqlalchemy import String, and_, case, cast, func, or_, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.orm import aliased

from app.domains.baby.models import BabyRecord


def legacy_client(client):
    """Build 32 sends no client header, and cannot read or write what it does not know."""
    if client == "3":
        from app.domains.baby.access import family_enabled

        return not family_enabled()
    return client != "2"


# Past 44 weeks without a birth date the due date is stale, not late pregnancy.
LATEST_PREGNANCY_DAYS = 44 * 7 + 6


def child_timing(child, today):
    """Where a child is today, or None when its dates cannot say."""
    if child.birth_date is not None and child.birth_date <= today:
        return {"stage": "baby", "baby_age_weeks": min((today - child.birth_date).days // 7, 520)}
    if child.due_date is None:
        return None
    # Gestational age counts 280 days to the due date; weeks are completed weeks.
    days = 280 - (child.due_date - today).days
    if days > LATEST_PREGNANCY_DAYS:
        return None
    days = max(0, days)
    return {"stage": "pregnancy", "pregnancy_week": days // 7, "pregnancy_day": days % 7}


def row_scope(model, owner, generation):
    if hasattr(owner, "condition"):
        return owner.condition(model)
    return and_(model.app_user_id == owner, model.generation == generation)


def records_query(
    owner,
    generation,
    *,
    kind=None,
    child_id=None,
    q=None,
    record_ids=None,
    topic=None,
    uncategorized=False,
):
    query = select(BabyRecord).where(
        row_scope(BabyRecord, owner, generation),
        BabyRecord.deleted_at.is_(None),
    )
    if uncategorized:
        collection = aliased(BabyRecord)
        membership = (
            select(collection.id)
            .where(
                row_scope(collection, owner, generation),
                (collection.space_id == BabyRecord.space_id)
                if getattr(owner, "enabled", False)
                else True,
                collection.deleted_at.is_(None),
                collection.kind == "collection",
                collection.data["record_ids"].contains(
                    # Correlate across complete history instead of a recent cache.
                    func.jsonb_build_array(cast(BabyRecord.id, String))
                ),
            )
            .exists()
        )
        query = query.where(BabyRecord.kind == "source", ~membership)
    if record_ids is not None:
        query = query.where(BabyRecord.id.in_(record_ids))
    if topic is not None:
        query = query.where(
            BabyRecord.kind == "source", BabyRecord.data["topics"].contains([topic])
        )
    if kind:
        query = query.where(BabyRecord.kind == kind)
    if child_id:
        query = query.where(BabyRecord.child_id == child_id)
    if q and q.strip():
        escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        term = f"%{escaped}%"
        body, data = BabyRecord.body, BabyRecord.data
        caregivers = [grant.id for grant in owner.spaces if grant.role == "caregiver"] if getattr(owner, "enabled", False) else []
        if caregivers:
            from app.domains.baby.access import VISIT_PRIVATE_FIELDS, VISIT_SIGNAL_FIELDS

            # Search only the content this reader may see, including totals and pagination.
            medical = or_(BabyRecord.data["category"].as_string() == "appointment",
                BabyRecord.data["medical_visit"].as_boolean().is_(True),
                *(BabyRecord.data[key].as_string().is_not(None) for key in VISIT_SIGNAL_FIELDS)).is_(True)
            private = and_(BabyRecord.kind == "event", BabyRecord.space_id.in_(caregivers), medical)
            body = case((private, ""), else_=body)
            data = case((private, data.op("-")(array(sorted(VISIT_PRIVATE_FIELDS)))), else_=data)
        query = query.where(
            or_(
                BabyRecord.title.ilike(term, escape="\\"),
                body.ilike(term, escape="\\"),
                cast(data, String).ilike(term, escape="\\"),
            )
        )
    return query


def timing_bounds(stage):
    """Stated relevance bounds for the stage the parent is in (pregnancy or baby)."""
    relevance = BabyRecord.data["relevance"]
    stated = BabyRecord.data[("relevance", "stage")].as_string()
    if stage == "pregnancy":
        low, high = "pregnancy_week_min", "pregnancy_week_max"
        stages = ("pregnancy",)
    else:
        low, high = "baby_age_min_weeks", "baby_age_max_weeks"
        stages = ("postpartum", "baby")
    low = BabyRecord.data[("relevance", low)].as_integer()
    high = BabyRecord.data[("relevance", high)].as_integer()
    in_stage = and_(
        relevance.is_not(None),
        or_(stated.in_(stages), low.is_not(None), high.is_not(None)),
    )
    return in_stage, low, high


def timing_filter(timing, stage, value, *, within_weeks=None):
    """Inclusive ranges; an open bound has no start or end.

    ``now`` matches a range containing ``value`` (or a stated stage without
    weeks); ``upcoming`` matches ranges that start after ``value``.
    """
    in_stage, low, high = timing_bounds(stage)
    if timing == "now":
        return and_(
            BabyRecord.kind == "source",
            in_stage,
            or_(low.is_(None), low <= value),
            or_(high.is_(None), high >= value),
        )
    condition = and_(BabyRecord.kind == "source", in_stage, low > value)
    if within_weeks is not None:
        condition = and_(condition, low <= value + within_weeks)
    return condition


def stage_filter(stage):
    return and_(
        BabyRecord.kind == "source",
        BabyRecord.data[("relevance", "stage")].as_string() == stage,
    )
