"""Real DB privacy transitions for HTML, data, image and unlisted grants."""
import importlib
import io
import os
from pathlib import Path
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
    assert verified_client_ip(request(jwt.encode(claims | {'exp': time.time() - 10}, secret, algorithm='HS256'))) == '203.0.113.7'
    assert verified_client_ip(request(jwt.encode(claims | {'exp': time.time() - 60}, secret, algorithm='HS256'))) is None
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
    assert '≈ 1 tsp salt (estimated)' in html and 'private' not in html
    assert f'content="https://hafa-recipes.com/r/{recipe.id}"' in html
    unlisted = render_page(project(recipe), 'x' * 43)
    assert 'Open in Håfa Recipes' not in unlisted and 'apple-itunes-app' not in unlisted
    assert user().model_copy(update={'email': 'private.handle@example.com'}).display_name == 'A chef'


def test_default_image_draws_brand_name_and_singular_count():
    from PIL import ImageDraw, ImageFont

    from app.recipe_pages import BRAND_FONT
    font = ImageFont.truetype(str(BRAND_FONT), 80)

    def glyph(char):
        canvas = Image.new('L', (120, 120))
        ImageDraw.Draw(canvas).text((10, 0), char, font=font, fill=255)
        return canvas.tobytes()
    # A missing glyph renders as the font's .notdef box, like Pillow's default font did for "å".
    assert glyph('å') != glyph('\U0010fffd')
    assert Image.open(io.BytesIO(jpeg(None))).size == (1200, 630)
    one = {'id': str(uuid4()), 'title': 'Rice', 'creator': 'A Håfa cook', 'servings': None, 'time': None, 'notes': None,
           'source_url': None, 'components': [{'name': 'Main', 'ingredients': [{'name': 'rice'}], 'steps': [], 'notes': None}]}
    html = render_page(one, one['id'])
    assert '1 ingredient · on Håfa Recipes' in html
    assert '<h2>Main</h2>' not in html
    one['components'].append({'name': 'Sauce', 'ingredients': [], 'steps': [], 'notes': None})
    assert '<h2>Main</h2>' in render_page(one, one['id'])
    assert '<h2>Sauce</h2>' in render_page(one, one['id'])


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
    async def fetch(*args, **kwargs):
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


@pytest.mark.parametrize('method,suffix', [('GET', '/og.jpg?secret=1'), ('POST', '/save')])
def test_recipe_capabilities_not_logged_or_traced(method, suffix):
    import logging

    from app.domains.workouts.privacy import (
        WorkoutsAccessLogFilter,
        redact_workouts_event,
        redact_workouts_transaction,
    )
    path = '/public/r/' + 'x' * 43 + suffix
    record = logging.LogRecord('uvicorn.access', 20, '', 0, '%s - "%s %s HTTP/%s" %d',
                               ('peer', method, path, '1.1', 200), None)
    assert not WorkoutsAccessLogFilter().filter(record)
    event = {'request': {'url': 'https://api.invalid' + path}, 'breadcrumbs': [{'message': path}]}
    assert path not in str(redact_workouts_event(event))
    assert redact_workouts_transaction(event) is None


@pytest.mark.asyncio
async def test_page_budgets_do_not_scan_full_event_windows(monkeypatch):
    from collections import deque

    from app.rate_limit import RateLimitExceeded, UserRateLimiter

    class NoScan(deque):
        def __iter__(self):
            raise AssertionError('A page budget must not scan its admissions')

    clock = [100.0]
    bucket = UserRateLimiter(clock=lambda: clock[0])
    # Use the actual page budget helper, including its 429 path.
    monkeypatch.setattr('app.recipe_links.limiter', bucket)
    from app.recipe_links import budget
    key = ('global', 'recipe-page-ceiling')
    bucket._quota_events[key] = NoScan([100.0] * 11999)
    bucket._quota_horizons[key] = 60
    await budget(*key, 12000)
    for _ in range(10):
        with pytest.raises(HTTPException) as exc:
            await budget(*key, 12000)
        assert exc.value.status_code == 429
    assert len(bucket._quota_events[key]) == 12000
    clock[0] = 160.0
    await budget(*key, 12000)
    assert len(bucket._quota_events[key]) == 1
    # Multi-window quotas still count only the events inside each smaller window.
    from app.rate_limit import QuotaWindow
    await bucket.consume_quota(user_id='multi', capability='test', windows=[QuotaWindow(60, 10), QuotaWindow(10, 1)])
    with pytest.raises(RateLimitExceeded):
        await bucket.consume_quota(user_id='multi', capability='test', windows=[QuotaWindow(60, 10), QuotaWindow(10, 1)])


