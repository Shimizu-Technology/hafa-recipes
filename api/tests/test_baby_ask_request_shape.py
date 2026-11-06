"""What goes to the provider has to be a request it accepts. The first real run found one that wasn't, which a fake can't show."""

import json
from uuid import uuid4

import pytest

from app.domains.baby.ask_tools import TOOLS
from app.domains.baby.ask_v2 import ANSWER_SCHEMA
from tests import test_baby_integration as shared
from tests.test_baby_ask_research import research_bodies, research_call, search_reply
from tests.test_baby_ask_tools import HEADERS, add, make_tools, run
from tests.test_baby_ask_v2 import USAGE, answered, enable, stub, tool_call  # noqa: F401

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
# What strict mode accepts here: every property required, nothing else allowed, and no validation keywords it doesn't support.
STRICT_KEYWORDS = {"type", "properties", "required", "additionalProperties", "items", "anyOf", "enum", "description", "title"}


def assert_strict(schema, where="schema"):
    assert set(schema) <= STRICT_KEYWORDS, f"{where}: {set(schema) - STRICT_KEYWORDS}"
    if schema.get("type") == "object":
        assert schema["additionalProperties"] is False, where
        assert sorted(schema["required"]) == sorted(schema["properties"]), where
    for name, value in schema.get("properties", {}).items():
        assert_strict(value, f"{where}.{name}")
    if "items" in schema:
        assert_strict(schema["items"], f"{where}[]")
    for index, option in enumerate(schema.get("anyOf", [])):
        assert_strict(option, f"{where}|{index}")


async def ask(baby_api, message, **fields):
    return await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={"request_id": str(uuid4()), "message": message, "ask_v2": True, **fields})


def assert_answer_request(body):
    fmt = body["text"]["format"]
    assert fmt["type"] == "json_schema" and fmt["strict"] is True and fmt["schema"] == ANSWER_SCHEMA
    assert body["store"] is False and body["service_tier"] == "default"
    assert body["include"] == ["reasoning.encrypted_content"]
    for tool in body["tools"]:
        assert tool["type"] == "function" and tool["strict"] is True
        assert_strict(tool["parameters"], tool["name"])


def test_the_answer_schema_is_one_strict_mode_accepts():
    assert_strict(ANSWER_SCHEMA)


@pytest.mark.parametrize("name", sorted(TOOLS))
def test_every_tool_schema_is_one_strict_mode_accepts(name):
    assert_strict(TOOLS[name].schema["parameters"], name)


