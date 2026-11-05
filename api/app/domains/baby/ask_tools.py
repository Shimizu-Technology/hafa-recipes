"""What Ask's model may read. Read-only, argument-checked, and scoped on the server for every round."""

import json
import re
from datetime import date, timedelta
from typing import Literal, NamedTuple
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import or_, select

from app.domains.baby.ask_research import (
    TOOL_RULES,
    clean_query,
    overlaps,
    research_for,
    strings_in,
)
from app.domains.baby.ask_safety import SAFETY_RULES, must_research_first
from app.domains.baby.lifecycle import now, owned, readable_journal_children
from app.domains.baby.models import BabyChild, BabyMembership, BabyRecord, BabySpaceMember
from app.domains.baby.queries import child_timing, records_query, row_scope
from app.domains.baby.schemas import DomainModel
from app.domains.baby.stats import care_stats, custom_days, day_start, last_days, rolling_24h

NOT_AVAILABLE = "not_available_for_this_question"
MAX_CALLS_PER_ROUND = 8
RESULT_CHARS = 30_000
QUESTION_CHARS = 120_000  # Keeps every later request well inside its admission bound.
BRIEF_EXCERPT, FULL_EXCERPT = 1500, 7000
LIST_LIMIT, DAY_LIMIT, EVENT_LIMIT = 12, 60, 60
QUERY_INPUT_CHARS = 600
SAVED_KINDS = ("source", "collection", "question", "routine", "milestone", "custom")
# Saved posts and journal entries have their own tools; a day's log is what was recorded that day.
NOT_IN_DAY_LOG = ("source", "collection", "journal")
# Which private reads a question may use comes from her words alone, settled before anything is read.
# A saved post, an import or a fetched page is only ever text, so none of them can add to this.
# When these miss, Ask says it can't look there and she can ask again: it says less, not more.
LOG_QUESTION = re.compile(
    r"\b(feed\w*|fed|ate|eat\w*|nurs\w*|breast\w*|bottle\w*|formula|pump\w*|sleep\w*|slept|nap\w*|woke|awake|diaper\w*|"
    r"poo\w*|pee\w*|wet|dirty|contraction\w*|kick\w*|medicine\w*|meds?|medication\w*|prescri\w*|antibiotic\w*|dose\w*|dosage|gave|given|"
    r"tylenol|acetaminophen|paracetamol|ibuprofen|motrin|advil|vitamin\w*|prenatal\w*|supplement\w*|blood pressure|bp|temperature|growth|weight|milestone\w*|log|logs|logged|"
    r"stats?|totals?|count|how many|how much|how often|last time|when did|today|tonight|yesterday|morning|afternoon|"
    r"evening|week|weeks|month|months|day|days|date|dates|calendar|appointment\w*|visit\w*|event\w*|schedule\w*|birthday\w*|"
    r"baptism|due|next|upcoming|doctor|happen\w*|going on|doing|update\w*|recap|overview|everything|lately|recent\w*|"
    r"how(?:'s| is| was| has| have))\b",
    re.I,
)
JOURNAL_QUESTION = re.compile(
    r"\b(journal\w*|diary|wrote|written|write|my notes?|i noted|did i note|note down|jot\w*|i said|did i say|feeling\w*|felt|mood|emotion\w*)\b",
    re.I,
)
TOOL_GUIDE = (
    "Only the tools offered can be used for this question, and an entry that isn't available can't be read. If answering "
    "needs something else, say so and suggest she ask about it directly. "
    "Look things up with your tools before answering; they read only what this parent can see. Saved text "
    "rarely uses the parent's exact words, so if a search finds little, try other words for the same thing "
    "(nursing for breastfeeding). Prefer the fewest tools that answer the question. A tool returning an error "
    "field found nothing: say what you could not find, and never guess. "
    "Never count entries yourself. Any total comes from care_stats or day_log's totals, which the app computes and "
    "the Stats screen also shows. For 'this week' or 'the past week' use range 7d, which is what Stats calls a week, "
    "and say which dates it covers. Report totals as what was logged. Today so far is partial. "
)



