import hashlib
import io
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from PIL import Image

import app.services.storage as storage
from app.services.storage import StorageCleanupError, StorageService


@asynccontextmanager
async def _existing_recipe_guard(_recipe_id):
    yield True


def _png_bytes(color: str) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2, 2), color=color).save(output, format="PNG")
    return output.getvalue()


class RecordingS3:
    def __init__(self):
        self.puts = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


class ChatImageS3(RecordingS3):
    def __init__(self, *, errors=None, versioning_status=None):
        super().__init__()
        self.deletes = []
        self.errors = errors or []
        self.versioning_status = versioning_status

    def get_bucket_versioning(self, **_kwargs):
        return {"Status": self.versioning_status} if self.versioning_status else {}

    def delete_objects(self, **kwargs):
        self.deletes.append(kwargs)
        return {"Deleted": kwargs["Delete"]["Objects"], "Errors": self.errors}


class VersionedChatImageS3(ChatImageS3):
    def __init__(self):
        super().__init__(versioning_status="Enabled")
        self.versions = [
            {"Key": "chat-images/stable-user/photo.png", "VersionId": "version-1"},
            {"Key": "chat-images/stable-user/photo.png-copy", "VersionId": "other-key"},
        ]
        self.delete_markers = [
            {"Key": "chat-images/stable-user/photo.png", "VersionId": "marker-1"},
        ]

    def list_object_versions(self, **_kwargs):
        return {
            "Versions": list(self.versions),
            "DeleteMarkers": list(self.delete_markers),
            "IsTruncated": False,
        }

    def delete_objects(self, **kwargs):
        result = super().delete_objects(**kwargs)
        requested = {
            (item["Key"], item.get("VersionId"))
            for item in kwargs["Delete"]["Objects"]
        }
        self.versions = [
            item for item in self.versions
            if (item["Key"], item["VersionId"]) not in requested
        ]
        self.delete_markers = [
            item for item in self.delete_markers
            if (item["Key"], item["VersionId"]) not in requested
        ]
        return result


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
            recipe_media_base_url=None,
        ),
    )
    monkeypatch.setattr(storage, "recipe_media_upload_guard", _existing_recipe_guard)
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

    def variant_set_hash(start: int) -> str:
        digest = hashlib.sha256()
        for put in sorted(
            fake_s3.puts[start : start + 2],
            key=lambda item: item["Key"],
        ):
            name = put["Key"].rsplit("/", 1)[-1].removesuffix(".webp")
            digest.update(name.encode("utf-8"))
            digest.update(b"\0")
            digest.update(put["Body"])
        return digest.hexdigest()

    first_hero = fake_s3.puts[1]["Body"]
    first_hash = variant_set_hash(0)
    second_hash = variant_set_hash(2)
    assert first_url and first_url.endswith(
        f"/thumbnails/recipe-id/{first_hash}/hero.webp"
    )
    assert second_url and second_url.endswith(
        f"/thumbnails/recipe-id/{second_hash}/hero.webp"
    )
    assert first_url != second_url
    assert [put["Key"].rsplit("/", 1)[-1] for put in fake_s3.puts] == [
        "list.webp",
        "hero.webp",
        "list.webp",
        "hero.webp",
    ]
    assert all(put["ContentType"] == "image/webp" for put in fake_s3.puts)
    assert all(
        put["CacheControl"] == "public, max-age=31536000, immutable"
        for put in fake_s3.puts
    )

    with Image.open(io.BytesIO(first_hero)) as stored_image:
        assert stored_image.format == "WEBP"
        assert stored_image.size == (2, 2)


@pytest.mark.asyncio
async def test_thumbnail_preparation_does_not_use_shared_default_executor(monkeypatch):
    async def unexpected_to_thread(*_args, **_kwargs):
        pytest.fail("thumbnail preparation must use its bounded dedicated executor")

    monkeypatch.setattr(storage.asyncio, "to_thread", unexpected_to_thread)

    variants = await StorageService()._prepare_thumbnail_variants(
        _png_bytes("red"),
        "image/png",
    )

    assert variants["list"].data
    assert variants["hero"].content_type == "image/webp"


def test_thumbnail_delivery_selects_variant_and_owned_cdn(monkeypatch):
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
            recipe_media_base_url="https://media.hafa.example/assets",
        ),
    )
    service = StorageService()
    source = (
        "https://recipe-images.s3.us-west-2.amazonaws.com/"
        f"thumbnails/recipe-id/{'a' * 64}/hero.webp"
    )

    assert service.thumbnail_delivery_url(source, variant="list") == (
        "https://media.hafa.example/assets/"
        f"thumbnails/recipe-id/{'a' * 64}/list.webp"
    )


def test_thumbnail_delivery_maps_owned_legacy_and_preserves_external(monkeypatch):
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
            recipe_media_base_url="https://media.hafa.example",
        ),
    )
    service = StorageService()
    legacy = "https://recipe-images.s3.us-west-2.amazonaws.com/thumbnails/old.webp"
    external = "https://images.example.com/recipe.jpg?version=2"

    assert service.thumbnail_delivery_url(legacy, variant="list") == (
        "https://media.hafa.example/thumbnails/old.webp"
    )
    assert service.thumbnail_delivery_url(external, variant="list") == external


