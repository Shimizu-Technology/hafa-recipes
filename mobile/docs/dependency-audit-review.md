# Temporary build dependency audit exceptions

Reviewed October 4, 2026, refreshed October 9 for SDK 57 patches; expires November 3, 2026 at 00:00 UTC. These exceptions do not patch the affected packages. `npm run audit:runtime` fails after expiry or if the reviewed dependency tree changes.

Follow-up: [reassess the exceptions before November 3](https://github.com/Shimizu-Technology/hafa-recipes/issues/123). Expiry rejects the reviewed advisory when it is present; it does not reject an audit with no affected advisory.

| Advisory | Locked package | Exposure |
|---|---|---|
| [CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), npm source 1240992 | braces 3.0.3 | Recursive pattern parsing can crash a Node process. In this tree, micromatch brings it into Metro file watchers and workspace discovery. Inputs come from repository/build configuration. |
| [CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv), npm source 1240912 | node-forge 1.4.0 | RSA signature verification accepts extra nested ASN.1 elements. Its declaring parents are Expo CLI and Expo's code-signing certificate utility. That utility does verify certificates/CSRs and signatures; the affected primitive exists in build tooling. |

The primary advisories list no patched versions. Registry queries on the review date confirm that these locked versions remain the latest published releases. Forge has an [upstream fix PR](https://github.com/digitalbazaar/forge/pull/1152); it is not a published dependency update we can adopt yet.

The review's real iOS release source map contained 2,877 sources and no node-forge, braces, or micromatch source. The app's recipe inputs therefore do not reach these packages in that bundle. This is evidence about the reviewed bundle, not a general claim that build tooling is safe. Builds must use reviewed repository patterns and developer-controlled signing material; attacker-supplied patterns, certificates, or CSRs can still expose the tooling vulnerability.

The policy pins package and parent versions/integrities, exact declaring parents and dependency ranges/kinds, and rejects nested duplicate installations. Tests cover changed metadata, additional runtime parents, changed advisory IDs, and expiry. Before extending the review or changing these packages, check upstream releases, regenerate the actual iOS release bundle with source maps, inspect reachability and signing inputs, and document the result. Prefer an upstream patched release when one becomes available; remove the corresponding exception then.


## October 9 release-gate refresh

The 2.6.11 candidate updates eight Expo SDK 57 packages to their recommended compatible patches. React Native remains 0.86.3 and Expo remains SDK 57. This changes the reviewed build-tool parents to `@expo/cli` 57.0.28 and `@expo/metro-file-map` 57.0.4. Their new versions and registry integrities are pinned in the policy; the November 3 deadline is unchanged. The 57.0.4 wrapper no longer declares micromatch directly; the policy accepts only the two remaining declarations from metro-file-map and workspace discovery.

Two available compatible updates were adopted instead of accepting their advisories: `shell-quote` 1.9.0 → 1.12.0 ([command-injection fix](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)) and `source-map-js` 1.2.1 → 1.2.2 ([indexed-source-map fix](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)). Their parent ranges remain compatible (`react-devtools-core` requests `^1.6.1`; PostCSS requests `^1.2.1`). No critical finding remains.

A production-mode iOS JavaScript export from `2a05589` plus these dependency patches completed with `EXPO_NO_DOTENV=1`, source maps enabled, and bytecode disabled for inspection. The map contains 2,939 sources, with zero matches for `node-forge`, `braces`, `micromatch`, `stream-json`, `jayson`, `@solana/web3.js`, `shell-quote`, or `source-map-js`. Map SHA-256: `5615511762a9b630821ed82cbf33ef0d32598818c9b6821c2fc009c0eae44cff`. This is bundle/reachability evidence, not device QA or evidence of an App Store/TestFlight artifact. The export artifacts stay outside Git. The final integrated release must retain these dependency paths and receive the normal native build and affected-flow checks.

`braces` 3.0.3 and `node-forge` 1.4.0 remain the latest registry versions on October 9. Their vulnerable primitives and trust constraints are unchanged: repository-controlled patterns reach Metro/workspace tooling, and developer-controlled signing material reaches Expo's certificate tooling. The native recipe input paths do not reach either package in the inspected bundle. The exceptions still reject changed package/parent versions or integrity, declarations, dependency kinds, nested installations, and expiry.

Two additional moderate advisories concern the already reviewed `stream-json` 1.9.1 tree:

- [JSONC comment scanning, source 1241262](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x) affects JSONC parser/verifier entry points. The locked 1.9.1 package has no JSONC modules. Jayson's utility imports the plain JSON verifier and `StreamValues`.
- [Assembler prototype replacement, source 1241263](https://github.com/advisories/GHSA-mjw6-4jj6-33hc) concerns a primitive used by `StreamValues`. The vulnerable package is still present in the dependency tree; it is absent from the inspected native bundle. Jayson's streaming utility is used by its optional TCP/TLS clients and servers, under the unused Clerk → Solana wallet → web3 chain. Håfa exposes no Solana wallet or Jayson TCP/TLS interface and imports neither Jayson nor stream-json.

The registry has no patched 1.x stream-json release. Published fixes are 3.6.0 or newer, whereas Jayson requires `^1.9.1`; overriding it across major versions would change its CommonJS entry-point contract. The three stream-json advisories therefore share an expiring exception for the exact reviewed native wallet chain, not a package-wide acceptance. The policy now pins all chain ranges/kinds as well as versions/integrities, rejects new declaring parents and nested copies, and expires November 3 without renewal. Tests cover each advisory's accepted provenance and fail-closed boundaries. Reassess or remove these exceptions before exposing any wallet/streaming path or changing the native bundle/dependency provenance.

Final integrated source `1c517362c6e2f3bba9c9ae00aee7c5667c46b33e` was exported
with the same production-mode settings after the multipart/playback fixes. Its
2,958-source iOS map contains none of the eight packages listed above. Map
SHA-256: `d21214340bca40e865eb1fe79d6ce94f67acab8e1f7b31c1c860dc29e4c816b0`.
Bundle SHA-256: `79e303c61cc0593bf0689c734e8f40cc6d8f3a1edde836fbef8dccda5198f5b7`.
These artifacts remain outside Git; native QA and EAS release evidence are
recorded separately in `docs/RECIPE-COVER-SELECTION.md`.

## October 14 SDK 57 patch refresh

Against `ffd9768` plus this dependency patch, official Expo install checks align
Expo 57.0.29, asset 57.0.20, auth-session 57.0.16, constants 57.0.22,
linking 57.0.13, notifications 57.0.23 and Router 57.0.27. Fresh Node 22.22.3
installs apply the existing share-intent patch. No native app configuration,
widget module, React Native version or advisory exception changes.

Expo CLI advances to 57.0.30. Its installed signing helper and certificate
utility are byte-identical to the previously installed versions. Forge 1.4.0
and braces 3.0.3 remain unchanged and remain the latest registry versions on
this review date. Their build/signing trust boundaries above still apply.
Only the CLI's exact version/integrity fingerprint changes in the audit policy;
additional parents, changed edges, nested copies and expiry still fail closed.

Fresh iOS/Android Hermes exports contain 2,913/2,997 sources. Both select native
Clerk and the Router fork; neither includes forge, braces, micromatch, stream-json,
Jayson or Solana sources. Export used explicit preview configuration with a
nonproduction fixture API URL; no authentication or device acceptance is claimed.
The iOS map SHA-256 is `2b761d21165fc46d76683d37092292cb1277c1e8105b754f8ec55ae0a25faa3b`;
Android is `fa6074c8627cb7100cb59d4c8952724a7531c9dba5f994d3df94f4e034f2e4e4`.

Production audit retains 48 inherited findings, the same advisory IDs and zero
critical or unexpected findings. All 831 tests, typecheck and Doctor 21/21 pass.
The November 3 expiry remains unchanged. Fresh native builds and normal affected
journeys remain release gates; these exports are dependency reachability evidence.


## October 16 SDK 57 patch alignment

Against `ad16ff8`, Expo 57.0.30 and Router 57.0.28 align with Doctor's current
SDK 57 recommendations. Their required transitive patches are UI 57.0.25,
CLI 57.0.31, router-server 57.0.13 and Babel preset 57.0.16. All other lock nodes,
metadata and edges are unchanged. Fresh Node 22.22.3/npm 10.9.8 `npm ci` passes
and applies the existing share-intent patch. Typecheck, Doctor 21/21, all 831
tests and the production audit pass: 48 inherited findings, 12 reviewed advisory
IDs and zero unexpected findings. The CLI signing helper and certificate utility
are byte-identical to the previously reviewed installation. Only the exact CLI
version/integrity fingerprint is renewed; no advisory or expiry changes.

Fresh preview-configured iOS/Android Hermes exports contain 2,913/2,997 sources,
select native Clerk and the Router fork, and exclude forge, braces, micromatch,
stream-json, Jayson and Solana. Map SHA-256: iOS
`afa7842e4bceb1610a7975667fae2969e854c409fa520ceaad4e5a4caf9f2073`;
Android `80e00ff8d448cbca40731ef58bec0f3d64169bdf73417c57b8a189f41a17611f`.
An additional web static export failed with a tslib `__extends` destructuring
error; it is not claimed passed or diagnosed here. Native builds and share,
OAuth and navigation acceptance remain release gates. UI 57.0.25 includes an
[Android TextInput placeholder style fix](https://github.com/expo/expo/blob/396da4641605bb19c1e6b3efff1cafaab8890a29/packages/expo-ui/CHANGELOG.md#57025--2026-10-15),
so installed binaries must be rebuilt to exercise that native change.


## Dependency review renewal — 2026-10-24

Reviewed `mobile/package-lock.json` from `fca37f99` with the audit-policy renewal.
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
→ Clerk JS 6.29.3 → Base account 2.0.1 → ox 0.6.9 / viem 2.55.19
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

The Recipes policy renews CLI's exact version/integrity for node-forge and adds
Zod using the existing package/declaration review. It pins every wallet-chain
version/integrity and declaring parent/range/kind, including both reviewed nested
copies. Unreviewed copies, changed metadata/edges and expiry still fail closed.
Regression tests exercise those rejection paths. Native Clerk is the same
6.29.3 source selected by the fresh Workouts bundles; Recipes app source has no
wallet entry points. No fresh Recipes device or export test is claimed here.

The current production audit reports 22 findings, zero critical, and these direct
advisories: node-forge 1.4.0 (`1240912`), stream-json 1.9.1 (`1164823`, `1241262`,
`1241263`), uuid 8.3.2 (`1119441`), and Zod 3.25.76 (`1243066`). Existing
image-size, PostCSS and braces allowlist entries are retained; the current registry
report does not emit those advisories. Their prior trust constraints still apply.
The stream-json review window is renewed with the unchanged Clerk/Solana tree;
app code still does not invoke its socket/JSON filtering path.

Validation on 2026-10-24 under Node 22.22.2: `npm ci`, `npm test` (1,122),
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

Recipes already overrides decoder 0.2.2 to **0.5.0** on main. That release is
also affected by this new advisory. Recipes has no `+native-intent` URL guard;
no application-wide pre-Router input cap was found. The existing ESM override
also makes the public core helper's query-string.parse throw on ordinary query
input under Node 22.22.2. This is pre-existing compatibility debt, not proof of
security: direct/default-import decoding still has the quadratic-work risk,
and the helper can break if selected. This policy change leaves routing and
dependencies unchanged and does not claim to repair that fallback helper.

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
maps exclude deepmerge and @expo/config; Baby/Workouts bundle gates now reject
either package if future exports introduce it. Recipes also receives a fresh
iOS source-map inspection in this review. This is a config/build-time
exception, not a shipped native merge endpoint. Recipe/workout/Baby source
imports, chat and shared content are not passed to this build configuration API.

The Recipes policy pins the package/parent versions and integrities, exact
declaring parents/ranges/kinds and rejects new nested copies. Both new advisories
receive the existing policy regression cases for those boundaries and expiry.
Existing stream-json/uuid acceptances are unchanged.

Validation results:

Node 22.22.2 validation: fresh `npm ci`, full app tests (1,142 passed),
`npm run typecheck`, Doctor (21/21), and `npm run audit:runtime` pass.
Recipes additionally exports iOS with source maps. Native source maps retain
query-string, the decoder and the
core parsing helper, and contain no deepmerge or @expo/config sources:

- iOS: 2,913 sources; SHA-256 `86958206319dd08f905ed9e29b490a7fcfbcdd3ad94c52550265e2eebdda925b`.

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

Reviewed mobile lock SHA-256: `cb68c92c3523e7ed63adcbbb88de710115c5a42fdc0338a30ae6ae18c001fc5b`.

| Package/path | Version | Integrity |
|---|---|---|
| `node_modules/@expo/cli` | 57.0.32 | `sha512-3p1qL/pvWblGNwDE1bt2wh/NUiGpSer61s5GKKFfpEpBkZTYnqve0pdK1UvEFzJGT6PW9vX2RofQQ2LP6MgvDQ==` |
| `node_modules/@expo/config` | 57.0.10 | `sha512-YpexTqLWEXdbbXgHh7Zhpq+qA5diuvO46lb7TiY81JwqKLAl9zK31APY1D7jUFlDX56owje5RtK0o5bMmGIMUg==` |
| `node_modules/@expo/config-plugins` | 57.0.11 | `sha512-lnNF0cNXqLQPpQVeb/AAu7O0KhdwMFx99rJkO11mrd0IbQDhnOVObpgaR/Ja2D1jAOoKuqk55jwS4l+ZD1j7aw==` |
| `node_modules/@expo/fingerprint` | 0.20.14 | `sha512-7sihStGX1ZepJBNbYgeQY7cU2GQ+PSkSROe3g7JOQqnT6OOuX0rXKY0ZNoVnlB2Y/H5FWnnJ6QrPlK3fNg9+bQ==` |
| `node_modules/@expo/metro-config` | 57.0.13 | `sha512-r+YCwqh8FM5cymkC3MdYO32DqLZQ2wDWkGEnzwgwI40Bj355BvL4XoY0hGgao9vNHjYa7be7XxbVqtMTi76snw==` |
| `node_modules/expo-updates` | 57.0.26 | `sha512-Dloc9rkoR22qx2HtxzDHOZQcU5rABqsvl8QWA0gFx8N6mHicTdbaxuQ6QCK/wp5fXAK6DQnfzTiQtvJ5IfMTew==` |
| `node_modules/glob` | 13.0.0 | `sha512-tvZgpqk6fz4BaNZ66ZsRaZnbHvP/jG3uKJvAZOwEVUL4RTA5nJeeLYfyN9/VA8NX/V3IBG+hkeuGpKjvELkVhA==` |
| `node_modules/minimatch` | 10.2.6 | `sha512-vpLQEs+VLCr1nU0BXS07maYoFwlDAH0gngQuuttxIwutDFEMHq2blX+8vpgxDdK3J1PwjCJiep77OitTZ4Ll1A==` |

Declaring dependencies (all are `dependencies`, no optional/peer/dev declarations):

- `glob`: `node_modules/@expo/cli` → `^13.0.0`, `node_modules/@expo/config` → `^13.0.0`, `node_modules/@expo/config-plugins` → `^13.0.0`, `node_modules/@expo/fingerprint` → `^13.0.0`, `node_modules/@expo/metro-config` → `^13.0.0`, `node_modules/expo-updates` → `^13.0.0`.
- `minimatch`: `node_modules/@expo/fingerprint` → `^10.2.2`, `node_modules/glob` → `^10.1.1`.

Fresh Recipes Node 22.22.2 iOS/Android exports contain 2,936/3,020 sources and
exclude glob and minimatch. Hermes map SHA-256: iOS
`926c8fe07c418536c8193ac813d0e6ff1b04f0ee73f1734b1967032d98d3a4b9`;
Android `5b3150a5284efa003244035383ec39211d53899e0ae1568354a6b0f14e184111`.
The extra all-platform export again fails web static rendering with the previously
recorded tslib `__extends` error; the separate native exports pass. No installed
app, authentication, simulator or user-data journey is claimed for this tooling change.
