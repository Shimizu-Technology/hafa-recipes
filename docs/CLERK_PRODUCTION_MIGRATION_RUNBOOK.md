# Clerk production migration runbook

Status: foundation implementation in review; client cutover not started

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

## Production Clerk setup

Create/activate the production instance by cloning safe development settings,
then configure the settings Clerk does not copy:

- production domain and DNS;
- native iOS application with the Håfa Recipes bundle ID and Apple team ID;
- mobile SSO redirect allowlist;
- dedicated Google and Apple OAuth credentials;
- email delivery, sender identity, paths, and redirect URLs;
- the `recipe-extractor-public-metadata` JWT template;
- session policy: maximum lifetime enabled at 365 days if the Clerk plan allows
  it, otherwise 30 days; inactivity timeout disabled; and
- production publishable and secret keys stored only in provider secrets.

Clerk requires at least one of maximum lifetime or inactivity timeout to remain
enabled, so a literal never-expiring session is not available.

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

## Client transition

The planned low-friction path remains two releases:

1. a development-key bridge release requests a short-lived, one-use production
   sign-in token for the already provisioned production alias and stores it in
   Expo SecureStore without logging it; and
2. the production-key release consumes it with Clerk's `ticket` strategy,
   activates the new session, and deletes the local token immediately.

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

## Rollback

- Before client cutover, redeploy the previous API commit; the additive tables
  can remain unused.
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
