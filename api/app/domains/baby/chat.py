"""Grounded private conversations; proposals are data, never hidden mutations."""

import json
import math
import re
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid5
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException
from sqlalchemy import String, and_, case, cast, func, or_, select

from app.ai_governance import ai_request_context
from app.domains.baby.access import access_for, touch
from app.domains.baby.ask_dates import date_window, without_dates
from app.domains.baby.ask_gate import ask_v2_allowed
from app.domains.baby.dependencies import Access, Client, Database, Generation, User
from app.domains.baby.lifecycle import digest, now, owned
from app.domains.baby.models import BabyChild, BabyConversation, BabyMessage, BabyRecord
from app.domains.baby.provider import (
    DAILY_LIMIT_CODE,
    BabyProvider,
    ContextChanged,
    budget_failure_message,
)
from app.domains.baby.queries import child_timing, legacy_client, records_query, row_scope
from app.domains.baby.schemas import V1_KINDS, ChatRequest, RecordCreate
from app.domains.baby.security import BabyRoute
from app.domains.baby.stats import care_stats, custom_days, last_feed

router = APIRouter(tags=["baby"], route_class=BabyRoute)
SCOPE_KINDS = {
    "library": ("source", "collection"),
    "journal": ("journal", "question"),
    "care": ("feeding", "sleep", "diaper", "routine", "medicine"),
}
STOPWORDS = frozenset(
    "a an and are as at be been by can could did do does for from had has have how i in is it me my of on or our should that the their them there these they this to us was we were what when where which who why will with would you your about please saved find show tell "
    # Words that ask for a recap or point at the baby would otherwise match unrelated saved text.
    "happen happened happening going doing lately recent recently anything everything something update updates recap summary overview latest last she he her hers him his baby".split()
)
# Care logs are terse and typed, so "eat" can never find a feeding by its text.
CARE_WORDS = {
    "feeding": "eat eats ate eaten eating feed feeds fed feeding feedings nurse nurses nursed nursing bottle bottles breastfeed breastfed breastfeeding".split(),
    "sleep": "sleep sleeps slept sleeping asleep nap naps napped napping woke awake".split(),
    "diaper": "diaper diapers poo poos poop poops pooped pee pees peed wet dirty".split(),
    # A dose's title is the drug's name, so "medicine" can't find it by its text either.
    "medicine": "medicine medicines meds medication medications".split(),
}
# Logs she keeps about herself have no baby on them. These labels match baby-mobile/lib/trackers.ts.
HER_LOG_LABELS = ("How I'm feeling", "My weight", "Blood pressure", "Vitamins and medicine")
HER_WORDS = frozenset(
    "blood pressure bp weight weigh feeling feel felt vitamin vitamins prenatal prenatals "
    "medicine medicines meds medication medications".split()
)
ABOUT_THE_BABY = frozenset("baby babies her hers she he him his daughter son".split())
# A dated question gets only that range's logs. Only something saved to read applies whenever it was saved.
SAVED_TO_READ = ("source", "journal", "question", "collection", "routine")
FIRST_PERSON = frozenset("i i'm i've me my myself".split())
RECENT_LIMIT = 30  # About one day of newborn logs.
DATED_LIMIT = 60
KIND_LIMIT = 10
MATCH_LIMIT = 12
OUTSIDE_RANGE_LIMIT = 6
PACK_CHILDREN = 12
BRIEF_EXCERPT = 1500  # So one long saved video cannot crowd out a day of care logs.


def conversation_response(row):
    return {
        key: getattr(row, key)
        for key in ("id", "title", "scope", "record_id", "child_id", "created_at", "updated_at")
    }


async def conversation_child(db, row, access):
    if not access.enabled or row.child_id is None:
        return row.child_id
    with db.no_autoflush:
        return await db.scalar(select(BabyChild.id).where(
            BabyChild.id == row.child_id, access.condition(BabyChild), BabyChild.deleted_at.is_(None)))


async def conversation_reply(db, row, access):
    return {**conversation_response(row), "child_id": await conversation_child(db, row, access)}


def clean_assistant_message(message):
    """Structured citation cards carry references; model control glyphs never do."""
    # A marker is cite + ID(s); an unterminated one must not swallow the answer after it.
    message = re.sub(r"\ue200cite(?:\ue202[^\s\ue200-\ue2ff]*)+\ue201?", "", message)
    message = re.sub(r"[\ue200-\ue2ff]", "", message)
    message = re.sub(r"[ \t]+([,.;:!?])", r"\1", message)
    return re.sub(r"[ \t]{2,}", " ", message).strip()


def citations_for(citations, *, legacy):
    """Build 32 cannot open what it does not know, so it is not offered as a source."""
    if not legacy:
        return citations
    return [item for item in citations or [] if item.get("kind", "source") in V1_KINDS]