class Tool(NamedTuple):
    schema: dict  # The description and strict JSON schema the model is shown.
    arguments: type[DomainModel]  # What arrives is checked again here, whatever the model sends.
    read: object


TOOLS = {}
TOOL_PERMISSIONS = {}


def tool(name, description, arguments, properties, *, permission="saved"):
    """Register a read. Strict schemas need every property listed, so optional ones are nullable."""

    def register(read):
        TOOL_PERMISSIONS[name] = permission
        TOOLS[name] = Tool(
            {
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": list(properties),
                    "additionalProperties": False,
                },
            },
            arguments,
            read,
        )
        return read

    return register


CHILD_PROPERTY = {
    "type": ["string", "null"],
    "description": "A child id from baby_profile, 'none' for logs with no child, or null for the child in focus.",
}


def unavailable(reason):
    return {"error": reason}


def permissions_for(question):
    """What this question may read. Saved posts are what Ask is for, so any question can reach those."""
    text = (question or "").replace("\u2019", "'")
    return {
        "saved",
        *(("logs",) if LOG_QUESTION.search(text) else ()),
        *(("journal",) if JOURNAL_QUESTION.search(text) else ()),
    }


def permission_for_kind(kind):
    if kind == "journal":
        return "journal"
    return "saved" if kind in SAVED_KINDS else "logs"


def tool_fields(may_use_tools, forced, permissions):
    """What this question may use, and how this round. A required first tool is used once."""
    choice = "auto" if may_use_tools else "none"
    if may_use_tools and forced:
        choice = {"type": "function", "name": forced.pop(0)}
    return {
        "tools": [
            {"type": "function", "name": name, "strict": True, **tool.schema}
            for name, tool in TOOLS.items()
            if TOOL_PERMISSIONS.get(name, "saved") in permissions
        ],
        "tool_choice": choice,
    }


