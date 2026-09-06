"""Safely manage Håfa Recipes statements in an existing S3 bucket policy."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Protocol

import boto3
from botocore.exceptions import ClientError

POLICY_VERSION = "2012-10-17"
CLOUDFRONT_STATEMENT_SID = "AllowCloudFrontReadRecipeThumbnails"
PUBLIC_STATEMENT_SID = "PublicReadForThumbnails"


class PolicyClient(Protocol):
    """Subset of the S3 client used by the policy workflow."""

    def get_bucket_policy(self, *, Bucket: str) -> dict[str, Any]: ...

    def put_bucket_policy(self, *, Bucket: str, Policy: str) -> Any: ...


def empty_policy() -> dict[str, Any]:
    """Return an empty, valid S3 policy document."""

    return {"Version": POLICY_VERSION, "Statement": []}


def validate_policy(policy: Any) -> dict[str, Any]:
    """Validate the policy shape without discarding unrelated fields."""

    if not isinstance(policy, dict):
        raise ValueError("Bucket policy must be a JSON object")
    if policy.get("Version") != POLICY_VERSION:
        raise ValueError(f"Bucket policy Version must be {POLICY_VERSION}")
    statements = policy.get("Statement")
    if not isinstance(statements, list):
        raise ValueError("Bucket policy Statement must be a list")
    if not all(isinstance(statement, dict) for statement in statements):
        raise ValueError("Every bucket policy statement must be an object")
    return policy


def canonical_policy(policy: dict[str, Any]) -> str:
    """Serialize a validated policy deterministically for comparisons."""

    validate_policy(policy)
    return json.dumps(policy, sort_keys=True, separators=(",", ":"))


def policy_sha256(policy: dict[str, Any]) -> str:
    """Return the SHA-256 digest of a policy's canonical representation."""

    return hashlib.sha256(canonical_policy(policy).encode()).hexdigest()


def cloudfront_statement(*, bucket: str, account_id: str, distribution_id: str) -> dict[str, Any]:
    """Build the exact OAC read grant owned by Håfa Recipes."""

    return {
        "Sid": CLOUDFRONT_STATEMENT_SID,
        "Effect": "Allow",
        "Principal": {"Service": "cloudfront.amazonaws.com"},
        "Action": "s3:GetObject",
        "Resource": f"arn:aws:s3:::{bucket}/thumbnails/*",
        "Condition": {
            "StringEquals": {
                "AWS:SourceArn": (
                    f"arn:aws:cloudfront::{account_id}:distribution/{distribution_id}"
                ),
                "AWS:SourceAccount": account_id,
            }
        },
    }


