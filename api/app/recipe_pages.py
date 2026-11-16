"""Server-rendered recipe pages: allowlisted data, identical denial, rechecked OG access."""
import asyncio
import hashlib
import io
import re
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from html import escape
from itertools import islice
from pathlib import Path
from threading import local
from time import monotonic
from unicodedata import normalize
from uuid import UUID

import regex
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
CSS = '''*{box-sizing:border-box}body{margin:0;background:#F7F7F5;color:#203C33;font:17px/1.65 system-ui,sans-serif}header,main,footer{max-width:900px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #80988b44}a{color:inherit}header b{font:700 27px Georgia,serif}main{padding-top:32px}h1{font:500 clamp(32px,6vw,54px)/1.12 Georgia,serif;margin:24px 0 16px;overflow-wrap:anywhere}h2{font:500 28px Georgia,serif}h3{font-size:20px}.hero{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:22px;background:#145E52}.credit{font-weight:600}.meta{color:#50685E}.cta{background:#e4ece5;border-radius:20px;padding:24px;margin:28px 0}.cta-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch}.button{display:inline-flex;align-items:center;justify-content:center;min-height:52px;max-width:100%;flex:0 0 auto;white-space:nowrap;background:#145E52;color:white;border:1px solid #145E52;border-radius:12px;padding:11px 19px;text-decoration:none}.button--secondary{background:transparent;color:#145E52}li{padding:5px 0}section{margin:36px 0}p,li{overflow-wrap:anywhere}footer{border-top:1px solid #80988b44;font-size:14px} @media(prefers-color-scheme:dark){body{background:#101A16;color:#E5EDE7}.meta{color:#A8BDB1}.cta{background:#20372D}.button{background:#17695B;border-color:#17695B}.button--secondary{background:transparent;color:#E5EDE7;border-color:#A8BDB1}}'''


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


def render_page(data, key, has_photo=False):
    def e(value):
        return escape(str(value or ''), quote=True)
    try:
        key = str(UUID(key))
        is_public_link = True
    except ValueError:
        is_public_link = False
    url = f'{SITE}/r/{key}'
    count = sum(len(c['ingredients']) for c in data['components'])
    description = ' · '.join(filter(None, [f"Serves {data['servings']}" if data['servings'] else '', str(data['time'] or ''), f"{count} ingredient{'' if count == 1 else 's'}", 'on Håfa Recipes']))
    sections = ''
    for c in data['components']:
        def ingredient(i):
            estimate = i.get('quantityEstimate') or {}
            amount = ' '.join(str(i.get(k) or '') for k in ('quantity', 'unit')).strip()
            if not i.get('quantity') and estimate.get('quantity'):
                amount = '≈ ' + ' '.join(str(estimate.get(k) or '') for k in ('quantity', 'unit')).strip()
                label = ' '.join(str(v or '') for v in (amount, i.get('name'), '(estimated)', i.get('notes'))).strip()
            else:
                label = ' '.join(str(v or '') for v in (amount, i.get('name'), i.get('notes'))).strip()
            # The spoken label retains the explicit estimate even when ≈ is silent.
            return '<li>' + e(label) + '</li>'
        ingredients = ''.join(ingredient(i) for i in c['ingredients'])
        steps = ''.join(f'<li>{e(step)}</li>' for step in c['steps'])
        heading = '' if len(data['components']) == 1 else f"<h2>{e(c['name'])}</h2>"
        level = 'h2' if len(data['components']) == 1 else 'h3'
        sections += f"<section>{heading}<{level}>Ingredients</{level}><ul>{ingredients}</ul><{level}>Method</{level}><ol>{steps}</ol><p>{e(c['notes'])}</p></section>"
    source = f'<a href="{e(data["source_url"])}" rel="noreferrer nofollow">Original source ↗</a>' if data['source_url'] else ''
    photo = f'<img class="hero" src="/r/{e(key)}/og.jpg" alt="{e(data["title"])}">' if has_photo else ''
    open_app = f'<a class="button" href="hafarecipes://recipe/{e(data["id"])}">Open in Håfa Recipes</a>' if is_public_link else ''
    store_class = 'button button--secondary' if is_public_link else 'button'
    store_button = f'<a class="{store_class}" href="{APP_STORE}">Get it on the App Store</a>'
    smart_banner = f'<meta name="apple-itunes-app" content="app-id=6755892896, app-argument={e(url)}">' if is_public_link else ''
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>{e(data['title'])} · Håfa Recipes</title><meta name="description" content="{e(description)}"><meta property="og:title" content="{e(data['title'])}"><meta property="og:description" content="{e(description)}"><meta property="og:type" content="article"><meta property="og:site_name" content="Håfa Recipes"><meta property="og:url" content="{e(url)}"><meta property="og:image" content="{e(url)}/og.jpg"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{e(url)}/og.jpg">{smart_banner}<style>{CSS}</style></head><body><header><b>Håfa Recipes</b><a href="{APP_STORE}">Get the app ↗</a></header><main>{photo}<h1>{e(data['title'])}</h1><p class="credit">Shared by {e(data['creator'])}</p>{source}<p class="meta">{e(description)}</p><aside class="cta"><b>A little less scrolling. A little more cooking.</b><p>Save it to your library, scale it, add it to your grocery list and cook step by step.</p><div class="cta-actions">{open_app}{store_button}</div></aside>{sections}<p>{e(data['notes'])}</p><p class="meta">Recipes may contain AI estimates. Check quantities and cooking instructions before you begin.</p></main><footer><a href="/support">Report a concern</a> · <a href="/privacy">Privacy</a></footer></body></html>'''


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
    data = project(recipe)
    cache_key = image_key(recipe)
    await db.close()
    # Start early, without delaying HTML or holding a pooled DB connection.
    start_image(cache_key)
    return HTMLResponse(render_page(data, key, has_photo=bool(cache_key[1])), headers=HTML_HEADERS)


