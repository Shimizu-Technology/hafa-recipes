# Håfa Workouts execution and production protection plan

Leon has approved the full product scope and shared-account deletion policy. This plan translates the specification into ordered engineering slices and separate readiness/release checks. Application implementation and execution remain unstarted.

## What is delivered

iPhone and Android apps plus marketing/support/share-landing pages. Private capture/library/sharing, inspectable profile, actionable coach, continuing general/strength/body-composition/running/athletic programs, session execution, offline recovery, durable progress, Apple Health and Health Connect, visible Håfa relationship and useful opt-in Recipes context. Public beta is free. A modular Håfa API serves both products with independent mobile release schedules.

Deleting the whole Håfa account removes both products; separate data controls remove only one product. Workouts enrollment explains the existing Recipes deletion operation before extending account scope. No new public workout feed, exhaustive sport catalog, medical rehabilitation, live GPS recorder or watch companion was approved as part of this release.

## Engineering slices and dependencies

Each slice has its own isolated branch/worktree, reviewed change and verification. Several implementation PRs may be necessary for a slice; no PR is ready until its affected acceptance and repository gates pass. Independent read-heavy investigations can run in parallel. Independent writers require explicit non-overlapping ownership and separate checkouts.

| Order | Slice | Concrete deliverable and acceptance | Depends on |
| --- | --- | --- | --- |
| 01 | Recipes release contract | Supported binary/source inventory, captured API/auth contracts, synthetic fixtures and runnable regression harness for R01–R03/R06; actual release/provider bindings recorded | Current verified main/live/store |
| 02 | Domain/native preflight | Sourced programming rules and evaluation cases; native health adapter/SDK compatibility, permissions/data types and physical-device plan; schema/action specifications | 01 |
| 03 | Håfa API foundation | Workouts API module, conditional readiness, safe migrations, per-product controls, old route/auth compatibility and known code rollback | 01, approved schema |
| 04 | Shared account lifecycle | Explicit product enrollment/disclosure, direction/use grants, global deletion, per-product removal, generation fences/export and cache isolation | 03; reviewed identity/deletion contract |
| 05 | Workouts native shell | Independent iOS/Android project IDs and builds, shared-account sign-in, adult onboarding, inspectable profile, Today/Library/Plan/Progress navigation, AI consent/manual path | 03–04; native preflight |
| 06 | Source capture and extraction | Native share, link/text/photo/document/manual intake, permitted source support matrix, durable jobs, evidence/uncertainty and golden-source evaluations | 03, 05 |
| 07 | Exercise/workout library and sharing | Reviewed catalog/variations/equipment, versions, organization/search/editing, incomplete drafts, safe preview/copy/revocable sharing | 02, 06 |
| 08 | Program engine/calendar | Reviewed general/strength/body-composition/running/athletic templates, constraints, future revisions, activity context, interruption/recovery and schedule changes | 02, 04, 07 |
| 09 | Guided training/offline/history | Actual set/interval recording, rest/notification behavior, local outbox/conflicts, partial sessions, corrections and comparable progress | 05, 07–08 |
| 10 | Coach actions and adaptation | Eligible context retrieval, model/prompt evaluations, extraction-versus-suggestion separation, domain tool receipts/undo, stale-proposal checks and limited safety responses | 02, 04, 07–09 |
| 11 | Native health integration | Real read/write/partial permissions, eligible cloud/AI use, origin-aware sync, duplicate reconciliation, revocation and actual-session write-back on both platforms | Native preflight, 04, 09–10 |
| 12 | Connected Håfa product experience | Visible app family/account language, app/store fallback and useful granular Recipes connection; any Recipes client change can await its own review | 04–05, 10; approved projections |
| 13 | Public free-beta operations | Marketing/support/privacy/deletion pages, open adult access, visible operational allowances, cost/entitlement accounting and audited job support without active billing | 06–12 |
| 14 | Isolated deployment readiness and capacity | All applicable isolated/native pre-deployment checks, exact source/build records, old/new contract regressions, failed-provider/restart/deletion tests, mixed workload and topology/cost decision; actual-binary production dimensions remain explicitly pending | 01–13 |
| 15 | Compatible rollout and delivery | Dormant additive backend rollout, actual Recipes binary smoke and remaining production-dependent pre-release checks, then store approval/public downloads and final R05; independent Recipes app rollout if needed | 14; deployment readiness |

Slice order permits early integration tests. For example, source extraction and native health capabilities should be exercised on test fixtures as soon as their prerequisites exist, not first discovered in slice 14. Conversely, public Workouts capabilities remain disabled until complete-release acceptance.

## Protecting Recipes throughout the build

Keep the original Recipes checkout and unrelated changes intact. Recheck main before every implementation branch/integration. Development uses synthetic local/disposable data and explicit non-production auth; paid AI evaluation uses an established bounded budget. Preserve Recipes ownership IDs; never bulk-rewrite them for shared branding or sign-in.

