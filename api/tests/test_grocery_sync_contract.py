"""Unit coverage for the replay-safe grocery synchronization contract."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.grocery_sync import grocery_account_scope_id, grocery_mutation_hash
from app.routers.grocery import GroceryMutationRequest


def test_mutation_hash_is_canonical_and_payload_scoped():
    first = grocery_mutation_hash(
        {"operation": "add", "item": {"name": "Milk", "quantity": "1"}}
    )
    reordered = grocery_mutation_hash(
        {"item": {"quantity": "1", "name": "Milk"}, "operation": "add"}
    )
    changed = grocery_mutation_hash(
        {"operation": "add", "item": {"name": "Milk", "quantity": "2"}}
    )

    assert first == reordered
    assert first != changed


def test_account_scope_is_stable_and_does_not_expose_owner_id():
    scope = grocery_account_scope_id("user_private_clerk_subject")

    assert scope == grocery_account_scope_id("user_private_clerk_subject")
    assert scope.startswith("gacct_")
    assert "user_private_clerk_subject" not in scope
    assert scope != grocery_account_scope_id("user_other_subject")


@pytest.mark.parametrize(
    "payload",
    [
        {"operation": "add", "item_id": uuid4()},
        {
            "operation": "update",
            "item_id": uuid4(),
            "changes": {},
        },
        {
            "operation": "update",
            "item_id": uuid4(),
            "changes": {"checked": True},
        },
        {"operation": "set_checked", "item_id": uuid4()},
        {
            "operation": "delete",
            "item_id": uuid4(),
            "checked": False,
        },
    ],
)
def test_operation_payloads_fail_closed(payload):
    with pytest.raises(ValidationError):
        GroceryMutationRequest(mutation_id=uuid4(), list_id=uuid4(), **payload)


def test_update_can_explicitly_clear_nullable_fields():
    mutation = GroceryMutationRequest(
        mutation_id=uuid4(),
        operation="update",
        list_id=uuid4(),
        item_id=uuid4(),
        changes={"notes": None, "quantity": "2"},
    )

    assert mutation.changes is not None
    assert mutation.changes.model_fields_set == {"notes", "quantity"}
