# Håfa Recipes Full System Audit

Audit date: 2026-08-18
Audit type: source, build, dependency, public-interface, product, and implementation-baseline review
Scope: canonical monorepo mobile app, API, database model/migrations, storage integration, AI integrations, marketing site, documentation boundaries, and public production response shape

## Executive conclusion

Håfa Recipes is a real production product with a strong capture-to-cook workflow. Its primary weakness is not missing functionality. It is that privacy boundaries, durable background execution, AI model operations, test coverage, and product governance have not caught up with the breadth of shipped features.

The correct strategy is to stabilize and instrument the existing product before adding broad social or AI functionality.

## Audit method and confidence

### Reviewed

- Product history, README files, migration plan, changelog, previous roadmap, and Brain Dump project notes.
- Active API routers, services, schemas, database models, authentication, storage, extraction, website parsing, video processing, and migrations.
- Active mobile navigation, authentication synchronization, API client, extraction polling, design system, settings, accessibility contracts, and large screens.
- Marketing-site structure, copy, lint, build, and dependency status.
- Official model lifecycle documentation current on the audit date.
- Public production API health and public recipe response shape.

### Not performed

- No authenticated production mutations.
- No production extraction or paid model calls.
- No changes to Render, Neon, Clerk, S3 policies, App Store Connect, Google Play, or provider dashboards.
- No destructive security testing.
- No two-account live reproduction of the query-cache issue; the faulty transition logic was verified directly in source.
- No inspection of private user content.

### Severity

- **P0**: address in the next production-safety release.
- **P1**: high-value reliability, correctness, or governance work immediately after P0.
- **P2**: important scale, maintainability, UX, or growth work.
- **Deferred**: risk explicitly accepted for now with a decision record and revisit trigger.

## Re-review corrections

The second review confirmed the original core findings and corrected the following model guidance:

- Gemini 2.0 Flash remains shut down and must be replaced.
- GPT-4o is now listed as deprecated by OpenAI and must also be migrated.
- GPT-4o mini TTS is now listed as deprecated, so it is **not** a recommended replacement for `tts-1`.
- `whisper-1` and `tts-1` remain available in the current catalog. They should be benchmarked and monitored, not changed solely because they are older.
- Google now lists Gemini 3.6 and 3.7 Flash. Model selection should compare current candidates using Håfa-specific evaluations rather than automatically using the newest alias.
- OpenAI's current GPT-5.6 family maps Terra to the earlier mini tier and Luna to the earlier nano tier. Both accept text and images and support structured outputs.
- For Håfa's bounded, high-volume extraction and chat tasks, GPT-5.6 Luna is the better first cost/quality baseline; GPT-5.6 Terra should be tested as an escalation path for cases where Luna fails a confidence or validation gate.
- Standard short-context pricing on the audit date is $0.20 input/$1.20 output per million tokens for Luna and $2.00 input/$12.00 output for Terra. Terra is therefore ten times Luna's token price, so it should not become the universal default without measured benefit.
- GPT-5.6 defaults to medium reasoning when effort is omitted. Existing latency-sensitive paths must set effort intentionally; Chat Completions function-tool paths require effective `none`, while reasoning with tools should use the Responses API.

## Implementation-baseline re-review

A third source and production-safe verification pass was completed before implementation began. It reconfirmed the P0 findings and added the following evidence:

- the production public recipe detail response still exposes a non-empty `raw_text` value and internal Clerk `user_id`;
- the production health response still queries and publicly reports database/environment state;
- the pending mobile Clerk-cutover branch still misses the normal `User A -> signed out -> User B` cache transition;
- the API and mobile Clerk-cutover branches had been pushed without open pull requests or review completion;
- the marketing site's direct React Router dependency currently has a high-severity advisory with a non-breaking fix available;
- the current Python lock set has no known vulnerability in `pip-audit`;
- Bandit found a fixed `/tmp/instagram_cookies.txt` credential file, documented as SEC-001 below;
- the original standalone repositories did not provide a canonical one-command
  gate; the canonical monorepo now provides `scripts/check.sh` for the complete
  local and CI verification path.

Official references:

- [Google Gemini deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations)
- [OpenAI current model catalog](https://developers.openai.com/api/docs/models/all)
- [OpenAI model selection guidance](https://developers.openai.com/api/docs/models)
- [OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI GPT-4o mini Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe)
- [OpenAI backward-compatibility guidance](https://developers.openai.com/api/reference/overview#backwards-compatibility)

## P0 findings

### AI-001: Retired and deprecated models remain hard-coded

Status: verified
Impact: extraction interruption, fallback cost/latency, unplanned behavior changes, misleading UI

Evidence:

- `api/app/services/llm_client.py` hard-coded `google/gemini-2.0-flash-001` for text and vision at the time of audit.
- `api/app/routers/chat.py` hard-coded `gpt-4o` for recipe and general chat at the time of audit.
- The mobile Extract and Settings screens advertise Gemini 2.0 and GPT-4o.
- Google shut Gemini 2.0 Flash down on 2026-06-01.
- OpenAI currently marks GPT-4o deprecated.

Required outcome:

- Environment-driven model registry by capability.
- Evaluated and pinned production models.
- Luna as the initial OpenAI baseline for routine structured extraction/vision and chat, with Terra evaluated as a quality escalation rather than a blanket default.
- Safe fallback and feature-flag rollout.
- Provider/model/prompt provenance and cost/latency capture.
- No model-version marketing in normal customer UI.

### PRIV-001: Public recipes expose internal and potentially private fields

Status: verified in source and production response shape
Impact: private-note/transcript exposure, identity leakage, unclear publishing boundary

Evidence:

- `RecipeResponse` includes `raw_text` and Clerk `user_id`.
- The public recipe detail endpoint returns `RecipeResponse` for public recipes.
- extraction notes are appended to the raw source text before persistence.
- The public list and contributor endpoints expose internal user IDs.
- A production-safe schema check confirmed a sampled public recipe returned a non-empty `raw_text` field and a user ID; the content was not inspected.

Required outcome:

- Separate public and owner response models.
- Remove raw transcripts, private extraction notes, Clerk IDs, internal errors, and debug metadata from public responses.
- Public profile IDs must be distinct from authentication-provider identifiers.
- Add regression tests that enumerate allowed public fields.

### PRIV-002: Manual and OCR family recipes default to public

Status: verified
Impact: accidental publishing of family or personal recipes

Evidence:

- extraction, manual creation, and OCR creation schemas default `is_public` to true.
- mobile Extract and Manual Recipe screens initialize public sharing as enabled.
- UI copy explains Discover visibility but does not provide a publishing preview or distinguish family-card sensitivity.

Required outcome:

- Manual and OCR recipes default private.
- Public publishing is a deliberate action with a preview.
- Existing owners receive a privacy-review prompt for previously published manual/OCR recipes.

### AUTH-001: Private mobile query data survives normal account transitions

Status: verified in source
Impact: possible stale cross-account data exposure on a shared device

Evidence:

- `mobile/app/_layout.tsx` cleared React Query only when both previous and current IDs were non-null and different at the time of audit.
- Normal `User A -> signed out -> User B` transitions pass through null and never satisfy the clear condition.

Required outcome:

- Cancel and remove private queries on every authentication-subject transition.
- Include user identity in private query keys.
- Add a two-account sign-out/sign-in regression test.

### JOB-001: Extraction jobs are not durably executed

Status: verified
Impact: permanently stuck jobs after deploys, restarts, crashes, or process termination

Evidence:

- API writes `processing` to PostgreSQL before scheduling FastAPI `BackgroundTasks`.
- Background tasks live only in the serving process.
- Existing `processing` jobs are returned indefinitely.
- Jobs lack leases, heartbeats, stale recovery, and a durable queue owner.

Required outcome:

- One durable execution owner.
- Persisted queued state, claim/lease, heartbeat, retry, and stale recovery.
- Idempotent job execution and explicit terminal states.
- Deploy/restart integration test.

### ENV-001: Development can silently use production

Status: verified and reproduced during local web launch
Impact: accidental production reads/writes, unsafe intern development, test contamination

Evidence:

- `mobile/lib/api.ts` used a local-host heuristic and could fall back to the production Render URL when local host detection failed at the time of audit.
- The local Expo launch logged that it could not detect a local address and was using production.

Required outcome:

- Explicit local/development and production API URLs through EAS profiles.
- Local services or a disposable non-production database for development; no continuously deployed staging application is required.
- Any preview build declares its backend target explicitly rather than relying on fallback behavior.
- Development fails closed instead of falling through to production.

### AI-002: Chat history accepts client-controlled roles and arbitrary remote images

Status: verified
Impact: system-message injection, unbounded model use, unauthorized image forwarding

Evidence:

- `ChatMessage.role` is an unrestricted string.
- Request history roles are copied directly into provider messages.
- Any HTTPS image URL in history is forwarded to OpenAI.
- Base64 chat images lack an endpoint-specific decoded size limit.

Required outcome:

- Restrict client history to user/assistant roles and reconstruct messages server-side.
- Authorize app-owned image references.
- Enforce message, history, decoded image, type, and dimension limits.
- Apply per-user and per-IP quotas.

### AI-003: Vision prompt encourages unsafe confidence

Status: verified
Impact: misleading doneness, measurement, allergen, nutrition, or food-safety advice

Evidence:

- The prompt asks the model to be confident, assess doneness from photos, and avoid saying that measurements cannot be read.
- General chat claims expertise in food safety, allergies, and dietary advice without explicit limitations.

Required outcome:

- Require honest uncertainty.
- Do not determine safe internal temperature or allergen safety solely from a photograph.
- Distinguish suggestions from safety-critical facts.
- Add adversarial safety cases to the chat evaluation set.

## P1 findings

### AUTH-002: Invalid optional authentication silently becomes guest access

Status: verified

`get_optional_user` returns `None` after any token-verification error. A request that supplied an invalid or expired token is therefore treated like a request with no credentials. This hides session failures and violates the signed-out versus invalid-session distinction.

Required outcome: no credentials returns guest; invalid credentials return `401`.

### API-001: No application-level rate limit or AI usage budget

Status: verified

There is no shared rate limiter, per-user AI allowance, concurrency budget, or monthly usage ledger across extraction, OCR, chat, tag, nutrition, and TTS endpoints.

Required outcome:

- per-IP abuse limits for public endpoints;
- per-user request and concurrency limits for authenticated AI work;
- usage ledger by capability/model;
- global spend alarms and kill switches;
- stable `429` responses with retry guidance.

### API-002: Expensive inputs have inconsistent bounds

Status: verified

URL fields, notes, chat messages/history, chat images, manual uploads, website HTML, video duration, audio size, and slideshow image bytes are inconsistently or not bounded.

Required outcome: centralized validation and request budgets before external work begins.

### DATA-001: Editing flattens multi-component recipes

Status: verified

Recipe edits rebuild `components` as a single component named `Main`. Sauce, filling, topping, dough, and other sections are lost.

Required outcome: one component-aware editor and canonical schema used end to end.

### DATA-002: Derived nutrition, cost, and time values become stale

Status: verified

Editing ingredients or servings preserves portions of previous nutrition and cost. Restoring the original recipe does not refresh every derived/cache field.

Required outcome:

- derived-data provenance and status;
- deterministic invalidation after canonical changes;
- recalculate nutrition/cost action;
- recalculation tests for edit, restore, re-extract, and scaling.

### DATA-003: Account deletion can leave a partially deleted account

Status: verified

The delete-account flow removes S3 objects before the database transaction commits, then deletes the Clerk identity only after local data is committed. A database failure can therefore remove media while retaining database rows, while a Clerk failure can leave an active identity whose local data has already been removed. The endpoint reports the latter but provides no durable retry state.

Required outcome: model deletion as an idempotent, auditable workflow with durable step state; commit the authoritative local deletion before best-effort external cleanup; retry failed S3 and Clerk cleanup; and give operators a safe reconciliation action.

### DB-001: Key uniqueness and idempotency rules are absent

Status: verified

Recipes, saved recipes, and recipe versions rely on application checks without all corresponding database constraints. Version numbers use `max + 1` without a unique `(recipe_id, version_number)` constraint.

Required outcome: canonical source keys, composite constraints, transactional allocation, and UPSERT/idempotency behavior.

### JOB-002: Mobile polling can overlap and ignores app visibility

Status: verified

Polling uses a fixed interval around an asynchronous request, has no in-flight guard, continues without AppState awareness, and does not handle every terminal state.

Required outcome: completion-scheduled polling, backoff, one request at a time, visibility awareness, and complete terminal-state handling.

### MEDIA-001: Video subprocesses and temporary files are not always cleaned up

Status: verified

The `yt-dlp` timeout path does not terminate/kill the process or remove its temporary directory. Video duration and downloaded media size are not constrained before transcription cost is incurred.

Required outcome: `finally` cleanup, child termination escalation, duration/size limits, and extraction concurrency controls.

### SEC-001: Instagram cookie credentials use a shared fixed temporary path

Status: verified by source review and Bandit

When raw Instagram cookies are configured, `video.py` writes them to `/tmp/instagram_cookies.txt`. A fixed shared filename can collide across requests/processes, can be targeted through filesystem-link behavior on a shared host, and is not guaranteed to be removed after use. The file contains authentication credentials.

Required outcome:

- create a unique restrictive temporary file through the operating-system tempfile API;
- close it before passing the path to `yt-dlp`;
- delete it in `finally` on success, failure, cancellation, and timeout;
- never log cookie content or the configured credential value;
- add cleanup and concurrent-request tests.

### STORAGE-001: Public and private recipe media need distinct delivery rules

Status: verified design risk

Storage produces direct S3 URLs. Public recipe thumbnails may intentionally be public, but private recipe media should not depend on the same policy.

Required outcome:

- public thumbnails use public versioned keys;
- private recipe media uses signed delivery;
- image updates use new keys to avoid stale caches;
- recipe deletion removes associated media.

Chat-image private delivery is explicitly deferred in ADR-001. That exception does not apply to private recipe images.

### UGC-001: Discover lacks user-generated-content safety controls

Status: verified

The product publishes user-created recipes and contributor identities but has no report-recipe, report-user, block-user, moderation queue, takedown state, or contributor safety workflow in the active source.

Required outcome before expanding social features:

- report recipe/user;
- block contributor;
- moderation/takedown status;
- admin review workflow and audit trail;
- terms and support process for abusive or infringing content.

### ADMIN-001: Operational and moderation actions lack a focused admin surface

Status: verified product/operations gap

The existing admin metadata supports privileged re-extraction, but there is no coherent operator interface for moderation, public-content curation, stale-job recovery, or reviewing the effect of an administrative action. Direct database changes would be difficult to audit and easy to misuse.

Required outcome:

- a small separate web admin portal rather than an admin mode in the consumer app;
- backend authorization on every `/api/admin/*` action;
- report queue, recipe/contributor lookup, reversible hide/restore, feature ordering, and safe extraction retry/cancel actions;
- an append-only audit record with actor, action, target, reason, before/after summary, and timestamp;
- no arbitrary database editor and no silent ownership reassignment or hard deletion in the MVP.

### OPS-001: Health checks mix liveness and database dependency checks

Status: verified

`/health` always performs `SELECT 1`, publicly reports environment/database state, and can keep Neon awake if used as the platform health path.

Required outcome: boot-only `/up`, separate dependency diagnostics, and Render configured to use liveness only.

### OPS-002: Logging is unstructured and can contain sensitive context

Status: verified

The API contains more than 200 `print` calls. Logs include URLs, user IDs, titles, provider failures, and operational details. Some raw exception text is persisted into job errors or returned to clients.

Required outcome: structured logging, request/job correlation, redaction, stable public error codes, and internal-only provider detail.

### TEST-001: Automated coverage does not match product risk

Status: verified

- API: 26 tests pass, concentrated on auth, SSRF/security, user migration, and account behavior.
- Missing API integration coverage includes extraction, recipe mutation, public DTOs, job recovery, chat validation, collections, grocery sharing, meal plans, and model schema behavior.
- Mobile has no active test command or meaningful product tests.
- CI allows Expo Doctor to fail.
- No active repository has a canonical one-command gate script combining its required checks.

Required outcome: risk-based unit, integration, contract, and device-flow gates defined in the roadmap.

### ACCESS-001: Custom mobile controls lack accessibility contracts

Status: verified by source scan

The active mobile app contains roughly 244 custom `Pressable`/`TouchableOpacity` usages and no explicit `accessibilityLabel`, `accessibilityRole`, `accessibilityState`, or `accessibilityHint` matches.

Required outcome: accessible component primitives and VoiceOver/TalkBack verification of the capture-to-cook journey.

### DEP-001: Dependency and toolchain maintenance is behind

Status: verified on 2026-08-18

- Mobile TypeScript passed.
- Expo Doctor passed 17/18 checks and reported two SDK patch mismatches.
- Mobile audit reported 49 moderate/high transitive advisories; many are build/toolchain dependencies and need exploitability triage.
- Marketing lint/build passed, but the installed Node 22.0 is below Vite's supported 22.12 minimum.
- Marketing audit reported six high-severity advisories with fixes available.
- Expo web failed at runtime with a `tslib`/Framer Motion error.

Required outcome: supported Node/toolchain versions, patched compatible dependencies, advisory triage, blocking health gates, and an explicit decision to support or remove the Expo web target.

Current implementation-baseline note: the marketing audit now reports two high-severity React Router advisories with a non-breaking fix available. The earlier count was a time-specific dependency snapshot, not a contradiction.

### GOV-001: Product and privacy documentation has drifted

Status: verified

- Root README and UI name retired models.
- Historical roadmaps list already-shipped features as future work.
- `package.json`, `app.json`, and the public store listing show different versions.
- App Store privacy points to an older Gist while the app points to the Håfa website.
- Current backlog and release status exist in several competing documents.

Required outcome: this documentation set becomes canonical, old plans are labeled historical, versioning has one source, and public privacy/support links converge.

### DR-001: Backup and recovery expectations are not documented

Status: not evidenced

No current project runbook defines database backup ownership, point-in-time recovery availability, object-storage recovery, recovery objectives, or a restore drill.

Required outcome: document Neon/S3 recovery capabilities, owners, retention, RPO/RTO expectations, and perform a non-production restore test.

## P2 findings

### PERF-001: Public search and similarity will degrade with growth

Status: verified design limitation

- Similar recipes loads all public candidates into application memory and scores them in Python.
- Random Discover uses database random ordering.
- Search casts nested JSONB structures to text for wildcard matching.
- Popular-tag calculation loads and counts broad result sets in Python.

These are acceptable at small scale but should be instrumented and replaced before the public library becomes large.

### UX-001: Six primary tabs dilute the product hierarchy

Status: verified

Extract, My Recipes, Discover, Planner, Grocery, and Settings all occupy the primary tab bar. Recommended direction: Home, Recipes, Plan, Shop, with capture as the primary action and Settings under profile.

### UX-002: Extraction needs a review inbox and field-level uncertainty

Status: product recommendation

The app has broad extraction support and general quality badges, but the safer workflow is a Recipe Inbox that highlights uncertain measurements, servings, and steps before publishing or cooking.

### GROWTH-001: Public recipe pages and universal links are missing

Status: verified

The app declares a custom scheme but no complete Apple Universal Link/Android App Link path. Public recipes and grocery invitations should have HTTPS pages that can open the app and provide useful fallback content.

### ANALYTICS-001: Product and AI quality funnels are not instrumented

Status: verified by dependency/source review

Sentry provides diagnostics, but there is no product analytics or model-quality funnel. The event policy in `PRODUCT-AND-SYSTEM.md` should be implemented before monetization experiments.

### MAINT-001: Large modules increase regression risk

Status: verified

Several API and mobile files exceed 1,000–2,000 lines. Refactoring should be incremental and driven by the safety roadmap, not a standalone rewrite.

## Deferred finding

### CHAT-IMG-001: Chat images remain retrievable by direct URL

Status: accepted and deferred by product owner
Decision: [ADR-001](./decisions/ADR-001-DEFER-PRIVATE-CHAT-IMAGES.md)

The code intentionally produces direct S3 URLs so the AI provider can retrieve chat images. Private signed delivery and provider-safe forwarding are deferred. Interim controls and revisit triggers are mandatory.

## Positive controls confirmed

The audit also found important strengths that should be preserved:

- SSRF defenses validate public hosts, addresses, DNS resolution, redirects, and outbound connections.
- Clerk JWT validation uses issuer/algorithm checks and supports production allowlisting.
- Recipe, collection, grocery, and meal-plan mutations generally scope records to the authenticated user or authorized list.
- Account deletion includes broad database cleanup and best-effort object cleanup.
- Production CORS is allowlisted rather than wildcarded.
- Grocery inputs have meaningful field limits.
- OCR has page-count and aggregate-size limits.
- External thumbnail downloads stream with a byte limit and content-type checks.
- Sentry debug behavior is disabled in production unless explicitly enabled.
- The marketing site has strong product copy and a coherent Håfa visual direction.
- Current API lint and test suite pass.

## Verification snapshot

| Check | Result on 2026-08-18 |
|---|---|
| API Ruff | Passed |
| API pytest | 26 passed, 9 Pydantic deprecation warnings |
| Mobile TypeScript | Passed |
| Expo Doctor | Failed 1/18 checks: two compatible patch mismatches |
| Expo web | Runtime failure in `tslib`/Framer Motion path |
| Marketing lint | Passed |
| Marketing build | Passed with unsupported Node-version warning |
| Marketing dependency audit | Failed: 6 high advisories |
| Mobile dependency audit | Failed: 49 moderate/high transitive advisories, triage required |
| Production API health | `200`, database connected during audit |
| Public recipe schema | Confirmed `raw_text` and internal `user_id` exposure |

## Final assessment

The earlier recommendations are legitimate. The additional review sharpened three implementation choices: a dedicated staging deployment is unnecessary if development cannot fall through to production; a narrowly scoped admin portal is justified before expanding Discover/social behavior; and GPT-5.6 Luna should be the initial OpenAI baseline, with Terra used only where evaluation demonstrates a worthwhile quality gain. The earlier TTS replacement suggestion also changed because the provider now marks that candidate deprecated.

Execution should follow `IMPROVEMENT-ROADMAP.md`. P0 work should be completed before broad product expansion.
