# Completed activity log

This slice covers the PRD's general running/basketball use cases and P10 completed history, plus QA scenarios T04/T05. A user can record a run, walk, basketball game or other completed activity without a saved workout or AI processing. It records user-declared date and minutes, optional distance for run/walk, an optional name/note and explicit strenuous true/false/unknown. It does not invent exercises, reps, calories, start/finish timestamps or a device Health workout.

The existing `WorkoutsActivity` remains the strict `ActivityContext` projection used by deterministic planning and manual coach context. The new metadata table preserves canonical activity ID, owner/generation, revision, current detailed content, original capture time and removal state. Immutable operation receipts retain original request UUID, content hash, action, resulting activity/profile revisions and server receipt time. These let a repeated HTTP request return the same response without creating another observation. Corrected detail replaces the manual observation; completed training sessions and immutable prescription/actual snapshots remain unchanged.

Dates are explicit YYYY-MM-DD values through today in the current profile timezone, with a3650-day history bound. Without a profile, the documented TrainingProfile default Pacific/Guam applies and is returned by the page. Duration is an integer from1 through1440 minutes. Optional run/walk distance is positive and at most500km. These are product input/storage bounds, not training recommendations. Strenuous remains unknown unless the user declares it. No permanent health characteristic is inferred.

## API contract

All writes use the original `X-Workouts-Generation` header. `WorkoutsRoute` retains master-disable-before-auth/body/database gating, bounded JSON and no-store responses.

| Endpoint | Request | Result |
|---|---|---|
| POST `/api/v1/workouts/activity-log` | request_id UUID, kind run/walk/basketball/other, date, duration_minutes; optional name≤200, strenuous bool/null, distance_km, notes≤2000 |201 activity mutation; exact unchanged retry remains201 |
| PUT `/activity-log/{id}` | Same fields plus expected_revision |200 corrected mutation; current revision required |
| DELETE `/activity-log/{id}` | request_id UUID, expected_revision |200 removed mutation; exact removal retry remains200 |
| GET `/activity-log/{id}` | Owned ID | Current activity or scrubbed tombstone |
| GET `/activity-log` | limit1..50, offset0..10000, optional from_date/to_date within supported completed range | items, has_more, timezone, today, limit, offset |

An activity response contains `id`, `generation`, `revision`, `status` active/removed, nullable `content`, `source` user/external, `read_only`, `legacy`, nullable `completed_confirmed`, nullable `origin_id`, `created_at` and `updated_at`. Active detailed content contains kind/date/name/duration_minutes/strenuous/distance_km/notes. Legacy duration may be unknown. A mutation also returns the profile_revision captured in its immutable receipt, ETag for the activity revision and X-Workouts-Revision for that captured profile revision. Refetch current profile state after a mutation: a safe retry of an older request intentionally does not claim its historical revision is current.

Same UUID with different content, target or action returns409. A stale target revision, a replay after later correction, or a stale generation also returns409. Old creation/correction requests after removal return410; they cannot recreate removed content. Other owners see404. Invalid body/date values return422. Imported provenance rejects correction/removal with403.

Existing manual `ActivityContext` rows remain readable with legacy=true, revision1 and completed_confirmed=null. Their original endpoint did not prove completion, so history does not silently upgrade them. A user can review and PUT explicit completed fields, adopting the same canonical ID and original capture time into revision2. Future legacy context remains available through its detail route but does not appear in completed history. Imported or health-derived rows remain read-only; this slice never edits/deletes their upstream Health originals. A managed projection that later acquires imported provenance is also blocked from editing/removal.

## Safety and integration

Every write takes the shared application-owner lock and fresh enrollment generation before reading retry receipts or changing data. Capture identity, owner/generation and original timestamp have database trigger protection. Operation receipts have an immutable update trigger and a composite owner/generation/activity foreign key. Whole-account deletion cascades from AppUser.

Changed writes advance an existing profile revision and updated_at while preserving profile content. This fences pending deterministic and coach proposals whose previous context only hashed activity IDs/capture times. The new router cancels the local owner's coach task after a changed commit; remote commits remain fenced by their context rechecks. Creation without a profile returns profile_revision0 and does not fabricate a profile. Stored chat history remains available for the user's view; existing coach boundaries exclude messages predating the current profile epoch.

Removal scrubs detailed content and removes its planning projection. It retains a per-generation tombstone and immutable request hash/receipt metadata until Workouts data or the whole account is erased. There is no retained original plaintext name, note, distance or duration in the removed metadata. A fresh create UUID deliberately creates a separate observation; the app must not use a new UUID to retry an uncertain response.

Root integration still required:

- Register activity_log_router.router and migration044. Migration044 requires035 only and a named verified MIGRATION_044_RESTORE_POINT in production; it does not alter existing legacy observations or depend on040–043.
- Call `verify_activity_log_schema(engine, settings)` during enabled Workouts readiness. Disabled master makes no optional queries.
- Before product projection deletion, call `erase_activity_logs(db, owner)` under the existing owner lock. This explicitly removes removed tombstones as well as active metadata; operation receipts cascade. Whole-account cascade needs no extra deletion SQL.
- Include `export_activity_logs(db, owner, generation, limit, offset)` in private account/export snapshot assembly to retain kind, notes, distance and revision beyond the older projection-only export. The helper returns items/has_more; root owns aggregate totals and snapshot materialization.
- Native API, quick-log entry points, original owner/generation durable retry commands, profile/history invalidation and actual UI acceptance are being implemented by the native agent. They are not claimed complete by these backend tests.

## Verification

Final local gate: `uv run pytest tests/test_workouts_activity_log.py tests/test_workouts_automation_integration.py tests/test_workouts_data_integration.py -q --tb=short` passed116 cases, including35 new activity-log cases. Ruff and Git whitespace checks passed. Tests cover creation/HTTP replay, races, strict fields, partial/unknown activity information, timezone/history bounds, manual legacy adoption, imported provenance, removal/ABA, current proposal fencing, unchanged actual snapshots, operation/identity protection, readiness/migration guards, export/paging, whole-owner cascade and a waiting write fenced by product erasure.

Product-erasure tests explicitly invoke the new erase helper before the existing root endpoint; that verifies the integration contract without claiming root assembly already invokes it. Tests used the exact disposable `hafa_workouts_activity_log_test` database, which was dropped afterward. The borrowed PostgreSQL container remained running. No provider, production, device Health or persistent runtime resources were started. Full root integration, native interaction and physical-device acceptance remain pending.
