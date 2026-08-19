"""Lifecycle metadata for recipe values derived from editable inputs."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

DEPENDENCY_VERSION = "recipe-inputs-v1"
DERIVED_KEYS = ("nutrition", "cost", "tags", "times")


def dependency_fingerprint(extracted: dict[str, Any], key: str = "nutrition") -> str:
    """Return a stable fingerprint for the inputs used by one derived value."""
    ingredients = [
        ingredient
        for component in (extracted.get("components") or [])
        if isinstance(component, dict)
        for ingredient in (component.get("ingredients") or [])
    ]
    sorted_ingredients = sorted(
        ingredients,
        key=lambda item: json.dumps(item, sort_keys=True, default=str),
    )
    if key in {"nutrition", "cost"}:
        payload = {"servings": extracted.get("servings"), "ingredients": sorted_ingredients}
    elif key == "tags":
        payload = {
            "title": extracted.get("title"),
            "ingredients": sorted(
                str(item.get("name") or "")
                for item in ingredients
                if isinstance(item, dict)
            ),
        }
    elif key == "times":
        payload = {
            "steps": [
                step
                for component in (extracted.get("components") or [])
                if isinstance(component, dict)
                for step in (component.get("steps") or [])
            ]
        }
    else:
        raise ValueError(f"Unsupported derived-data key: {key}")
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _has_value(extracted: dict[str, Any], key: str) -> bool:
    if key == "nutrition":
        values = (extracted.get("nutrition") or {}).get("perServing") or {}
        return any(value is not None for value in values.values())
    if key == "cost":
        return extracted.get("totalEstimatedCost") is not None
    if key == "tags":
        return bool(extracted.get("tags"))
    if key == "times":
        return any((extracted.get("times") or {}).values())
    return False


def ensure_derived_metadata(extracted: dict[str, Any]) -> dict[str, Any]:
    """Add a truthful response-safe status for old and new recipe records."""
    result = dict(extracted)
    existing = result.get("derivedData")
    metadata = dict(existing) if isinstance(existing, dict) else {}
    for key in DERIVED_KEYS:
        current = metadata.get(key)
        entry = dict(current) if isinstance(current, dict) else {}
        if not entry.get("status"):
            entry["status"] = "unverified" if _has_value(result, key) else "unavailable"
        entry.setdefault("source", "unknown")
        entry.setdefault("dataVersion", DEPENDENCY_VERSION)
        entry.setdefault("dependencyFingerprint", dependency_fingerprint(result, key))
        metadata[key] = entry

    result["derivedData"] = metadata
    return result


def mark_fresh(
    extracted: dict[str, Any],
    *keys: str,
    source: str,
    model: str | None = None,
    calculated_at: datetime | None = None,
) -> dict[str, Any]:
    """Mark selected derived values as matching the current recipe inputs."""
    result = ensure_derived_metadata(extracted)
    metadata = dict(result["derivedData"])
    timestamp = (calculated_at or datetime.now(timezone.utc)).isoformat()
    for key in keys:
        if key not in DERIVED_KEYS:
            raise ValueError(f"Unsupported derived-data key: {key}")
        metadata[key] = {
            "status": "current" if _has_value(result, key) else "unavailable",
            "source": source,
            "dataVersion": DEPENDENCY_VERSION,
            "calculatedAt": timestamp,
            "dependencyFingerprint": dependency_fingerprint(result, key),
        }
        if model:
            metadata[key]["model"] = model

    result["derivedData"] = metadata
    return result


def invalidate_changed_inputs(
    old_extracted: dict[str, Any],
    new_extracted: dict[str, Any],
    *,
    nutrition_recalculated: bool = False,
    nutrition_model: str | None = None,
) -> dict[str, Any]:
    """Carry metadata forward and visibly stale values whose inputs changed."""
    old = ensure_derived_metadata(old_extracted)
    result = ensure_derived_metadata(new_extracted)
    metadata = dict(old["derivedData"])
    for key in DERIVED_KEYS:
        old_fingerprint = dependency_fingerprint(old, key)
        new_fingerprint = dependency_fingerprint(result, key)
        if old_fingerprint != new_fingerprint:
            entry = dict(metadata.get(key) or {})
            entry.update(
                {
                    "status": "stale" if _has_value(result, key) else "unavailable",
                    "dataVersion": DEPENDENCY_VERSION,
                    "dependencyFingerprint": old_fingerprint,
                }
            )
            metadata[key] = entry

    if nutrition_recalculated:
        result["derivedData"] = metadata
        result = mark_fresh(
            result,
            "nutrition",
            source="ai_estimate",
            model=nutrition_model,
        )
        metadata = result["derivedData"]

    result["derivedData"] = metadata
    return result
