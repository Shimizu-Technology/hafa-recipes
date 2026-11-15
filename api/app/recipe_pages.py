"""Server-rendered recipe pages: allowlisted data, identical denial, rechecked OG access."""
import asyncio
import hashlib
import io
import re
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from html import escape
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, Response
from PIL import Image, ImageDraw, ImageFont, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_optional_user
from app.contributor_attribution import PLACEHOLDER_NAMES
from app.db.database import get_db
from app.models.recipe import Recipe
from app.moderation import public_recipe_conditions
from app.recipe_links import PRIVATE_HEADERS, SITE, RecipeLink, read_budget, schema_ready
from app.services.storage import storage_service

router = APIRouter(prefix='/public/r', tags=['public-recipes'], dependencies=[Depends(read_budget)])
UNAVAILABLE = "This recipe isn’t available. It may be private or removed."
HTML_HEADERS = PRIVATE_HEADERS | {'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff'}
APP_STORE = 'https://apps.apple.com/app/id6755892896'
CSS = '''*{box-sizing:border-box}body{margin:0;background:#F7F7F5;color:#203C33;font:17px/1.65 system-ui,sans-serif}header,main,footer{max-width:900px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #80988b44}a{color:inherit}header b{font:700 27px Georgia,serif}main{padding-top:32px}h1{font:500 clamp(32px,6vw,54px)/1.12 Georgia,serif;margin:24px 0 16px;overflow-wrap:anywhere}h2{font:500 28px Georgia,serif}h3{font-size:20px}.hero{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:22px;background:#145E52}.credit{font-weight:600}.meta{color:#50685E}.cta{background:#e4ece5;border-radius:20px;padding:24px;margin:28px 0}.button{display:inline-block;background:#145E52;color:white;border-radius:12px;padding:12px 20px;text-decoration:none;margin:4px 12px 4px 0}li{padding:5px 0}section{margin:36px 0}p,li{overflow-wrap:anywhere}footer{border-top:1px solid #80988b44;font-size:14px} @media(prefers-color-scheme:dark){body{background:#101A16;color:#E5EDE7}.meta{color:#A8BDB1}.cta{background:#20372D}.button{background:#17695B}}'''


def safe_source(value):
    # Only ordinary external HTTPS links; no custom schemes or credential-bearing URLs.
    from urllib.parse import urlsplit
    try:
        url = urlsplit(value or '')
        return value if url.scheme == 'https' and url.hostname and not url.username and not url.password else None
    except ValueError:
        return None


def project(recipe):
    def mapping(value):
        return value if isinstance(value, dict) else {}

    def items(value):
        return value if isinstance(value, list) else []

    data = mapping(recipe.extracted)
    components = items(data.get('components')) or [{'name': 'Recipe', 'ingredients': data.get('ingredients'), 'steps': data.get('steps')}]
    name = (recipe.extractor_display_name or '').strip()
    creator = name if name.lower() not in PLACEHOLDER_NAMES and '@' not in name else ''
    return {
        'id': str(recipe.id), 'title': str(data.get('title') or 'Recipe'),
        'creator': creator or 'A Håfa cook',
        'servings': data.get('servings'), 'time': mapping(data.get('times')).get('total'),
        'components': [{'name': c.get('name', ''), 'ingredients': [
            {key: i.get(key) for key in ('name', 'quantity', 'unit', 'notes')} |
            {'quantityEstimate': {key: mapping(i.get('quantityEstimate')).get(key) for key in ('quantity', 'unit')}}
            for i in items(c.get('ingredients')) if isinstance(i, dict)],
            'steps': [step for step in items(c.get('steps')) if isinstance(step, str)], 'notes': c.get('notes')}
            for c in components if isinstance(c, dict)],
        'notes': data.get('notes'), 'source_url': safe_source(recipe.source_url),
    }


