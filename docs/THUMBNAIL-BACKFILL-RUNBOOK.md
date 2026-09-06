# Legacy Thumbnail Backfill Runbook

This is a separate operator workflow. It is never part of Render pre-deploy or
the versioned migration chain. It downloads legacy public-recipe images,
creates the bounded `list.webp` and `hero.webp` variants, and swaps the current
recipe URL. It never deletes the original image. Private recipes are excluded
until private thumbnail delivery no longer depends on anonymously cacheable
objects.

## Safety contract

- Dry-run is the default and performs no database or object-storage writes.
- Work is limited to one UUID-keyset page of at most 100 recipes.
- The scope is public recipes only. Visibility is rechecked under the recipe
  lock before object storage or database writes; a newly private recipe becomes
  a terminal conflict.
- Apply requires a unique backfill ID, a named verified restore point, and the
  exact row count, source-byte total, destination fingerprint, and plan digest
  from a repeated dry run. The runtime-derived deployed release ID must match.
- The destination fingerprint binds the plan to its S3 bucket, region, media
  origin, and image-transform version. Apply and resume stop on drift.
- The complete immutable page inventory and every attempt outcome are stored
  without raw source URLs. Audit tables reject updates and deletes.
- A recipe is updated only if both its thumbnail URL and `content_revision`
  still match the plan. User changes win and are recorded as conflicts.
- Interrupted runs resume from append-only outcomes. Successful items are not
  processed again; transient failures can retry up to `--max-attempts`.
- The global lock connection is verified before every item. Per-recipe media
  and row locks plus conditional updates remain the correctness boundary.
- App-owned legacy objects are fetched with authenticated S3 reads. External
  sources use the redirect-aware, SSRF-protected public downloader.
- Content-history restores preserve the current canonical thumbnail instead of
  reviving a historical legacy URL.
- Missing, invalid, expired, or unavailable source images remain unchanged and
  visible in `thumbnail_backfill_events` for retry or user replacement.

## Before production apply

1. Confirm every deployed writer now creates derivative images. Retire older
   legacy-writing releases before scanning the first page.
2. Create and verify a Neon restore point. Record its exact operator-facing name.
3. Confirm S3 credentials and bucket settings point to the intended environment.
4. Start with a small batch (for example, 10), then increase only after checking
   transfer, memory, API latency, and failure categories.

## Dry-run twice

From `api/`:

```bash
python -m app.thumbnail_backfill --batch-size 10
python -m app.thumbnail_backfill --batch-size 10
```

The two outputs must have identical `scanned_rows`, `expected_source_bytes`,
`destination_fingerprint`, `release_id`, and `plan_digest`. Output contains the
public-only scope, transform version, counts, bounded failure categories, and
next keyset cursor; it never contains source URLs. Render supplies its commit
ID automatically. Other production runtimes must set `APP_RELEASE_ID` to their
immutable deployed build or commit ID; `local-development` is rejected in
production.

This validation intentionally downloads an eligible source twice. First apply
downloads it once more to revalidate the plan and once to verify the exact bytes
immediately before transformation: up to four reads before a successful first
attempt. Budget for that transfer and for provider timeouts. Start with 5–10
items and monitor the command; a batch with slow or redirecting sources can take
minutes.

For later pages, pass the previous `next_after_recipe_id`:

```bash
python -m app.thumbnail_backfill \
  --after-recipe-id 11111111-1111-4111-8111-111111111111 \
  --batch-size 50
```

## Apply the exact plan

Copy the three expectation values from the matching dry runs:

```bash
python -m app.thumbnail_backfill \
  --apply \
  --backfill-id legacy-thumbnails-2026-09-06-batch-001 \
  --restore-point pre-thumbnail-backfill-2026-09-06 \
  --expected-rows 10 \
  --expected-source-bytes 1234567 \
  --expected-destination-fingerprint 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-plan-digest 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-release-id abcdef123456 \
  --batch-size 10
```

If the command is interrupted, rerun the exact same command and backfill ID.
Do not create a new ID for a partially applied plan. The global advisory lock
prevents two backfill processes from running at the same time.

## Reconcile

The command returns `completed` only when every planned item succeeded. It
returns `retryable_failures` while a failed item has attempts left, and
`completed_with_exceptions` when conflicts, source changes, missing rows, or
exhausted failures require operator review. Review the append-only outcomes:

```sql
SELECT outcome, failure_code, COUNT(*)
FROM thumbnail_backfill_events
WHERE backfill_id = 'legacy-thumbnails-2026-09-06-batch-001'
GROUP BY outcome, failure_code
ORDER BY outcome, failure_code;
```

Check `conflict`, `source_changed`, and `not_found` manually. They are terminal
for that immutable plan. `failed` items can be retried with the same command
until the attempt limit; after that, use a new dry-run and backfill ID only after
the source problem has been understood.

Advance to the next page only after the current batch reconciles. UUIDs are not
creation ordered, so after the last page run a new inventory from the beginning
and require zero `eligible` public thumbnails, with every failure explicitly
reconciled. Keep legacy objects through the rollout and restore window; this
command has no delete path.

The destructive PostgreSQL integration test has two independent guards: the
database name must contain `test` or `disposable`, the host must be local, and
`THUMBNAIL_BACKFILL_DESTRUCTIVE_TEST=1` must be set explicitly.
