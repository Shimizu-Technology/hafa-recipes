import io

import pytest
from PIL import Image, ImageDraw

from app.image_validation import (
    ImageValidationError,
    ThumbnailVariantSpec,
    normalize_thumbnail_image,
    normalize_thumbnail_variants,
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
    with Image.new(mode, size, color=color) as image:
        image.save(output, format=image_format, **({"exif": exif} if exif is not None else {}))
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


def test_thumbnail_variants_enforce_dimension_and_transfer_budgets():
    noisy = Image.effect_noise((2_000, 1_500), 100).convert("RGB")
    output = io.BytesIO()
    noisy.save(output, format="JPEG", quality=95)

    variants = normalize_thumbnail_variants(
        validated(output.getvalue(), "image/jpeg"),
        variants={
            "list": ThumbnailVariantSpec(max_dimension=640, max_bytes=200 * 1024),
            "hero": ThumbnailVariantSpec(max_dimension=1_280, max_bytes=500 * 1024),
        },
    )

    assert max(variants["list"].width, variants["list"].height) <= 640
    assert len(variants["list"].data) <= 200 * 1024
    assert max(variants["hero"].width, variants["hero"].height) <= 1_280
    assert len(variants["hero"].data) <= 500 * 1024


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


@pytest.mark.parametrize(
    ("orientation", "corners"),
    [(6, [(0, 0, 255), (255, 0, 0), (255, 255, 0), (0, 255, 0)]),
     (8, [(0, 255, 0), (255, 255, 0), (255, 0, 0), (0, 0, 255)])],
)
def test_large_asymmetric_jpeg_orientation_and_rounding_preserve_corners(orientation, corners):
    output = io.BytesIO()
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010E] = "private photo metadata"
    with Image.new("RGB", (4000, 1001), "red") as image:
        draw = ImageDraw.Draw(image)
        draw.rectangle((2000, 0, 3999, 500), fill="lime")
        draw.rectangle((0, 501, 1999, 1000), fill="blue")
        draw.rectangle((2000, 501, 3999, 1000), fill="yellow")
        image.save(output, format="JPEG", quality=95, exif=exif)
    original = output.getvalue()
    source = validated(original, "image/jpeg")
    result = normalize_thumbnail_image(source, max_dimension=1280)
    assert source.data == original and (source.width, source.height) == (4000, 1001)
    assert (result.width, result.height) == (320, 1280)
    with Image.open(io.BytesIO(result.data)) as image:
        assert not image.getexif() and "icc_profile" not in image.info and "xmp" not in image.info
        for point, expected in zip([(8, 8), (311, 8), (8, 1271), (311, 1271)], corners):
            assert max(abs(a - b) for a, b in zip(image.getpixel(point), expected)) < 30


def test_palette_gif_transparency_is_filtered_instead_of_nearest_neighbor():
    output = io.BytesIO()
    with Image.new("P", (128, 64), 0) as image:
        image.putpalette([255, 0, 0, 0, 255, 0] + [0] * 762)
        ImageDraw.Draw(image).rectangle((64, 0, 127, 63), fill=1)
        image.save(output, format="GIF", transparency=0)
    result = normalize_thumbnail_image(validated(output.getvalue(), "image/gif"), max_dimension=32)
    with Image.open(io.BytesIO(result.data)) as image:
        assert image.mode == "RGBA" and image.size == (32, 16)
        alpha = [image.getpixel((x, 8))[3] for x in range(32)]
        assert alpha[0] == 0 and alpha[-1] == 255
        assert any(0 < value < 255 for value in alpha)


@pytest.mark.parametrize("mode", ["RGBA", "LA"])
def test_downscaled_alpha_survives_all_variants(mode):
    color = (20, 40, 80, 64) if mode == "RGBA" else (80, 64)
    original = image_bytes(mode, (1600, 800), color)
    variants = normalize_thumbnail_variants(validated(original, "image/png"), variants={
        "list": ThumbnailVariantSpec(640, 200 * 1024),
        "hero": ThumbnailVariantSpec(1280, 500 * 1024),
    })
    for name, result in variants.items():
        with Image.open(io.BytesIO(result.data)) as image:
            assert image.mode == "RGBA" and image.getpixel((4, 4))[3] == 64
            assert max(image.size) <= (640 if name == "list" else 1280)


def test_truncated_jpeg_cannot_be_normalized_by_draft_decode():
    original = image_bytes("RGB", (4000, 2000), "tomato", image_format="JPEG")
    # JPEG verify checks headers; the actual decoder must still reject the
    # truncated entropy stream even when only a reduced IDCT is requested.
    source = validated(original[:len(original) // 2], "image/jpeg")
    with pytest.raises(ImageValidationError):
        normalize_thumbnail_image(source, max_dimension=1280)


def test_monochrome_png_is_filtered_instead_of_nearest_neighbor():
    output = io.BytesIO()
    with Image.new("1", (128, 64), 0) as image:
        ImageDraw.Draw(image).rectangle((64, 0, 127, 63), fill=1)
        image.save(output, format="PNG")
    result = normalize_thumbnail_image(validated(output.getvalue(), "image/png"), max_dimension=32)
    with Image.open(io.BytesIO(result.data)) as image:
        assert any(0 < image.getpixel((x, 8))[0] < 255 for x in range(32))


@pytest.mark.parametrize("image_format", ["JPEG", "PNG", "GIF", "WEBP"])
def test_all_allowed_formats_still_render_bounded_webp(image_format):
    source = image_bytes("RGB", (300, 200), "tomato", image_format=image_format)
    result = normalize_thumbnail_image(validated(source, f"image/{image_format.lower()}"), max_dimension=240)
    assert result.content_type == "image/webp" and (result.width, result.height) == (240, 160)


def test_full_pixel_allowance_remains_accepted_without_bypassing_dimension_byte_or_type_checks():
    # Header validation remains at40MP; this check deliberately does not imply
    # worst-case non-JPEG decode fits a512MiB mixed workload.
    with Image.new("1", (8000, 5000), 1) as image, io.BytesIO() as output:
        image.save(output, format="PNG")
        data = output.getvalue()
    source = validated(data, "image/png")
    assert (source.width, source.height) == (8000, 5000)
    with pytest.raises(ImageValidationError, match="limit"):
        validate_image_bytes(data, max_bytes=len(data) - 1)
    with pytest.raises(ImageValidationError, match="declared type"):
        validated(data, "image/jpeg")
    wide = image_bytes("RGB", (12001, 1), "red")
    with pytest.raises(ImageValidationError, match="dimensions"):
        validated(wide, "image/png")


def test_tight_delivery_budget_can_resize_repeatedly_without_truncating_output():
    with Image.effect_noise((512, 256), 100) as image, io.BytesIO() as output:
        image.save(output, format="PNG")
        source = validated(output.getvalue(), "image/png")
    result = normalize_thumbnail_variants(source, variants={"tiny": ThumbnailVariantSpec(320, 256)})["tiny"]
    assert len(result.data) <= 256 and result.width < 320
    with Image.open(io.BytesIO(result.data)) as image:
        image.load()
        assert image.size == (result.width, result.height)
