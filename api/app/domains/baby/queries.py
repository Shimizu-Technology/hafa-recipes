"""Search over all owner/generation records, including retained source contents."""

from sqlalchemy import String, cast, func, or_, select
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