def message_response(row, *, legacy=False):
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "role": row.role,
        "content": clean_assistant_message(row.content.get("message", ""))
        if row.role == "assistant" else row.content.get("message", ""),
        "citations": citations_for(row.content.get("citations", []), legacy=legacy),
        "proposal": row.content.get("proposal"),
        "created_at": row.created_at,
        "status": row.content.get("status", "ready"),
    }


def singular(word):
    """A search stem for plurals, so "diapers" finds "Diaper" and "feeds" finds "Feeding".

    Stems only ever trim letters (so they still match the plural too) and stay at least four
    letters long, so short words like "naps" or "meds" are not widened into "nap" or "med".
    """
    if word.endswith("ies"):
        stem = word[:-3]  # "allergies" -> "allerg" finds both allergy and allergies
    elif word.endswith(("ches", "shes", "xes", "sses")):
        stem = word[:-2]
    elif word.endswith("s") and not word.endswith(("ss", "us", "is")):
        stem = word[:-1]
    else:
        return word
    return stem if len(stem) >= 4 else word


def query_terms(message):
    # Matching is by substring, so the singular form also finds the plural.
    return list(
        dict.fromkeys(
            singular(word.lower())
            for word in re.findall(r"[\w'-]{3,}", message)
            if word.lower() not in STOPWORDS
        )
    )[:10]


def record_text(record, *, include_title=True):
    return "\n\n".join(
        filter(
            None,
            [
                record.title if include_title else None,
                record.body,
                record.data.get("source_text"),
                record.data.get("summary"),
                ", ".join(record.data.get("topics", [])),
            ],
        )
    )


def parent_zone(name):
    try:
        return ZoneInfo(name) if name else UTC
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def local_data(data, zone):
    """Care times the model reads in the parent's own timezone, so answers quote local clock times."""
    if not isinstance(data, dict):
        return data
    # Each tap's identity says nothing the count and times don't.
    shifted = {key: value for key, value in data.items() if key != "session_actions"}
    if zone is None:
        return shifted
    for key in ("end_at", "reminder_at"):
        moment = parsed_time(shifted.get(key))
        if moment and moment.tzinfo:
            shifted[key] = moment.astimezone(zone).isoformat()
    return shifted


def excerpt_for(record, terms, *, limit=7000, zone=None):
    text = record_text(record)
    if record.kind not in {"source", "journal", "question", "collection"}:
        text += "\n" + json.dumps(local_data(record.data, zone), ensure_ascii=False)
    return bounded(text, terms, limit)


def bounded(text, terms, limit):
    if len(text) <= limit:
        return text
    positions = [
        match.start() for term in terms for match in re.finditer(re.escape(term), text, re.I)
    ]
    if not positions:
        return text[:limit] + "\n[Additional text omitted]"
    # Retain separated passages so a relevant old fact near the end is not lost.
    windows = []
    for position in sorted(positions):
        start, end = max(0, position - 500), min(len(text), position + 1800)
        if windows and start <= windows[-1][1]:
            windows[-1] = (windows[-1][0], max(windows[-1][1], end))
        else:
            windows.append((start, end))
    return "\n[Excerpt]\n".join(text[start:end] for start, end in windows)[:limit]


def duration_label(minutes):
    if (
        not isinstance(minutes, int | float)
        or isinstance(minutes, bool)
        or not math.isfinite(minutes)
        or minutes < 0
    ):
        return None
    if 0 < minutes < 1:
        return "under 1 min"
    hours, rest = divmod(round(minutes), 60)
    if not hours:
        return f"{rest} min"
    return f"{hours} h {rest} min" if rest else f"{hours} h"


def amount_label(amount, unit):
    if (
        not isinstance(amount, int | float)
        or isinstance(amount, bool)
        or not math.isfinite(amount)
        or amount <= 0
    ):
        return None
    # The unit is optional in the record contract; the app shows unitless amounts as mL.
    return f"{amount:g} {'oz' if unit == 'oz' else 'mL'}"


