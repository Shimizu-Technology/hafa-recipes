"""S3 storage service for persisting recipe thumbnails."""

import asyncio
import hashlib
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from urllib.parse import urljoin, urlparse
from uuid import UUID, uuid4

import boto3
import httpx
from botocore.exceptions import ClientError

from app.config import get_settings
from app.image_validation import (
    ImageValidationError,
    ThumbnailVariantSpec,
    ValidatedImage,
    decode_and_validate_base64_image,
    normalize_thumbnail_variants,
    validate_image_bytes,
)
from app.media_lifecycle import recipe_media_upload_guard
from app.security import PublicHTTPTransport

MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024
STORED_THUMBNAIL_QUALITY = 82
MAX_CONCURRENT_THUMBNAIL_NORMALIZATIONS = 2
MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024
THUMBNAIL_VARIANT_SPECS = {
    "list": ThumbnailVariantSpec(max_dimension=640, max_bytes=200 * 1024),
    "hero": ThumbnailVariantSpec(max_dimension=1_280, max_bytes=500 * 1024),
}
THUMBNAIL_TRANSFORM_VERSION = "webp-v1-list640-200k-hero1280-500k-q82"
_VERSIONED_THUMBNAIL_KEY = re.compile(
    r"^(thumbnails/[^/]+/[0-9a-f]{64})/(?:list|hero)\.webp$"
)

_thumbnail_executor = ThreadPoolExecutor(
    max_workers=MAX_CONCURRENT_THUMBNAIL_NORMALIZATIONS,
    thread_name_prefix="thumbnail-normalizer",
)


def is_versioned_thumbnail_url(image_url: str | None) -> bool:
    """Return whether a URL path has the generated list/hero variant shape."""
    if not image_url:
        return False
    try:
        path = urlparse(image_url).path.lstrip("/")
    except ValueError:
        return False
    return _VERSIONED_THUMBNAIL_KEY.fullmatch(path) is not None


class StorageCleanupError(RuntimeError):
    """Raised when object cleanup is incomplete and must be retried."""


