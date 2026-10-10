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
is registered separately. Creating the App Store Connect app record requires renewed
interactive Apple authentication; it remains pending while implementation and
independent testing continue. No credentials are requested in chat, and existing Recipes identities
and app records are preserved.

## Coherent backend services review base

This branch is `codex/workouts-backend-services`, based on the first 23 assembly
commits through `a5fa546b0e4d7b209191ddf7748d52efb6f80d77`, against verified
`main` at `1385ca79df33a287e8f38fe17968c6d785605ab9`. It keeps complete source
extraction/import review, guarded coach actions and continuity, private Health
and Recipes connections, sharing/copying, library organization, measurements,
anonymous admission budgets and import allowances together. Their implementation,
migrations 035–042, tests, provider fakes, dependency locks and domain docs remain
in this review base. Base membership/programming migration 034 already belongs
to main; Recipes core migrations remain through 033.

The dependent slice keeps commits `11f9cf9`, `e87ef7b`, `a0d7c10`, `c0f2879`,
`a06f3b0`, `554ef3a` and `3b064f7`, with private export snapshots, completed
activity logging, migrations 043–044, all snapshot/privacy/activity tests and docs,
and their corresponding route/readiness/erasure/response-admission integration.
No export-snapshot or activity-log module, import, migration or readiness check
is mounted by this base. Existing live paged export remains available to
authorized Workouts accounts; consistent encrypted export is a dependent feature.

Two scoped changes move forward from those later commits: Håfa OpenAPI branding
preserves the full legacy `/` discovery response, and local real-provider wiring
uses a dedicated SecretStr development key with explicit paid-processing opt-in
and positive admission budget. Zero-budget operational capabilities hide AI
actions. The website share path carries its token in `/shared#...`; native and
API paths retain their existing forms.

Every Workouts capability remains disabled by default and the committed admission
budget remains 0. This partition does not turn on production, apply optional
production migrations, issue a credential, spend provider funds or alter a
Recipes identity/app record. D03 qualified programming review, real-provider
quality, physical Health integrations, exact released Recipes binary smoke,
mixed workload/capacity and full native/store acceptance remain open.

The assembled PR133 head had 110 changed files, 109 selected by CodeRabbit's existing
lockfile filter. The initial base cut has 91 changed files and 90 selected. The
scoped naming test and this status/QA documentation bring the base to 94 changed
files, 93 selected under the same existing lockfile filter. Count the actual PR
diff again before publication. No tests or docs were omitted to
satisfy the review limit. CodeRabbit also reports unavailable credits; reducing
file count does not establish that a review can run or that code was approved.

Validation for this partitioned base passed the complete `./scripts/check.sh`
gate: 1606 API tests passed, 34 skipped, 16 warnings; 790 Recipes mobile tests and
type checking passed; Expo Doctor passed 21/21; the runtime audit retained 48
inherited findings and 12 reviewed upstream advisories with 0 unexpected findings.
Marketing/admin production audits found 0 vulnerabilities; their lint/type/build
checks passed and the admin suite passed 13 tests. Ruff and whitespace checks
passed. Dependency installation used explicit Node 22.22.3; the unchanged
repository gate selects Node 22.22.2 for its JavaScript stages. These receipts
apply to the a5fa546 base plus the scoped forward changes recorded above,
including dedicated development-key transport/fail-closed, zero-budget capability
and fragment share-link regression checks. Fake provider transport was used.

The disposable `hafa_workouts_backend_services_test` database was removed after
testing. The borrowed PostgreSQL service and root's QA resources remain available.
No server, browser tab, simulator, credential or paid call was started by this
base task. The clean branch/worktree remains for root's independent review and
PR creation; this task did not push, create a PR or merge.