@pytest.mark.asyncio
async def test_unsigned_ceiling_is_checked_before_shared_budget(monkeypatch):
    import time

    import jwt
    from starlette.requests import Request

    from app.recipe_links import read_budget
    secret = 'test-only-secret-with-at-least-32-bytes'
    monkeypatch.setenv('RECIPE_PROXY_SECRET', secret)
    limiter.reset()
    def request(token='', ip='203.0.113.9'):
        return Request({'type': 'http', 'client': ('10.0.0.1', 80), 'headers': [
            (b'x-nf-sign', token.encode()), (b'x-nf-client-connection-ip', ip.encode())]})
    for _ in range(600):
        await read_budget(request())
    for i in range(20):
        # Neither a new forged client header nor a bad signature gets a new bucket.
        with pytest.raises(HTTPException) as exc:
            await read_budget(request('invalid', f'203.0.113.{i}'))
        assert exc.value.status_code == 429
    assert len(limiter._quota_events[('global', 'recipe-page-ceiling')]) == 600
    token = jwt.encode({'iss': 'netlify', 'exp': time.time() + 60}, secret, algorithm='HS256')
    await read_budget(request(token))
    assert len(limiter._quota_events[('global', 'recipe-page-ceiling')]) == 601
    limiter.reset()
    for _ in range(120):
        await read_budget(request(token, '2001:db8:abcd:1234::1'))
    with pytest.raises(HTTPException):
        await read_budget(request(token, '2001:db8:abcd:1234::2'))
    assert len(limiter._quota_events[('global', 'recipe-page-ceiling')]) == 120
    await read_budget(request(token, '2001:db8:abcd:1235::1'))
    limiter.reset()
    for _ in range(120):
        await read_budget(request(token, '::ffff:203.0.113.7'))
    # A different IPv4-mapped visitor has its own budget, not the ::/64 one.
    await read_budget(request(token, '::ffff:203.0.113.8'))
    with pytest.raises(HTTPException):
        await read_budget(request(token, '203.0.113.7'))
    limiter.reset()


@pytest.mark.asyncio
async def test_migration_replays_after_later_additive_columns(fixture):
    db, recipe = fixture
    await db.execute(text('CREATE TABLE schema_migrations (version integer primary key, name text)'))
    await db.execute(text('ALTER TABLE recipe_share_links ADD COLUMN future_metadata text'))
    await db.commit()
    migration = importlib.import_module('migrations.062_add_recipe_share_links')
    await migration.run_migration(migration_engine=db.bind)
    await migration.run_migration(migration_engine=db.bind)
    assert await db.get(Recipe, recipe.id)
    await db.execute(text('ALTER TABLE recipe_share_links ALTER COLUMN token_hash DROP NOT NULL'))
    await db.commit()
    with pytest.raises(RuntimeError, match='schema drift'):
        await migration.run_migration(migration_engine=db.bind)


@pytest.mark.asyncio
async def test_link_status_does_not_lock_recipe(fixture):
    from sqlalchemy import event

    from app.recipe_links import link_status
    db, recipe = fixture
    queries = []
    def record(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)
    event.listen(db.bind.sync_engine, 'before_cursor_execute', record)
    try:
        await link_status(recipe.id, Response(), user(), db)
        assert not any('FOR UPDATE' in query.upper() for query in queries)
    finally:
        event.remove(db.bind.sync_engine, 'before_cursor_execute', record)