def parsed_time(value):
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def care_summary(record):
    """Plain-language care details for people; the model still receives the typed data."""
    data = record.data if isinstance(record.data, dict) else {}
    if record.kind == "feeding":
        method = data.get("method")
        side = {"left": "Left side", "right": "Right side", "both": "Both sides"}
        parts = [{"breast": "Breastfeeding", "bottle": "Bottle"}.get(method, "Feeding")]
        if method == "breast":
            parts.append(side.get(data.get("side")))
        parts += [
            amount_label(data.get("amount"), data.get("unit")),
            duration_label(data.get("duration_minutes")),
        ]
        return " · ".join(filter(None, parts))
    if record.kind == "sleep":
        if not data.get("end_at"):
            return "Sleep in progress"
        start, end = parsed_time(record.occurred_at), parsed_time(data["end_at"])
        try:
            label = duration_label((end - start).total_seconds() / 60)
        except TypeError:
            label = None
        return f"Sleep · {label}" if label else "Sleep"
    if record.kind == "diaper":
        return {"wet": "Wet", "dirty": "Dirty", "both": "Wet and dirty", "dry": "Dry"}.get(
            data.get("type"), "Diaper change"
        )
    if record.kind == "routine":
        items = [item for item in data.get("items") or [] if isinstance(item, dict)]
        labels = [str(item["label"]) for item in items if item.get("label")]
        steps = f"{len(items)} step" + ("" if len(items) == 1 else "s")
        if data.get("routine_type") == "checklist":
            done = sum(1 for item in items if item.get("done") is True)
            heading = f"{done} of {steps} done" if items else "Checklist"
        else:
            heading = f"Schedule · {steps}" if items else "Schedule"
        repeat = {"daily": "Repeats daily", "weekly": "Repeats weekly"}.get(data.get("repeat"))
        return "\n".join(filter(None, [" · ".join(filter(None, [heading, repeat])), *labels]))
    return ""


def without_title(text, title):
    title, text = (title or "").strip(), text.lstrip()
    remainder = text[len(title) :]
    # Compare the same slice that is cut, so case folding can never shift the cut point.
    if (
        title
        and text[: len(title)].casefold() == title.casefold()
        and remainder[:1] in {"", "\n", ":", "."}
    ):
        return remainder.lstrip("\n:. ")
    return text


def display_excerpt(record, terms, *, limit=1000):
    """Citation text shown beside the record title, so it never repeats that title."""
    summary = care_summary(record) if record.kind in SCOPE_KINDS["care"] else ""
    text = record_text(record, include_title=False)
    if record.kind == "source":
        organized = [record.data.get("summary"), *record.data.get("key_points", [])]
        text = "\n\n".join(part.strip() for part in organized if part and part.strip()) or text
    body = without_title(text, record.title)
    return bounded("\n\n".join(filter(None, [summary, body])), terms, 7000).strip()[:limit]


def care_kinds(message):
    words = {word.lower() for word in re.findall(r"[\w'-]+", message)}
    return [kind for kind, names in CARE_WORDS.items() if words.intersection(names)]


def asks_about_her(message, child_names=()):
    # "Mia's" and "daughter's" are about the baby just as "Mia" and "daughter" are.
    words = {re.sub(r"'s$", "", word.lower()) for word in re.findall(r"[\w'-]+", message.replace("’", "'"))}
    named = {word.lower() for name in child_names for word in re.findall(r"[\w'-]+", name)}
    return bool(words & FIRST_PERSON and words & HER_WORDS) and not words & (ABOUT_THE_BABY | named)


def term_matches(terms):
    haystack = BabyRecord.title + " " + BabyRecord.body + " " + cast(BabyRecord.data, String)
    return [
        haystack.ilike("%" + term.replace("%", "\\%").replace("_", "\\_") + "%", escape="\\")
        for term in terms
    ]


def ranked(matches):
    return sum((case((match, 1), else_=0) for match in matches))


def newest(query):
    return query.order_by(BabyRecord.occurred_at.desc())


def unique_rows(rows):
    return list({row.id: row for row in rows}.values())


async def undated_rows(db, query, request, terms):
    """Without dates: logs of a named kind, then keywords, then recent records in scope."""
    rows, matched = [], []
    kinds = care_kinds(request.message)
    if kinds:
        rows += await db.scalars(
            newest(query.where(BabyRecord.kind.in_(kinds))).limit(KIND_LIMIT)
        )
    if terms and request.scope != "care":
        matches = term_matches(terms)
        matched = list(
            await db.scalars(
                query.where(or_(*matches))
                .order_by(ranked(matches).desc(), BabyRecord.occurred_at.desc())
                .limit(MATCH_LIMIT)
            )
        )
    rows += matched
    if not rows or request.scope == "care":
        rows += await db.scalars(newest(query).limit(RECENT_LIMIT))
    return unique_rows(rows), {row.id for row in matched}


async def dated_rows(db, query, window, terms):
    """Every entry in the range, keyword matches first, up to a bound the caller reports."""
    in_range = query.where(
        BabyRecord.occurred_at >= window.start, BabyRecord.occurred_at < window.end
    )
    order = [BabyRecord.occurred_at.desc()]
    outside = []
    if terms:
        matches = term_matches(terms)
        order.insert(0, ranked(matches).desc())
        # "Tips for this week": a saved reference applies whenever it was saved. Logs do not.
        outside = list(
            await db.scalars(
                query.where(
                    or_(*matches),
                    or_(
                        BabyRecord.occurred_at < window.start,
                        BabyRecord.occurred_at >= window.end,
                    ),
                    BabyRecord.kind.in_(SAVED_TO_READ),
                )
                .order_by(ranked(matches).desc(), BabyRecord.occurred_at.desc())
                .limit(OUTSIDE_RANGE_LIMIT)
            )
        )
    rows = list(await db.scalars(in_range.order_by(*order).limit(DATED_LIMIT + 1)))
    return rows[:DATED_LIMIT], len(rows) <= DATED_LIMIT, outside


