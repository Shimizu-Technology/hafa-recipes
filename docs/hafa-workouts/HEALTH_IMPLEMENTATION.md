# Native health adapter implementation and handoff

This slice implements typed native adapters and a consent-scoped foreground sync
coordinator. It changes no package manifest, lockfile, application screens, backend,
production configuration or store records. Physical-device/native-build acceptance
remains open; injected bridge tests cannot close H01–H05 or store declarations.

## Exact dependencies and native configuration

Published types inspected: `@kingstinct/react-native-healthkit` **16.1.0**,
`react-native-nitro-modules` **0.37.1**, `react-native-health-connect` **4.1.3**.
The HealthKit package includes `@react-native-healthkit/core` 16.1.0 transitively.
Root owns the coherent package/lockfile update. Both providers require a rebuilt
native client, not Expo Go. Metro chooses `provider.ios.ts` / `provider.android.ts`;
web uses `provider.ts`, which never loads native modules. The factory returns a
bounded unavailable provider when native loading/availability fails.

Add these plugins in order, with the task plugin last:

```ts
plugins: [
  // Existing independent Workouts plugins...
  ["@kingstinct/react-native-healthkit", { background: false }],
  "react-native-health-connect",
  "./plugins/with-workouts-health.cjs",
]
```

Keep the existing Workouts bundle/package identifiers; never copy Recipes EAS,
bundle, signing or store identifiers. Existing iOS minimum 17 and Android min SDK
26 are retained by the integration owner. Health Connect runtime availability is
checked; unsupported devices keep manual operation. SDK compile/target choices
and package-peer compatibility need actual native build and Expo doctor evidence.

The custom plugin adds HealthKit capability and specific read/write usage
descriptions, disables background delivery, and declares only Android
`READ_EXERCISE` / `WRITE_EXERCISE`. No body measurements, calories, heart rate,
sleep, clinical records, routes, historical or background permission is requested.
Weight can be added in a separate optional feature with minimized scopes.

The upstream Health Connect 4.x Expo integration already registers the native
permission delegate; do not add obsolete expo-health-connect or manually duplicate
delegate registration. Its plugin targets MainActivity for rationale intents.
Our plugin moves that rationale to a generated `HafaHealthRationaleActivity` and
retargets the protected Android 14 permission-usage alias. The Kotlin bridge opens
`hafaworkouts://health-rationale`, bringing the real app explanation screen forward.

**Integration requirement:** native UI must implement a publicly reachable
`health-rationale` route, including when signed out. Explain exercise-summary
reading, optional actual-workout writing, separate server/AI choices, foreground
limits, disconnect, and a real privacy-policy destination. This slice generates
the native bridge, not that screen. A broken or auth-blocked rationale destination
remains a native/store acceptance blocker. Manifest transformation idempotency and
generated source text are unit tested; Kotlin compilation is not yet verified.

## Interfaces

```ts
const provider = await createNativeHealthProvider();
await provider.availability();
await provider.requestAccess({ read: true, write: false });
```

HealthProvider has availability, access/requestAccess, readPage, exportActual,
deleteOwned and openSettings. Platform permission is distinct from app consent.
Reading permission does not grant upload/AI use; OS write permission does not
enable the app's optional write-back switch.

Read pages return minimized observations, explicit provider source deletions,
opaque next cursor, has_more, reset_required and coverage notes. Observations have
source_id, provider, origin_id, UTC started_at/ended_at, duration_seconds,
duration_basis, activity_type, optional updated_at and ai_eligibility. No route,
calorie, heart-rate, full provider metadata or health content is logged/projected.

Apple duration is provider_reported; Health Connect duration is elapsed_interval.
Neither should become a modeled calorie expenditure or universally comparable
training-load number. Provider activity types retain their namespace/raw code;
backend mapping is a separately reviewed rule, not silent numeric equivalence.

HealthCursor stores provider, fixed window_start/window_end, bootstrap/changes
phase and optional anchor/page_token/changes_token. It must live in an account-
and enrollment-generation-scoped private local store. It is not an authentication
token or evidence of data permission.

ActualWorkout carries canonical_session_id, positive revision, completed/partial
status, actual start/end, active_seconds and running/walking/strength/basketball/
other activity. Only truthful actual intervals are exported; no measured distance
or calories are fabricated. The current bridges cannot accurately export pauses
when active time differs from wall duration, so those records return unsupported
and stay in the app. A paused-workout event/segment extension remains open.

## Platform behavior

Apple queries HKWorkoutTypeIdentifier using anchored pages of at most 100, with
the original fixed start boundary. Deltas include deleted UUIDs. Apple's read
permission is always reported unknown, even after an authorization request succeeds
or a query is empty. No absent sample is inferred deleted or inactive. Invalid
anchor/provider/protected-data failures must be presented as refresh errors, with
an explicit reset/reconnect if needed; do not discard data on an empty response.

