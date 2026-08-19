# Håfa Recipes Improvement Roadmap

Created: 2026-08-18
Canonicalized: 2026-08-19
Source audit: [SYSTEM-AUDIT-2026-08-18.md](./SYSTEM-AUDIT-2026-08-18.md)
Product context: [PRODUCT-AND-SYSTEM.md](./PRODUCT-AND-SYSTEM.md)

## How to use this roadmap

- Task IDs are stable references for issues, branches, commits, and PRs.
- Work is grouped into release gates, not speculative calendar promises.
- A task is complete only when its acceptance criteria and verification pass.
- Production configuration, migrations, deployments, and provider changes require deliberate rollout and rollback plans.
- Chat-image private delivery is excluded for now under ADR-001; other chat hardening remains in scope.
- A dedicated staging deployment is intentionally excluded under ADR-002. Development/production isolation remains required.
- The focused admin portal and GPT-5.6 Luna/Terra routing strategy are accepted under ADR-003 and ADR-004. Model rollout remains evaluation-gated.

## Confirmed product decisions

| Decision | Why | Execution consequence |
|---|---|---|
| Complete the audit roadmap | The existing product is strong, but its privacy, reliability, AI operations, and governance need to catch up with its feature breadth. | Releases A–E remain the active plan and should be executed in dependency order. |
| Defer private chat-image delivery | The product owner accepts the temporary direct-URL risk while higher-priority safety work is completed. | ADR-001 interim controls remain mandatory; revisit by 2026-11-18. |
| Do not maintain dedicated staging | A continuously deployed staging app is unnecessary at the current team size. Accidental production access is the actual risk. | Development fails closed and uses local/disposable non-production data; production is selected explicitly. |
| Build a focused web admin portal | Public UGC and extraction operations need safe moderation and recovery without direct database edits. | Implement the reversible, audited MVP in C7 before broader social expansion. |
| Use Luna-first, Terra-escalation model routing | Luna supports Håfa's required modalities and structured output at roughly one-tenth Terra's token price. | Evaluate by capability; use Terra only when deterministic gates and measured quality justify escalation. |

## Implementation record — 2026-08-19

The first canonical-monorepo implementation slice shipped in PR #9. It delivers:

- the configurable OpenAI model registry, startup validation, kill switches,
  deprecated-model removal, Luna routine defaults, and Terra fallback wiring;
- allowlisted public recipe contracts and public contributor identifiers that do
  not expose Clerk subjects or owner-only recipe data;
- private-by-default creation across extraction, manual entry, OCR, editing, and
  mobile sharing controls;
- stricter chat roles, input/media budgets, rate/concurrency limits, and
  uncertainty/food-safety prompt boundaries, while preserving the explicit
  chat-image delivery exception in ADR-001;
- a PostgreSQL-backed extraction worker with queued/claimed/processing/terminal
  states, leases, heartbeats, retries, expiry, cancellation, idempotency, stale
  recovery, operations diagnostics, and migration 018;
- account-scoped mobile job persistence, non-overlapping backoff polling,
  background/foreground reconciliation, reconnect behavior, and complete
  terminal-state UX; and
- a boot-only `/up` endpoint, queue runbook, PostgreSQL migration tests, API
  safety/contract tests, native iOS validation, and canonical documentation.

This is meaningful progress on A1–A4, A6, B1–B2, C4–C5, and C8, but it does not
close every acceptance criterion in those umbrella tasks. In particular, the
comparative model evaluation/provenance system, explicit fail-closed development
environment work, first-publish review, durable account/media cleanup, broader
data-integrity work, analytics/observability, accessibility expansion, product
navigation work, and the focused admin portal remain scheduled below.

The second implementation slice adds the durable deletion and media-lifecycle
foundation in B6:

- local account erasure and its external cleanup intent commit atomically;
- hash-only authentication tombstones prevent a deleted Clerk subject from
  lazily recreating an application identity while remote deletion is pending;
- a PostgreSQL cleanup queue uses cross-replica row locks, fenced leases,
  bounded exponential retries, stale-lease recovery, and terminal failure;
- every issuer-scoped Clerk alias and every S3 prefix is attempted independently;
- recipe and account deletion cover legacy and content-addressed thumbnails,
  account chat media, meal plans, extraction targets, invites, and remaining
  user references;
- recipe media writes and deletion share a cross-replica advisory lock so a
  late edit/re-extraction upload cannot escape the cleanup scan;
- completed jobs discard raw external target snapshots while retaining bounded
  operational audit metadata;