# No public S3 object: a private grant must remain revocable. The existing
# thumbnail pipeline publishes immutable public variants. Until protected OG
# storage and its deletion lifecycle exist, retain at most 32 photos for 5 min.
_images = OrderedDict()
_image_jobs = {}
_image_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='recipe-og')
MAX_IMAGE_JOBS = 4
IMAGE_WAIT_SECONDS = 2


# Pillow's bundled font has no "å"; the app's title face does (SIL OFL, see Fraunces-OFL.txt).
BRAND_FONT = Path(__file__).parent / 'assets' / 'fonts' / 'Fraunces_500Medium.ttf'
WORDMARK_FONT = BRAND_FONT.parent / 'Figtree_600SemiBold.ttf'
WORDMARK_TEXT = normalize('NFC', 'Håfa Recipes')


# FreeType faces have mutable glyph state; each Pillow worker owns its fonts.
_font_cache = local()


def title_fonts(size):
    if not hasattr(_font_cache, 'fonts'):
        _font_cache.fonts = {}
    if size not in _font_cache.fonts:
        _font_cache.fonts[size] = tuple(ImageFont.truetype(str(BRAND_FONT.parent / name), size) for name in (
            BRAND_FONT.name, 'NotoSans-Medium.ttf', 'NotoSansJP-Medium.ttf', 'NotoEmoji-Regular.ttf'))
    return _font_cache.fonts[size]


def wordmark_font():
    if not hasattr(_font_cache, 'wordmark'):
        _font_cache.wordmark = ImageFont.truetype(str(WORDMARK_FONT), 32)
    return _font_cache.wordmark


def title_runs(title, size=80):
    fonts = title_fonts(size)
    missing = [font.getmask('\U0010fffd') for font in fonts]
    runs = []
    # Bound work and keep combining marks, flags and joined emoji together.
    clusters = list(islice(regex.finditer(r'\X', normalize('NFC', ' '.join(str(title).split()))), 401))
    for match in clusters[:400]:
        cluster = match.group()
        selected = next((font for font, box in zip(fonts, missing)
                         if all(bytes(font.getmask(char)) != bytes(box) for char in cluster
                                if char not in '\u200d\ufe0e\ufe0f')), None)
        # Unknown scripts still have a visible replacement, never an encoding error.
        runs.append((cluster, selected) if selected else ('�', fonts[1]))
    if len(clusters) > 400:
        runs.append(('…', fonts[0]))
    return runs


