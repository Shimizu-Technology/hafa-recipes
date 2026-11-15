"""Family news: "contractions have started" and "the baby is here", from one parent to the people she picks.

The sender chooses each person, every time, from the members of the baby's family space. Nothing is sent
to anyone outside it, and nothing leaves the app except the push itself, whose lock-screen words are fixed
and generic like every other kind's. Someone she picked who has left the family since is left out and named
back as `skipped`, so the rest are still told. A news row is an ordinary reminder row for its recipient, so
delivery, quiet hours, retries, Today and dismissal all work as they do for the rest. Birth news is refused
(409 not_born) until the birth date is here; the phone keeps it and sends it again once the birth has synced.
Its reason is checked again at every read: labor news stops once the baby is born, and both need the sender
to still be in the family. Either stays on Today for a day at most.

Unlike every other kind, this one is on for a recipient until they turn it off: it only ever comes because a
family member chose to tell them, and a partner who misses "it's time" because of a default has lost it.
"""

from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import func, select

from app.domains.baby.dependencies import Client, Database, User
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyChild,
    BabyMembership,
    BabyNotification,
    BabyPushDevice,
    BabySpaceMember,
)
from app.domains.baby.push import available, load_prefs, quiet_until
from app.domains.baby.reminders import (
    LOCK_SCREEN,
    RESOLVERS,
    Words,
    reminder_access,
    role_in,
    schedule,
)
from app.domains.baby.schemas import DomainModel
from app.domains.baby.security import BabyRoute

KIND = "family_news"
STAYS = {"labor": timedelta(hours=12), "birth": timedelta(hours=24)}
PER_HOUR = 6  # Per sender. "Tell Leon" again is fine; a stuck button isn't.
LOCK_SCREEN[KIND] = "Your family has news in Håfa Baby."

router = APIRouter(route_class=BabyRoute, dependencies=[Depends(available)])


class FamilyNews(DomainModel):
    id: UUID  # Chosen by the phone, so a retried send is the same news.
    news: Literal["labor", "birth"]
    child_id: UUID
    to: list[str] = Field(min_length=1, max_length=20)


async def will_buzz(db, people, moment):
    """Whether each person's phone will show it, and when: a phone signed in with notifications allowed, and the
    news not turned off. "after_quiet_hours" when they've let it wait for quiet hours and it's quiet now, with
    the time it ends in the second map. Nothing else, so the sender learns only what to tell them."""
    phones = set(await db.scalars(select(BabyPushDevice.app_user_id).where(
        BabyPushDevice.app_user_id.in_(people), BabyPushDevice.enabled.is_(True))))
    spaces = dict((await db.execute(select(BabyMembership.app_user_id, BabyMembership.personal_space_id).where(
        BabyMembership.app_user_id.in_(people)))).all())
    push, after = {}, {}
    for person in people:
        prefs = await load_prefs(db, person, spaces.get(person))
        pref = prefs.kind(KIND)
        if person not in phones or not pref.enabled:
            push[person] = False
        elif not pref.break_through and (ends := quiet_until(prefs.quiet_hours, moment)):
            push[person], after[person] = "after_quiet_hours", ends.isoformat()
        else:
            push[person] = True
    return push, after


async def answer(db, news_id, sent_to, skipped):
    push, after = await will_buzz(db, sent_to, now())
    return {"id": str(news_id), "sent_to": sent_to, "skipped": skipped, "push": push,
            **({"push_after": after} if after else {})}


async def active_members(db, space_id):
    rows = await db.execute(select(BabySpaceMember.app_user_id, BabySpaceMember.role).where(
        BabySpaceMember.space_id == space_id, BabySpaceMember.status == "active"))
    return dict(rows.all())