async def test_no_request_asks_for_json_object_and_each_has_the_right_shape(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    post = await add(baby_api, HEADERS, kind="source", title="A post", data={"source_text": "something saved"})
    stub.replies = [tool_call("open_entry", json.dumps({"record_id": post})), research_call(), search_reply(), answered("From sources [S1].")]
    response = await ask(baby_api, "What do trusted sources say about safe sleep and what did I save?")
    assert response.status_code == 200, response.text
    everything = [*stub.sent, *stub.checks]
    assert "json_object" not in json.dumps(everything)
    research = research_bodies(stub)
    answers = [body for body in stub.sent if body not in research]
    assert len(answers) == 3
    for body in answers:
        assert_answer_request(body)
    # The first round: her question as a message.
    assert [item["role"] for item in answers[0]["input"]] == ["user"] and isinstance(answers[0]["input"][0]["content"], str)
    # A follow-up round: encrypted reasoning, the call and its output, in order, with the output as a string.
    kinds = [item.get("type") for item in answers[1]["input"][1:]]
    assert kinds == ["reasoning", "function_call", "function_call_output"]
    replayed = answers[1]["input"][1:]
    assert replayed[0]["encrypted_content"] and isinstance(replayed[2]["output"], str)
    assert replayed[1]["call_id"] == replayed[2]["call_id"]
    # Research: her question as plain input, a search tool on the list, and no answer format.
    assert len(research) == 1 and isinstance(research[0]["input"], str) and "text" not in research[0]
    assert research[0]["tools"][0]["type"] == "web_search" and research[0]["tool_choice"] == "required" and research[0]["store"] is False
    # The safety checks: strict JSON, with nothing else to call.
    assert len(stub.checks) == 2
    for check in stub.checks:
        fmt = check["text"]["format"]
        assert fmt["type"] == "json_schema" and fmt["strict"] is True and "tools" not in check and check["store"] is False
        assert_strict(fmt["schema"], "check")
        assert isinstance(check["input"][0]["content"], str)


async def test_the_last_round_still_asks_for_the_answer_format(baby_api, stub, monkeypatch):  # noqa: F811
    await enable(baby_api)
    post = await add(baby_api, HEADERS, kind="source", title="A post", data={"source_text": "something saved"})
    stub.replies = [tool_call("open_entry", json.dumps({"record_id": post})) for _ in range(5)] + [answered("Done.", citation_ids=[post])]
    assert (await ask(baby_api, "What did I save?")).status_code == 200
    assert stub.sent[-1]["tool_choice"] == "none"
    assert_answer_request(stub.sent[-1])


async def test_everything_a_round_produced_goes_back_in_its_order(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    post = await add(baby_api, HEADERS, kind="source", title="A post", data={"source_text": "something saved"})
    reply = tool_call("open_entry", json.dumps({"record_id": post}))
    words = {"type": "message", "id": "msg_1", "role": "assistant", "content": [{"type": "output_text", "text": "Let me look.", "annotations": []}]}
    reply["output"].insert(1, words)
    stub.replies = [reply, answered("Done.")]
    assert (await ask(baby_api, "What did I save?")).status_code == 200
    assert [item.get("type") for item in stub.sent[1]["input"][1:]] == ["reasoning", "message", "function_call", "function_call_output"]


def strict_reply(proposal=None, message="Here is a suggestion."):
    text = json.dumps({"message": message, "citation_ids": [], "safety": None, "quotes": [], "proposal": proposal})
    return {"id": "resp_1", "status": "completed", "usage": USAGE, "output": [{"type": "message", "content": [{"type": "output_text", "text": text, "annotations": []}]}]}


NO_DATA = {"timezone": None, "all_day": None, "end": None, "category": None, "location": None}


@pytest.mark.parametrize("kind", ["journal", "question"])
async def test_a_strict_reply_with_nulls_for_what_it_does_not_use_still_offers_the_suggestion(baby_api, stub, kind):  # noqa: F811
    await enable(baby_api)
    stub.replies = [strict_reply({"kind": kind, "title": "A title", "body": "A body", "occurred_at": None, "data": NO_DATA})]
    proposal = (await ask(baby_api, "Please draft something")).json()["proposal"]
    assert proposal["kind"] == kind and proposal["title"] == "A title" and "occurred_at" not in proposal


async def test_a_strict_event_reply_still_offers_the_event(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [strict_reply({"kind": "event", "title": "Check-up", "body": "", "occurred_at": "2026-11-12T09:30:00+10:00", "data": {**NO_DATA, "timezone": "Pacific/Guam", "all_day": False}})]
    proposal = (await ask(baby_api, "Add my check-up")).json()["proposal"]
    assert proposal["kind"] == "event" and proposal["occurred_at"].startswith("2026-11-12T09:30")


async def test_a_strict_reply_with_no_suggestion_is_plain(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [strict_reply()]
    body = (await ask(baby_api, "Tell me something")).json()
    assert body["message"] == "Here is a suggestion." and body["proposal"] is None


# What the first real runs showed.
async def test_a_citation_the_tools_never_gave_takes_the_claim_with_it_and_is_no_503(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    post = await add(baby_api, HEADERS, kind="source", title="A post", data={"source_text": "something saved"})
    invented = "00000000-0000-4000-8000-000000000000"
    stub.replies = [tool_call("open_entry", json.dumps({"record_id": post})), answered("You saved a post.", citation_ids=[post, invented])]
    response = await ask(baby_api, "What did I save?")
    assert response.status_code == 200, response.text
    assert response.json()["message"] == "I couldn't confirm that from your records."
    assert response.json()["citations"] == []


def test_an_answer_points_at_sources_by_ref_and_never_retypes_a_link():
    from app.domains.baby.ask_research import TOOL_RULES
    from app.domains.baby.ask_tools import TOOL_GUIDE
    from app.domains.baby.ask_v2 import BASE_INSTRUCTIONS

    assert "source_urls" not in ANSWER_SCHEMA["properties"] and "source_urls" not in ANSWER_SCHEMA["required"]
    assert "source_urls" not in BASE_INSTRUCTIONS and "source_urls" not in TOOL_RULES and "[S1]" in TOOL_RULES
    assert "partial" in TOOL_GUIDE and "open_entry" in TOOL_GUIDE


def test_guidance_is_reported_without_measuring_the_child_against_it():
    from app.domains.baby.ask_research import TOOL_RULES

    assert "without measuring her or the child against it" in TOOL_RULES


async def test_a_long_entry_from_search_says_it_is_partial_and_open_entry_gives_the_rest(baby_api):
    long_text = "Start here. " + "A sentence about bedtime. " * 200 + "The end says white noise."
    post = await add(baby_api, HEADERS, kind="source", title="Long", data={"source_text": long_text})
    short = await add(baby_api, HEADERS, kind="source", title="Short bedtime", data={"source_text": "A short bedtime note."})
    found = (await run(baby_api, make_tools(question="What did I save about bedtime?"), "search_saved", query="bedtime"))["entries"]
    partial = {row["id"]: row["partial"] for row in found}
    assert partial[post] is True and partial[short] is False
    opened = await run(baby_api, make_tools(question="What did I save about bedtime?"), "open_entry", record_id=post)
    assert "white noise" in opened["excerpt"] and opened["partial"] is False

