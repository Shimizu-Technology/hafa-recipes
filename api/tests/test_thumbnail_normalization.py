import io

import pytest
from PIL import Image

from app.image_validation import (
    normalize_thumbnail_image,
    validate_image_bytes,
)


def image_bytes(
    mode: str,
    size: tuple[int, int],
    color: str | tuple[int, ...],
    *,
    image_format: str = "PNG",
    exif: Image.Exif | None = None,
) -> bytes:
    """Build an in-memory image fixture."""
    output = io.BytesIO()
    Image.new(mode, size, color=color).save(output, format=image_format, exif=exif)
    return output.getvalue()


def validated(data: bytes, content_type: str):
    """Validate a fixture with the production thumbnail byte limit."""
    return validate_image_bytes(
        data,
        max_bytes=10 * 1024 * 1024,
        declared_content_type=content_type,
    )


def test_thumbnail_normalization_bounds_dimensions_and_strips_metadata():
    exif = Image.Exif()
    exif[0x010E] = "private recipe photo description"
    source = image_bytes(
        "RGB",
        (3_200, 1_600),
        "tomato",
        image_format="JPEG",
        exif=exif,
    )

    result = normalize_thumbnail_image(
        validated(source, "image/jpeg"),
        max_dimension=1_600,
    )

    assert result.content_type == "image/webp"
    assert (result.width, result.height) == (1_600, 800)
    with Image.open(io.BytesIO(result.data)) as normalized:
        assert normalized.format == "WEBP"
        assert normalized.size == (1_600, 800)
        assert not normalized.getexif()


def test_thumbnail_normalization_applies_exif_orientation():
    exif = Image.Exif()
    exif[0x0112] = 6
    source = image_bytes(
        "RGB",
        (400, 200),
        "green",
        image_format="JPEG",
        exif=exif,
    )

    result = normalize_thumbnail_image(
        validated(source, "image/jpeg"),
        max_dimension=1_600,
    )

    assert (result.width, result.height) == (200, 400)


def test_thumbnail_normalization_preserves_transparency_without_upscaling():
    source = image_bytes("RGBA", (24, 12), (10, 20, 30, 64))

    result = normalize_thumbnail_image(
        validated(source, "image/png"),
        max_dimension=1_600,
    )

    assert (result.width, result.height) == (24, 12)
    with Image.open(io.BytesIO(result.data)) as normalized:
        assert normalized.mode == "RGBA"
        assert normalized.getpixel((0, 0))[3] == 64


def test_thumbnail_normalization_uses_first_animation_frame():
    output = io.BytesIO()
    first = Image.new("RGB", (20, 10), color="red")
    second = Image.new("RGB", (20, 10), color="blue")
    first.save(
        output,
        format="GIF",
        save_all=True,
        append_images=[second],
        duration=100,
        loop=0,
    )

    result = normalize_thumbnail_image(
        validated(output.getvalue(), "image/gif"),
        max_dimension=1_600,
    )

    with Image.open(io.BytesIO(result.data)) as normalized:
        assert not getattr(normalized, "is_animated", False)
        red, green, blue = normalized.convert("RGB").getpixel((0, 0))
        assert red > 200
        assert green < 40
        assert blue < 40


@pytest.mark.parametrize(
    ("max_dimension", "quality"),
    [(0, 82), (1_600, 0), (1_600, 101)],
)
def test_thumbnail_normalization_rejects_invalid_settings(max_dimension, quality):
    source = validated(image_bytes("RGB", (2, 2), "blue"), "image/png")

    with pytest.raises(ValueError):
        normalize_thumbnail_image(
            source,
            max_dimension=max_dimension,
            quality=quality,
        )
