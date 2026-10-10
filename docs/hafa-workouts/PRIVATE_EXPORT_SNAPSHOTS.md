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

Global admission starts a fresh **read-only** REPEATABLE READ source session
and fails fast before any owner slot is changed. A short separate READ COMMITTED
transaction locks the stable AppUser row and reserves one private slot.
Each encrypted page is inserted and committed in a separate short READ COMMITTED
transaction, with the current owner/generation/privacy fences checked again. It never holds the AppUser
lock or a database transaction across multiple HTTP page requests. The
read-only source holds no page FK or owner-row locks. A page writer briefly
holds its own FK/owner locks and releases them on that page commit; its statement
timeout is five seconds and its lock timeout is one second. Privacy deletion can
commit while the source is paused between pages, rather than waiting for the
entire build. Already-written pages cascade away and cannot be published.
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


## Global admission and response lifetime follow-up

Export slots are conservative controls pending acceptance on the shared Render
service. The observed Recipes peak was 397 MiB on a 512 MiB instance; these
controls do **not** demonstrate adequate mixed-load headroom or authorize
production activation. Root must measure simultaneous Recipes, export creation,
and page downloads, including slow physical network clients, and reduce page
bounds or change capacity if that acceptance gate fails.

The private exporter now has three distinct PostgreSQL transaction advisory
locks, shared across every API replica connected to the same database:

| Operation | Lock ID | Lifetime |
| --- | --- | --- |
| Materialization | 73400430 | One read-only RR source transaction through all source pages |
| Decrypt/read service | 73400431 | One fresh RC read transaction before any ciphertext/large JSON load |
| HTTP GET response | 73400432 | Independent transaction across authentication, handler, serialization, and final ASGI body send |

Every admission uses `pg_try_advisory_xact_lock`, without waiting for another
export. Busy returns fixed `429 export_snapshot_busy`, `Retry-After: 2`, and
no-store. Build admission precedes replacing/reserving an owner slot, so denial
cannot discard an existing download or leave an unfinished reservation. Its
first advisory SELECT establishes the consistent RR view. Advisory-lock state is
managed by PostgreSQL rather than MVCC, so REPEATABLE READ does not admit two
simultaneous holders. Read-only source rows remain stable while short independent
writers check current permission state and publish encrypted pages. A busy
builder never blocks existing page downloads; builders and readers have separate
slots. Cancellation/error/expiry roll back the relevant transaction and release
its slot. Previous page JSON/ciphertext references are dropped before reading the
next page.

Root must mount snapshot/manifest/page GET endpoints on a separate
`APIRouter(route_class=ExportReadRoute)` from `export_response_gate.py`, preserving
`User` and original `Generation` dependencies. POST creation and DELETE discard
continue using WorkoutsRoute. A service read lock alone ends before FastAPI
serializes its DTO, so it cannot bound HTTP body memory. ExportReadRoute keeps its
separate lock through `Route.handle` and the final response send, with a 30-second
response deadline, two-second guard checkout/query/cleanup deadlines, and a
35-second server idle-transaction timeout to bound a lost connection's lock.
Normal cancellation and send errors close/roll back immediately. A timeout after
response-start aborts the incomplete transfer; it never appends a second JSON
error to partial private bytes. Native must discard that incomplete download and
retry the same page/ID. Denied/error admissions release their connection before
sending the small fixed error response. No background cleanup/request task is
left running.

Only one admitted response connection is retained, alongside the one builder's
source connection, one decrypt transaction, and short page-write/metadata
transactions. Additional checkout attempts can obtain pool connections, but they
cannot multiply admitted snapshot/decrypt/serialization memory. This is a
concurrency bound, not a measurement of Python object overhead, TCP buffers,
proxy behavior, total API pool usage, or provider/database connection limits.
Existing authenticated-data checks still run before any private query/decrypt;
while globally busy, a generic 429 may precede an otherwise expected auth 401.
No owner/snapshot identifier or private content appears in that response.
Master-off delegates the ordinary disabled404 before guard DB or authentication.
Existing Recipes routes do not use any of these slots.

The legacy live `GET /export` remains unchanged and is not covered by the new
response gate automatically. Before activation, root must retire it after the
new journey is accepted, or mount it under the same response gate; otherwise
parallel callers of that old path can still allocate export JSON independently.
Service-only calls also require the response gate if exposed through HTTP.

Follow-up synthetic tests cover cross-instance build/decrypt denial before
private load, existing-reader/build independence, cancellation and expiry
release, privacy revocation/product deletion committing while the RR source is
paused **after a committed first page**, absence of orphan/ready exports, blocked
final ASGI sends, denied second responses before handler/decrypt, cancelled and
errored sends, response timeout without a second error body, fixed guard DB503,
dormant404 without guard DB/auth, and ordinary auth rejection before private
handler. These use real PostgreSQL with simulated ASGI backpressure. They are
not a physical-device/slow-network or shared Render RSS acceptance result.

Follow-up validation receipt: **257 passed** together (36 snapshot cases,
7 ASGI response-gate cases, 56 account integration, 158 frozen Recipes
contracts), plus the affected 7-case ASGI suite passed again after adding a real
persisted Recipes `/api/recipes/count` request while the export body send was
blocked. Ruff and diff whitespace checks passed. The local synthetic
`hafa_workouts_exports_slots_test` database was removed; the root-owned container
was left unchanged. No servers, browsers, physical-device traffic or production
resources were started or changed. The clean worktree remains for integration.

## Shared middleware and capture projection correction

Final integration review on `ac13e9d7` reproduced a gap in the response bound:
the shared request-context `BaseHTTPMiddleware` relayed the route's body through
an intermediate channel. The export route released its slot while the outer
network send still retained the body, allowing another private handler to run.
The shared app now uses pure ASGI request-context middleware, preserving request
ID validation, AI context, CORS, handled error headers and Workouts no-store
behavior while retaining the route's original send chain. Composed middleware
tests cover blocked outer sends, busy rejection, completion, cancellation,
deadline/send failure and successful retry. Bulk upload tests use that same
composition so their ingress permit also covers the outer body send.

Automation export queries now select only the existing approved export columns.
They no longer decode retained raw captures, request hashes or unused ORM fields
before discarding them from the response. A real PostgreSQL fixture with a
near-3-MiB capture verifies that neither snapshot nor legacy private export
selects the payload/hash and that their exported import projections still match.

On the isolated correction worktree, focused middleware/export/header/error
checks passed **69 tests**, with the optional socket-server test intentionally
skipped. Existing snapshot/privacy checks and frozen Recipes contracts passed
**201 tests**. These are synthetic PostgreSQL and in-process ASGI results; they
do not establish physical-network, Render RSS, provider or native acceptance.
The integrated repository gate and independent final review remain required.
