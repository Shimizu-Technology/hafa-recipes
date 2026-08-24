"""Cross-workflow transaction locks for exact issuer-scoped Clerk subjects."""

import hashlib

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def lock_clerk_subject(db: AsyncSession, *, issuer: str, subject: str) -> None:
    """Serialize onboarding and recovery through PostgreSQL's signed BIGINT lock."""
    lock_key = int.from_bytes(
        hashlib.sha256(f"{issuer}\0{subject}".encode()).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})
