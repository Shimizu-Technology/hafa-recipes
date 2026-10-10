# Håfa Workouts development foundation

This dependent draft introduces the frozen Expo57/React Native0.86.3 SDK, domain
contracts, private-storage and network adapters, native modules/plugins, core tests,
assets and build gates. Its two temporary routes show development diagnostics.
It is not a distributed product or release candidate. The full training experience
is a separate dependent review slice.

The configured route mounts the genuine ClerkProvider, native token cache and Expo
Router. Missing or mismatched sign-in configuration shows instructions before Clerk
initializes. There are no training, enrollment, deletion or Health-permission actions
in this diagnostic app, and it does not send requests to the Håfa API. Clerk may
initialize its own SDK/session when a valid public configuration is supplied.

## Local checks

Use Node22.22.3 (SDK57 requires at least22.13). Run `npm ci`, `npm test`,
`npm run typecheck`, `npm run doctor`, `npm run audit:runtime`,
`npm run export:all` and `npm run check:native-bundles`. Repository-wide checks are
`./scripts/check.sh`. Run API integration tests only against a named disposable
Postgres database through TEST_DATABASE_URL; never use production data.

Copy `.env.example` into an untracked `.env` and configure an explicit Clerk
environment with the matching public key. Restart the development build afterward.
An omitted key displays the foundation recovery message; a production build
requires production sign-in. The API base is configuration only in these routes.

Independent Workouts app identifiers, EAS manifest and SDK lock are retained exactly
from the frozen native source. Recipes client identifiers/configuration are unchanged.
This draft performs no EAS build, submission, distribution or production activation.
The presence of native Health/share plugins does not demonstrate device permission,
share-extension or Health-write acceptance.

## Frozen review partition

Backend base: `990cc56be64b510f50c589a70bddb79a749ac50a`.
Frozen full native source: `e3db3f7257d520bdedd9cf01f43045d5a7b6baf5`.
This foundation comprises96 copied paths plus two diagnostic routes:98 raw changed
paths, including66 library files and26 core test files.

All full app routes and components, the Health implementation document and the
18 listed leaf/UI libraries are reserved for the experience slice. That follow-up
also restores this README and both full app entry routes. The omitted source manifest
below records that boundary; it is not a claim that those journeys are implemented
or accepted by this draft.

```text
docs/hafa-workouts/HEALTH_IMPLEMENTATION.md
workouts-mobile/app/(tabs)/_layout.tsx
workouts-mobile/app/(tabs)/index.tsx
workouts-mobile/app/(tabs)/library.tsx
workouts-mobile/app/(tabs)/plan.tsx
workouts-mobile/app/(tabs)/progress.tsx
workouts-mobile/app/+native-intent.tsx
workouts-mobile/app/_layout.tsx
workouts-mobile/app/account-data.tsx
workouts-mobile/app/activity-log.tsx
workouts-mobile/app/activity.tsx
workouts-mobile/app/add-workout.tsx
workouts-mobile/app/ai-preferences.tsx
workouts-mobile/app/build-plan.tsx
workouts-mobile/app/capture.tsx
workouts-mobile/app/coach-action/[id].tsx
workouts-mobile/app/coach.tsx
workouts-mobile/app/collections.tsx
workouts-mobile/app/connections.tsx
workouts-mobile/app/edit-workout/[id].tsx
workouts-mobile/app/hafa-apps.tsx
workouts-mobile/app/health-rationale.tsx
workouts-mobile/app/import/[id].tsx
workouts-mobile/app/index.tsx
workouts-mobile/app/invalid-link.tsx
workouts-mobile/app/measurement.tsx
workouts-mobile/app/measurements.tsx
workouts-mobile/app/onboarding.tsx
workouts-mobile/app/organize/[id].tsx
workouts-mobile/app/privacy.tsx
workouts-mobile/app/profile.tsx
workouts-mobile/app/recipes-connection.tsx
workouts-mobile/app/reminders.tsx
workouts-mobile/app/review-plan.tsx
workouts-mobile/app/session/[id].tsx
workouts-mobile/app/settings.tsx
workouts-mobile/app/share.tsx
workouts-mobile/app/shared/[token].tsx
workouts-mobile/app/sharing-links.tsx
workouts-mobile/app/sign-in.tsx
workouts-mobile/app/training.tsx
workouts-mobile/app/workout/[id].tsx
workouts-mobile/components/activity-context.tsx
workouts-mobile/components/activity-week.tsx
workouts-mobile/components/calendar-date.native.tsx
workouts-mobile/components/calendar-date.tsx
workouts-mobile/components/coach-action-preview.tsx
workouts-mobile/components/equipment-locations.tsx
workouts-mobile/components/health-export.tsx
workouts-mobile/components/import-list.tsx
workouts-mobile/components/logout-recovery-boundary.tsx
workouts-mobile/components/optional-number.tsx
workouts-mobile/components/profile-form.tsx
workouts-mobile/components/program-preview.tsx
workouts-mobile/components/query-state.tsx
workouts-mobile/components/recorded-time.native.tsx
workouts-mobile/components/recorded-time.tsx
workouts-mobile/components/reminders-provider.tsx
workouts-mobile/components/saved-source-picker.tsx
workouts-mobile/components/share-capture.tsx
workouts-mobile/components/shared-snapshot.tsx
workouts-mobile/components/source-image.tsx
workouts-mobile/components/ui.tsx
workouts-mobile/components/workout-editor.tsx
workouts-mobile/lib/activity-drafts.test.ts
workouts-mobile/lib/activity-drafts.ts
workouts-mobile/lib/auth-recovery.test.ts
workouts-mobile/lib/auth-recovery.ts
workouts-mobile/lib/coach-drafts.test.ts
workouts-mobile/lib/coach-drafts.ts
workouts-mobile/lib/context.test.ts
workouts-mobile/lib/context.tsx
workouts-mobile/lib/input-purpose.ts
workouts-mobile/lib/logout-recovery-native.ts
workouts-mobile/lib/logout-recovery.test.ts
workouts-mobile/lib/program-session-identity.test.ts
workouts-mobile/lib/program-session-identity.ts
workouts-mobile/lib/progress-screen.test.ts
workouts-mobile/lib/progress-selection.test.ts
workouts-mobile/lib/progress-selection.ts
workouts-mobile/lib/root-route.test.ts
workouts-mobile/lib/use-health.ts
```

## Acceptance

Automated domain/SDK tests and exports verify the foundation source and selected
native dependencies. Actual training, onboarding, sign-in/out, deletion, capture,
sharing, Health permissions and recorded-session journeys belong to the full
experience slice and its device QA. Device acceptance and TestFlight delivery
remain separate release gates. No private/customer fixture is bundled.
