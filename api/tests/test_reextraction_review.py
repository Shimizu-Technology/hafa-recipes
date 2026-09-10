"""Regression coverage for non-destructive re-extraction review gates."""

from app.recipe_review import assess_recipe_review
from app.routers.extract import _reextraction_review_failure


def _assessment(*, steps: list[str], extraction_method: str = "basic", quantity="2"):
    """Build a representative candidate assessment."""

    return assess_recipe_review(
        {
            "title": "Candidate",
            "components": [{
                "name": "Main",
                "ingredients": [{"name": "rice", "quantity": quantity, "unit": "cups"}],
                "steps": steps,
            }],
        },
        source_type="website" if extraction_method == "website-jsonld" else "tiktok",
        extraction_method=extraction_method,
        content_revision=2,
    )


def test_reextraction_review_gate_uses_non_retryable_terminal_codes():
    """Incomplete replacements fail while usable advisory candidates can complete."""

    incomplete = _assessment(steps=[])
    advisory = _assessment(steps=["Cook the rice."], quantity=None)
    ready = _assessment(steps=["Cook the rice."], extraction_method="website-jsonld")

    assert _reextraction_review_failure(incomplete)[0] == "SOURCE_INCOMPLETE"
    assert advisory.state == "needs_review"
    assert _reextraction_review_failure(advisory) is None
    assert _reextraction_review_failure(ready) is None