class StorageService:
    """
    Handles uploading and managing images in S3.
    
    Thumbnails use immutable, content-addressed keys under each recipe prefix.
    """
    
    def __init__(self):
        self._client = None
    
    @property
    def client(self):
        """Lazy-load S3 client."""
        if self._client is None:
            settings = get_settings()
            if settings.s3_enabled:
                self._client = boto3.client(
                    "s3",
                    aws_access_key_id=settings.aws_access_key_id,
                    aws_secret_access_key=settings.aws_secret_access_key,
                    region_name=settings.aws_region,
                )
        return self._client
    
    @property
    def bucket_name(self) -> Optional[str]:
        """Get bucket name from settings."""
        return get_settings().s3_bucket_name
    
    @property
    def is_enabled(self) -> bool:
        """Check if S3 storage is enabled."""
        return get_settings().s3_enabled

    async def _prepare_thumbnail_variants(
        self,
        image_data: bytes,
        declared_content_type: str,
    ) -> dict[str, ValidatedImage]:
        """Validate and render delivery-sized variants off the event loop."""

        def prepare() -> dict[str, ValidatedImage]:
            validated = validate_image_bytes(
                image_data,
                max_bytes=MAX_THUMBNAIL_BYTES,
                declared_content_type=declared_content_type,
            )
            return normalize_thumbnail_variants(
                validated,
                variants=THUMBNAIL_VARIANT_SPECS,
                quality=STORED_THUMBNAIL_QUALITY,
            )

        # A valid source may decode to roughly 160 MB. A dedicated two-worker
        # pool bounds memory without occupying asyncio's shared default executor.
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_thumbnail_executor, prepare)

    def canonical_thumbnail_url(self, key: str) -> str:
        """Return the stable S3 URL persisted in the recipe row."""
        settings = get_settings()
        return (
            f"https://{self.bucket_name}.s3.{settings.aws_region}.amazonaws.com/{key}"
        )

    def thumbnail_delivery_url(
        self,
        image_url: str | None,
        *,
        variant: str,
    ) -> str | None:
        """Select a stored variant and optionally map an owned S3 URL to the CDN."""
        if not image_url:
            return None
        if variant not in THUMBNAIL_VARIANT_SPECS:
            raise ValueError(f"Unknown thumbnail variant: {variant}")

        parsed = urlparse(image_url)
        key = parsed.path.lstrip("/")
        versioned_match = _VERSIONED_THUMBNAIL_KEY.fullmatch(key)
        if versioned_match:
            key = f"{versioned_match.group(1)}/{variant}.webp"
            parsed = parsed._replace(path=f"/{key}")

        settings = get_settings()
        bucket_hosts = {
            f"{self.bucket_name}.s3.{settings.aws_region}.amazonaws.com",
            f"{self.bucket_name}.s3.amazonaws.com",
        }
        media_base_url = (settings.recipe_media_base_url or "").rstrip("/")
        if media_base_url and parsed.hostname in bucket_hosts:
            return f"{media_base_url}/{key}"
        return parsed.geturl()

    @staticmethod
    def _safe_urlparse(image_url: str):
        """Parse an untrusted stored URL without allowing malformed rows to abort a batch."""
        try:
            parsed = urlparse(image_url)
            _ = parsed.hostname
            _ = parsed.port
            return parsed
        except (TypeError, ValueError):
            return None

    def _owned_storage_hosts(self) -> set[str | None]:
        """Return the configured S3 and delivery hosts."""
        settings = get_settings()
        hosts: set[str | None] = {
            f"{self.bucket_name}.s3.{settings.aws_region}.amazonaws.com",
            f"{self.bucket_name}.s3.amazonaws.com",
        }
        if settings.recipe_media_base_url:
            media_base = self._safe_urlparse(settings.recipe_media_base_url)
            hosts.add(media_base.hostname if media_base else None)
        return hosts

    def thumbnail_origin(self, image_url: str) -> str:
        """Classify a thumbnail as app-owned storage or an external source."""
        parsed = self._safe_urlparse(image_url)
        return (
            "app_owned"
            if parsed and parsed.hostname in self._owned_storage_hosts()
            else "external"
        )

    def _owned_storage_key(self, image_url: str) -> str | None:
        """Return a strict app-owned object key without trusting lookalike hosts."""
        settings = get_settings()
        parsed = self._safe_urlparse(image_url)
        if (
            parsed is None
            or parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port is not None
            or parsed.query
            or parsed.fragment
        ):
            return None
        bucket_hosts = {
            f"{self.bucket_name}.s3.{settings.aws_region}.amazonaws.com",
            f"{self.bucket_name}.s3.amazonaws.com",
        }
        key = parsed.path.lstrip("/")
        if parsed.hostname in bucket_hosts:
            return key or None
        if not settings.recipe_media_base_url:
            return None
        media_base = urlparse(settings.recipe_media_base_url.rstrip("/"))
        if parsed.hostname != media_base.hostname:
            return None
        base_path = media_base.path.rstrip("/")
        expected_prefix = f"{base_path}/" if base_path else "/"
        if not parsed.path.startswith(expected_prefix):
            return None
        key = parsed.path[len(expected_prefix) :]
        return key or None

    @staticmethod
    def _key_belongs_to_recipe(key: str, recipe_id: str | UUID) -> bool:
        normalized = str(UUID(str(recipe_id)))
        return key.startswith((f"thumbnails/{normalized}.", f"thumbnails/{normalized}/"))

    def is_owned_versioned_thumbnail_url(
        self,
        image_url: str | None,
        recipe_id: str | UUID,
    ) -> bool:
        """Return whether a canonical generated thumbnail is strictly app-owned."""
        if not image_url:
            return False
        key = self._owned_storage_key(image_url)
        return bool(
            key
            and self._key_belongs_to_recipe(key, recipe_id)
            and _VERSIONED_THUMBNAIL_KEY.fullmatch(key)
        )

    def thumbnail_backfill_contract(self) -> dict[str, str]:
        """Describe the non-secret destination and transform contract for a run."""
        settings = get_settings()
        destination = {
            "bucket": self.bucket_name or "",
            "region": settings.aws_region,
            "media_base_url": (settings.recipe_media_base_url or "").rstrip("/"),
            "transform_version": THUMBNAIL_TRANSFORM_VERSION,
        }
        fingerprint = hashlib.sha256(
            json.dumps(destination, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        release_id = os.environ.get("RENDER_GIT_COMMIT") or getattr(
            settings,
            "app_release_id",
            None,
        )
        if not release_id or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:@+-]{0,159}",
            release_id.strip(),
        ):
            raise ValueError("A safe runtime release ID is required for thumbnail backfill")
        if (
            getattr(settings, "environment", "development") == "production"
            and release_id == "local-development"
        ):
            raise ValueError("Production thumbnail backfill requires a deployed release ID")
        return {
            "destination_fingerprint": fingerprint,
            "transform_version": THUMBNAIL_TRANSFORM_VERSION,
            "release_id": release_id.strip(),
        }

    async def fetch_thumbnail_source(
        self,
        image_url: str,
        recipe_id: str | UUID,
    ) -> ValidatedImage:
        """Download and validate one owned or external thumbnail without writes."""
        owned_key = self._owned_storage_key(image_url)
        if owned_key:
            if not self._key_belongs_to_recipe(owned_key, recipe_id):
                raise ValueError("Owned thumbnail source does not match recipe")
            image_data, content_type = await asyncio.to_thread(
                self._download_owned_thumbnail,
                owned_key,
            )
        else:
            parsed = self._safe_urlparse(image_url)
            if parsed and parsed.hostname in self._owned_storage_hosts():
                raise ValueError("Owned thumbnail URL is not canonical")
            image_data, content_type = await self._download_public_url(image_url)
        return validate_image_bytes(
            image_data,
            max_bytes=MAX_THUMBNAIL_BYTES,
            declared_content_type=content_type,
        )

    def _download_owned_thumbnail(self, key: str) -> tuple[bytes, str]:
        """Read an app-owned object with AWS credentials and a strict byte cap."""
        response = self.client.get_object(Bucket=self.bucket_name, Key=key)
        content_length = int(response.get("ContentLength") or 0)
        if content_length > MAX_THUMBNAIL_BYTES:
            response["Body"].close()
            raise ValueError("Thumbnail exceeds maximum size")
        body = response["Body"]
        try:
            image_data = body.read(MAX_THUMBNAIL_BYTES + 1)
        finally:
            body.close()
        if len(image_data) > MAX_THUMBNAIL_BYTES:
            raise ValueError("Thumbnail exceeds maximum size")
        return image_data, response.get("ContentType") or "application/octet-stream"

    async def prepare_thumbnail_variants(
        self,
        image: ValidatedImage,
    ) -> dict[str, ValidatedImage]:
        """Render a previously validated image into bounded delivery variants."""
        return await self._prepare_thumbnail_variants(image.data, image.content_type)

    async def store_prepared_thumbnail_variants_locked(
        self,
        variants: dict[str, ValidatedImage],
        recipe_id: str | UUID,
    ) -> str:
        """Persist prepared variants while the caller holds the recipe media lock."""
        result = await self._store_thumbnail_variants(
            variants,
            recipe_id,
            media_lock_held=True,
        )
        if result is None:  # Defensive: the locked storage path always returns a URL.
            raise RuntimeError("Thumbnail variant storage did not return a URL")
        return result

    async def _store_thumbnail_variants(
        self,
        variants: dict[str, ValidatedImage],
        recipe_id: str | UUID,
        *,
        media_lock_held: bool,
    ) -> str | None:
        """Store one content-addressed variant set and return its canonical hero URL."""
        variant_set = hashlib.sha256()
        for name in sorted(THUMBNAIL_VARIANT_SPECS):
            variant_set.update(name.encode("utf-8"))
            variant_set.update(b"\0")
            variant_set.update(variants[name].data)
        image_hash = variant_set.hexdigest()
        keys = {
            name: f"thumbnails/{recipe_id}/{image_hash}/{name}.webp"
            for name in THUMBNAIL_VARIANT_SPECS
        }

        def put_objects() -> None:
            for name, key in keys.items():
                image = variants[name]
                print(f"📤 Uploading to S3: {key}")
                self.client.put_object(
                    Bucket=self.bucket_name,
                    Key=key,
                    Body=image.data,
                    ContentType=image.content_type,
                    CacheControl="public, max-age=31536000, immutable",
                )

        async def upload() -> None:
            await asyncio.to_thread(put_objects)

        if media_lock_held:
            await upload()
        else:
            async with recipe_media_upload_guard(recipe_id) as recipe_exists:
                if not recipe_exists:
                    return None
                await upload()

        return self.canonical_thumbnail_url(keys["hero"])
    
    async def _download_public_url(self, image_url: str) -> tuple[bytes, str]:
        """Download a public HTTP(S) URL, validating every redirect target."""
        current_url = image_url

        async with httpx.AsyncClient(timeout=30.0, transport=PublicHTTPTransport()) as client:
            for _ in range(6):
                async with client.stream("GET", current_url, follow_redirects=False) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise ValueError("Redirect missing Location header")
                        current_url = urljoin(current_url, location)
                        continue

                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "image/jpeg").split(";")[0]
                    if not content_type.lower().startswith("image/"):
                        raise ValueError("Thumbnail URL did not return an image")

                    content_length = response.headers.get("content-length")
                    if content_length and content_length.isdigit():
                        if int(content_length) > MAX_THUMBNAIL_BYTES:
                            raise ValueError("Thumbnail exceeds maximum size")

                    chunks = []
                    total_size = 0
                    async for chunk in response.aiter_bytes():
                        total_size += len(chunk)
                        if total_size > MAX_THUMBNAIL_BYTES:
                            raise ValueError("Thumbnail exceeds maximum size")
                        chunks.append(chunk)

                    return b"".join(chunks), content_type

        raise ValueError("Too many redirects downloading thumbnail")

    async def upload_thumbnail_from_url(
        self, 
        image_url: str, 
        recipe_id: str | UUID
    ) -> Optional[str]:
        """
        Download an image from URL and upload to S3.
        
        Args:
            image_url: External URL of the thumbnail
            recipe_id: Recipe ID to use as filename
            
        Returns:
            S3 URL if successful, None if failed or S3 not configured
        """
        return await self._upload_thumbnail_from_url(
            image_url,
            recipe_id,
            media_lock_held=False,
        )

    async def upload_thumbnail_from_url_locked(
        self,
        image_url: str,
        recipe_id: str | UUID,
    ) -> Optional[str]:
        """Upload while the caller holds the recipe media advisory lock."""

        return await self._upload_thumbnail_from_url(
            image_url,
            recipe_id,
            media_lock_held=True,
        )

    async def _upload_thumbnail_from_url(
        self,
        image_url: str,
        recipe_id: str | UUID,
        *,
        media_lock_held: bool,
    ) -> Optional[str]:
        """Download, validate, and store a thumbnail under the requested lock mode."""

        if not self.is_enabled:
            print("⚠️ S3 not configured, skipping thumbnail upload")
            return None
        if not image_url:
            return None

        try:
            # Download image from external URL
            print(f"📥 Downloading thumbnail from: {image_url[:60]}...")
            image_data, content_type = await self._download_public_url(image_url)
            variants = await self._prepare_thumbnail_variants(
                image_data,
                content_type,
            )
            s3_url = await self._store_thumbnail_variants(
                variants,
                recipe_id,
                media_lock_held=media_lock_held,
            )
            if not s3_url:
                return None
            print(f"✅ Thumbnail uploaded: {s3_url}")
            return s3_url
            
        except httpx.HTTPError as e:
            print(f"❌ Failed to download thumbnail: {e}")
            return None
        except ClientError as e:
            print(f"❌ Failed to upload to S3: {e}")
            return None
        except Exception as e:
            print(f"❌ Unexpected error uploading thumbnail: {e}")
            return None
    
    async def delete_thumbnail(self, recipe_id: str | UUID) -> bool:
        """
        Delete a thumbnail from S3.
        
        Args:
            recipe_id: Recipe ID
            
        Returns:
            True if deleted, False otherwise
        """
        if not self.is_enabled:
            return False
        
        try:
            for prefix in self.thumbnail_prefixes(recipe_id):
                await self.delete_prefix(prefix)
            print(f"🗑️ Thumbnail deleted for recipe: {recipe_id}")
            return True
            
        except Exception as e:
            print(f"❌ Failed to delete thumbnail: {e}")
            return False
    
    async def delete_prefix(self, prefix: str) -> int:
        """Delete every object under a prefix or raise so durable cleanup retries."""
        if not self.is_enabled:
            return 0

        deleted_count = 0
        try:
            versioning = self.client.get_bucket_versioning(Bucket=self.bucket_name)
            if versioning.get("Status") in {"Enabled", "Suspended"}:
                return self._delete_all_prefix_versions(prefix)
            while True:
                response = self.client.list_objects_v2(
                    Bucket=self.bucket_name,
                    Prefix=prefix,
                    MaxKeys=1000,
                )
                objects = response.get("Contents", [])
                if not objects:
                    break

                delete_response = self.client.delete_objects(
                    Bucket=self.bucket_name,
                    Delete={
                        "Objects": [{"Key": obj["Key"]} for obj in objects],
                        "Quiet": False,
                    },
                )
                errors = delete_response.get("Errors", [])
                if errors:
                    raise StorageCleanupError(
                        f"S3 reported {len(errors)} failed object deletions"
                    )
                deleted = delete_response.get("Deleted", [])
                if len(deleted) != len(objects):
                    raise StorageCleanupError(
                        "S3 did not confirm every requested object deletion"
                    )
                deleted_count += len(deleted)

            return deleted_count
        except StorageCleanupError:
            raise
        except Exception as error:
            raise StorageCleanupError(
                f"Unable to delete S3 prefix: {type(error).__name__}"
            ) from error

    @staticmethod
    def thumbnail_prefixes(recipe_id: str | UUID) -> list[str]:
        """Return both legacy and content-addressed thumbnail prefixes."""
        normalized = str(recipe_id)
        return [f"thumbnails/{normalized}.", f"thumbnails/{normalized}/"]

    async def upload_thumbnail_from_bytes(
        self,
        image_data: bytes,
        recipe_id: str | UUID,
        content_type: str = "image/jpeg"
    ) -> Optional[str]:
        """
        Upload image bytes directly to S3.
        
        Args:
            image_data: Raw image bytes
            recipe_id: Recipe ID to use as filename
            content_type: MIME type of the image
            
        Returns:
            S3 URL if successful, None if failed or S3 not configured
        """
        if not self.is_enabled:
            print("⚠️ S3 not configured, skipping thumbnail upload")
            return None
        
        try:
            variants = await self._prepare_thumbnail_variants(
                image_data,
                content_type,
            )
            s3_url = await self._store_thumbnail_variants(
                variants,
                recipe_id,
                media_lock_held=False,
            )
            if not s3_url:
                return None
            print(f"✅ Thumbnail uploaded: {s3_url}")
            return s3_url
            
        except ImageValidationError as e:
            print(f"❌ Invalid thumbnail image: {e}")
            return None
        except ClientError as e:
            print(f"❌ Failed to upload to S3: {e}")
            return None
        except Exception as e:
            print(f"❌ Unexpected error uploading thumbnail: {e}")
            return None

    async def upload_chat_image(
        self,
        image_base64: str,
        user_id: str,
    ) -> Optional[str]:
        """
        Upload a base64 chat image to S3.
        
        Chat images are stored with the pattern: chat-images/{user_id}/{uuid}.jpg.
        Each upload owns its object so clearing one conversation cannot break an
        image reused by another conversation.
        
        Args:
            image_base64: Base64 encoded image data
            user_id: User ID for organizing images
            
        Returns:
            S3 URL if successful, None if failed or S3 not configured
        """
        if not self.is_enabled:
            print("⚠️ S3 not configured, skipping chat image upload")
            return None
        
        if not image_base64:
            return None
        
        try:
            validated = decode_and_validate_base64_image(
                image_base64,
                max_bytes=MAX_CHAT_IMAGE_BYTES,
            )
            image_data = validated.data
            
            # Determine content type from base64 prefix
            content_type = validated.content_type
            extension = {
                "image/jpeg": "jpg",
                "image/png": "png",
                "image/gif": "gif",
                "image/webp": "webp",
            }[content_type]
            
            # Upload to S3 under chat-images folder
            s3_key = f"chat-images/{user_id}/{uuid4().hex}.{extension}"
            
            self.client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=image_data,
                ContentType=content_type,
            )
            
            # Generate public URL
            settings = get_settings()
            s3_url = f"https://{self.bucket_name}.s3.{settings.aws_region}.amazonaws.com/{s3_key}"
            
            print("✅ Chat image uploaded")
            return s3_url
            
        except Exception as error:
            print(f"❌ Failed to upload chat image to S3: {type(error).__name__}")
            return None

    async def delete_chat_images(self, image_urls: list[str], user_id: str) -> int:
        """Delete exact app-owned chat objects for one stable application user."""
        if not image_urls or not self.is_enabled:
            return 0

        keys: list[str] = []
        for image_url in dict.fromkeys(image_urls):
            if not self.is_owned_chat_image_url(image_url, user_id):
                raise ValueError("Chat image does not belong to the authenticated user")
            keys.append(urlparse(image_url).path.removeprefix("/"))

        try:
            versioning = self.client.get_bucket_versioning(Bucket=self.bucket_name)
            if versioning.get("Status") in {"Enabled", "Suspended"}:
                for key in keys:
                    self._delete_all_object_versions(key)
            else:
                self._delete_objects_confirmed([{"Key": key} for key in keys])
            return len(keys)
        except StorageCleanupError:
            raise
        except Exception as error:
            raise StorageCleanupError("Unable to delete chat images") from error

    def _delete_objects_confirmed(self, objects: list[dict[str, str]]) -> None:
        """Delete a bounded object/version batch and verify every provider acknowledgement."""
        response = self.client.delete_objects(
            Bucket=self.bucket_name,
            Delete={"Objects": objects, "Quiet": False},
        )
        errors = response.get("Errors", [])
        if errors:
            raise StorageCleanupError(
                f"S3 reported {len(errors)} failed object deletions"
            )
        deleted = {
            (item.get("Key"), item.get("VersionId"))
            for item in response.get("Deleted", [])
        }
        requested = {(item["Key"], item.get("VersionId")) for item in objects}
        if not requested.issubset(deleted):
            raise StorageCleanupError(
                "S3 did not confirm every requested object deletion"
            )

    def _delete_all_prefix_versions(self, prefix: str) -> int:
        """Permanently purge all versions and delete markers beneath one prefix."""
        objects: list[dict[str, str]] = []
        request: dict[str, object] = {
            "Bucket": self.bucket_name,
            "Prefix": prefix,
            "MaxKeys": 1000,
        }
        while True:
            response = self.client.list_object_versions(**request)
            for item in [*response.get("Versions", []), *response.get("DeleteMarkers", [])]:
                if item.get("Key", "").startswith(prefix) and item.get("VersionId"):
                    objects.append({"Key": item["Key"], "VersionId": item["VersionId"]})
            if not response.get("IsTruncated"):
                break
            request["KeyMarker"] = response["NextKeyMarker"]
            request["VersionIdMarker"] = response["NextVersionIdMarker"]

        for start in range(0, len(objects), 1000):
            self._delete_objects_confirmed(objects[start:start + 1000])

        remaining = self.client.list_object_versions(
            Bucket=self.bucket_name,
            Prefix=prefix,
            MaxKeys=1,
        )
        if remaining.get("Versions") or remaining.get("DeleteMarkers"):
            raise StorageCleanupError("S3 retained an object version under the prefix")
        return len(objects)

    def _delete_all_object_versions(self, key: str) -> None:
        """Permanently purge all versions and delete markers for one exact key."""
        objects: list[dict[str, str]] = []
        request: dict[str, object] = {
            "Bucket": self.bucket_name,
            "Prefix": key,
            "MaxKeys": 1000,
        }
        while True:
            response = self.client.list_object_versions(**request)
            for item in [*response.get("Versions", []), *response.get("DeleteMarkers", [])]:
                if item.get("Key") == key and item.get("VersionId"):
                    objects.append({"Key": key, "VersionId": item["VersionId"]})
            if not response.get("IsTruncated"):
                break
            request["KeyMarker"] = response["NextKeyMarker"]
            request["VersionIdMarker"] = response["NextVersionIdMarker"]

        for start in range(0, len(objects), 1000):
            self._delete_objects_confirmed(objects[start:start + 1000])

        remaining = self.client.list_object_versions(
            Bucket=self.bucket_name,
            Prefix=key,
            MaxKeys=1000,
        )
        if any(
            item.get("Key") == key
            for item in [
                *remaining.get("Versions", []),
                *remaining.get("DeleteMarkers", []),
            ]
        ):
            raise StorageCleanupError("S3 retained a chat image object version")

    def is_owned_chat_image_url(self, image_url: str, user_id: str) -> bool:
        """Return whether a public URL points to this user's app-owned chat object."""
        if not self.bucket_name:
            return False

        parsed = urlparse(image_url)
        settings = get_settings()
        expected_host = f"{self.bucket_name}.s3.{settings.aws_region}.amazonaws.com"
        expected_prefix = f"/chat-images/{user_id}/"
        return (
            parsed.scheme == "https"
            and parsed.hostname == expected_host
            and parsed.path.startswith(expected_prefix)
            and ".." not in parsed.path
            and not parsed.query
            and not parsed.fragment
        )


# Singleton instance
storage_service = StorageService()
