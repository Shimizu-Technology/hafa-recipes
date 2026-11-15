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


@pytest.mark.asyncio
async def test_http_contract_and_public_budget(fixture, monkeypatch):
    import time

    import httpx
    import jwt
    from fastapi import FastAPI

    from app.auth import get_current_user, get_optional_user
    from app.db.database import get_db
    from app.recipe_links import router as links
    from app.recipe_pages import router as pages
    db, recipe = fixture
    secret = 'test-secret-with-at-least-32-bytes'
    monkeypatch.setenv('RECIPE_PROXY_SECRET', secret)
    app = FastAPI()
    app.include_router(links)
    app.include_router(pages)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user()
    app.dependency_overrides[get_optional_user] = lambda: None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://local.invalid', headers={'x-nf-sign': jwt.encode({'iss': 'netlify', 'exp': time.time() + 60}, secret, algorithm='HS256'), 'x-nf-client-connection-ip': '203.0.113.9'}) as client:
        created = await client.post(f'/api/recipes/{recipe.id}/share-link')
        assert created.status_code == 200
        path = '/public/r/' + created.json()['token']
        html_response = await client.get(path)
        assert html_response.status_code == 200
        assert "default-src 'none'" in html_response.headers['content-security-policy']
        assert (await client.get(path + '/data')).json()['title'] == recipe.extracted['title']
        assert (await client.get(path + '/og.jpg')).headers['content-type'] == 'image/jpeg'
        assert (await client.delete(f'/api/recipes/{recipe.id}/share-link')).status_code == 204
        assert (await client.get(path)).status_code == 404
        assert (await client.get(path + '/og.jpg')).status_code == 404
        for _ in range(120):
            response = await client.get('/public/r/unknown')
        assert response.status_code == 429


@pytest.mark.asyncio
async def test_owner_link_status_and_created_at_upgrade(fixture):
    from app.recipe_links import link_status
    db, recipe = fixture
    assert await link_status(recipe.id, Response(), user(), db) == {'active': False, 'created_at': None}
    await create_link(recipe.id, Response(), user(), db)
    status = await link_status(recipe.id, Response(), user(), db)
    assert status['active'] and status['created_at'].tzinfo
    assert set(status) == {'active', 'created_at'}
    with pytest.raises(HTTPException) as exc:
        await link_status(recipe.id, Response(), user('other'), db)
    assert exc.value.status_code == 404
    await db.execute(text('ALTER TABLE recipe_share_links DROP COLUMN created_at'))
    await db.execute(text('CREATE TABLE schema_migrations (version integer primary key, name text)'))
    await db.commit()
    await importlib.import_module('migrations.062_add_recipe_share_links').run_migration(migration_engine=db.bind)
    assert await db.scalar(text('SELECT created_at IS NOT NULL FROM recipe_share_links'))
    await revoke_link(recipe.id, user(), db)
    assert not (await link_status(recipe.id, Response(), user(), db))['active']


@pytest.mark.asyncio
async def test_signed_proxy_budgets(monkeypatch):
    import time

    import jwt
    from starlette.requests import Request

    from app.recipe_links import read_budget, verified_client_ip
    secret = 'test-only-secret-with-at-least-32-bytes'
    monkeypatch.setenv('RECIPE_PROXY_SECRET', secret)
    def request(token='', ip='203.0.113.7', peer='10.0.0.1'):
        return Request({'type': 'http', 'client': (peer, 80), 'headers': [
            (b'x-nf-sign', token.encode()), (b'x-nf-client-connection-ip', ip.encode()),
            (b'x-forwarded-for', b'198.51.100.5')]})
    claims = {'iss': 'netlify', 'exp': time.time() + 60}
    token = jwt.encode(claims, secret, algorithm='HS256')
    assert verified_client_ip(request(token)) == '203.0.113.7'
    for forged in ('', jwt.encode(claims, 'wrong-secret-with-at-least-32-bytes', algorithm='HS256'),
                   jwt.encode(claims | {'exp': 1}, secret, algorithm='HS256'),
                   jwt.encode(claims | {'iss': 'other'}, secret, algorithm='HS256'),
                   jwt.encode({'iss': 'netlify'}, secret, algorithm='HS256')):
        assert verified_client_ip(request(forged)) is None
    assert verified_client_ip(request(token, 'invalid')) is None
    limiter.reset()
    for _ in range(120):
        await read_budget(request(token))
    with pytest.raises(HTTPException) as exc:
        await read_budget(request(token))
    assert exc.value.status_code == 429
    await read_budget(request(token, '203.0.113.8'))
    monkeypatch.delenv('RECIPE_PROXY_SECRET')
    assert verified_client_ip(request(token)) is None
    for _ in range(200):
        await read_budget(request(token))  # No shared 60-view choke without setup.
    limiter.reset()