Record existing URLs, redirects, request/response fields, enums and semantics. Adding a field may still break a strict client; use compatible projections or a new route/version when needed. Retain `recipe-api-x5na.onrender.com`, supported authentication issuers and current mobile identifiers. A new Håfa domain is an alias, not a deadline for installed clients.

Add Workouts data without moving/deleting existing tables. Verify migrations, lock duration, constraints, startup checks and old-code compatibility. A restore point is required before production migration, but everyday rollback preserves post-deployment writes instead of restoring an old database snapshot.

New feature controls default off. With Workouts off, missing domain-specific configuration/schema must not start its workers or fail Recipes startup. Shared prerequisites are migrated first. Job/media limits apply across the chosen process/replica topology and preserve recipe service; idle metrics do not establish peak headroom.

**Main currently deploys the API automatically.** Merging a production-affecting API PR is a deployment event. Recheck the actual binding/auto-deploy setting before every rollout; do not merge first and plan verification afterwards. Changes may merge incrementally only when their dormant/compatible production behavior is tested and the rollout is prepared. Renaming repository/provider labels is a separate controlled cutover after foundation acceptance, preserving exact existing addresses/build settings.

## Verification and release evidence

Automated gates verify business rules, database races, migrations, authorization, source extraction, AI-tool semantics and client contracts. Actual native tests verify sharing, keyboards, timers/notifications, session recovery, app links, sign-in and health APIs. Exact distributed Recipes binaries get controlled smoke checks; an isolated QA build with recorded configuration differences is not proof of that binary's production behavior.

Use the [37-case ledger](qa-ledger.json) with per-device results. All five goal families include reviewed fixtures; partial/no health access and denied AI consent have positive manual journeys. Logs, screenshots and saved outcomes must reconcile. Each affected test is rerun after material review/integration fixes.

Before load testing, set a reproducible workload profile and numeric latency/error/queue/resource pass and stop thresholds from the Recipes baseline. Include parallel recipe/workout import, cover generation, chat, logging, cleanup and restart. Choose same-service, upgraded-service or split-worker/service topology from measured capacity and cost. Additional Render/Neon resources are not presumed necessary or free; the architecture remains separable if workload warrants them.

Slice 14 establishes deployment readiness through isolated checks and actual native/provider tests that can run before production deployment. After the dormant compatible API is deployed in slice 15, complete exact Recipes binary smoke and any other production-dependent dimensions. Only then does store-submission readiness require all 36 non-delivery cases and R05's pre-submission build/reviewer/privacy/provider checks. Real Apple Health and Android Health Connect acceptance is required; mock-only evidence cannot close it. Store/public availability remains pending until after release. Required checks/review and material blockers prohibit the affected deployment/submission step regardless of development progress.

## Actual production sequence

1. Record current deployment/source/schema/bindings; validate backup/restore point, compatible rollback target, flags and stop thresholds. Confirm migration compatibility and cleanup policy acceptance.
2. Apply reviewed additive shared/Workouts migrations through the approved deployment mechanism. Avoid destructive cleanup and long unbounded locks. If prerequisites fail, halt rather than serving a partially migrated feature.
3. Deploy known-compatible API code with Workouts capabilities/public access off. Run controlled Recipes sign-in/library/import/chat/plan/grocery/widget/cleanup smoke checks on non-customer fixtures and monitor behavior. Old Recipes remains independent of store review.
4. Enable only restricted test access for exact Workouts release candidates; complete remaining production-dependent exact Recipes binary and Workouts/device/provider/reviewer checks without opening incomplete public flows. Verify all 36 non-delivery cases and R05's pre-submission checkpoints before step 5. Establish the selected hosting capacity before public usage.
5. Prepare and submit the exact Workouts iOS/Android builds and store/health/privacy declarations. Verify source, upload processing and approval separately. Submission/release follow the applicable owner-authorized workflow; no app-store action is performed by this planning task.
6. After approvals, make the fully tested public capabilities available in the order required by the stores, then verify actual installation and signup on both platforms. Treat app approval, public availability and account enrollment as distinct checks; record final R05 only after download/smoke success.
7. Recipes cross-promotion/modern per-product controls can release independently. Existing Recipes binaries retain their tested API/auth/global-deletion contract and receive the approved shared-scope explanation through Workouts enrollment.
8. Observe representative usage for 24–48 hours before right-sizing; document queue/fairness/resource/latency/errors and actual cost. Preserve supported older clients without forcing an update solely for branding.

If Recipes regresses, turn off affected Workouts capabilities and halt further rollout. Use the tested compatible code/configuration rollback when needed. An off switch cannot undo a shared destructive migration or save an already-failed process; the preparation above is essential. Keep support/deletion recovery and data written during rollout intact.

## Completion

Complete means the agreed P01–P16 product works on both native platforms, all required QA/device dimensions and real integrations pass, domain/model evaluations are accepted, shared identity/deletion/data consent are verified, Recipes regressions remain clear, exact public builds are available, and task-owned runtime resources are cleaned or named in a handoff. Neither a merged PR, a successful build upload, nor a partial importer/coach closes the full product.
