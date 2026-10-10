# Account integration of optional Workouts domains

This slice changes only account router/lifecycle, a new combined integration
suite, and this document. It starts from `ed13a35` and includes the root-owned
assembly/migration fix `85e0b79` (local cherry-pick `e384fad`). It wires completed
health, sharing/connections, organization, and measurement components into their
existing account flows. Startup, migrations, workers, source acceptance, coaching
callbacks, and program adoption remain root-owned.

## Resulting behavior

- Enabled measurement tables connect PUT/profile to the existing reconciliation
  hook inside the same owner-locked optimistic transaction. Changed values need
  explicit timestamps; unchanged goal/equipment saves preserve timestamps and
  do not append history. GET/profile serializes both paired timestamp fields.
  A supported 034-only fixture keeps its prior profile behavior without creating
  fabricated measurement history.
- Library create/edit initializes or refreshes source metadata before committing.
  Responses add `organization`, with independent metadata revision. The normal
  list excludes archives; `include_archived=true` includes them. Archived records
  stay available by ID, and prescription version history stays independent.
  When organization tables are absent, response organization is null.
- Generic grant replacement calculates removed scopes before deletion and calls
  health invalidation under the shared owner lock. Revoking health read purges
  imported observations/receipts and their projected activities while preserving
  manual activities. Connection revisions advance so old native syncs cannot
  restore revoked projections. Revoking global AI consent disables health AI
  access while retaining separately authorized read/upload choices. Existing
  import cancellation behavior remains.
- Per-product deletion erases health, sharing/previews/receipts, collections/tags/
  duplicate receipts, measurements/current selections/replay receipts, automation,
  and base Workouts records in one owner-locked transaction before advancing the
  membership tombstone. Older orphan health generations are also removed.
  AppUser/Clerk and Recipes remain; another owner's health data and independent
  recipient copies remain. Published links become unavailable. Device/OS data
  cleanup still requires the native authorized operation; no external media or
  broad storage cleanup is introduced.
- Private account export includes optional datasets with bounded pages, totals,
  and has_more. Added datasets are health_connections, health_observations,
  health_owned_writes, recipe_connection_receipts, published_training_shares,
  training_copy_receipts, library_organization, library_collections,
  library_collection_members, library_duplicate_receipts, and measurements.
  Health connections sort by provider before pagination. Existing helper
  projections exclude bearer tokens/ciphertext, cursors, source hashes, and replay
  hashes. Removed measurement values stay null. Export still represents live
  pages rather than a durable snapshot.

`optional_table_exists` caches anchor table availability only in the request's
SQLAlchemy session. It enables the supported 034-only fixtures; it does not weaken
production readiness. The root enabled startup gate still requires the complete
optional chain and validates schema before exposing the app.

Root source/import/adaptation/sharing-copy writers must retain their metadata
refresh hooks, since this owned slice changes only manual library create/edit.
Root coaching callbacks and guarded program update integrations remain separate.
No public recipe field, route, core migration, provider, or runtime lifecycle is
changed here.

## Verification and remaining gate

Eight combined PostgreSQL cases pass using the actual 034–039 chain:

1. Original 034-only profile/library/grants/AI-consent/export/deletion behavior.
2. GET/PUT profile timestamps, unchanged edits, explicit measurement requirements,
   and clearing current values while retaining history.
3. Measurement route → actual profile serialization → scrubbed export.
4. Manual library source indexing, archive list/detail, independent metadata and
   prescription revisions, and immutable versions.
5. Generic health permission revocation, projected-data purge, manual activity
   retention, and stale native revision rejection.
6. AI revocation retaining read/upload while disabling health AI.
7. Bounded optional export pages, owner scoping, deterministic connection paging,
   and protocol-secret exclusion.
8. Full per-product erase retaining Recipes, AppUser, other-owner health data and
   recipient copies, with link revocation and safe delete replay.

Historical integration result: the combined account, organization and frozen
Recipes contract run reported **246 passed, 3 failed**. The three failures below
were pre-integration organization expectations; the current tests have since
been repaired:

- `test_metadata_preserves_prescription_and_actuals` now compares prescription
  content/revision separately from changed organization, retaining immutable
  actual/version assertions.
- `test_collections_revision_casefold_delete_unlinks_only` now derives expectations
  from returned metadata revisions. Manual create starts at 1; PUT and collection
  removal advance that revision.
- `test_owner_isolation_and_composite_database_fences` now uses the current
  revision to test the intended 404 and retains the direct composite-FK assertion.

These repaired expectations are no longer pending root work. The historical
counts above do not describe the current gate; current verification is recorded
with the reviewed commit/PR.
All frozen Recipes contracts and account scenarios passed. Ruff and diff checks
pass. This report does not claim a clean full release gate, native/device
acceptance, or production deployment. Tests use only synthetic fixtures in a
separate disposable database on the borrowed root container. No server, browser,
simulator, paid provider, or production data is used.