def public_statement(*, bucket: str) -> dict[str, Any]:
    """Build the exact legacy public-thumbnail statement owned by Håfa Recipes."""

    return {
        "Sid": PUBLIC_STATEMENT_SID,
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": f"arn:aws:s3:::{bucket}/thumbnails/*",
    }


def _find_owned_statement(policy: dict[str, Any], sid: str) -> tuple[int, dict[str, Any]] | None:
    """Find one managed statement and reject duplicate managed Sids."""

    matches = [
        (index, statement)
        for index, statement in enumerate(policy["Statement"])
        if statement.get("Sid") == sid
    ]
    if len(matches) > 1:
        raise ValueError(f"Bucket policy contains duplicate {sid} statements")
    return matches[0] if matches else None


def merge_cloudfront_access(
    policy: dict[str, Any], *, bucket: str, account_id: str, distribution_id: str
) -> dict[str, Any]:
    """Add the exact CloudFront statement while preserving all other statements."""

    desired = copy.deepcopy(validate_policy(policy))
    expected = cloudfront_statement(
        bucket=bucket,
        account_id=account_id,
        distribution_id=distribution_id,
    )
    existing = _find_owned_statement(desired, CLOUDFRONT_STATEMENT_SID)
    if existing is None:
        desired["Statement"].append(expected)
    elif existing[1] != expected:
        raise ValueError(
            f"Existing {CLOUDFRONT_STATEMENT_SID} statement differs; refusing to overwrite"
        )
    return desired


def remove_owned_statement(
    policy: dict[str, Any], *, sid: str, expected: dict[str, Any]
) -> dict[str, Any]:
    """Remove one exact managed statement while preserving unrelated statements."""

    desired = copy.deepcopy(validate_policy(policy))
    existing = _find_owned_statement(desired, sid)
    if existing is None:
        return desired
    if existing[1] != expected:
        raise ValueError(f"Existing {sid} statement differs; refusing to remove it")
    del desired["Statement"][existing[0]]
    return desired


def get_bucket_policy(client: PolicyClient, bucket: str) -> dict[str, Any]:
    """Read and validate a bucket policy, treating a missing policy as empty."""

    try:
        response = client.get_bucket_policy(Bucket=bucket)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchBucketPolicy":
            return empty_policy()
        raise
    policy = json.loads(response["Policy"])
    return validate_policy(policy)


def write_backup(policy: dict[str, Any], path: Path) -> None:
    """Create a private, non-overwriting policy backup."""

    if not path.parent.is_dir():
        raise ValueError(f"Backup parent directory does not exist: {path.parent}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w") as backup:
        json.dump(validate_policy(policy), backup, indent=2, sort_keys=True)
        backup.write("\n")


def apply_policy_change(
    client: PolicyClient,
    *,
    bucket: str,
    observed_policy: dict[str, Any],
    desired_policy: dict[str, Any],
    backup_path: Path,
    exclusive_writer_token: str | None,
) -> bool:
    """Back up, concurrency-check, write, and verify during an exclusive window."""

    if not exclusive_writer_token or len(exclusive_writer_token.strip()) < 8:
        raise ValueError(
            "A documented exclusive bucket-policy writer window is required; "
            "provide its change-record token"
        )

    observed_canonical = canonical_policy(observed_policy)
    desired_canonical = canonical_policy(desired_policy)
    if observed_canonical == desired_canonical:
        return False

    write_backup(observed_policy, backup_path)
    latest_policy = get_bucket_policy(client, bucket)
    if canonical_policy(latest_policy) != observed_canonical:
        raise RuntimeError(
            "Bucket policy changed after planning; no write was attempted. "
            f"Original policy is backed up at {backup_path}"
        )

    client.put_bucket_policy(Bucket=bucket, Policy=desired_canonical)
    verified_policy = get_bucket_policy(client, bucket)
    if canonical_policy(verified_policy) != desired_canonical:
        raise RuntimeError(
            "Bucket policy verification failed after write; restore from "
            f"{backup_path} before continuing"
        )
    return True


def _desired_policy(
    action: str,
    current: dict[str, Any],
    *,
    bucket: str,
    account_id: str,
    distribution_id: str,
) -> dict[str, Any]:
    """Compute the policy for one supported action."""

    expected_cloudfront = cloudfront_statement(
        bucket=bucket,
        account_id=account_id,
        distribution_id=distribution_id,
    )
    if action in {"plan", "apply"}:
        return merge_cloudfront_access(
            current,
            bucket=bucket,
            account_id=account_id,
            distribution_id=distribution_id,
        )

    current_with_cloudfront = merge_cloudfront_access(
        current,
        bucket=bucket,
        account_id=account_id,
        distribution_id=distribution_id,
    )
    if canonical_policy(current_with_cloudfront) != canonical_policy(current):
        raise ValueError(f"{CLOUDFRONT_STATEMENT_SID} is missing; apply CDN access first")
    if action == "close-compatibility":
        return remove_owned_statement(
            current,
            sid=PUBLIC_STATEMENT_SID,
            expected=public_statement(bucket=bucket),
        )
    if action == "detach-cloudfront":
        return remove_owned_statement(
            current,
            sid=CLOUDFRONT_STATEMENT_SID,
            expected=expected_cloudfront,
        )
    raise ValueError(f"Unsupported action: {action}")


def _parser() -> argparse.ArgumentParser:
    """Build the command-line parser."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("plan", "apply", "close-compatibility", "detach-cloudfront", "restore"),
    )
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--region", default="ap-southeast-2")
    parser.add_argument("--distribution-id")
    parser.add_argument("--backup-path", type=Path)
    parser.add_argument("--pre-restore-backup-path", type=Path)
    parser.add_argument(
        "--exclusive-writer-token",
        help="Non-secret change-record ID proving an exclusive policy-writer window.",
    )
    return parser


def main() -> None:
    """Execute a read-only plan or an explicit, backed-up policy mutation."""

    args = _parser().parse_args()
    client = boto3.client("s3", region_name=args.region)
    current = get_bucket_policy(client, args.bucket)

    if args.action == "restore":
        if args.backup_path is None or args.pre_restore_backup_path is None:
            raise SystemExit("restore requires --backup-path and --pre-restore-backup-path")
        restored = validate_policy(json.loads(args.backup_path.read_text()))
        changed = apply_policy_change(
            client,
            bucket=args.bucket,
            observed_policy=current,
            desired_policy=restored,
            backup_path=args.pre_restore_backup_path,
            exclusive_writer_token=args.exclusive_writer_token,
        )
        print(f"restore_changed={str(changed).lower()}")
        print(f"policy_sha256={policy_sha256(restored)}")
        return

    if not args.distribution_id:
        raise SystemExit(f"{args.action} requires --distribution-id")
    account_id = boto3.client("sts").get_caller_identity()["Account"]
    desired = _desired_policy(
        args.action,
        current,
        bucket=args.bucket,
        account_id=account_id,
        distribution_id=args.distribution_id,
    )
    print(f"current_policy_sha256={policy_sha256(current)}")
    print(f"desired_policy_sha256={policy_sha256(desired)}")
    print(f"change_required={str(canonical_policy(current) != canonical_policy(desired)).lower()}")

    if args.action == "plan":
        return
    if args.backup_path is None:
        raise SystemExit(f"{args.action} requires --backup-path")
    changed = apply_policy_change(
        client,
        bucket=args.bucket,
        observed_policy=current,
        desired_policy=desired,
        backup_path=args.backup_path,
        exclusive_writer_token=args.exclusive_writer_token,
    )
    print(f"applied={str(changed).lower()}")


if __name__ == "__main__":
    main()
