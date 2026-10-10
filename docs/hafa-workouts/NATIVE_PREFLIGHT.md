# Workouts native and TestFlight preflight

Date: 2026-10-10. Baseline: Recipes/planning `cc2b9c6`. Read-only inspections; no provider mutation or device startup.

## Verified local capabilities

Apple Silicon arm64, Xcode 26.6 (17F113), iOS 18.0/18.2/18.5/26.5 simulator runtimes. Android SDK platform 36, build tools 35/36 and a Google Play arm64 Android 36 AVD exist. No Android physical device was attached. Registered iPhone 15 Pro Max and iPhone 14 reported unavailable; a paired Watch reported available. Existing booted simulators are borrowed and were untouched. Simulators do not replace required physical health acceptance.

Default Node 22.0.0 is below Expo 57 minimum 22.13. Use explicit Node 22.22.3 path for installs/builds. EAS CLI 19.1.0 is installed and the Shimizu account authenticated. [Expo compatibility](https://docs.expo.dev/versions/latest/).

Apple read-only API verified that proposed `com.shimizutechnology.hafaworkouts` has no registered app/bundle in the accessible team. Provision new records, profiles, EAS project, OAuth callbacks and extension identifiers. Recipes bundle, project, store record and update URL remain unchanged. Recent Recipes builds 91/90/89/88/85 were valid and unexpired, minimum iOS 17. Provisioning and current provider permissions must be rechecked when executing delivery.

## Provider approach

Candidate iOS adapter: `@kingstinct/react-native-healthkit` 16.1.0 with `react-native-nitro-modules` 0.37.1 (npm versions verified). Expo plugin and anchored queries support source/delta/deletion handling. Peer ranges accept RN 0.86 but its example still uses RN 0.81; exact native build proof is required. [Repository](https://github.com/kingstinct/react-native-healthkit), [manifest](https://raw.githubusercontent.com/kingstinct/react-native-healthkit/master/packages/react-native-healthkit/package.json).

Candidate Android adapter: `react-native-health-connect` 4.1.3. Upstream example uses Expo 57/RN 0.86.2; bundled Expo integration replaces deprecated `expo-health-connect`. Never install both. [Installation](https://matinzd.github.io/react-native-health-connect/docs/get-started/), [manifest](https://raw.githubusercontent.com/matinzd/react-native-health-connect/main/package.json).

Both require rebuilt native clients, not Expo Go. Keep a typed provider boundary for availability, permission, paginated reads, cursors/deletions, own-write echo exclusion, origin provenance, optional write-back, revocation, and erasure. A narrow Swift/Kotlin Expo module is feasible for missing required APIs; avoid reimplementing providers without a demonstrated need. [Expo Modules](https://docs.expo.dev/modules/overview/).

HealthKit needs the capability and read/write usage descriptions. Read permission denial cannot be inferred from empty results. [Apple authorization](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data?changes=_2), [EAS capability sync](https://docs.expo.dev/build-reference/ios-capabilities/).

Health Connect is built into Android 14+, while Android 9–13 needs the separate app. Foreground refresh is the baseline; history/background access requires capability checks and separate permissions. Use bounded pagination and cumulative-type aggregation; do not miscount multiple-source steps. Default historical other-app reads are limited. [Availability](https://developer.android.com/health-and-fitness/health-connect/availability), [reads](https://developer.android.com/health-and-fitness/health-connect/read-data).

Minimize requested data types to actual user-facing features. Own completed sessions may be written with stable idempotency/version identities; never invent measured calorie, distance or heart-rate values. Keep platform permission, server storage permission, AI use and write-back separate. Route Health Connect permission-rationale intents to our real explanation/privacy screen. Manifest permissions must match Play Console declarations and Data Safety. [Health declaration](https://support.google.com/googleplay/android-developer/answer/14738291), [permissions policy](https://support.google.com/googleplay/android-developer/answer/16558241?hl=en).

## TestFlight delivery

Use the exact reviewed Workouts commit and new production signing configuration. Verify shared Apple subject/grouping/relay behavior before shared enrollment; never merge identities by email. Submit the explicit build ID, verify Apple processing, beta availability, group assignment and Leon's accepted tester access. The current Recipes EAS delivery is a proven lead, not permission to copy its IDs. [EAS submit](https://docs.expo.dev/submit/ios/), [internal testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).

Remaining gates: new app provisioning/signing/callbacks; exact adapter build proof; required physical-device health/OAuth evidence; complete functional acceptance. This foundation does not claim a Workouts signed artifact, synchronized health data, Play release, or TestFlight delivery.