class AskTools:
    """One question's reads. ``tracked`` and ``citable`` are what the final recheck and citations use."""

    def __init__(self, *, user_id, client, personal_space_id, family, generation, zone, tracked, child_id=None,
                 check=None, provider=None, question="", focus_id=None, history=()):
        self.user_id, self.client, self.personal_space_id = user_id, client, personal_space_id
        self.family, self.generation, self.zone, self.tracked = family, generation, zone, tracked
        self.child_id, self.check = child_id, check
        self.question, self.focus_id = question, focus_id
        self.permissions = permissions_for(question)
        self.citable, self.displays, self.logged = {}, {}, {}
        self.read_chars = 0
        self.provider = provider
        self.read_texts, self.names = [], set()
        self.web_sources, self.research_failed = [], False
        self.history, self.searched = list(history), None
        self.search_query, self.search_frozen = None, False
        self.forced_tools = ["research_trusted"] if must_research_first(question) else []

    def instructions(self, base):
        return base + " " + TOOL_GUIDE + TOOL_RULES + SAFETY_RULES

    def request_fields(self, may_use_tools):
        return tool_fields(may_use_tools, self.forced_tools, self.permissions)

    async def scope(self, db):
        """Access as of now. ``check`` also stops this read if consent or access changed since the question began."""
        from app.domains.baby.access import access_for
        from app.domains.baby.chat import chat_scopes

        if self.check:
            access = await self.check(db)
        else:
            access = await access_for(
                db, self.user_id, client=self.client,
                space_id=self.personal_space_id if self.family else None, generation=self.generation,
            )
        return chat_scopes(access)[0] if access.enabled else self.user_id

    async def call(self, db, owner, call):
        tool = TOOLS.get(call.get("name"))
        if tool is None:
            return unavailable("unknown_tool")
        if TOOL_PERMISSIONS.get(call.get("name"), "saved") not in self.permissions:
            return unavailable(NOT_AVAILABLE)
        try:
            arguments = tool.arguments.model_validate_json(call.get("arguments") or "{}")
        except ValueError:
            return unavailable("invalid_arguments")
        try:
            return await tool.read(self, db, owner, arguments)
        except ChoiceNeeded as needed:
            return {"error": "choose_child", "children": needed.children}
        except HTTPException as failure:
            if failure.status_code == 404:
                return unavailable("not_found")
            raise
        except ValueError:
            return unavailable("invalid_arguments")

    async def run(self, calls, count):
        from app.db.database import AsyncSessionLocal

        outputs = []
        for index, call in enumerate(calls):
            if index >= MAX_CALLS_PER_ROUND or self.read_chars >= QUESTION_CHARS:
                outputs.append(self.output(call, unavailable("too_many_tool_calls")))
                continue
            # A fresh look for each read: what was allowed a moment ago may not be now.
            async with AsyncSessionLocal() as db:
                owner = await self.scope(db)
                await self.freeze_search(db, owner)
                result = await self.call(db, owner, call)
            # Everything read is closed by now: nothing holds a session across a paid call.
            if isinstance(result, PendingResearch):
                result = await self.research(result, count)
            outputs.append(self.output(call, result))
        return outputs

    async def freeze_search(self, db, owner):
        """Her question, cleaned, before the first read. What's read after this can only stop the search."""
        if not self.search_frozen:
            self.search_query = clean_query(self.question, names=await people_names(self, db, owner))
            self.search_frozen = True

    async def research(self, pending, count):
        # One search per question: asking again gets the same findings, at no cost.
        if self.searched is None:
            self.searched = await self.search_once(pending, count)
        return self.searched

    async def search_once(self, pending, count):
        result, sources = await research_for(self.provider, count, query=pending.query)
        if result["status"] != "ok":
            self.research_failed = True
            return result
        for source in sources:
            if source["url"] not in {known["url"] for known in self.web_sources}:
                self.web_sources.append({**source, "ref": f"S{len(self.web_sources) + 1}"})
        by_url = {known["url"]: known for known in self.web_sources}
        return {**result, "sources": [by_url[source["url"]] for source in sources]}

    def output(self, call, result):
        if call.get("name") != "research_trusted":
            self.read_texts.extend(strings_in(result))
        text = json.dumps({"untrusted_data": result}, ensure_ascii=False, default=str)
        if len(text) > RESULT_CHARS:
            text = json.dumps({"error": "result_too_large"})
        self.read_chars += len(text)
        return {"type": "function_call_output", "call_id": call["call_id"], "output": text}


def search_terms(text):
    from app.domains.baby.chat import query_terms

    return query_terms(text)


def logged_line(row, tools):
    """A medicine she logged, in the record's own values, so what's shown can only be what was saved."""
    if row.kind != "medicine":
        return None
    amount = f" {row.data['dose']}" if row.data.get("dose") else ""
    at = row.occurred_at.astimezone(tools.zone)
    when = at.strftime("at %-I:%M %p") if at.date() == now().astimezone(tools.zone).date() else at.strftime("on %b %-d at %-I:%M %p")
    who = "You logged" if row.app_user_id == tools.user_id else "Logged"
    return f"{who} {row.data.get('name') or row.title}{amount} {when}."


async def entries(tools, db, owner, rows, *, terms=(), limit=BRIEF_EXCERPT, total=24_000):
    """Rows as the model reads them, each becoming citable and rechecked before the answer is saved."""
    from app.domains.baby.chat import display_excerpt, excerpt_for

    readable = await readable_journal_children(db, rows, owner)
    found = []
    for row in rows:
        if total <= 0:
            break
        excerpt = excerpt_for(row, list(terms), limit=min(limit, total), zone=tools.zone)
        total -= len(excerpt)
        item = {
            "id": str(row.id),
            "title": row.title,
            "kind": row.kind,
            "occurred_at": row.occurred_at.astimezone(tools.zone).isoformat(),
            "revision": row.revision,
            "child_id": str(row.child_id) if row.child_id and (row.kind != "journal" or row.child_id in readable) else None,
            "excerpt": excerpt,
            "source_url": row.data.get("url"),
            "evidence_type": "source_claim" if row.kind == "source" else row.data.get("provenance", "caregiver_observation"),
        }
        tools.tracked["records"][row.id] = (row.space_id, row.generation, row.revision)
        tools.citable[item["id"]] = item
        line = logged_line(row, tools)
        if line:
            tools.logged[item["id"]] = line
        tools.displays[item["id"]] = display_excerpt(row, list(terms))
        found.append(item)
    return found