- recipe image writes use immutable content-addressed keys, so image changes
  immediately produce a new cache-safe URL; and
- admin diagnostics expose cleanup-queue counts. Safe admin reconciliation UI
  remains part of C7.

The third implementation slice completes B3's database-invariant foundation:

- external source URLs receive deterministic, privacy-safe canonical identities;
- same-user external imports, saved recipes, and recipe version numbers are
  protected by database uniqueness rather than check-then-insert timing;
- recipe version allocation holds the recipe row lock through the mutation
  transaction;
- every business-data ownership/actor column now references the stable
  `app_users` identity, closing late-write races with account deletion;
- migration 020 introduces tracked schema state and application startup refuses
  to serve an incomplete schema; and
- disposable PostgreSQL tests exercise migration replay and real concurrent
  transactions.

## Release A: Production safety

Goal: remove immediate privacy, model, auth-transition, and environment risks before adding functionality.

### A1 — AI model registry and emergency migration

Findings: AI-001
Priority: P0

Work:

- [ ] Add environment-configured model IDs for extraction, OCR/vision, recipe chat, general chat, tags, nutrition, transcription, and TTS.
- [ ] Add startup validation that rejects retired or missing required model configuration.
- [ ] Replace Gemini 2.0 Flash after a focused extraction/OCR evaluation.
- [ ] Replace GPT-4o chat and vision usage after a focused evaluation.
- [ ] Keep `whisper-1` and `tts-1` initially unless evaluations justify change.
- [ ] Add a provider/model kill switch and ordered fallback configuration.
- [ ] Remove Gemini 2.0/GPT-4o branding from mobile UI and stale active docs.

Candidate evaluation set:

- Gemini 3.6 Flash and Gemini 3.7 Flash;
- Gemini 3.5 Flash-Lite or 3.1 Flash-Lite for low-cost extraction;
- GPT-5.6 Luna with `reasoning.effort` set to `none` or `low` as the initial OpenAI baseline for routine structured extraction, OCR/vision, and chat;
- GPT-5.6 Terra at the same tested effort as an escalation candidate for low-confidence, schema-invalid, or otherwise difficult inputs;
- existing GPT-4o-mini extraction fallback as a baseline while still supported.

Accepted routing policy (specific provider/model rollout remains evaluation-gated):

- routine structured extraction and OCR: lowest-cost passing candidate, with Luna included in the baseline;
- hard/low-confidence extraction: Terra retry when a deterministic validation gate says it is needed;
- recipe and general chat: Luna by default, Terra only for a measured complex-case tier;
- tags and nutrition enrichment: Luna or a cheaper passing specialist; prefer deterministic nutrition sources where available;
- transcription: compare `gpt-transcribe`, `gpt-4o-mini-transcribe`, and the existing `whisper-1` baseline;
- TTS: keep `tts-1` initially.

Acceptance criteria:

- No retired Gemini 2.0 or deprecated GPT-4o model ID exists in active runtime code.
- Production model choice is pinned/configured, not an unversioned UI claim.
- Evaluation covers video transcript, website text, single OCR, multi-page OCR, and low-quality source cases.
- Luna/Terra comparison reports task success, corrections, schema validity, latency, total reasoning/output tokens, and cost per successful task.
- Rollback can be performed through configuration.
- Each request records capability, provider, model, prompt version, latency, fallback reason, token usage, and cost estimate without storing private prompt content in logs.

### A2 — Public recipe DTO and identity boundary

Findings: PRIV-001
Priority: P0

Work:

- [ ] Define allowlisted `PublicRecipeListItem` and `PublicRecipeDetail` schemas.
- [ ] Exclude `raw_text`, extraction notes, Clerk IDs, provider errors, internal provenance detail, and owner-only fields.
- [ ] Add public profile IDs/handles if contributor filtering requires a stable identifier.
- [ ] Update Discover, detail, contributor, similar, duplicate-check, and search endpoints.
- [ ] Review caches so private responses cannot be served as public.

Acceptance criteria:

- Snapshot/contract tests enumerate every allowed public field.
- Anonymous requests cannot recover a transcript, user note, Clerk ID, private recipe, or owner-only metadata.
- Authenticated owners still receive the fields required for editing/re-extraction through an owner schema.
- Production-safe verification confirms public responses match the allowlist.

### A3 — Privacy defaults and publishing review

Findings: PRIV-002
Priority: P0

Work:

- [ ] Default manual and OCR recipes to private in API and mobile.
- [ ] Decide whether imported public-source recipes remain public-by-default or become private-by-default.
- [ ] Add first-publish confirmation and preview.
- [ ] Add an owner-facing review for existing public manual/OCR recipes.
- [ ] Separate public recipe notes from private extraction instructions.

Acceptance criteria:

- Creating a family recipe without interacting with visibility produces a private recipe.
- Publishing clearly explains what fields and attribution become visible.
- Extraction instructions never appear in the public recipe representation.

### A4 — Auth transition isolation

Findings: AUTH-001, AUTH-002
Priority: P0

Work:

- [ ] Cancel in-flight private requests on auth-subject change.
- [ ] Remove private queries on sign-out, sign-in, and account switch.
- [ ] Include the current user ID in private query keys.
- [ ] Preserve public cache only where responses are genuinely identity-independent.
- [ ] Change optional auth: no credentials means guest; invalid credentials mean `401`.

Acceptance criteria:

- Automated User A -> sign out -> User B test shows no A data.
- Expired/invalid bearer token produces an invalid-session state rather than guest content.
- Signed-out public Discover still works.

### A5 — Development/production isolation

Findings: ENV-001
Priority: P0

Work:

- [ ] Create explicit local/development and production API configuration.
- [ ] Use local PostgreSQL or a disposable non-production Neon branch/database for development.
- [ ] Use budget-limited development provider credentials where paid external calls are needed.
- [ ] Remove production fallback from development.
- [ ] Require preview builds, if used, to declare their backend target explicitly; do not maintain a dedicated staging deployment.
- [ ] Add a visible development/non-production environment indicator.
- [ ] Document safe intern setup with seed data.

Acceptance criteria:

- Development cannot contact production without an explicit, exceptional override.
- Preview builds cannot inherit a production target accidentally.
- CI verifies each supported environment mapping and fails on missing configuration.
- Interns can run the app without production database credentials.

### A6 — Chat validation and food-safety prompt

Findings: AI-002, AI-003
Priority: P0

Work:

- [ ] Restrict history roles to user/assistant.
- [ ] Reconstruct provider messages server-side.
- [ ] Enforce message, history, base64 byte, MIME, and image-dimension limits.
- [ ] Only forward app-owned or current-request image content.
- [ ] Replace confident-vision instructions with uncertainty and safety rules.
- [ ] Add per-user chat concurrency and request limits.

Acceptance criteria:

- Client-supplied `system`, `developer`, or unknown roles are rejected.
- Arbitrary remote image URLs are not forwarded.
- Oversized inputs fail before provider calls.
- Safety evaluations cover doneness, thermometer use, allergens, spoiled food, pregnancy, and unreadable measurements.

### A7 — Patch-level release hygiene

Findings: DEP-001
Priority: P0/P1

Work:

- [ ] Apply Expo-compatible patch upgrades reported by Expo Doctor.
- [ ] Upgrade the marketing build Node version to a supported release.
- [ ] Apply non-breaking website advisory fixes and verify build.
- [ ] Upgrade the marketing site's React Router packages past the currently reported high-severity advisory range.
- [ ] Triage mobile advisories into runtime-reachable, build-only, and blocked-upstream categories.
- [ ] Make Expo Doctor blocking after the mismatch is fixed.

Acceptance criteria:

- TypeScript, Expo Doctor, website lint/build, API lint/tests, and actionable dependency audits pass.
- Deferred upstream advisories have documented impact and owner.

## Release B: Durable extraction and data integrity

Goal: make extraction survive production events and make recipe data internally consistent.

### B1 — Durable job execution

Findings: JOB-001
Priority: P0/P1

Work:

- [ ] Choose one execution owner: database-backed worker, managed queue, or equivalent durable system.
- [ ] Introduce queued, claimed, processing, completed, failed, cancelled, and expired states.
- [ ] Add lease expiry, heartbeat, retry count, error code, and next-attempt fields.
- [ ] Make recipe writes idempotent.
- [ ] Reconcile currently stale processing jobs.
- [ ] Notify users when extraction completes or fails.

Acceptance criteria:

- Restarting/deploying the API during extraction does not strand a job.
- Duplicate delivery does not create duplicate recipes.
- Stale claims are recoverable.
- Cancellation is terminal and respected by the worker.
- Operations can identify queue depth, age, failure rate, and retry rate.

### B2 — Visibility-aware mobile job observation

Findings: JOB-002
Priority: P1

Work:

