# Håfa Baby

Private pregnancy and baby companion for Kami, with each account owning its own
sources, journal, care history and routines. Uses the shared Håfa API, Clerk
identity and a separate native bundle. Product/acceptance contract:
[ROADMAP](../docs/hafa-baby/ROADMAP.md).

Copy `.env.example` to an ignored `.env.local` and use the configured development
Clerk instance and isolated local API. `npm ci`, then `npm start -- --dev-client
--port 8221`. The app needs its native development build for sharing and secure
storage. TestFlight uses the production EAS environment. Never copy another
app's bundle ID, project ID or App Store app ID.

`npm test`, `npm run typecheck`, `npm run doctor`, `npm run audit:runtime`,
`npm run export:all`, and `npm run check:native-bundles` are the engineering gate.
Native journey and physical-device results are recorded separately; exports do
not establish that an installed app works. The repository gate includes this app.

Device state uses encrypted section files with a device-only Keychain key and a
small atomic manifest. Synced records are a bounded cache; drafts/outbox are kept
until accepted or deliberately discarded. Source copies marked partial must fetch
full content before editing. Sign-out removes private local data after resolving
unsent entries. Photo originals remain in the protected owner container while
corrections may still depend on them. Private files are never public S3 URLs.
JSON export contains records and attachment metadata; it is not a media archive.

## Dependency assessment — 2026-10-20

The exact lockfile's production-classified audit reports24 entries and3 underlying
advisories, with0 critical. This includes native build tooling; classification
alone does not prove runtime reachability. The gate pins the reviewed lock hash,
rejects new advisories, and expires these temporary exceptions on2026-11-03.
The installed paths use the same Expo57/Metro and Clerk native architecture as
[the shared detailed assessment](../docs/hafa-workouts/NATIVE_DEPENDENCY_REACHABILITY.md).

- [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): Metro build globs are
  trusted repository configuration, not Baby source input. No compatible fix is
  published; npm's suggested React Native downgrade is incompatible with Expo57.
- [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv): Expo development
  certificate tooling, absent from native runtime. Only owned signing material is
  used; no untrusted certificate verification feature is exposed. No published fix.
- [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): Router's
  active native path uses its fork/URLSearchParams. Native-intent rejects oversized,
  control-containing and malformed links before routing; external shared URLs are
  captured as data. The decoder's fixed ESM release is incompatible with its
  CommonJS caller, so a blind override would break routing. Native bundle inspection
  verifies Clerk native and the Router fork; cold/warm malformed-link and OAuth
  acceptance remain separate required runtime checks.

Reassess after dependency/navigation/signing changes. Web is a preview/export
surface with memory-only state, not the supported release target.


## Dependency review renewal — 2026-10-24

Reviewed `baby-mobile/package-lock.json` from `fca37f99` with the audit-policy renewal.
Acceptance requires a fresh Node 22.22.2 install, tests, typecheck, Doctor and
runtime audit; Workouts and Baby also require all-platform export and native
bundle checks. This review changes no dependency versions or native-module pins.
Expo 57.0.31, Router 57.0.29 and notifications 57.0.24 are the preceding patch
update; Expo CLI is now 57.0.32. The temporary review window starts October 24
and expires **2026-11-17T00:00:00Z** (24 days).

### Zod and signing-tool reachability

Fresh `npm ls zod --omit=dev` and `npm audit --omit=dev --json` identify Zod
3.25.76 and high advisory `zod:1243066`
([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)).
Oversized failing collections can accumulate validation issues and exhaust memory.
The advisory fixes 4.x at 4.6.6; no 3.x fix is published, and npm reports no
compatible fix for this tree. A blind major override is not accepted.

The installed paths are Expo 57.0.31 → CLI 57.0.32 → Zod, and Clerk Expo 4.5.2
→ Clerk JS 6.39.1 → Base account 2.0.1 → ox 0.6.9 / viem 2.57.7
→ abitype 1.3.0 / 1.2.3 → Zod. Clerk also declares Coinbase wallet SDK
4.3.7, another viem parent. Both hoisted and viem-nested ox/abitype copies
are part of the reviewed tree. App source has no Zod, ABI, Base/Coinbase wallet,
viem or ox imports and no wallet authentication calls. App sign-in uses Clerk's
native email/social flows. Installed `clerk.native.js` keeps wallet SDK loading
behind wallet-provider operations; these flows never request those operations.
No app-used runtime path supplies untrusted input to these Zod schemas.

