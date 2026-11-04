"""Web research: what leaves, what comes back, and what happens when search is down."""

import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.domains.baby import ask_research
from app.domains.baby.ask_research import (
    TRUSTED_HEALTH_DOMAINS,
    UNAVAILABLE_NOTICE,
    checked_answer,
    checked_result,
    clean_query,
    domain_of,
    is_trusted,
    needs_trusted_sites,
    strings_in,
)
from app.domains.baby.models import BabyMessage
from app.models.ai import AIInvocation
from tests import test_baby_integration as shared
from tests.test_baby_ask_tools import HEADERS, add, add_child
from tests.test_baby_ask_v2 import USAGE, answered, enable, stub, tool_call  # noqa: F401

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
CDC = "https://www.cdc.gov/safe-sleep"
RESPONSES = "https://api.openai.com/v1/responses"


def search_reply(text="The CDC says to place babies on their back.", urls=(CDC,), searches=1):
    annotations = [{"type": "url_citation", "url": url, "title": f"Title {index}"} for index, url in enumerate(urls)]
    return {
        "id": "resp_search", "status": "completed", "usage": USAGE,
        "output": [
            *({"type": "web_search_call", "status": "completed", "action": {"type": "search"}} for _ in range(searches)),
            {"type": "message", "content": [{"type": "output_text", "text": text, "annotations": annotations}]},
        ],
    }


def research_call(query="How should babies sleep?", topic="health"):
    return tool_call("research_trusted", json.dumps({"query": query, "topic": topic}))


@pytest.mark.parametrize(
    ("url", "trusted"),
    [
        ("https://www.cdc.gov/x", True),
        ("https://CDC.GOV/x", True),
        ("https://my.clevelandclinic.org/x", True),
        ("http://nih.gov/x", True),
        ("https://notcdc.gov/x", False),
        ("https://cdc.gov.example.com/x", False),
        ("https://cdc.gov@example.com/x", False),
        ("https://example.com/cdc.gov", False),
        ("ftp://cdc.gov/x", False),
        ("javascript:alert(1)//cdc.gov", False),
        ("not a url", False),
        ("https://www.mayoclinic.org.evil.test/", False),
    ],
)
def test_the_allowlist_goes_by_where_a_link_really_leads(url, trusted):
    assert is_trusted(url) is trusted


def test_the_list_is_the_packets_and_fits_the_providers_limit():
    assert len(TRUSTED_HEALTH_DOMAINS) == 26 <= 100
    assert len(set(TRUSTED_HEALTH_DOMAINS)) == 26
    assert all("/" not in domain and domain == domain.lower() for domain in TRUSTED_HEALTH_DOMAINS)
    for domain in ("healthychildren.org", "aap.org", "cdc.gov", "cpsc.gov", "dphss.guam.gov", "immunize.org"):
        assert domain in TRUSTED_HEALTH_DOMAINS


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("Does Sunny have reflux?", "Does have reflux?"),
        ("Why does Sunny's skin peel", "Why does skin peel"),
        ("Mina Reyes asks about reflux in babies", "asks about reflux in babies"),
        ("What did Dr. Tan mean by reflux", "What did mean by reflux"),
        ("Call 671-555-1234 about colic in babies", "Call about colic in babies"),
        ("mail mina@example.com about colic", "mail about colic"),
        ("colic on 11/04/2026 in babies", "colic on in babies"),
        ("Colic see https://example.com/x in babies", "Colic see in babies"),
    ],
)
def test_names_and_contact_details_never_survive_cleaning(query, expected):
    assert clean_query(query, names=["Sunny", "Mina Reyes"]) == expected


def test_a_query_that_is_mostly_a_name_goes_nowhere():
    assert clean_query("Sunny Reyes", names=["Sunny Reyes"]) is None


def test_a_name_or_number_from_her_records_stays_home_unless_she_asked_about_it():
    private = ["Aunty Rosa said to try Zarbees at 3am, room 412"]
    assert clean_query("Is Zarbees OK for babies who have Rosa at room 412", private_texts=private) == "Is OK for babies who have at room"
    kept = clean_query("Is Zarbees OK for babies at night", private_texts=private, question="What about Zarbees?")
    assert kept == "Is Zarbees OK for babies at night"
    assert clean_query("How long does colic last", private_texts=["How long does it take"]) == "How long does colic last"