async def retrieve(db, owner, generation, request, zone=UTC, *, child_names=(), legacy=False, tracked=None):
    """Citable records, their display excerpts, and the date range they answer, if one was asked."""
    window = None if request.record_id else date_window(request.message, now().astimezone(zone))
    names = set(query_terms(" ".join(child_names)))
    terms = [term for term in query_terms(without_dates(request.message)) if term not in names]
    query = records_query(owner, generation, child_id=request.child_id)
    if request.child_id and asks_about_her(request.message, child_names):
        # With a baby selected, a question about herself still reaches her own logs, and nothing else without a baby.
        query = records_query(owner, generation).where(or_(
            BabyRecord.child_id == request.child_id,
            and_(BabyRecord.child_id.is_(None), BabyRecord.kind == "custom", BabyRecord.data["label"].astext.in_(HER_LOG_LABELS)),
        ))
    # What she calls it isn't always what it's stored as, so "my meds" still finds "Vitamins and medicine".
    if re.search(r"\bbp\b", request.message, re.IGNORECASE):  # Too short to be a search term by itself.
        terms = [*terms, "blood pressure"]
    if set(terms) & set(CARE_WORDS["medicine"]):
        terms = [*terms, "medicine"]
    if legacy:
        query = query.where(BabyRecord.kind.in_(V1_KINDS))
    if request.scope in SCOPE_KINDS:
        query = query.where(BabyRecord.kind.in_(SCOPE_KINDS[request.scope]))
    outside, in_full, complete = [], set(), True
    if request.record_id:
        focus = await owned(db, BabyRecord, owner, generation, request.record_id)
        if legacy and focus.kind not in V1_KINDS:
            raise HTTPException(404, "Item unavailable")
        if request.child_id and focus.child_id != request.child_id:
            raise HTTPException(422, "The selected entry belongs to a different child")
        if request.scope in SCOPE_KINDS and focus.kind not in SCOPE_KINDS[request.scope]:
            raise HTTPException(422, "The selected entry is outside this conversation scope")
        rows, in_full = [focus], {focus.id}
    elif window:
        rows, complete, outside = await dated_rows(db, query, window, terms)
    else:
        rows, in_full = await undated_rows(db, query, request, terms)
    in_range = len(rows)
    rows, in_full = rows + outside, in_full | {row.id for row in outside}
    context, displays, available = [], {}, 45000
    from app.domains.baby.lifecycle import readable_journal_children

    readable = await readable_journal_children(db, rows, owner)
    for position, row in enumerate(rows):
        limit = 7000 if row.id in in_full else BRIEF_EXCERPT
        excerpt = excerpt_for(row, terms, limit=min(limit, available), zone=zone)
        if not excerpt or available <= 0:
            complete = complete and position >= in_range
            break
        if tracked is not None:
            tracked["records"][row.id] = (row.space_id, row.generation, row.revision)
        context.append(
            {
                "id": str(row.id),
                "title": row.title,
                "kind": row.kind,
                "occurred_at": row.occurred_at.astimezone(zone).isoformat(),
                "revision": row.revision,
                "child_id": str(row.child_id) if row.child_id and (row.kind != "journal" or row.child_id in readable) else None,
                "excerpt": excerpt,
                "source_url": row.data.get("url"),
                "evidence_type": (
                    "source_claim" if row.kind == "source"
                    else row.data.get("provenance", "caregiver_observation")
                ),
                **({"outside_requested_range": True} if position >= in_range else {}),
            }
        )
        displays[str(row.id)] = display_excerpt(row, terms)
        available -= len(excerpt)
    requested_range = window and {
        "label": window.label,
        "start": window.start.isoformat(),
        "end_before": window.end.isoformat(),
        "complete": complete,
    }
    return context, displays, requested_range


def today_totals(stats):
    """S1's numbers for today, without its record IDs or averages today cannot have."""
    return {
        "feeding": {
            key: stats["feeding"][key]
            for key in (
                "count", "left", "right", "both", "bottle_count",
                "bottle_ml", "bottle_oz", "breast_minutes", "timed_breast_feeds",
            )
        },
        "diapers": {key: stats["diapers"][key] for key in ("count", "pee", "poo", "dry")},
        "sleep": {
            **{key: stats["sleep"][key] for key in ("total_minutes", "longest_minutes", "sleeps")},
            "in_progress_since": [item["started_at"] for item in stats["sleep"]["open"]],
        },
        "complete": stats["complete"],
    }


