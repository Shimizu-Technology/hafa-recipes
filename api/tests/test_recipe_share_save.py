"""Share-sheet list and private-copy acceptance against disposable Postgres."""
import asyncio
import json
from uuid import UUID

import httpx
import pytest
from fastapi import HTTPException, Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.auth import get_current_user, get_optional_user
from app.db.database import get_db
from app.models.identity import AppUser
from app.models.moderation import UserBlock
from app.models.recipe import Recipe, RecipeNote, SavedRecipe
from app.recipe_links import create_link, limiter, link_status, list_links, revoke_link
from app.recipe_pages import save_shared_recipe
from tests.test_recipe_links import fixture as fixture  # noqa: F401
from tests.test_recipe_links import user


def payload(response):
    return json.loads(response.body)


@pytest.mark.asyncio
async def test_owner_list_pagination_rotation_and_revoke(fixture):
    db, recipe = fixture
    assert await list_links(Response(), 50, 0, user(), db) == []
    for i in range(3):
        item = Recipe(user_id='owner', source_url='', source_type='manual',
                      extracted={'title': f'Recipe {i}'}, thumbnail_url=f'https://example.com/{i}.jpg')
        db.add(item)
        await db.commit()
        await create_link(item.id, Response(), user(), db)
    grant = await create_link(recipe.id, Response(), user(), db)
    response = Response()
    rows = await list_links(response, 2, 0, user(), db)
    later = await list_links(Response(), 2, 2, user(), db)
    assert len(rows) == len(later) == 2
    assert len({row['recipe_id'] for row in rows + later}) == 4
    assert rows[0]['recipe_id'] == recipe.id
    assert all(set(row) == {'recipe_id', 'title', 'thumbnail_url', 'created_at'} for row in rows)
    assert rows[0]['created_at'].tzinfo
    assert response.headers['cache-control'] == 'private, no-store'
    assert grant['token'] not in str(rows + later)
    assert await list_links(Response(), 50, 0, user('other'), db) == []
    await create_link(recipe.id, Response(), user(), db)
    assert len(await list_links(Response(), 50, 0, user(), db)) == 4
    recipe.moderation_status = 'hidden'
    recipe.is_public = True
    await db.commit()
    assert recipe.id in {r['recipe_id'] for r in await list_links(Response(), 50, 0, user(), db)}
    await revoke_link(recipe.id, user(), db)
    assert recipe.id not in {r['recipe_id'] for r in await list_links(Response(), 50, 0, user(), db)}


@pytest.mark.asyncio
@pytest.mark.parametrize('public', [False, True])
async def test_save_private_copy_credit_and_redaction(fixture, public):
    db, recipe = fixture
    recipe.is_public = public
    recipe.thumbnail_url = 'https://example.com/photo.jpg'
    recipe.original_extracted = {'secret': 'ORIGINAL SECRET'}
    recipe.extraction_evidence = {'secret': 'EVIDENCE SECRET'}
    recipe.extracted = recipe.extracted | {'notes': 'Public cooking note'}
    db.add(RecipeNote(recipe_id=recipe.id, user_id='owner', note_text='PRIVATE NOTE'))
    await db.commit()
    grant = await create_link(recipe.id, Response(), user(), db)
    key = str(recipe.id) if public else grant['token']
    result = await save_shared_recipe(key, db, user('other'))
    saved = payload(result)
    assert set(saved) == {'saved', 'recipe_id'} and saved['saved'] is True
    assert result.headers['cache-control'] == 'private, no-store'
    copy = await db.get(Recipe, saved['recipe_id'])
    assert copy.id != recipe.id and copy.user_id == 'other' and not copy.is_public
    # The original cook is credited through sharedCopy and the source URL; the copy's own
    # attribution column names nobody, so contributor/profile queries never see another name.
    assert copy.extractor_display_name is None
    assert copy.extracted['sharedCopy'] == {'sharedBy': 'Test Cook'}
    assert copy.source_url == recipe.source_url == copy.extracted['sourceUrl']
    assert copy.thumbnail_url == recipe.thumbnail_url
    assert copy.extracted['notes'] == 'Public cooking note'
    assert copy.extracted['components'][0]['steps'] == ['Cook']
    assert copy.raw_text is copy.original_extracted is copy.extraction_evidence is None
    assert await db.scalar(select(func.count()).select_from(RecipeNote).where(RecipeNote.recipe_id == copy.id)) == 0
    assert await db.scalar(select(func.count()).select_from(SavedRecipe)) == 0
    serialized = json.dumps(copy.extracted) + str(saved)
    for private in ('SECRET', 'do not show', 'PRIVATE NOTE', 'user_id', 'token_hash', grant['token'], 'owner', user('other').recipe_display_name):
        assert private not in serialized
    # The copy can be opened through the ordinary private-library detail path.
    from app.routers.recipes import recipe_to_detail_response
    detail = recipe_to_detail_response(copy, 'other')
    assert detail.is_owner and detail.extracted.sharedCopy.sharedBy == 'Test Cook'
    assert detail.extractor_display_name is None and detail.source_url == recipe.source_url
    assert detail.extracted.components[0].steps == ['Cook']


