# Connected Recipes and intentional sharing

This bounded backend slice starts from root integration `0a54ae9`. It changes
only new Workouts files and optional migration 037. Root owns main/config,
startup/runner, erasure/export integration, telemetry, and native/website UI.
The existing Recipes API and its database/model metadata are unchanged.

## Connected Recipes

`GET /api/v1/workouts/connections/recipes` requires authenticated active adult
enrollment and `X-Workouts-Generation`. It reads only the actually granted
`recipes_library_context` and/or `recipes_meal_plan_context` scopes. There is no
decorative preferences permission and no Workouts health information sent to
Recipes. Revoke either scope through the account API's `PUT /grants`.

Optional query parameters are `recipe_ids` (repeated UUIDs, maximum 10),
`start_date`, `end_date` (maximum 31 days), and `purpose=view|coach`. Coaching
context additionally requires current AI consent; this handler makes no provider
call. A worker/provider must recheck permissions before its effects are saved.

The typed response contains `receipt_id`, actual `scopes`, the date range,
`library` (maximum 10 dietary summaries), and `meal_plan` (maximum 14 entries).
Each dietary summary contains recipe ID/title, servings, bounded ingredient
name/quantity/unit, nutrition numbers/basis/status, and an incomplete flag.
Meal entries add their ID/date/meal type/planned servings. Private notes,
transcripts, source URLs, photos, contributor identities, and profile/health
data are excluded. Stale/unavailable nutrition is not presented as current.
Truncated or invalid ingredient information is explicitly incomplete.

Library access is restricted to owned or saved-and-currently-visible recipes;
public-but-unsaved, unshared, hidden, blocked-contributor, and other private
recipes are excluded. Meal plans belong to the caller and use currently
accessible recipe content instead of private cached titles or notes. Reads do
not modify Recipes. A receipt records scopes and IDs actually read, not content.
`GET /connections/receipts` returns the caller's bounded audit history.

## Sharing contract

There is no public Discover feed. A creator reviews a frozen public projection
before creating an expiring unlisted capability link. Tokens authorize only
`training:preview_copy`, never an identity/session or other records.

All paths below are relative to `/api/v1/workouts`:

| Operation | Contract |
|---|---|
| `POST /sharing/previews` | `{kind:workout|program, workout_id OR program_id, expected_revision, display_name?, title?, include_source_url:false, allow_incomplete:false, expires_in_days:7}` plus generation header. Maximum expiry 30 days. |
| Preview result | `{id,generation,preview_digest,expires_at,link_expires_at,kind,content,attribution,review_required}`. Preview expires after 10 minutes. |
| `POST /sharing/previews/{id}/confirm` | `{preview_digest,confirm_public_snapshot:true,disclosure_version:1}` plus generation. Confirm means the creator reviewed this exact public snapshot and understands prior deliberate copies survive revocation. |
| Owner share result | `{id,generation,expires_at,revoked_at,snapshot_digest,kind,content,attribution,review_required,api_path,app_path,website_path}`. Paths are relative except the explicit `hafaworkouts://` app path; no marketing domain is guessed. |
| `GET /sharing` and `GET /sharing/{id}` | Authenticated owner-only bounded list/retrieval, including the same stable encrypted-at-rest link. |
| `DELETE /sharing/{id}` | Owner generation header; idempotent `{id,revoked_at}`. Future public reads/new copies are blocked. |
| `GET /shared/{token}` | Token-only public `{id,expires_at,snapshot_digest,kind,content,attribution,review_required}`. Unknown/expired/revoked/deleted-source links are uniformly 404. |
| `POST /shared/{token}/copy` | Recipient authentication/enrollment/generation plus `{copy_request_id:UUID,snapshot_digest,acknowledge_not_personalized:true,start_date?}`. Program copies require the recipient's start date; workout copies reject it. |
| Copy result | `{kind,record:standard library/program envelope,receipt:{id,source_share_id,attribution,created_at}}`; 201 first copy, 200 identical retry. |
| `GET /sharing/copies/{record_id}` | Recipient-only frozen attribution receipt. |

Attribution is `{shared_by_display_name,source_revision,original_source_included}`.
Default display name is “Håfa member”; private Clerk names/emails are never copied
automatically. Source credit URLs require explicit inclusion and cannot contain
credentials or known bearer/signature query parameters. The flag describes an
actually included URL. The UI must show the exact sanitized projection, permit
an explicit public title/name, and explain what source inclusion publishes.

