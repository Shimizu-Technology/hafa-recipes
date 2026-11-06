"""Her doctor, the baby's doctor and where she plans to deliver: what keeps them, who reads them, and what never sends them to a model."""
import json
import re
from importlib import import_module
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.domains.baby.chat import context_pack
from app.domains.baby.models import BabyChild, BabyMembership, BabySpaceMember
from app.domains.baby.router import child_details
from app.domains.baby.schemas import (
    SERVER_PROFILE_FIELDS,
    CareContact,
    ChatRequest,
    Profile,
    ProfilePatch,
)
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests.test_baby_ask_v2 import HEADERS, answered, enable, stub, tool_call  # noqa: F401

baby_api, family = foundation.baby_api, foundation.family
needs_database = foundation.pytestmark
CONTACTS, CHILDREN, PROFILE = "/api/v1/baby/profile/contacts", "/api/v1/baby/children", "/api/v1/baby/profile"
HER_DOCTOR = {"name": "HER_DOCTOR_NAME", "phone": "671-555-0101"}
BABY_DOCTOR = {"name": "BABY_DOCTOR_NAME", "phone": "(671) 555-0102"}
DELIVERY = {"name": "DELIVERY_PLACE_NAME", "phone": "+1 671 555 0103"}
PRIVATE = ("HER_DOCTOR_NAME", "BABY_DOCTOR_NAME", "DELIVERY_PLACE_NAME", "555-0101", "555-0102", "555-0103")


@pytest.mark.parametrize("phone", [
    "671-555-0100", "(671) 555-0100", "+1 671 555 0100", "6715550100", "555-0100", "671.555.0100", "671-555-0100 ext 12", "671-555-0100 x12", "+1-800-555-0199",
])
def test_every_layout_of_a_real_number_is_kept_as_she_typed_it(phone):
    assert CareContact(phone=f"  {phone} ").phone == phone


@pytest.mark.parametrize("phone", ["12345", "call the office", "671-555-0100; drop", "tel:6715550100", "1" * 16, "1-800-FLOWERS"])
def test_what_cant_be_dialled_is_refused(phone):
    with pytest.raises(ValidationError):
        CareContact(phone=phone)


def test_blank_is_nothing_and_a_name_alone_is_fine():
    assert CareContact(name="  ", phone=" ").model_dump() == {"name": None, "phone": None}
    assert CareContact(name="Dr. Cruz").model_dump() == {"name": "Dr. Cruz", "phone": None}


def test_child_details_keep_a_doctor_through_anything_that_doesnt_mention_one():
    stored = {"doctor": BABY_DOCTOR, "sex": "girl"}
    assert child_details(stored, {"feeding": "both", "sex": "boy"})["doctor"] == BABY_DOCTOR
    assert child_details(stored, {"doctor": {"name": "New", "phone": ""}})["doctor"] == {"name": "New"}
    assert "doctor" not in child_details(stored, {"doctor": None})
    assert "doctor" not in child_details(stored, {"doctor": {"name": " ", "phone": ""}})


def test_contacts_are_never_in_the_profile_a_phone_reads_and_echoes():
    assert "contacts" in SERVER_PROFILE_FIELDS and "contacts" not in ProfilePatch.model_fields
    stored = Profile(contacts={"doctor": HER_DOCTOR})
    assert stored.model_dump()["contacts"] == {"doctor": HER_DOCTOR}, "a profile save has to carry them along"
    assert "contacts" not in stored.model_dump(exclude=SERVER_PROFILE_FIELDS)


# Everything that builds a model's prompt. The only reads of a child there name their fields, so a new key can't arrive by accident.
AI_MODULES = ("chat", "ask_v2", "ask_tools", "ask_check", "ask_research", "ask_safety", "provider", "processing", "suggestions", "imports")


@pytest.mark.parametrize("name", AI_MODULES)
def test_no_module_that_talks_to_a_model_reads_these_fields(name):
    words = Path(import_module(f"app.domains.baby.{name}").__file__).read_text()
    assert not re.search(r"""\.details\b|["']details["']|["']contacts["']|\bchild_response\b""", words), name


