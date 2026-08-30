# Privacy-safe recipe correction telemetry

Recipe edits now produce one transactional aggregate event when content changes
or an unverified draft becomes ready. The purpose is to measure where extraction
needs improvement without copying private recipe content into analytics.

## Stored fields

Each event stores only:

- recipe and stable application-user IDs for deletion and ownership scope;
- source type, extraction method, content revision, and before/after review
  states;
- event kind: `review_correction`, `review_verification`, or `customization`;
- counts for ingredient names, quantities, units, ingredient notes, steps,
  times, and other fields;
- booleans for title and serving changes;
- the aggregate count of previously missing quantities that were resolved;
- creation time.

The table has no recipe JSON, raw source text, field values, field paths, URLs,
captions, transcripts, image data, or model response content. Deleting a recipe
or account cascades to its events.

## Interpretation

- `review_correction` means the previous recipe state was `source_incomplete`
  or `needs_review` and at least one value changed.
- `review_verification` means a person reviewed an uncertain draft and marked it
  ready without changing content.
- `customization` means a later edit to a recipe that was not awaiting review.

These labels let quality reporting exclude normal personalization. Counts are
positional edit signals, not semantic truth; component reordering may count as
multiple changes and must not be used to reconstruct content.

## Operational use

Aggregate by source type, extraction method, event kind, and time period. Track
quantity/step correction rate, corrections per reviewed recipe, missing-amount
resolution, and time-to-ready. Keep reports count-based and access-controlled.
Do not join events into a content export or add raw values to make debugging
more convenient.

Migration 027 is additive, idempotent, and performs no backfill. Rollback stops
new event writes with the previous application version; the table can remain in
place and requires no destructive down migration.

The first production run also requires `MIGRATION_027_RESTORE_POINT` to name a
verified database restore point. The migration fails before changing schema if
that marker is absent. Once version 027 is recorded, later idempotent deploys do
not require the marker to remain set.
