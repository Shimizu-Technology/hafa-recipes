import json
import stat
import sys
from pathlib import Path
from typing import Any

import pytest

import app.recipe_media_bucket_policy as policy_module
from app.recipe_media_bucket_policy import (
    CLOUDFRONT_STATEMENT_SID,
    PUBLIC_STATEMENT_SID,
    _desired_policy,
    apply_policy_change,
    canonical_policy,
    cloudfront_statement,
    empty_policy,
    merge_cloudfront_access,
    policy_sha256,
    public_statement,
    remove_owned_statement,
    restore_owned_statements,
    write_backup,
)

BUCKET = "recipe-extractor-thumbnails"
ACCOUNT_ID = "123456789012"
DISTRIBUTION_ID = "E123EXAMPLE"
WRITER_TOKEN = "CHG-20260907-CDN"


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


def test_restore_owned_statements_preserves_current_unrelated_statements() -> None:
    later_unrelated = {
        "Sid": "AddedAfterBackup",
        "Effect": "Deny",
        "Principal": "*",
        "Action": "s3:DeleteObject",
        "Resource": f"arn:aws:s3:::{BUCKET}/*",
    }
    current = {
        "Version": "2012-10-17",
        "Statement": [_unrelated_statement(), later_unrelated, _cloudfront_statement()],
    }
    backup = {
        "Version": "2012-10-17",
        "Statement": [_unrelated_statement(), public_statement(bucket=BUCKET)],
    }

    restored = restore_owned_statements(
        current,
        backup,
        bucket=BUCKET,
        account_id=ACCOUNT_ID,
        distribution_id=DISTRIBUTION_ID,
    )

    assert restored["Statement"] == [
        _unrelated_statement(),
        later_unrelated,
        public_statement(bucket=BUCKET),
    ]


def test_restore_owned_statements_rejects_conflicting_managed_statement() -> None:
    conflicting = _cloudfront_statement()
    conflicting["Resource"] = f"arn:aws:s3:::{BUCKET}/*"
    backup = {"Version": "2012-10-17", "Statement": [conflicting]}

    with pytest.raises(ValueError, match="Backup contains conflicting"):
        restore_owned_statements(
            empty_policy(),
            backup,
            bucket=BUCKET,
            account_id=ACCOUNT_ID,
            distribution_id=DISTRIBUTION_ID,
        )


def test_restore_owned_statements_rejects_current_managed_conflict() -> None:
    conflicting = _cloudfront_statement()
    conflicting["Resource"] = f"arn:aws:s3:::{BUCKET}/*"
    current = {"Version": "2012-10-17", "Statement": [conflicting]}

    with pytest.raises(ValueError, match="Current policy contains conflicting"):
        restore_owned_statements(
            current,
            empty_policy(),
            bucket=BUCKET,
            account_id=ACCOUNT_ID,
            distribution_id=DISTRIBUTION_ID,
        )


@pytest.mark.parametrize("duplicate_location", ["current", "backup"])
def test_restore_owned_statements_rejects_duplicate_managed_sids(
    duplicate_location: str,
) -> None:
    duplicate_policy = {
        "Version": "2012-10-17",
        "Statement": [_cloudfront_statement(), _cloudfront_statement()],
    }
    current = duplicate_policy if duplicate_location == "current" else empty_policy()
    backup = duplicate_policy if duplicate_location == "backup" else empty_policy()

    with pytest.raises(ValueError, match="duplicate AllowCloudFrontReadRecipeThumbnails"):
        restore_owned_statements(
            current,
            backup,
            bucket=BUCKET,
            account_id=ACCOUNT_ID,
            distribution_id=DISTRIBUTION_ID,
        )


def test_detach_cloudfront_is_idempotent_when_statement_is_absent() -> None:
    current = {"Version": "2012-10-17", "Statement": [_unrelated_statement()]}

    desired = _desired_policy(
        "detach-cloudfront",
        current,
        bucket=BUCKET,
        account_id=ACCOUNT_ID,
        distribution_id=DISTRIBUTION_ID,
    )

    assert desired == current


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
            exclusive_writer_token=WRITER_TOKEN,
        )

    assert backup_path.exists() is False
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
        exclusive_writer_token=WRITER_TOKEN,
    )

    assert changed is True
    assert json.loads(backup_path.read_text()) == observed
    assert client.put_calls == [{"Bucket": BUCKET, "Policy": canonical_policy(desired)}]
    assert policy_sha256(json.loads(client.put_calls[0]["Policy"])) == policy_sha256(desired)
    assert client.policies == []