def test_private_text_is_compared_as_written_not_as_escaped_json():
    assert strings_in({"a": ["One\n\nTwo"], "b": {"c": "Three"}, "d": 4}) == ["One\n\nTwo", "Three"]
    private = strings_in({"excerpt": "Night\n\nMYPRIVATEWORD I am so scared"})
    assert clean_query("MYPRIVATEWORD I am so scared and what helps babies at night", private_texts=private) == "and what helps babies at night"


def test_words_copied_from_what_ask_read_are_removed():
    private = ["Exhausted tonight and scared about the birth plan with my mother in law"]
    query = "Why am I scared about the birth plan and how do people usually cope with fear"
    assert clean_query(query, private_texts=private) == "Why am I and how do people usually cope with fear"
    # Most of the question being her words means it isn't a general question.
    assert clean_query("scared about the birth plan", private_texts=private) is None
    assert clean_query("How long does colic last", private_texts=private) == "How long does colic last"


@pytest.mark.parametrize(
    ("text", "trusted"),
    [
        ("How much Tylenol while nursing?", True),
        ("Is honey safe for infants?", True),
        ("Is this stroller safe?", True),  # A product, and a health word: the trusted list wins.
        ("When do babies get vaccines", True),
        ("What helps colic?", True),  # In neither list, so it stays on the trusted list.
        ("Tell me about croup", True),
        ("Good baptism gift ideas", False),
        ("Books to read aloud to a baby", False),
        ("Which stroller brands are popular?", False),
    ],
)
def test_the_open_web_is_only_for_what_is_plainly_something_else(text, trusted):
    assert needs_trusted_sites("general", text) is trusted


def test_the_model_cannot_open_the_web_and_can_only_narrow_it():
    assert needs_trusted_sites("health", "Good baptism gift ideas") is True
    assert needs_trusted_sites("general", "Good baptism gift ideas", "My fever is bad") is True


def test_health_findings_citing_anything_off_the_list_are_dropped_whole():
    good = [{"type": "url_citation", "url": CDC, "title": "CDC"}]
    bad = [*good, {"type": "url_citation", "url": "https://blog.example.com/x", "title": "Blog"}]
    assert checked_result("Back to sleep.", good, health=True)[0]["status"] == "ok"
    assert checked_result("Back to sleep.", bad, health=True) == ({"status": "rejected_source"}, [])
    assert checked_result("See https://blog.example.com/x", good, health=True)[0]["status"] == "rejected_source"
    # The open web is allowed for other questions, and labeled.
    result, sources = checked_result("Gift ideas.", bad, health=False)
    assert result["kind"] == "web" and {source["kind"] for source in sources} == {"web"}


def test_findings_with_no_citation_cannot_be_used():
    assert checked_result("It says so.", [], health=True)[0]["status"] == "no_sources"


def test_tracking_parameters_and_fragments_are_removed_from_links():
    result, sources = checked_result("x", [{"url": CDC + "?utm_source=openai&a=1#top", "title": None}], health=True)
    assert sources[0]["url"] == CDC + "?a=1" and sources[0]["title"] == "www.cdc.gov" and domain_of(sources[0]["url"])


def test_an_answer_keeps_only_the_links_it_was_given():
    offered = [{"url": CDC, "ref": "S1", "title": "CDC", "domain": "www.cdc.gov", "kind": "trusted"},
               {"url": "https://www.aap.org/y", "ref": "S2", "title": "AAP", "domain": "www.aap.org", "kind": "trusted"}]
    message, sources = checked_answer(
        f"Back to sleep [S1] and see [this](https://evil.example/x) or https://evil.example/y and {CDC} [S9].",
        [CDC, "https://evil.example/x"], offered,
    )
    assert "evil.example" not in message and "[S9]" not in message and "[S1]" in message and CDC in message
    assert "this" in message
    assert [source["url"] for source in sources] == [CDC]
    # Web findings always carry links, even if the model listed none.
    assert [source["ref"] for source in checked_answer("Back to sleep", [], offered)[1]] == ["S1", "S2"]
    assert checked_answer("From your entries", [], []) == ("From your entries", [])


class Provider:
    def __init__(self, *replies):
        self.replies, self.bodies, self.searches = list(replies), [], []

    async def responses_call(self, *, capability, model, prompt_version, body, searches=0):
        self.bodies.append(body)
        self.searches.append((capability, searches))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


