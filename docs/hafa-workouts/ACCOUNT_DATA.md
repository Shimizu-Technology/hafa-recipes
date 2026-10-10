# Workouts account and persisted data

This slice is based on `5b67a78` plus authoritative programming/schema commit
`0a1e58c`. It adds the private account/data domain and optional migration 034.
The parent integration owns main/config/startup/migration-runner changes, native
adapters, source processing, AI providers, health synchronization, and release.
No existing Recipes route, model metadata, migration, or account behavior changes
in this slice.

## Acceptance and boundaries

Agent-executed backend acceptance uses synthetic accounts in a dedicated local
PostgreSQL database. It covers explicit adult/deletion disclosure, stable owner
isolation, optimistic concurrency, immutable prescription/actual history, replay,
generation fencing, permission defaults, export, optional readiness, and actual
per-app/whole-account deletion races. Native and computer-use journeys remain
with the parent integrated acceptance plan; this is not full-product acceptance.

No source download, provider call, health read/write, media object, or worker is
introduced. Activities are currently manual records; imported-provider origin and
deduplication require the subsequent health domain. Granted scopes are persisted
permissions, not proof that a native/provider connection is working.

## Enrollment and deletion fence

The domain uses the existing stable `AppUser.id`. Owners are always obtained from
the authenticated identity; payloads cannot choose an owner. The optional product
route guard checks `WORKOUTS_API_ENABLED` before authentication, JSON parsing, or
database dependencies. Disabled requests return 404. Enabled internal access uses
the stable-ID tester allowlist; public access uses the existing public rollout
flag. Every private dataset requires active explicit enrollment.

`GET /api/v1/workouts/enrollment` returns:

```json
{
  "enrolled": false,
  "generation": null,
  "disclosure_version": 1,
  "adult_confirmed": false,
  "shared_account_deletion_acknowledged": false,
  "enrolled_at": null
}
```

Initial `POST /enrollment` requires exactly the affirmative confirmations and
current disclosure:

```json
{
  "adult_confirmed": true,
  "shared_account_deletion_acknowledged": true,
  "disclosure_version": 1
}
```

It creates an active membership with generation 1; replay while active is safe.
It creates no profile, plan, grant, or AI permission implicitly. The UI must explain
that whole-Håfa-account deletion—including that operation in older Recipes
versions—erases both apps and the shared login.

All other data mutations require `X-Workouts-Generation`. `DELETE /data` erases
Workouts datasets while retaining Recipes, Clerk identities, and `AppUser`. It
retains a deleted membership tombstone and increments generation. A retry with
the preceding generation returns the same deleted membership. Re-enrollment
requires `expected_generation` equal to that tombstone's current generation.
A replayed initial enrollment cannot silently recreate deleted data. Re-enrollment
starts with empty datasets and ungranted permissions.

**Native commands/drafts must retain the generation captured when created.** Never
replace an old queued operation's generation with the latest generation when
sending after deletion. Clear/invalidate local drafts and pending writes when
the generation changes. A delayed command using its original generation receives
409 and must not retry as a new enrollment or rewrite itself into the new scope.

Every write first locks the same `AppUser` row as legacy account deletion, then
rechecks active membership/generation. Waiting writes therefore observe either
the committed product tombstone or the missing shared owner. Existing whole
account deletion cascades every Workouts table through `AppUser` FKs, without
editing the legacy route. No external Workouts media exists; the narrowly scoped
`external_cleanup_targets` hook returns no targets. Future assets/jobs require
durable exact-object cleanup and cancellation in both deletion paths.

## Exact API contract

All paths below are relative to `/api/v1/workouts`. Successful private responses
have `Cache-Control: no-store`. Request bodies are capped at 256 KiB, including
chunked requests; saved content is capped at 240 KiB with bounded text fields.