- [ ] Replace async `setInterval` polling with completion-scheduled polling.
- [ ] Add an in-flight guard, backoff, and jitter.
- [ ] Pause when backgrounded and refresh immediately on foreground.
- [ ] Handle every terminal state.
- [ ] Scope persisted active jobs by user and allow more than one future job safely.

Acceptance criteria:

- No overlapping status requests.
- Backgrounding does not generate continuous polls.
- Returning to the app reconciles server state.
- Cancelled, failed, expired, and completed jobs all clear local active state.

### B3 — Canonical source and database invariants

Findings: DB-001
Priority: P1

Work:

- [x] Define URL canonicalization rules by source.
- [x] Add idempotency keys to extraction starts.
- [x] Add applicable composite uniqueness constraints for saved recipes and versions.
- [x] Make version creation transactional.
- [x] Decide duplicate/fork semantics for recipes from the same source.
- [x] Adopt a tracked migration system or strengthen numbered-script tracking and schema verification.

Acceptance criteria:

- Concurrent save/edit/extract tests do not create duplicate logical records.
- Migrations are recorded and verified in each environment.
- Deployment fails safely when required schema is missing.

### B4 — Component-aware editing

Findings: DATA-001
Priority: P1

Work:

- [ ] Make components the canonical editable structure.
- [ ] Remove the editor's forced `Main` reconstruction.
- [ ] Preserve component order and ingredient/step associations.
- [ ] Migrate or normalize legacy flat recipes safely.

Acceptance criteria:

- Editing a sauce/main/topping recipe preserves all three components.
- Grocery generation, Cook Mode, export, and scaling use the edited component structure.
- Version restore preserves exact structure.

### B5 — Derived-data lifecycle

Findings: DATA-002
Priority: P1

Work:

- [ ] Add calculation status, source/model/data version, and calculated timestamp.
- [ ] Invalidate nutrition/cost/tags/time caches when dependent fields change.
- [ ] Add explicit nutrition/cost recalculation.
- [ ] Label estimates in the UI.
- [ ] Evaluate deterministic nutrition data and a Guam-specific price catalog.

Acceptance criteria:

- Editing ingredients or servings cannot silently preserve an apparently current calculation.
- Restore/re-extract/edit paths recalculate or visibly mark derived fields stale.
- Tests cover scaling and grocery propagation.

### B6 — Media limits, credential hygiene, lifecycle, and cache correctness

Findings: MEDIA-001, SEC-001, STORAGE-001, DATA-003
Priority: P1

Work:

- [ ] Add video duration/download/audio-size/concurrency limits.
- [ ] Terminate timed-out subprocesses and clean temporary directories in `finally`.
- [x] Replace the shared `/tmp/instagram_cookies.txt` credential path with a unique restrictive temporary file and guaranteed `finally` deletion.
- [x] Validate all image upload bytes, types, and dimensions.
- [x] Use versioned/content-addressed recipe image keys.
- [ ] Use signed delivery for private recipe images.
- [x] Delete recipe media on recipe deletion through durable cleanup.
- [x] Make account deletion idempotent and durable: commit authoritative local deletion, persist external-cleanup state, and retry S3/Clerk failures.
- [ ] Expose safe failed-cleanup reconciliation through the focused admin audit trail.

Acceptance criteria:

- Timeout tests leave no child process or temporary directory.
- Private recipe images cannot be fetched anonymously.
- Updating an image immediately changes its URL and displayed asset.
- Public thumbnails remain cacheable.
- A failure in one deletion step cannot produce an untracked partial account deletion, and retrying deletion is safe.

Chat image delivery remains unchanged under ADR-001.

## Release C: Observability, testing, accessibility, and governance

Goal: make quality measurable and future releases safe.

### C1 — Model evaluation and rollout system

Findings: AI-001, AI-003
Priority: P1

Work:

- [ ] Build a redacted golden dataset from real source categories and known failures.
- [ ] Define schema, completeness, hallucination, correction, latency, and cost metrics.
- [ ] Add offline evaluation runner and stored reports.
- [ ] Add shadow/canary rollout and rollback.
- [ ] Record prompt versions and schema versions.

Acceptance criteria:

- A model change cannot ship without a comparative report.
- Rollout can be limited by capability and percentage.
- Model regression, fallback, and cost alarms exist.

### C2 — Product and quality analytics

Findings: ANALYTICS-001
Priority: P1

Work:

- [ ] Implement the event taxonomy in `PRODUCT-AND-SYSTEM.md`.
- [ ] Add activation, success/failure, correction, Cook Mode, planner, grocery, and retention funnels.
- [ ] Add AI cost and quality dashboard.
- [ ] Add feature flags for model and UX rollout.
- [ ] Define analytics data minimization and retention.

