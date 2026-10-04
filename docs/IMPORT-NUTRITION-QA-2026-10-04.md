# Import and nutrition release verification

Verified implementation commit: `dd3c2de` (before the final evidence update).

Recipe saves now run shared nutrition enrichment. Unknown servings use whole-recipe totals; publisher portions remain separate from recipe servings. Existing incomplete recipes can be repaired with the guarded, audited procedure in `NUTRITION-REPAIR-RUNBOOK.md`. Migration 033 installs the audit tables without running repair automatically.

Native link sharing now starts a durable server import using an expiring, share-only credential. The extension returns to the source app after acceptance. The app provisions this credential after sign-in; unsupported attempts to force the host app open are not used. Captures retain stable identities, account scope, and exact acknowledgments across queued imports and app restarts.

## Local checks

- Full `./scripts/check.sh` passed against disposable PostgreSQL with the destructive nutrition integration tests explicitly enabled: 777 API tests passed, 10 skipped; 678 mobile tests passed; Expo Doctor passed 21/21; web and admin lint, type checking, tests, audits, and builds passed.
- The app, widget, share extension, and local bridge compiled in a signed iOS simulator build with matching version 2.6.6 / build 84. Native atomic snapshot and JavaScript parser tests cover capture/payload pairing.
- Independent review covered the integrated changes and the final nutrition error fix. All material findings were resolved, including account changes during delayed persistence/token acquisition, duplicate native events, provider model binding, and publisher portion preservation.
- Dependency review preserves narrowly bounded, expiring exceptions for unpatched Expo build-tool advisories. These are documented exceptions, not patched dependencies; see `mobile/docs/dependency-audit-review.md`.

## Computer-use verification

Tested on a dedicated iPhone 17 Pro simulator running iOS 26.5 with a disposable Clerk development account, local HTTPS API, and synthetic private recipes. Paid local provider calls were disabled.

- Import offers compact visibility controls and collapsed options. Extract remains visible without scrolling, including with the software keyboard open. The assistant action clears the Extract button.
- Safari sharing of two different public recipe links produced two separate accepted server imports while Håfa was closed. Both appeared after reopening the app. The source app recovered after each share.
- With a third draft link typed into the app, synthetic worker completion of the first and second jobs left that draft intact. Clearing the completed import also preserved it. Synthetic completion verifies client state transitions; production provider execution was not simulated locally.
- Nutrition displayed whole-recipe values when servings were unknown, and both whole-recipe and per-serving values when servings were known. Decimal values and zero carbs, fiber, and sugar remained visible in the rendered accessibility tree.
- A structured provider-unavailable response initially exposed a React rendering crash. After the fix, the same refresh displayed a readable retry message, retained the existing nutrient values, and left Refresh available. A mounted NutritionPanel regression covers this failure.

No physical-device test is claimed. Production deployment, existing-recipe repair, and App Store Connect upload are separate release steps and must be recorded after verification.

## Review follow-up

CodeRabbit's first review identified eight findings. The material findings were fixed and checked again. An independent final review of `dd3c2de` found no remaining material issue. New mounted regressions reproduce the original duplicate intake after an auth remount and a retired controller using the next account's token; both now preserve the original account's receipt and reject stale work. API regressions also cover whole-recipe edits with empty per-serving values, inferred incomplete-source protection, extraction-method conflicts, attempt-limit reporting and serving-yield parsing.

A second computer-use pass exercised whole-recipe estimation in the editor against a disclosed synthetic local provider result. The rendered values retained 1.25 g fat, 0.2 g fiber and zero carbohydrates/sugar. This pass verifies estimation/display; the development tool overlay obstructed the header Save action. Actual edit-route tests verify whole-recipe persistence. The disposable development identities were removed.

## Production and App Store Connect

PR [122](https://github.com/Shimizu-Technology/hafa-recipes/pull/122) merged as `6dfbe0d3a07830dde577838ff2bbeffe34f47432`. Main CI passed, Render deployed that exact commit, health returned 200, and the migration log confirmed the active chain through version 33. CodeRabbit acknowledged the initial findings and approved after resolution; its incremental follow-up was rate-limited. The independent final review covered the changed implementation. No branch protection was bypassed.

Neon restore points were verified before migration and nutrition repair. Two matching dry scans found 92 eligible records among 1,021 recipes, plus one incomplete recipe and one without ingredients. The first three estimates passed a bounded production canary. Repairs change only nutrition and its derived metadata, retain immutable audit history, pin the model, and recheck recipe content and ownership before each write.

Production exposed two repair-tool issues. An unpaced batch reached the local account limiter before the provider; its 14 failed attempts remain in the audit history. A paced recovery added 54 successful estimates, bringing the total to 74, then stopped on an orphaned session lock from Neon's transaction pooler. All actual provider calls in those attempts succeeded. A backend follow-up adds pacing, a distinct local-limit outcome and dedicated direct-session locking before the remaining 18 eligible records resume. The orphan lock expired naturally; no production session was terminated or unlocked. Final coverage will be recorded in the follow-up PR release comment and production handoff after deployment.

EAS production build [16d956d3-eb85-45ec-a398-70972a587dcb](https://expo.dev/accounts/shimizutechnology/projects/recipe-extractor/builds/16d956d3-eb85-45ec-a398-70972a587dcb) finished successfully from the merged commit: iOS 2.6.6, build 84. Submission [1d8cc173-7a3e-4fb9-9f1f-b8f8493532e6](https://expo.dev/accounts/shimizutechnology/projects/recipe-extractor/submissions/1d8cc173-7a3e-4fb9-9f1f-b8f8493532e6) confirmed the binary uploaded to App Store Connect. Apple's subsequent processing was not independently verified; the read-only page required login. No App Review or public release was submitted.

The backend follow-up received a fresh independent review of `6dfbe0d..4bc5962` with no material blockers. Its PostgreSQL tests cover resumed pacing with the actual limiter, exclusion of simultaneous repairs, lock continuity while data transactions rotate connections, release after errors, and refusal to write a provider result after lock loss. The integrated repository gate passed 794 API tests with 10 skips, 678 mobile tests, 13 admin tests and Expo Doctor 21/21, plus the web/admin builds, type checks, lint and dependency audit gates.
