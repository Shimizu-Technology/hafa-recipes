"""Recipe-to-meal-plan relationship endpoint coverage."""

from datetime import date, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    MetaData,
    String,
    Table,
    Uuid,
    create_engine,
    insert,
)
from sqlalchemy.orm import Session

from app.routers.meal_plans import (
    _recipe_plan_entries_statement,
    get_recipe_plan_entries,
)


def _schema():
    """Create the minimal relational schema used by the policy query."""
    metadata = MetaData()
    app_users = Table(
        "app_users",
        metadata,
        Column("id", String(64), primary_key=True),
        Column("moderation_status", String(16), nullable=False),
    )
    recipes = Table(
        "recipes",
        metadata,
        Column("id", Uuid(as_uuid=True), primary_key=True),
        Column("user_id", String(64)),
        Column("is_public", Boolean, nullable=False),
        Column("moderation_status", String(16), nullable=False),
        Column("review_state", String(24)),
    )
    user_blocks = Table(
        "user_blocks",
        metadata,
        Column("id", Uuid(as_uuid=True), primary_key=True),
        Column("blocker_user_id", String(64), nullable=False),
        Column("blocked_user_id", String(64), nullable=False),
    )
    meal_plan_entries = Table(
        "meal_plan_entries",
        metadata,
        Column("id", Uuid(as_uuid=True), primary_key=True),
        Column("user_id", String(64), nullable=False),
        Column("date", Date, nullable=False),
        Column("meal_type", String(20), nullable=False),
        Column("recipe_id", Uuid(as_uuid=True), nullable=False),
        Column("recipe_title", String(255), nullable=False),
        Column("recipe_thumbnail", String(500)),
        Column("notes", String(500)),
        Column("servings", String(20)),
        Column("created_at", DateTime, nullable=False),
        Column("updated_at", DateTime),
    )
    return metadata, app_users, recipes, user_blocks, meal_plan_entries


def _entry(
    entry_id: UUID,
    *,
    user_id: str,
    recipe_id: UUID,
    planned_date: date,
    meal_type: str,
    created_at: datetime,
):
    """Build one deterministic meal-plan fixture row."""
    return {
        "id": entry_id,
        "user_id": user_id,
        "date": planned_date,
        "meal_type": meal_type,
        "recipe_id": recipe_id,
        "recipe_title": "Relationship recipe",
        "created_at": created_at,
    }


