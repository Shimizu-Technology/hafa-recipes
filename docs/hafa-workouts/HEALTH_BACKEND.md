# Optional health backend and integration handoff

This slice adds separate private health models/service/router, optional migration
036 and real PostgreSQL acceptance tests. It does not modify main, Settings,
existing account/lifecycle code, runtime/migration runners or native UI. Root must
integrate the hooks below before considering the combined product ready.

## Ownership and prerequisites

Base: integration programming commit 90ce6a4, with account-data
72f7e73d965f32a2f40932e5fc83dff9d7756714 cherry-picked as e60d699. Migration 034
exists and was inspected before this implementation. Health migration 036 requires
the explicit 034 and 035 ledger entries. It runs only when Workouts master and
health-sync switches are enabled, and production first application requires a
verified MIGRATION_036_RESTORE_POINT. Replays are idempotent.

HealthBase is separate from Recipes and account-data ORM metadata. It copies only
foreign-key targets and creates four selected health tables. It does not extend
WORKOUTS_TABLES or create/alter Recipes tables. Every health row cascades from its
stable AppUser owner; export intents also cascade from their actual-session row.

Tests use a dedicated synthetic database, hafa_workouts_health_backend_test, on
the borrowed root PostgreSQL container at 55482. Fixtures create 034 normally and
insert a clearly identified synthetic 035 prerequisite ledger because jobs tables
are not a dependency of health. The root full-chain 034→035→036 test remains required;
this test fixture does not prove root's separate 035 migration. No production
data, credentials or live Health provider was used.

## API and integers that must remain distinct

All endpoints are authenticated, Workouts-enrolled and private under
`/api/v1/workouts/health`. Optional health gating occurs before auth/body/DB work.
All writes require X-Workouts-Generation, the enrollment generation. A separate
connection revision changes on each health consent update and fences pending work.

| Endpoint | Behavior |
| --- | --- |
| GET /{provider}/connection | Current owner connection; absent means disconnected with revision 0. |
| PUT /{provider}/connection | Explicit granular read/upload/AI/write choices with expected_revision. |
| POST /{provider}/sync | Atomic bounded upserts/deletions and an idempotent receipt. |
| GET /{provider}/observations | Owner/provider scoped observations, at most 50 per page. |
| POST /{provider}/reconcile | Bounded Android snapshot reconciliation after all acknowledged pages. |
| POST /{provider}/exports | Prepare a native export from an owned actual session; no prescription inference. |
| POST /{provider}/exports/{intent_id}/acknowledgment | Record the client's reported write outcome under current grants. |

Providers are apple_health and health_connect. Connection fields are
expected_revision, disclosure_version=1, connected, read_on_device,
upload_to_server, use_for_ai and write_actuals. Device reading does not authorize
server storage; storage does not authorize AI; OS write permission alone does not
enable app write-back. Setting use_for_ai additionally requires the separate
Workouts AI disclosure to be accepted. Unknown/restricted source eligibility
remains excluded even with AI consent.

Native HealthGrant.generation should map connection revision. Its owner_scope
must also bind the enrollment generation, or native state must explicitly carry
and compare enrollment_generation. Deletion/re-enrollment can otherwise reset a
connection revision to 1 and appear unchanged. Never replace a queued command's
original X-Workouts-Generation with the latest enrollment generation.

## Sync contract and privacy

SyncRequest contains receipt_id (UUID), expected_revision, observations (at most
200), deleted_source_ids (at most 200), optional next_cursor, has_more and
reset_required. Receipt IDs identify exact chunks: retrying identical content is
safe; reusing one for changed content is a conflict. Authorization and current
consent are checked before receipt replay, so a cached success cannot bypass
revocation or deletion.

Observation matches the native DTO: source_id/provider/origin_id, aware
started_at/ended_at, positive duration_seconds, duration_basis, activity_type,
optional updated_at, ai_eligibility unknown/restricted and bounded duplicate
candidates. No body metrics, calories, heart rate, route, arbitrary metadata or
client-declared eligible origin is accepted. Instants normalize to UTC for content
deduplication; display-date projection uses the user's profile timezone.

Deduplication uses owner + enrollment generation + provider + source identity.
An origin cannot silently change. Changed content requires newer provider update
evidence; stale updates are ignored and equal-time conflicts remain reviewable.
Same source IDs produce one private observation and one activity projection.
Distinct source IDs/overlap candidates stay distinct pending source reconciliation;
root progress must not blindly sum overlapping observations.

Own Workouts origins are skipped, and native adapters additionally exclude
canonical write echoes. Strava-looking origins are restricted; everything else
currently remains unknown. Health consent or a model's confidence cannot convert
upstream-origin uncertainty into permission to transmit it to AI.

