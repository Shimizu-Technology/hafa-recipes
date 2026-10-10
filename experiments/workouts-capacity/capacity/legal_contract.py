"""Fixed public matrix receipt vocabulary; no application or provider imports."""

CASES = (
    "single_rgba",
    "two_rgba",
    "two_palette",
    "wide_rgba",
    "rgba_ffmpeg",
    "palette_ffmpeg",
    "alpha_cover_ffmpeg",
    "cancel_normalizer",
    "cancel_media",
    "burst",
    "retained_cycles",
)
COUNTS = dict(zip(CASES, (1, 2, 2, 1, 2, 2, 1, 0, 0, 4, 8), strict=True))
NUMBERS = {
    "normalized",
    "stored",
    "distinct_recipe_count",
    "frames",
    "scene_calls",
    "normalizer_peak",
    "scene_child_count",
}
BOOLEANS = {
    "completed",
    "normalizers_settled",
    "cancelled",
    "media_permits_restored",
    "children_settled",
    "ffmpeg_overlap_observed",
    "cover_ffmpeg_overlap_observed",
    "two_normalizers_ffmpeg_overlap_observed",
}


def case_passed(case, result):
    if any(
        result.get(key) is not True
        for key in (
            "completed",
            "normalizers_settled",
            "media_permits_restored",
            "children_settled",
        )
    ):
        return False
    if any(
        result.get(key) != COUNTS[case]
        for key in ("normalized", "stored", "distinct_recipe_count")
    ):
        return False
    if (
        case in {"two_rgba", "two_palette", "rgba_ffmpeg", "palette_ffmpeg", "burst"}
        and result.get("normalizer_peak") != 2
    ):
        return False
    if case in {"rgba_ffmpeg", "palette_ffmpeg", "alpha_cover_ffmpeg"} and (
        not result.get("scene_child_count")
        or not result.get("frames")
        or not result.get("scene_calls")
        or result.get("ffmpeg_overlap_observed") is not True
    ):
        return False
    if (
        case in {"rgba_ffmpeg", "palette_ffmpeg"}
        and result.get("two_normalizers_ffmpeg_overlap_observed") is not True
    ):
        return False
    if (
        case == "alpha_cover_ffmpeg"
        and result.get("cover_ffmpeg_overlap_observed") is not True
    ):
        return False
    return not (
        case in {"cancel_normalizer", "cancel_media"}
        and result.get("cancelled") is not True
    )
