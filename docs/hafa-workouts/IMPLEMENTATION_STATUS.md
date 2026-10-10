# Håfa Workouts implementation status

Last checked: October 10, 2026. Delivery target for the current request is a full-featured Workouts TestFlight candidate for Leon. Public App Review/release remains a later owner decision. Physical health integration acceptance is recorded separately; uploading a candidate is not proof of it.

## First slice: compatible platform discovery

Implemented an additive `/api/v1/platform` registry and independent Workouts capability controls, all disabled by default. Legacy Recipes addresses/routes, response contracts, identity and ownership are unchanged. No migration, provider configuration change or Workouts dataset is introduced in this slice.

The master switch safely disables effective child capabilities even if their environment values remain enabled; it does not reject shared Settings and prevent Recipes startup. Independent code review identified that recovery issue, it was fixed, and the reviewer verified the regression coverage.

The compatibility harness freezes 117 method/path contracts with old/current response consumers and identity/sharing/deletion/privacy/capture checks. It is code-level protection, not proof of exact installed-binary acceptance. Source candidates, artifacts and remaining native gates are recorded in [RECIPES_COMPATIBILITY.md](RECIPES_COMPATIBILITY.md).

Validation on this slice's reviewed code:

- Full `scripts/check.sh`: API **1057 passed / 35 skipped**; Recipes mobile **790 passed**, typecheck and Expo doctor **21/21**; mobile audit **0 unexpected** findings under existing reviewed policy; marketing/admin production audits, lint/typecheck/build passed; admin **13 tests passed**.
- Focused platform/released-client contracts: **170 passed** in independent review.
- Local API startup completed using a dedicated synthetic PostgreSQL database. Root/liveness responses stayed unchanged; new registry returned Recipes available and Workouts unavailable.
- Computer-use QA exercised existing marketing Home → Support and the interactive Swagger product-discovery request, with a real **200** and Workouts unavailable. Initial direct JSON navigation was blocked by the browser; the actual interactive documentation request succeeded.
- Screenshot evidence is local under the task's private report directory, `hafa-workouts-2026-10-10/platform-discovery.png`; no customer content or secrets were used.

The 35 API skips retain their suite conditions and do not establish unexecuted acceptance. Physical devices, exact distributed Recipes binaries, Workouts flows, health integrations and the full 37-case ledger remain pending. The foundation is a bounded first slice, not completion of the app.

The local gate initially hit optional native Rolldown bindings missing after dependency installation under default Node 22.0.0. Reinstalling only task-owned dependencies with Node 22.22.3 resolved it; no source lockfile or inherited audit exception was weakened. Use the supported Node first in PATH for subsequent phases.

## Subsequent slices

Source-informed programming/catalog code and native foundation are in separate owned worktrees, not yet integrated or accepted. The programming slice retains its explicit domain-review gate. Further API data, jobs, coaching, health, actual session/history behavior and TestFlight provisioning must follow the [execution plan](EXECUTION_PLAN.md).
