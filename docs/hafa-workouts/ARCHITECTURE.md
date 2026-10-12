# Håfa API architecture and compatible rollout

Build a modular shared backend for Recipes and Workouts. Shared infrastructure is appropriate where responsibilities actually overlap; it must not grant cross-product health access or require all Shimizu applications to migrate.

## Verified baseline and naming

The starting API is FastAPI/SQLAlchemy/PostgreSQL, deployed on Render from HafaRecipes main. Recipes mobile, website and admin have independent release mechanisms. GitHub and live API were verified at `37e64e2886506cc40d65d45657c630b43c0f97d4` on October 10. The public US Recipes listing reports 2.6.4 while main declares 2.6.11/build 88. Record exact distributed artifacts and supported historical clients before compatibility execution; source versions alone are insufficient.

Backend code and Python distribution name: Håfa API (`hafa-api`). Proposed repository name once it owns both products: `hafa-platform`. Domain registration and availability are not yet established. Preserve `https://recipe-api-x5na.onrender.com` and old recipe routes as long as supported clients require them. A custom Håfa API domain can be an additional address. Do not disable the Render hostname or change Recipes bundle ID, EAS project, OAuth scheme or issuer merely to rename the backend.

Keep existing deploy paths initially:

```text
api/                         shared API deployment
  app/platform/              identity/grants, provider interfaces, job/storage utilities
  app/domains/workouts/      workout rules, records, program/session actions
  app/routers/               compatibility surfaces and existing Recipes routes
mobile/                      existing Recipes app
web/                         existing Recipes marketing site
admin/                       bounded product-aware operator tools
workouts-mobile/             new Expo/React Native app and native health adapters
workouts-web/                marketing/support and bounded share landing pages
```

This is a proposed structure, not a bulk file-moving change. Move existing Recipes responsibilities only when their interfaces and tests prove safe; compatibility imports can remain. A later cosmetic directory migration must verify actual Render/Netlify/EAS bindings. Workout app identifiers/project/store records are new and must be provisioned explicitly, not copied from Recipes.

## Shared and domain responsibilities

| Shared foundation | Recipes domain | Workouts domain |
| --- | --- | --- |
| Stable identity and explicit product enrollment | Existing recipe ownership/data rules | Profile, measurements, goals and temporary feedback |
| Authentication verification and scoped grants | Ingredients, meal plans, pantry and groceries | Exercises, workout versions, programs, calendar and sessions |
| Provider clients and privacy-bounded accounting | Recipe extraction/enrichment/chat prompts | Workout extraction, bounded programming and coaching |
| Job lease/idempotency/storage primitives | Existing extraction/cover/cleanup adapters | Workout import/program/health cleanup adapters |
| Support audit, feature controls and diagnostics | Recipes API compatibility projections | Workouts versioned APIs and health/share projections |

Add Workouts routes under `/api/v1/workouts/*`. Keep existing recipe methods, schemas, enums, response semantics and route paths. Version or negotiate new client behavior where additions could break strict old clients. Shared basic account metadata does not authorize reading either product's private records.

## Identity, connections and deletion

Keep existing stable AppUser ownership and issuer-scoped identity mapping. Add explicit product enrollment and connection grants; every endpoint independently authorizes user, product and resource. Shared Clerk configuration must verify native OAuth redirects, Apple app grouping/relay recovery, allowed parties and session behavior on both apps. Do not unify identities by unverified email or rewrite ownership as part of branding.

Connection grants record owner, source/destination product, data category, allowed use, consent version/time, status and revocation. Health read, upload, AI use and write-back choices are independent of Recipes connections. Use safe projections; do not pass complete account objects to the coach. Tag derived summaries with supporting grant/profile versions so revocation removes eligibility and triggers retained-context cleanup.

**D02's account policy is approved; technical acceptance remains a production enrollment gate.** The legacy Recipes `DELETE /api/users/me` currently erases application identity and queues deletion of Clerk aliases. Silently converting it into partial deletion would change its contract and risk leaving requested account data behind.

Approved behavior: separate “Delete my Recipes data,” “Delete my Workouts data,” and “Delete my Håfa account,” with exact affected data shown. Whole-account deletion covers both products and all provider aliases/media/derived context. Preserve the legacy endpoint's whole-account operation, extend cleanup to Workouts, and explicitly explain its expanded scope before Workouts enrollment and in modern deletion screens. Enrollment consent must be recorded before a Workouts dataset is created for an existing Recipes account. The user can decline enrollment; Recipes remains usable. Verify the exact disclosure, provider aliases, data cleanup and old-client results before activation. This approves the policy, not deletion of any real production account during development.

