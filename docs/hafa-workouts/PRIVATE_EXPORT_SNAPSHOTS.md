# Private Workouts export snapshots

This slice adds an authenticated, temporary JSON export whose pages all describe
one PostgreSQL view. It builds on the reviewed explicit projection in
`router.export_data`; it never dumps arbitrary ORM fields, raw capture payloads,
credentials, sharing tokens, source request hashes, or provider accounting.
Existing live `GET /export` is unchanged. Root must mount the new interface and
wire privacy cleanup before the native export journey is accepted.

## Interface to mount

Use `APIRouter(..., route_class=WorkoutsRoute)` with `User` (the existing
`require_workouts_user` dependency) and `Generation` on **every** endpoint,
including reads. Preserve the account header guard and the app's no-store error
middleware. Do not put owner IDs or credentials in bodies, URLs, or receipts.
`PrivateExportService(session_factory=AsyncSessionLocal)` owns independent
sessions; do not pass an already-active request database session.

| Route | Service call | Result |
| --- | --- | --- |
| `POST /api/v1/workouts/export/snapshots` | `create(user, generation)` | 201 `ExportManifest`; no request body |
| `GET /api/v1/workouts/export/snapshots/{id}` | `read(user, generation, UUID(id))` | `ExportManifest` |
| `GET /api/v1/workouts/export/snapshots/{id}/pages/{page}` | `read(user, generation, UUID(id), page=page)` | `ExportSnapshotPage`, zero-based page |
| `DELETE /api/v1/workouts/export/snapshots/{id}` | `remove(user, generation, UUID(id))` | 204; owner-scoped idempotent discard |

`ExportManifest` is `{id, generation, schema_version:1, created_at, expires_at,
page_count, page_size:10, totals:{dataset:count}}`. `ExportSnapshotPage` is
`{snapshot_id, page, page_count, export:<existing ExportResponse>}`. The `export`
field retains enrollment, profile and revision, consent, grants, datasets,
totals, has_more, offset, limit, schema version and generated_at. Generated_at
is fixed to snapshot creation time on every page. Rows are frozen by the single
MVCC source view; creation time is a useful label, not a PostgreSQL WAL restore
coordinate. Native should combine dataset arrays in page order, retaining only
one copy of identical metadata. Never append pages from a replacement ID.

Capture the original Håfa account ID, membership generation and snapshot ID for
the whole download. A timeout can retry the same GET page. A creation retry
creates a replacement snapshot, so the client must discard any partial previous
download first. Fetch exactly page_count pages, check each snapshot_id/page,
save JSON only after all succeed, then discard the server snapshot. A 404/409/410
invalidates the partial download; present explicit restart, never silently mix
in a new snapshot. Creating another export replaces that account's previous
export, including a download on another device.

## Consistency and privacy fences

Admission briefly locks the stable AppUser row and reserves one private slot.
Materialization then uses a fresh session with explicit REPEATABLE READ,
streaming bounded pages to encrypted database rows. It never holds the AppUser
lock or a database transaction across HTTP page requests. Its FK to the reserved
snapshot can briefly delay snapshot cleanup while a page transaction commits.
READ COMMITTED publication rechecks owner, active enrollment, original
generation, expiry, and permission fingerprint under the AppUser lock. This
prevents a revoked/deleted account publishing an older view after materializing.
Page reads repeat those checks under a short owner lock.

The permission HMAC covers owner/generation, grant timestamps, AI consent,
health connection revisions/choices, optional Recipes grant epoch, and a
monotonic privacy invalidation epoch. Revocation and regrant do not revive an
old snapshot. Ordinary additions and prescription edits after creation can
retain a consistent earlier view. A privacy correction/removal must invalidate
it instead: a previous export must not reveal a removed body measurement or
cleared AI memory merely because its JSON was cached privately on the server.
AES-GCM authenticates each page's ciphertext and binds it to snapshot ID,
owner, generation and page number. The privacy epoch fences changes during an
in-progress repeatable-read build, even before its pages are visible.

Root must call `invalidate_export_snapshots(db, owner, generation)` in the same
existing owner-locked transaction as privacy changes. It increments the epoch
even when no snapshot exists and removes all that owner's snapshot rows/pages.
Call it for measurement correction/removal, body-field clearing, AI-memory
clearing, AI consent/grant revocation (including Health AI), health connection
revocation, source deletion, and other removal/correction of exported private
content. If an edit is a privacy correction, use this hook; do not classify it
as an ordinary prescription revision. The helper supports a 034-only schema by
checking for the optional table and never commits.

