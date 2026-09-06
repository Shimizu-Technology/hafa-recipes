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