Deletion and late writes use domain-specific fences/leases. New memberships, imports, AI summaries and health sync cannot recreate deleted data. Cleanup should attempt independent external targets, retry safely and report failures. Deleting Håfa's copy does not claim deletion of health records owned by another app.

Per-product removal retains the shared login and the other product's records. It revokes affected connections, clears product-derived context/caches, and fences pending work by product enrollment generation. Re-enrollment or renewed health import requires an explicit new action; replayed jobs/outbox commands from the previous generation cannot restore removed records.

## Data model and rules

Create Workouts-owned tables/schema without renaming existing Recipes tables. Use explicit foreign keys, owner scope, indexes and uniqueness rather than check-then-insert deduplication. Database role/schema boundaries complement application authorization; they are not claimed as complete isolation inside one process.

Suggested record families:

- Profiles/goals, equipment locations/items, measurement observations, temporary readiness and consent grants.
- Sources/import jobs, evidence segments, catalog exercises/variations and reviewed substitutions.
- Workouts, immutable workout versions, ordered blocks/exercises and structured prescription fields.
- Programs/program versions, scheduling constraints and date-specific session prescriptions.
- Training sessions, actual set/interval records, substitutions and traceable corrections.
- External activity observations, sync cursors/receipts, origin identifiers, possible-duplicate relationships and export receipts.
- Conversations, action proposals, tool execution receipts and bounded derived memory with provenance.
- Shares/access grants and per-product entitlement/usage records.

Source extraction, personal prescription and actual result are separate. Missing prescription values use nullable typed fields with evidence/verification state; zero is not “unknown.” Units have canonical storage plus explicit display units. Store UTC instants and relevant local dates/timezone; schedule edits must define which future dates change.

Completed sessions retain snapshots needed to interpret historical results when source workouts/catalog entries are edited, removed or archived. Program revisions identify effective future scope, reason and author. Server-side revisions/idempotency prevent duplicate logs and lost updates; concurrent session edits expose a conflict rather than silently overwriting.

## Jobs, media and AI

Reuse job mechanics through adapters, not by forcing workout targets into recipe foreign keys. Existing Recipes extraction jobs and workers remain functional while Workouts jobs are introduced. Define one intentional execution owner per job queue/type, fair scheduling, global media budgets and per-product/user quotas. Multiple replicas require database-backed leases and cross-replica resource coordination; a Python semaphore alone is not a fleet limit.

Persist accepted requests before processing. Retries are bounded, classified and fenced; provider completion cannot produce duplicate workouts or resurrect cancellation/deletion. Maintain recoverable terminal states. Polling pauses when hidden, avoids overlap and stops at terminal outcomes. Cleanup covers temporary downloads and unreferenced private assets.

Prefer direct signed uploads when practical, with server authorization, byte/type limits and processing validation. Treat arbitrary URL fetching as hostile: validate destinations and redirect chains, reject internal/private networks, limit duration/size/concurrency and redact URL/provider secrets. Captions and visual frames complement transcription; sampled video evidence cannot guarantee recognizing every movement in arbitrary footage.

Generalize current provider accounting with product/capability/context metadata while maintaining Recipes compatibility. Separate model/prompt/schema versions, evaluations, cost budgets and capability kill switches. No claim that Recipes extraction evaluations validate workout identification or program safety.

The coach assembles a minimal authorized context from current profile, relevant plan/results and eligible source evidence. Imported text is untrusted. Tool calls use the same domain validations as ordinary UI commands. Proposal versions, context versions, idempotency receipts and explicit scope prevent a stale chat action from overwriting a later plan. No numeric exercise prescription policy is considered reviewed merely because JSON validates.

## Native health integrations

Integrate through supported on-device APIs in native builds; Expo Go/web mocks do not establish acceptance. Choose maintained native adapters after checking current SDK/build compatibility and provider policy. Verify minimum OS/device support, required capabilities/usage descriptions and Play declarations before committing to a package.

Request only types required by a concrete feature. Initial candidates: completed workouts, summary duration/distance, optional weight and narrowly justified sleep/heart-rate summaries. GPS routes, medical records and broad biometric access are not needed for the confirmed core journey. Use incremental synchronization, platform IDs/origins, safe cursors and ownership-scoped deduplication. Håfa-authored write-back references the canonical session ID and cannot be reimported as a second workout; similar third-party events may require a possible-duplicate choice rather than blind merging.

