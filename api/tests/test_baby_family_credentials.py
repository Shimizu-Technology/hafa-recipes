"""F4i stored capabilities, conflicting headers and non-destructive rotation."""
from uuid import uuid4

from app.domains.baby.models import BabyMembership, BabyRecord, BabySpaceMember
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_share_integration as native

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


async def test_stored_family_destination_rotation_and_pending_captures_survive(baby_api, family):
    c = baby_api.client
    c._transport.app.include_router(native.router)
    installation = {"installation_id": str(uuid4())}
    provision = await c.post("/api/v1/baby/share/session", headers=records.headers(family), json=installation)
    assert provision.status_code == 201 and provision.json()["space_id"] == str(family), provision.text
    credential_id, secret = provision.json()["credential_id"], provision.json()["token"]
    capability = {"Authorization": "Bearer " + secret}
    request = native.capture()
    wrong_generation = await c.post("/api/v1/baby/share/captures",
        headers={**capability, "X-Baby-Generation": "1"}, json=request)
    assert wrong_generation.status_code == 409
    result = await c.post("/api/v1/baby/share/captures", headers=capability, json=request)
    assert result.status_code == 202 and result.json()["space_id"] == str(family), result.text
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        source = await db.get(BabyRecord, request["capture_id"])
        capture = await db.get(BabyShareCapture, request["capture_id"])
        assert source.space_id == capture.space_id == family and source.change_seq > 0 and capture.change_seq > 0
        before = capture.change_seq
    result = await c.post("/api/v1/baby/share/captures", headers={**capability, "X-Baby-Space": str(personal)}, json=native.capture())
    assert result.status_code == 409
    rotated = await c.post("/api/v1/baby/share/session", headers=records.headers(personal, generation=1), json=installation)
    assert rotated.status_code == 201 and rotated.json()["credential_id"] == credential_id, rotated.text
    assert (await c.post("/api/v1/baby/share/captures", headers=capability, json=request)).status_code == 401
    new_capability = {"Authorization": "Bearer " + rotated.json()["token"]}
    # Lost-response replay reports the original stored destination without creating another source.
    result = await c.post("/api/v1/baby/share/captures", headers=new_capability, json=request)
    assert result.status_code == 202 and result.json()["replayed"] and result.json()["space_id"] == str(family), result.text
    async with baby_api.sessions() as db:
        capture = await db.get(BabyShareCapture, request["capture_id"])
        assert capture.space_id == family and capture.change_seq == before
        row = await db.get(BabyShareCredential, credential_id)
        assert row.space_id == personal and row.change_seq > 0
    assert (await c.delete("/api/v1/baby/share/session", headers=new_capability)).status_code == 204
    assert (await c.post("/api/v1/baby/share/captures", headers=new_capability, json=native.capture())).status_code == 401


async def test_rotate_after_family_access_ends_preserves_original_receipt(baby_api, family):
    c = baby_api.client
    c._transport.app.include_router(native.router)
    installation = {"installation_id": str(uuid4())}
    result = await c.post("/api/v1/baby/share/session", headers=records.headers(family), json=installation)
    assert result.status_code == 201, result.text
    request = native.capture()
    capability = {"Authorization": "Bearer " + result.json()["token"]}
    assert (await c.post("/api/v1/baby/share/captures", headers=capability, json=request)).status_code == 202
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        (await db.get(BabySpaceMember, (family, "owner"))).status = "left"
        await db.commit()
    result = await c.post("/api/v1/baby/share/session", headers=records.headers(personal, generation=1), json=installation)
    assert result.status_code == 201, result.text
    async with baby_api.sessions() as db:
        assert (await db.get(BabyShareCapture, request["capture_id"])).space_id == family


async def test_caregiver_cannot_provision_a_family_source_capability(baby_api, family):
    baby_api.client._transport.app.include_router(native.router)
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        await db.commit()
    result = await baby_api.client.post("/api/v1/baby/share/session", headers=records.headers(family, "other"),
                                        json={"installation_id": str(uuid4())})
    assert result.status_code == 403
