import hashlib
import io
from types import SimpleNamespace

import pytest
from PIL import Image

import app.services.storage as storage
from app.services.storage import StorageCleanupError, StorageService


def _png_bytes(color: str) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2, 2), color=color).save(output, format="PNG")
    return output.getvalue()


class RecordingS3:
    def __init__(self):
        self.puts = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


@pytest.mark.asyncio
async def test_thumbnail_upload_uses_content_hash_and_immutable_cache(monkeypatch):
    fake_s3 = RecordingS3()
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_enabled=True,
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
            aws_access_key_id="key",
            aws_secret_access_key="secret",
        ),
    )
    service = StorageService()
    service._client = fake_s3
    first_image = _png_bytes("red")
    second_image = _png_bytes("blue")

    first_url = await service.upload_thumbnail_from_bytes(
        first_image, "recipe-id", "image/png"
    )
    second_url = await service.upload_thumbnail_from_bytes(
        second_image, "recipe-id", "image/png"
    )

    first_hash = hashlib.sha256(first_image).hexdigest()
    second_hash = hashlib.sha256(second_image).hexdigest()
    assert first_url and first_url.endswith(f"/thumbnails/recipe-id/{first_hash}.png")
    assert second_url and second_url.endswith(f"/thumbnails/recipe-id/{second_hash}.png")
    assert first_url != second_url
    assert fake_s3.puts[0]["CacheControl"] == "public, max-age=31536000, immutable"


class DeletingS3:
    def __init__(self, *, errors=None):
        self.remaining = ["prefix/one", "prefix/two"]
        self.errors = errors or []

    def list_objects_v2(self, **_kwargs):
        return {"Contents": [{"Key": key} for key in self.remaining]}

    def delete_objects(self, **kwargs):
        keys = [item["Key"] for item in kwargs["Delete"]["Objects"]]
        if self.errors:
            return {"Deleted": [], "Errors": self.errors}
        self.remaining = [key for key in self.remaining if key not in keys]
        return {"Deleted": [{"Key": key} for key in keys], "Errors": []}


@pytest.mark.asyncio
async def test_delete_prefix_finishes_every_object(monkeypatch):
    fake_s3 = DeletingS3()
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(s3_enabled=True, s3_bucket_name="recipe-images"),
    )
    service = StorageService()
    service._client = fake_s3

    assert await service.delete_prefix("prefix/") == 2
    assert fake_s3.remaining == []


@pytest.mark.asyncio
async def test_delete_prefix_surfaces_partial_provider_failure(monkeypatch):
    fake_s3 = DeletingS3(errors=[{"Key": "prefix/one", "Code": "InternalError"}])
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(s3_enabled=True, s3_bucket_name="recipe-images"),
    )
    service = StorageService()
    service._client = fake_s3

    with pytest.raises(StorageCleanupError, match="failed object deletions"):
        await service.delete_prefix("prefix/")


def test_thumbnail_cleanup_includes_legacy_and_content_addressed_keys():
    assert StorageService.thumbnail_prefixes("recipe-id") == [
        "thumbnails/recipe-id.",
        "thumbnails/recipe-id/",
    ]