async def care_context(db, owner, generation, child_id, zone, *, tracked=None):
    at = now()
    today = at.astimezone(zone).date()
    feed = await last_feed(db, owner, generation, child_id, zone, at, tracked=tracked)
    totals = today_totals(
        await care_stats(db, owner, generation, child_id, zone, custom_days(today, today, zone, at), tracked=tracked)
    )
    logged = (
        feed
        or totals["feeding"]["count"]
        or totals["diapers"]["count"]
        or totals["sleep"]["sleeps"]
        or totals["sleep"]["in_progress_since"]
    )
    return {"last_feed": feed, "today_totals": totals}, bool(logged)


async def context_pack(db, owner, generation, request, zone, *, tracked=None):
    """Facts computed by code, kept out of the citable records and free of record IDs."""
    today = now().astimezone(zone).date()
    # A focused or Saved or Journal conversation is not about care, so it isn't sent any.
    with_care = not request.record_id and request.scope in {"all", "care"}
    query = select(BabyChild).where(
        row_scope(BabyChild, owner, generation),
        BabyChild.deleted_at.is_(None),
    )
    if request.child_id:
        query = query.where(BabyChild.id == request.child_id)
    children = []
    for child in await db.scalars(query.order_by(BabyChild.name).limit(PACK_CHILDREN)):
        if tracked is not None:
            tracked["children"][child.id] = (child.space_id, child.generation, child.revision)
        entry = {"name": child.name, "stage": "unknown"}
        entry.update(child_timing(child, today) or {})
        if entry["stage"] == "baby":
            entry["baby_age_days"] = (today - child.birth_date).days
        for key in ("due_date", "birth_date"):
            if getattr(child, key):
                entry[key] = getattr(child, key).isoformat()
        if with_care:
            care, logged = await care_context(db, owner, generation, child.id, zone, tracked=tracked)
            # A baby's empty day is news; an unborn child's is not.
            if logged or entry["stage"] == "baby":
                entry.update(care)
        children.append(entry)
    pack = {"children": children, "today": today.isoformat()}
    if with_care and not request.child_id:
        care, logged = await care_context(db, owner, generation, None, zone, tracked=tracked)
        if logged:
            pack["care_with_no_child"] = care
    return pack


def reviewed_proposal(raw):
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) - {"kind", "title", "body", "data"}:
        raise ValueError("Invalid proposal")
    if raw.get("kind") not in {"routine", "journal", "question"}:
        raise ValueError("Unsupported proposal")
    proposal = RecordCreate.model_validate({**raw, "occurred_at": now()})
    if proposal.kind == "routine" and (
        proposal.data.get("enabled") or proposal.data.get("reminder_at")
    ):
        raise ValueError("AI cannot activate reminders")
    if proposal.data.get("attachment_ids"):
        raise ValueError("AI cannot attach private files")
    if proposal.data.get("provenance") == "clinician_instruction":
        raise ValueError("Only the caregiver can identify clinician instructions")
    return {key: getattr(proposal, key) for key in ("kind", "title", "body", "data")}


def access_snapshot(access):
    """What this person can reach. Any difference means an answer in progress started under other rules."""
    return tuple((g.id, g.generation, g.role, g.access_version) for g in access.spaces) if access.enabled else ()


def chat_scopes(access):
    personal = next(g for g in access.spaces if g.id == access.personal_space_id)
    # Caregivers cannot use family content in Ask; their personal library stays theirs.
    readable = replace(access, spaces=tuple(g for g in access.spaces if g.role == "parent"), target=None)
    private = replace(access, spaces=(personal,), target=personal if access.target else None)
    return readable, private


def conversation_scope(model, access):
    if not access.enabled:
        return access.condition(model)
    readable, private = chat_scopes(access)
    return private.condition(model) & (model.app_user_id == access.actor) & model.context_space_ids.contained_by(
        [str(g.id) for g in readable.spaces])


async def verify_context(db, access, tracked, *, generation=None):
    readable = chat_scopes(access)[0] if access.enabled else access.actor
    for model, key in ((BabyRecord, "records"), (BabyChild, "children")):
        snapshots = tracked[key]
        if not snapshots:
            continue
        rows = list(await db.scalars(select(model).where(
            model.id.in_(snapshots), row_scope(model, readable, generation), model.deleted_at.is_(None)
        ).order_by(model.id).with_for_update().execution_options(populate_existing=True)))
        if len(rows) != len(snapshots) or any(
            (row.space_id, row.generation, row.revision) != snapshots[row.id] for row in rows
        ):
            raise ContextChanged()


