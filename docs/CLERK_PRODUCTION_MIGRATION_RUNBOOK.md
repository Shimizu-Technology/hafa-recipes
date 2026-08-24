# Clerk production migration runbook

Status: foundation/grant API deployed; 35/35 production aliases provisioned;
production Apple/Google/email authentication configured; iOS 2.4.0 bridge
live on the App Store; production-key TestFlight validation approved

Last updated: 2026-08-25

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

Provider-readiness work completed on 2026-08-17:

- Apple Sign in was enabled with Håfa Recipes as its own primary App ID;
- the dedicated Apple Services ID
  `com.shimizutechnology.recipeextractor.signin` was registered with
  `clerk.hafa-recipes.com` and the exact Clerk OAuth callback;
- a Håfa Recipes-only Sign in with Apple key was created, installed in Clerk,
  and retained outside Git with owner-only file permissions;
- the production Apple connection and its sign-up/sign-in strategy were
  enabled after Clerk accepted the custom credentials;
- the Account Portal produced an Apple authorization request containing the
  Håfa Recipes Services ID and exact Clerk callback, and Apple displayed
  "Håfa Recipes" on its authorization page;
- a clean native iOS simulator build using the production Clerk key loaded the
  app and sign-in screen without an environment error, then opened Apple's
  authorization page with the message "Use your Apple Account to sign in to
  Håfa Recipes";
- the Android application was registered in Clerk with package
  `com.shimizutechnology.recipeextractor` and the EAS production keystore's
  SHA-256 fingerprint;
- the production `recipe-extractor-public-metadata` JWT template was created
  under that exact name with
  `{ "public_metadata": "{{user.public_metadata}}" }`;
- the Clerk support email was set to `shimizutechnology@gmail.com`; and
- an ordinary-email sign-in verification message was delivered to that address,
  its code was accepted by the production Account Portal, and the successful
  session redirected to `https://hafa-recipes.com/`.

Google provider evidence on 2026-08-17:

- the owner accepted the Google API Services User Data Policy for the dedicated
  `hafa-recipes-production` project;
- the external consent configuration identifies the app as Håfa Recipes and
  uses `shimizutechnology@gmail.com` for support and developer contact;
- the web client `Håfa Recipes Clerk Production` has only
  `https://clerk.hafa-recipes.com/v1/oauth_callback` as its authorized redirect;
- its credentials were installed in the production Clerk instance and the
  Google connection is enabled and marked **Used for sign-in**;
- the production Account Portal offered Google beside Apple, Google displayed
  the Håfa Recipes consent screen, and the callback redirected successfully to
  `https://hafa-recipes.com/`; and
- Clerk recorded the test account's production sign-in against its existing
  pre-provisioned production identity rather than creating a disconnected
  application owner.

The remaining physical-device acceptance gates are:

- Apple reached the provider's password/passkey screen, but a complete callback
  still requires an owner-controlled Apple login. Complete that test in the
  production-key TestFlight build before App Review;
- exercise sign-up verification, password recovery, and delivery to an Apple
  private-relay address in the TestFlight build in addition to the completed
  ordinary-email sign-in test; and
- confirm an existing bridge installation either redeems its grant without a
  sign-in prompt or reaches a normal recoverable sign-in without losing recipes.

These gates block App Review, not creation of the production-key TestFlight
candidate. TestFlight is the controlled environment needed to finish the native
provider and upgrade-path checks on a real device.

## Deferred session-duration improvement

Owner decision on 2026-08-18: remain on Clerk Hobby and do not add a Clerk Pro
subscription at this time. This is an intentional cost decision, not a migration
defect or a production-cutover blocker.

Clerk Hobby fixes production maximum session lifetime at seven days. Moving from
the development instance to the production instance therefore does **not** by
itself stop weekly session expiry. The app must continue treating
reauthentication as a recoverable state: preserve local context, never present
an empty recipe library as if data were lost, offer Apple/Google sign-in, and
return the person to their recipes after a successful sign-in.

If weekly sign-in becomes worth an additional recurring bill, revisit this
decision as a separate, explicitly approved billing change:

1. confirm Clerk's then-current plan and session-duration terms;
2. obtain owner approval for the purchase before changing the subscription;
3. upgrade the production Clerk instance to a plan with custom session duration;
4. set a long maximum lifetime (the current target is 365 days) and leave the
   inactivity timeout disabled unless product requirements change;
5. verify expiration, manual sign-out, account deletion, revocation, and
   returning-user behavior in the native app; and
6. update this runbook with the final policy and validation evidence.