@pytest.fixture
def settings(monkeypatch):
    values = SimpleNamespace(baby_ask_model="gpt-6-luna", baby_ask_research_model="", baby_ask_research_reasoning_effort="low")
    monkeypatch.setattr(ask_research, "get_settings", lambda: values)
    return values


async def test_the_request_holds_only_the_query_and_the_allowlist(settings):
    provider = Provider(search_reply())
    await ask_research.search(provider, query="How should babies sleep?", health=True)
    body = provider.bodies[0]
    assert body["input"] == "How should babies sleep?"
    assert set(body) == {"instructions", "input", "tools", "tool_choice", "max_tool_calls", "max_output_tokens", "reasoning", "include"}
    assert body["tools"] == [{"type": "web_search", "filters": {"allowed_domains": list(TRUSTED_HEALTH_DOMAINS)}}]
    assert body["tool_choice"] == "required" and body["max_tool_calls"] == 2
    assert provider.searches == [("baby_research", 2)]


async def test_a_general_question_has_no_domain_filter(settings):
    provider = Provider(search_reply())
    await ask_research.search(provider, query="Baptism gift ideas", health=False)
    assert provider.bodies[0]["tools"] == [{"type": "web_search"}]


async def test_a_research_model_can_differ_from_the_ask_model(settings):
    settings.baby_ask_research_model = "gpt-6-astra"
    seen = {}

    class Recording(Provider):
        async def responses_call(self, **kwargs):
            seen.update(model=kwargs["model"], effort=kwargs["body"]["reasoning"]["effort"])
            return search_reply()

    await ask_research.search(Recording(), query="How should babies sleep?", health=True, effort="none")
    assert seen == {"model": "gpt-6-astra", "effort": "low"}


# Through the real endpoint, with the provider stubbed at HTTP.
async def seeded(baby_api):
    await enable(baby_api)
    child = await add_child(baby_api, HEADERS, name="Sunny", due_date="2026-12-10")
    await baby_api.client.patch("/api/v1/baby/profile", headers=HEADERS, json={"display_name": "Mina Reyes"})
    post = await add(baby_api, HEADERS, kind="source", title="Her latch video", data={"source_text": "PRIVATE_SAVED_WORDS about the latch"})
    journal = await add(baby_api, HEADERS, kind="journal", title="Night", body="PRIVATE_JOURNAL_WORDS I am so scared about tonight")
    return child, post, journal


async def post_question(baby_api, message="Is it safe for Sunny to sleep on her side?"):
    return await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={
        "request_id": str(uuid4()), "message": message, "ask_v2": True})


def research_bodies(stub):  # noqa: F811
    return [body for body in stub.sent if body.get("tools") and body["tools"][0].get("type") == "web_search"]


async def test_no_name_or_record_text_goes_out(baby_api, stub):  # noqa: F811
    child, post, journal = await seeded(baby_api)
    stub.replies = [
        tool_call("open_entry", json.dumps({"record_id": post})),
        tool_call("journal", json.dumps({"query": None, "from_date": None, "to_date": None})),
        # Steered by saved text, the model tries to send names and private words out.
        research_call("Sunny Mina Reyes PRIVATE_JOURNAL_WORDS I am so scared about tonight, and how should babies sleep on hot nights in a small room for a long time?"),
        search_reply(),
        answered("Back to sleep [S1].", source_urls=[CDC]),
    ]
    result = await post_question(baby_api)
    assert result.status_code == 200, result.text
    sent = research_bodies(stub)
    assert len(sent) == 1
    outbound = json.dumps(sent[0])
    for private in ("Sunny", "Mina", "Reyes", "PRIVATE_JOURNAL_WORDS", "PRIVATE_SAVED_WORDS", "scared about tonight", child, post, journal):
        assert private not in outbound, private
    assert isinstance(sent[0]["input"], str) and "how should babies sleep on hot nights" in sent[0]["input"]
    assert "user_location" not in outbound and "previous_response_id" not in sent[0] and sent[0]["store"] is False


