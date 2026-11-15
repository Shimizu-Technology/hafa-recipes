"""Real DB privacy transitions for HTML, data, image and unlisted grants."""
import importlib
import io
import os
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response
from PIL import Image
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.models.identity import AppUser
from app.models.moderation import UserBlock
from app.models.recipe import Recipe
from app.recipe_links import create_link, limiter, revoke_link
from app.recipe_pages import _images, jpeg, og_image, page, page_data, project, render_page, resolve
from tests.database_safety import require_disposable_test_database

URL = os.getenv('TEST_DATABASE_URL')


def user(name='owner'):
    return ClerkUser(id=name, clerk_user_id='clerk', clerk_issuer='https://test.clerk.accounts.dev', clerk_environment='development')


@pytest.fixture
async def fixture():
    if not URL:
        pytest.skip('TEST_DATABASE_URL required')
    require_disposable_test_database(URL)
    engine = create_async_engine(URL)
    async with engine.begin() as conn:
        await conn.execute(text('DROP SCHEMA public CASCADE'))
        await conn.execute(text('CREATE SCHEMA public'))
        await conn.run_sync(Base.metadata.create_all)
    limiter.reset()
    _images.clear()
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        db.add_all([AppUser(id='owner'), AppUser(id='other')])
        await db.flush()
        recipe = Recipe(id=uuid4(), user_id='owner', source_url='https://example.com/recipe', source_type='manual', extraction_method='manual', extracted={'title': '<script>bad</script>', 'servings': 4, 'components': [{'name': 'Rice', 'ingredients': [{'name': 'rice', 'quantity': '2', 'unit': 'cups', 'secret': 'do not show'}], 'steps': ['Cook'], 'notes': ''}], 'secret': 'do not show'}, raw_text='SECRET', is_public=False, moderation_status='active', extractor_display_name='Test Cook')
        db.add(recipe)
        await db.commit()
        yield db, recipe
    await engine.dispose()


@pytest.mark.asyncio
async def test_private_denials_and_owner_only_creation(fixture):
    db, recipe = fixture
    for key in (str(recipe.id), str(uuid4()), 'invalid', 'x' * 43):
        result = await page(key, db, None)
        assert result.status_code == 404
        assert '<script>bad' not in result.body.decode()
        assert result.headers['cache-control'] == 'private, no-store'
        for method in (page_data, og_image):
            with pytest.raises(HTTPException) as err:
                await method(key, db, None)
            assert err.value.status_code == 404
    for method in (create_link, revoke_link):
        with pytest.raises(HTTPException) as err:
            if method is create_link:
                await method(recipe.id, Response(), user('other'), db)
            else:
                await method(recipe.id, user('other'), db)
        assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_unlisted_rotate_revoke_and_no_discover(fixture):
    db, recipe = fixture
    grant = await create_link(recipe.id, Response(), user(), db)
    token = grant['token']
    assert len(token) == 43 and not recipe.is_public
    assert (await resolve(db, token)).id == recipe.id
    assert (await page_data(token, db, None)).headers['cache-control'] == 'private, no-store'
    image = await og_image(token, db, None)
    assert image.media_type == 'image/jpeg'
    assert Image.open(io.BytesIO(image.body)).size == (1200, 630)
    assert Image.open(io.BytesIO(image.body)).format == 'JPEG'
    replacement = await create_link(recipe.id, Response(), user(), db)
    with pytest.raises(HTTPException):
        await resolve(db, token)
    await revoke_link(recipe.id, user(), db)
    for method in (page_data, og_image):
        with pytest.raises(HTTPException):
            await method(replacement['token'], db, None)
    assert not recipe.is_public


@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['hidden', 'owner_hidden', 'incomplete', 'blocked', 'deleted'])
@pytest.mark.parametrize('public', [False, True])
async def test_moderation_cannot_be_bypassed_with_token(fixture, state, public):
    db, recipe = fixture
    token = (await create_link(recipe.id, Response(), user(), db))['token']
    recipe.is_public = public
    if state == 'hidden':
        recipe.moderation_status = 'hidden'
    elif state == 'owner_hidden':
        (await db.get(AppUser, 'owner')).moderation_status = 'hidden'
    elif state == 'incomplete':
        recipe.review_state = 'source_incomplete'
        recipe.is_public = False
    elif state == 'blocked':
        db.add(UserBlock(blocker_user_id='other', blocked_user_id='owner'))
    else:
        await db.delete(recipe)
    await db.commit()
    for key in (token, str(recipe.id)):
        with pytest.raises(HTTPException) as err:
            await resolve(db, key, user('other'))
        assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_public_projection_escapes_and_redacts(fixture):
    db, recipe = fixture
    recipe.is_public = True
    await db.commit()
    data = project(await resolve(db, str(recipe.id)))
    html = render_page(data, str(recipe.id))
    assert '<script>bad' not in html and '&lt;script&gt;' in html
    for private in ('user_id', 'SECRET', 'do not show', 'raw_text'):
        assert private not in html and private not in str(data)
    for tag in ('noindex', 'og:title', 'og:image', 'image/jpeg', 'twitter:card', 'Shared by Test Cook'):
        assert tag in html


@pytest.mark.asyncio
async def test_missing_migration_fails_closed_and_public_still_works(fixture):
    db, recipe = fixture
    await db.execute(text('DROP TABLE recipe_share_links'))
    recipe.is_public = True
    await db.commit()
    assert (await resolve(db, str(recipe.id))).id == recipe.id
    with pytest.raises(HTTPException):
        await resolve(db, 'x' * 43)
    with pytest.raises(HTTPException) as err:
        await create_link(recipe.id, Response(), user(), db)
    assert err.value.status_code == 503


@pytest.mark.asyncio
async def test_creation_rate_limit(fixture):
    db, recipe = fixture
    for _ in range(10):
        await create_link(recipe.id, Response(), user(), db)
    with pytest.raises(HTTPException) as err:
        await create_link(recipe.id, Response(), user(), db)
    assert err.value.status_code == 429


def test_jpeg_photo_path():
    out = io.BytesIO()
    Image.new('RGB', (80, 60), 'red').save(out, 'WEBP')
    image = Image.open(io.BytesIO(jpeg(out.getvalue())))
    assert image.format == 'JPEG' and image.size == (1200, 630)


@pytest.mark.asyncio
async def test_migration_is_additive_replayable(fixture):
    db, recipe = fixture
    await db.execute(text('DROP TABLE recipe_share_links'))
    await db.execute(text('CREATE TABLE schema_migrations (version integer primary key, name text)'))
    await db.commit()
    migration = importlib.import_module('migrations.062_add_recipe_share_links')
    engine = db.bind
    await migration.run_migration(migration_engine=engine)
    await migration.run_migration(migration_engine=engine)
    assert await db.get(Recipe, recipe.id)