@router.get("/conversations")
async def conversations(user: User, db: Database, access: Access = None):
    rows = list(await db.scalars(
        select(BabyConversation)
        .where(
            conversation_scope(BabyConversation, access),
        )
        .order_by(BabyConversation.updated_at.desc())
        .limit(100)
    ))
    ids = {row.child_id for row in rows if row.child_id}
    if access.enabled and ids:
        ids = set(await db.scalars(select(BabyChild.id).where(
            BabyChild.id.in_(ids), access.condition(BabyChild), BabyChild.deleted_at.is_(None))))
    return {"items": [{**conversation_response(row), "child_id": row.child_id if row.child_id in ids else None}
                      for row in rows]}


@router.get("/conversations/{identifier}")
async def get_conversation(identifier: UUID, user: User, db: Database, client: Client = None,
                           access: Access = None):
    row = await db.scalar(select(BabyConversation).where(
        BabyConversation.id == identifier, conversation_scope(BabyConversation, access)))
    if row is None:
        raise HTTPException(404, "Item unavailable")
    messages = await db.scalars(
        select(BabyMessage)
        .where(
            conversation_scope(BabyMessage, access),
            BabyMessage.conversation_id == identifier,
        )
        .order_by(BabyMessage.created_at, BabyMessage.id)
        .limit(500)
    )
    return {
        **await conversation_reply(db, row, access),
        "messages": [message_response(message, legacy=legacy_client(client)) for message in messages],
    }


@router.post("/chat")
async def chat(
    body: ChatRequest, user: User, db: Database, generation: Generation, client: Client = None,
    access: Access = None,
):
    return await answer_chat(body, user, db, generation, client, access)


def question_identity(body):
    # The same in a later release, so a retry across a rollback still matches. Which Ask answers isn't part of the question.
    return digest(body.model_dump(mode="json", exclude={"ask_v2", *(() if body.focus_date else ("focus_date",))}))