For full Workouts deletion, invalidate first; after membership generation is
advanced and status becomes deleted, call
`erase_export_epochs_after_product_deletion(db, owner)` in that transaction.
The helper rejects epoch removal for active enrollment, preventing an accidental
ABA reset. Whole Håfa account deletion cascades metadata, pages and epochs from
AppUser. The new tables stay out of Recipes' core creation/migration paths.
Privacy hooks must be installed on every writer; pause/drain old writers during
the rollout. Fingerprints catch permission changes without hooks, but content
corrections require the explicit invalidation hook.

## Encryption and bounds

This feature explicitly reuses `WORKOUTS_SHARE_ENCRYPTION_KEY` (32 bytes,
base64), deriving a separate HMAC-SHA256 export key with its own purpose label.
Only encrypted JSON pages are retained. Metadata contains identifiers,
generation, creation/expiry, status, byte/page counts and a permission HMAC.
There is no public object store, unguessable bearer download URL, or provider
call. Missing/invalid key returns `503 export_snapshot_not_configured` for this
feature; disabled Workouts returns 404 before key lookup or database work.
Changing the key invalidates old snapshots.

The limits are 10 rows per dataset per page, 512 pages, 8 MiB encoded JSON per
page, 64 MiB total encoded JSON, and 120 seconds to materialize. SQL checks the
size of large projected fields before asyncpg decodes them into Python objects,
with half of the page allowance reserved for metadata and JSON encoding. It
excludes raw source payloads rather than decoding them to inspect size. A
snapshot exceeding a bound fails explicitly with 413 and retains no partial
export; it never truncates the user's JSON. Source datasets with more than 5,120
rows fail before all pages are materialized. An injected page_source is a
trusted integration/test seam and must preserve these projection/RAM bounds.
Each statement has a 15-second timeout; owner-lock phases have a 5-second lock
timeout. Failures return fixed codes without database/private payload details.
Cancellation makes a bounded cleanup attempt, leaving no running cleanup task.

Expiry is 10 minutes from admission. Expired snapshots become unreadable
immediately and their next authenticated read erases the ciphertext. Admission
also purges up to 100 expired slots and replaces the owner's old slot. Root must
schedule `cleanup_expired_exports(db, limit=100)` in enabled maintenance, commit,
and repeat bounded batches until empty. This is necessary for physical cleanup
of abandoned downloads: PostgreSQL does not delete rows just because their TTL
elapsed. The master-disabled product does not start a new database cleanup job;
operations must account for paused cleanup. An outage can postpone physical
purge while expired content remains encrypted and cannot be downloaded.

## Assembly and validation

Run optional migration043 only for enabled Workouts, after035; it is independent
of041 and042. Production requires a named verified `MIGRATION_043_RESTORE_POINT`.
Do not add043 to unconditional Recipes LATEST33. Enabled readiness calls
`verify_export_schema(engine, settings)`; disabled readiness returns before DB.
Readiness checks the ledger, exact column sets, binary storage, deletion
cascades, and the immutable-page/monotonic-epoch triggers. Never export temporary
snapshot tables through the legacy dataset dump. Do not include personal content
in request logs, Sentry, analytics, or completion/error logs.

Synthetic PostgreSQL tests cover mutations during and after materialization,
fixed metadata/totals, encrypted storage and AAD/key binding, cross-owner
read/discard, original generation, product/global account deletion, TTL purge,
grant/AI/health revocation, fresh publication fences, invalidation epochs,
cancellation, page/size bounds, SQL RAM guards, migration/readiness, and the
proposed HTTP mount's account guard/no-store/master-disable behavior. Native
file save, interrupted-download recovery, actual user-facing notices and
production assembly remain root's acceptance gates. No paid providers,
production data, application servers or browsers are used by this slice.

Validation receipt: on base `6db92a7` plus this isolated slice,
`test_workouts_export_snapshots.py` (30 cases), existing account integration
(56), and frozen mobile Recipes contracts (158) passed together: **244 passed**.
Ruff and diff whitespace checks passed. These tests ran locally against the
separate synthetic `hafa_workouts_exports_test` database on the root-owned
PostgreSQL container at port55482. The agent executed HTTP/API scenarios; no
browser, native device, production data or paid provider was used. Four existing
FastAPI startup/shutdown deprecation warnings remain unrelated to this slice.
The disposable database was removed after verification. The borrowed container
was left unchanged; the clean code worktree is preserved for root integration.
