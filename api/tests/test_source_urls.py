"""Canonical source identity tests."""

from app.source_urls import canonicalize_source


def test_youtube_variants_share_one_source_identity():
    watch = canonicalize_source(
        "https://www.youtube.com/watch?v=abcDEF_1234&utm_source=share"
    )
    short = canonicalize_source("https://youtu.be/abcDEF_1234?si=tracking")

    assert watch == short
    assert watch.key == "youtube:video:abcDEF_1234"


def test_tiktok_identity_ignores_creator_slug_and_tracking():
    first = canonicalize_source(
        "https://www.tiktok.com/@first/video/7412345678901234567?_r=1&utm_source=copy"
    )
    second = canonicalize_source(
        "https://m.tiktok.com/@renamed/video/7412345678901234567?is_from_webapp=1"
    )

    assert first.key == second.key == "tiktok:video:7412345678901234567"
    assert "utm_source" not in first.url


def test_instagram_variants_strip_tracking_and_fragments():
    source = canonicalize_source(
        "https://www.instagram.com/reel/Example_42/?igshid=secret#comments"
    )

    assert source.url == "https://www.instagram.com/reel/Example_42/"
    assert source.key == "instagram:reel:Example_42"


def test_web_identity_sorts_query_and_ignores_scheme_and_tracking():
    http = canonicalize_source(
        "http://Example.com/recipes//red-rice/?b=2&utm_campaign=launch&a=1#method"
    )
    https = canonicalize_source(
        "https://example.com/recipes/red-rice?a=1&b=2"
    )

    assert http.key == https.key
    assert http.url == "http://example.com/recipes/red-rice?a=1&b=2"
    assert https.key and https.key.startswith("web:sha256:")


def test_manual_and_photo_placeholders_are_not_globally_deduplicated():
    assert canonicalize_source("manual://user-created").key is None
    assert canonicalize_source("photo-upload").key is None
