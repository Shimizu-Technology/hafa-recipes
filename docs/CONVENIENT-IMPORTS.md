# Convenient imports and optional review

Product decision: September 10, 2026. This supersedes the mandatory review and private-draft publishing policy in the August extraction plan.

New imports save automatically after extraction. People select Public in Discover or Private before importing; Public is the default for new captures. Existing private recipes remain private. The publishing disclosure is accepted before a public import starts. Incomplete sources remain saved, private drafts.

A usable recipe with no detected issues opens normally. A usable recipe with uncertainty stays saved at the selected visibility and offers one optional **Check details** action. That view contains only uncertain amounts, AI estimates, and source warnings. People can correct an amount, explicitly confirm that the source gave none, or confirm they checked a source warning. Done closes the view without claiming any verification. Editing a recipe no longer requires a checklist, and missing tags or nutrition never interrupt saving.

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

## Initial runtime verification — September 10, 2026

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

## Import follow-up — September 11, 2026

Completed URL imports now open the saved recipe automatically while the Import tab is focused. Returning from the recipe does not reopen it. A job completed in the background opens when the person returns to Import. Existing-recipe results use the same completion path, and re-extraction keeps its separate flow. Image and pasted-text captures already open after saving.

A compact optional-check row replaces the large advisory card for usable recipes. Cook Mode remains available without review. Recipe Notes contain cooking information; extractor diagnostics are omitted rather than replaced with generic filler. Narrow filtering also hides legacy diagnostic notes in the recipe, ingredient list, sharing, and grocery descriptions. The Discover time badge sits above the photo instead of overlapping the importer name.

### Estimated amounts

An ingredient can carry `quantityEstimate: { quantity, unit, reason }` while its canonical `quantity` and `unit` retain the source facts. Extraction may infer a useful amount from servings, other measurements, stated totals or ratios, and the ingredient's role. It must not invent a whole recipe from a dish description. Explicitly flexible amounts such as “to taste” remain flexible.

The mobile app displays and scales estimates with an **AI estimate** label in recipe details and Cook Mode. Sharing and grocery entries retain that disclosure. Accepting an estimate does not turn it into a source measurement. Correcting it to a source amount requires an explicit unit decision when the source unit was absent. Existing clients can read the recipe without receiving an unlabeled estimate in the source fields. Compatible unchanged edits preserve estimates; changes to the cooking context invalidate them.

These instructions use the existing extraction calls and provider fallback path. No separate estimation request or new customer charge is added. The extraction provider still charges the application for its existing API usage.

Sources without a usable recipe remain incomplete. An explicit `sourceIncomplete` flag and a narrow detector for old extractor diagnostics apply consistently to owner reads and public queries. Incomplete sources stay available to their owner but are excluded from Discover and other public surfaces. This policy does not rewrite ownership or fabricate ingredients and instructions.

### Importer attribution

The API resolves an importer name from the exact Clerk issuer and subject when optional token claims lack a name, with a bounded cache and timeout. If the profile is unavailable, it can reuse a non-placeholder attribution from that same stable application owner. No ownership mapping is changed. Contribution counts continue to reflect eligible public recipes.

`python -m app.repair_contributor_attribution` repairs selected placeholder name snapshots only after every target matches a trusted reference recipe's owner. It is dry-run by default, conflict-stopping, transactional, and idempotent. Establish a fresh restore point before applying a production repair. This follow-up requires no database migration; deploy the API before releasing the matching mobile build.

### Follow-up runtime evidence

The actual Expo app ran on an iPhone simulator against isolated local PostgreSQL and FastAPI, with real development Clerk sign-in and its additional email verification. Computer use verified:

- A real website import saved publicly and opened automatically; Back returned to Import without reopening the recipe.
- A live AI pasted-text import opened directly, displayed the garlic estimate, and offered only that ingredient for optional checking.
- Done required no confirmations and left the saved content revision unchanged. Cook Mode opened before review and retained the AI label.
- Scaling four servings to six changed a source quarter-teaspoon to three-eighths and the one-clove estimate to one and a half, while preserving the stored source values.
- Two imports credited the signed-in test account and increased its public contribution count from zero to two. Time badges no longer obscured the byline.

Separate real-provider checks covered a constrained liquid-total calculation, an oil estimate for pasta, and classification plus OCR of a synthetic photographed recipe card. All three returned labeled amounts while preserving stated measurements. An incomplete dish-description fixture was rejected rather than expanded into a fabricated full recipe. The two reported Instagram URLs required login from the local extraction environment, so their full video extraction was not verified. Earlier successful native text tests and the automated suite supplement these bounded checks; they are not a claim that every provider response will supply an estimate.

Native grocery interaction and physical-device Apple/Google sign-in remain unverified in this follow-up. Automated tests cover grocery estimate disclosure and conversion. The compatible simulator build used current JavaScript with unchanged native dependencies; the production build is generated separately from the merged commit.