def test_relationship_query_executes_ownership_date_policy_order_and_limit():
    """Execute the real SELECT against adversarial relational fixtures."""
    metadata, app_users, recipes, _user_blocks, meal_plan_entries = _schema()
    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    viewer_id = "stable-app-user"
    owner_id = "active-owner"
    other_user_id = "another-user"
    recipe_id = UUID("11111111-1111-4111-8111-111111111111")
    first_date = date(2026, 8, 27)

    eligible_rows = []
    for index in range(14):
        eligible_rows.append(
            _entry(
                UUID(f"00000000-0000-4000-8000-{index + 1:012d}"),
                user_id=viewer_id,
                recipe_id=recipe_id,
                planned_date=first_date + timedelta(days=index // 2),
                meal_type="dinner" if index % 2 == 0 else "breakfast",
                created_at=datetime(2026, 8, 26, 8, index),
            )
        )

    with engine.begin() as connection:
        connection.execute(
            insert(app_users),
            [
                {"id": viewer_id, "moderation_status": "active"},
                {"id": owner_id, "moderation_status": "active"},
                {"id": other_user_id, "moderation_status": "active"},
            ],
        )
        connection.execute(
            insert(recipes),
            [{
                "id": recipe_id,
                "user_id": owner_id,
                "is_public": True,
                "moderation_status": "active",
            }],
        )
        connection.execute(insert(meal_plan_entries), eligible_rows)
        connection.execute(
            insert(meal_plan_entries),
            [
                _entry(
                    uuid4(),
                    user_id=other_user_id,
                    recipe_id=recipe_id,
                    planned_date=first_date,
                    meal_type="breakfast",
                    created_at=datetime(2026, 8, 26, 7),
                ),
                _entry(
                    uuid4(),
                    user_id=viewer_id,
                    recipe_id=recipe_id,
                    planned_date=first_date - timedelta(days=1),
                    meal_type="breakfast",
                    created_at=datetime(2026, 8, 25, 7),
                ),
            ],
        )

    with Session(engine) as session:
        result = session.execute(
            _recipe_plan_entries_statement(recipe_id, viewer_id, first_date, 12)
        ).scalars().all()

    expected_rows = sorted(
        eligible_rows,
        key=lambda row: (row["date"], row["meal_type"], row["created_at"]),
    )[:12]
    assert [entry.id for entry in result] == [row["id"] for row in expected_rows]
    assert len(result) == 12


def test_relationship_query_excludes_private_and_moderated_recipes():
    """Verify the shared recipe-access policy with real query execution."""
    metadata, app_users, recipes, _user_blocks, meal_plan_entries = _schema()
    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    viewer_id = "stable-app-user"
    owner_id = "active-owner"
    first_date = date(2026, 8, 27)
    private_recipe_id = UUID("22222222-2222-4222-8222-222222222222")
    moderated_recipe_id = UUID("33333333-3333-4333-8333-333333333333")

    with engine.begin() as connection:
        connection.execute(
            insert(app_users),
            [
                {"id": viewer_id, "moderation_status": "active"},
                {"id": owner_id, "moderation_status": "active"},
            ],
        )
        connection.execute(
            insert(recipes),
            [
                {
                    "id": private_recipe_id,
                    "user_id": owner_id,
                    "is_public": False,
                    "moderation_status": "active",
                },
                {
                    "id": moderated_recipe_id,
                    "user_id": owner_id,
                    "is_public": True,
                    "moderation_status": "hidden",
                },
            ],
        )
        connection.execute(
            insert(meal_plan_entries),
            [
                _entry(
                    uuid4(),
                    user_id=viewer_id,
                    recipe_id=private_recipe_id,
                    planned_date=first_date,
                    meal_type="dinner",
                    created_at=datetime(2026, 8, 26, 8),
                ),
                _entry(
                    uuid4(),
                    user_id=viewer_id,
                    recipe_id=moderated_recipe_id,
                    planned_date=first_date,
                    meal_type="dinner",
                    created_at=datetime(2026, 8, 26, 9),
                ),
            ],
        )

    with Session(engine) as session:
        private_result = session.execute(
            _recipe_plan_entries_statement(
                private_recipe_id,
                viewer_id,
                first_date,
                12,
            )
        ).scalars().all()
        moderated_result = session.execute(
            _recipe_plan_entries_statement(
                moderated_recipe_id,
                viewer_id,
                first_date,
                12,
            )
        ).scalars().all()

    assert private_result == []
    assert moderated_result == []


class _ScalarResult:
    def scalars(self):
        return self

    def all(self):
        return []


class _RecordingSession:
    def __init__(self):
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _ScalarResult()


@pytest.mark.asyncio
async def test_endpoint_defaults_to_today_and_delegates_to_policy_query(monkeypatch):
    """Cover endpoint defaults separately from the executed SELECT semantics."""
    class _FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 8, 26)

    monkeypatch.setattr("app.routers.meal_plans.date", _FixedDate)
    session = _RecordingSession()
    recipe_id = UUID("44444444-4444-4444-8444-444444444444")

    result = await get_recipe_plan_entries(
        recipe_id=recipe_id,
        start_date=None,
        limit=50,
        db=session,
        user=SimpleNamespace(id="stable-app-user"),
    )

    assert result == []
    assert session.statement is not None
    params = session.statement.compile().params
    assert params["recipe_id_1"] == recipe_id
    assert params["user_id_1"] == "stable-app-user"
    assert params["date_1"] == _FixedDate(2026, 8, 26)
    assert params["param_1"] == 50