@needs_database
async def test_saving_merges_clears_and_is_refused_kindly(baby_api):
    c = baby_api.client
    assert (await c.post("/api/v1/baby/bootstrap", headers=shared.GEN)).json()["contacts"] == {}
    assert (await c.patch(CONTACTS, headers=shared.GEN, json={"doctor": HER_DOCTOR})).json() == {"doctor": HER_DOCTOR}
    both = (await c.patch(CONTACTS, headers=shared.GEN, json={"delivery": {**DELIVERY, "extra": "ignored"}})).json()
    assert both == {"doctor": HER_DOCTOR, "delivery": DELIVERY}
    assert (await c.patch(CONTACTS, headers=shared.GEN, json={"doctor": {"name": "", "phone": ""}})).json() == {"delivery": DELIVERY}
    assert (await c.patch(CONTACTS, headers=shared.GEN, json={"delivery": None})).json() == {}
    refused = await c.patch(CONTACTS, headers=shared.GEN, json={"doctor": {"phone": "soon"}})
    assert refused.status_code == 422 and (await c.get("/api/v1/baby/bootstrap", headers=shared.GEN)).json()["contacts"] == {}
    assert (await c.patch(CONTACTS, headers={"X-Baby-Generation": "9"}, json={"doctor": HER_DOCTOR})).status_code == 409


@needs_database
@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_an_older_phone_saving_its_cached_profile_loses_nothing(baby_api, client):
    """Build 38 sends back all of the profile it read, less the epoch. The API refuses a key it doesn't know."""
    c = baby_api.client
    headers = {**shared.GEN, **({"X-Baby-Client": client} if client else {})}
    if client == "3":
        async with baby_api.sessions() as db:
            await c.post("/api/v1/baby/bootstrap", headers=shared.GEN)
            headers["X-Baby-Space"] = str((await db.get(BabyMembership, "owner")).personal_space_id)
    await c.post("/api/v1/baby/bootstrap", headers=headers)
    assert (await c.patch(CONTACTS, headers=headers, json={"doctor": HER_DOCTOR, "delivery": DELIVERY})).status_code == 200
    cached = (await c.get("/api/v1/baby/bootstrap", headers=headers)).json()["profile"]
    assert not any(word in json.dumps(cached) for word in PRIVATE)
    cached.pop("auto_process_epoch")
    saved = await c.patch(PROFILE, headers=headers, json={**cached, "display_name": "Kami", "ai_consent": False})
    assert saved.status_code == 200, saved.text
    state = (await c.get("/api/v1/baby/bootstrap", headers=headers)).json()
    assert state["profile"]["display_name"] == "Kami" and state["contacts"] == {"doctor": HER_DOCTOR, "delivery": DELIVERY}


@needs_database
async def test_an_older_phone_saving_a_baby_loses_no_doctor(baby_api):
    c = baby_api.client
    child = (await c.post(CHILDREN, headers=shared.GEN, json={"name": "Noa", "details": {"doctor": BABY_DOCTOR, "sex": "girl"}})).json()
    assert child["details"]["doctor"] == BABY_DOCTOR
    edited = await c.patch(f"{CHILDREN}/{child['id']}", headers=shared.GEN, json={"revision": child["revision"], "name": "Noa", "details": {"feeding": "both", "tracking": {"diaper": True}}})
    assert edited.status_code == 200 and edited.json()["details"]["doctor"] == BABY_DOCTOR
    bad = await c.patch(f"{CHILDREN}/{child['id']}", headers=shared.GEN, json={"revision": edited.json()["revision"], "details": {"doctor": {"phone": "soon"}}})
    assert bad.status_code == 422 and "digits" in bad.json()["detail"]


