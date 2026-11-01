"""Search over all owner/generation records, including retained source contents."""

from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.orm import aliased

from app.domains.baby.models import BabyRecord


def records_query(
    owner, generation, *, kind=None, child_id=None, q=None, record_ids=None,
    topic=None,
    uncategorized=False,
):
    query = select(BabyRecord).where(
        BabyRecord.app_user_id == owner,
        BabyRecord.generation == generation,
        BabyRecord.deleted_at.is_(None),
    )
    if uncategorized:
        collection = aliased(BabyRecord)
        membership = (
            select(collection.id).where(
                collection.app_user_id == owner,
                collection.generation == generation,
                collection.deleted_at.is_(None),
                collection.kind == "collection",
                collection.data["record_ids"].contains(
                    # Correlate across complete history instead of a recent cache.
                    func.jsonb_build_array(cast(BabyRecord.id, String))
                ),
            ).exists()
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
        query = query.where(
            or_(
                BabyRecord.title.ilike(term, escape="\\"),
                BabyRecord.body.ilike(term, escape="\\"),
                cast(BabyRecord.data, String).ilike(term, escape="\\"),
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
