# Self-reported measurement history

This optional Workouts slice uses source `e46c6d1`, the existing stable AppUser
identity, explicit adult enrollment, and owner lock. It adds declared weight and
height history, current selection, corrections, removal, paged trends, and export.
It provides no BMI calculation, calorie target, weight-loss recommendation, or
health-device measurement import. Entries accept only `source: "user"`.

Acceptance is correct unit normalization and chronology, explicit timestamps,
no refreshed timestamp during unrelated profile edits, original generation and
profile revision fences, private owner scoping, and removal of values from both
measurement reads and future saved AI context. Completed training actuals remain
unchanged. Native interaction, integrated profile schemas, and release acceptance
remain the parent gate.

## API

All paths start with `/api/v1/workouts`. Every measurement route requires active
enrollment and the original `X-Workouts-Generation`. Every write also requires
`If-Match` naming the current profile revision (0 when no profile exists). Missing
If-Match returns 428; stale profile/entry revisions return 409. Master disable
returns 404 before authentication or database access through WorkoutsRoute.

An entry contains
`{id,generation,revision,kind,source,status,value,unit,canonical_value,canonical_unit,recorded_at,is_current,created_at,updated_at}`.
Kind is `weight|height`; source is `user`; status is `active|removed`. Weight units
are `kg|lb`; height units are `cm|in`. Canonical kg/cm use exact defined conversion
factors, rounded to six decimal places, with positive bounds up to 500 kg/300 cm.
Original declared values and units remain available while the entry is active.
Recorded time is an explicit ISO string with a timezone, from 1900 through the
present (five minutes of clock skew allowed). Server ingestion time never stands
in for recorded time. Numeric values and boolean choices are strict.

- `POST /measurements` takes
  `{request_id:UUID,kind,value,unit,recorded_at,source:"user",update_current:true}`.
  It returns 201 initially, 200 on an identical replay.
- `PUT /measurements/{id}` takes
  `{request_id:UUID,expected_revision,value,unit,recorded_at,source:"user",update_current:false}`.
  Kind and owner cannot be changed. Corrections advance the entry revision and
  replace its previous stored value/time; old incorrect values are not retained.
- `POST /measurements/{id}/remove` takes
  `{request_id:UUID,expected_revision}`. Removal advances entry revision and
  scrubs original value, unit, canonical value, and recorded time. The remaining
  tombstone supports safe replay and does not contain the removed measurement.
- Writes return
  `{measurement,profile_revision,current_applied,profile,context_reset}` and
  `X-Workouts-Revision`/ETag headers. Profile is its current raw content or null.
  Replays return current stored state, never an old response containing a value
  that was later removed. Changed details under a request UUID return 409.
  Replaying creation/correction after removal returns 410, preventing an old
  queued action from recreating data.
- `GET /measurements/{id}` returns the owner's current entry or its scrubbed
  tombstone; unknown/other-owner IDs return 404.
- `GET /measurements?kind=&include_deleted=false&limit=25&offset=0` returns
  `{items,total,limit,offset,has_more}`. The `include_deleted` parameter selects
  inclusion of scrubbed `removed` tombstones; normal views show active entries.
- `GET /measurements/trends?kind=weight|height&start_at=&end_at=&limit=25&offset=0`
  uses the same envelope and always excludes removed entries. Dates are aware
  ISO times; reversed ranges return 422. Limits are 1–50, offsets 0–1,000,000.
  Pages order by recorded time and UUID descending. Totals/pages are live views.

A history entry updates current profile data only when explicitly requested and
strictly newer than the current recorded time. Equal-time or older backfills
remain history, reported by `current_applied:false`. Selecting the first current
measurement can create a default adult profile. Recording history only can leave
profile null. Correction of an already-selected entry updates its current value
and time; unrelated history correction does not promote itself unless requested
and newer. Removing a selected entry clears its current profile fields. It never
automatically selects an older entry. Clearing current data establishes a time
fence so later backfills do not silently restore the cleared value.

Corrections/removal clear saved AI messages and pending proposals. Accepted
profile proposals are removed; other accepted proposal payloads are cleared while
their content-free acceptance references and canonical training records remain. Existing
profile revision advances even for historical correction/removal, fencing calls
already in flight. Accepted user-owned plans/workouts and completed actual
snapshots remain. Native UI should disclose clearing saved AI context before
correction/removal/current-field clearing. Current-value clearing retains active
history; entry removal scrubs that entry. These are distinct actions.

## Parent integration

This commit changes only new files. Before exposing measurement features:

1. Add optional aware `weight_recorded_at` and `height_recorded_at` to
   TrainingProfile. A timestamp without its value is invalid; null/null clears
   current data. Use strict finite numeric weight/height validation. GET/PUT
   profile must accept and serialize the timestamp fields before measurement
   routes can populate them.
2. Include `measurement_router.router`. It defines the static trends route before
   the measurement UUID detail route. Preserve private no-store/body/URL telemetry
   handling and exposed revision headers.
3. In owner-locked, profile-revision-checked PUT/profile, after producing validated
   proposed content and before persisting it, call
   `await reconcile_profile_measurements(db, owner, generation, previous_content, proposed_content)`.
   Use its returned normalized content. Persist profile revision normally and
   commit once. The hook creates history only for changed canonical values.
   Changed non-null values require an explicit paired timestamp. Unchanged values
   retain stored timestamps, including unknown legacy timestamps; date-only fixes
   use history correction. Current clearing retains history and clears AI context.
   The hook performs no commit and assumes the existing owner/revision checks.
4. Add migration 039 to the optional enabled Workouts migration path after 035.
   Keep the Recipes ledger/core migration path unchanged. Production requires a
   verified `MIGRATION_039_RESTORE_POINT`. No dependency on 036–038 is introduced.
   Disabled migration/readiness performs no database connection. Migration creates
   no fabricated historical entries from legacy profile values or updated_at.
5. Call `verify_measurement_schema(engine, settings)` from enabled readiness. It
   verifies optional ledger 39, tables/columns, owner cascades, the composite
   current-selection ownership fence, and immutable operation receipts.
6. Call `erase_measurements(db, owner)` inside per-product erasure under the shared
   owner lock, before root deletes profile data and commits. It removes receipts,
   selections, history and tombstones. Global AppUser deletion cascades all tables.
   Add `measurement_export_page(db, owner, generation, limit=50, offset=0)` to
   private export. It is bounded and excludes replay hashes; removed values stay
   null in export.
7. For automated AI context, use current profile fields and/or
   `current_measurement_context(db, owner, generation)`: minimal active current
   selections with declared user source and actual recorded time. It does not
   automatically retrieve old history. Enforce existing AI/health consent at the
   caller; this helper does not grant permission. Do not traverse raw operation
   receipts or accepted proposal metadata as health context. The removal hook
   clears saved context and pending proposals without erasing owned training.

## Verification scope

Tests use synthetic, private owners in a dedicated PostgreSQL database on the
borrowed root container. Scenarios cover units, chronology and ties, history-only
records, trend paging/ranges, strict input/provenance, revisions/generation,
owner and composite-FK isolation, concurrent replay/current updates, corrections,
removal scrubbing and tombstones, current-clearing fences, exports, unchanged
profile timestamps, unknown legacy timestamps, context invalidation, optional
migration/restore points, immutable receipts, and per-product/global erasure.

The e46 base lacks the parent-owned timestamp schema additions, so child tests
read persisted profile revisions directly and inspect mutation/profile-hook
content. The parent integrated gate must additionally exercise real GET/PUT
profile serialization after measurement writes. No production data, provider,
server, browser, simulator, or container lifecycle is changed by this slice.