@pytest.mark.asyncio
async def test_page_prewarms_image_without_waiting_or_holding_db(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    import app.recipe_pages as pages
    recipe = SimpleNamespace(id=uuid4(), thumbnail_url='https://example.com/photo',
                             extracted={'title': 'Rice'}, extractor_display_name='Cook', source_url=None)
    db = SimpleNamespace(close=AsyncMock())
    monkeypatch.setattr(pages, 'resolve', AsyncMock(return_value=recipe))
    gate = asyncio.Event()
    async def fetch(*args, **kwargs):
        assert db.close.await_count > 0
        assert kwargs == {'external_timeout_seconds': 10}
        await gate.wait()
        return SimpleNamespace(data=jpeg(None))
    monkeypatch.setattr(pages.storage_service, 'fetch_thumbnail_source', fetch)
    _images.clear()
    try:
        html = await asyncio.wait_for(pages.page(str(recipe.id), db, None), .5)
        assert html.status_code == 200 and len(pages._image_jobs) == 1
        await pages.page(str(recipe.id), db, None)
        assert len(pages._image_jobs) == 1  # HTML and og.jpg coalesce the same job.
        gate.set()
        await asyncio.gather(*list(pages._image_jobs.values()))
        image = await pages.og_image(str(recipe.id), db, None)
        assert image.body == _images[(str(recipe.id), recipe.thumbnail_url)][1]
    finally:
        gate.set()
        await asyncio.gather(*list(pages._image_jobs.values()))
        _images.clear()


@pytest.mark.asyncio
async def test_external_image_deadline_cancels_download_but_not_owned_thread(monkeypatch):
    import asyncio
    import time

    from app.recipe_pages import storage_service as storage
    out = io.BytesIO()
    Image.new('RGB', (80, 60), 'red').save(out, 'JPEG')
    image = out.getvalue()
    cancelled = asyncio.Event()
    async def external(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    monkeypatch.setattr(storage, '_owned_storage_key', lambda url: None)
    monkeypatch.setattr(storage, '_owned_storage_hosts', lambda: set())
    monkeypatch.setattr(storage, '_download_public_url', external)
    with pytest.raises(TimeoutError):
        await storage.fetch_thumbnail_source('https://example.com/photo', str(uuid4()), external_timeout_seconds=.01)
    assert cancelled.is_set()
    monkeypatch.setattr(storage, '_owned_storage_key', lambda url: 'owned')
    monkeypatch.setattr(storage, '_key_belongs_to_recipe', lambda *args: True)
    def owned(*args):
        time.sleep(.03)
        return image, 'image/jpeg'
    monkeypatch.setattr(storage, '_download_owned_thumbnail', owned)
    result = await storage.fetch_thumbnail_source('https://example.com/photo', str(uuid4()), external_timeout_seconds=.001)
    assert result.data == image


@pytest.mark.parametrize('title', ['Chicken Kelaguen', 'Båñuelos 🍲', '味噌ラーメン', 'Σούπα', '👨‍👩‍👧‍👦 rice'])
def test_no_photo_title_card_unicode_and_photo_preservation(title):
    from app.recipe_pages import BRAND_FONT, title_runs
    runs = title_runs(title)
    assert ''.join(cluster for cluster, _ in runs) == title
    if title == 'Båñuelos 🍲':
        assert all(Path(font.path).name == BRAND_FONT.name for char, font in runs if char in 'åñ')
        assert Path(runs[-1][1].path).name == 'NotoEmoji-Regular.ttf'
    card = jpeg(None, title)
    assert Image.open(io.BytesIO(card)).size == (1200, 630)
    assert card != jpeg(None, 'Another dish')
    photo = io.BytesIO()
    Image.new('RGB', (40, 40), 'red').save(photo, 'PNG')
    assert jpeg(photo.getvalue(), title) == jpeg(photo.getvalue(), 'Another dish')


@pytest.mark.parametrize('title', ['Long recipe title ' * 1000, '超' * 1000, 'Båñuelos' * 1000, '🍲' * 1000])
def test_title_wraps_and_ellipsizes_within_card(title):
    from app.recipe_pages import title_lines
    lines = title_lines(title)
    assert 1 <= len(lines) <= 4
    assert lines[-1][-1][0] == '…'
    assert all(sum(font.getlength(cluster) for cluster, font in line) <= 1060 for line in lines)
    assert Image.open(io.BytesIO(jpeg(None, title))).size == (1200, 630)


@pytest.mark.asyncio
async def test_photo_less_og_uses_current_recipe_title_without_fetching(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    import app.recipe_pages as pages
    recipe = SimpleNamespace(id=uuid4(), thumbnail_url=None, extracted={'title': 'Båñuelos 🍲'},
                             extractor_display_name=None, source_url=None)
    db = SimpleNamespace(close=AsyncMock())
    monkeypatch.setattr(pages, 'resolve', AsyncMock(return_value=recipe))
    fetch = AsyncMock(side_effect=AssertionError('No photo to fetch'))
    monkeypatch.setattr(pages.storage_service, 'fetch_thumbnail_source', fetch)
    first = await pages.og_image(str(recipe.id), db, None)
    assert first.body == jpeg(None, 'Båñuelos 🍲')
    recipe.extracted = {'title': '味噌ラーメン'}
    second = await pages.og_image(str(recipe.id), db, None)
    assert second.body == jpeg(None, '味噌ラーメン') and second.body != first.body
    fetch.assert_not_called()
    assert db.close.await_count == 2
    _images.clear()


@pytest.mark.asyncio
async def test_photo_less_preview_retries_when_render_capacity_is_full(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    import app.recipe_pages as pages
    recipe = SimpleNamespace(id=uuid4(), thumbnail_url=None, extracted={'title': 'Rice'},
                             extractor_display_name=None, source_url=None)
    monkeypatch.setattr(pages, 'resolve', AsyncMock(return_value=recipe))
    monkeypatch.setattr(pages, 'MAX_IMAGE_JOBS', 0)
    response = await pages.og_image(str(recipe.id), SimpleNamespace(close=AsyncMock()), None)
    assert response.status_code == 503 and response.headers['retry-after'] == '2'
    assert response.headers['cache-control'] == 'private, no-store'


def test_title_fonts_are_reused_only_within_the_same_worker():
    from concurrent.futures import ThreadPoolExecutor

    from app.recipe_pages import title_fonts
    fonts = title_fonts(80)
    assert title_fonts(80) is fonts
    with ThreadPoolExecutor(max_workers=1) as worker:
        other_fonts = worker.submit(title_fonts, 80).result()
        assert worker.submit(title_fonts, 80).result() is other_fonts
    assert all(main is not other for main, other in zip(fonts, other_fonts))


def test_small_wordmark_renders_nfc_hafa_with_figtree_semibold(monkeypatch):
    from unicodedata import is_normalized

    from PIL import ImageDraw

    from app.recipe_pages import WORDMARK_TEXT
    calls = []
    draw_text = ImageDraw.ImageDraw.text

    def record(self, xy, text, *args, **kwargs):
        calls.append((text, kwargs.get('font')))
        return draw_text(self, xy, text, *args, **kwargs)

    monkeypatch.setattr(ImageDraw.ImageDraw, 'text', record)
    image = Image.open(io.BytesIO(jpeg(None, 'Håfa')))
    text, font = calls[0]
    assert text == WORDMARK_TEXT == 'Håfa Recipes'
    assert is_normalized('NFC', text) and 'ǻ' not in text
    assert Path(font.path).name == 'Figtree_600SemiBold.ttf'
    assert font.getname() == ('Figtree', 'SemiBold')
    assert bytes(font.getmask('å')) != bytes(font.getmask('\U0010fffd'))
    assert image.size == (1200, 630)


@pytest.mark.asyncio
@pytest.mark.parametrize('has_photo', [False, True])
@pytest.mark.parametrize('public_link', [False, True])
async def test_page_hero_and_ctas_follow_photo_and_link_type(monkeypatch, has_photo, public_link):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from bs4 import BeautifulSoup

    import app.recipe_pages as pages
    recipe = SimpleNamespace(id=uuid4(), thumbnail_url='https://example.com/photo' if has_photo else None,
                             extracted={'title': 'Coconut Shrimp Kelaguen'},
                             extractor_display_name='Tasi Cruz', source_url=None)
    monkeypatch.setattr(pages, 'resolve', AsyncMock(return_value=recipe))
    monkeypatch.setattr(pages, 'start_image', lambda key: None)
    key = str(recipe.id) if public_link else 'x' * 43
    response = await pages.page(key, SimpleNamespace(close=AsyncMock()), None)
    html = BeautifulSoup(response.body, 'html.parser')
    assert bool(html.select('img.hero')) is has_photo
    assert [heading.text for heading in html.select('h1')] == ['Coconut Shrimp Kelaguen']
    assert html.select_one('meta[property="og:image"]')['content'].endswith('/og.jpg')
    buttons = html.select('.cta-actions .button')
    assert [button.text for button in buttons] == (['Open in Håfa Recipes'] if public_link else []) + ['Get it on the App Store']
    assert ('button--secondary' in buttons[-1]['class']) is public_link
    assert buttons[-1]['href'] == pages.APP_STORE
