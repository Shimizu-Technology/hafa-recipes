# Clerk production migration runbook

Status: foundation/grant/bridge deployed; 35/35 production aliases provisioned;
iOS 2.4.0 bridge waiting for App Review; production-key cutover gated

Last updated: 2026-08-17

## Objective

Move Håfa Recipes from Clerk development to Clerk production without changing
the owner key on any recipe or related record. Old development-key builds and
new production-key builds must resolve to the same stable application user while
both versions remain in use.

This is not a direct Clerk instance transfer: Clerk documents that development
users cannot be migrated into production as the same Clerk records. We instead
provision corresponding production users and attach both issuer-scoped subjects
to one application-owned identity.

## Safety model

- Existing development Clerk subjects become `app_users.id` values.
- Migration 016 creates `app_users` and `clerk_identities`; it does not update an
  ownership column.
- A Clerk identity is unique by `(issuer, clerk_user_id)` and a stable user may
  have only one subject per issuer.
- Development subjects may be lazily adopted only as their identical stable ID.
- Unknown production subjects require the matching production Backend API to
  confirm a verified primary email and a pre-provisioned stable `external_id`.
- An `azp` claim is validated whenever present. Because valid Expo native tokens
  may omit `azp`, requiring the claim is a separate explicit policy switch for
  clients that guarantee it; a configured browser-only surface should enable it.
- Inventory and provisioning commands are dry-run by default, idempotent, and
  exit non-zero on missing, failed, or ambiguous records.
- Provisioning never deletes or merges Clerk users.
- Migration 017 stores only SHA-256 hashes of device-scoped migration grants.
  Redemption is row-locked, one-use, and produces a 60-second Clerk ticket.
- Account deletion attempts every issuer alias and keeps local identity/data
  intact for an idempotent retry unless every remote alias is confirmed deleted.

## Production prerequisites

- Confirm Render service `srv-d4l28evgi27c73es0ag0` points to the production
  Neon project `plain-butterfly-09099877`, branch
  `br-misty-voice-a1ymon2c`.
- Keep snapshot `snap-icy-queen-a1rr4j54`
  (`pre-clerk-foundation-2026-08-17`) until the observation window closes.
- Migration 015 must already be applied. Verify
  `extraction_jobs.user_id` and the three ownership indexes exist.
- Temporarily disable Render auto-deploy before merging the foundation PR so
  migration 016 can be applied before the new authentication code receives
  traffic.
- Record pre-change row counts grouped by every ownership column.

## Foundation deployment

Configure explicit development settings while keeping the existing instance
primary:

```text
CLERK_DEVELOPMENT_ISSUER
CLERK_DEVELOPMENT_SECRET_KEY
CLERK_DEVELOPMENT_JWKS_URL          optional; defaults from issuer
CLERK_DEVELOPMENT_AUDIENCE          optional; comma-separated
CLERK_DEVELOPMENT_AUTHORIZED_PARTIES optional; comma-separated
CLERK_DEVELOPMENT_REQUIRE_AUTHORIZED_PARTY optional; false for Expo native
CLERK_PRIMARY_ENVIRONMENT=development
```

The legacy `CLERK_FRONTEND_API`, `CLERK_SECRET_KEY`,
`CLERK_JWT_ISSUER`, and `CLERK_JWT_AUDIENCE` settings remain compatible during
this step. Remove them only after the explicit development configuration is
verified.

Run from a Render one-off job built from the reviewed commit:

```bash
python -m migrations.016_add_stable_clerk_identities
python -m app.clerk_transition audit-development
python -m app.clerk_transition audit-development --apply
python -m app.clerk_transition audit-development
```

The first and final audit must be clean. `--apply` repairs only a missing
development alias; it does not touch ownership data. Compare post-change owner
counts with the recorded baseline, deploy the API, restore auto-deploy, and test
an existing account before proceeding.

Production evidence on 2026-08-17:

- Render pre-deploy completed migration 016 with `app_users=35` and
  `development_identities=35`;
- the development inventory audit returned 35 `unchanged` and no conflict,
  missing, or failed result; and
- the API remained healthy after a credential-aware redeploy.

Migration-grant API evidence on 2026-08-17:

- Render ran migrations 016 and 017 in one pre-deploy command;
- migration 016 remained idempotent at 35 application users and 35 development
  identities;
- migration 017 reported the grant schema ready with zero existing grants;
- commit `8e3fe40` became live and `/health` reported a connected production
  database; and
- the live OpenAPI document exposed both handoff endpoints.

## Production Clerk setup

The production instance uses `https://clerk.hafa-recipes.com`. The dashboard
audit on 2026-08-17 confirmed:

- the primary domain and all five Netlify DNS records are **Verified**;
- Clerk reports the custom-domain SSL certificates as **Issued**;
- the Native API is enabled and the iOS application is registered with Apple
  team `4T358A5S74` and bundle ID
  `com.shimizutechnology.recipeextractor`;