@pytest.mark.asyncio
async def test_idempotent_across_retries_tokens_and_public_id(fixture):
    db, recipe = fixture
    recipe.is_public = True
    await db.commit()
    key = (await create_link(recipe.id, Response(), user(), db))['token']
    first = payload(await save_shared_recipe(key, db, user('other')))
    assert payload(await save_shared_recipe(key, db, user('other'))) == first
    assert payload(await save_shared_recipe(str(recipe.id), db, user('other'))) == first
    replacement = (await create_link(recipe.id, Response(), user(), db))['token']
    assert payload(await save_shared_recipe(replacement, db, user('other'))) == first
    db.add(AppUser(id='third'))
    await db.commit()
    second = payload(await save_shared_recipe(replacement, db, user('third')))
    assert second['recipe_id'] != first['recipe_id']
    assert await db.scalar(select(func.count()).select_from(Recipe)) == 3


@pytest.mark.asyncio
async def test_concurrent_retries_create_one_copy(fixture):
    db, recipe = fixture
    key = (await create_link(recipe.id, Response(), user(), db))['token']
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)
    async def save():
        async with sessions() as session:
            return payload(await save_shared_recipe(key, session, user('other')))
    first, second = await asyncio.gather(save(), save())
    assert first == second
    assert await db.scalar(select(func.count()).select_from(Recipe).where(Recipe.user_id == 'other')) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('public', [False, True])
@pytest.mark.parametrize('state', ['hidden', 'owner_hidden', 'incomplete', 'blocked', 'private', 'deleted'])
async def test_save_rechecks_moderation_and_visibility(fixture, public, state):
    db, recipe = fixture
    key = (await create_link(recipe.id, Response(), user(), db))['token']
    recipe.is_public = public
    await db.commit()
    if state == 'hidden':
        recipe.moderation_status = 'hidden'
    elif state == 'owner_hidden':
        (await db.get(AppUser, 'owner')).moderation_status = 'hidden'
    elif state == 'incomplete':
        recipe.extracted = recipe.extracted | {'sourceIncomplete': True}
    elif state == 'blocked':
        db.add(UserBlock(blocker_user_id='other', blocked_user_id='owner'))
    elif state == 'private':
        recipe.is_public = False
    else:
        await db.delete(recipe)
    await db.commit()
    # Private UUIDs never authorize; valid tokens remain grants when made private.
    key = str(recipe.id) if public or state == 'private' else key
    with pytest.raises(HTTPException) as exc:
        await save_shared_recipe(key, db, user('other'))
    assert exc.value.status_code == 404
    assert await db.scalar(select(func.count()).select_from(Recipe).where(Recipe.user_id == 'other')) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['rotate', 'revoke'])
async def test_invalidated_token_denies_even_an_idempotent_retry(fixture, action):
    db, recipe = fixture
    key = (await create_link(recipe.id, Response(), user(), db))['token']
    first = payload(await save_shared_recipe(key, db, user('other')))
    if action == 'rotate':
        await create_link(recipe.id, Response(), user(), db)
    else:
        await revoke_link(recipe.id, user(), db)
    with pytest.raises(HTTPException) as exc:
        await save_shared_recipe(key, db, user('other'))
    assert exc.value.status_code == 404
    assert await db.get(Recipe, first['recipe_id'])  # Already saved copies remain private.


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['revoke', 'rotate', 'make_private'])
async def test_owner_mutation_winning_lock_race_denies_save(fixture, action):
    db, recipe = fixture
    key = (await create_link(recipe.id, Response(), user(), db))['token']
    if action == 'make_private':
        recipe.is_public = True
        await db.commit()
        key = str(recipe.id)
    await db.execute(select(Recipe).where(Recipe.id == recipe.id).with_for_update())
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)
    async with sessions() as session:
        pending = asyncio.create_task(save_shared_recipe(key, session, user('other')))
        try:
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(pending), .1)
            if action == 'revoke':
                await revoke_link(recipe.id, user(), db)
            elif action == 'rotate':
                await create_link(recipe.id, Response(), user(), db)
            else:
                recipe.is_public = False
                await db.commit()
            with pytest.raises(HTTPException) as exc:
                await asyncio.wait_for(pending, 3)
            assert exc.value.status_code == 404
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)