@pytest.mark.asyncio
async def test_thumbnail_upload_is_rejected_after_recipe_deletion(monkeypatch):
    @asynccontextmanager
    async def deleted_recipe_guard(_recipe_id):
        yield False

    fake_s3 = RecordingS3()
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_enabled=True,
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
            recipe_media_base_url=None,
        ),
    )
    monkeypatch.setattr(storage, "recipe_media_upload_guard", deleted_recipe_guard)
    service = StorageService()
    service._client = fake_s3

    result = await service.upload_thumbnail_from_bytes(
        _png_bytes("red"),
        "11111111-1111-4111-8111-111111111111",
        "image/png",
    )

    assert result is None
    assert fake_s3.puts == []


@pytest.mark.asyncio
async def test_locked_thumbnail_upload_uses_the_callers_media_lock(monkeypatch):
    """The lock-aware path must not reacquire its own advisory lock."""

    @asynccontextmanager
    async def unexpected_guard(_recipe_id):
        pytest.fail("locked thumbnail upload must use the caller's media lock")
        yield False

    fake_s3 = RecordingS3()
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_enabled=True,
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
            recipe_media_base_url=None,
        ),
    )
    monkeypatch.setattr(storage, "recipe_media_upload_guard", unexpected_guard)
    service = StorageService()
    service._client = fake_s3
    image_bytes = _png_bytes("red")

    async def download(_url):
        return image_bytes, "image/png"

    monkeypatch.setattr(service, "_download_public_url", download)
    result = await service.upload_thumbnail_from_url_locked(
        "https://cdn.example.test/thumb.png",
        "11111111-1111-4111-8111-111111111111",
    )

    image_hash = hashlib.sha256()
    for put in sorted(fake_s3.puts, key=lambda item: item["Key"]):
        name = put["Key"].rsplit("/", 1)[-1].removesuffix(".webp")
        image_hash.update(name.encode("utf-8"))
        image_hash.update(b"\0")
        image_hash.update(put["Body"])
    expected_suffix = (
        f"/thumbnails/11111111-1111-4111-8111-111111111111/{image_hash.hexdigest()}/hero.webp"
    )
    assert result and result.endswith(expected_suffix)
    assert len(fake_s3.puts) == 2


class DeletingS3:
    def __init__(self, *, errors=None):
        self.remaining = ["prefix/one", "prefix/two"]
        self.errors = errors or []

    def get_bucket_versioning(self, **_kwargs):
        return {}

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


@pytest.mark.asyncio
async def test_chat_upload_uses_unique_non_enumerable_objects(monkeypatch, capsys):
    fake_s3 = ChatImageS3()
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_enabled=True,
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
        ),
    )
    service = StorageService()
    service._client = fake_s3
    encoded = __import__("base64").b64encode(_png_bytes("red")).decode("ascii")

    first = await service.upload_chat_image(encoded, "stable-user")
    second = await service.upload_chat_image(encoded, "stable-user")

    assert first and second and first != second
    assert all("/chat-images/stable-user/" in url for url in (first, second))
    assert fake_s3.puts[0]["Key"] != fake_s3.puts[1]["Key"]
    output = capsys.readouterr().out
    assert first not in output
    assert second not in output
    assert "stable-user" not in output


@pytest.mark.asyncio
async def test_chat_delete_is_exact_owned_deduplicated_and_idempotent(monkeypatch):
    fake_s3 = ChatImageS3()
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_enabled=True,
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
        ),
    )
    service = StorageService()
    service._client = fake_s3
    owned = "https://recipe-images.s3.us-west-2.amazonaws.com/chat-images/stable-user/photo.png"

    assert await service.delete_chat_images([owned, owned], "stable-user") == 1
    assert fake_s3.deletes[0]["Delete"]["Objects"] == [
        {"Key": "chat-images/stable-user/photo.png"}
    ]
    with pytest.raises(ValueError, match="authenticated user"):
        await service.delete_chat_images(
            ["https://recipe-images.s3.us-west-2.amazonaws.com/chat-images/other/photo.png"],
            "stable-user",
        )


@pytest.mark.asyncio
async def test_chat_delete_purges_every_version_and_delete_marker(monkeypatch):
    fake_s3 = VersionedChatImageS3()
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_enabled=True,
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
        ),
    )
    service = StorageService()
    service._client = fake_s3
    owned = "https://recipe-images.s3.us-west-2.amazonaws.com/chat-images/stable-user/photo.png"

    assert await service.delete_chat_images([owned], "stable-user") == 1
    requested = fake_s3.deletes[0]["Delete"]["Objects"]
    assert requested == [
        {"Key": "chat-images/stable-user/photo.png", "VersionId": "version-1"},
        {"Key": "chat-images/stable-user/photo.png", "VersionId": "marker-1"},
    ]
    assert fake_s3.versions == [
        {"Key": "chat-images/stable-user/photo.png-copy", "VersionId": "other-key"}
    ]
    assert fake_s3.delete_markers == []


@pytest.mark.asyncio
async def test_prefix_cleanup_purges_versioned_account_objects(monkeypatch):
    fake_s3 = VersionedChatImageS3()
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            s3_enabled=True,
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
        ),
    )
    service = StorageService()
    service._client = fake_s3

    deleted = await service.delete_prefix("chat-images/stable-user/")

    assert deleted == 3
    assert fake_s3.versions == []
    assert fake_s3.delete_markers == []