| Method/path | Input | Result |
|---|---|---|
| `GET /enrollment` | Authentication | Enrollment state and current generation. |
| `POST /enrollment` | `EnrollmentRequest` above; optional `expected_generation` for current-state re-enrollment | Enrollment state; no implicit datasets/permissions. |
| `GET /profile` | Active enrollment | Raw `TrainingProfile` or JSON `null`; `X-Workouts-Revision` and `ETag` headers, revision 0 when absent. |
| `PUT /profile` | Raw `TrainingProfile`; generation header; `If-Match` revision, optionally quoted | Raw persisted profile and new revision headers. Missing precondition: 428; stale revision: 409. Adult confirmation is inherited from enrollment and cannot be revoked in profile data. |
| `GET /library` | `limit=20`, `offset=0` | Raw array of record envelopes. |
| `POST /library` | Raw `WorkoutContent`, generation header, recommended UUID `Idempotency-Key` | Record envelope, 201 first save / 200 identical keyed replay. Changed keyed payload: 409. |
| `GET /library/{id}` | Owned UUID | Record envelope; another owner's ID is 404. |
| `PUT /library/{id}` | Raw authored `WorkoutContent`; generation header; `expected_revision` query | New record revision and immutable history entry; stale version: 409. |
| `GET /library/{id}/versions` | Owned UUID, bounded paging | Raw array of immutable version envelopes, newest first. Envelope ID is the version ID; `content.id` is the workout ID. |
| `GET /programs` | Bounded paging | Raw array of record envelopes. |
| `POST /programs` | `{title, proposal: ProgramProposal}`, generation header, recommended UUID `Idempotency-Key` | Accepted program envelope; 201 first save / 200 identical keyed replay. |
| `GET /programs/{id}` | Owned UUID | Program record envelope. |
| `PUT /programs/{id}` | `{title, proposal}`, generation header, `expected_revision` query | New program revision and immutable history. |
| `GET /programs/{id}/versions` | Owned UUID, bounded paging | Raw array of immutable program versions. |
| `GET /sessions` | Bounded paging; `include_superseded=false` | Raw array of latest actual events; corrections replace originals in this default progress view. Set true for all immutable events. |
| `POST /sessions` | `SessionRequest` below, generation header | Immutable actual event with server prescription snapshot, 201 / 200 replay. |
| `GET /sessions/{id}` | Owned UUID | Immutable event, including a superseded original. |
| `GET /activities` | Bounded paging | Raw array of manual activity records. |
| `POST /activities` | Raw `ActivityContext`, generation header | Manual activity record. Non-null `origin_id` is rejected; future provider origin is server-assigned. |
| `GET /ai-consent` | Active enrollment | `{accepted, disclosure_version:1, accepted_at}`; false by default. |
| `PUT /ai-consent` | `{accepted:boolean, disclosure_version:1}`, generation header | Explicit acceptance/revocation. This endpoint sends nothing to a provider. |
| `GET /grants` | Active enrollment | Raw array `{scope, granted_at}`; empty by default. |
| `PUT /grants` | `{scopes:[allowed scopes...]}`, generation header | Replaces the grant set. Empty array revokes all. |
| `GET /export` | `limit=10` maximum 10, `offset=0` | Typed export page with membership, raw profile/revision, AI consent, grants, six dataset arrays, totals, and per-dataset `has_more`. |
| `DELETE /data` | Generation header | Deleted membership/tombstone; shared identity and Recipes retained. |

Normal list limits are 1–50, offsets 0–1,000,000. The native adapter must paginate
until complete when loading a complete library/history/export. Export contains
all actual events and all workout/program versions, with parent record IDs.
Pages are live reads, not a durable point-in-time export job; concurrent edits
between pages can change the export and should be avoided/restarted. A later
durable export worker can provide that stronger guarantee.

A workout/program record envelope is:

```json
{
  "id": "server UUID",
  "generation": 1,
  "revision": 1,
  "content": {},
  "created_at": "ISO datetime",
  "updated_at": "ISO datetime"
}
```

Workout `content` is authoritative `WorkoutContent` with server-assigned `id`,
`version`, and `parent_version_id`. Strip those three fields when authoring a
POST/PUT body; providing them is rejected. The native adapter can flatten
`content` for display while keeping envelope revision/generation for writes.
Do not accept owner IDs, server timestamps, or revisions from capture/provider
payloads. Source provenance requires a valid credential-free http(s) URL.
Client-authored content cannot claim server-generated suggestion provenance.

Programs require a ready proposal, the current `RULE_VERSION`, recognized source
identifiers, 1–366 uniquely identified planned sessions, bounded content, and
valid nested prescriptions. Storing a client-accepted proposal does not establish
that its origin was an authenticated AI generation. Provider proposal acceptance
must be implemented server-side by the subsequent coach slice. Qualified
programming review (D03) remains a launch gate.

`SessionRequest` selects either an owned workout/version or an owned
program/version/planned-session identifier. The server loads its historical
prescription; the client cannot submit a replacement prescription snapshot.

```json
{
  "client_session_id": "client UUID retained through retries",
  "workout_id": "owned workout UUID",
  "workout_revision": 1,
  "started_at": "2026-10-10T10:00:00+10:00",
  "finished_at": "2026-10-10T10:20:00+10:00",
  "status": "completed",
  "actuals": [
    {"block_id":"strength","exercise_index":0,"set_index":1,"reps":10,"completed":true}
  ]
}
```

