# Import and nutrition release verification

Verified implementation commit: `118d340` (before this evidence document).

Recipe saves now run shared nutrition enrichment. Unknown servings use whole-recipe totals; publisher portions remain separate from recipe servings. Existing incomplete recipes can be repaired with the guarded, audited procedure in `NUTRITION-REPAIR-RUNBOOK.md`. Migration 033 installs the audit tables without running repair automatically.

Native link sharing now starts a durable server import using an expiring, share-only credential. The extension returns to the source app after acceptance. The app provisions this credential after sign-in; unsupported attempts to force the host app open are not used. Captures retain stable identities, account scope, and exact acknowledgments across queued imports and app restarts.

## Local checks

- Full `./scripts/check.sh` passed against disposable PostgreSQL with the destructive nutrition integration tests explicitly enabled: 750 API tests passed, 10 skipped; 658 mobile tests passed; Expo Doctor passed 21/21; web and admin lint, type checking, tests, audits, and builds passed.
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
