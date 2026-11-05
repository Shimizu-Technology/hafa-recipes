"""What Ask's model may read. Read-only, argument-checked, and scoped on the server for every round."""

import json
import re
from datetime import date, timedelta
from typing import NamedTuple
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import or_, select

from app.domains.baby.lifecycle import now, owned, readable_journal_children
from app.domains.baby.models import BabyChild, BabyRecord
from app.domains.baby.queries import child_timing, records_query, row_scope
from app.domains.baby.schemas import DomainModel
from app.domains.baby.stats import care_stats, custom_days, day_start

NOT_AVAILABLE = "not_available_for_this_question"
MAX_CALLS_PER_ROUND = 8
RESULT_CHARS = 30_000
QUESTION_CHARS = 120_000  # Keeps every later request well inside its admission bound.
BRIEF_EXCERPT, FULL_EXCERPT = 1500, 7000
LIST_LIMIT, DAY_LIMIT = 12, 60
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


class AskTools:
    """One question's reads. ``tracked`` and ``citable`` are what the final recheck and citations use."""

    def __init__(self, *, user_id, client, personal_space_id, family, generation, zone, tracked, child_id=None, check=None, question="", focus_id=None):
        self.user_id, self.client, self.personal_space_id = user_id, client, personal_space_id
        self.family, self.generation, self.zone, self.tracked = family, generation, zone, tracked
        self.child_id, self.check = child_id, check
        self.question, self.focus_id = question, focus_id
        self.permissions = permissions_for(question)
        self.citable, self.displays = {}, {}
        self.read_chars = 0

    def instructions(self, base):
        return base + " " + TOOL_GUIDE

    def request_fields(self, may_use_tools):
        if not TOOLS:
            return {}
        return {
            "tools": [
                {"type": "function", "name": name, "strict": True, **tool.schema}
                for name, tool in TOOLS.items()
                if TOOL_PERMISSIONS.get(name, "saved") in self.permissions
            ],
            "tool_choice": "auto" if may_use_tools else "none",
        }

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
                result = await self.call(db, await self.scope(db), call)
            outputs.append(self.output(call, result))
        return outputs

    def output(self, call, result):
        text = json.dumps({"untrusted_data": result}, ensure_ascii=False, default=str)
        if len(text) > RESULT_CHARS:
            text = json.dumps({"error": "result_too_large"})
        self.read_chars += len(text)
        return {"type": "function_call_output", "call_id": call["call_id"], "output": text}


def search_terms(text):
    from app.domains.baby.chat import query_terms

    return query_terms(text)


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
