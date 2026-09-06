"""Central image validation before storage or paid AI calls."""

import base64
import binascii
import io
import warnings
from dataclasses import dataclass
from typing import Mapping

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_DIMENSION = 12_000
MAX_IMAGE_PIXELS = 40_000_000
ALLOWED_IMAGE_FORMATS = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "GIF": "image/gif",
    "WEBP": "image/webp",
}


class ImageValidationError(ValueError):
    """Raised when image bytes do not satisfy the application contract."""


@dataclass(frozen=True)
class ValidatedImage:
    data: bytes
    content_type: str
    width: int
    height: int


@dataclass(frozen=True)
class ThumbnailVariantSpec:
    """Output bounds for one recipe-thumbnail delivery surface."""

    max_dimension: int
    max_bytes: int | None = None


def _encode_webp(image: Image.Image, quality: int) -> bytes:
    output = io.BytesIO()
    image.save(output, format="WEBP", quality=quality, method=4)
    return output.getvalue()


def _render_thumbnail_variant(
    source: Image.Image,
    spec: ThumbnailVariantSpec,
    quality: int,
) -> ValidatedImage:
    rendered = source.copy()
    rendered.thumbnail(
        (spec.max_dimension, spec.max_dimension),
        Image.Resampling.LANCZOS,
    )

    qualities = [quality]
    if spec.max_bytes is not None and quality > 50:
        qualities = list(range(quality, 49, -8))
    while True:
        for candidate_quality in qualities:
            data = _encode_webp(rendered, candidate_quality)
            if spec.max_bytes is None or len(data) <= spec.max_bytes:
                width, height = rendered.size
                return ValidatedImage(
                    data=data,
                    content_type="image/webp",
                    width=width,
                    height=height,
                )

        width, height = rendered.size
        next_size = (
            max(1, int(width * 0.85)),
            max(1, int(height * 0.85)),
        )
        if next_size == rendered.size:
            raise ImageValidationError("Thumbnail cannot fit its delivery byte limit")
        rendered = rendered.resize(next_size, Image.Resampling.LANCZOS)


def normalize_thumbnail_variants(
    image: ValidatedImage,
    *,
    variants: Mapping[str, ThumbnailVariantSpec],
    quality: int = 82,
) -> dict[str, ValidatedImage]:
    """Create bounded, metadata-free WebP variants with one source decode."""
    if not variants:
        raise ValueError("At least one thumbnail variant is required")
    if quality < 1 or quality > 100:
        raise ValueError("Thumbnail quality must be between 1 and 100")
    for spec in variants.values():
        if spec.max_dimension < 1:
            raise ValueError("Thumbnail maximum dimension must be positive")
        if spec.max_bytes is not None and spec.max_bytes < 1:
            raise ValueError("Thumbnail maximum bytes must be positive")

    try:
        with Image.open(io.BytesIO(image.data)) as source:
            # Thumbnails are intentionally still images, including for GIF inputs.
            source.seek(0)
            normalized = ImageOps.exif_transpose(source)
            normalized.load()

            has_alpha = normalized.mode in {"RGBA", "LA"} or (
                normalized.mode == "P" and "transparency" in normalized.info
            )
            normalized = normalized.convert("RGBA" if has_alpha else "RGB")
            largest_dimension = max(spec.max_dimension for spec in variants.values())
            normalized.thumbnail(
                (largest_dimension, largest_dimension),
                Image.Resampling.LANCZOS,
            )

            return {
                name: _render_thumbnail_variant(normalized, spec, quality)
                for name, spec in variants.items()
            }
    except ImageValidationError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ImageValidationError("Image normalization failed") from exc


def normalize_thumbnail_image(
    image: ValidatedImage,
    *,
    max_dimension: int,
    quality: int = 82,
) -> ValidatedImage:
    """Create a bounded, metadata-free WebP thumbnail from validated image bytes."""
    return normalize_thumbnail_variants(
        image,
        variants={"thumbnail": ThumbnailVariantSpec(max_dimension=max_dimension)},
        quality=quality,
    )["thumbnail"]


def decode_and_validate_base64_image(
    encoded: str,
    *,
    max_bytes: int,
) -> ValidatedImage:
    """Decode strict base64 and validate its actual image format and dimensions."""
    if not encoded:
        raise ImageValidationError("Image data is required")

    try:
        image_data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageValidationError("Image must be valid base64") from exc

    return validate_image_bytes(image_data, max_bytes=max_bytes)


def validate_image_bytes(
    image_data: bytes,
    *,
    max_bytes: int,
    declared_content_type: str | None = None,
) -> ValidatedImage:
    """Validate byte size, real MIME type, dimensions, and decompression risk."""
    if not image_data:
        raise ImageValidationError("Image data is required")
    if len(image_data) > max_bytes:
        raise ImageValidationError(f"Image exceeds the {max_bytes // (1024 * 1024)}MB limit")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_data)) as image:
                image_format = (image.format or "").upper()
                content_type = ALLOWED_IMAGE_FORMATS.get(image_format)
                if not content_type:
                    raise ImageValidationError("Unsupported image format")

                width, height = image.size
                if width < 1 or height < 1:
                    raise ImageValidationError("Image dimensions are invalid")
                if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                    raise ImageValidationError("Image dimensions are too large")
                if width * height > MAX_IMAGE_PIXELS:
                    raise ImageValidationError("Image contains too many pixels")

                image.verify()
    except ImageValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageValidationError("Image dimensions are unsafe") from exc
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ImageValidationError("Image data is corrupt or unsupported") from exc

    normalized_declared_type = (declared_content_type or "").split(";", 1)[0].lower()
    if normalized_declared_type == "image/jpg":
        normalized_declared_type = "image/jpeg"
    if normalized_declared_type and normalized_declared_type != content_type:
        raise ImageValidationError("Image content does not match its declared type")

    return ValidatedImage(
        data=image_data,
        content_type=content_type,
        width=width,
        height=height,
    )