async def child_list(tools, db, owner):
    query = select(BabyChild).where(row_scope(BabyChild, owner, tools.generation), BabyChild.deleted_at.is_(None))
    return list(await db.scalars(query.order_by(BabyChild.name).limit(LIST_LIMIT)))


def child_item(tools, child):
    today = now().astimezone(tools.zone).date()
    tools.tracked["children"][child.id] = (child.space_id, child.generation, child.revision)
    item = {"id": str(child.id), "name": child.name, "stage": "unknown"}
    item.update(child_timing(child, today) or {})
    if item["stage"] == "baby":
        item["baby_age_days"] = (today - child.birth_date).days
    for key in ("due_date", "birth_date"):
        if getattr(child, key):
            item[key] = getattr(child, key).isoformat()
    return item


class PendingResearch(NamedTuple):
    query: str


class ChoiceNeeded(Exception):
    def __init__(self, children):
        self.children = children


async def which_child(tools, db, owner, raw):
    """The child a read is about: the one named, the one in focus, or the only one there is."""
    if raw == "none":
        return None
    if raw is not None:
        return (await owned(db, BabyChild, owner, tools.generation, UUID(raw))).id
    if tools.child_id:
        return (await owned(db, BabyChild, owner, tools.generation, tools.child_id)).id
    children = await child_list(tools, db, owner)
    if len(children) > 1:
        raise ChoiceNeeded([child_item(tools, child) for child in children])
    return children[0].id if children else None


class SearchArguments(DomainModel):
    query: str = Field(min_length=1, max_length=200)


@tool(
    "search_saved",
    "Search saved posts, categories, doctor questions and checklists by words. Not care logs or the journal.",
    SearchArguments,
    {"query": {"type": "string"}},
)
async def search_saved(tools, db, owner, arguments):
    from app.domains.baby.chat import ranked, term_matches

    terms = search_terms(arguments.query)
    query = records_query(owner, tools.generation).where(BabyRecord.kind.in_(SAVED_KINDS))
    matched = bool(terms)
    if terms:
        matches = term_matches(terms)
        rows = list(await db.scalars(
            query.where(or_(*matches))
            .order_by(ranked(matches).desc(), BabyRecord.occurred_at.desc())
            .limit(LIST_LIMIT)
        ))
    else:
        rows = []
    if not rows:
        matched = False
        rows = list(await db.scalars(query.order_by(BabyRecord.occurred_at.desc()).limit(LIST_LIMIT)))
    return {"matched_words": matched, "entries": await entries(tools, db, owner, rows, terms=terms)}


class EntryArguments(DomainModel):
    record_id: UUID


@tool(
    "open_entry",
    "Read one entry in full by its id, for any id a tool gave you.",
    EntryArguments,
    {"record_id": {"type": "string"}},
)
async def open_entry(tools, db, owner, arguments):
    row = await owned(db, BabyRecord, owner, tools.generation, arguments.record_id)
    if row.id != tools.focus_id and permission_for_kind(row.kind) not in tools.permissions:
        return unavailable(NOT_AVAILABLE)
    return (await entries(tools, db, owner, [row], limit=FULL_EXCERPT))[0]


@tool(
    "baby_profile",
    "Who each child is, with ids: name, stage, pregnancy week and day or age, due and birth dates.",
    DomainModel,
    {},
)
async def baby_profile(tools, db, owner, arguments):
    return {"children": [child_item(tools, child) for child in await child_list(tools, db, owner)]}


class DayArguments(DomainModel):
    date: date
    child_id: str | None = Field(default=None, max_length=40)


