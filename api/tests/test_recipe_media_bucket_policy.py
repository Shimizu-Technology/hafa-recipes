import json
import stat
from pathlib import Path
from typing import Any

import pytest

from app.recipe_media_bucket_policy import (
    CLOUDFRONT_STATEMENT_SID,
    PUBLIC_STATEMENT_SID,
    apply_policy_change,
    canonical_policy,
    cloudfront_statement,
    empty_policy,
    merge_cloudfront_access,
    policy_sha256,
    public_statement,
    remove_owned_statement,
    write_backup,
)

BUCKET = "recipe-extractor-thumbnails"
ACCOUNT_ID = "123456789012"
DISTRIBUTION_ID = "E123EXAMPLE"


def _cloudfront_statement() -> dict[str, Any]:
    return cloudfront_statement(
        bucket=BUCKET,
        account_id=ACCOUNT_ID,
        distribution_id=DISTRIBUTION_ID,
    )


def _unrelated_statement() -> dict[str, Any]:
    return {
        "Sid": "RequireTls",
        "Effect": "Deny",
        "Principal": "*",
        "Action": "s3:*",
        "Resource": [
            f"arn:aws:s3:::{BUCKET}",
            f"arn:aws:s3:::{BUCKET}/*",
        ],
        "Condition": {"Bool": {"aws:SecureTransport": "false"}},
    }


class FakePolicyClient:
    def __init__(self, policies: list[dict[str, Any]]) -> None:
        self.policies = [json.loads(json.dumps(policy)) for policy in policies]
        self.put_calls: list[dict[str, str]] = []

    def get_bucket_policy(self, *, Bucket: str) -> dict[str, str]:
        assert Bucket == BUCKET
        policy = self.policies.pop(0)
        return {"Policy": json.dumps(policy)}

    def put_bucket_policy(self, *, Bucket: str, Policy: str) -> None:
        assert Bucket == BUCKET
        self.put_calls.append({"Bucket": Bucket, "Policy": Policy})


def test_merge_preserves_every_unrelated_statement() -> None:
    current = {
        "Version": "2012-10-17",
        "Statement": [_unrelated_statement(), public_statement(bucket=BUCKET)],
    }

    desired = merge_cloudfront_access(
        current,
        bucket=BUCKET,
        account_id=ACCOUNT_ID,
        distribution_id=DISTRIBUTION_ID,
    )

    assert desired["Statement"] == [
        _unrelated_statement(),
        public_statement(bucket=BUCKET),
        _cloudfront_statement(),
    ]
    assert current["Statement"] == [
        _unrelated_statement(),
        public_statement(bucket=BUCKET),
    ]


def test_merge_is_idempotent_and_rejects_conflicting_owned_statement() -> None:
    current = {"Version": "2012-10-17", "Statement": [_cloudfront_statement()]}
    assert (
        merge_cloudfront_access(
            current,
            bucket=BUCKET,
            account_id=ACCOUNT_ID,
            distribution_id=DISTRIBUTION_ID,
        )
        == current
    )

    current["Statement"][0]["Resource"] = f"arn:aws:s3:::{BUCKET}/*"
    with pytest.raises(ValueError, match="refusing to overwrite"):
        merge_cloudfront_access(
            current,
            bucket=BUCKET,
            account_id=ACCOUNT_ID,
            distribution_id=DISTRIBUTION_ID,
        )


def test_remove_owned_statement_preserves_unrelated_statements() -> None:
    current = {
        "Version": "2012-10-17",
        "Statement": [
            _unrelated_statement(),
            public_statement(bucket=BUCKET),
            _cloudfront_statement(),
        ],
    }

    desired = remove_owned_statement(
        current,
        sid=PUBLIC_STATEMENT_SID,
        expected=public_statement(bucket=BUCKET),
    )

    assert desired["Statement"] == [_unrelated_statement(), _cloudfront_statement()]
    assert any(statement["Sid"] == PUBLIC_STATEMENT_SID for statement in current["Statement"])


def test_remove_rejects_a_conflicting_owned_statement() -> None:
    conflicting = public_statement(bucket=BUCKET)
    conflicting["Resource"] = f"arn:aws:s3:::{BUCKET}/*"
    current = {"Version": "2012-10-17", "Statement": [conflicting]}

    with pytest.raises(ValueError, match="refusing to remove"):
        remove_owned_statement(
            current,
            sid=PUBLIC_STATEMENT_SID,
            expected=public_statement(bucket=BUCKET),
        )


def test_write_backup_is_private_and_never_overwrites(tmp_path: Path) -> None:
    backup_path = tmp_path / "policy.json"
    policy = empty_policy()

    write_backup(policy, backup_path)

    assert json.loads(backup_path.read_text()) == policy
    assert stat.S_IMODE(backup_path.stat().st_mode) == 0o600
    with pytest.raises(FileExistsError):
        write_backup(policy, backup_path)


def test_apply_detects_concurrent_policy_change_before_write(tmp_path: Path) -> None:
    observed = {"Version": "2012-10-17", "Statement": [_unrelated_statement()]}
    desired = {
        "Version": "2012-10-17",
        "Statement": [_unrelated_statement(), _cloudfront_statement()],
    }
    concurrent = {"Version": "2012-10-17", "Statement": []}
    client = FakePolicyClient([concurrent])
    backup_path = tmp_path / "before-apply.json"

    with pytest.raises(RuntimeError, match="changed after planning"):
        apply_policy_change(
            client,
            bucket=BUCKET,
            observed_policy=observed,
            desired_policy=desired,
            backup_path=backup_path,
        )

    assert json.loads(backup_path.read_text()) == observed
    assert client.put_calls == []


def test_apply_writes_and_verifies_exact_desired_policy(tmp_path: Path) -> None:
    observed = {"Version": "2012-10-17", "Statement": [_unrelated_statement()]}
    desired = {
        "Version": "2012-10-17",
        "Statement": [_unrelated_statement(), _cloudfront_statement()],
    }
    client = FakePolicyClient([observed, desired])
    backup_path = tmp_path / "before-apply.json"

    changed = apply_policy_change(
        client,
        bucket=BUCKET,
        observed_policy=observed,
        desired_policy=desired,
        backup_path=backup_path,
    )

    assert changed is True
    assert json.loads(backup_path.read_text()) == observed
    assert client.put_calls == [{"Bucket": BUCKET, "Policy": canonical_policy(desired)}]
    assert policy_sha256(json.loads(client.put_calls[0]["Policy"])) == policy_sha256(desired)


def test_cloudfront_statement_is_thumbnail_and_distribution_scoped() -> None:
    statement = _cloudfront_statement()

    assert statement["Sid"] == CLOUDFRONT_STATEMENT_SID
    assert statement["Resource"] == f"arn:aws:s3:::{BUCKET}/thumbnails/*"
    assert statement["Condition"]["StringEquals"] == {
        "AWS:SourceArn": (f"arn:aws:cloudfront::{ACCOUNT_ID}:distribution/{DISTRIBUTION_ID}"),
        "AWS:SourceAccount": ACCOUNT_ID,
    }