async def resolve(db, key, viewer=None):
    try:
        recipe_id = UUID(key)
    except ValueError:
        recipe_id = None
    viewer_id = viewer.id if viewer else None
    if recipe_id:
        query = select(Recipe).where(Recipe.id == recipe_id, *public_recipe_conditions(viewer_id))
    elif re.fullmatch(r'[A-Za-z0-9_-]{43}', key) and await schema_ready(db):
        # Retain moderation, completeness, owner moderation and viewer blocks; only
        # replace the public flag with the explicit unlisted grant.
        query = select(Recipe).join(RecipeLink, RecipeLink.recipe_id == Recipe.id).where(
            RecipeLink.token_hash == hashlib.sha256(key.encode()).hexdigest(),
            *public_recipe_conditions(viewer_id, require_public=False),
        )
    else:
        raise HTTPException(404, UNAVAILABLE, headers=PRIVATE_HEADERS)
    recipe = await db.scalar(query)
    if recipe is None:
        raise HTTPException(404, UNAVAILABLE, headers=PRIVATE_HEADERS)
    return recipe


def render_page(data, key, has_photo=True):
    def e(value):
        return escape(str(value or ''), quote=True)
    try:
        key = str(UUID(key))
        is_public_link = True
    except ValueError:
        is_public_link = False
    url = f'{SITE}/r/{key}'
    description = ' · '.join(filter(None, [f"Serves {data['servings']}" if data['servings'] else '', str(data['time'] or ''), f"{sum(len(c['ingredients']) for c in data['components'])} ingredients", 'on Håfa Recipes']))
    sections = ''
    for c in data['components']:
        def ingredient(i):
            estimate = i.get('quantityEstimate') or {}
            amount = ' '.join(str(i.get(k) or '') for k in ('quantity', 'unit')).strip()
            if not i.get('quantity') and estimate.get('quantity'):
                amount = ' '.join(str(estimate.get(k) or '') for k in ('quantity', 'unit')).strip() + ' ≈ estimated'
            return '<li>' + e(' '.join(str(v or '') for v in (amount, i.get('name'), i.get('notes'))).strip()) + '</li>'
        ingredients = ''.join(ingredient(i) for i in c['ingredients'])
        steps = ''.join(f'<li>{e(step)}</li>' for step in c['steps'])
        sections += f"<section><h2>{e(c['name'])}</h2><h3>Ingredients</h3><ul>{ingredients}</ul><h3>Method</h3><ol>{steps}</ol><p>{e(c['notes'])}</p></section>"
    source = f'<a href="{e(data["source_url"])}" rel="noreferrer nofollow">Original source ↗</a>' if data['source_url'] else ''
    photo = f'<img class="hero" src="/r/{e(key)}/og.jpg" alt="{e(data["title"])}">' if has_photo else ''
    open_app = f'<a class="button" href="hafarecipes://recipe/{e(data["id"])}">Open in Håfa Recipes</a>' if is_public_link else ''
    smart_banner = f'<meta name="apple-itunes-app" content="app-id=6755892896, app-argument={e(url)}">' if is_public_link else ''
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>{e(data['title'])} · Håfa Recipes</title><meta name="description" content="{e(description)}"><meta property="og:title" content="{e(data['title'])}"><meta property="og:description" content="{e(description)}"><meta property="og:type" content="article"><meta property="og:site_name" content="Håfa Recipes"><meta property="og:url" content="{e(url)}"><meta property="og:image" content="{e(url)}/og.jpg"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{e(url)}/og.jpg">{smart_banner}<style>{CSS}</style></head><body><header><b>Håfa Recipes</b><a href="{APP_STORE}">Get the app ↗</a></header><main>{photo}<h1>{e(data['title'])}</h1><p class="credit">Shared by {e(data['creator'])}</p>{source}<p class="meta">{e(description)}</p><aside class="cta"><b>A little less scrolling. A little more cooking.</b><p>Save it to your library, scale it, add it to your grocery list and cook step by step.</p>{open_app}<a href="{APP_STORE}">Get it on the App Store</a></aside>{sections}<p>{e(data['notes'])}</p><p class="meta">Recipes may contain AI estimates. Check quantities and cooking instructions before you begin.</p></main><footer><a href="/support">Report a concern</a> · <a href="/privacy">Privacy</a></footer></body></html>'''