Acceptance criteria:

- No recipe text, full source URLs, chat content, or notes enter analytics.
- Extraction reliability can be segmented by source, app version, and model.
- Product decisions can use activation and retention evidence.

### C3 — Structured logging and operational errors

Findings: OPS-002
Priority: P1

Work:

- [ ] Replace `print` logging with structured levels and fields.
- [ ] Add request ID, user pseudonymous ID, job ID, route, error code, and model capability.
- [ ] Redact URLs, tokens, cookies, emails, and provider content.
- [ ] Return stable user-safe error codes/messages.
- [ ] Keep provider detail in restricted logs/Sentry only.

Acceptance criteria:

- Logs support tracing one extraction without exposing recipe content.
- Provider errors are not returned verbatim to users.
- Alerts group failures by stable error code.

### C4 — Health, dependency diagnostics, and recovery

Findings: OPS-001, DR-001
Priority: P1

Work:

- [ ] Add boot-only `/up` and configure Render to use it.
- [ ] Move database/provider checks to a diagnostic endpoint.
- [ ] Restrict sensitive diagnostic detail.
- [ ] Document Neon and S3 backup/restore capabilities, ownership, retention, RPO, and RTO.
- [ ] Run a non-production database restore drill.

Acceptance criteria:

- Platform health checks do not query Neon.
- Dependency failure does not make liveness restart a healthy process.
- A documented restore drill succeeds.

### C5 — Risk-based automated tests

Findings: TEST-001
Priority: P1

API gates:

- [ ] public/owner DTO contracts;
- [ ] auth absent/invalid/forbidden distinctions;
- [ ] extraction start, recovery, retry, cancellation, and idempotency;
- [ ] recipe edit/restore/components/derived data;
- [ ] chat role and size validation;
- [ ] collection, save, meal-plan, and grocery authorization/concurrency;
- [ ] upload and website limits;
- [ ] migrations against a temporary PostgreSQL database.
- [x] Keep `scripts/check.sh` as the canonical monorepo gate and make CI run the
  same checks developers run locally.

Mobile gates:

- [ ] User A -> sign out -> User B cache isolation;
- [ ] import/share-intent to extraction;
- [ ] extraction background/foreground recovery;
- [ ] manual/OCR privacy default and publish preview;
- [ ] edit multi-component recipe;
- [ ] grocery offline reconciliation;
- [ ] Cook Mode timer cancellation/notification;
- [ ] universal/deep links.

Acceptance criteria:

- CI blocks on lint, typecheck, tests, Expo Doctor, build, and migration verification.
- A small physical-device release checklist covers iOS and Android.

### C6 — Accessibility foundation

Findings: ACCESS-001
Priority: P1

Work:

- [ ] Create accessible icon button, toggle, list row, card, modal, toast, and loading primitives.
- [ ] Add labels, roles, hints, selected/checked/disabled/loading states.
- [ ] Verify 44-point touch targets and focus order.
- [ ] Respect reduced motion.
- [ ] Verify text scaling without clipping.
- [ ] Test VoiceOver and TalkBack through the primary workflow.

Acceptance criteria:

- Capture -> review -> save -> grocery -> Cook Mode works with screen reader.
- Automated accessibility checks cover the marketing site.
- App Store accessibility declarations reflect verified support.

### C7 — Focused admin operations and UGC safety

Findings: UGC-001, ADMIN-001
Priority: P1 before social expansion

Work:

- [ ] Create a separate lightweight `admin/` web application; do not revive the legacy Next.js product or place moderation in the consumer mobile app.
- [ ] Add backend-enforced `/api/admin/*` authorization using Clerk admin metadata. A hidden route or client-side role check is not authorization.
- [ ] Add a compact dashboard for reports, stuck/failed jobs, and recent admin actions.
- [ ] Add recipe/contributor search with public/owner-safe previews.
- [ ] Add recipe/user reporting and contributor blocking.
- [ ] Add moderation state and an admin review queue.
- [ ] Add reversible hide/unhide and feature/unfeature actions with reasons.
- [ ] Add curated collection/featured-order controls for the intended meaning of “moving things around.”
- [ ] Add safe retry/cancel actions for stale or failed extraction jobs.
- [ ] Record an append-only audit event for every admin action, including actor, target, reason, timestamp, and a bounded before/after summary.
- [ ] Require confirmation for destructive actions; omit hard delete, arbitrary ownership changes, user impersonation, and a general database editor from the MVP.
- [ ] Add takedown and appeal/support workflow.
- [ ] Add terms covering public recipes and source attribution.
- [ ] Align website, in-app, App Store, and Play privacy/support URLs.
- [ ] Obtain appropriate legal/privacy review before publishing policy changes.

