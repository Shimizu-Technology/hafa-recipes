# Håfa Workouts complete-product build plan

Status: specification drafted; no implementation milestone is complete. The release target is the entire agreed training loop and selected integrations. Milestones are dependency/verification boundaries, not permission to call a partial importer the finished product.

## Working rules

Use the canonical Shimizu PR workflow for implementation, separate worktrees for independent writers, complete repository gates, repository-selected review and affected-flow QA. Maintain one authoritative shared API source. Preserve unrelated local changes. Do not rename repositories/provider bindings or mutate production merely to publish this plan.

The [PRD](PRD.md) provides P01–P16 requirements; [experience specification](EXPERIENCE.md) provides E01–E08 journeys; [QA plan](QA_PLAN.md) supplies concrete acceptance. Every implementation slice records its tested commit/build and any remaining required coverage. Code review or tests alone do not establish native acceptance or store availability.

## M0 — Resolve release contracts and design

- [ ] Confirm detailed profile, workout, program and session schemas, with source/prescription/actual separation.
- [ ] Inventory published Recipes 2.6.4 and supported historical/TestFlight artifacts, actual redirects/issuers and independent deployment bindings.
- [ ] Review D02 deletion semantics with a concrete old-client/shared-account journey; choose and record the implementation before enabling enrollment.
- [ ] Establish reviewed programming templates/rules for general training, running and basketball-related conditioning; define source evidence and evaluation rubrics.
- [ ] Specify health data types, optional permissions, server/AI consent and origin eligibility; verify native dependency and store requirements.
- [ ] Create usable screen prototypes from the experience brief, including real long content and failure/recovery states.

Exit: full acceptance is mapped to records/actions/screens, material product choices are explicit, and production-affecting paths have a reviewed compatible design. No timeline is promised before dependencies and provider/device constraints are verified.

## M1 — Shared Håfa foundation

- [ ] Add platform interfaces and Workouts domain with backward-compatible Recipes adapters.
- [ ] Establish the Workouts native app shell, independent project identifiers and account flow needed by later capture screens.
- [ ] Implement explicit product enrollment, grants, account scope, recoverable identity and deletion/export design.
- [ ] Implement third-party AI disclosure/consent before any extraction/coaching call, including source/uploaded content; provide a no-transmission manual/local-draft path.
- [ ] Add additive Workouts migrations, owner constraints, schema/startup checks, isolated fixtures and compatible rollback evidence.
- [ ] Establish per-product feature/cost controls, bounded/fair job adapters, storage authorization and safe diagnostics.
- [ ] Verify old Recipes behavior before any new app is required or published.

Exit: platform/invariants and applicable isolated R01–R03/R06 compatibility scenarios pass against the foundation change, with native/production-only dimensions tracked explicitly. R04 combined Workouts load and R05 store delivery belong to M6. Shared-account enrollment can be enabled safely only when all its disclosure/identity/device gates pass. Cosmetic provider/repository renaming remains a separate verifiable cutover.

## M2 — Capture, reference and library

- [ ] Implement native sharing, URL/text/photo/document/manual capture and durable import activity.
- [ ] Build permitted source acquisition and tested support matrix, evidence-preserving multimodal extraction and structured validation.
- [ ] Implement exercise identities, reviewed variations/substitutions, equipment and workout version rules.
- [ ] Complete private organization/search/editing, incomplete drafts, reprocessing, uncertainty, and sharing projections/grants.
- [ ] Evaluate annotated source fixtures and account/privacy/restart races.

Exit: a person can capture, recover, correct, organize and intentionally share usable workouts on iPhone and Android; source claims and AI suggestions remain distinguishable. P03–P06/P13 and affected C-series cases pass.

## M3 — Profile, coach and continuing programs

- [ ] Implement editable/time-stamped profiles, equipment locations, goals and temporary feedback.
- [ ] Build structured programs, scheduling, versioned adjustment and retained completed-session semantics.
- [ ] Implement eligible context retrieval, source-linked explanations and validated coach action tools.
- [ ] Add general-fitness/strength/body-composition/running/athletic templates and goal/conflict reasoning; complete domain evaluation before auto-programming rollout.
- [ ] Extend existing AI consent to specific coaching context, and complete outage/manual paths, stale proposals, undo and action receipts.

Exit: a person can create, understand and revise a coherent multiweek program from imported/app/manual workouts, with explicit assumptions and actual app actions. P01/P02/P07/P08/P11 and affected T-series cases pass.

## M4 — Train, persist and measure

- [ ] Implement native execution for sets, grouped work, timed/distance sessions, rest, instructions and substitutions.
- [ ] Add account-scoped local persistence, outbox, idempotent replay, session conflict handling and restart/background recovery.
- [ ] Build history, traceable corrections, comparable performance/progress and optional measurement trends.
- [ ] Make interrupted and partial sessions first-class; preserve context across chat/instructions/source navigation.
- [ ] Verify notifications/timers/accessibility and timezone/unit behavior on relevant real devices.

Exit: training remains usable without network/AI, actual work saves once, and history informs future decisions without silent rewrites. P09/P10 and affected S-series cases pass.

## M5 — Health connections, Håfa relationship and public free beta

- [ ] Build on-device Apple Health/Health Connect adapters with capability/permission management and honest sync coverage.
- [ ] Implement optional cloud/AI use, actual-session write-back, provenance, deduplication, deletion and revocation.
- [ ] Complete Håfa apps navigation and useful opt-in Recipes connection; verify app-missing/store fallback and sign-in return destinations.
- [ ] Build marketing/support/privacy/deletion/share-landing pages and accurate availability links.
- [ ] Complete publicly accessible free-beta enrollment, visible operational limits, support tools and future entitlement/accounting foundation without active billing.

Exit: both health integrations work on physical devices, neither is required for ordinary app use, app/data relationships are clear, and no incomplete payment feature appears. P12/P14–P16 and H/F-series cases pass.

## M6 — Combined system acceptance and release

- [ ] Run complete automated gates and required comprehensive QA against exact integrated commits/native builds.
- [ ] Test source/model/program evaluations, failed dependencies, concurrent users, cancellation/deletion, restart and old/new client combinations.
- [ ] Perform isolated realistic mixed workload under candidate memory limits; select safe topology and measure cost without assuming extra infrastructure is free.
- [ ] Establish production restore point, rollout order, stop/rollback thresholds, current provider bindings and capability defaults.
- [ ] Deploy compatible backend first, verify controlled smoke tests/observability and retain supported Recipes endpoints/identity behavior.
- [ ] Prepare independent Workouts native records/builds, exact privacy/health declarations and reviewer access; validate real release artifacts before store submission/release.
- [ ] Release public access only after approvals and availability are verified. Any Recipes cross-promotion/client changes have an independent release cadence.
- [ ] Observe representative production for 24–48 hours before right-sizing; record actual invoices/usage separately from estimates.

Exit: all required cases pass, material review findings are resolved, integrated head/build/release sources are verified, actual store availability is confirmed, and owned runtime resources are cleaned or exactly handed off. Blocked physical/provider/store coverage is not waived by green CI.

## Planning artifact disposition

These documents are on a local isolated planning branch, `codex/hafa-workouts-product-plan`, based on `37e64e2`. They have not changed production or started a deployment. Keep this worktree available while the specification is reviewed. Implementation branches should start from a freshly verified target, carrying only approved planning changes; do not blindly merge a stale planning base.
