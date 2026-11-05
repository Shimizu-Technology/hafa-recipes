"""What a build reads to choose its client level, on both sides of the family flag."""
from tests import test_baby_invites as invites

baby_api, enabled, pytestmark = invites.baby_api, invites.enabled, invites.pytestmark
API = "/api/v1/baby"


def client(level):
    return {"X-Test-Owner": "owner", "X-Baby-Client": level}


async def test_flag_off_bootstrap_answers_client_3_as_it_answers_client_2_with_no_spaces(baby_api, enabled):
    baby_api.settings.baby_family_enabled = False
    two = await baby_api.client.post(API + "/bootstrap", headers=client("2"))
    three = await baby_api.client.post(API + "/bootstrap", headers=client("3"))
    assert two.status_code == three.status_code == 200
    assert two.json() == three.json()
    assert "spaces" not in three.json()


async def test_flag_off_client_3_is_legacy_elsewhere_which_is_why_a_build_cant_just_send_it(baby_api, enabled):
    baby_api.settings.baby_family_enabled = False
    window = {"from": "2026-11-01", "to": "2026-11-02"}
    assert (await baby_api.client.get(API + "/events", headers=client("3"), params=window)).status_code == 404
    assert (await baby_api.client.get(API + "/events", headers=client("2"), params=window)).status_code == 200
    assert (await baby_api.client.get(API + "/changes", headers=client("3"))).status_code == 404


async def test_flag_on_bootstrap_lists_spaces_and_client_2_keeps_working_in_personal(baby_api, enabled):
    three = await baby_api.client.post(API + "/bootstrap", headers=client("3"))
    assert {space["kind"] for space in three.json()["spaces"]} >= {"personal"}
    two = await baby_api.client.post(API + "/bootstrap", headers=client("2"))
    assert two.status_code == 200
    assert "spaces" not in two.json()
    assert (await baby_api.client.get(API + "/changes", headers=client("3"))).status_code == 200
    assert (await baby_api.client.get(API + "/changes", headers=client("2"))).status_code == 403
