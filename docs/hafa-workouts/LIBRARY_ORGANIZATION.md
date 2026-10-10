# Private library organization

This slice implements the library behavior from HafaWorkouts P05 on source
`e46c6d1`: favorites, archive, tags, private collections, source duplicate hints,
and intentional independent workout copies. It uses the existing stable
application account, adult enrollment, original data-generation header, and
shared owner row lock. It changes no Recipes route, core migration, provider,
worker, or runtime entry point.

Acceptance for this backend slice is persisted owner isolation, predictable
search, optimistic metadata writes, and preservation of actual-session snapshots
when a live workout is edited, archived, copied, or removed. Native interaction
and complete application release acceptance remain the parent integration gate.

## Wire contract

Every route requires an active enrollment and `X-Workouts-Generation`. The
existing Workouts route guard returns 404 before authentication or database
access when the product is disabled. Write handlers lock the shared application
owner before rereading enrollment, matching the global account-deletion lock.

`GET /api/v1/workouts/library/{id}/organization` returns:

```json
{
  "revision": 1,
  "favorite": false,
  "archived": false,
  "tags": ["Strength"],
  "collection_ids": [],
  "duplicate_of_workout_id": null,
  "duplicate_of_revision": null
}
```

An older record without metadata has revision 0 and empty defaults. New metadata
and migrated records begin at 1. `PUT` takes partial changes plus
`expected_revision`; stale writes return 409. At least one change is required;
null does not mean deletion. Empty tags or collection IDs clear those fields.
Booleans are strict. Tags are trimmed, at most 20 labels of 40 characters,
unique ignoring letter case. Collection membership also has a 20-collection cap.
Organization revision is independent from workout prescription revision.

`GET /collections` returns a private array, sorted by case-insensitive title and
ID. `POST /collections` takes `{title}`. `PUT /collections/{id}` takes
`{title,expected_revision}`. `DELETE /collections/{id}?expected_revision=N`
returns 204, advances affected organization revisions, and unlinks members without
removing workouts. Each response has
`{id,generation,revision,title,workout_count,created_at,updated_at}`. Titles are
trimmed, bounded at 100 characters, and unique per owner/generation ignoring
case. Each library allows 100 collections. IDs are stable through renames.
Composite database foreign keys reject cross-owner or cross-generation links.

`GET /library/search` supports `q`, `equipment`, `kind`, `favorite_only`,
`include_archived`, `archived_only`, `collection_id`, and repeated `tags`
parameters. Normal results exclude archives; `archived_only=true` selects them.
Tag filtering requires every selected tag. Search covers titles, exercise names,
and tags; equipment searches required and optional equipment. Percent and
underscore characters are literal search text. Results order by creation time
and UUID descending. The response is
`{items,total,limit,offset,has_more,next_cursor}`, with normal record envelopes
plus `organization`. Limit is 1–50. Offset supports existing clients; cursor
pagination remains stable across later inserts. Cursor filters are bound to the
owner and original generation. Changed filters return 409 and require restarting
the search. Cursor and nonzero offset cannot be combined. Counts and pages are
live views, not a durable export snapshot.

`GET /library/duplicate-sources?source_url=...&exclude_id=...` returns
`{advisory:true,matches:[{id,title,revision,archived}],has_more}`. It uses the same
pure source canonicalization as Recipes, hashed under a Workouts namespace.
It never fetches a URL, merges records, overwrites content, or treats a source as
unique. Only the owner's records are eligible. Archived matches remain useful.
The source hash stays internal. It checks up to 1,000 indexed/legacy candidates
and returns at most 50 matches; `has_more` explicitly indicates a partial result.
Attribution is checked against current content to avoid obsolete-key matches.

`POST /library/{id}/duplicate` takes
`{request_id:UUID,expected_revision,title?,copy_organization:true}`. It returns a
record envelope plus organization: 201 initially, 200 on an identical replay.
The copy has its own workout ID, prescription version 1, immutable version
history, retained source/evidence, and server-assigned historical origin ID and
revision. It is initially unarchived and unfavorited; tags and current collection
links copy when requested. It does not claim to adapt a source or recommendation
to the user. Changing details under the same request UUID returns 409. Removing
the original leaves the copy and attribution intact. Removing the destination
makes replay return 410, preventing an old queued request from recreating data.
Duplicate receipts permit deletion but reject update at the database level.

## Parent integration required

This commit intentionally contains only new files. These steps are required
before exposing the native features:

1. Include `library_organization_router.router` **before** the account router.
   Otherwise existing `/library/{workout_id}` captures `search` and
   `duplicate-sources` and returns UUID validation errors.
2. Add migration 038 to the optional Workouts migration path after 035. Keep
   Recipes `LATEST_MIGRATION` at its existing value. Migration 038 performs no
   connection when Workouts is disabled. Production requires a verified
   `MIGRATION_038_RESTORE_POINT`. The optional ledger, not the Recipes ledger,
   records completion. No requirement on 036/037 is introduced.
3. Call `verify_organization_schema(engine, settings)` only in the enabled
   Workouts readiness path. It verifies the ledger, table columns, owner deletion
   cascades, composite membership fences, and immutable receipt trigger.
4. Existing library list should accept `include_archived=false`, retain its
   ownership/generation filters, and attach `active_library_condition()` unless
   archives are requested. Existing list/detail and create/update responses can
   use `await overlay_organizations(db, rows)` to add the JSON-safe organization
   field. Adapt the existing response schema accordingly. Single archived
   records stay addressable for history and deep links.
5. Call `refresh_source_metadata(db, row)` inside every owner-locked workout
   create/update/accepted import/adaptation/shared-copy transaction. It flushes
   the saved row, creates metadata if absent, and updates only its internal
   source key. Existing organization revision and user choices stay unchanged.
   Migration 038 backfills existing keys in 500-row batches. The legacy fallback
   covers records with no metadata; completeness after edits depends on these
   writer hooks. No source lookup should be described as exhaustive when
   `has_more=true`.
6. Call `erase_library_organization(db, stable_app_user_id)` inside per-product
   erasure before the owner-locked transaction commits. Workout deletion already
   cascades metadata/membership; standalone collections and duplicate replay
   receipts require this explicit hook. Global `AppUser` deletion cascades all
   four tables. Use `organization_export_page` for bounded metadata export;
   it excludes source keys and replay hashes.
7. Keep the existing owner-fenced DELETE `/library/{id}`. It cascades live
   versions and organization; immutable actual sessions retain their embedded
   prescription snapshots. No new delete endpoint or broad storage cleanup is
   added. Native removal should explain that recorded workouts remain in history.
8. Redact the `source_url` query parameter and request URL in Workouts telemetry,
   alongside existing body/auth redaction. Preserve private no-store headers.

## Validation

Tests execute synthetic fixtures against a dedicated PostgreSQL database on the
root-owned disposable container. They cover metadata revisions, concurrent
writes, archive/restore, collections and case-insensitive titles, strict labels,
owner and composite-FK fences, literal searches, keyset paging during new
inserts, equipment filters, advisory source detection and key maintenance,
independent copies/replays, historical provenance, immutable receipts, deletion
cascades, actual snapshot preservation, bounded exports, optional disabled
readiness, schema drift, migration rerun, and production restore-point gating.

No production data, provider credentials, external source requests, app server,
browser, or simulator is used. Full Recipes compatibility and account regression
results, the tested commit, and resource cleanup are reported with delivery.
