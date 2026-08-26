"""Recipe-to-meal-plan relationship endpoint coverage."""

from datetime import date
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.routers.meal_plans import get_recipe_plan_entries


class _ScalarResult:
    def __init__(self, entries):
        self._entries = entries

    def scalars(self):
        return self

    def all(self):
        return self._entries


class _RecordingSession:
    def __init__(self, entries):
        self.entries = entries
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _ScalarResult(self.entries)


@pytest.mark.asyncio
async def test_recipe_relationships_are_user_scoped_upcoming_and_bounded():
    expected_entries = [SimpleNamespace(id="entry-a"), SimpleNamespace(id="entry-b")]
    session = _RecordingSession(expected_entries)
    recipe_id = UUID("11111111-1111-4111-8111-111111111111")
    first_date = date(2026, 8, 27)

    result = await get_recipe_plan_entries(
        recipe_id=recipe_id,
        start_date=first_date,
        limit=12,
        db=session,
        user=SimpleNamespace(id="stable-app-user"),
    )

    assert result == expected_entries
    assert session.statement is not None
    compiled = session.statement.compile()
    sql = str(compiled)
    params = compiled.params

    assert "meal_plan_entries.user_id" in sql
    assert "meal_plan_entries.recipe_id" in sql
    assert "meal_plan_entries.date >=" in sql
    assert "recipes.moderation_status" in sql
    assert "app_users.moderation_status" in sql
    assert "ORDER BY meal_plan_entries.date" in sql
    assert params["user_id_1"] == "stable-app-user"
    assert params["recipe_id_1"] == recipe_id
    assert params["date_1"] == first_date
    assert params["param_1"] == 12


@pytest.mark.asyncio
async def test_recipe_relationships_default_to_today(monkeypatch):
    class _FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 8, 26)

    monkeypatch.setattr("app.routers.meal_plans.date", _FixedDate)
    session = _RecordingSession([])

    await get_recipe_plan_entries(
        recipe_id=UUID("22222222-2222-4222-8222-222222222222"),
        start_date=None,
        limit=50,
        db=session,
        user=SimpleNamespace(id="stable-app-user"),
    )

    assert session.statement is not None
    assert session.statement.compile().params["date_1"] == _FixedDate(2026, 8, 26)