Workout projections use an explicit field whitelist. They retain prescriptions,
equipment and grouping while removing private IDs, unknown integration exercise
IDs, creator notes, evidence, free-form effort text, and nonnumeric tempo notes.
Block labels become generic. A source workout of kind `program` must be shared
through a structured plan. Incomplete/warning-bearing content requires the
creator's explicit reviewed-draft opt-in; no missing prescription is guessed.

Program projections expose `{title,sessions:[{sequence,day_offset,workout}],notice}`.
They strip original calendar dates, private program/session titles, purposes,
assumptions, notes, health/profile context, and raw warnings. The default public
title is generic unless explicitly chosen. Original session order/gaps remain;
maximum 366 sessions spanning one year. Non-ready/question-bearing programs,
unknown rule provenance, and explicitly health-derived metadata are rejected.

A recipient's program copy preserves those gaps from their chosen start date,
assigns new private IDs, and enters `needs_information` with a review question.
It is user-provided shared content, not an automatically personalized plan or
progression recommendation. Root must prevent guided adoption/progression until
the recipient resolves that review; retrospective actual logging is a separate
explicit choice. Workout copies likewise require the non-personalization
acknowledgment. Profile, history, and health records are never copied.

Copy identity binds the token, snapshot digest, chosen start date, and request.
Changing a request while reusing its UUID returns 409. An identical retry after
source revocation can retrieve its already-created private copy; it cannot create
a new one. Recipient copies/attribution survive source deletion or revocation.
A deleted destination copy returns 410 instead of replaying a stale creation.

Publication/copy uses owner and share-row locks. Reciprocal copies do not acquire
the other user's AppUser lock, avoiding a two-user deadlock. Revocation or source
deletion either follows a completed copy or is observed before copying. DB
triggers protect published snapshots and receipts from rewriting, while allowing
erasure and revocation.

## Root integration and operational gates

1. Include `connection_router.router` in main alongside the account router.
2. Add optional `workouts_share_encryption_key` / `WORKOUTS_SHARE_ENCRYPTION_KEY`:
   a separate 32-byte base64/url-safe key. Never reuse Clerk/provider credentials.
   Tokens have a SHA-256 lookup and AES-GCM ciphertext bound to share ID, owner,
   and generation. The key is checked inside sharing, never global startup.
   Missing/malformed keys prevent new link creation/owner retrieval with 503
   while Recipes, account data, and connected Recipes remain operational.
3. Protect/back up the key; changing it without migration breaks old owner link
   retrieval. Existing token-hash public lookups remain usable until revoked or
   expired. Owner revocation does not require decryption. Key recovery/rotation
   is an operator task, not silent link replacement on a retry.
4. Add optional `migration_037_restore_point`. Keep Recipes' active chain/latest
   version 33 unchanged. Root's migration 035 must expand the separate Workouts
   ledger constraint; 037 requires its recorded prerequisite. Health 036 is
   independent when health is disabled. Run/verify 037 only for enabled Workouts.
5. Call `verify_connections_schema()` in enabled-domain readiness. It is
   database-free while off and checks the separate ledger, columns, immutable
   triggers, and account-delete cascades.
6. In the existing owner-locked product erase transaction call
   `erase_connections_data` before base erasure/generation increment. Whole
   account deletion already cascades from AppUser. Add `connection_export_page`
   to the private full export with bounds/totals; it excludes bearer hashes,
   ciphertext, and credentials. No external media/worker is introduced.
7. Redact `/shared/{token}` paths, source URLs, and all private Workouts contexts
   from Sentry, request/breadcrumb logging, and analytics. The website should
   avoid third-party tracking on bearer-link pages and prevent indexing. Root
   owns marketing-page rendering, moderation/support acceptance, native copy/
   review/revoke UI, and actual device coverage.
8. Keep all Workouts capabilities off in production until integrated acceptance
   passes. Do not equate backend tests with public-beta approval or TestFlight
   delivery. Qualified programming review and health/platform gates remain.

## Verification

The first connected/sharing run passed 22 PostgreSQL cases. The expanded focused
bundle passed 242 cases, including account-data and frozen Recipes compatibility
tests. Final targeted checks cover receipt/grant and revoke/copy races, enrolled
recipient requirements, erasure/export hooks, privacy and source attribution,
program date-gap preservation, idempotency, crypto isolation, and dormant
readiness. The fixture explicitly installs a synthetic 035 ledger prerequisite;
it does not claim the proposal/jobs migration ran in this worktree. Root must
run the complete integrated chain and final repository gate.

No customer data, production database, provider calls, or runtime servers were
used. Tests use the task-created `hafa_workouts_connections_test` database in
the root-owned local PostgreSQL container at port 55482. The container is
borrowed; only this task's database is cleaned. Native/website computer-use QA
remains not run in this backend slice.
