from uuid import UUID

from app.media_lifecycle import recipe_media_lock_key


def test_recipe_media_lock_key_is_stable_signed_bigint():
    recipe_id = UUID("11111111-1111-4111-8111-111111111111")

    first = recipe_media_lock_key(recipe_id)
    second = recipe_media_lock_key(str(recipe_id))

    assert first == second
    assert -(2**63) <= first < 2**63
    assert first != recipe_media_lock_key(
        UUID("22222222-2222-4222-8222-222222222222")
    )
