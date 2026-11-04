"""F5 role/space matrix tied to the complete live OpenAPI endpoint inventory."""
import json
import re
from datetime import timedelta
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import select

from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyImport,
    BabySpaceMember,
)
from app.domains.baby.provider import AnswerOutput
from app.domains.baby.runtime import BabyWorker
from app.models.identity import AppUser
from tests import test_baby_family_records as records
from tests import test_baby_invites as invites
from tests import test_baby_privacy_integration as privacy
from tests import test_baby_share_integration as native

baby_api, privacy_api, pytestmark = privacy.baby_api, privacy.privacy_api, privacy.pytestmark
ROLES = ("other", "caregiver", "removed", "stranger")
API = "/api/v1/baby"


@pytest.fixture
async def matrix(privacy_api):
    api = privacy_api
    api.settings.baby_family_enabled = api.settings.baby_invites_enabled = api.settings.baby_new_kinds_enabled = True
    from tests.test_baby_moves import enabled
    await enabled.__wrapped__(api)
    api.client._transport.app.include_router(native.router)
    owner = await privacy.seed_private(api)
    personal = await invites.personal(api, "owner")
    assert (await api.client.patch(f"{API}/records/{owner.entry['id']}", headers=records.headers(personal, generation=1),
        json={"revision": 1, "body": "OWNER_JOURNAL_SECRET"})).status_code == 200
    hidden = privacy.shared.payload("source", data={"just_me": True, "source_text": "OWNER_POST_SECRET"})
    assert (await api.client.post(API + "/records", headers=records.headers(personal, generation=1), json=hidden)).status_code == 200
    category = privacy.shared.payload("collection", title="OWNER_CATEGORY_SECRET", data={"just_me": True})
    assert (await api.client.post(API + "/records", headers=records.headers(personal, generation=1), json=category)).status_code == 200
    invitation = await invites.create(api, personal)
    family = UUID(invitation["space_id"])
    async with api.sessions() as db:
        for actor in ROLES[1:]:
            db.add(AppUser(id=actor))
        await db.commit()
    for actor in ROLES[1:]:
        assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": actor})).status_code == 200
    async with api.sessions() as db:
        for actor in ROLES[:-1]:
            db.add(BabySpaceMember(space_id=family, app_user_id=actor,
                role="caregiver" if actor == "caregiver" else "parent", status="removed" if actor == "removed" else "active"))
        for job in await db.scalars(select(BabyImport)):
            job.status = "ready"
        await db.commit()
    seeded = {}
    png = BytesIO()
    Image.new("RGB", (10, 10), "white").save(png, "PNG")
    at = now()
    for name, space in (("personal", personal), ("family", family)):
        h = records.headers(space, generation=1)
        child = await api.client.post(API + "/children", headers=h, json={"name": name + " child"})
        assert child.status_code == 200
        asset = str(uuid4())
        upload = await api.client.post(API + "/attachments", headers={**h, "Idempotency-Key": asset},
            files={"file": ("synthetic.png", png.getvalue(), "image/png")})
        assert upload.status_code == 200
        rows = {}
        for key, kind, data in (("care", "diaper", {"type": "wet"}),
            ("source", "source", {"source_text": name.upper() + "_SOURCE_SECRET", "attachment_ids": [asset]}),
            ("suggestion", "source", {"suggested_category": {"name": "Safe category", "confidence": 1}}),
            ("bulk", "source", {"suggested_category": {"name": "Safe category", "confidence": 1}}),
            ("feed", "feeding", {"method": "breast", "side": "left", "state": "running"}),
            ("session", "kick_session", {}),
            ("routine", "routine", {"routine_type": "schedule", "enabled": True,
                "reminder_at": (at + timedelta(hours=2)).isoformat(), "timezone": "Pacific/Guam"}),
            ("event", "event", {"timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}})):
            body = privacy.shared.payload(kind, title=name.upper() + "_" + key, child_id=child.json()["id"],
                                          occurred_at=at.isoformat(), data=data)
            result = await api.client.post(API + "/records", headers=h, json=body)
            assert result.status_code == 200, result.text
            rows[key] = result.json()
        imported = await api.client.post(API + "/imports", headers=h, json={"id": str(uuid4()), "text": name + " import"})
        assert imported.status_code == 200
        seeded[name] = {"space": space, "child": child.json()["id"], "asset": asset, "rows": rows, "job": imported.json()}
    return api, owner, family, personal, seeded, png.getvalue(), at, invitation


@pytest.mark.parametrize("actor", ROLES)
@pytest.mark.parametrize("destination", ["family", "personal"])
async def test_every_endpoint_role_and_space(matrix, actor, destination):
    api, owner, family, personal, seeded, png, at, invitation = matrix
    c, sample = api.client, seeded[destination]
    h = records.headers(sample["space"], actor, 1)
    member = destination == "family" and actor in {"other", "caregiver"}
    parent = member and actor == "other"
    denied, hidden = (404 if member else 403), 403
    executed = set()
    api.client._transport.app.openapi_schema = None
    inventory = {(method.upper(), path) for path, methods in c._transport.app.openapi()["paths"].items() if path.startswith(API)
                 for method in methods if method in {"get", "post", "patch", "put", "delete"}}
    async def call(method, path, expected, **kwargs):
        templates = [(verb, template) for verb, template in inventory if verb == method and
            re.fullmatch(re.sub(r"\{[^}]+\}", "[^/]+", template), path.split("?", 1)[0])]
        assert len(templates) == 1, (method, path, templates)
        executed.add(templates[0])
        result = await c.request(method, path, headers=kwargs.pop("headers", h), **kwargs)
        assert result.status_code == expected, (actor, destination, method, path, result.status_code, result.text[:400])
        if result.headers.get("content-type", "").startswith("application/json"):
            assert all(word not in result.text for word in ("OWNER_JOURNAL_SECRET", "OWNER_POST_SECRET", "OWNER_CATEGORY_SECRET"))
        return result
    rows, child, asset = sample["rows"], sample["child"], sample["asset"]
    for method, path in (("GET", "/bootstrap"), ("POST", "/bootstrap")):
        await call(method, API + path, 200)
    await call("POST", API + "/enroll", 200 if member else hidden)
    await call("PATCH", API + "/profile", 200 if member else hidden, json={"ai_consent": True})
    for path in ("/children", "/records", "/search?q=SOURCE_SECRET", "/export", "/conversations",
                 "/events?from=" + at.date().isoformat() + "&to=" + at.date().isoformat(),
                 "/care/summary?from=" + at.date().isoformat() + "&to=" + at.date().isoformat()):
        await call("GET", API + path, 200 if member or path == "/export" else hidden)
    await call("GET", API + "/changes", 200)
    await call("GET", f"{API}/records/{rows['care']['id']}", 200 if member else hidden)
    await call("GET", f"{API}/conversations/{owner.conversation_id}", denied)
    await call("POST", API + "/chat", 422 if member else hidden, json={"message": "Summarize everything"})
    await call("POST", API + "/children", 200 if parent else hidden, json={"name": "New child"})
    await call("PATCH", f"{API}/children/{child}", 200 if parent else hidden, json={"revision": 1, "name": "Edited child"})
    await call("POST", API + "/records", 200 if member else hidden, json=privacy.shared.payload("diaper", data={"type": "wet"}))
    await call("PATCH", f"{API}/records/{rows['care']['id']}", 200 if member else hidden, json={"revision": 1, "body": "Edited care"})
    for key, action in (("feed", "feed-action"), ("session", "session-action")):
        await call("POST", f"{API}/records/{rows[key]['id']}/{action}", 200 if member else hidden,
            json={"action_id": str(uuid4()), "action": "finish", "at": (at + timedelta(minutes=1)).isoformat()})
    await call("POST", f"{API}/records/{rows['suggestion']['id']}/suggested-category", 200 if member else denied,
               json={"action": "dismiss", "revision": 1})
    await call("POST", API + "/suggested-categories", 200 if member else denied,
               json={"action": "dismiss", "items": [{"record_id": rows["bulk"]["id"], "revision": 1}]})
    event = f"{API}/events/{rows['event']['id']}"
    await call("PUT", event + "/occurrences", 200 if member else hidden,
               json={"original_start": at.isoformat(), "cancelled": True, "revision": 1})
    await call("DELETE", event + "/occurrences", 200 if member else hidden, params={"original_start": at.isoformat(), "revision": 2})
    await call("POST", event + "/end-series", 200 if member else hidden,
               json={"from_date": (at + timedelta(days=2)).date().isoformat(), "revision": 3})
    await call("POST", API + "/imports", 200 if parent else hidden, json={"id": str(uuid4()), "text": "Caller source"})
    await call("GET", f"{API}/imports/{sample['job']['id']}", 200 if parent else denied)
    await call("POST", f"{API}/imports/{sample['job']['id']}/retry", 403 if parent else denied)
    await call("POST", f"{API}/imports/{sample['job']['id']}/cancel", 200 if parent else denied)
    for suffix in ("", "/metadata"):
        await call("GET", f"{API}/attachments/{asset}" + suffix, 200 if parent else denied)
    await call("POST", f"{API}/attachments/{asset}/release", 204 if parent else hidden)
    await call("POST", API + "/attachments", 200 if member else hidden,
        headers={**h, "Idempotency-Key": str(uuid4())}, files={"file": ("own.png", png, "image/png")})
    await call("DELETE", f"{API}/attachments/{asset}", 204 if parent else hidden)
    await call("POST", API + "/family", 200 if parent else (409 if member else hidden))
    await call("POST", f"{API}/records/{rows['source']['id']}/move", 200 if parent else denied,
               json={"space_id": str(sample["space"]), "revision": 2 if parent else 1})
    await call("POST", API + "/family/invites", 201 if parent else (409 if member else hidden), json={"publish_shared": True})
    for path in (f"/family/{sample['space']}/invites", f"/family/{sample['space']}/members"):
        await call("GET", API + path, 200 if parent else (403 if member else 404))
    await call("DELETE", f"{API}/family/{sample['space']}/invites/{invitation['id']}", 200 if parent else hidden)
    for path in ("preview", "accept"):
        await call("POST", API + "/family/invites/" + path, 409,
                   json={"code": "hfbi_v1.invalid-synthetic-token", **({"disclosure_version": 1} if path == "accept" else {})})
    session = await call("POST", API + "/share/session", 201 if parent else hidden, json={"installation_id": str(uuid4())})
    capability = {"Authorization": "Bearer " + session.json()["token"]} if parent else {"Authorization": "Bearer invalid"}
    await call("POST", API + "/share/captures", 202 if parent else 401, headers=capability, json=native.capture())
    await call("DELETE", API + "/share/session", 204 if parent else 401, headers=capability)
    await call("DELETE", f"{API}/records/{rows['care']['id']}?revision=2", 204 if member else hidden)
    await call("DELETE", f"{API}/children/{child}?revision={2 if parent else 1}", 204 if parent else hidden)
    await call("DELETE", API + "/data?generation=1", 422)
    # Positive exits are exercised by F9c; these test generation and role admission
    # without ending the membership needed by the rest of this inventory.
    wrong = {**h, "X-Baby-Generation": "2"} if member else h
    await call("POST", f"{API}/family/{sample['space']}/leave", 409 if member else hidden, headers=wrong)
    for suffix in ("", "/members/owner"):
        await call("DELETE", f"{API}/family/{sample['space']}" + suffix,
                   409 if parent else hidden, headers=wrong if parent else h)
    assert executed == inventory, inventory - executed


@pytest.mark.parametrize("actor", ROLES)
async def test_hidden_words_ask_replay_followup_export_and_reminders(matrix, actor, monkeypatch):
    api, owner, family, personal, seeded, png, at, invitation = matrix
    c = api.client
    own = await invites.personal(api, actor)
    h = records.headers(own, actor, 1)
    assert (await c.patch(API + "/profile", headers=h, json={"ai_consent": True})).status_code == 200
    body = privacy.shared.payload(body="SELF_JOURNAL_SECRET")
    assert (await c.post(API + "/records", headers=h, json=body)).status_code == 200
    read = {"X-Baby-Client": "3", "X-Test-Owner": actor}
    for word in ("OWNER_JOURNAL_SECRET", "OWNER_POST_SECRET", "PERSONAL_SOURCE_SECRET", "OWNER_CATEGORY_SECRET"):
        response = await c.get(API + "/search", headers=read, params={"q": word})
        assert response.status_code == 200 and response.json()["total"] == 0
    for path in ("/export", "/changes", "/records", "/events?from=" + at.date().isoformat() + "&to=" + at.date().isoformat()):
        response = await c.get(API + path, headers=read)
        assert response.status_code == 200
        assert "OWNER_JOURNAL_SECRET" not in response.text and "PERSONAL_SOURCE_SECRET" not in response.text
        if path in ("/export", "/records", "/changes"):
            assert (seeded["family"]["rows"]["routine"]["id"] in response.text) == (actor in {"other", "caregiver"})
    contexts = []
    class Provider:
        enabled = True
        async def answer(self, **kwargs):
            serialized = json.dumps(kwargs, default=str)
            assert "OWNER_JOURNAL_SECRET" not in serialized and "PERSONAL_SOURCE_SECRET" not in serialized
            assert "SELF_JOURNAL_SECRET" in serialized
            assert ("FAMILY_SOURCE_SECRET" in serialized) == (actor == "other")
            contexts.append(kwargs)
            return AnswerOutput(message="Safe answer", citation_ids=[])
    monkeypatch.setattr("app.domains.baby.chat.BabyProvider", Provider)
    request = {"request_id": str(uuid4()), "message": "Summarize everything", "scope": "all"}
    first = await c.post(API + "/chat", headers=h, json=request)
    assert first.status_code == 200, first.text
    replay = await c.post(API + "/chat", headers=h, json=request)
    assert replay.status_code == 200 and replay.json() == first.json() and len(contexts) == 1
    followup = await c.post(API + "/chat", headers=h, json={**request, "request_id": str(uuid4()), "conversation_id": first.json()["conversation_id"]})
    assert followup.status_code == 200 and len(contexts) == 2
    assert (await c.get(f"{API}/conversations/{owner.conversation_id}", headers=read)).status_code == 404
    assert (await c.post(API + "/chat", headers=h, json={**request, "request_id": str(uuid4()), "conversation_id": owner.conversation_id})).status_code == 404
    assert (await c.get(f"{API}/records/{owner.entry['id']}", headers=read)).status_code == 404


@pytest.mark.parametrize("actor", ROLES)
@pytest.mark.parametrize("destination", ["family", "personal"])
async def test_background_imports_keep_actor_space_and_role(matrix, actor, destination):
    api, owner, family, personal, seeded, png, at, invitation = matrix
    # Clear fixture jobs so the real worker deterministically chooses this actor.
    async with api.sessions() as db:
        for job in await db.scalars(select(BabyImport)):
            job.status = "ready"
        link = await db.get(BabySpaceMember, (family, actor))
        if link is None:
            link = BabySpaceMember(space_id=family, app_user_id=actor, role="parent")
            db.add(link)
        link.role, link.status = "parent", "active"
        await db.commit()
    space = family if destination == "family" else await invites.personal(api, actor)
    result = await api.client.post(API + "/imports", headers=records.headers(space, actor, 1),
                                   json={"id": str(uuid4()), "text": "Actor original"})
    assert result.status_code == 200
    async with api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, actor))
        link.role = "caregiver" if actor == "caregiver" else "parent"
        link.status = "removed" if actor == "removed" else "active"
        if actor == "stranger":
            await db.delete(link)
        await db.commit()
    called = []
    async def processor(request, assets, provider, **kwargs):
        assert all(word not in json.dumps(request) for word in ("OWNER_JOURNAL_SECRET", "OWNER_POST_SECRET", "OWNER_CATEGORY_SECRET"))
        called.append(True)
        return {"title": "Processed", "data": {"status": "ready"}, "status": "ready"}
    assert await BabyWorker(api.sessions, processor=processor).tick()
    allowed = destination == "personal" or actor == "other"
    assert bool(called) == allowed
    async with api.sessions() as db:
        job = await db.get(BabyImport, result.json()["id"])
        assert job.status == ("ready" if allowed else "cancelled")


@pytest.mark.parametrize("actor", ROLES)
@pytest.mark.parametrize("destination", ["family", "personal"])
async def test_deferred_capture_rechecks_role_and_stored_destination(matrix, actor, destination):
    from app.domains.baby.share_models import BabyShareCapture
    from app.domains.baby.share_router import drain_deferred_captures

    api, owner, family, personal, seeded, png, at, invitation = matrix
    own = await invites.personal(api, actor)
    profile = await api.client.patch(API + "/profile", headers=records.headers(own, actor, 1),
        json={"ai_consent": True, "auto_process_shares": True})
    assert profile.status_code == 200
    async with api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, actor))
        if link is None:
            link = BabySpaceMember(space_id=family, app_user_id=actor, role="parent")
            db.add(link)
        link.role, link.status = "parent", "active"
        await db.commit()
    space = family if destination == "family" else own
    h = records.headers(space, actor, 1)
    session = await api.client.post(API + "/share/session", headers=h, json={"installation_id": str(uuid4())})
    assert session.status_code == 201
    for _ in range(5):
        assert (await api.client.post(API + "/imports", headers=h,
            json={"id": str(uuid4()), "text": "Actor queue reservation"})).status_code == 200
    body = native.capture(automatic_epoch=session.json()["auto_process_epoch"])
    capability = {"Authorization": "Bearer " + session.json()["token"]}
    submitted = await api.client.post(API + "/share/captures", headers=capability, json=body)
    assert submitted.status_code == 202 and submitted.json()["status"] == "deferred", submitted.text
    async with api.sessions() as db:
        for job in await db.scalars(select(BabyImport).where(BabyImport.app_user_id == actor)):
            job.status = "ready"
        link = await db.get(BabySpaceMember, (family, actor))
        link.role = "caregiver" if actor == "caregiver" else "parent"
        link.status = "removed" if actor == "removed" else "active"
        if actor == "stranger":
            await db.delete(link)
        await db.commit()
    allowed = destination == "personal" or actor == "other"
    async with api.sessions() as db:
        assert await drain_deferred_captures(db) == int(allowed)
        capture = await db.get(BabyShareCapture, body["capture_id"])
        assert capture.status == ("queued" if allowed else "saved")
        assert capture.space_id == space and capture.change_seq > 0
        job = await db.get(BabyImport, body["capture_id"])
        assert (job is not None) == allowed