def title_lines(title, width=1060, max_lines=4):
    lines, line, length = [], [], 0
    for cluster, font in title_runs(title):
        advance = font.getlength(cluster)
        if length + advance > width and line:
            # Prefer a word boundary, but break long words and CJK safely too.
            boundary = next((i for i in range(len(line) - 1, 0, -1) if line[i][0] == ' '), len(line))
            lines.append(line[:boundary])
            line = line[boundary + 1:] if boundary < len(line) else []
            length = sum(f.getlength(c) for c, f in line)
        line.append((cluster, font))
        length += advance
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        ellipsis_font = title_fonts(80)[0]
        while last and sum(f.getlength(c) for c, f in last) + ellipsis_font.getlength('…') > width:
            last.pop()
        last.append(('…', ellipsis_font))
    return lines


def jpeg(data, title='Håfa Recipes'):
    image = ImageOps.fit(Image.open(io.BytesIO(data)).convert('RGB'), (1200, 630)) if data else Image.new('RGB', (1200, 630), '#145E52')
    if not data:
        draw = ImageDraw.Draw(image)
        draw.text((70, 58), WORDMARK_TEXT, font=wordmark_font(), fill='white', anchor='lt')
        lines = title_lines(title)
        y = 180 + (4 - len(lines)) * 44
        for line in lines:
            x = 70
            for cluster, font in line:
                draw.text((x, y + 70), cluster, font=font, fill='white', anchor='ls')
                x += font.getlength(cluster)
            y += 92
    out = io.BytesIO()
    image.save(out, 'JPEG', quality=86)
    return out.getvalue()


def image_key(recipe):
    base = (str(recipe.id), recipe.thumbnail_url)
    # A changed title must not reuse a photo-less recipe's cached card.
    return base if recipe.thumbnail_url else (*base, project(recipe)['title'])


_default_image = jpeg(None)


async def build_image(cache_key):
    try:
        recipe_id, thumbnail_url, *title = cache_key
        # Keep admission until the underlying I/O actually finishes: cancelling
        # an S3 to_thread call cannot stop its socket or free its worker.
        raw = await storage_service.fetch_thumbnail_source(thumbnail_url, recipe_id, external_timeout_seconds=10) if thumbnail_url else None
        payload = await asyncio.get_running_loop().run_in_executor(_image_executor, jpeg, raw.data if raw else None, title[0] if title else 'Håfa Recipes')
        _images[cache_key] = (monotonic() + 300, payload)
        _images.move_to_end(cache_key)
        while len(_images) > 32:
            _images.popitem(last=False)
        return payload
    except Exception:
        # A transient fetch/decode failure is never cached as a successful photo.
        return _default_image if thumbnail_url else None
    finally:
        _image_jobs.pop(cache_key, None)


def start_image(cache_key):
    cached = _images.get(cache_key)
    if cached and cached[0] > monotonic():
        return None
    job = _image_jobs.get(cache_key)
    if job is None and len(_image_jobs) < MAX_IMAGE_JOBS:
        job = asyncio.create_task(build_image(cache_key))
        _image_jobs[cache_key] = job
    return job


@router.get('/{key}/og.jpg')
async def og_image(key: str, db: AsyncSession = Depends(get_db), viewer: ClerkUser | None = Depends(get_optional_user)):
    recipe = await resolve(db, key, viewer)
    cache_key = image_key(recipe)
    # Return the connection to the shared pool before cache waits, fetch or Pillow.
    await db.close()
    payload = _default_image if cache_key[1] else None
    cached = _images.get(cache_key)
    if cached and cached[0] > monotonic():
        _images.move_to_end(cache_key)
        payload = cached[1]
    else:
        job = start_image(cache_key)
        if job is not None:
            try:
                payload = await asyncio.wait_for(asyncio.shield(job), timeout=IMAGE_WAIT_SECONDS)
            except TimeoutError:
                pass
    if payload is None:
        # Busy renderers must not send a successful, dish-less preview.
        return Response(status_code=503, headers=PRIVATE_HEADERS | {'Retry-After': '2'})
    return Response(payload, media_type='image/jpeg', headers=PRIVATE_HEADERS)