def day_totals(stats):
    return {
        "feeding": {key: value for key, value in stats["feeding"].items() if not key.startswith(("average", "days"))},
        "diapers": {key: stats["diapers"][key] for key in ("count", "pee", "poo", "dry")},
        "sleep": {key: stats["sleep"][key] for key in ("total_minutes", "longest_minutes", "sleeps")},
        "complete": stats["complete"],
    }


@tool(
    "day_log",
    "Everything recorded on one calendar day, oldest first, with that day's totals counted by the app. Not the journal.",
    DayArguments,
    {"date": {"type": "string", "description": "YYYY-MM-DD, the parent's own calendar day."}, "child_id": CHILD_PROPERTY},
    permission="logs",
)
async def day_log(tools, db, owner, arguments):
    at = now()
    if arguments.date > at.astimezone(tools.zone).date():
        return {"date": arguments.date.isoformat(), "entries": [], "note": "This day has not happened yet."}
    child = await which_child(tools, db, owner, arguments.child_id)
    query = records_query(owner, tools.generation).where(
        BabyRecord.occurred_at >= day_start(arguments.date, tools.zone),
        BabyRecord.occurred_at < day_start(arguments.date + timedelta(days=1), tools.zone),
        BabyRecord.kind.not_in(NOT_IN_DAY_LOG),
        BabyRecord.child_id == child if child else BabyRecord.child_id.is_(None),
    )
    rows = list(await db.scalars(query.order_by(BabyRecord.occurred_at).limit(DAY_LIMIT + 1)))
    stats = await care_stats(
        db, owner, tools.generation, child, tools.zone,
        custom_days(arguments.date, arguments.date, tools.zone, at), tracked=tools.tracked,
    )
    found = await entries(tools, db, owner, rows[:DAY_LIMIT])
    return {
        "date": arguments.date.isoformat(),
        "child_id": str(child) if child else None,
        "totals": day_totals(stats),
        "entries": found,
        "all_entries_shown": len(rows) <= DAY_LIMIT and len(found) == len(rows),
    }


class StatsArguments(DomainModel):
    range: Literal["24h", "7d", "30d", "custom"]
    from_date: date | None = None
    to_date: date | None = None
    child_id: str | None = Field(default=None, max_length=40)


DATE_PROPERTY = {"type": ["string", "null"], "description": "YYYY-MM-DD, or null."}


def stats_range_for(arguments, zone, at):
    """The same ranges the Stats screen offers, built by the same functions."""
    if arguments.range == "24h":
        return rolling_24h(zone, at)
    if arguments.range == "custom":
        if not arguments.from_date or not arguments.to_date:
            raise ValueError("A custom range needs both dates")
        return custom_days(arguments.from_date, arguments.to_date, zone, at)
    return last_days(int(arguments.range[:-1]), zone, at)


@tool(
    "care_stats",
    "Feeding, diaper and sleep totals for a range, the same numbers as the Stats screen. "
    "24h is rolling from now; 7d and 30d are that many finished days plus today; custom needs from_date and to_date.",
    StatsArguments,
    {
        "range": {"type": "string", "enum": ["24h", "7d", "30d", "custom"]},
        "from_date": DATE_PROPERTY,
        "to_date": DATE_PROPERTY,
        "child_id": CHILD_PROPERTY,
    },
    permission="logs",
)
async def care_stats_tool(tools, db, owner, arguments):
    child = await which_child(tools, db, owner, arguments.child_id)
    stats = await care_stats(
        db, owner, tools.generation, child, tools.zone,
        stats_range_for(arguments, tools.zone, now()), tracked=tools.tracked,
    )
    # Totals only: nothing here is a record the model could quote or cite.
    sleep = {key: value for key, value in stats["sleep"].items() if key != "open"}
    sleep["in_progress_since"] = [item["started_at"] for item in stats["sleep"]["open"]]
    return {**stats, "child_id": str(child) if child else None, "sleep": sleep}


class EventArguments(DomainModel):
    from_date: date
    to_date: date
    child_id: str | None = Field(default=None, max_length=40)