@router.get('/{key}/data')
async def page_data(key: str, db: AsyncSession = Depends(get_db), viewer: ClerkUser | None = Depends(get_optional_user)):
    return JSONResponse(project(await resolve(db, key, viewer)), headers=PRIVATE_HEADERS)


@router.get('/{key}', response_class=HTMLResponse)
async def page(key: str, db: AsyncSession = Depends(get_db), viewer: ClerkUser | None = Depends(get_optional_user)):
    try:
        recipe = await resolve(db, key, viewer)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        return HTMLResponse(f'<!doctype html><html lang="en"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><style>{CSS}</style><main><h1>{UNAVAILABLE}</h1><a href="{APP_STORE}">Get Håfa Recipes</a></main></html>', status_code=404, headers=HTML_HEADERS)
    return HTMLResponse(render_page(project(recipe), key), headers=HTML_HEADERS)


# No public S3 object: a private grant must remain revocable. The existing
# thumbnail pipeline publishes immutable public variants. Until protected OG
# storage and its deletion lifecycle exist, retain at most 32 photos for 5 min.
_images = OrderedDict()
_image_jobs = {}
_image_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='recipe-og')
MAX_IMAGE_JOBS = 4
IMAGE_WAIT_SECONDS = 2


def jpeg(data):
    image = ImageOps.fit(Image.open(io.BytesIO(data)).convert('RGB'), (1200, 630)) if data else Image.new('RGB', (1200, 630), '#145E52')
    if not data:
        ImageDraw.Draw(image).text((70, 270), 'Håfa Recipes', font=ImageFont.load_default(size=72), fill='white')
    out = io.BytesIO()
    image.save(out, 'JPEG', quality=86)
    return out.getvalue()


_default_image = jpeg(None)


async def build_image(cache_key):
    try:
        recipe_id, thumbnail_url = cache_key
        # Keep admission until the underlying I/O actually finishes: cancelling
        # an S3 to_thread call cannot stop its socket or free its worker.
        raw = await storage_service.fetch_thumbnail_source(thumbnail_url, recipe_id)
        payload = await asyncio.get_running_loop().run_in_executor(_image_executor, jpeg, raw.data)
        _images[cache_key] = (monotonic() + 300, payload)
        _images.move_to_end(cache_key)
        while len(_images) > 32:
            _images.popitem(last=False)
        return payload
    except Exception:
        # A transient fetch/decode failure is never cached as a successful photo.
        return _default_image
    finally:
        _image_jobs.pop(cache_key, None)


@router.get('/{key}/og.jpg')
async def og_image(key: str, db: AsyncSession = Depends(get_db), viewer: ClerkUser | None = Depends(get_optional_user)):
    recipe = await resolve(db, key, viewer)
    cache_key = (str(recipe.id), recipe.thumbnail_url)
    # Return the connection to the shared pool before cache waits, fetch or Pillow.
    await db.close()
    payload = _default_image
    cached = _images.get(cache_key)
    if cached and cached[0] > monotonic():
        _images.move_to_end(cache_key)
        payload = cached[1]
    elif cache_key[1]:
        job = _image_jobs.get(cache_key)
        if job is None and len(_image_jobs) < MAX_IMAGE_JOBS:
            job = asyncio.create_task(build_image(cache_key))
            _image_jobs[cache_key] = job
        if job is not None:
            try:
                payload = await asyncio.wait_for(asyncio.shield(job), timeout=IMAGE_WAIT_SECONDS)
            except TimeoutError:
                pass
    return Response(payload, media_type='image/jpeg', headers=PRIVATE_HEADERS)
