"""Trust-preserving planner-to-grocery coverage."""

from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.routers import meal_plans


class _Result:
    def __init__(self, entries):
        self.entries = entries

    def scalars(self):
        return self

    def all(self):
        return self.entries


class _Session:
    def __init__(self, entries):
        self.entries = entries
        self.added = []
        self.committed = False

    async def execute(self, _statement):
        return _Result(self.entries)

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.committed = True


@pytest.mark.asyncio
async def test_planner_grocery_handoff_reports_an_empty_plan():
    session = _Session([])

    result = await meal_plans.add_plan_to_grocery(
        meal_plans.AddToGroceryRequest(
            start_date=date(2026, 9, 1),
            end_date=date(2026, 9, 7),
        ),
        session,
        SimpleNamespace(id="stable-app-user", display_name="Cook"),
    )

    assert result["items_added"] == 0
    assert result["items_missing_amount"] == 0
    assert session.added == []
    assert session.committed is False


@pytest.mark.asyncio
async def test_planner_grocery_handoff_counts_and_normalizes_missing_amounts(
    monkeypatch,
):
    recipe_id = uuid4()
    entry = SimpleNamespace(
        recipe_id=recipe_id,
        recipe_title="Chicken kelaguen",
    )
    recipe = SimpleNamespace(
        id=recipe_id,
        extracted={
            "components": [{
                "ingredients": [
                    {"name": "Chicken", "quantity": "2", "unit": "lb"},
                    {"name": "Salt", "quantity": None, "unit": None},
                    {"name": "Pepper", "quantity": " null ", "unit": None},
                    {"name": "Lime", "quantity": 2, "unit": None},
                ]
            }]
        },
    )
    session = _Session([entry])

    async def accessible_recipe(_db, requested_recipe_id, _user):
        assert requested_recipe_id == recipe_id
        return recipe

    async def grocery_list(_db, _user):
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(meal_plans, "get_accessible_recipe", accessible_recipe)
    monkeypatch.setattr(meal_plans, "get_or_create_user_list", grocery_list)

    result = await meal_plans.add_plan_to_grocery(
        meal_plans.AddToGroceryRequest(
            start_date=date(2026, 9, 1),
            end_date=date(2026, 9, 7),
        ),
        session,
        SimpleNamespace(id="stable-app-user", display_name="Cook"),
    )

    assert result["items_added"] == 4
    assert result["items_missing_amount"] == 2
    assert [item.quantity for item in session.added] == ["2", None, None, "2"]
    assert session.committed is True

@pytest.mark.asyncio
async def test_explicit_servings_scale_preview_and_add_but_legacy_entries_do_not(monkeypatch):
    recipe_id = uuid4()
    entries = [SimpleNamespace(recipe_id=recipe_id, recipe_title="Rice", planned_servings=8),
               SimpleNamespace(recipe_id=recipe_id, recipe_title="Rice", servings="8")]
    recipe = SimpleNamespace(id=recipe_id, extracted={"servings": 4, "components": [{"ingredients": [
        {"name": "Rice", "quantity": "1 1/2", "unit": "cup"}, {"name": "Salt", "quantity": None},
        {"name": "Lime", "quantity": "2-3", "unit": "piece"},
    ]}]})
    async def accessible(*_):
        return recipe
    async def grocery(*_):
        return SimpleNamespace(id=uuid4())
    monkeypatch.setattr(meal_plans, "get_accessible_recipe", accessible)
    monkeypatch.setattr(meal_plans, "get_or_create_user_list", grocery)
    session = _Session(entries)
    user = SimpleNamespace(id="stable-user", display_name="Cook")
    request = meal_plans.AddToGroceryRequest(start_date=date(2026, 9, 1), end_date=date(2026, 9, 7))
    preview = await meal_plans.preview_plan_grocery(request, session, user)
    assert [item["quantity"] for item in preview["items"]] == ["3", None, "2-3", "1 1/2", None, "2-3"]
    assert preview["items_missing_amount"] == 2
    assert preview["items_unscaled"] == 1
    assert preview["totals"][0]["quantity"] == "9/2"
    assert preview["totals"][1]["missing"] == 2
    assert session.added == []
    request.preview_token = preview["preview_token"]
    result = await meal_plans.add_plan_to_grocery(request, session, user)
    assert result["preview_token"] == preview["preview_token"]
    assert [item.quantity for item in session.added] == [item["quantity"] for item in preview["items"]]
    request.preview_token = "changed"
    with pytest.raises(meal_plans.HTTPException) as error:
        await meal_plans.add_plan_to_grocery(request, session, user)
    assert error.value.status_code == 409
    assert len(session.added) == 6


@pytest.mark.asyncio
async def test_review_addition_reuses_a_durable_receipt(monkeypatch):
    from app.models.grocery import GroceryMutationReceipt
    recipe_id = uuid4()
    entry = SimpleNamespace(recipe_id=recipe_id, recipe_title="Rice", planned_servings=4)
    recipe = SimpleNamespace(id=recipe_id, extracted={"servings": 4, "components": [{"ingredients": [{"name": "Rice", "quantity": "1"}]}]})
    grocery_list = SimpleNamespace(id=uuid4(), revision=0)
    async def accessible(*_):
        return recipe
    async def grocery(*_):
        return grocery_list
    monkeypatch.setattr(meal_plans, "get_accessible_recipe", accessible)
    monkeypatch.setattr(meal_plans, "get_or_create_user_list", grocery)
    session = _Session([entry])
    async def get_receipt(*_):
        return next((item for item in session.added if isinstance(item, GroceryMutationReceipt)), None)
    session.get = get_receipt
    user = SimpleNamespace(id="stable-user", display_name="Cook")
    request = meal_plans.AddToGroceryRequest(start_date=date(2026, 9, 1), end_date=date(2026, 9, 7), mutation_id=uuid4())
    first = await meal_plans.add_plan_to_grocery(request, session, user)
    second = await meal_plans.add_plan_to_grocery(request, session, user)
    assert first["items_added"] == second["items_added"] == 1
    assert second["replayed"] is True
    assert len(session.added) == 2  # one ingredient plus its receipt
    assert grocery_list.revision == 1