@router.post("/family/news")
async def send_news(body: FamilyNews, user: User, db: Database, client: Client = None):
    from app.domains.baby.push_worker import baby_push_worker

    access = await reminder_access(db, user.id, client=client)
    child = await db.scalar(select(BabyChild).where(
        BabyChild.id == body.child_id, access.condition(BabyChild), BabyChild.deleted_at.is_(None)))
    if child is None:
        raise HTTPException(404, "Baby unavailable")
    if role_in(access, child.space_id) != "parent" or child.space_id == access.personal_space_id:
        raise HTTPException(409, {"code": "no_family", "message": "Only a parent in a family can tell the family"})
    if body.news == "birth" and child.birth_date is None:
        raise HTTPException(409, {"code": "not_born", "message": "The birth date isn't here yet; send the news once it is"})
    members = await active_members(db, child.space_id)
    picked = list(dict.fromkeys(body.to))
    if user.id in picked:
        raise HTTPException(422, "Choose people in this family")
    # Someone who has left since she picked them is left out, and named back so she knows they weren't told.
    recipients = [person for person in picked if person in members]
    skipped = [person for person in picked if person not in members]
    # A retry is the same news, to the same people, and changes nothing that was sent or when it ends. Anyone
    # who has left since is named as skipped, rather than the whole retry being refused.
    prior = list(await db.scalars(select(BabyNotification).where(
        BabyNotification.kind == KIND, BabyNotification.payload["news_id"].astext == str(body.id))))
    if prior:
        same = all(row.payload.get("news") == body.news and row.payload.get("child_id") == str(child.id)
                   and row.payload.get("from") == user.id for row in prior)
        told = {row.app_user_id for row in prior}
        if not same or not told <= set(picked) or set(recipients) - told:
            raise HTTPException(409, "This news was already sent with different details")
        return await answer(db, body.id, [person for person in picked if person in told], [person for person in picked if person not in told])
    if not recipients:
        return await answer(db, body.id, [], skipped)
    sent = await db.scalar(select(func.count(func.distinct(BabyNotification.payload["news_id"].astext))).where(
        BabyNotification.kind == KIND, BabyNotification.payload["from"].astext == user.id,
        BabyNotification.created_at > now() - timedelta(hours=1),
        BabyNotification.payload["news_id"].astext != str(body.id)))
    if sent >= PER_HOUR:
        raise HTTPException(429, {"code": "news_limit", "message": "That's a lot of news this hour. Your family can see it in the app."})
    moment = now()
    payload = {"news_id": str(body.id), "news": body.news, "child_id": str(child.id), "from": user.id,
               "expires_at": (moment + STAYS[body.news]).isoformat()}
    for person in recipients:
        await schedule(db, owner=person, space_id=child.space_id, kind=KIND, key=str(body.id), due_at=moment, payload=payload)
    await db.commit()
    baby_push_worker.notify()
    return await answer(db, body.id, recipients, skipped)


async def news_words(db, row, access, prefs):
    child = await db.scalar(select(BabyChild).where(
        BabyChild.id == UUID(row.payload["child_id"]), access.condition(BabyChild), BabyChild.deleted_at.is_(None)
    ).execution_options(populate_existing=True))
    sender = row.payload.get("from")
    if child is None or child.space_id != row.space_id or (await active_members(db, row.space_id)).get(sender) != "parent":
        return None
    news = row.payload.get("news")
    if (news == "labor") != (child.birth_date is None):  # Labor news is over once the baby is born.
        return None
    name = await db.scalar(select(BabyMembership.profile["display_name"].astext).where(BabyMembership.app_user_id == sender))
    who = " ".join((name or "").split())[:60] or "Your family"
    baby = " ".join(child.name.split())[:60]
    data = {"child_id": str(child.id), "news": news}
    if news == "labor":
        return Words(f"{who}: contractions have started.", data)
    born = clock_words((child.details or {}).get("birth_time"))
    return Words(f"{who}: {baby} is here!{f' Born at {born}.' if born else ''}", data)


def clock_words(value):
    """ "23:40" as "11:40 PM". Anything else says nothing rather than something wrong."""
    try:
        hour, minute = (int(part) for part in (value or "").split(":"))
    except ValueError:
        return None
    if not (0 <= hour < 24 and 0 <= minute < 60):
        return None
    return f"{hour % 12 or 12}:{minute:02d} {'AM' if hour < 12 else 'PM'}"


RESOLVERS[KIND] = news_words
