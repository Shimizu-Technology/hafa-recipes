# Scoped Recipes connection permissions

This slice starts from `6db92a7`. It adds one epoch model/service/migration and
new tests, and changes only connection_router among existing files. It fixes the
Recipes settings client's broad grant read-modify-write behavior: a delayed
Recipes command cannot carry back health or AI scopes revoked elsewhere.

## Wire contract

All routes require an active adult Workouts enrollment, the original
`X-Workouts-Generation`, and the existing account identity guard. Workouts master
off returns 404 before authentication or database access. Responses are private
no-store. A missing epoch table returns 503 recipe_grant_epoch_unavailable;
production readiness must install 041 before exposing this feature.

`GET /api/v1/workouts/connections/recipes/grants` returns:

```json
{
  "generation": 1,
  "revision": 0,
  "library_context": false,
  "meal_plan_context": false,
  "scopes": []
}
```

Scope entries use existing GrantResponse `{scope,granted_at}` and contain only
recipes_library_context and recipes_meal_plan_context. No health/AI scope is
included in this subset response. GET takes the same AppUser lock as grant
writes/deletion to keep revision and choice values coherent. It creates no epoch
or grant rows.

`PUT` to the same path takes
`{expected_revision,library_context,meal_plan_context}`. Revision is a strict
integer 0–2147483647; both booleans are strict and required. Scope arrays, owners,
health/AI choices, or other extra fields are rejected. It returns the same shape.
Every write locks the shared AppUser, then checks current enrollment/generation.
Stale revision always returns 409 **before** considering a no-op. An absent epoch
is revision 0; every real Recipes choice change advances it by one. All flags
false still has its advanced epoch after a revocation, so empty→grant→revoke
cannot make an old revision 0 command valid again.

Unchanged choices at the current revision are a no-op. Existing granted_at values
and the epoch stay unchanged. Changes delete only removed Recipes scope rows and
insert only newly selected Recipes scopes. Unchanged Recipe rows and all health/
AI rows remain intact. Scope choice and epoch commit in the same transaction.

A request UUID receipt is unnecessary here: after an ambiguous network response,
retrying an old changed command returns 409, then a GET reveals actual choices.
Native must refresh/show that state without automatically resubmitting an old
choice or upgrading the revision/generation of a queued command. Deliberate new
user intent can use the newly fetched revision.

## Root integration required

1. Add optional migration 041 after 035; it has no dependency on 036–040. Keep the
   Recipes ledger/latest migration unchanged. Production requires a verified
   `MIGRATION_041_RESTORE_POINT`; disabled migration/readiness opens no database.
   Migration preserves existing grant rows and granted_at values. Legacy choices
   with no epoch start at observed revision 0 until their first real change.
2. Call `verify_recipe_grant_schema(engine, settings)` from enabled readiness.
   It checks ledger 41, exact columns, validated AppUser cascade, and enabled
   monotonic trigger. Epoch PK is `(app_user_id,generation)`; persisted revisions
   are positive, while absent state is 0. Database updates must advance by one
   and cannot change ownership/generation.
3. In generic PUT/grants, under its existing AppUser lock, read current scopes
   and compute requested scopes. If 041 is installed, call
   `await advance_recipe_grant_revision(db,owner,generation,previous_scopes,next_scopes)`
   with validated scope strings before commit. It changes only the epoch when
   the Recipes intersection changes. Health/AI-only changes leave Recipe revision
   intact. Do not delete/reinsert unchanged grant rows: remove actual differences
   and insert newly added scopes so timestamps remain meaningful.
4. The new native Recipes settings must use this endpoint and never read-modify-
   write the full global scope list. **An unversioned generic PUT/grants can still
   restore its own delayed broad snapshot.** Bumping epochs fences later scoped
   commands, not that legacy command itself. Use dedicated versioned health/AI
   operations, and separately version/restrict or retire any remaining unsafe
   broad client mutation. Do not call the whole generic grant system race-safe
   merely because this subset endpoint is safe.
5. Before enabling this feature, all live grant writers must obey the epoch hook.
   Pause/drain older workers during a mixed-version deployment; an old writer
   that changes Recipes rows without advancing the epoch would defeat its fence.
6. Inside owner-locked per-product erasure, call
   `erase_recipe_grant_epochs(db,owner)` before membership generation advances.
   Global AppUser deletion already cascades the epoch table. Original generation
   prevents commands from a deleted/re-enrolled dataset from becoming new grants.
7. Add `export_recipe_grant_epoch(db,owner,generation)` to private account export.
   It returns at most one row `{generation,revision,updated_at}` and no owner or
   private content. Apply the parent export page limit/offset to this singleton.
   No source, prompt, health, or provider data is stored by these new components.

Root owns main/config/migration assembly, generic grant mutation, erasure/export,
and any coaching invalidation policy. This commit does not edit those files or
claim those remaining hooks already happened. Existing Recipes projection routes
continue checking the actual scope rows before creating bounded access receipts.

## Verification

Eighteen disposable PostgreSQL cases cover private empty reads, no implicit rows,
only-Recipes responses, preservation of unrelated scopes/timestamps, concurrent
Recipes choices, actual health/AI revocation followed by a delayed narrow command,
ABA/stale-equal rejection, ambiguous-response refresh, generic epoch helper,
strict DTOs, owner/enrollment/original-generation/account-header fences, epoch
export, owner-locked erase/re-enroll hooks, global account cascade, database
monotonicity, default-off behavior, migration idempotence/restore/core ledger, and
readiness. No provider, paid call, production data, app server, browser, simulator
or container lifecycle is used. Final exact-commit combined results and dedicated
test database cleanup accompany delivery; parent integration/native acceptance
remain gates.