async def test_a_labeled_general_question_about_health_still_uses_the_allowlist(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [research_call("Which sites talk about colic?", "general"), search_reply(), answered("x")]
    await post_question(baby_api, "What helps colic?")
    assert research_bodies(stub)[0]["tools"][0]["filters"]["allowed_domains"] == list(TRUSTED_HEALTH_DOMAINS)


async def test_sources_are_saved_and_come_back_with_the_conversation(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [research_call(), search_reply(urls=[CDC]), answered("Back to sleep [S1].", source_urls=[CDC])]
    result = (await post_question(baby_api, "How should babies sleep?")).json()
    assert result["sources"] == [{"url": CDC, "title": "Title 0", "domain": "www.cdc.gov", "kind": "trusted", "ref": "S1"}]
    assert result["message"] == "Back to sleep [S1]."
    detail = await baby_api.client.get(f"/api/v1/baby/conversations/{result['conversation_id']}", headers=HEADERS)
    assert detail.json()["messages"][-1]["sources"] == result["sources"]


async def test_an_off_list_health_citation_is_not_shown_or_used(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [research_call(), search_reply("Blog claim", urls=["https://blog.example.com/x"]), answered("From your entries.")]
    result = (await post_question(baby_api, "How should babies sleep?")).json()
    assert result["sources"] == [] and "blog.example.com" not in json.dumps(result)
    assert "blog.example.com" not in json.dumps(stub.sent[-1]["input"][-1])


@pytest.mark.parametrize(
    "failure",
    [httpx.Response(500, text="down"), {"id": "r", "status": "incomplete", "output": [], "usage": USAGE}],
)
async def test_search_being_down_says_so_and_still_answers_from_entries(baby_api, stub, failure):  # noqa: F811
    await enable(baby_api)
    stub.replies = [research_call(), failure, answered("Here is what your entries say.")]
    result = await post_question(baby_api, "How should babies sleep?")
    assert result.status_code == 200, result.text
    assert result.json()["message"] == f"Here is what your entries say.\n\n{UNAVAILABLE_NOTICE}"
    assert result.json()["sources"] == []
    assert json.loads(stub.sent[-1]["input"][-1]["output"]) == {"untrusted_data": {"status": "unavailable"}}


async def test_a_private_looking_query_is_refused_before_any_paid_call(baby_api, stub):  # noqa: F811
    await seeded(baby_api)
    stub.replies = [research_call("Sunny Mina Reyes"), answered("From your entries.")]
    assert (await post_question(baby_api, "Anything?")).status_code == 200
    assert research_bodies(stub) == []
    assert json.loads(stub.sent[-1]["input"][-1]["output"]) == {"untrusted_data": {"error": "query_had_private_details"}}


async def test_only_two_research_calls_per_question(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [research_call(), search_reply(), research_call("How long do babies sleep?"), search_reply(),
                    research_call("When do babies sleep through?"), answered("Done [S1].", source_urls=[CDC])]
    assert (await post_question(baby_api, "How should babies sleep?")).status_code == 200
    assert len(research_bodies(stub)) == 2


async def test_search_fees_are_in_recorded_usage(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [research_call(), search_reply(searches=2), answered("x")]
    await post_question(baby_api, "How should babies sleep?")
    async with baby_api.sessions() as db:
        row = await db.scalar(select(AIInvocation).where(AIInvocation.capability == "baby_research"))
        messages = list(await db.scalars(select(BabyMessage)))
    # 800 uncached and 200 cached input, 50 output, on the stub's priced model, plus two $0.01 calls.
    assert row.status == "success" and row.estimated_cost_microusd >= 20_000
    assert len(messages) == 2


async def test_a_research_failure_does_not_hide_a_withdrawal(baby_api, stub, monkeypatch):  # noqa: F811
    await enable(baby_api)
    from app.domains.baby import provider

    real = provider.BabyProvider.responses_call

    async def revoke_on_research(self, **kwargs):
        if kwargs["capability"] == "baby_research":
            await baby_api.client.patch("/api/v1/baby/profile", headers=HEADERS, json={"ai_consent": False})
        return await real(self, **kwargs)

    monkeypatch.setattr(provider.BabyProvider, "responses_call", revoke_on_research)
    stub.replies = [research_call(), answered("Must not be saved")]
    result = await post_question(baby_api, "How should babies sleep?")
    assert result.status_code in {403, 503}
    assert len(stub.sent) == 1


def test_the_consent_copy_matches_what_this_sends():
    assert "no names" in ask_research.TOOL_RULES and "never words copied" in ask_research.TOOL_RULES
