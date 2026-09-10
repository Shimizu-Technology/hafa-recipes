# Convenient imports and optional review

Product decision: September 10, 2026. This supersedes the mandatory review and private-draft publishing policy in the August extraction plan.

New imports save automatically after extraction. People select Public in Discover or Private before importing; Public is the default for new captures. Existing private recipes remain private. The publishing disclosure is accepted before a public import starts. Incomplete sources remain saved, private drafts.

A usable recipe with no detected issues opens normally. A usable recipe with uncertainty stays saved at the selected visibility and offers one optional **Check details** action. That view contains only missing amounts and source warnings. People can correct an amount, explicitly confirm that the source gave none, or confirm they checked a source warning. Done closes the view without claiming any verification. Editing a recipe no longer requires a checklist, and missing tags or nutrition never interrupt saving.

The normal cooking action remains available for advisory recipes. Public viewers see uncertainty labels and missing amounts, while transcripts, private notes, and extraction evidence remain owner-only. An instructionless source cannot enter Cook Mode.

## Data contract

- `ready`: usable recipe with no unresolved detected issues. It does not claim a person checked every field.
- `needs_review`: usable recipe with advisory uncertainty. May be public when selected by its owner and allowed by moderation.
- `source_incomplete`: insufficient ingredients or instructions. Always private and editable.
- Evidence version 2 remains compatible with released clients. `assessment.issues` lists actual issues, including exact paths for missing amounts and stable IDs for source warnings.
- `verified_paths` records only fields actually corrected or confirmed. Source-warning confirmation uses `resolved_issue_ids`; it does not verify unrelated fields. Both are bound to `review_content_revision`, so stale edits cannot clear newer issues.
- Owner, public, library, collection, planner, and import responses use the same advisory assessment. Reads do not change the persisted structural category, ownership, visibility, or content revision. Evidence remains owner-only.
- Generated missing-amount warnings are deduplicated against field issues. Unrelated source warnings survive ordinary edits. Fresh extraction receives a fresh assessment.

Image and pasted-text captures save immediately after extraction. If saving fails, the extracted payload remains available on a Retry Save screen without repeating extraction. This recovery uses navigation state; terminating the app can discard it. Each new capture carries a stable `capture_id`. The API enforces owner-scoped uniqueness and returns the original recipe on an identical retry, including after a committed save loses its response. Reusing that ID with changed content or visibility returns a conflict. The recovery screen preserves the original request until saving is reconciled; rejected payloads show the API reason and offer editing instead of an endless retry. URL imports continue using durable, idempotent jobs.

## Release order

1. Establish and verify a production database restore point. Set `MIGRATION_029_RESTORE_POINT` and `MIGRATION_030_RESTORE_POINT` to its reference before applying migrations 029 and 030.
2. Apply migration 029 before deploying the API. It changes only `ck_recipes_review_public` to allow public advisory recipes; it does not rewrite content, visibility, evidence, or ownership. The migration is transactional and repeatable. Do not restore the old constraint after public advisory records exist without a separate reviewed rollback plan.
3. Apply migration 030. It adds nullable capture IDs and request fingerprints, an owner-scoped unique constraint, and a consistency check. Existing captures remain unchanged; older clients may continue omitting the ID.
4. Deploy the API and confirm public/private imports, public access, moderation exclusions, and old-client warnings against controlled fixtures.
5. Release the matching mobile build. Older mobile versions retain their old checklist UI until upgraded; backend compatibility does not change a shipped interface.

The release requires the API migration and deployment before the matching mobile build. App Store Connect upload is for owner review; physical-device provider checks precede any later App Review submission.

## Verification

Run `./scripts/check.sh` and the affected runtime flows. Use a disposable PostgreSQL database for migration, public-access, and ownership integration tests. Never point `TEST_DATABASE_URL` at production; these tests recreate the public schema.

The regression coverage includes automatic capture with selected visibility; save-only recovery; duplicate-tap protection; one missing amount producing one issue; exact corrections preserving unrelated content and uncertainty; optional Done without mutation; source-warning resolution bound to a revision; public moderation policy; existing private visibility; and the migration's preservation of ownership and visibility.

## Runtime verification — September 10, 2026

The full Expo app ran in an iPhone simulator with the current JavaScript, a compatible native build with identical dependency locks, the local FastAPI server, and isolated PostgreSQL 16. A separate browser viewed Discover as a guest. Computer-use checks covered:

- Real recipe website import through the extraction worker and automatic public saving.
- Public advisory capture with one missing amount; only that ingredient appeared in Check details. Done left the content revision unchanged. Saving an amount verified one field and cleared the advisory.
- A source warning on a private capture; Cook Mode opened before review, and one acknowledgment cleared the warning while keeping the recipe private and verifying no unrelated fields.
- An instructionless capture selected as public remained a private draft with Add instructions to cook.
- A controlled first-save failure retained the extracted recipe; Retry Save created one saved recipe without repeating extraction.
- Guest Discover showed public captures and excluded the private and incomplete cases.
- Native keyboard layout, saved-data persistence after app reload, and password sign-in with Clerk's actual additional email verification challenge.

Named synthetic pasted-text cases replaced only the model response. Authentication, application screens, HTTP routes, validation, review assessment, saving, and database reads were real. No development AI provider key was available, so paid text/photo/video model calls were not verified in this local run. Website structured-data extraction used real public source pages. Physical Apple/Google sign-in, Apple relay email delivery, and VoiceOver remain device checks.

Runtime testing found and fixed Unicode fraction amounts incorrectly flagged as missing, a keyboard-obscured review button, unsupported Clerk additional verification, and a concurrent first-login ownership-insert race. Signed-in users now reach the import form beneath a short heading.

The complete `./scripts/check.sh` passed: **617 API tests**, **521 mobile tests**, **13 admin tests**, and **21/21 Expo Doctor checks**, plus lint, types, builds, and configured dependency audits. API tests used a separate isolated database; ten thumbnail-backfill tests require their separate destructive-test opt-in and were skipped. Two existing datetime deprecation warnings remain.

The production readiness audit passed with no invalid identity mappings. Native redirect and reviewer-account configuration were ready. This audit does not prove physical-device sign-in or email delivery.

The temporary local API, Metro server, browser tab, simulator, and database containers were cleaned up after verification. The synthetic development Clerk account and temporary development credentials were removed.
