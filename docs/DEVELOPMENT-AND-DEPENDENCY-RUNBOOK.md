# Development Isolation and Dependency Runbook

Last verified: 2026-08-19

## Purpose

Local work must be useful without sharing production data, provider keys, or an
implicitly selected production API. Håfa Recipes intentionally has no dedicated
staging deployment; local development and explicitly targeted previews are the
non-production environments.

## One-command local setup

Requirements: Docker, Python 3.12, `uv`, Node 22.12, and npm.

```bash
./scripts/setup-dev.sh
./scripts/dev.sh
```

Setup starts PostgreSQL 16 on `localhost:55432`, creates the current schema, and
adds one synthetic public recipe. It never downloads production data. It does
not overwrite existing `.env` files.

Development safeguards:

- API startup rejects a remote database while `ENVIRONMENT=development`.
- The exceptional `ALLOW_REMOTE_DATABASE_IN_DEVELOPMENT=true` override is for a
  disposable non-production database only. The seed command refuses to run when
  that override is active.
- Paid AI capabilities are disabled in development unless
  `ALLOW_PAID_AI_IN_DEVELOPMENT=true` is paired with a budget-limited development
  provider key.
- The mobile app derives a local/private API host and fails clearly rather than
  falling back to production.
- A remote API in a development build requires
  `EXPO_PUBLIC_ALLOW_REMOTE_DEVELOPMENT_API=true` and remains visibly labeled.
- Preview builds must declare `EXPO_PUBLIC_API_BASE_URL` explicitly and use
  HTTPS. Production alone defaults to the Render API.
- Development and preview builds show a persistent environment/API-host banner.

Do not use the exceptional overrides during normal development and never put a
production provider credential in a local `.env` file.

## Dependency policy

The canonical gate is:

```bash
./scripts/check.sh
```

It runs API lint/tests, mobile version consistency/tests/typecheck/Expo Doctor,
the reviewed mobile production-dependency audit, and website audit/lint/build.
CI runs the same runtime-specific checks using Node 22.12.

Verified on 2026-08-19:

- Expo Doctor 1.18.19: 17/17; every Expo SDK 54 package is compatible. The
  doctor version is pinned so local and CI gates do not change implicitly.
- Marketing website production audit: zero advisories; React Router is outside
  the previously vulnerable range.
- Clerk: migrated from deprecated `@clerk/clerk-expo` to current `@clerk/expo`.
  Existing custom password/migration flows use Clerk's supported `/legacy`
  entry point while provider/session/SSO/token cache use Core 3.
- Chat Markdown: moved off the abandoned renderer to a current React Native 0.81
  fork with fixed Markdown parsing dependencies. Assistant-rendered images are
  disabled and links are restricted to HTTP(S).
- Audio: replaced deprecated, unmaintained `expo-av` playback with the SDK 54
  `expo-audio` API for TTS, timer previews, and cook-mode completion sounds.
- Sentry: development without a DSN no longer wraps an uninitialized SDK, while
  configured production builds keep crash and performance instrumentation.
- Mobile npm audit: 39 inherited package-level findings collapse to seven known
  leaf advisories. The gate fails on any new leaf advisory or any critical
  finding.

Accepted upstream leaf advisories:

| Package | Reachability | Interim control / owner |
| --- | --- | --- |
| `image-size` (2) | Metro build tooling; not called by application code | Only trusted repository assets enter Metro. Upgrade with the next compatible Expo/Metro patch. Owner: mobile platform. |
| `postcss` (4) | Metro CSS build tooling; not a server or runtime CSS processor | Only trusted repository/build input is processed. Upgrade with Expo/Metro. Owner: mobile platform. |
| `uuid` (1) | Expo config tooling and Clerk's unused wallet dependency path | App code does not use vulnerable UUID buffer APIs. Track upstream Clerk/Expo resolution. Owner: mobile platform. |

Do not run `npm audit fix --force`: its suggested fixes can downgrade React
Native or install a different Expo major. Update through Expo-compatible releases
and re-run native simulator/device checks.

## Preview and production mapping

| Build | `EXPO_PUBLIC_APP_ENV` | API rule |
| --- | --- | --- |
| Development | `development` | Local/private host unless exceptional override is explicit |
| Preview | `preview` | Explicit HTTPS `EXPO_PUBLIC_API_BASE_URL` required |
| Android internal APK | `preview` | Explicit production API target; always shows the preview banner |
| Production | `production` | Defaults to the Render production API; HTTPS overrides only |

There is no staging row by design. See ADR-002.