async def answer_chat(body, user, db, generation, client, access, *, retries=2):
    access.check_generation(generation)
    member = access.member
    readable, private = chat_scopes(access) if access.enabled else (user.id, user.id)
    if access.enabled and access.target.id != access.personal_space_id:
        raise HTTPException(422, "Ask conversations belong in your personal Baby space")
    # Old conversations scoped to one area keep the search they began with.
    use_v2 = body.ask_v2 and body.scope == "all" and not legacy_client(client) and ask_v2_allowed(member.profile)
    tracked = {"records": {}, "children": {}} if access.enabled or use_v2 else None
    if not member.profile.get("ai_consent"):
        raise HTTPException(403, "Enable AI processing in settings before asking a question")
    provider = BabyProvider()
    if not provider.enabled:
        raise HTTPException(
            503, "AI is temporarily unavailable; your library and journal remain available"
        )
    original_body = body
    fingerprint = question_identity(body)
    prior = await db.get(BabyMessage, body.request_id, populate_existing=True)
    answer_id = uuid5(NAMESPACE_URL, f"hafa-baby-answer:{user.id}:{generation}:{body.request_id}")
    if prior:
        if access.enabled and (
            prior.space_id != access.personal_space_id or
            not set(prior.context_space_ids or []).issubset({str(g.id) for g in readable.spaces})
        ):
            raise HTTPException(404, "Conversation context is no longer available")
        if (
            prior.app_user_id != user.id
            or prior.generation != generation
            or prior.content.get("hash") != fingerprint
        ):
            raise HTTPException(409, "This question identity was used with different content")
        answer = await db.get(BabyMessage, answer_id)
        if answer:
            if access.enabled and not set(answer.context_space_ids or []).issubset({str(g.id) for g in readable.spaces}):
                raise HTTPException(404, "Conversation context is no longer available")
            return {
                "conversation_id": answer.conversation_id, **answer.content,
                "citations": citations_for(
                    answer.content.get("citations", []), legacy=legacy_client(client)
                ),
                "message": clean_assistant_message(answer.content.get("message", "")),
            }
        lease = prior.content.get("lease_until")
        if lease and lease > now().isoformat():
            raise HTTPException(
                409, "This answer is still processing; reopen the conversation shortly"
            )
        if prior.content.get("attempts", 0) >= 3:
            raise HTTPException(429, "This question reached its retry limit; please ask again")
        conversation = await owned(db, BabyConversation, private, generation, prior.conversation_id)
    else:
        count = await db.scalar(
            select(func.count())
            .select_from(BabyMessage)
            .where(
                BabyMessage.app_user_id == user.id,
                BabyMessage.role == "user",
                BabyMessage.created_at > now() - timedelta(days=1),
            )
        )
        if count >= 50:
            raise HTTPException(
                429, "Daily question allowance reached; your saved information remains available"
            )
        if body.conversation_id:
            conversation = await owned(
                db, BabyConversation, private, generation, body.conversation_id
            )
            if body.child_id == conversation.child_id and await conversation_child(db, conversation, access) is None:
                body = body.model_copy(update={"child_id": None})
            if (
                conversation.scope != body.scope
                or conversation.record_id != body.record_id
                or await conversation_child(db, conversation, access) != body.child_id
            ):
                raise HTTPException(409, "Conversation context changed; start a new conversation")
        else:
            if body.child_id:
                await owned(db, BabyChild, readable, generation, body.child_id)
            conversation = BabyConversation(
                app_user_id=user.id,
                space_id=member.personal_space_id,
                generation=generation,
                title=body.message[:100],
                scope=body.scope,
                record_id=body.record_id,
                child_id=body.child_id,
                created_at=now(),
                updated_at=now(),
            )
            db.add(conversation)
            await touch(conversation, access.target)
            await db.flush()
        prior = BabyMessage(
            id=body.request_id,
            app_user_id=user.id,
            space_id=member.personal_space_id,
            generation=generation,
            conversation_id=conversation.id,
            role="user",
            content={"hash": fingerprint, "message": body.message, "attempts": 0},
            created_at=now(),
        )
        db.add(prior)
        await touch(prior, access.target)
    if body.child_id == conversation.child_id and await conversation_child(db, conversation, access) is None:
        body = body.model_copy(update={"child_id": None})
    if access.enabled and not set(conversation.context_space_ids or []).issubset({str(g.id) for g in readable.spaces}):
        raise HTTPException(404, "Conversation context is no longer available")
    active = await db.scalar(
        select(func.count())
        .select_from(BabyMessage)
        .where(
            BabyMessage.app_user_id == user.id,
            BabyMessage.generation == generation,
            BabyMessage.role == "user",
            BabyMessage.id != body.request_id,
            BabyMessage.content["status"].astext == "processing",
            BabyMessage.content["lease_until"].astext > now().isoformat(),
        )
    )
    if active:
        raise HTTPException(409, "Another answer is processing; let it finish before asking again")
    count = await db.scalar(
        select(func.count())
        .select_from(BabyMessage)
        .where(
            BabyMessage.app_user_id == user.id,
            BabyMessage.generation == generation,
            BabyMessage.conversation_id == conversation.id,
        )
    )
    if count >= 500:
        raise HTTPException(422, "This conversation is full; start a new conversation")
    zone = parent_zone(member.profile.get("timezone"))
    pack = await context_pack(db, readable, generation, body, zone,
                              **({"tracked": tracked} if tracked is not None else {}))
    context, displays, requested_range = [], {}, None
    if not use_v2:
        context, displays, requested_range = await retrieve(
            db, readable, generation, body, zone, legacy=legacy_client(client),
            child_names=[item["name"] for item in pack["children"]],
            **({"tracked": tracked} if tracked is not None else {})
        )
    history_rows = list(
        await db.scalars(
            select(BabyMessage)
            .where(
                BabyMessage.app_user_id == user.id,
                BabyMessage.generation == generation,
                BabyMessage.conversation_id == conversation.id,
            )
            .order_by(BabyMessage.created_at.desc())
            .limit(12)
        )
    )
    history = [
        {"role": item.role, "message": item.content.get("message", "")[:3000]}
        for item in reversed(history_rows)
    ]
    epoch, conversation_id = member.consent_epoch, conversation.id
    prior.content = {
        **prior.content,
        "status": "processing",
        "attempts": prior.content.get("attempts", 0) + 1,
        "lease_until": (now() + timedelta(minutes=3)).isoformat(),
    }
    await touch(prior, access.target)
    answer_lease = prior.content["lease_until"]
    personal_space_id = access.personal_space_id
    await db.commit()

    question_access = access_snapshot(access)

    async def checked_access(check):
        fresh = await access_for(check, user.id, client=client,
                                 space_id=personal_space_id if access.enabled else None,
                                 generation=generation)
        current = fresh.member
        if (
            not current.profile.get("ai_consent")
            or current.consent_epoch != epoch
            or (use_v2 and not ask_v2_allowed(current.profile))
        ):
            raise HTTPException(403, "AI processing permission changed")
        if use_v2 and access_snapshot(fresh) != question_access:
            raise ContextChanged()
        return fresh

    async def gate():
        from app.db.database import AsyncSessionLocal

        async with AsyncSessionLocal() as check:
            await checked_access(check)

    provider.gate = gate
    try:
        with ai_request_context(
            request_id=str(body.request_id), user_id=user.id, job_id=None, route="/api/v1/baby/chat"
        ):
            if use_v2:
                from app.domains.baby.ask_tools import AskTools
                from app.domains.baby.ask_v2 import answer_question

                tools = AskTools(
                    user_id=user.id, client=client, personal_space_id=personal_space_id,
                    family=access.enabled, generation=generation, zone=zone, tracked=tracked,
                    child_id=body.child_id, check=checked_access, question=body.message, focus_id=body.record_id,
                )
                result = await answer_question(
                    provider, tools=tools, message=body.message, history=history,
                    now_local=now().astimezone(zone).isoformat(timespec="minutes"),
                    context_pack=pack,
                )
                context, displays = list(tools.citable.values()), tools.displays
            else:
                result = await provider.answer(
                    message=body.message,
                    context=context,
                    history=history,
                    now_local=now().astimezone(zone).isoformat(timespec="minutes"),
                    context_pack=pack,
                    requested_range=requested_range,
                )
        allowed = {item["id"]: item for item in context}
        if any(identifier not in allowed for identifier in result.citation_ids):
            raise ValueError("Unsupported citation")
        citations = [
            {
                "id": identifier,
                "title": allowed[identifier]["title"],
                "excerpt": displays[identifier],
                "kind": allowed[identifier]["kind"],
            }
            for identifier in dict.fromkeys(result.citation_ids)
        ]
        proposal = reviewed_proposal(result.proposal)
        payload = {"message": clean_assistant_message(result.message), "citations": citations, "proposal": proposal}
        access = await access_for(db, user.id, client=client,
                                  space_id=personal_space_id if access.enabled else None,
                                  generation=generation, write=True)
        current = access.member
        readable, private = chat_scopes(access) if access.enabled else (user.id, user.id)
        if current.consent_epoch != epoch or not current.profile.get("ai_consent"):
            raise HTTPException(
                403, "AI processing permission changed; this response was discarded"
            )
        if use_v2 and not ask_v2_allowed(current.profile):
            raise HTTPException(
                403, "AI processing permission changed; this response was discarded"
            )
        if access.enabled or use_v2:
            await verify_context(db, access, tracked, generation=generation)
        # Legacy completion retains its existing citation revision check.
        for citation in citations if not access.enabled else []:
            current_record = await owned(db, BabyRecord, user.id, generation, UUID(citation["id"]))
            if current_record.revision != allowed[citation["id"]]["revision"]:
                raise HTTPException(
                    409,
                    "Your saved information changed while AI answered; ask again to use the current version",
                )
        conversation = await owned(db, BabyConversation, private, generation, conversation_id)
        prior = await owned(db, BabyMessage, private, generation, body.request_id)
        if access.enabled and prior.content.get("lease_until") != answer_lease:
            raise HTTPException(409, "This answer lease changed; the response was discarded")
        prior.content = {**prior.content, "status": "ready", "lease_until": None}
        await touch(prior, access.target)
        if access.enabled:
            used = {str(value[0]) for snapshots in tracked.values() for value in snapshots.values()}
            used.update(conversation.context_space_ids or [])
            conversation.context_space_ids = sorted(used)
            prior.context_space_ids = sorted(used)
        answer = BabyMessage(
            id=answer_id,
            app_user_id=user.id,
            space_id=current.personal_space_id,
            generation=generation,
            conversation_id=conversation_id,
            role="assistant",
            content=payload,
            context_space_ids=conversation.context_space_ids if access.enabled else [],
            created_at=now(),
        )
        db.add(answer)
        if access.enabled:
            conversation.child_id = await conversation_child(db, conversation, access)
        conversation.updated_at = now()
        await touch(prior, access.target)
        await touch(answer, access.target)
        await touch(conversation, access.target)
        await db.commit()
        return {"conversation_id": conversation_id, **payload}
    except Exception as failure:
        await db.rollback()
        try:
            access = await access_for(db, user.id, client=client,
                                      space_id=personal_space_id if access.enabled else None,
                                      generation=generation, write=True)
            current = access.member
            _, private = chat_scopes(access) if access.enabled else (user.id, user.id)
            if current.consent_epoch == epoch:
                prior = await owned(db, BabyMessage, private, generation, body.request_id)
                prior.content = {**prior.content, "status": "failed", "lease_until": None}
                await touch(prior, access.target)
                await db.commit()
        except HTTPException:
            await db.rollback()
        if isinstance(failure, ContextChanged):
            if retries:
                access = await access_for(db, user.id, client=client, space_id=personal_space_id,
                                          generation=generation, write=True)
                return await answer_chat(original_body, user, db, generation, client, access, retries=retries - 1)
            raise HTTPException(409, "Your library changed while answering; please retry") from None
        if isinstance(failure, HTTPException):
            raise failure
        from app.domains.workouts.budget import BudgetError

        if isinstance(failure, BudgetError):
            raise HTTPException(
                failure.status_code,
                {"code": DAILY_LIMIT_CODE, "message": budget_failure_message(failure)}
                if failure.status_code == 429
                else budget_failure_message(failure),
            ) from None
        raise HTTPException(
            503, "AI could not finish. Your question is saved; please retry."
        ) from None