- the allowlist contains both `hafarecipes://oauth-callback` and the legacy
  `com.shimizutechnology.recipeextractor://callback` redirect;
- production Backend API and publishable credentials exist only in provider
  secrets; and
- Render continues accepting both issuers with development primary.

The same audit identified these pre-cutover blockers:

- Google OAuth is disabled and has no production client ID/secret;
- Apple OAuth is disabled and has no Service ID/private key configuration;
- the Apple App ID does not yet have Sign in with Apple enabled, and no Håfa
  Recipes Service ID or dedicated Sign in with Apple key exists;
- no Android native application is registered in Clerk; register package
  `com.shimizutechnology.recipeextractor` with the SHA-256 fingerprint from the
  EAS production keystore;
- the required `recipe-extractor-public-metadata` template has not been
  confirmed in production and must emit
  `{ "public_metadata": "{{user.public_metadata}}" }` under that exact name;
- the Clerk application support email is blank; use the same
  `shimizutechnology@gmail.com` address published by the support/privacy pages;
  and
- the Hobby plan fixes maximum session lifetime at seven days. A 365-day
  lifetime requires a separately approved Clerk Pro purchase.

Do not enable a social provider until its production credential, redirect URI,
and one complete sign-in/sign-up test pass together. Do not reuse another
product's OAuth project or Apple primary App ID merely to avoid creating Håfa
Recipes-specific credentials.

Clerk requires at least one of maximum lifetime or inactivity timeout to remain
enabled, so a literal never-expiring session is not available. As of this
cutover, custom session duration requires a paid Clerk plan; purchasing or
upgrading the plan is a separate owner approval and is not implicit in this
runbook.

Add the production API settings to Render without changing the primary:

```text
CLERK_PRODUCTION_ISSUER
CLERK_PRODUCTION_SECRET_KEY
CLERK_PRODUCTION_JWKS_URL           optional; defaults from issuer
CLERK_PRODUCTION_AUDIENCE           optional; comma-separated
CLERK_PRODUCTION_AUTHORIZED_PARTIES optional; comma-separated
CLERK_PRODUCTION_REQUIRE_AUTHORIZED_PARTY optional; false for Expo native
CLERK_PRIMARY_ENVIRONMENT=development
```

## Production provisioning

Run and review the dry-run before applying:

```bash
python -m app.clerk_transition provision-production
python -m app.clerk_transition provision-production --apply
python -m app.clerk_transition provision-production
```

For each stable user the provisioner requires one verified development primary
email. It matches production users by stable external ID or exact normalized
email, rejects multiple candidates, rejects a different external ID, creates a
production shell only when no candidate exists, sets `external_id` to the stable
ID, and attaches the production alias only after Clerk confirms the result.

Stop the rollout on any `missing`, `conflict`, or `failed` result. Investigate
the source record; do not delete a user or edit an ownership value to make the
run green.

Production evidence on 2026-08-17:

- the first dry-run returned 35 `would_create`;
- apply returned 35 `created`; and
- the final dry-run returned 35 `unchanged`, with no conflict, missing, or
  failed result.

## Client transition

The low-friction path uses two releases and two different credentials:

Deploy migration 017 before either client calls the handoff endpoints:

```bash
python -m migrations.017_add_clerk_migration_grants
```

1. A development-key bridge release creates a random per-installation ID in
   Expo SecureStore and, while the person is still authenticated, requests a
   migration grant from `POST /api/auth/clerk-transition/grants`.
2. The API verifies that the request came from the development issuer and that
   the same stable user has a provisioned production alias. It stores only the
   grant and installation SHA-256 hashes. Reissuing on the same installation
   rotates one row; expired and redeemed rows are cleaned up, and each user is
   capped at ten active installation grants.
3. The production-key release reads the grant and sends it in a redacted
   `Authorization: Bearer` header to
   `POST /api/auth/clerk-transition/redeem`. A PostgreSQL row lock ensures that
   concurrent or replayed requests cannot issue a second ticket.
4. Only at redemption time does the API request a 60-second, one-use production
   Clerk ticket. The mobile app consumes it immediately with Clerk's `ticket`
   strategy, activates the new session, and deletes the grant from SecureStore.

The mobile implementation also enforces these client-side rules:

- `EXPO_PUBLIC_CLERK_ENVIRONMENT` may explicitly name `development` or
  `production`, and the app fails closed if it conflicts with the publishable
  key prefix;
- production redemption holds the app loading boundary until the one startup
  attempt finishes, avoiding a signed-out flash;
- network and provider failures preserve the grant and retry when the app next
  enters the foreground;
- a deliberate sign-out writes an opt-out marker before deleting the local
  grant, so the production release cannot silently sign the person back in;
- a later successful development sign-in clears that opt-out and provisions a
  fresh grant; and
