# Håfa Workouts implementation status

Last checked: October 10, 2026. Delivery target for the current request is a full-featured Workouts TestFlight candidate for Leon. Public App Review/release remains a later owner decision. Physical health integration acceptance is recorded separately; uploading a candidate is not proof of it.

## First slice: compatible platform discovery

Implemented an additive `/api/v1/platform` registry and independent Workouts capability controls, all disabled by default. Legacy Recipes addresses/routes, response contracts, identity and ownership are unchanged. No migration, provider configuration change or Workouts dataset is introduced in this slice.

The master switch safely disables effective child capabilities even if their environment values remain enabled; it does not reject shared Settings and prevent Recipes startup. Independent code review identified that recovery issue, it was fixed, and the reviewer verified the regression coverage.

The compatibility harness freezes 117 method/path contracts with old/current response consumers and identity/sharing/deletion/privacy/capture checks. It is code-level protection, not proof of exact installed-binary acceptance. Source candidates, artifacts and remaining native gates are recorded in [RECIPES_COMPATIBILITY.md](RECIPES_COMPATIBILITY.md).

Validation on this slice's reviewed code:

- Full `scripts/check.sh`: API **1059 passed / 34 skipped**; Recipes mobile **790 passed**, typecheck and Expo doctor **21/21**; mobile audit **0 unexpected** findings under existing reviewed policy; marketing/admin production audits, lint/typecheck/build passed; admin **13 tests passed**.
- Focused platform/released-client contracts: **171 passed** in independent review.
- Local API startup completed using a dedicated synthetic PostgreSQL database. Root/liveness responses stayed unchanged; new registry returned Recipes available and Workouts unavailable.
- Computer-use QA exercised existing marketing Home → Support and the interactive Swagger product-discovery request, with a real **200** and Workouts unavailable. Initial direct JSON navigation was blocked by the browser; the actual interactive documentation request succeeded.
- Screenshot evidence is local under the task's private report directory, `hafa-workouts-2026-10-10/platform-discovery.png`; no customer content or secrets were used.

The 34 API skips retain their suite conditions and do not establish unexecuted acceptance. Physical devices, exact distributed Recipes binaries, Workouts flows, health integrations and the full 37-case ledger remain pending. The foundation is a bounded first slice, not completion of the app.

The local gate initially hit optional native Rolldown bindings missing after dependency installation under default Node 22.0.0. Reinstalling only task-owned dependencies with Node 22.22.3 resolved it; no source lockfile or inherited audit exception was weakened. Use the supported Node first in PATH for subsequent phases.

The foundation merged as PR [131](https://github.com/Shimizu-Technology/hafa-recipes/pull/131), commit `6462644375e4dd7d034d8cf69855337ce1dfc0d4`. CodeRabbit approved the final reviewed head after all four findings were resolved; an independent review also passed. All four GitHub checks passed. Render deployment `dep-db4qok8ae00c73934d80` is live on this exact merged commit. Public root/liveness/discovery and unauthenticated account/disabled Workouts checks passed. This does not close exact installed Recipes binary acceptance. The merged foundation worktree/branch were removed after verification; continuation evidence was copied into the active integration worktree.

## Subsequent slices

Source-informed programming/catalog code and native foundation are in separate owned worktrees, not yet integrated or accepted. The programming slice retains its explicit domain-review gate. Further API data, jobs, coaching, health, actual session/history behavior and TestFlight provisioning must follow the [execution plan](EXECUTION_PLAN.md).

## Private account and training data integration

The next slice integrates source-informed workout schemas/catalog/programming,
explicit adult/shared-deletion enrollment, generation-fenced private profiles,
library/program versions, actual session events, grants, consent and paged export.
Every new table cascades from the existing stable application owner. Per-product
erasure retains a generation tombstone; whole-account deletion retains its legacy
semantics. Optional migration 034 is separate from Recipes' core chain through 033,
and is imported/applied only when Workouts is enabled. Production migration
requires a named verified restore point. Default-off production receives no new
Workouts database operations or workers.

Telemetry strips Workouts request/exception/context content and excludes private
traces. Private responses, including errors, use `no-store`. Browser previews can
read the profile revision/ETag needed for optimistic concurrency. The actual
shared app is tested for dormant behavior before auth, body parsing or DB access.

Current integration validation:

- Complete repository gate: **1176 API tests passed / 34 skipped**, **790 Recipes
  mobile tests**, typecheck, Doctor **21/21**, inherited runtime audit **0 unexpected**;
  marketing/admin audits/lint/typecheck/build and **13 admin tests** passed.
- **73 focused integration checks** passed, including **55 real PostgreSQL Workouts
  data cases**, shared-app dormant registration, migration orchestration and privacy.
- Local migration/startup succeeded on a synthetic development database with
  Workouts enabled and paid/worker capabilities disabled. Interactive computer-use
  QA executed enrollment GET in Swagger: **401**, `Not authenticated`, with
  `Cache-Control: no-store`; protected data is not exposed without a session.
- API fixtures use the disposable local `hafa_workouts_test` database. Runtime QA
  uses `hafa_workouts_development`; no production datasets or paid AI calls were used.

These results cover the backend slice. Native sign-in/onboarding/training, provider
extraction/coaching, health synchronization, qualified programming review and
TestFlight delivery remain pending. Source-informed rules do not close D03.

Independent Expo project `c520b94d-aac7-49a2-be2b-838a6b992001` is verified under
`@shimizutechnology/hafa-workouts`; Apple bundle `com.shimizutechnology.hafaworkouts`
is registered separately. App Store Connect's user session expired. Leon is away
and cannot log in now; creation of the app record remains pending while other work
continues. No credentials are requested in chat, and existing Recipes identities
and app records are preserved.


## Current unmerged assembly

Backend work now includes jobs/extraction, source/copy review, continuous coach actions, foreground exercise-summary health adapters, scoped Recipes connections, library organization, measurements, durable allowance receipts and anonymous AI admission accounting. The service/package metadata is Håfa API while legacy Recipes routing/address/imports remain compatible. Root follow-up regressions cover revoked consent acceptance, actual source/copy recovery calendars and empty capture drafts. Encrypted fixed-snapshot export is being integrated with privacy invalidation and bounded processing/response concurrency; completed activity logging and the separate website are in isolated slices.

Native training, capture, health, organization, coach, account controls, reminders and running/activity profile context are assembled. Current root static gate:129tests/typecheck/Doctor21/21/all-platform export/native source-map audit pass. Both platform development compilations succeed; this does not prove actual journeys, physical health acceptance or TestFlight signing. Initial browser cold-route and scalar-text defects were fixed. Native email/onboarding save and comprehensive recovery flows remain to execute.

Leon approved up to$5perday of Workouts AI operating cost for evaluation/beta. The committed default budget remains0 and production flags remainoff. Only the explicit environment(s) used for authorized evaluation/beta may receive allocations, whose combined daily ceiling must not exceed$5. A separate development key is required for local real-model evaluation; no real paid calls have been made. Apple App Store Connect sign-in remains unavailable while Leon is away. The Workouts app record and exact TestFlight upload/availability are pending; existing Recipes app identities are preserved.

The comprehensive QA ledger has0fullyacceptedcases across every required dimension. Backend tests, static exports and compiler success are recorded as separate evidence. Full final-head review/gates, source model evaluation, mixed workload/capacity, qualified programming review, physical/provider acceptance and exact release availability remain open.
