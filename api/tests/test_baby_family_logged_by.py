"""Who logged a shared entry, for everyone in the family and nobody else."""
from sqlalchemy import select

from app.domains.baby.models import BabyMembership
from tests import test_baby_family_recheck as recheck
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, shared_privacy_api, privacy_api, fam, pytestmark = (recheck.baby_api, recheck.shared_privacy_api,
    recheck.privacy_api, recheck.fam, recheck.pytestmark)
API = recheck.API


async def names(fam, actor, **values):
    async with fam.api.sessions() as db:
        member = await db.get(BabyMembership, actor)
        member.profile = {**member.profile, **values}
        await db.commit()


async def test_a_row_says_who_made_it_and_bootstrap_says_their_name(fam):
    await names(fam, "owner", display_name="Kami")
    h = records.headers(fam.family, "owner", 1)
    made = await fam.c.post(API + "/records", headers=h, json=shared.payload("diaper", data={"type": "wet"}))
    assert made.status_code == 200, made.text
    assert made.json()["created_by"] == "owner"
    boot = await fam.c.post(API + "/bootstrap", headers={"X-Test-Owner": "caregiver", "X-Baby-Client": "3"})
    assert boot.json()["people"]["owner"] == "Kami"
    page = await fam.c.get(API + "/records", headers={"X-Test-Owner": "caregiver", "X-Baby-Client": "3"})
    assert next(row for row in page.json()["items"] if row["id"] == made.json()["id"])["created_by"] == "owner"


async def test_someone_who_left_keeps_their_name_on_what_they_logged(fam):
    await names(fam, "other", display_name="Leon")
    result = await fam.c.post(f"{API}/family/{fam.family}/leave", headers=records.headers(fam.family, "other", 1))
    assert result.status_code == 200, result.text
    boot = await fam.c.post(API + "/bootstrap", headers={"X-Test-Owner": "owner", "X-Baby-Client": "3"})
    assert boot.json()["people"]["other"] == "Leon"


async def test_nobody_outside_learns_a_name(fam):
    await names(fam, "owner", display_name="Kami")
    await recheck.add_user(fam.api, "stranger")
    boot = await fam.c.post(API + "/bootstrap", headers={"X-Test-Owner": "stranger", "X-Baby-Client": "3"})
    assert "owner" not in boot.json()["people"]
    left = await fam.c.post(f"{API}/family/{fam.family}/leave", headers=records.headers(fam.family, "other", 1))
    assert left.status_code == 200, left.text
    boot = await fam.c.post(API + "/bootstrap", headers={"X-Test-Owner": "other", "X-Baby-Client": "3"})
    assert "owner" not in boot.json()["people"], "Leaving ends it"


async def test_older_clients_get_neither(fam):
    h = {"X-Test-Owner": "owner", "X-Baby-Client": "2"}
    boot = await fam.c.post(API + "/bootstrap", headers=h)
    assert "people" not in boot.json()
    made = await fam.c.post(API + "/records", headers={**h, "X-Baby-Generation": "1"}, json=shared.payload("diaper", data={"type": "wet"}))
    assert made.status_code == 200, made.text
    assert "created_by" not in made.json()
    async with fam.api.sessions() as db:
        assert await db.scalar(select(BabyMembership.app_user_id).where(BabyMembership.app_user_id == "owner"))