def test_legacy_projection_attribution_and_estimates():
    from types import SimpleNamespace
    recipe = SimpleNamespace(id=uuid4(), extracted={'times': '20 min', 'ingredients': None},
                             extractor_display_name=' A chef ', source_url='javascript:bad')
    assert project(recipe)['creator'] == 'A Håfa cook'
    assert project(recipe)['time'] is None
    assert project(recipe)['components'][0]['ingredients'] == []
    recipe.extracted = {'components': [None, 'bad', {'ingredients': [None, {'name': 'salt', 'quantityEstimate': {'quantity': '1', 'unit': 'tsp', 'secret': 'private'}}], 'steps': None}]}
    html = render_page(project(recipe), str(recipe.id).upper())
    assert '≈ estimated' in html and 'private' not in html
    assert f'content="https://hafa-recipes.com/r/{recipe.id}"' in html
    unlisted = render_page(project(recipe), 'x' * 43)
    assert 'Open in Håfa Recipes' not in unlisted and 'apple-itunes-app' not in unlisted
    assert user().model_copy(update={'email': 'private.handle@example.com'}).display_name == 'A chef'


@pytest.mark.asyncio
async def test_image_releases_connection_bounds_wait_and_retries(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    import app.recipe_pages as pages
    recipe = SimpleNamespace(id=uuid4(), thumbnail_url='https://example.com/photo')
    db = SimpleNamespace(close=AsyncMock())
    monkeypatch.setattr(pages, 'resolve', AsyncMock(return_value=recipe))
    gate = asyncio.Event()
    calls = 0
    async def fetch(*args):
        nonlocal calls
        assert db.close.await_count > 0
        calls += 1
        await gate.wait()
        raise ValueError('unavailable')
    monkeypatch.setattr(pages.storage_service, 'fetch_thumbnail_source', fetch)
    monkeypatch.setattr(pages, 'IMAGE_WAIT_SECONDS', .01)
    _images.clear()
    try:
        results = await asyncio.gather(*(pages.og_image(str(recipe.id), db, None) for _ in range(15)))
        assert all(result.body == pages._default_image for result in results)
        assert calls == 1 and len(pages._image_jobs) == 1
        for _ in range(10):
            recipe.id = uuid4()
            await pages.og_image(str(recipe.id), db, None)
        assert len(pages._image_jobs) == pages.MAX_IMAGE_JOBS
        gate.set()
        await asyncio.gather(*list(pages._image_jobs.values()))
        assert not _images and not pages._image_jobs
        await pages.og_image(str(recipe.id), db, None)
        assert calls == pages.MAX_IMAGE_JOBS + 1
        raw = SimpleNamespace(data=jpeg(None))
        monkeypatch.setattr(pages.storage_service, 'fetch_thumbnail_source', AsyncMock(return_value=raw))
        monkeypatch.setattr(pages, 'IMAGE_WAIT_SECONDS', 2)
        await pages.og_image(str(recipe.id), db, None)
        await pages.og_image(str(recipe.id), db, None)
        assert pages.storage_service.fetch_thumbnail_source.await_count == 1
    finally:
        gate.set()
        await asyncio.gather(*list(pages._image_jobs.values()))
        _images.clear()


def test_recipe_capabilities_not_logged_or_traced():
    import logging

    from app.domains.workouts.privacy import (
        WorkoutsAccessLogFilter,
        redact_workouts_event,
        redact_workouts_transaction,
    )
    path = '/public/r/' + 'x' * 43 + '/og.jpg?secret=1'
    record = logging.LogRecord('uvicorn.access', 20, '', 0, '%s - "%s %s HTTP/%s" %d',
                               ('peer', 'GET', path, '1.1', 200), None)
    assert not WorkoutsAccessLogFilter().filter(record)
    event = {'request': {'url': 'https://api.invalid' + path}, 'breadcrumbs': [{'message': path}]}
    assert path not in str(redact_workouts_event(event))
    assert redact_workouts_transaction(event) is None