- an explicit `EXPO_PUBLIC_API_BASE_URL` supports local client testing against
  production while non-HTTPS overrides are rejected outside development.

The migration grant expires after 90 days so it can survive App Review and the
two-release adoption window without leaving a long-lived Clerk ticket on the
device. A transient Clerk failure does not consume the grant. Raw grants and
tickets must never enter logs, analytics, crash reports, URLs, or Git.

People who skip the bridge release sign in once with Apple, Google, or email.
Because their production alias was pre-provisioned to the same stable user, they
retain the same recipes, collections, grocery data, meal plans, saves, notes,
and extraction jobs.

## Verification gates

- Development and production JWTs for one person both return the same stable
  ID and identical recipe totals.
- An unknown production subject without a verified external ID receives 403.
- Wrong issuer, signature, audience, or present authorized party receives 401;
  a missing authorized party also receives 401 when strict mode is enabled.
- Concurrent first authentication creates exactly one alias.
- Concurrent migration-grant redemption creates exactly one Clerk ticket;
  replay and expiry fail with the same terminal response.
- Old and new builds can be used concurrently on separate devices.
- Account deletion removes local data and every configured Clerk alias.
- Before/after ownership counts and checksums match.
- Render health, authenticated recipe listing, extraction, grocery, planning,
  and account deletion pass.
- Greptile reports a current-head 5/5 with no unresolved actionable feedback.

## QA evidence recorded before review

On an expiring Neon branch cloned from the former application database:

- migrations 015 and 016 completed transactionally;
- migration 016 completed twice with the same 32 application users and 32
  development aliases;
- the development inventory audit returned 32 `unchanged` and zero missing or
  conflicting users;
- an existing development Clerk session resolved to its stable ID and the API
  returned all 611 directly counted recipes for the highest-volume test account;
- a temporary new development identity was lazily adopted and received a 200
  authenticated recipe response; and
- PostgreSQL integration tests proved dual aliases, uniqueness constraints,
  concurrent idempotence, migration idempotence, and no ownership rewrite.

The QA Clerk session was revoked, the temporary Clerk user was deleted, and the
disposable Neon branch was deleted after the checks. Production was unchanged.

On a local PostgreSQL 16 database, migrations 016 and 017 each completed twice;
42 tests passed, including real row locking, concurrent one-use redemption,
concurrent enforcement of the per-user device cap, hash-at-rest storage,
per-installation rotation, transient Clerk failure retry, and a 60-second
Backend API ticket contract.

The bridge client has ten focused tests covering environment/key mismatch,
stored-grant validation and refresh, stable random installation IDs, serialized
grant/sign-out storage, fail-closed deliberate sign-out, header-only grant
creation/redemption, terminal replay, and retryable network/provider failure.
It type-checks cleanly and the repository-wide gate passes.

After merged commit `8fc1b76` deployed, the development-key client was run from
the monorepo in the iOS Simulator against the live API. An existing account
signed in, loaded its recipe library, and received a 200 from
`POST /api/auth/clerk-transition/grants`; recipe endpoints also returned 200.
A deliberate sign-out returned to Guest User without issuing another grant,
confirming the opt-out path against production rather than only in unit tests.

## Bridge App Store release

iOS 2.4.0 build 41 was archived from merged commit `8fc1b76` as EAS build
`4ae9ca7c-0f6a-4ec3-aef9-1cfd6df70025`. Submission
`9c3d038d-c84a-4344-9f97-0682a5400eaf` uploaded successfully, Apple processed
the binary, and the version is **Waiting for Review** in App Store Connect. The
release continues using the development Clerk publishable key intentionally so
installed sessions can create migration grants.

Do not switch EAS to the production publishable key or change Render's primary
environment while this build is only waiting for review. After approval and
release, record adoption evidence and successful grant creation over the agreed
window, then produce a separate production-key validation/release candidate.

## Rollback

- Before client cutover, redeploy the previous API commit; the additive tables
  can remain unused. Migration grants can be removed after the observation
  window because they do not own application data.
- During dual issuer operation, keep development primary and continue accepting
  both issuers.
- If production authentication is unhealthy, ship/re-enable the development-key
  client path. Do not rewrite ownership or delete aliases.
- Restore the database snapshot only for a demonstrated database integrity
  incident after comparing the snapshot with current data; an authentication
  configuration rollback should not require database restore.

## Clerk references

- [Migrating users and the development-to-production limitation](https://clerk.com/docs/guides/development/migrating/overview)
- [Deploying a production Clerk instance](https://clerk.com/docs/guides/development/deployment/production)
- [Deploying Clerk with Expo](https://clerk.com/docs/guides/development/deployment/expo)
- [Manual JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification)
- [Session lifetime options](https://clerk.com/docs/guides/secure/session-options)
- [One-use sign-in tokens](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token)
