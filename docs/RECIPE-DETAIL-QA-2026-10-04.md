# Recipe detail update — 2.6.8

Recipe details now put preparation and cooking first. Nutrition shows one labeled portion at a time, with four compact macro tiles, secondary nutrient rows, and a collapsed calculation-details disclosure. Equipment appears at the beginning of Ingredients, with a direct link from Steps. Creator notes sit with instructions; private collection, plan, and note tools remain independent of the selected tab. Source playback is smaller, missing photos no longer leave an empty hero, and related recipes expand on request.

The update also fixes correctness issues found during the audit: equivalent publisher portions are not duplicated; unknown recipe yields do not become invented one-serving estimates; costs and recipe text follow serving changes; cached content is hidden after access is denied; stored serving choices cannot overwrite a newer selection or another recipe; and saving supplied nutrition preserves its new assumptions and basis in metadata.

## Verification

The full repository gate passes with a disposable PostgreSQL database: 801 API tests, 720 mobile tests, 13 admin tests, mobile TypeScript and Expo checks, and web/admin builds and audits. Four database-backed regressions verify both recipe-save endpoints, known and unknown serving counts, and removal of obsolete assumptions. Ten API tests remain skipped under the repository's existing gate configuration.

Native computer-use QA used an isolated local API, synthetic recipe fixtures, development Clerk identity, and paid AI disabled. The tests ran in the existing development client on iPhone SE (375-point width, iOS 18.5) and iPhone 17 Pro (iOS 26.5), with light/dark appearance and the largest iOS accessibility text setting.

| Flow | Observed result |
| --- | --- |
| Known yield | Per-serving 440 calories and whole-recipe 1,760 calories are labeled separately. Changing 4 to 5 servings changes the whole total to 2,200, while the portion stays 440. |
| Costs and ingredients | The same change updates the header and cost tab from $12 to $15, keeps $3 per serving, and scales ingredient quantities and costs. |
| Unknown yield | Only whole-recipe nutrition is offered; no serving control or invented per-serving cost appears. |
| Publisher nutrition | A source portion of “1 cookie” shows 200 calories once, with publisher provenance. |
| Partial/stale data | Only supplied values appear. The incomplete-source explanation and stale warning stay visible. Refreshing the synthetic stale estimate clears its warning. |
| Preparation | Equipment appears in Ingredients, is absent from Nutrition, and the Steps equipment link opens at preparation. Missing instructions retain the private draft advisory and add-instructions action. |
| Notes and sharing | A synthetic private note saves and displays. The native share sheet opens on iOS 18.5; export tests verify selected nutrition basis, scaling, provenance, and assumptions. |
| Long content | A long title wraps; all 24 numbered assumptions remain available. The final assumption can be read above the cooking dock. Switching tabs retains the expanded disclosure and reading position. |
| Access and errors | A missing recipe shows an explicit unavailable page with a back action. Unit tests cover access-denied cache handling and retryable network responses. A public non-owner page has no owner nutrition-refresh control. |

The iOS 26.5 simulator did not expose a usable native share sheet in this development shell; iOS 18.5 verified that interaction. Changing iOS text size while the development shell was running needed a remount for native text measurements to settle; the remounted screen wrapped correctly. Physical-device behavior and paid AI estimates were not claimed as tested here.

No database migration or production data backfill is required. The API change is compatible with older clients. The mobile release is intended for TestFlight; this task does not submit it for public App Review.
