"""Search over all owner/generation records, including retained source contents."""

from sqlalchemy import String, cast, or_, select

from app.domains.baby.models import BabyRecord


def records_query(owner, generation, *, kind=None, child_id=None, q=None):
    query = select(BabyRecord).where(
        BabyRecord.app_user_id == owner,
        BabyRecord.generation == generation,
        BabyRecord.deleted_at.is_(None),
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