CLI's Zod imports are in `DevToolsPlugin.schema.js` and
`createMCPDevToolsExtensionSchema.js`: local devtools plugin metadata/output
and command schemas, outside the shipped app. Only trusted installed plugins
and local development tooling are covered; this does not accept arbitrary
untrusted plugin output or claim the vulnerable parser is fixed.

High `node-forge:1240912` remains at 1.4.0
([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)).
CLI 57.0.32 and `@expo/code-signing-certificates` 0.0.6 declare it for development
certificates/signing. App code does not import it or expose certificate verification;
signing uses owned material. The registry still lists 1.4.0 as latest and the
advisory lists no patch. This is a temporary reachability exception, not a fix.

The whole-lock SHA-256 is renewed to
`f74572e20331ac9d4f5f1fcc43303a39e0637e9167a1aef09e131ab6a18adf6b`.
The exact lock fingerprint preserves all installed versions, integrity values and
declaring edges; any lock change still requires review. The reviewed advisory set
retains braces 3.0.3 (`1240992`), decode-uri-component 0.2.2 (`1147955`),
node-forge 1.4.0 (`1240912`), and adds only Zod 3.25.76 (`1243066`).
The current registry no longer emits the retained braces advisory. Metro globs
remain trusted repository configuration. Router's active native implementation
still selects the fork/URLSearchParams; malformed incoming-link and device OAuth
acceptance remain separate runtime gates. No new decoder exception is added.

Fresh audit: 11 inherited findings, zero critical and zero unexpected.
Android: 1759 sources; map SHA-256 `2a72e21b185a0bd7f4c59f9c213a83eb6a5ced060f0e113b63a37a8f99c7548e`.
iOS: 1625 sources; map SHA-256 `2b32e4438217642de4af244e13726170f9446d41a1fa2f39b860d68e9ccc84c6`.
Both Hermes maps select native Clerk and the Router fork and contain no Zod,
abitype, ox, viem, Base/Coinbase wallet, forge, braces or stream-json module sources.
These exports support dependency reachability only; no installed-device journey
acceptance is claimed. Web remains a preview/export surface, not a supported
release target; this review does not approve enabling wallet flows on web.

Validation on 2026-10-24 under Node 22.22.2: `npm ci`, `npm test` (331),
`npm run typecheck`, `npm run doctor` (21/21), and `npm run audit:runtime`
all exit 0. Workouts and Baby `npm run export:all` and
`npm run check:native-bundles` also exit 0. The extra repository-wide
`./scripts/check.sh` exits 1 during API test setup because `TEST_DATABASE_URL`
is unset (2,099 passed, 698 skipped, 244 setup errors); its later stages do not run.

## New advisory review — 2026-10-30

Reviewed fresh `origin/main` at `6f083ba9`. These additions retain the existing
**2026-11-17T00:00:00Z** expiry. They accept specific remaining risks; they do
not fix the vulnerabilities. No dependency or lockfile changes are made.

### decode-uri-component:1243857 (high)

[GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f)
affects versions through 0.5.0, including the earlier 0.5.0 recursion fix.
Malformed input with many distinct percent-encoded runs causes quadratic
replacement work. For a mobile consumer the impact is a **client-side JS-thread
hang/unresponsive app**, not a shared API outage. Do not apply Node HTTP header
limits to native deep links: this is not an HTTP server decoder.

Installed Router 57.0.29 declares query-string 7.1.3, which directly requires a
callable CommonJS `decode-uri-component` and defaults to decoding both query
keys and values. Router's `react-navigation/core/getStateFromPath.js` calls
`queryString.parse` in `parseQueryParams`. This helper is bundled and can decode
URL/deep-link query parameters if selected. External native links, web location
queries, and application-generated navigation parameters are relevant input
sources; application/internal strings have no universal Router length cap.
Router's active `fork/getStateFromPath-forks.js` instead uses URLSearchParams;
its outgoing `getPathFromState` helpers call stringify, which does not decode.
That distinction reduces exposure in today's navigation setup but does not make
the bundled decoder or future use of the public core helper unreachable.