@tool(
    "events",
    "Calendar events on the parent's calendar days, inclusive, repeats expanded and changes applied. "
    "With a child: theirs and the whole family's. With null: every event.",
    EventArguments,
    {
        "from_date": {"type": "string", "description": "YYYY-MM-DD"},
        "to_date": {"type": "string", "description": "YYYY-MM-DD"},
        "child_id": {"type": ["string", "null"], "description": "A child id from baby_profile, or null."},
    },
    permission="logs",
)
async def events_tool(tools, db, owner, arguments):
    from app.domains.baby.events import check_range, occurrences, window_for

    try:
        check_range(arguments.from_date, arguments.to_date)
    except HTTPException:
        raise ValueError("Unusable date range") from None
    child = UUID(arguments.child_id) if arguments.child_id else None
    if child:
        await owned(db, BabyChild, owner, tools.generation, child)
    found, complete = await occurrences(
        db, owner, tools.generation, child, window_for(arguments.from_date, arguments.to_date, tools.zone)
    )
    shown = found[:EVENT_LIMIT]
    rows = list(await db.scalars(select(BabyRecord).where(
        BabyRecord.id.in_({item.row.id for item in shown}),
        row_scope(BabyRecord, owner, tools.generation),
        BabyRecord.deleted_at.is_(None),
    )))
    # Events are read as narrow columns, so what the recheck compares comes from the rows themselves.
    await entries(tools, db, owner, rows, limit=300, total=len(rows) * 300)
    for item in shown:
        tools.names.update(item.changes.get("attendees", item.event.attendees) or [])
    return {
        "events": [item.item() for item in shown],
        "all_events_shown": complete and len(found) <= EVENT_LIMIT,
    }


class JournalArguments(DomainModel):
    query: str | None = Field(default=None, max_length=200)
    from_date: date | None = None
    to_date: date | None = None


@tool(
    "journal",
    "Journal entries this parent may read: their own, and any a parent shared with the family. "
    "Optionally by words and by dates; newest first.",
    JournalArguments,
    {"query": {"type": ["string", "null"]}, "from_date": DATE_PROPERTY, "to_date": DATE_PROPERTY},
    permission="journal",
)
async def journal_tool(tools, db, owner, arguments):
    from app.domains.baby.chat import ranked, term_matches

    terms = search_terms(arguments.query) if arguments.query else []
    query = records_query(owner, tools.generation, kind="journal")
    if arguments.from_date:
        query = query.where(BabyRecord.occurred_at >= day_start(arguments.from_date, tools.zone))
    if arguments.to_date:
        query = query.where(BabyRecord.occurred_at < day_start(arguments.to_date + timedelta(days=1), tools.zone))
    order = [BabyRecord.occurred_at.desc()]
    if terms:
        matches = term_matches(terms)
        query = query.where(or_(*matches))
        order.insert(0, ranked(matches).desc())
    rows = list(await db.scalars(query.order_by(*order).limit(LIST_LIMIT)))
    return {"entries": await entries(tools, db, owner, rows, terms=terms, limit=3000)}


async def people_names(tools, db, owner):
    """Everyone this question could name: the parent, those they share with, and the children."""
    names = set(tools.names) | {child.name for child in await child_list(tools, db, owner)}
    members = {tools.user_id}
    if getattr(owner, "enabled", False):
        members |= set(await db.scalars(select(BabySpaceMember.app_user_id).where(
            BabySpaceMember.space_id.in_([grant.id for grant in owner.spaces]))))
    for member in await db.scalars(select(BabyMembership).where(BabyMembership.app_user_id.in_(members))):
        names.add((member.profile or {}).get("display_name"))
    return names


@tool(
    "research_trusted",
    "Search trusted health sites for the parent's own question, as she asked it. Takes nothing from you.",
    DomainModel,
    {},
)
async def research_tool(tools, db, owner, arguments):
    # Frozen before anything was read, so nothing read or remembered can be carried out in it. A later concern refuses.
    query = tools.search_query
    if not query or clean_query(query, names=tools.names) != query or overlaps(query, [*tools.history, *tools.read_texts]):
        tools.research_failed = True
        return unavailable("query_had_private_details")
    return PendingResearch(query)
