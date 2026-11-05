"""BABY_FAMILY_TEST_USERS: during the rehearsal only listed accounts can make or take an invite."""
import pytest

from app.domains.baby.models import BabyMembership
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests import test_baby_invites as invites_tests
from tests import test_baby_moves as moves

baby_api, enabled, pytestmark = moves.baby_api, moves.enabled, moves.pytestmark
invites, create, personal, accept = (invites_tests.invites, invites_tests.create,
                                     invites_tests.personal, invites_tests.accept)


def client(actor="owner"):
    return {"X-Test-Owner": actor, "X-Baby-Client": "3"}


async def bootstrap(api, actor="owner", method="post"):
    result = await getattr(api.client, method)("/api/v1/baby/bootstrap", headers=client(actor))
    assert result.status_code == 200, result.text
    return result.json()


async def named(api, actor, name):
    async with api.sessions() as db:
        member = await db.get(BabyMembership, actor)
        member.profile = {**member.profile, "display_name": name}
        await db.commit()


async def posts(api, space, actor, code):
    """Every POST the invite flag closes, as this account."""
    h = records.headers(space, actor, 1)
    return [await api.client.post("/api/v1/baby/family/invites", headers=h,
                                  json={"publish_shared": True, "disclosure_version": 2}),
            await api.client.post("/api/v1/baby/family/phones/confirm", headers=h, json={}),
            await api.client.post("/api/v1/baby/family/invites/preview", headers=h, json={"code": code}),
            await api.client.post("/api/v1/baby/family/invites/accept", headers=h,
                                  json={"code": code, "disclosure_version": 2})]


async def test_unset_changes_nothing(baby_api, invites):
    assert "family_available" not in await bootstrap(baby_api)
    assert "family_available" not in await bootstrap(baby_api, method="get")
    invitation = await create(baby_api, invites)
    assert (await accept(baby_api, invitation)).status_code == 200


@pytest.mark.parametrize("blank", ["", " ", " , ,"])
async def test_a_blank_list_is_unset(baby_api, invites, blank):
    baby_api.settings.baby_family_test_users = blank
    assert "family_available" not in await bootstrap(baby_api)
    assert (await accept(baby_api, await create(baby_api, invites))).status_code == 200


async def test_listed_accounts_make_and_take_invites(baby_api, invites):
    baby_api.settings.baby_family_test_users = " owner , other "
    assert "family_available" not in await bootstrap(baby_api)
    assert "family_available" not in await bootstrap(baby_api, "other", "get")
    assert (await accept(baby_api, await create(baby_api, invites))).status_code == 200


async def test_others_get_the_same_answer_as_invites_off(baby_api, invites):
    invitation = await create(baby_api, invites)
    other = await personal(baby_api, "other")
    baby_api.settings.baby_invites_enabled = False
    off = [(r.status_code, r.json()) for r in await posts(baby_api, other, "other", invitation["code"])]
    baby_api.settings.baby_invites_enabled = True
    baby_api.settings.baby_family_test_users = "owner"
    gated = [(r.status_code, r.json()) for r in await posts(baby_api, other, "other", invitation["code"])]
    assert gated == off and {status for status, _ in gated} == {404}
    assert (await bootstrap(baby_api, "other"))["family_available"] is False
    assert (await bootstrap(baby_api, "other", "get"))["family_available"] is False
    # Still good for someone on the list.
    assert (await accept(baby_api, invitation, "other")).status_code == 404
    baby_api.settings.baby_family_test_users = "owner,other"
    assert (await accept(baby_api, invitation, "other")).status_code == 200


async def test_an_older_client_is_left_alone(baby_api, invites):
    baby_api.settings.baby_family_test_users = "owner"
    result = await baby_api.client.post("/api/v1/baby/bootstrap", headers={"X-Test-Owner": "other", "X-Baby-Client": "2"})
    assert result.status_code == 200 and "family_available" not in result.json()