Baby locks decoder 0.2.2. `app/+native-intent.tsx` rejects paths longer than
8,192 JavaScript characters, control characters/backslashes and malformed URI
encoding before routing; OAuth/share receipts are handled by their bridges.
Those checks are specific to native system intents, not a general bound on
web queries or internal navigation strings. No global decoder size limit or
unreachability guarantee is claimed.

The registry still has no patched 0.2.x/0.3.x; query-string 7 ends at 7.1.3 and
Router 57 ends at 57.0.29 with the same dependency. The only patched decoder,
0.5.1, is default-only ESM (`type: module`). A bounded Node 22.22.2 compatibility
probe substituted its published entry for query-string's required decoder:
`queryString.parse('x=abc')` throws `TypeError: decodeComponent is not a function`.
A blind override is therefore not accepted as a safe fix. This temporary
exception explicitly accepts the remaining client availability risk until the
existing deadline; adopt a supported compatible Router/parser fix or a reviewed
CommonJS backport, then remove the exception. New routing consumers or changed
dependency provenance require reassessment before that deadline.

### deepmerge:1243505 (low)

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
affects deepmerge 4.3.1; it is still the latest registry release and no patched
version is listed. Expo 57.0.31 → @expo/config 57.0.10 → deepmerge 4.3.1 is the
installed path. `@expo/config/build/Config.js` uses it in
`mergeConfigModifications` for root Expo config and plugin option objects.
These are repository/developer-controlled build/configuration inputs. Untrusted
config/plugin objects could poison the returned object's prototype; this review
does not permit those inputs or claim the primitive is safe.

No application source imports deepmerge or @expo/config as a runtime value.
Baby/Workouts' `ExpoConfig` imports are type-only and erased. Fresh native source
maps exclude deepmerge and @expo/config; their existing bundle gates now reject
either package if future exports introduce it. This is a config/build-time
exception, not a shipped native merge endpoint. Recipe/workout/Baby source
imports, chat and shared content are not passed to this build configuration API.

The app audit retains its unchanged whole-lockfile SHA-256 fingerprint and adds
only these two exact advisory IDs. Unknown advisories, critical findings, lock
changes and expiry continue to fail the gate.

Validation results:

Node 22.22.2 validation: fresh `npm ci`, full app tests (338 passed),
`npm run typecheck`, Doctor (21/21), and `npm run audit:runtime` pass. `npm run export:all` (iOS/Android/web) and the strengthened
`npm run check:native-bundles` pass. Native source maps retain query-string, the decoder and the
core parsing helper, and contain no deepmerge or @expo/config sources:

- Android: 1,760 sources; SHA-256 `478e7ee6c858c9d08f91d4a08518d3ccf3721fee0c4c83abdab57ea350cff8f6`.
- iOS: 1,626 sources; SHA-256 `de12e514c08d14a76abb49a4192f9e6c3c060333da76f669e0c9d99858145712`.

Exports use `EXPO_NO_DOTENV=1` and two Metro workers. Evidence (logs,
compatibility probe and source-map inventory) is retained outside Git at
`output/hafa-impl-2026-10-30/apps/audit-advisories/` under the ShimizuTechnology
root. No simulator, OAuth, DB, Clerk or installed-app journey test is claimed;
no application behavior changes. Only the three app sections of
`scripts/check.sh` are exercised, per the task's overloaded-host constraint.

## Dependency advisory fixes and build-tool review — 2026-10-31