Writes use the actual native metadata values `HKSyncIdentifier` and `HKSyncVersion`,
derived from canonical session ID and revision. The preflight checks same-or-newer
owned records. Native sync semantics provide retry/upsert identity; real duplicate/
revision behavior needs device verification. Deletion selects canonical metadata
then deletes only records whose source bundle belongs to Håfa Workouts. Apple Health
permission revocation is controlled in system Health settings; iOS openSettings
opens app settings, and UI must also explain the Health app path.

Health Connect checks SDK availability and initialization. Requests are granular
ExerciseSession read/write. Initial foreground snapshots are capped to a caller
window of at most 30 days and 100 records/page. A Changes token is obtained before
snapshot reading to recover concurrent writes. Subsequent deltas preserve record
IDs, upserts and deletions; package Changes pages use the platform's own bounded
page size (the package does not expose a custom change-page size).

Expired Changes tokens restart a bounded snapshot and report reset_required. Root
must reconcile its authoritative visible snapshot only after the entire bootstrap
finishes, under valid current permission. Deletions outside that visible coverage
remain unknown; do not erase all historical imported observations. Invalid tokens
raising an exception remain errors requiring explicit reset. No historical or
background access is claimed. Writes use stable clientRecordId and revision as
clientRecordVersion; deletion uses only our canonical client IDs, never broad dates.

Our own bundle/package and canonical write echoes are excluded from imports, so
logged Håfa sessions do not return as duplicate external activity. Other source
IDs are retained independently; repeated same-ID observations reconcile once.
Matching intervals from different sources are overlap candidates, not automatically
equivalent workouts. Backend progress must resolve overlap provenance before summing
training, rather than sum every source independently.

## Fresh consent, synchronization and disconnect

createHealthSync receives injected currentGrant, foreground state, account-scoped
load/save state, authenticated upload and revoke operations. It has no global fetch
or API endpoint. Root can wire its health route without changing native adapters.

The grant includes owner_scope, generation, connected, read_on_device,
upload_to_server, use_for_ai and write_actuals. Refresh requires current read and
upload grants, foreground state and unchanged owner/generation before/after every
provider/upload await. It checkpoints only after the server acknowledges a whole
authorized page. Default budget is five pages per refresh, maximum ten; has_more
honestly indicates continuation. The backend must atomically reject stale grants,
owner/account switches, revoked enrollment and duplicate/page replays.

All external origins default unknown and remain AI-ineligible; recognizable Strava
origins are restricted. AI opt-in alone never promotes unknown origin to eligible.
Server-side reviewed eligibility rules may later authorize particular origin
classes, while retaining upstream restrictions and current AI consent. Routing an
upstream record through HealthKit/Health Connect is not permission to use it in AI.

Disconnect sets a local fence immediately, serializes persisted state writes so
an old refresh cannot overwrite it, clears cursors and invokes server revocation.
Local refusal survives server/network failure. Root must persist/retry pending
server revocation and invalidate derived memory; recreating the coordinator must
honor persisted disconnection. Reconnect is explicit with a renewed generation.
Health Connect revokeAllPermissions is intentionally not relied on: the package
documents that OS revocation can remain ineffective until process restart.

Write-back uses the coordinator's exportActual wrapper, checks a separate fresh
write grant and current owner, and reports changes during an OS save for owned-write
reconciliation. Root must fetch an authorized owned actual session and pass its
owner scope; do not export arbitrary stale cached sessions after account switching.
An OS operation already in flight cannot be undone merely by changing app consent.

## Verification and remaining acceptance

Typecheck against exact installed package types passed. Injected bridge and sync
tests cover minimal/partial permission, Apple read ambiguity, source IDs/deletions,
timezone normalization, unknown/restricted origin, echo exclusion, duplicate and
overlap handling, pagination/tokens, actual write IDs/versions, safe deletion,
failed-upload retry, account/generation checks and disconnect storage races.
Plugin tests cover minimal permissions, alias/rationale routing and idempotency.

No actual Health data, permission prompts, native builds, simulator/device startup,
backend transport, physical synchronization or App Store/Play approval was used.
Physical H01–H05, native compilation, real source/retry/delete behavior, rationale
navigation, lifecycle cleanup of test records, and store declarations remain open.

Task-owned dependency inspection used no-save/no-lock flags. Default npm failed;
supported Node 22.22.3 plus npm 11 completed the local inspection install. It
reported optional peer warnings and 35 whole-installed-tree audit findings; those
are not a verified production-dependency audit and were not automatically fixed.
Root owns lock resolution, Expo doctor and audit triage before native readiness.
No source dependency files or persistent runtime resources changed.

Primary guidance: [Apple authorization](https://developer.apple.com/documentation/healthkit/hkauthorizationstatus),
[Health Connect sync](https://developer.android.com/health-and-fitness/health-connect/sync-data),
[Health Connect setup](https://developer.android.com/health-and-fitness/health-connect/get-started),
[HealthKit package](https://github.com/kingstinct/react-native-healthkit),
[Health Connect package](https://github.com/matinzd/react-native-health-connect).
