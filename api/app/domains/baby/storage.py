"""Private asset bytes: existing S3 in production, explicit local QA directory."""

import os
import re
import shutil
from pathlib import Path
from uuid import uuid4

from app.config import get_settings
from app.services.storage import storage_service

PREFIX = re.compile(
    r"^baby-private/[0-9a-f]{64}/[1-9][0-9]*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/$"
)


def local_root():
    settings = get_settings()
    configured = getattr(settings, "baby_local_storage_dir", None)
    if not configured:
        return None
    if settings.environment == "production":
        raise RuntimeError("Baby local file storage is forbidden in production")
    path = Path(configured)
    if (
        not path.is_absolute()
        or not path.is_dir()
        or path.is_symlink()
        or path.resolve() in {Path("/"), Path.home()}
    ):
        raise RuntimeError("Baby local storage requires an existing absolute task-owned directory")
    return path.resolve()


def local_path(key):
    root = local_root()
    if root is None:
        return None
    # Keys are server-generated; reject symlink escape even in a QA directory.
    result = (root / key).resolve()
    if not result.is_relative_to(root) or result == root:
        raise RuntimeError("Invalid private asset path")
    return result


def available(service=None):
    return local_root() is not None or (service or storage_service).is_enabled


def put(key, payload, mime, *, service=None):
    path = local_path(key)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.parent / (".upload-" + uuid4().hex)
        try:
            with temporary.open("xb") as handle:
                os.chmod(temporary, 0o600)
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        return
    service = service or storage_service
    service.client.put_object(
        Bucket=service.bucket_name,
        Key=key,
        Body=payload,
        ContentType=mime,
        ServerSideEncryption="AES256",
        CacheControl="private, no-store",
    )


def read(key, size, *, service=None):
    path = local_path(key)
    if path is not None:
        with path.open("rb") as handle:
            return handle.read(size + 1)
    service = service or storage_service
    stream = service.client.get_object(Bucket=service.bucket_name, Key=key)["Body"]
    try:
        return stream.read(size + 1)
    finally:
        stream.close()


async def delete_private_prefix(prefix):
    """Called by shared durable cleanup worker under the exact asset media lock."""
    if not PREFIX.fullmatch(prefix):
        raise ValueError("Invalid Baby cleanup prefix")
    path = local_path(prefix)
    if path is not None:
        import asyncio

        if path.exists():
            await asyncio.to_thread(shutil.rmtree, path)
        return
    await storage_service.delete_prefix(prefix)