@needs_database
async def test_her_doctor_stays_hers_and_the_babys_doctor_goes_with_the_baby(baby_api, family):
    c = baby_api.client
    mine, theirs = records.headers(family), {**records.headers(family, "other"), "X-Baby-Generation": "1"}
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        await db.commit()
    await c.post("/api/v1/baby/bootstrap", headers={"X-Baby-Client": "3"})
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    assert (await c.patch(CONTACTS, headers=records.headers(personal, generation=1), json={"doctor": HER_DOCTOR, "delivery": DELIVERY})).status_code == 200
    child = await c.post(CHILDREN, headers=mine, json={"name": "Noa", "details": {"doctor": BABY_DOCTOR}})
    assert child.status_code == 200, child.text
    reader = {"X-Test-Owner": "other", "X-Baby-Client": "3"}
    state = (await c.post("/api/v1/baby/bootstrap", headers=reader)).json()
    assert state["contacts"] == {}
    assert [one["details"]["doctor"] for one in state["children"]] == [BABY_DOCTOR]
    assert "HER_DOCTOR_NAME" not in json.dumps(state) and "DELIVERY_PLACE_NAME" not in json.dumps(state)
    exported = (await c.get("/api/v1/baby/export", headers=reader)).json()
    assert exported["contacts"] == {} and "HER_DOCTOR_NAME" not in json.dumps(exported)
    assert "BABY_DOCTOR_NAME" in json.dumps(exported)
    # A caregiver reads it and doesn't change it.
    assert (await c.patch(f"{CHILDREN}/{child.json()['id']}", headers=records.headers(family, "other"), json={"revision": 1, "details": {"doctor": None}})).status_code == 403
    assert (await c.patch(CONTACTS, headers={**theirs, "X-Baby-Space": str(family), "X-Baby-Generation": "7"}, json={"doctor": DELIVERY})).status_code == 200
    assert (await c.get("/api/v1/baby/bootstrap", headers={"X-Baby-Client": "3"})).json()["contacts"]["doctor"] == HER_DOCTOR, "their own, and not hers"
    own = (await c.get("/api/v1/baby/export", headers={"X-Baby-Client": "3"})).json()
    assert own["contacts"] == {"doctor": HER_DOCTOR, "delivery": DELIVERY}


@needs_database
async def test_erasing_takes_them_with_it(baby_api):
    c = baby_api.client
    await c.post("/api/v1/baby/bootstrap", headers=shared.GEN)
    await c.patch(CONTACTS, headers=shared.GEN, json={"doctor": HER_DOCTOR})
    child = (await c.post(CHILDREN, headers=shared.GEN, json={"name": "Noa", "details": {"doctor": BABY_DOCTOR}})).json()
    # Removing one baby clears that baby's.
    assert (await c.delete(f"{CHILDREN}/{child['id']}?revision={child['revision']}", headers=shared.GEN)).status_code == 204
    async with baby_api.sessions() as db:
        assert (await db.scalars(select(BabyChild).where(BabyChild.id == child["id"]))).one().details == {}
    assert (await c.delete("/api/v1/baby/data?generation=1", headers=shared.GEN)).status_code == 200
    async with baby_api.sessions() as db:
        assert (await db.get(BabyMembership, "owner")).profile == {}


@needs_database
async def test_ask_context_carries_none_of_them(baby_api):
    c = baby_api.client
    await c.post("/api/v1/baby/bootstrap", headers=shared.GEN)
    await c.patch(CONTACTS, headers=shared.GEN, json={"doctor": HER_DOCTOR, "delivery": DELIVERY})
    await c.post(CHILDREN, headers=shared.GEN, json={"name": "Noa", "due_date": "2026-12-10", "details": {"doctor": BABY_DOCTOR}})
    async with baby_api.sessions() as db:
        pack = await context_pack(db, "owner", 1, ChatRequest(message="Hi"), ZoneInfo("Pacific/Guam"))
    assert pack["children"][0]["name"] == "Noa"
    assert not any(word in json.dumps(pack, default=str) for word in PRIVATE)


@needs_database
@pytest.mark.parametrize("headers", [shared.GEN, HEADERS], ids=["old path", "new Ask"])
async def test_no_request_to_a_model_carries_any_of_them(baby_api, stub, headers):  # noqa: F811
    """A whole question at the HTTP layer. On the new Ask the model also reads the baby's profile through its own tool."""
    c = baby_api.client
    await enable(baby_api)
    await c.patch(CONTACTS, headers=headers, json={"doctor": HER_DOCTOR, "delivery": DELIVERY})
    await c.post(CHILDREN, headers=headers, json={"name": "Noa", "due_date": "2026-12-10", "details": {"doctor": BABY_DOCTOR}})
    stub.replies = [tool_call("baby_profile", "{}"), answered("Noa is due in December.")]
    reply = await c.post("/api/v1/baby/chat", headers=headers, json={"request_id": str(uuid4()), "message": "Who is my baby's doctor?", "ask_v2": True})
    assert reply.status_code == 200, reply.text
    assert any("Noa" in json.dumps(body) for body in stub.sent), "what the model was told about her baby is in here"
    assert not any(word in json.dumps(body) for body in stub.sent for word in PRIVATE)
