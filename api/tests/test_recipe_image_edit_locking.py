"""Concurrency tests for multipart recipe edits."""

import io
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy.dialects import postgresql
from starlette.datastructures import Headers

from app.routers import recipes


class _Result:
    def __init__(self, recipe):
        self.recipe = recipe

    def scalar_one_or_none(self):
        return self.recipe


class _SequencedSession:
    def __init__(self, *rows):
        self.rows = list(rows)
        self.selects = []
        self.rolled_back = False

    async def execute(self, statement):
        self.selects.append(statement)
        return _Result(self.rows.pop(0))

    async def rollback(self):
        self.rolled_back = True


@pytest.mark.asyncio
async def test_image_upload_finishes_before_lock_and_rechecks_revision(monkeypatch):
    """External storage must not run inside the locked recipe transaction."""

    owner = SimpleNamespace(id="stable_owner")
    before_upload = SimpleNamespace(user_id=owner.id, content_revision=1)
    after_concurrent_edit = SimpleNamespace(user_id=owner.id, content_revision=2)
    db = _SequencedSession(before_upload, after_concurrent_edit)

    monkeypatch.setattr(
        recipes,
        "validate_image_bytes",
        lambda *_args, **_kwargs: SimpleNamespace(
            data=b"validated-image",
            content_type="image/png",
        ),
    )

    async def upload_after_read_transaction(*_args, **_kwargs):
        assert db.rolled_back is True
        return "https://images.example.test/thumbnail.png"

    monkeypatch.setattr(
        recipes.storage_service,
        "upload_thumbnail_from_bytes",
        upload_after_read_transaction,
    )
    image = UploadFile(
        io.BytesIO(b"image"),
        filename="recipe.png",
        headers=Headers({"content-type": "image/png"}),
    )
    payload = json.dumps(
        {
            "title": "Edited recipe",
            "ingredients": [],
            "steps": [],
            "review_content_revision": 1,
            "verified_paths": [],
        }
    )

    with pytest.raises(HTTPException) as error:
        await recipes.edit_recipe_with_image(
            recipe_id="11111111-1111-4111-8111-111111111111",
            recipe_data=payload,
            image=image,
            db=db,
            user=owner,
        )

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "STALE_RECIPE_REVIEW"
    unlocked_sql = str(db.selects[0].compile(dialect=postgresql.dialect()))
    locked_sql = str(db.selects[1].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" not in unlocked_sql
    assert "FOR UPDATE" in locked_sql