Write only actual completed/partial activity accurately represented by the platform, when separately allowed. Do not fabricate calories, measured pulse or completed exercise from a plan. Corrections/write deletion are limited to Håfa-owned records. Separate platform consent from cloud storage and eligible third-party AI use. Default context uses no external health data until the corresponding choices and policy are satisfied.

HealthKit does not reliably reveal read denial: missing samples must not be presented as definite permission denial or no training. [Apple authorization](https://developer.apple.com/documentation/healthkit/hkauthorizationstatus). Health Connect requires declared data types and may require distinct historical/background permissions; use capability-aware foreground refresh with honest sync limits. [Android data types](https://developer.android.com/health-and-fitness/health-connect/data-types), [reading data](https://developer.android.com/health-and-fitness/health-connect/read-data).

Retain origin/policy provenance for indirectly received samples; do not use HealthKit/Health Connect as a way to bypass upstream API/AI restrictions. Keep restricted/unknown eligibility out of model context until reviewed. [Strava policy](https://www.strava.com/legal/api_policy). Use private transport/storage, no health data in advertising/event logs, explicit AI consent and revoke/export/erase paths. [Apple privacy requirements](https://developer.apple.com/app-store/review/guidelines/).

## Offline behavior

Use an account-scoped durable local store for session state and an outbox for edits. Separate drafts, pending writes and server-confirmed results. Client-generated command IDs make replay safe. Cache only authorized data and erase it on sign-out/account switch as appropriate; one user's health/session data never appears for another. Permissions/revocation changes invalidate stored context. Define conflict handling for a session edited on two devices or locally after deletion.

Timers use persisted timestamps with foreground reconciliation and optional native notifications. Background execution availability is platform-dependent; do not imply a continuous server/local process. Restore an unfinished session after termination without inventing completion.

## Deployment and rollout

1. Inventory supported Recipes clients and actual artifacts, bindings, schema, auth and versioned contracts. Include current published 2.6.4, verified newer TestFlight artifacts if present, and supported older installations. Source-declared 2.6.11 is not evidence of distribution.
2. Implement additive migrations and compatibility adapters. Establish a restore point and validate migration/rollback against synthetic/disposable data. Old API code must tolerate the expanded schema and retain new records during rollback; test startup checks as well as routes.
3. Verify old Recipes journeys alongside new Workouts flows. Shared-account enrollment stays disabled until D02 and identity/recovery acceptance pass.
4. Measure concurrent recipe/workout import, cover processing, chat, logs and provider latency under realistic memory limits. Compare current service, larger shared service and separate worker/service costs. Preserve fairness and availability before right-sizing.
5. Deploy the backward-compatible backend on the chosen safe topology with Workouts capabilities controlled. Perform controlled smoke checks and watch latency/errors/jobs/resource use. Do not use real customer workloads as synthetic load fixtures.
6. Release Workouts through native testing and store approvals; public free-beta access follows verified availability. API behavior remains compatible throughout review and release lag. Recipes cross-app UI releases independently when needed.
7. Observe representative production use for 24–48 hours before infrastructure downgrades. Keep legacy endpoints/issuers until an explicit supported-client policy and evidence permit retirement; zero recent usage alone may miss infrequent or older-OS users.

Rollback must distinguish code, configuration, schema and user data. A backup restore can lose post-deploy writes and is not the ordinary rollback method. Feature/capability controls and a known compatible code release should recover service while preserving new data. Exact rollout and stop thresholds are established before production deployment, with `/up` remaining database-free and deeper diagnostics protected.

The full Workouts stack may not be initialized merely by importing its modules into the shared API. With Workouts disabled, its jobs/providers and domain-specific readiness checks must remain inactive; missing optional Workouts configuration must not prevent Recipes from booting. Shared identity/schema prerequisites are separately migrated and verified before any code depends on them. CI and exact rollback tests establish compatibility; feature flags alone do not prevent a bad shared migration or process-wide failure.


## Integrated naming boundary

The service now identifies as Håfa API in OpenAPI and Python distribution metadata. Legacy root-response fields, `app` imports, `/api/*` Recipes surfaces, deployment directory and original Render hostname stay compatible. Render/Neon/GitHub display or repository renames and any added domain require verified provider bindings; they are not prerequisites for the shared architecture and are not performed by the metadata change. Existing App Store Recipes binaries need no forced update to continue using those compatibility surfaces.
