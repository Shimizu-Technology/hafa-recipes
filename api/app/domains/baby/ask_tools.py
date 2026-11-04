"""What Ask's model may read. Read-only, argument-checked, and scoped on the server for every round."""

import json
from typing import NamedTuple

from fastapi import HTTPException

from app.domains.baby.schemas import DomainModel

MAX_CALLS_PER_ROUND = 8
RESULT_CHARS = 30_000
QUESTION_CHARS = 120_000  # Keeps every later request well inside its admission bound.



class Tool(NamedTuple):
    schema: dict  # The description and strict JSON schema the model is shown.
    arguments: type[DomainModel]  # What arrives is checked again here, whatever the model sends.
    read: object


TOOLS = {}


def unavailable(reason):
    return {"error": reason}


class AskTools:
    """One question's reads. ``tracked`` and ``citable`` are what the final recheck and citations use."""

    def __init__(self, *, user_id, client, personal_space_id, family, generation, zone, tracked, child_id=None):
        self.user_id, self.client, self.personal_space_id = user_id, client, personal_space_id
        self.family, self.generation, self.zone, self.tracked = family, generation, zone, tracked
        self.child_id = child_id
        self.citable, self.displays = {}, {}
        self.read_chars = 0

    def instructions(self, base):
        return base

    def request_fields(self, may_use_tools):
        if not TOOLS:
            return {}
        return {
            "tools": [
                {"type": "function", "name": name, "strict": True, **tool.schema}
                for name, tool in TOOLS.items()
            ],
            "tool_choice": "auto" if may_use_tools else "none",
        }

    async def scope(self, db):
        """Access as of now, so someone removed mid-answer stops reading at the next round."""
        from app.domains.baby.access import access_for
        from app.domains.baby.chat import chat_scopes

        access = await access_for(
            db, self.user_id, client=self.client,
            space_id=self.personal_space_id if self.family else None, generation=self.generation,
        )
        return chat_scopes(access)[0] if access.enabled else self.user_id

    async def call(self, db, owner, call):
        tool = TOOLS.get(call.get("name"))
        if tool is None:
            return unavailable("unknown_tool")
        try:
            arguments = tool.arguments.model_validate_json(call.get("arguments") or "{}")
        except ValueError:
            return unavailable("invalid_arguments")
        try:
            return await tool.read(self, db, owner, arguments)
        except HTTPException as failure:
            if failure.status_code == 404:
                return unavailable("not_found")
            raise
        except ValueError:
            return unavailable("invalid_arguments")

    async def run(self, calls, count):
        from app.db.database import AsyncSessionLocal

        outputs = []
        async with AsyncSessionLocal() as db:
            owner = await self.scope(db)
            for index, call in enumerate(calls):
                result = (
                    unavailable("too_many_tool_calls")
                    if index >= MAX_CALLS_PER_ROUND or self.read_chars >= QUESTION_CHARS
                    else await self.call(db, owner, call)
                )
                outputs.append(self.output(call, result))
        return outputs

    def output(self, call, result):
        text = json.dumps({"untrusted_data": result}, ensure_ascii=False, default=str)
        if len(text) > RESULT_CHARS:
            text = json.dumps({"error": "result_too_large"})
        self.read_chars += len(text)
        return {"type": "function_call_output", "call_id": call["call_id"], "output": text}