async def test_family_flag_off_says_nothing(baby_api, invites):
    baby_api.settings.baby_family_test_users = "owner"
    baby_api.settings.baby_family_enabled = False
    assert "family_available" not in await bootstrap(baby_api, "other")


async def test_existing_members_keep_working(baby_api, invites):
    invitation = await create(baby_api, invites)
    assert (await accept(baby_api, invitation)).status_code == 200
    family = invitation["space_id"]
    baby_api.settings.baby_family_test_users = "someone-else"
    for actor in ("owner", "other"):
        assert "family_available" not in await bootstrap(baby_api, actor)
    h = records.headers(family, "other", 1)
    saved = await baby_api.client.post("/api/v1/baby/records", headers=h, json=shared.payload("diaper", data={"type": "wet"}))
    assert saved.status_code == 200, saved.text
    assert (await baby_api.client.get("/api/v1/baby/records", headers=h)).status_code == 200
    assert (await baby_api.client.get("/api/v1/baby/changes", headers=client("owner"), params={"cursor": "{}"})).status_code == 200
    assert (await baby_api.client.get(f"/api/v1/baby/family/{family}/members", headers=h)).status_code == 200
    # But nobody new comes in through them, the same as invites off.
    again = await baby_api.client.post("/api/v1/baby/family/invites", headers=h, json={"disclosure_version": 2})
    assert again.status_code == 404
    left = await baby_api.client.post(f"/api/v1/baby/family/{family}/leave", headers=h)
    assert left.status_code == 200, left.text


async def test_the_preview_names_who_invited_them(baby_api, invites):
    await named(baby_api, "owner", " Kami ")
    invitation = await create(baby_api, invites)
    h = client("other")
    preview = (await baby_api.client.post("/api/v1/baby/family/invites/preview", headers=h, json={"code": invitation["code"]})).json()
    assert preview["invitation"] == "Kami invited you to their family."
    assert preview["disclosure"].endswith("Your own journal and anything marked Just me stay private.")
    assert "before creating a family" not in preview["disclosure"] and preview["disclosure_version"] == 2


@pytest.mark.parametrize("name", ["", "   "])
async def test_the_preview_without_a_name(baby_api, invites, name):
    await named(baby_api, "owner", name)
    invitation = await create(baby_api, invites)
    preview = await baby_api.client.post("/api/v1/baby/family/invites/preview", headers=client("other"), json={"code": invitation["code"]})
    assert preview.json()["invitation"] == "You’ve been invited to a family."


async def test_the_preview_when_the_inviter_is_gone(baby_api, invites):
    invitation = await create(baby_api, invites)
    async with baby_api.sessions() as db:
        (await db.get(invites_tests.BabySpaceInvite, invitation["id"])).created_by = None
        await db.commit()
    preview = await baby_api.client.post("/api/v1/baby/family/invites/preview", headers=client("other"), json={"code": invitation["code"]})
    assert preview.json()["invitation"] == "You’ve been invited to a family."


@pytest.mark.parametrize("sent", [1, 2])
async def test_acceptance_records_the_words_it_was_shown(baby_api, invites, sent):
    """A build that still sends 1 shows the API's words, so what it agreed to is the current version."""
    invitation = await create(baby_api, invites)
    result = await baby_api.client.post("/api/v1/baby/family/invites/accept",
        headers=records.headers(await personal(baby_api, "other"), "other", 1),
        json={"code": invitation["code"], "disclosure_version": sent})
    assert result.status_code == 200, result.text
    async with baby_api.sessions() as db:
        assert (await db.get(BabyMembership, "other")).profile["family_disclosures"][-1]["version"] == 2


async def test_an_unknown_version_is_refused(baby_api, invites):
    h = records.headers(invites, generation=1)
    result = await baby_api.client.post("/api/v1/baby/family/invites", headers=h,
                                        json={"publish_shared": True, "disclosure_version": 3})
    assert result.status_code == 422
    assert "personal_space_id" in await bootstrap(baby_api)
    assert all(space["kind"] == "personal" for space in (await bootstrap(baby_api))["spaces"])
