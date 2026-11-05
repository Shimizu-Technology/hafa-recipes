"""F5 role/space matrix tied to the complete live OpenAPI endpoint inventory."""
import json
import re
from datetime import timedelta
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import select

from app.domains.baby import reminders
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyImport,
    BabyNotification,
    BabyRecord,
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
    api.settings.baby_push_enabled = True
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
                role="caregiver" if actor == "caregiver" else "parent", status="active"))
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
    removed = await api.client.delete(f"{API}/family/{family}/members/removed", headers=records.headers(family, generation=1))
    assert removed.status_code == 200, removed.text
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
                 "/care/summary?from=" + at.date().isoformat() + "&to=" + at.date().isoformat(),
                 "/care/stats?range=7d"):
        await call("GET", API + path, 200 if member or path == "/export" else hidden)
    await call("GET", API + "/changes", 200)
    # A phone and its settings belong to the person, so every role has only their own.
    phone = f"{API}/push/devices/install-{actor}"
    registered = await call("PUT", phone, 200, json={"token": f"ExponentPushToken[{actor}]", "platform": "ios"})
    assert (await call("GET", API + "/push/prefs", 200)).json()["kinds"]["event"]["enabled"] is False
    await call("PATCH", API + "/push/prefs", 200, json={"kinds": {"event": {"enabled": True}}})
    await call("DELETE", f"{phone}?registration={registered.json()['registration']}", 204)
    # Reminders are per person too: another person's can be neither read nor dismissed.
    async with api.sessions() as db:
        await reminders.schedule(db, owner="owner", space_id=sample["space"], kind="event", key=f"m-{actor}",
                                 due_at=at - timedelta(minutes=1))
        await db.commit()
        reminder = await db.scalar(select(BabyNotification).where(BabyNotification.idempotency_key.endswith(f"m-{actor}")))
    listed = (await call("GET", API + "/reminders/due", 200)).json()["items"]
    assert str(reminder.id) not in {item["id"] for item in listed}
    await call("POST", f"{API}/reminders/{reminder.id}/dismiss", 204)
    async with api.sessions() as db:
        assert (await db.get(BabyNotification, reminder.id)).dismissed_at is None
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
    split_at = (at + timedelta(days=3)).isoformat()
    await call("POST", event + "/split", 200 if member else hidden, json={"revision": 3, "from_start": split_at, "event": {
        "id": str(uuid4()), "kind": "event", "title": "Next", "occurred_at": split_at,
        "data": {"timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}}}})
    await call("POST", event + "/end-series", 200 if member else hidden,
               json={"from_date": (at + timedelta(days=2)).date().isoformat(), "revision": 4})
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
    await call("POST", f"{API}/records/{rows['source']['id']}/move", 200 if parent else denied,
               json={"space_id": str(sample["space"]), "revision": 2 if parent else 1})
    await call("POST", API + "/family/invites", 201 if parent else (409 if member else hidden), json={"publish_shared": True})
    for path in (f"/family/{sample['space']}/invites", f"/family/{sample['space']}/members"):
        await call("GET", API + path, 200 if parent else (403 if member else 404))
    await call("DELETE", f"{API}/family/{sample['space']}/invites/{invitation['id']}", 200 if parent else hidden)
    # Each person's own phones: nothing of the family's, and no one else's phone to forget.
    await call("GET", API + "/family/readiness", 200)
    await call("POST", f"{API}/family/phones/{uuid4()}/forget", 404 if member else hidden)
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
    for suffix in ("", "/metadata"):
        assert (await c.get(f"{API}/attachments/{owner.asset_id}" + suffix, headers=read)).status_code == 404
    from app.domains.baby.models import BabyMessage

    async with api.sessions() as db:
        private_request = await db.scalar(select(BabyMessage.id).where(
            BabyMessage.conversation_id == UUID(owner.conversation_id), BabyMessage.role == "user"))
    stolen_replay = await c.post(API + "/chat", headers=h,
        json={**request, "request_id": str(private_request)})
    assert stolen_replay.status_code == 404 and len(contexts) == 2



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


async def test_choosing_existing_personal_space_keeps_post_private_in_next_family(matrix):
    api, owner, family, personal, seeded, png, at, invitation = matrix
    own = await invites.personal(api, "stranger")
    h = records.headers(own, "stranger", 1)
    body = privacy.shared.payload("source")
    created = await api.client.post(API + "/records", headers=h, json=body)
    assert created.status_code == 200
    result = await api.client.post(f"{API}/records/{body['id']}/move", headers=h,
        json={"space_id": str(own), "revision": 1})
    assert result.status_code == 200 and result.json()["data"]["just_me"] is True
    invitation = await api.client.post(API + "/family/invites", headers=h, json={"publish_shared": True})
    assert invitation.status_code == 201
    async with api.sessions() as db:
        assert (await db.get(BabyRecord, body["id"])).space_id == own


@pytest.mark.parametrize("client", [None, "2"])
@pytest.mark.parametrize("actor", ROLES)
async def test_legacy_clients_only_see_personal_space(matrix, client, actor):
    api, owner, family, personal, seeded, png, at, invitation = matrix
    h = {"X-Test-Owner": actor}
    if client:
        h["X-Baby-Client"] = client
    denied = await api.client.post(API + "/family/invites", headers={**h, "X-Baby-Generation": "1"}, json={})
    assert denied.status_code == 403, denied.text
    for path in ("/records", "/export", "/search?q=FAMILY_SOURCE_SECRET"):
        result = await api.client.get(API + path, headers=h)
        assert result.status_code == 200, result.text
        assert "FAMILY_SOURCE_SECRET" not in result.text
        assert "OWNER_JOURNAL_SECRET" not in result.text


@pytest.mark.parametrize("action", ["leave", "remove", "account"])
async def test_real_exit_revokes_credentials_and_invites(matrix, action):
    from app.domains.baby.models import BabySpaceInvite
    from app.domains.baby.share_models import BabyShareCredential

    api, owner, family, personal, seeded, png, at, invitation = matrix
    issued = await api.client.post(API + "/family/invites", headers=records.headers(family, "other", 1), json={})
    assert issued.status_code == 201, issued.text
    session = await api.client.post(API + "/share/session", headers=records.headers(family, "other", 1),
        json={"installation_id": str(uuid4())})
    assert session.status_code == 201, session.text
    if action == "leave":
        result = await api.client.post(f"{API}/family/{family}/leave", headers=records.headers(family, "other", 1))
    elif action == "remove":
        result = await api.client.delete(f"{API}/family/{family}/members/other", headers=records.headers(family, generation=1))
    else:
        result = await api.client.delete("/api/users/me", headers={"X-Test-Owner": "other"})
    assert result.status_code in {200, 202}, result.text
    async with api.sessions() as db:
        assert (await db.get(BabySpaceInvite, issued.json()["id"])).revoked_at is not None
        credentials = list(await db.scalars(select(BabyShareCredential).where(BabyShareCredential.app_user_id == "other")))
        assert all(row.revoked_at is not None for row in credentials)
        assert (await db.get(BabySpaceMember, (family, "other"))) is None if action == "account" else (await db.get(BabySpaceMember, (family, "other"))).status != "active"
    assert (await api.client.get(f"{API}/records/{seeded['family']['rows']['source']['id']}",
        headers=records.headers(family, "other", 1))).status_code in {403, 404, 409}


async def test_accept_rejects_actor_already_in_a_family(matrix):
    api, owner, family, personal, seeded, png, at, invitation = matrix
    unused = await api.client.post(API + "/family/invites", headers=records.headers(family, generation=1), json={})
    assert unused.status_code == 201
    assert (await invites.accept(api, unused.json())).status_code == 409


async def test_journal_move_requires_writer(matrix):
    api, owner, family, personal, seeded, png, at, invitation = matrix
    result = await api.client.post(f"{API}/records/{owner.entry['id']}/move", headers=records.headers(personal, generation=1),
        json={"space_id": str(family), "revision": 2})
    assert result.status_code == 200, result.text
    result = await api.client.post(f"{API}/records/{owner.entry['id']}/move", headers=records.headers(family, "other", 1),
        json={"space_id": str(family), "revision": result.json()["revision"]})
    assert result.status_code == 403, result.text


async def test_move_helper_requires_parent(matrix):
    from fastapi import HTTPException

    from app.domains.baby.access import access_for
    from app.domains.baby.moves import move_record

    api, owner, family, personal, seeded, png, at, invitation = matrix
    async with api.sessions() as db:
        access = await access_for(db, "caregiver", client="3", space_id=family, write=True)
        row = await db.get(BabyRecord, seeded["family"]["rows"]["care"]["id"])
        destination = access.target
        with pytest.raises(HTTPException) as caught:
            await move_record(db, access, row, destination)
        assert caught.value.status_code == 403


async def test_caregiver_ask_excludes_family_space(matrix):
    from app.domains.baby.access import access_for
    from app.domains.baby.chat import chat_scopes

    api, owner, family, personal, seeded, png, at, invitation = matrix
    async with api.sessions() as db:
        access = await access_for(db, "caregiver", client="3", bootstrap=True)
        readable, private = chat_scopes(access)
        assert family not in {g.id for g in readable.spaces}
        assert {g.id for g in private.spaces} == {access.personal_space_id}


async def test_changes_filters_capability_attachment_and_conversation_entities(matrix):
    from app.domains.baby.access import access_for, touch
    from app.domains.baby.models import BabyConversation
    from tests import test_baby_changes as changes

    api, owner, family, personal, seeded, png, at, invitation = matrix
    hidden_asset = str(uuid4())
    result = await api.client.post(API + "/attachments", headers={**records.headers(family, generation=1), "Idempotency-Key": hidden_asset},
        files={"file": ("private.png", png, "image/png")})
    assert result.status_code == 200
    credential = await api.client.post(API + "/share/session", headers=records.headers(family, generation=1),
        json={"installation_id": str(uuid4())})
    assert credential.status_code == 201
    own = await invites.personal(api, "other")
    conversation = uuid4()
    async with api.sessions() as db:
        access = await access_for(db, "other", client="3", space_id=own, write=True)
        row = BabyConversation(id=conversation, app_user_id="other", space_id=own, generation=1,
            title="Unavailable context", context_space_ids=[str(personal)])
        await touch(row, access.target)
        await db.commit()
    page = changes.items(await changes.fetch(api, actor="other"))
    assert hidden_asset not in {item["id"] for item in page}
    assert str(conversation) not in {item["id"] for item in page}
    assert not [item for item in page if item.get("entity") in {"credential", "capture"}]
    assert seeded["family"]["asset"] in {item["id"] for item in page if item.get("entity") == "attachment"}
    assert seeded["family"]["rows"]["source"]["id"] in {item["id"] for item in page if item.get("entity") == "record"}


async def test_moved_journal_payload_redacts_unreadable_child(matrix):
    api, owner, family, personal, seeded, png, at, invitation = matrix
    own = await invites.personal(api, "other")
    journal = privacy.shared.payload("journal", child_id=seeded["family"]["child"])
    result = await api.client.post(API + "/records", headers=records.headers(own, "other", 1), json=journal)
    assert result.status_code == 200, result.text
    assert (await api.client.post(f"{API}/family/{family}/leave", headers=records.headers(family, "other", 1))).status_code == 200
    # Join a new family, then retry an old editor against that destination.
    created = await api.client.post(API + "/family/invites", headers=records.headers(own, "other", 1),
        json={"publish_shared": True, "disclosure_version": 1})
    assert created.status_code == 201, created.text
    new_family = created.json()
    result = await api.client.patch(f"{API}/records/{journal['id']}",
        headers=records.headers(new_family["space_id"], "other", 1),
        json={"revision": 1, "body": "Queued edit"})
    assert result.status_code == 409 and result.json()["code"] == "moved", result.text
    assert result.json()["record"]["child_id"] is None


async def test_account_deletion_revokes_historical_invite(matrix):
    from app.domains.baby.models import BabySpaceInvite

    api, owner, family, personal, seeded, png, at, invitation = matrix
    issued = await api.client.post(API + "/family/invites", headers=records.headers(family, "other", 1), json={})
    assert issued.status_code == 201
    # Historical state: account deletion must also revoke invitations when an
    # earlier release already ended membership without retiring the capability.
    async with api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).status = "left"
        await db.commit()
    result = await api.client.delete("/api/users/me", headers={"X-Test-Owner": "other"})
    assert result.status_code == 202, result.text
    async with api.sessions() as db:
        assert (await db.get(BabySpaceInvite, issued.json()["id"])).revoked_at is not None


async def test_move_own_personal_destination(matrix):
    from fastapi import HTTPException

    from app.domains.baby.access import SpaceAccess, access_for
    from app.domains.baby.models import BabySpace
    from app.domains.baby.moves import move_record

    api, owner, family, personal, seeded, png, at, invitation = matrix
    async with api.sessions() as db:
        access = await access_for(db, "owner", client="3", space_id=family, write=True)
        other_personal = await invites.personal(api, "other")
        space = await db.get(BabySpace, other_personal)
        destination = SpaceAccess(space, "parent", 1, db, db.get_transaction())
        row = await db.get(BabyRecord, seeded["family"]["rows"]["care"]["id"])
        with pytest.raises(HTTPException) as caught:
            await move_record(db, access, row, destination)
        assert caught.value.status_code == 403
