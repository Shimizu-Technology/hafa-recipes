"""Actual website fraction typography must not produce false missing-amount reviews."""
import pytest

from app.recipe_review import assess_recipe_review
from app.services.website import WebsiteService


@pytest.mark.parametrize(('source', 'quantity', 'unit', 'name'), [
    ('¼ cup soy sauce', '1/4', 'cup', 'soy sauce'),
    ('½ Tbsp cornstarch', '1/2', 'Tbsp', 'cornstarch'),
    ('1½ cups rice', '1 1/2', 'cup', 'rice'),
    ('1 ⅓ cups coconut milk', '1 1/3', 'cup', 'coconut milk'),
    ('⅛ to ¼ tsp salt', '1/8 to 1/4', 'tsp', 'salt'),
    ('2 Tbsp water', '2', 'Tbsp', 'water'),
    ('salt to taste', '', '', 'salt to taste'),
])
def test_source_amount_typography(source, quantity, unit, name):
    parsed = WebsiteService._parse_ingredient_string(source)
    assert (parsed['quantity'], parsed['unit'], parsed['name']) == (quantity, unit, name)
    assert parsed['original'] == source


def test_website_fractions_do_not_request_redundant_review():
    recipe = WebsiteService._convert_jsonld_to_recipe({
        'name': 'Sesame sauce',
        'recipeIngredient': ['¼ cup soy sauce', '½ Tbsp cornstarch'],
        'recipeInstructions': ['Whisk together and simmer until thickened.'],
    }, 'https://example.test/sauce', 'Guam', '')
    assessment = assess_recipe_review(recipe, source_type='website', extraction_method='website-jsonld', content_revision=1)
    assert assessment.state == 'ready'
    assert assessment.evidence['assessment']['issues'] == []
