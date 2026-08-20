# Durable Deletion Cleanup Runbook

Last reviewed: 2026-08-20

## Purpose

Account and recipe deletion make the PostgreSQL state authoritative first.
External deletion in Clerk and S3 is recorded in the same transaction and then
completed by a durable worker. A provider outage therefore cannot leave an
untracked partial deletion or force the user to keep retrying the request.

Private chat-image delivery remains deferred under ADR-001. Account deletion
still removes the account's existing `chat-images/{app_user_id}/` objects.

## Request behavior

### Account deletion

`DELETE /api/users/me` returns `202` after one transaction has:

1. locked the stable `app_users` row;
2. snapshotted every issuer-scoped Clerk subject and relevant S3 prefix into a
   `deletion_cleanup_jobs` row;
3. inserted hash-only issuer/subject tombstones;
4. removed local recipes, collections, notes, saves, meal plans, extraction
   jobs, grocery references, migration grants, identities, and the app user;
5. removed now-empty shared grocery lists; and
6. committed the local erasure and cleanup intent together.

The original bearer token receives `401 Account has been deleted` after commit,
even if Clerk is temporarily unavailable. Concurrent duplicate requests resolve
to the same unique account cleanup job.

### Recipe deletion

`DELETE /api/recipes/{recipe_id}` returns `202` after deleting the recipe and
dependent database rows while persisting cleanup for both key formats:

- `thumbnails/{recipe_id}.` for legacy fixed-name objects; and
- `thumbnails/{recipe_id}/` for content-addressed objects.

## Worker guarantees

The worker claims one due job with `FOR UPDATE SKIP LOCKED`, assigns a random
lease token, and recovers expired leases after deploys or process exits. Each
attempt visits every storage prefix and Clerk alias even if another target
fails. S3 prefix deletion and Clerk `404` responses are idempotent.

Recipe thumbnail writes and recipe/account deletion share a transaction-scoped
PostgreSQL advisory lock per recipe. A delete waits for an in-progress write;
after deletion commits, a waiting or newly started upload re-checks recipe
existence and is rejected before S3. This prevents an overlapping edit or
re-extraction from recreating media after the worker's prefix scan.

Retries use exponential backoff beginning at 15 seconds, capped at one hour and
at `DELETION_CLEANUP_MAX_ATTEMPTS` (default 20). Error records store only the
exception class, not provider responses, credentials, or subjects.

On completion, raw Clerk subjects and storage prefixes are removed from the job.
The job retains bounded counts, timestamps, attempts, kind, stable app user ID,
and terminal status for operational audit. Hash-only auth tombstones remain so
the deleted subject cannot be lazily adopted again.

## Monitoring

Authenticated admins can read queue counts in
`GET /api/admin/diagnostics` under `deletion_cleanup_queue`.

The focused admin portal also exposes a privacy-bounded queue at
`GET /api/admin/cleanup-jobs`. It returns job kind, state, bounded target
counts, attempts, timestamps, and the sanitized exception class only. It never
returns the stable app user ID, Clerk issuer/subject pairs, storage prefixes,
lease token, or provider response bodies. The overview count includes only
terminal `failed` jobs; queued and expired-lease work remains worker-owned.

Investigate when:

- `failed` increases;
- `processing` remains non-zero longer than the five-minute default lease plus
  the longest expected provider call;
- `queued` grows continuously across several poll intervals; or
- Sentry reports repeated `StorageCleanupError`, Clerk transport failures, or
  schema-preflight failures.

The worker refuses to start when migration 019 is absent. In production it also
retries rather than silently completing storage work if S3 configuration is
missing.

## Verification

For a safe production canary:

1. confirm migration 019 completed before the new application process starts;
2. confirm `/up` is healthy;
3. confirm anonymous `/api/admin/diagnostics` returns `401`;
4. inspect authenticated diagnostics for bounded queue counts;
5. delete only a purpose-created test recipe and confirm the API returns `202`;
6. confirm its cleanup job moves from `queued` to `completed`; and
7. confirm the thumbnail URL no longer resolves after object-storage
   propagation.

Do not canary account deletion with a real user. Use an explicitly disposable
test identity and verify all linked Clerk aliases before deletion.

## Recovery

- `queued`: no action unless backlog is growing; the worker will retry when due.
- `processing`: wait through the lease window; an expired lease is recovered
  automatically.
- `failed`: investigate and correct the provider configuration or outage, then
  use **Deletion cleanup → Retry** in the focused admin portal. A reason is
  required and permanently audited. The action locks the row, clears only
  bounded failure/lease state, resets the attempt budget, and wakes the durable
  worker. It does not restore locally deleted data and cannot cancel required
  erasure. If the job has no remaining external targets, the API rejects the
  retry for investigation rather than inventing work.
- startup schema error: apply migration 019, then restart. Do not disable the
  worker to bypass the preflight in production.

Never remove an authentication tombstone merely to make sign-in work. That can
recreate a deliberately deleted account and must be treated as a new-account or
support decision instead.

Do not copy raw cleanup targets into an admin reason, incident title, or support
ticket. Reference the bounded cleanup job ID shown in the portal.

## Rollback

Rolling application code back is safe after migration 019 because the migration
only adds tables and indexes. Do not drop them: queued cleanup work and auth
tombstones must survive rollback. If the worker itself must be paused during a
provider incident, set `DELETION_CLEANUP_WORKER_ENABLED=false` deliberately,
retain the queue, restore provider health, and re-enable it promptly.