@pytest.mark.asyncio
async def test_private_copy_survives_source_deletion_and_is_private_to_viewer(fixture):
    from app.routers.recipes import get_recipe
    db, recipe = fixture
    key = (await create_link(recipe.id, Response(), user(), db))['token']
    copy_id = payload(await save_shared_recipe(key, db, user('other')))['recipe_id']
    await db.delete(recipe)
    await db.commit()
    copy = await db.get(Recipe, copy_id)
    assert (await get_recipe(copy.id, db, user('other'))).is_owner
    for viewer in (None, user('owner')):
        with pytest.raises(HTTPException) as exc:
            await get_recipe(copy.id, db, viewer)
        assert exc.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize('key', ['unknown', 'x' * 43, '00000000-0000-4000-8000-000000000000'])
async def test_unknown_keys_have_same_denial(fixture, key):
    db, _ = fixture
    with pytest.raises(HTTPException) as exc:
        await save_shared_recipe(key, db, user('other'))
    assert exc.value.status_code == 404
    assert exc.value.detail == 'This recipe isn’t available. It may be private or removed.'


@pytest.mark.asyncio
async def test_missing_062_list_503_public_save_works_token_denies(fixture):
    db, recipe = fixture
    await db.execute(text('DROP TABLE recipe_share_links'))
    recipe.is_public = True
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await list_links(Response(), 50, 0, user(), db)
    assert exc.value.status_code == 503
    assert payload(await save_shared_recipe(str(recipe.id), db, user('other')))['saved']
    with pytest.raises(HTTPException) as exc:
        await save_shared_recipe('x' * 43, db, user('other'))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_http_auth_route_order_bounds_and_rate_limits(fixture):
    # Use the actual registered application: /share-links must precede /{id}.
    from app.main import app
    db, recipe = fixture
    key = (await create_link(recipe.id, Response(), user(), db))['token']
    app.dependency_overrides[get_db] = lambda: db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://test.invalid') as client:
            assert (await client.get('/api/recipes/share-links')).status_code == 401
            assert (await client.post(f'/public/r/{key}/save')).status_code == 401
            app.dependency_overrides[get_current_user] = lambda: user()
            assert (await client.get('/api/recipes/share-links')).json()[0]['recipe_id'] == str(recipe.id)
            for query in ('limit=101', 'limit=0', 'offset=-1'):
                assert (await client.get('/api/recipes/share-links?' + query)).status_code == 422
            assert (await client.post(f'/public/r/{key}/save')).status_code == 400
            app.dependency_overrides[get_current_user] = lambda: user('other')
            app.dependency_overrides[get_optional_user] = lambda: user('other')
            assert (await client.get('/api/recipes/share-links')).json() == []
            limiter.reset()
            for _ in range(30):
                saved = await client.post(f'/public/r/{key}/save')
                assert saved.status_code == 200
            detail = await client.get('/api/recipes/' + saved.json()['recipe_id'])
            assert detail.status_code == 200 and detail.json()['is_owner']
            assert not detail.json()['is_public']
            assert detail.json()['extracted']['sharedCopy'] == {'sharedBy': 'Test Cook'}
            assert detail.json()['extractor_display_name'] is None
            denied = await client.post(f'/public/r/{key}/save')
            assert denied.status_code == 429 and int(denied.headers['retry-after']) > 0
            limiter.reset()
            from app.recipe_links import budget
            await budget('global', 'recipe-page-ceiling', 1)
            # Saturate the actual 12k global ceiling before the save request.
            limiter._quota_events[('global', 'recipe-page-ceiling')].extend(
                [limiter._clock()] * 11999)
            assert (await client.post(f'/public/r/{key}/save')).status_code == 429
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize('name', ['A Håfa cook', '@lanicooks', '', None])
async def test_copy_names_no_sharer_for_placeholder_names(fixture, name):
    db, recipe = fixture
    recipe.is_public = True
    recipe.extractor_display_name = name
    await db.commit()
    saved = payload(await save_shared_recipe(str(recipe.id), db, user('other')))
    copy = await db.get(Recipe, saved['recipe_id'])
    assert copy.extracted['sharedCopy'] == {'sharedBy': None}
    assert copy.extractor_display_name is None