Acceptance criteria:

- A signed-in user can report content and block a contributor.
- Moderators can remove content without deleting evidence/audit history.
- Every privileged action is denied by the API for a non-admin and appears in the audit history for an admin.
- Routine moderation and stuck-job recovery do not require database access.
- Public policy accurately describes processors, public content, retention, deletion, and AI use.

### C8 — Documentation and version governance

Findings: GOV-001
Priority: P1

Work:

- [ ] Treat `docs/README.md` as the cross-system index.
- [ ] Mark old migration/roadmap documents historical.
- [ ] Use one app-version source and release process.
- [ ] Keep the mobile changelog current.
- [ ] Maintain model and risk decisions through ADRs.
- [x] Keep active cross-system documentation in the canonical monorepo; treat standalone-repository copies as historical.

Acceptance criteria:

- A new contributor can identify the active product, architecture, plan, and release state without consulting stale documents.
- Source, App Store/Play, changelog, and release version agree.

## Release D: Product clarity and growth

Goal: improve activation, differentiation, and household value after safety and measurement exist.

### D1 — Recipe Inbox and field-level review

- [ ] Add pending-review imports.
- [ ] Highlight uncertain quantities, servings, times, and steps.
- [ ] Capture corrections as quality feedback without storing private content in analytics.
- [ ] Require review before publishing low-confidence recipes.

### D2 — Navigation simplification

- [ ] Prototype Home, Recipes, Plan, and Shop structure.
- [ ] Keep capture prominent through primary action and share intent.
- [ ] Move Discover inside Recipes and Settings under profile.
- [ ] Validate with current users before a full navigation migration.

### D3 — HTTPS public recipe pages and universal links

- [ ] Add public recipe web DTO consumption.
- [ ] Render Recipe JSON-LD and source attribution.
- [ ] Add Apple Universal Links and Android App Links.
- [ ] Support recipe, grocery invite, and contributor routes.
- [ ] Provide useful web fallback and App Store/Play handoff.

### D4 — Household cookbook and grocery improvements

- [ ] Define family/household roles and shared cookbook behavior.
- [ ] Normalize and merge duplicate grocery ingredients.
- [ ] Add aisle/store-section organization and manual overrides.
- [ ] Preserve clear authorship and private/public boundaries.

### D5 — Performance work triggered by measurement

Findings: PERF-001

- [ ] Add p50/p95 timing and query metrics for Discover/search/similar/tags.
- [ ] Replace in-memory similarity scoring when thresholds are exceeded.
- [ ] Add appropriate PostgreSQL search indexes or a derived search representation.
- [ ] Replace broad random ordering with a scalable selection strategy.

Trigger examples:

- p95 endpoint latency exceeds the product target;
- public library size or database load makes broad scans material;
- memory/CPU observations show application-side scoring is costly.

## Release E: Monetization experiments

Do not begin until extraction reliability, per-success cost, activation, and retention are measurable.

Potential structure:

- free monthly extraction allowance;
- paid higher limits or batch imports;
- family/household plan;
- advanced OCR or planning features;
- clear usage visibility and graceful limit handling.

Do not put core access to a user's existing recipe library behind an extraction-usage paywall.

## Explicitly deferred or excluded

- Private/signed chat-image delivery: deferred under ADR-001.
- Dedicated staging application/environment: intentionally excluded under ADR-002; safe non-production data and explicit configuration are still required.
- Broad follows/comments/ratings/activity feed: deferred until UGC safety exists.
- RAG for individual recipe chat: no current need.
- Web search in chat: deferred until citations, safety, and cost controls exist.
- ElevenLabs/imgix: require measured quality or performance need.
- Photo calorie counting as a precise feature: too uncertain without strong UX disclaimers and evaluation.
- Full codebase rewrite: not recommended.

## Release checklist template

Every release implementing this roadmap should record:

- [ ] Findings/tasks addressed
- [ ] Code and migration changes
- [ ] Automated verification
- [ ] Manual iOS/Android flows
- [ ] Privacy/security impact
- [ ] Model/cost impact
- [ ] Deployment order
- [ ] Rollback procedure
- [ ] Production observation window
- [ ] Documentation/changelog update
