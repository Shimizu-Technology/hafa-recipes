# Håfa Recipes architecture and migration program

Status: approved direction, executing in gated phases

Last updated: 2026-08-17

## Purpose

This document is the operating agreement for two related changes:

1. make one repository the canonical source for the API, mobile app, and public
   website; and
2. move authentication from Clerk's development instance to a production Clerk
   instance without separating people from their recipes or other owned data.

These changes affect a live App Store product. Repository convenience is useful,
but continuity of identity and user data is the higher-order requirement.

## Product intent

Cooking inspiration is often trapped in a video, a long recipe page, a photo, or
a family recipe card. Håfa Recipes converts that source into a structured,
searchable, cookable recipe. The product keeps the original context while adding
ingredients, steps, timing, nutrition, costs, organization, planning, grocery
lists, timers, and AI assistance.

The system has three independently deployable surfaces:

- `mobile/` is the customer product distributed through EAS and the App Store;
- `api/` authenticates requests, runs extraction, and owns business and data
  access rules; and
- `web/` is the public marketing, privacy, and support site on Netlify.

Neon PostgreSQL stores recipes and user-owned records. S3 stores durable media.
Clerk authenticates people. AI and media services transform source material.

## Non-negotiable invariants

- A repository migration does not change application behavior or production
  data.
- An authentication migration does not bulk-rewrite ownership rows.
- The same person may use an old development-key build and a new production-key
  build at the same time and see the same data.
- Rollback changes provider configuration and accepted issuers; it does not
  reverse a destructive data rewrite.
- Every automated backfill or provisioner is dry-run by default, idempotent,
  auditable, and stops on ambiguous identity matches.
- Development and production Clerk credentials are issuer-scoped. A production
  subject must never match an unscoped legacy subject accidentally.
- Provider secrets and user exports never enter Git.

## Phase A: history-preserving monorepo

### Target

`Shimizu-Technology/hafa-recipes` becomes the canonical repository with
`api/`, `mobile/`, and `web/` at the root. Each application retains its own
manifest, lockfile, environment template, test gate, and deployment lifecycle.

### Why one repository

- Authentication contracts can change atomically across API and mobile.
- One PR can show cross-application impact and one CI run can verify it.
- Deployment paths, runbooks, and ownership rules have one source of truth.
- Product work no longer depends on coordinating drifting branches in separate
  repositories.
- Independent directories preserve focused builds and avoid unnecessary
  monorepo framework complexity.

### Migration mechanics

The standalone default branches are filtered under their destination paths and
merged with their full graphs. The original repositories receive a dated tag;
the filtered tips receive component-specific tags in the monorepo. Old repos
remain available as read-only rollback archives after cutover.

The old Clerk bridge branches are not imported because they are intentionally
superseded. Their PRs remain historical evidence until they are closed with a
link to the replacement design.

### Gate before provider changes

- Repository-wide CI is green.
- API tests and lint, mobile type-check and Expo Doctor, and web lint/build pass.
- API, Expo, and website start from the monorepo.
- API health/docs and representative mobile and website flows are exercised.
- Greptile explicitly reports 5/5 on the current PR head with no unresolved
  actionable threads.
- The PR is merged with a merge commit so imported graphs remain reachable.

### Provider cutover

After merge, and not before:

1. update Render's repository to `Shimizu-Technology/hafa-recipes`, branch
   `main`, root directory `api`;
2. update Netlify's repository to the monorepo, branch `main`, base directory
   `web` or allow the root `netlify.toml` to provide it;
3. confirm EAS project `97e94fdf-ea37-44c2-82ea-ede6ab0b06b7` is linked to the
   local `mobile/` project and record the canonical repository in Expo project
   metadata if the dashboard exposes it;
4. deploy unchanged code and compare health, website routes/headers, and mobile
   API connectivity with the pre-cutover baseline; and
5. only then archive the standalone repositories and mark this repo canonical.

Render and Netlify rollback is to restore the old repository and root settings.
The App Store binary is unaffected by a Git repository move.

## Phase B: production stabilization before identity cutover

Before adding identity tables, establish and record a Neon restore point and
confirm that production is the intended database. Apply outstanding schema
migration 015 from the Render environment and verify `extraction_jobs.user_id`
exists. A successful TCP connection alone is not application readiness; health
checks must verify required schema.

Render must run with `ENVIRONMENT=production`, an explicit production CORS
allowlist, and `ENABLE_SENTRY_DEBUG=false`. SQL query echo and public diagnostic
routes must not be enabled in production. Run a canary extraction after the
schema and runtime configuration are corrected.

## Phase C: replace Clerk subjects with stable application identity

### Why the previous bridge is being superseded

The previous API/mobile PRs safely verified issuers and emails, but their core
operation moved every ownership column from the old Clerk subject to the new
Clerk subject. That creates a split-brain period: after migration, an older
development-key build still authenticates as the old subject and sees an empty
account. Accepting both issuers does not repair that. A rollback would also need
another risky ownership rewrite.

The replacement follows the CSG Learning Platform pattern: business data belongs
to a stable local application user; Clerk identities are aliases that may change
without changing ownership.

### Data model

The migration introduces:

```text
app_users
  id                  stable application user ID
  created_at
  updated_at

clerk_identities
  id
  app_user_id         -> app_users.id
  issuer              exact normalized Clerk issuer
  clerk_user_id       subject within that issuer
  email_hash          optional lookup/audit value; never plaintext migration CSV
  created_at
  last_authenticated_at

unique (issuer, clerk_user_id)
unique (app_user_id, issuer)
```

For an existing user, the legacy development Clerk subject becomes the initial
stable `app_users.id`. Existing `user_id` ownership values therefore remain
correct and are not rewritten. Authentication resolves `(issuer, subject)` to
`app_user_id`; business queries use only that stable ID. Clerk API operations
receive the actual issuer and subject explicitly.

An unknown development identity may be adopted lazily during the bridge window:
create `app_users.id = subject` and its development identity in one transaction.
An unknown production identity is never adopted by subject alone; it must match a
pre-provisioned `external_id`, a verified migration record, or a strict recovery
flow.

### Backfill and provisioning

1. Build the stable-user set from distinct owners across every user-owned table
   and reconcile it with the development Clerk user export/API.
2. Dry-run the identity backfill. Report missing, duplicate, and conflicting
   records without writing.
3. Apply the backfill transactionally and rerun it to prove idempotence.
4. Configure the production Clerk instance, custom domain/native settings,
   Apple and Google credentials, redirect allowlists, and email delivery.
5. Dry-run production provisioning for active users. Create a production Clerk
   shell with verified primary email and `external_id = app_users.id` only when
   exact conflict checks pass.
6. Apply provisioning and create the production identity alias. Never delete a
   Clerk user or application row to resolve a conflict.

Apple private-relay addresses and provider-specific emails require explicit test
fixtures. Email is identity evidence, not the permanent ownership key.

### Dual-issuer authentication

The API accepts an explicit allowlist containing development and production
issuers. Each issuer has its own JWKS, Backend API secret, audience, and
authorized-party configuration. Signature verification, issuer validation,
audience/party validation, and identity resolution all complete before a route
receives an `app_user_id`.

Production becomes the primary issuer only after the production-key mobile build
is released. Both issuers remain accepted until legacy mobile traffic is zero for
the agreed observation window. Identity rows are retained after retirement for
audit and safe rollback.

### Near-invisible mobile transition

The preferred rollout uses two releases:

1. A development-key bridge release authenticates the current session, ensures
   the stable identity/prod shell exists, requests a short-lived one-time Clerk
   production sign-in ticket from the API, and stores it in Expo SecureStore.
2. The later production-key release consumes that ticket with Clerk's ticket
   strategy, activates the production session, and immediately deletes the local
   ticket.

Tickets must never appear in logs or analytics, must be short lived, single use,
bound to the intended user, and covered by replay/expiry tests. App upgrades must
be verified to preserve SecureStore on physical devices.

Users who skip the bridge release sign in once through Apple, Google, or email.
Strict verified matching attaches the production identity to the existing stable
user, so their recipes and related data remain unchanged.

### Session policy

Production Clerk session settings, not production keys alone, control the weekly
sign-out. For this low-risk consumer app, the target is no inactivity timeout and
a 365-day maximum session lifetime, subject to Clerk plan support. A 30-day
maximum is the conservative fallback. Manual sign-out, account deletion, token
revocation, device changes, and security events still end a session; “never sign
out” is therefore not promised literally.

## Release and verification gates

Each implementation phase uses its own PR when it can be deployed or rolled back
independently. Every PR requires complete local checks, runtime/UI verification,
green required checks, and a current-head Greptile 5/5 before merge.

Identity migration acceptance includes:

- PostgreSQL integration tests exercising real constraints and transactions;
- two issuers resolving to one stable user without ownership changes;
- concurrent first-auth and provisioning tests;
- ambiguous email, changed email, Apple relay, duplicate external ID, missing
  user, expired ticket, reused ticket, and partial-failure cases;
- an old development-key build and a new production-key build used concurrently
  on the same account and on separate physical devices;
- account deletion and admin behavior using explicit Clerk identity context;
- database counts/checksums before and after showing no lost ownership; and
- provider rollback rehearsal while both issuers are enabled.

## Production rollout order

1. Monorepo import and local/runtime validation.
2. Greptile-approved monorepo PR, merge commit, Render/Netlify/EAS source update.
3. Production runtime/schema stabilization and canary extraction.
4. Stable identity tables, resolver, dry-run tooling, and integration tests.
5. Production Clerk configuration and dry-run/apply provisioning.
6. Development-key bridge mobile release and observation period.
7. TestFlight production-key validation on physical devices.
8. Production becomes primary; production-key App Store release is submitted.
9. Both issuers remain enabled while adoption and errors are monitored.
10. Development issuer is retired only after the defined legacy-traffic cutoff;
    aliases and backups remain.

## Rollback principles

- Repository: restore the previous provider repository/root settings.
- API deployment: redeploy the previous known-good monorepo commit.
- Clerk primary: switch the primary issuer back while both remain accepted.
- Mobile: keep the last approved App Store version available; do not delete
  identities or rewrite ownership to simulate rollback.
- Database: stop on conflict, restore only from a pre-migration point after an
  evidence-backed incident decision, and never improvise destructive cleanup.

The migration is complete only when production services use the monorepo,
production Clerk sessions preserve existing data, the new iOS build is approved,
monitoring is clean through the observation window, and the final state and
legacy-retirement criteria are recorded.