The native Changes API may return more than 200 records. Transport must split
each native page into deterministic receipt chunks and acknowledge every chunk
before advancing the local cursor. Send next_cursor only on the final chunk;
intermediate chunks do not erase the server cursor. Do not log source IDs, cursor,
times or health content into general analytics.

## Snapshot reset and erasure

Explicit provider deletions remove only matching owned observation/projection
rows. Manual activities and actual training sessions remain. Disconnect or upload
revocation purges imported observations, projections and sync receipts, clears
the cursor, and increments the consent revision. Pending old writes cannot restore
them. Root product erasure must call erase_health_product_data inside its existing
owner-locked transaction before the account-data deletion loop.

For expired Android Changes tokens, reconcile only a complete bounded snapshot:
POST /{provider}/reconcile with expected_revision, aware window_start/window_end
(≤30 days), and all acknowledged receipt_ids for that snapshot. The server derives
seen IDs from its receipts and requires a completed bootstrap cursor. It deletes
absent observations in that window only when they predate the snapshot; newer
concurrent updates and outside-window history are preserved. Apple absence-based
reconciliation is rejected: read privacy makes emptiness ambiguous.

The server treats native records and write acknowledgments as authenticated
client reports, not independent proof that an OS read/write occurred. Native
physical tests remain required. Revocation does not erase the original records
inside Apple Health/Health Connect or records owned by another app.

## Required root hooks

1. Register health_router.router under existing main without changing Recipes paths.
2. Add optional migration 036 after 035 and verify its schema only when the health
   capability is enabled. Dormant health must not introduce default DB queries.
3. Before per-product erasure, call erase_health_product_data(db,user,generation)
   inside the same owner lock/transaction. Whole-account DB cascades are tested.
4. During generic grant replacement, compute removed scopes and call
   invalidate_health_access(db,user,generation,removed_scopes) before commit.
   During global AI disclosure revocation, pass ai_health_context. The helper
   increments affected revisions and purges revoked read/upload projections.
5. All activity queries feeding AI must apply
   health_activity_exclusion_clause(user,generation). Current imported origins
   are unreviewed: no health activity projection is an ordinary manual AI context.
   Also track/filter any derived plan or summary that relied on restricted or
   unknown health sources; stripping the raw source alone is insufficient.
6. Include export_health_page in the owner's paginated product export. It omits
   opaque cursors/receipts and includes source provenance, granular choices and
   owned-write identifiers. Retrieve an owned native-cleanup manifest before
   erasing account data; device/OS erasure requires a separate authorized on-device
   operation and cannot be guaranteed from the server after an app is uninstalled.

Health connection updates synchronize corresponding generic activity-read,
activity-write and AI-health scopes. Generic scopes alone never create the granular
connection. Sync/export check both connection and required generic scope. A generic
scope revocation without the hook stops operations, but root still needs the hook
to invalidate delayed consent updates and accurately display consent state.

## Actual-workout export

Actual session requests/snapshots now carry recorded `active_seconds`, explicit
`activity_type` and optional `active_intervals` containing aware `started_at` /
`ended_at` instants. At most 100 positive, ordered, non-overlapping intervals must
fit inside the session and sum to its recorded active duration within one second.
The backend preserves coherent recorded pauses in the prepared native export.
Incoherent intervals/durations return 422 and create no export intent.

Existing rows without active duration remain unsupported. When active duration
differs from the outer elapsed interval but recorded intervals are absent, export
also remains unsupported: elapsed time cannot replace active time. Backend
preparation does not prove an OS write; actual native pause-event/segment behavior
and physical device acceptance remain separate requirements.

Only an owned current correction can prepare an export. Canonical identity follows
the original client_session_id across bounded correction history; revision is
derived from that history. The response carries truthful actual interval/status,
active seconds and declared activity. No calorie/distance estimate is supplied.
Native write metadata/client IDs use that identity/revision. The server keeps
reported_written or reported_unsupported status; it never claims independently
verified provider delivery from the acknowledgment alone.

## Executed evidence and limits

26 real PostgreSQL/API cases passed on the final slice, including
sync idempotency/conflicts, updates/deletions, owner isolation, source restrictions,
missing/changed consent, generic-revocation hooks, actual exports, full owner
cascades, private erasure, UTC equivalence and bounded Android reconciliation.
One race case independently observed PostgreSQL lock waiting, committed revocation
under the owner lock, and verified the waiting sync returned conflict without
persisting data. JWT/SDK/provider transport uses controlled fixtures; no actual
Health record or native permission was accessed.

Ruff and diff checks apply to owned files. Root must run its full integration gate,
actual 035 chain, native DTO transport and erasure/AI hooks after cherry-picking.
Native health permission/device/provider, public rationale UI and
physical H01–H05 acceptance remain open; this is not complete health acceptance.
