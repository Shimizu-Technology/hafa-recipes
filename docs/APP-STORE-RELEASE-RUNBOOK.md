# App Store release runbook

Håfa Recipes uses production Clerk identities in its iOS release while the API
continues to accept both the historical development issuer and the production
issuer. Recipes, grocery lists, and other private data remain owned by stable
application user IDs throughout the transition.

## Existing-account recovery

The bridge release automatically transfers an existing session when its one-use
migration grant is still available. Customers who did not open the bridge
release can select **Restore my library** on the sign-in screen.

That flow starts Clerk's existing-account password-reset strategy, sends a
six-digit code to the email address already attached to the production account,
sets a durable password, and activates the original owner session only after the
code is verified. It never creates a new account, transfers sign-in into sign-up,
or rewrites recipe ownership. Unknown addresses receive the same on-screen
response so the flow does not disclose whether an account exists.

Customers who chose Apple Hide My Email may need the relay address listed under
their Apple Account's Sign in with Apple settings. Apple forwards the
verification email to the address behind that relay. Support both Apple's
historical `@privaterelay.appleid.com` addresses and new `@private.icloud.com`
addresses in readiness reporting.

Keep Clerk's **Password** strategy and password-reset email codes enabled in the
production instance. Email links are not supported by this JavaScript-only
native recovery flow.

Before relying on relay recovery, open the production Clerk Apple connection,
copy its **Email Source for Apple Private Email Relay**, and verify that exact
source under Apple Developer's **Certificates, Identifiers & Profiles → More →
Sign in with Apple for Email Communication**. Confirm Apple reports it as
registered and SPF/DKIM-authenticated, then complete one controlled reset from a
physical TestFlight device using a real relay address. A checked box in this
runbook is not proof; retain the date, operator, non-secret source domain, and
successful delivery result in the release record.

## Audit production before creating a release

Run this command inside the production API environment. It is read-only and
prints aggregate counts instead of customer emails, stable IDs, or Clerk
subjects:

```bash
python -m app.app_store_readiness audit
```

The output includes mapped owners, durable sign-in methods, email-recoverable
accounts, Apple private-relay accounts, invalid identity mappings, the exact
native OAuth redirect status, and reviewer status. Any invalid identity mapping
or missing `hafarecipes://oauth-callback` allowlist entry blocks the release.

After the dedicated reviewer account is configured, require it explicitly:

```bash
python -m app.app_store_readiness audit --require-reviewer
```

Set `APP_REVIEW_EMAIL` in the production execution environment before the
reviewer-required audit. Do not pass email addresses, passwords, provider
secrets, or session tokens as shell arguments or write them to job logs.

## Provision the App Review account

Use a dedicated email address that does not belong to a real customer. Store
`APP_REVIEW_EMAIL` and an `APP_REVIEW_PASSWORD` of at least 12 characters in
the execution environment through the approved secrets workflow.

Review the dry run first:

```bash
python -m app.app_store_readiness provision-reviewer
```

Only after the plan is approved, create the account:

```bash
python -m app.app_store_readiness provision-reviewer --apply
```

The command creates one password-enabled, production-only Clerk account and one
new stable application owner. It refuses to adopt, modify, or add a password to
an existing customer account. Repeating a successful run reports `unchanged`.

## Prepare the App Store listing

`mobile/store.config.js` contains the reviewed English (U.S.) subtitle,
description, promotional text, release notes, support URL, and privacy URL. It
verifies the existing App Store record before preparing that listing, creates
the current app version, requires manual release after approval, and enables
phased distribution. Update the reviewed constants and their length tests for
each release instead of copying old listing text forward.

Before running metadata synchronization, provide these process-only values:

- `APP_REVIEW_EMAIL`
- `APP_REVIEW_PASSWORD`
- `APP_REVIEW_CONTACT_EMAIL`
- `APP_REVIEW_CONTACT_PHONE`
- Optionally, `APP_REVIEW_CONTACT_FIRST_NAME` and
  `APP_REVIEW_CONTACT_LAST_NAME`

Never commit these values or run `eas metadata:pull` into the repository;
downloaded metadata can contain reviewer credentials.

After confirming the reviewer-required production audit passes:

```bash
cd mobile
eas metadata:push --profile production --non-interactive
```

Metadata synchronization changes App Store Connect. It does not submit the app
for review or release it. Attach only the exact newly uploaded production build
after verifying it has finished processing.

## Build and verify

Run the complete repository gate against an isolated PostgreSQL database:

```bash
TEST_DATABASE_URL=postgresql+asyncpg://USER@127.0.0.1:5432/ISOLATED_DB \
  ./scripts/check.sh
```

Generate an iOS archive from the reviewed commit. The main app, grocery
widget, and share extension must have the same marketing version and build
number. `withHafaExtensionBuildVersions` enforces both extension targets after
their config plugins have created them.

The current Clerk native SDK and the interactive grocery widget require iOS
17.0. Do not lower the deployment target without replacing or removing the
Clerk native module and separately checking whether the widget can be excluded
or installed conditionally on earlier iOS versions. The previously released
2.4.0 supports iOS 15.1; users on iOS 15 or 16 cannot install this update.

Validate Apple sign-in, Google sign-in, password-reset recovery, Apple Hide My
Email recovery, password reviewer sign-in, existing recipe ownership,
sign-out/sign-in, grocery sharing, the home-screen widget, and account deletion
on a physical TestFlight device before submitting the build for App Review.

App Review submission and production release each require separate owner
authorization.