A literal “never sign out” promise is not supported: Clerk requires at least one
session-expiration control, and manual sign-out, account deletion, revocation,
device state, or other security events may still end a session.

For local cutover testing, move the gitignored `mobile/.env.local` aside before
starting Metro with explicit production variables, then restore it after the
test. Expo's development-only virtual environment merges `.env.local` over the
shell and can otherwise pair its development key with
`EXPO_PUBLIC_CLERK_ENVIRONMENT=production`. This precedence is local-only: EAS
does not receive the untracked file.

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
python -m app.clerk_transition provision-production --summary-only
python -m app.clerk_transition provision-production --apply --summary-only
python -m app.clerk_transition provision-production --summary-only
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
the binary, and version 2.4.0 became live on the App Store at
`2026-08-17T05:24:39Z` (`2026-08-17 15:24:39` ChST). The release continues using
the development Clerk publishable key intentionally so installed sessions can
create migration grants.

Do not switch EAS to the production publishable key or change Render's primary
environment until adoption evidence and successful grant creation are recorded
over the exit window below. Then produce a separate production-key
validation/release candidate.

### Bridge-adoption exit gate

The observation window began at the App Store release time and runs for at least
14 full days, so the gate cannot open before `2026-08-31T05:24:39Z`. At the end
of that minimum window, all of the following must be true:

- at least one unexpired, unredeemed migration grant created after the release
  exists, proving the public bridge binary reached a real installation;
- at least 90% of distinct application users whose development identity has
  `last_authenticated_at >= 2026-08-17T05:24:39Z` have an unexpired grant
  created after that timestamp;
- Render and Clerk logs show no unresolved grant-creation errors during the
  final seven days; and
- the production aliases remain complete and conflict-free.

Use a read-only production query equivalent to the following and retain only
aggregate counts in the rollout record. Do not export user IDs, grant hashes, or
device hashes.

```sql
WITH active AS (
    SELECT DISTINCT app_user_id
    FROM clerk_identities
    WHERE issuer = :development_issuer
      AND last_authenticated_at >= TIMESTAMPTZ '2026-08-17T05:24:39Z'
),
covered AS (
    SELECT DISTINCT app_user_id
    FROM clerk_migration_grants
    WHERE created_at >= TIMESTAMPTZ '2026-08-17T05:24:39Z'
      AND redeemed_at IS NULL
      AND expires_at > NOW()
)
SELECT
    COUNT(*) AS active_users,
    COUNT(*) FILTER (WHERE covered.app_user_id IS NOT NULL) AS covered_users,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE covered.app_user_id IS NOT NULL)
        / NULLIF(COUNT(*), 0),
        1
    ) AS coverage_percent
FROM active
LEFT JOIN covered USING (app_user_id);
```

If the gate is not satisfied, extend observation in seven-day increments and
re-run the same evidence. Do not silently lower the threshold. Proceeding with
lower coverage requires an explicit owner decision that accepts additional
one-time sign-ins for uncovered users, documented in this runbook before the
production-key build is submitted.

Use the checked-in aggregate-only command for routine evidence so user IDs,
Clerk subjects, grant hashes, and device hashes never enter retained logs:

```bash
python -m app.clerk_transition bridge-adoption \
  --since 2026-08-17T05:24:39Z
```

### Early TestFlight decision — 2026-08-25

The owner explicitly approved producing the production-key TestFlight
candidate before the original 14-day calendar gate on 2026-08-31. This is a
time-window waiver, not a coverage-threshold waiver:

- the 2026-08-25 aggregate check found 2 active bridge users and 2 covered users
  (100.0% coverage);
- Render recorded two bridge grant requests after the App Store release, both
  returning HTTP 200, with no recorded grant-creation error;
- the production provisioner dry-run returned 35 `unchanged` and no conflict,
  missing, or failed result;
- the production branch remains `br-misty-voice-a1ymon2c`, and snapshot
  `pre-clerk-foundation-2026-08-17` remains retained without expiration; and
- Render continues accepting both issuers with development primary, so a
  production-key TestFlight failure does not require an ownership rewrite or
  API rollback.

Do not submit this candidate to App Review until the owner completes and records
the physical-device acceptance gates above. Keep development as the API primary
through TestFlight validation. Switching the primary issuer and retiring the
bridge path are separate post-validation changes.

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
- [Clerk pricing](https://clerk.com/pricing)
- [Manual JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification)
- [Session lifetime options](https://clerk.com/docs/guides/secure/session-options)
- [One-use sign-in tokens](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token)