Program sessions instead supply `program_id`, `program_revision`, and
`program_session_id`. Actuals support reps, duration, distance, load/unit/convention,
completion, difficulty, pain feedback, and notes. Circuit entries also carry
`round_index` (default 1), `side` (left/right/both or null), and optional numeric
`effort` (perceived exertion 0–10). Identity includes round, set, and side so
unilateral/circuit results are not collapsed. Actual numeric fields reject
booleans and string coercion. Identities must refer to the
saved prescription. Finalization can be `completed` or `partial`; ongoing drafts,
timers, pauses, and crash recovery remain native-local in this slice. Body times
must have an explicit timezone and finish cannot precede start.

Session creation is idempotent by owner + generation + `client_session_id`; reuse
for changed actuals returns 409. Correct a past event with a new client UUID and
`supersedes_session_id`; the original stays immutable. Correct the latest event
in a correction chain. DB triggers reject UPDATE of actual events and
workout/program versions, while allowing explicit erasure and owner cascades.

## Consent and connected-app scopes

Allowed scopes are `recipes_library_context`, `recipes_meal_plan_context`,
`health_activity_read`, `health_activity_write`, `health_body_measurements_read`,
and `ai_health_context`. There is no decorative Recipes-preferences toggle.
Root owns a bounded Recipes projection for the first two scopes, alongside
explicit user-facing explanations. Health data never becomes visible to Recipes
through these grants. Native health permissions/provider authorization remain
separate requirements, and successful permission storage is not synchronization.

AI consent must be obtained before third-party coaching. Health context requires
the corresponding additional permission and accurate disclosure. The future
provider/health workers must recheck current membership, generation, and required
permissions under the owner lock before committing results. Revoked permissions
must cancel or fence pending effects. Root owns Sentry/analytics redaction of
Workouts bodies, auth headers, private source URLs, and health/coaching context
before enabling the product; `send_default_pii=false` alone is insufficient.

## Parent integration instructions

1. Cherry-pick only this slice's data commit after programming `0a1e58c` (the
   worktree's programming cherry-pick is the same content; do not duplicate it).
2. Import/include `app.domains.workouts.router.router` in main. Its route class
   supplies the early optional-product guard. Keep Recipes URLs/root/liveness.
3. Add optional `migration_034_restore_point` to Settings and the env example.
   Migration also supports the actual `MIGRATION_034_RESTORE_POINT` environment
   variable. Production requires a previously verified named restore point.
4. Keep Recipes `ACTIVE_MIGRATIONS` and `LATEST_MIGRATION=33` unchanged. After the
   core chain, call optional `migrations.034_add_workouts_domain.run_migration()`
   only when Workouts API is enabled. It is also safe to call unconditionally
   because its first branch returns without opening the database when disabled.
5. Add `verify_workouts_schema()` to startup only for enabled Workouts; the
   verifier itself is a database-free no-op when disabled. No Workouts worker
   starts in this slice. Verify enabled schema against its separate ledger,
   columns, cascade FKs, and update-only immutable triggers.
6. Expose `ETag` and `X-Workouts-Revision` in main's CORS response headers for
   cross-origin browser QA; native fetch is unaffected by browser CORS.
   Register native enrollment/generation/revision adapters and all acceptance
   tests against the integrated main app. Keep original queue generations and
   UUID creation/session keys. Run the whole repository gate after integration.
7. Keep Workouts rollout off in production until the compatible migrations,
   legacy Recipes acceptance, workload tests, provider/privacy/native checks,
   and complete release gates pass. SQL domains are additive and leave core
   Recipes tables/ownership untouched.

Optional ORM metadata is separate from Recipes `Base.metadata`, with only copied
FK target metadata for `app_users`. Importing these models cannot silently insert
Workouts tables into a legacy Recipes `create_all` or migration path. All new
tables cascade from existing `AppUser`; the optional version ledger is separate
from `schema_migrations`. Once 034 has been applied to an environment, subsequent
schema changes require a new optional migration rather than silently rewriting
034 and assuming `create_all` will alter existing tables.

## Verification and remaining work

The final focused bundle passed 282 tests: 55 new real-PostgreSQL Workouts cases,
authoritative programming tests, 158 frozen Recipes compatibility cases, and
existing identity/deletion integrations. Ruff and diff checks passed. Existing
FastAPI `on_event` deprecation warnings remain unchanged.

Test URL: local disposable `hafa_workouts_accounts_test` on the root-owned
PostgreSQL container at port 55482. No production data or provider credentials
were used. The test database was task-created; the container is borrowed and
must not be stopped by this slice. No servers, browsers, simulators, or workers
were started. Parent integration must verify complete native journeys and the
final shared app; these tests do not establish TestFlight delivery.