def test_edits_keep_the_shared_copy_credit():
    from app.routers.recipes import RecipeEdit, _build_edited_extracted
    original = {
        'title': 'Rice', 'sourceUrl': 'https://www.instagram.com/@lanicooks/reel/1/', 'servings': 4,
        'components': [{'name': 'Rice', 'ingredients': [{'name': 'rice', 'quantity': '1', 'unit': 'cup'}], 'steps': ['Cook rice']}],
        'nutrition': {'perServing': {}, 'total': {}}, 'sharedCopy': {'sharedBy': 'Lani'},
    }
    edit = RecipeEdit(title='Red rice', servings=4, ingredients=original['components'][0]['ingredients'], steps=['Cook rice'])
    assert _build_edited_extracted(original, edit)['sharedCopy'] == {'sharedBy': 'Lani'}
    assert 'sharedCopy' not in _build_edited_extracted({k: v for k, v in original.items() if k != 'sharedCopy'}, edit)


@pytest.mark.asyncio
async def test_create_and_rotate_return_the_status_created_at(fixture):
    db, recipe = fixture
    created = await create_link(recipe.id, Response(), user(), db)
    status = await link_status(recipe.id, Response(), user(), db)
    assert created['created_at'] == status['created_at'] and created['created_at'].tzinfo
    rotated = await create_link(recipe.id, Response(), user(), db)
    assert rotated['created_at'] == (await link_status(recipe.id, Response(), user(), db))['created_at']
    assert rotated['token'] != created['token']


@pytest.mark.asyncio
async def test_saved_copies_can_never_be_published(fixture):
    from app.routers.recipes import (
        RecipeEdit,
        RecipeSharingUpdate,
        RecipeUpdate,
        edit_recipe,
        toggle_recipe_sharing,
        update_recipe,
    )
    db, recipe = fixture
    recipe.is_public = True
    await db.commit()
    copy_id = payload(await save_shared_recipe(str(recipe.id), db, user('other')))['recipe_id']
    attempts = [
        lambda: toggle_recipe_sharing(UUID(copy_id), RecipeSharingUpdate(is_public=True), db, user('other')),
        lambda: toggle_recipe_sharing(UUID(copy_id), None, db, user('other')),  # older clients flip with no body
        lambda: update_recipe(UUID(copy_id), RecipeUpdate(is_public=True), db, user('other')),
        lambda: edit_recipe(UUID(copy_id), RecipeEdit(title='Rice', servings=4, ingredients=[{'name': 'rice', 'quantity': '2', 'unit': 'cups'}],
                                                       steps=['Cook'], is_public=True), db, user('other')),
    ]
    for attempt in attempts:
        with pytest.raises(HTTPException) as denied:
            await attempt()
        assert denied.value.status_code == 409
        assert denied.value.detail['code'] == 'SHARED_COPY_NOT_PUBLISHABLE'
        await db.rollback()
    copy = await db.get(Recipe, copy_id)
    await db.refresh(copy)
    assert copy.is_public is False
    # Keeping it private still works.
    assert (await toggle_recipe_sharing(UUID(copy_id), RecipeSharingUpdate(is_public=False), db, user('other')))['is_public'] is False


@pytest.mark.asyncio
async def test_create_response_keeps_its_own_date_when_another_device_rotates_right_after(fixture):
    db, recipe = fixture
    other_phone = async_sessionmaker(db.bind, expire_on_commit=False)
    rotated = {}
    commit = db.commit

    async def commit_then_rotate_elsewhere():
        # Phone B rotates the link in the window after A commits (lock released) and before A responds.
        await commit()
        if not rotated:
            async with other_phone() as db_b:
                rotated.update(await create_link(recipe.id, Response(), user(), db_b))

    db.commit = commit_then_rotate_elsewhere
    try:
        created = await create_link(recipe.id, Response(), user(), db)
    finally:
        db.commit = commit
    status = await link_status(recipe.id, Response(), user(), db)
    assert rotated and status['created_at'] == rotated['created_at']
    # A's response describes A's own link, never B's: the app pairs URL and date from this response.
    assert created['created_at'] != rotated['created_at']
    assert created['created_at'] < rotated['created_at']
    assert created['token'] != rotated['token']
