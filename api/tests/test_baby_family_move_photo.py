"""Moving an entry with a photo the other parent supplied."""
from app.domains.baby.models import BabyAttachment, BabyRecord, BabySpace
from tests import test_baby_family_recheck as recheck
from tests import test_baby_integration as shared

baby_api, shared_privacy_api, privacy_api, fam, pytestmark = (recheck.baby_api, recheck.shared_privacy_api,
    recheck.privacy_api, recheck.fam, recheck.pytestmark)
API = recheck.API


async def test_just_me_works_when_the_other_parent_supplied_the_photo(fam):
    post = await fam.c.post(API + "/records", headers=fam.h, json=shared.payload("source"))
    assert post.status_code == 200, post.text
    photo = await recheck.upload(fam.api, fam.family, "other")
    added = await fam.c.patch(f"{API}/records/{post.json()['id']}", headers=fam.ho,
        json={"revision": 1, "data": {**post.json()["data"], "attachment_ids": [photo]}})
    assert added.status_code == 200, added.text
    moved = await fam.c.post(f"{API}/records/{post.json()['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": 2})
    assert moved.status_code == 200, moved.text
    assert moved.json()["space_id"] == str(fam.personal)
    assert moved.json()["data"]["attachment_ids"] == [photo]
    async with fam.api.sessions() as db:
        assert (await db.get(BabyAttachment, photo)).space_id == fam.personal
        assert (await db.get(BabyRecord, post.json()["id"])).space_id == fam.personal
    opened = await fam.c.get(f"{API}/attachments/{photo}/metadata", headers=fam.h)
    assert opened.status_code == 200, opened.text
    assert (await fam.c.get(f"{API}/attachments/{photo}/metadata", headers=fam.ho)).status_code == 404


async def test_a_move_that_fails_validation_leaves_nothing_moved(fam):
    other_space_event = await fam.c.post(API + "/records", headers=fam.h, json=shared.payload("source"))
    assert other_space_event.status_code == 200, other_space_event.text
    identifier = other_space_event.json()["id"]
    async with fam.api.sessions() as db:
        row = await db.get(BabyRecord, identifier)
        row.child_id = None
        row.data = {**row.data, "attachment_ids": ["00000000-0000-4000-8000-000000000000"]}
        await db.commit()
    moved = await fam.c.post(f"{API}/records/{identifier}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": 1})
    assert moved.status_code >= 400
    async with fam.api.sessions() as db:
        assert (await db.get(BabyRecord, identifier)).space_id == fam.family
        assert (await db.get(BabySpace, fam.family)) is not None