Reviewed from `origin/main` at `f449f6fe`. Targeted
`npm update follow-redirects node-forge --package-lock-only --ignore-scripts`
changes only the installed Forge node in each app and the follow-redirects node
in Recipes (plus npm's Forge license metadata). No manifest, Expo, React Native,
Router, or other lock node changes. Fresh `npm ci` installs the reviewed locks.

Forge **1.4.2** fixes `1240912` and `1244014`–`1244024`; remove the old 1.4.0
exception rather than renewing it. Recipes' follow-redirects **1.16.2** fixes
`1244003`. Workouts and Baby contain no follow-redirects node.

New temporary exceptions: [glob:1244013](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
and [minimatch:1244012](https://github.com/advisories/GHSA-g3hv-75wg-m249), both
moderate. The fixes are glob 14.0.2 and minimatch 11.0.1; installed parents
require glob ^13 and minimatch ^10, so neither fix is semver-compatible.
No major override is accepted. Keep the existing review window:
**2026-10-24T00:00:00Z ≤ now < 2026-11-17T00:00:00Z**.

Glob can continue filesystem traversal after cancellation; minimatch can amplify
attacker-supplied patterns and exhaust CPU/memory. Installed consumers are Expo
CLI/config/config-plugins/fingerprint/Metro configuration; Recipes also has
expo-updates' Node-only `utils/build/vcs.js`. Fingerprint's `utils/Path.js` uses
minimatch for repository file matching, and glob itself declares minimatch.
These process developer-controlled local files/configuration during builds;
recipe/workout/Baby content does not supply their patterns. Application source
imports neither package. Native source maps must exclude both before accepting
these exceptions. Untrusted repositories/configuration remain outside this review.
Workouts/Baby native bundle checks now reject either package if introduced.

Recipes pins the exact package and declaring-parent versions/integrities and
all declaring ranges/kinds below, rejecting additional parents or nested copies.
Workouts/Baby retain their existing whole-lock SHA-256 policy, which pins all
versions, integrities and declarations (including those below), failing on any
lock change. Regression tests cover the new IDs, provenance drift, expiry,
unknown IDs, and removal of the old Forge acceptance. Existing unrelated
exceptions retain their prior limitations; no runtime-risk acceptance is added.

Reviewed baby-mobile lock SHA-256: `a37f770d41a5c7a0820729e988d1ba721884bc1494de69cb6030978579e6803f`.

| Package/path | Version | Integrity |
|---|---|---|
| `node_modules/@expo/config` | 57.0.10 | `sha512-YpexTqLWEXdbbXgHh7Zhpq+qA5diuvO46lb7TiY81JwqKLAl9zK31APY1D7jUFlDX56owje5RtK0o5bMmGIMUg==` |
| `node_modules/@expo/config-plugins` | 57.0.11 | `sha512-lnNF0cNXqLQPpQVeb/AAu7O0KhdwMFx99rJkO11mrd0IbQDhnOVObpgaR/Ja2D1jAOoKuqk55jwS4l+ZD1j7aw==` |
| `node_modules/@expo/fingerprint` | 0.20.14 | `sha512-7sihStGX1ZepJBNbYgeQY7cU2GQ+PSkSROe3g7JOQqnT6OOuX0rXKY0ZNoVnlB2Y/H5FWnnJ6QrPlK3fNg9+bQ==` |
| `node_modules/@expo/metro-config` | 57.0.13 | `sha512-r+YCwqh8FM5cymkC3MdYO32DqLZQ2wDWkGEnzwgwI40Bj355BvL4XoY0hGgao9vNHjYa7be7XxbVqtMTi76snw==` |
| `node_modules/expo/node_modules/@expo/cli` | 57.0.32 | `sha512-3p1qL/pvWblGNwDE1bt2wh/NUiGpSer61s5GKKFfpEpBkZTYnqve0pdK1UvEFzJGT6PW9vX2RofQQ2LP6MgvDQ==` |
| `node_modules/glob` | 13.0.6 | `sha512-Wjlyrolmm8uDpm/ogGyXZXb1Z+Ca2B8NbJwqBVg0axK9GbBeoS7yGV6vjXnYdGm6X53iehEuxxbyiKp8QmN4Vw==` |
| `node_modules/minimatch` | 10.2.6 | `sha512-vpLQEs+VLCr1nU0BXS07maYoFwlDAH0gngQuuttxIwutDFEMHq2blX+8vpgxDdK3J1PwjCJiep77OitTZ4Ll1A==` |

Declaring dependencies (all are `dependencies`, no optional/peer/dev declarations):

- `glob`: `node_modules/@expo/config` → `^13.0.0`, `node_modules/@expo/config-plugins` → `^13.0.0`, `node_modules/@expo/fingerprint` → `^13.0.0`, `node_modules/@expo/metro-config` → `^13.0.0`, `node_modules/expo/node_modules/@expo/cli` → `^13.0.0`.
- `minimatch`: `node_modules/@expo/fingerprint` → `^10.2.2`, `node_modules/glob` → `^10.2.2`.
