"""Revocable, unlisted recipe grants; no grant changes Discover visibility."""
import hashlib
import ipaddress
import os
import secrets
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import Column, DateTime, ForeignKey, String, delete, func, select, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.db.database import Base, get_db
from app.models.recipe import Recipe
from app.rate_limit import QuotaWindow, RateLimitExceeded, UserRateLimiter

router = APIRouter(tags=['recipe-links'])
limiter = UserRateLimiter()
SITE = 'https://hafa-recipes.com'
PRIVATE_HEADERS = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow'}


class RecipeLink(Base):
    __tablename__ = 'recipe_share_links'
    recipe_id = Column(PGUUID(as_uuid=True), ForeignKey('recipes.id', ondelete='CASCADE'), primary_key=True)
    token_hash = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


async def budget(key, capability, limit):
    try:
        await limiter.consume_quota(user_id=key, capability=capability, windows=[QuotaWindow(60, limit)])
    except RateLimitExceeded as exc:
        raise HTTPException(429, 'Please try again shortly', headers={'Retry-After': str(exc.retry_after)}) from exc


async def schema_ready(db):
    return bool(await db.scalar(text("SELECT to_regclass('public.recipe_share_links') IS NOT NULL")))


async def owner(db, recipe_id, user, *, lock=True):
    query = select(Recipe).where(Recipe.id == recipe_id)
    recipe = await db.scalar(query.with_for_update() if lock else query)
    if recipe is None or recipe.user_id != user.id:
        raise HTTPException(404, 'Recipe not found')
    if not await schema_ready(db):
        raise HTTPException(503, 'Recipe links are not available yet')
    return recipe


@router.post('/api/recipes/{recipe_id}/share-link')
async def create_link(recipe_id: UUID, response: Response, user: ClerkUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await budget(user.id, 'recipe-link-create', 10)
    await owner(db, recipe_id, user)
    # Locking the parent serializes create/revoke, including the first creation.
    token = secrets.token_urlsafe(32)
    await db.execute(delete(RecipeLink).where(RecipeLink.recipe_id == recipe_id))
    db.add(RecipeLink(recipe_id=recipe_id, token_hash=hashlib.sha256(token.encode()).hexdigest()))
    await db.commit()
    response.headers.update(PRIVATE_HEADERS)
    return {'url': f'{SITE}/r/{token}', 'token': token, 'recipe_id': str(recipe_id), 'visibility': 'unlisted'}


@router.delete('/api/recipes/{recipe_id}/share-link', status_code=204)
async def revoke_link(recipe_id: UUID, user: ClerkUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await owner(db, recipe_id, user)
    await db.execute(delete(RecipeLink).where(RecipeLink.recipe_id == recipe_id))
    await db.commit()
    return Response(status_code=204, headers=PRIVATE_HEADERS)


@router.get('/api/recipes/{recipe_id}/share-link')
async def link_status(recipe_id: UUID, response: Response, user: ClerkUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await owner(db, recipe_id, user, lock=False)
    link = await db.get(RecipeLink, recipe_id)
    response.headers.update(PRIVATE_HEADERS)
    return {'active': link is not None, 'created_at': link.created_at if link else None}


def verified_client_ip(request: Request):
    secret = os.getenv('RECIPE_PROXY_SECRET', '').strip()
    if not secret:
        return None
    try:
        jwt.decode(request.headers.get('x-nf-sign', ''), secret, algorithms=['HS256'],
                   issuer='netlify', leeway=30, options={'require': ['exp', 'iss']})
        return str(ipaddress.ip_address(request.headers.get('x-nf-client-connection-ip', '')))
    except (jwt.InvalidTokenError, ValueError):
        return None


async def read_budget(request: Request):
    # Verify before admitting unsigned traffic to the shared ceiling: direct
    # onrender.com clients must not spend the signed visitors' entire budget.
    client_ip = verified_client_ip(request)
    signing_enabled = bool(os.getenv('RECIPE_PROXY_SECRET', '').strip())
    if signing_enabled and not client_ip:
        await budget('unsigned', 'recipe-page', 600)
    await budget('global', 'recipe-page-ceiling', 12000)
    if client_ip:
        address = ipaddress.ip_address(client_ip)
        visitor = str(ipaddress.ip_network(f'{address}/64', strict=False)) if address.version == 6 else client_ip
        await budget(f'visitor:{visitor}', 'recipe-page', 120)
    elif not signing_enabled:
        peer = request.client.host if request.client else 'unknown'
        await budget(f'peer:{peer}', 'recipe-page', 12000)