def test_apply_retries_post_write_verification(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    observed = {"Version": "2012-10-17", "Statement": [_unrelated_statement()]}
    desired = {
        "Version": "2012-10-17",
        "Statement": [_unrelated_statement(), _cloudfront_statement()],
    }
    client = FakePolicyClient([observed, observed, observed, desired])
    monkeypatch.setattr(policy_module, "POLICY_VERIFY_DELAYS_SECONDS", (0.0, 0.0, 0.0))

    changed = apply_policy_change(
        client,
        bucket=BUCKET,
        observed_policy=observed,
        desired_policy=desired,
        backup_path=tmp_path / "before-retry.json",
        exclusive_writer_token=WRITER_TOKEN,
    )

    assert changed is True
    assert client.policies == []


def test_apply_requires_exclusive_writer_window_before_backup_or_write(
    tmp_path: Path,
) -> None:
    """S3 has no policy CAS, so coordination evidence is a mutation prerequisite."""

    observed = {"Version": "2012-10-17", "Statement": [_unrelated_statement()]}
    desired = {
        "Version": "2012-10-17",
        "Statement": [_unrelated_statement(), _cloudfront_statement()],
    }
    client = FakePolicyClient([])
    backup_path = tmp_path / "must-not-exist.json"

    with pytest.raises(ValueError, match="exclusive bucket-policy writer window"):
        apply_policy_change(
            client,
            bucket=BUCKET,
            observed_policy=observed,
            desired_policy=desired,
            backup_path=backup_path,
            exclusive_writer_token=None,
        )

    assert backup_path.exists() is False
    assert client.put_calls == []


class FakeStsClient:
    def get_caller_identity(self) -> dict[str, str]:
        return {"Account": ACCOUNT_ID}


@pytest.mark.parametrize(
    ("action", "current"),
    [
        ("apply", {"Version": "2012-10-17", "Statement": []}),
        (
            "close-compatibility",
            {
                "Version": "2012-10-17",
                "Statement": [public_statement(bucket=BUCKET), _cloudfront_statement()],
            },
        ),
        (
            "detach-cloudfront",
            {"Version": "2012-10-17", "Statement": [_cloudfront_statement()]},
        ),
    ],
)
def test_cli_mutations_require_writer_token_before_backup_or_write(
    action: str,
    current: dict[str, Any],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakePolicyClient([current])
    backup_path = tmp_path / f"{action}.json"
    monkeypatch.setattr(
        policy_module.boto3,
        "client",
        lambda service, **_kwargs: client if service == "s3" else FakeStsClient(),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "recipe_media_bucket_policy",
            action,
            "--bucket",
            BUCKET,
            "--distribution-id",
            DISTRIBUTION_ID,
            "--backup-path",
            str(backup_path),
        ],
    )

    with pytest.raises(ValueError, match="exclusive bucket-policy writer window"):
        policy_module.main()

    assert backup_path.exists() is False
    assert client.put_calls == []


def test_cli_restore_requires_writer_token_before_backup_or_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    current = {"Version": "2012-10-17", "Statement": [_cloudfront_statement()]}
    client = FakePolicyClient([current])
    restore_source = tmp_path / "restore-source.json"
    restore_source.write_text(json.dumps(empty_policy()))
    pre_restore_backup = tmp_path / "pre-restore.json"
    monkeypatch.setattr(
        policy_module.boto3,
        "client",
        lambda service, **_kwargs: client if service == "s3" else FakeStsClient(),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "recipe_media_bucket_policy",
            "restore",
            "--bucket",
            BUCKET,
            "--distribution-id",
            DISTRIBUTION_ID,
            "--backup-path",
            str(restore_source),
            "--pre-restore-backup-path",
            str(pre_restore_backup),
        ],
    )

    with pytest.raises(ValueError, match="exclusive bucket-policy writer window"):
        policy_module.main()

    assert pre_restore_backup.exists() is False
    assert client.put_calls == []


def test_cloudfront_statement_is_thumbnail_and_distribution_scoped() -> None:
    statement = _cloudfront_statement()

    assert statement["Sid"] == CLOUDFRONT_STATEMENT_SID
    assert statement["Resource"] == f"arn:aws:s3:::{BUCKET}/thumbnails/*"
    assert statement["Condition"]["StringEquals"] == {
        "AWS:SourceArn": (f"arn:aws:cloudfront::{ACCOUNT_ID}:distribution/{DISTRIBUTION_ID}"),
        "AWS:SourceAccount": ACCOUNT_ID,
    }
