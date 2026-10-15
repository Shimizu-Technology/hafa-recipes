# Workouts dependency reachability review

Reviewed 2026-10-10 against `/tmp/hafa-workouts-native-audit.json` and
`workouts-native-integration/workouts-mobile` at `9a80381`, including its current
uncommitted SDK57 manifest/lockfile changes. Installed versions matched the five
requested findings. This is a bounded review of those findings, not clearance of
all 49 audit entries. No root manifests or installed modules were modified.

The npm production classification includes Expo build tooling and optional web
wallet dependencies. It does not prove a package or vulnerable call is shipped
or reachable in the native runtime. A final platform bundle/source-map inspection
is still required after lockfile changes; this review traced installed source.

## decode-uri-component 0.2.2

Path: Expo Router57.0.25 → query-string7.1.3 → decode-uri-component0.2.2.
The decoder's malformed percent-encoding recovery is vulnerable to CPU denial of
service. The fixed version is 0.5.0. [Official advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr).

The package can enter the native bundle, but current incoming routing selects
`getLinkingConfig.js:90` → `link/linking.js` → `fork/getStateFromPath.js:525` →
`fork/getStateFromPath-forks.js:370`, which uses URLSearchParams. URL extraction
also uses built-in decoding with exception fallback. The Router's outgoing calls
to query-string use stringify, which does not invoke the vulnerable decoder.

The bundled public default `react-navigation/core/getStateFromPath.js:499`
**does** call query-string.parse. Instrumenting the installed decoder with the
small input `/shared/fixture?input=%C2%C2%C2%C2` observed zero calls for the active
fork's parseQueryParams and two for the default core helper. No application
import or custom linking configuration selecting that helper was found. This is
conditional runtime exposure if navigation configuration or imports change.

Do not blindly override the decoder to0.5: its published export is default-only
ESM, while query-string7 directly requires a callable CommonJS export. Likewise
query-string9.5.1 exposes default-only ESM, incompatible with Router57's
queryString.stringify namespace call. Minimal immediate hardening is a bounded
incoming URL guard before routing via native-intent, preserving legitimate OAuth
callbacks and share links, plus a regression proving the active parser never
invokes the legacy decoder. A maintained CommonJS backport of the official
linear-time fix is an option if policy requires eliminating installed vulnerable
code. Prefer a supported Router release that changes its dependency; npm's
suggested major Router upgrade is not evidence of SDK57 compatibility.

## braces 3.0.3

Path: Metro-file-map0.84.5 → micromatch4.0.8 → braces3.0.3. Recursive AST walkers
can exhaust the stack on deeply nested **patterns**. Latest braces remains3.0.3;
the advisory lists no published fix. [Official advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

The only external installed consumer found was Metro watcher
`metro-file-map/src/watchers/common.js:23`: micromatch.some(relativePath,globs).
Globs come from build configuration; file paths are matcher subjects and do not
become brace patterns. No Workouts runtime consumer or user-source-to-pattern
path was found. Treat repository/configuration globs as a build trust boundary,
not arbitrary user input. Do not follow the audit's React Native0.72 downgrade:
it is incompatible with the current Expo57/React Native0.86 stack and does not
establish a brace fix. If configurable untrusted patterns are introduced, add a
pre-parse depth/size gate or maintained patch; test nested brace patterns and
normal Metro patterns. Revisit when Metro/configuration dependencies change.

## node-forge 1.4.0

Paths: Expo CLI57.0.28 directly and its code-signing-certificates0.0.6. PKCS#1 v1.5
verification can accept malformed nested digest algorithms for low-exponent RSA
keys. Latest remains1.4.0 with no published fix. [Official advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

Actual vulnerable calls exist in code-signing-certificates/main.js:176
certificate.verify, :203 publicKey.verify, and :246 CSR.verify. CLI
utils/codesigning.js:308 validates configured local certificate/key pairs; :401
signs and verifies generated development manifests. CLI iOS Security.js parses
local Keychain certificates without using the vulnerable signature verification
call. Generated Forge RSA keys default to exponent65537. Configured certificates
must also match the local private key. No workout data, Clerk login/JWT validation,
or application JS certificate path was found. Apple distribution verification
uses platform signing rather than these JS helpers.

Keep these Node development/signing paths restricted to trusted owned
certificates/keys, and reject imported low-exponent keys if code-signing inputs
are enabled. Do not label all forge usage safe: untrusted CSR/certificate
verification is specifically affected. Track the official validation fix and
adopt its released version or a reviewed maintained backport. Test valid signing
fixtures and rejection of the advisory's malformed signature before relying on
this package to validate untrusted signatures.

## stream-json 1.9.1

Path: Clerk SDK web wallet dependency → Solana web3.js1.98.4 → Jayson4.3.0 →
stream-json1.9.1. The three advisories cover path-filter complexity, JSONC comment
rescanning, and assembled-object prototype injection. Fix all with3.6 or later.
[Filter advisory](https://github.com/advisories/GHSA-528h-pc64-c93x),
[JSONC advisory](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x),
[Assembler advisory](https://github.com/advisories/GHSA-mjw6-4jj6-33hc).

Jayson utils.js:80 reaches StreamValues.withParser and its Assembler from TCP/TLS
client/server parseStream. A tiny isolated installed-package probe confirmed
`{"__proto__":{"isAdmin":true},"name":"fixture"}` yields inherited isAdmin=true
with no own isAdmin property. Object.prototype globally remained unchanged.
Jayson uses the plain JSON verifier, not JSONC, and does not select path filters;
those two vulnerable calls are absent from this consumer.

Clerk's published react-native condition selects clerk.native.js, which contains
no Jayson/Solana wallet chain. The web/browser Solana path explicitly imports
jayson/lib/client/browser, whose response parser uses JSON.parse and never loads
parseStream/Assembler. No application streaming JSON or TCP/TLS Jayson endpoint
was found. The prototype flaw remains real for a future Node Jayson socket
consumer; do not extend this conclusion to that service.

A direct stream-json3.6+ override is incompatible: it is ESM and renames entry
paths, while Jayson4 requires `stream-json/streamers/StreamValues` and
`stream-json/utils/Verifier`. Published Jayson5 removes stream-json and uuid and
retains the browser client API, offering a candidate scoped fix. It is a major
outside Solana's declared ^4.1.1 range, so first test Solana/Jayson request/response
compatibility and native/web exports, including global crypto availability.
Alternatively use an upstream supported Solana/Clerk dependency update. Do not
claim npm's fixAvailable boolean proves that compatibility.

## uuid 7.0.3 and 8.3.2

Paths: Expo config-plugins → xcode3.0.1 → uuid7; Jayson4 → uuid8. The advisory is
specific to v3/v5/v6 with caller-provided undersized buffers or invalid offsets;
v4 is not affected. [Official advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

xcode/pbxProject.js:90 calls v4() then formats a24-character project ID.
Jayson browser/generateRequest/utils call v4() with no buffer. Small installed
probes produced valid project/RPC IDs. No vulnerable variant/buffer call was
found in either consumer; Workouts application IDs use Expo Crypto.randomUUID.
A separate rpc-websockets dependency already has patched uuid14.0.2.

Minimal candidates are **scoped** xcode/Jayson overrides to uuid11.1.1, the
maintained CommonJS-compatible patched legacy release (official legacy-11 tag).
Do not globally override to11 and downgrade the safe14 branch. Verify xcode ID
format/uniqueness, browser RPC IDs and crypto availability, Expo doctor, native
prebuild/export and login/share flows. Jayson5 adoption would remove its uuid8
finding instead. These are targeted candidates requiring integration tests,
not a blanket advisory exception or a reason to downgrade the native stack.

## Release checks

After any fix, rerun a fresh npm audit on the exact lockfile and record remaining
individual advisories. Export iOS/Android/web bundles with source maps and verify
the stated package selection. Exercise cold/warm share deep links, malformed
percent-encoding under a strict time budget, OAuth return paths, normal navigation,
and development code-signing if enabled. Retest these conclusions whenever Router,
Clerk, Metro, signing, or RPC paths change. No app server, browser, simulator,
container, provider call, or production mutation was used in this read-only audit.


## Integrated lockfile gate (2026-10-10)

Scoped xcode/Jayson uuid11.1.1 overrides are installed; a fresh audit now reports32 inherited package findings, six individual advisories, zero critical. Remaining exceptions are the exact reviewed braces, decoder, node-forge and stream-json paths described above. Workouts has its own audit script; it pins the complete lockfile digest and six advisory IDs and expires2026-11-03. Any dependency tree change, new advisory, critical finding, invalid audit response or expired review fails the gate. No Recipes exceptions are copied. Native source-map reachability and real incoming-link/OAuth acceptance remain required verification; this policy alone does not prove them.


Fresh Hermes source maps for both iOS and Android select Clerk's native build and the Expo Router fork. No jayson, stream-json, node-forge or braces source is present in either native bundle. The legacy decoder and React Navigation fallback remain bundled; absence is not claimed. A CI source-map gate checks the native selection and absent paths after export, while actual cold/warm incoming-link behavior remains an independent QA gate.


Vitest is patched to4.1.11 for [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). npm10's update hit an Arborist optional-peer graph exception; npm11.6.2 resolved the dev patch but dropped optional SDK peers. The previously verified SDK/React peer graph was preserved, only the resolved Vitest/dev changes retained, and `expo-auth-session~57.0.14` declared directly because Clerk SSO requires it. Normal npm ci passes on the resulting lock, with no changed production tarball/edge metadata. The reviewed lock digest was renewed; affected gates are rerun. No legacy-peer flags or React/native downgrade was introduced.


## Mounted bootstrap regression test dependency (2026-10-10)

The bootstrap follow-up from native base `021ea44` adds the exact React-matching
`react-test-renderer19.2.3` and explicit `@types/react-test-renderer19.1.0` as dev
dependencies. The renderer is deprecated but supplies a mounted React/StrictMode
regression for the actual provider without a device or production credentials.
These tests do not establish iOS/Android interaction acceptance.

Compared every lock node for version, resolved URL, integrity, dependencies, peer
dependencies and metadata, and dev/optional/peer flags. No existing package
version, tarball or dependency/peer edge changed. The only new node is the
`dev:true` renderer; it uses existing React, react-is and scheduler versions. npm
removed the types node's peer-only flag after its direct dev declaration, and
normalized expo-auth-session's optional/peer flags because it was already a
direct runtime dependency. This changes classification, not its code or edges.

Fresh iOS and Android Hermes dependency source sets match the existing native
integration exports: 1551 iOS modules and 1554 Android modules, zero added or
removed dependency sources. The test renderer is absent; the native bundle
selection gate passes. The renewed lock SHA-256 is
`85ccf9df501a5ac0a4179a91fe165776a775d07dfae00d146c873af2bc6cb6f4`.
A fresh audit retains 32 inherited package findings, the same six advisory IDs,
zero critical and zero unexpected findings. The expiry remains 2026-11-03.
No runtime package upgrade or new advisory exception is included.


## Expo SDK 57 patch refresh (2026-10-13)

`npx expo install --fix` (Node 22.22.2, npm 10.9.7) aligned SDK 57 patch releases:
expo 57.0.28, @expo/cli 57.0.29, expo-router 57.0.26, @expo/ui 57.0.23,
expo-auth-session 57.0.15, expo-crypto 57.0.4, expo-dev-client 57.0.20,
expo-sharing 57.0.23 and expo-splash-screen 57.0.10, plus their Expo-internal
transitive patches. npm now nests @expo/cli (and its private dependencies) under
`expo/node_modules`; `expo` is its only dependent and `npm ls` is clean. mime-db
was re-hoisted (1.54.0 top-level, 1.52.0 under mime-types). No SDK or React Native
version changed.

A fresh audit retains 32 inherited package findings, the same six advisory IDs,
zero critical and zero unexpected findings. Vulnerable package versions are
unchanged (braces 3.0.3, decode-uri-component 0.2.2 via expo-router 57.0.26 →
query-string 7.1.3, node-forge 1.4.0 via @expo/cli 57.0.29, stream-json 1.9.1).
Fresh iOS/Android Hermes source maps compared with `origin/main` add one module
each (`@expo/ui` searchable modifier on iOS, matchContents util on Android) and
remove none; the native bundle selection gate passes. The renewed lock SHA-256 is
`6b82daf952d9208c568e9033899503eac31cb9c82245fbfd96191436397428c9`.
The expiry remains 2026-11-03. No new advisory exception is included.

## 2026-10-13 lock update: Workouts design-system dependencies

On top of the SDK 57 patch refresh above, `npx expo install` (Node 22.22.2) added
`expo-haptics ~57.0.3`, `expo-image ~57.0.5` and `react-native-svg 15.15.4` (the
SDK 57 versions) for the Workouts design system. The lock gains only those three
packages and react-native-svg's pure-JS CSS helpers (css-select, css-tree,
css-what, domutils, domhandler, dom-serializer, domelementtype, entities, boolbase,
nth-check, mdn-data); no existing package version moved.

`npm audit --omit=dev` still reports the same 32 inherited findings (5 moderate,
27 high, 0 critical) and exactly the six reviewed advisories above; no new
advisory. `check:native-bundles` still finds Expo Router's fork `getStateFromPath`
and native Clerk selected in both Hermes bundles. The reviewed lock SHA-256 in
`scripts/audit-runtime.mjs` is renewed to
`21aa387ac1907783caa565d105190149c5a5121261a976a9f3569538a0a55d4d` for this
lockfile only. The expiry remains 2026-11-03. No new advisory exception is included.

## Expo SDK 57 patch refresh (2026-10-14)

Official Expo install checks against `ffd9768` plus this patch align Expo
57.0.29, UI 57.0.24, auth-session 57.0.16, constants 57.0.22, linking 57.0.13,
notifications 57.0.23 and Router 57.0.27. Transitive asset/core modules and Expo
build tools also advance. Fresh Node 22.22.3 installs preserve the SDK 57 native
configuration, React Native 0.86.3 and scoped overrides.

The fresh production audit retains 32 inherited findings and the same six
advisory IDs, with zero critical or unexpected findings. Vulnerable package
versions remain unchanged. Expo CLI 57.0.30's signing helper is byte-identical
to the previously installed version. The Router 57.0.27 active fork still parses
queries through URLSearchParams; the legacy decoder remains bundled and is not
claimed removed. Registry checks still report forge 1.4.0 and braces 3.0.3 as
latest, so the existing build/signing trust constraints remain required.

Fresh iOS/Android Hermes maps contain 1,816/1,815 sources, select native Clerk
and the Router fork, and contain no forge, braces, micromatch, stream-json,
Jayson or Solana source. The existing native bundle gate passes. Map SHA-256:
iOS `c6170d01acc2f152ffcb07df91a090de55f8d6e0b97eecf1a6826ff5ab27d135`;
Android `7a3ce3e67d5404f4a9abcb48b2a7ac6b81a066b134473ce36d486f4e7bbdc8a0`.
Web export, typecheck, Doctor 21/21 and 693 tests pass; one existing test is skipped.

The exact reviewed lock SHA-256 is renewed to
`ea7153452d99577858a84ae41ecd610b01df922c82705bfd984acda7ef0e1dd6`.
No advisory IDs or exceptions are added, and the 2026-11-03 expiry and all
fail-closed checks remain unchanged. These are bundle/source checks; fresh native
builds and cold/warm share, OAuth and navigation acceptance remain separate gates.


## Expo SDK 57 patch alignment (2026-10-16)

Against `ad16ff8`, Doctor's current recommendations align Expo 57.0.30,
Router 57.0.28 and UI 57.0.25. Their required transitive patches are CLI 57.0.31,
router-server 57.0.13 and Babel preset 57.0.16. All other lock nodes, metadata
and edges remain unchanged, including the scoped overrides. Fresh Node
22.22.3/npm 10.9.8 installs and `npm ls --all` pass. Typecheck, Doctor 21/21,
901 tests (one existing skip), all-platform export and the native bundle gate
pass. The fresh production audit retains 32 inherited findings, the same six
advisory IDs, zero critical and zero unexpected findings. The CLI signing helper,
certificate utility and Router's active query parser are byte-identical to the
previously reviewed installation.

Fresh iOS/Android Hermes maps contain 1,827/1,826 sources, select native Clerk
and the Router fork, and exclude forge, braces, micromatch, stream-json, Jayson
and Solana. Map SHA-256: iOS
`dfcd37ccaa50765de2ec96079a012bf2c9ccc54f3f2ee02f45767b05f2010608`;
Android `97348721c6e162e27dfe983a208a57571eed7b966cdeb194d0254b9eb1a508e0`.
The exact reviewed lock SHA-256 is renewed to
`6989e7eadcf44c8cc7a2b8100c435d60436c1d0e4169443d427564fa544debf4`.
The advisory IDs, November 3 expiry and fail-closed checks remain unchanged.
[UI's Android TextInput placeholder fix](https://github.com/expo/expo/blob/396da4641605bb19c1e6b3efff1cafaab8890a29/packages/expo-ui/CHANGELOG.md#57025--2026-10-15)
requires rebuilt native binaries. Fresh native builds and cold/warm share,
OAuth and navigation acceptance remain separate release gates.

## Coach reading and clipboard on main220 (2026-10-16)

The reading-only mobile integration on `5ae2973` adds Expo Clipboard 57.0.2,
`@believer/react-native-markdown-display` 8.4.1 and Markdown-it 14.3.1. The renderer's
Markdown-it dependency is overridden to 14.3.1. Comparing the frozen lock against
main220 adds exactly seven nodes (these packages plus linkify-it, mdurl,
punycode.js and uc.micro), removes none, and changes no existing non-root node's
version, metadata or dependencies. No speech, recognition, photo transport or
stream consumer is added in this slice.

A fresh ordinary `npm ci` and `npm ls --all` pass for all four apps in the owned
Jerry fixture. Raw `npm audit --omit=dev` reports 33 affected packages (5 moderate,
28 high,0 critical), the same six previously reviewed advisory IDs, and no
unexpected advisory. The renderer inherits the existing React Native tooling
chain, accounting for the extra affected package over the 32-package baseline.
The existing trust constraints and November 3 expiry remain unchanged.

Installed renderer `openUrl.js` and `renderRules.js`, and Markdown-it metadata,
match Recipes byte-for-byte. The URL helper opens only when its app callback
returns true. Coach returns false and requires an explicit app Sheet confirmation
for credential-free HTTP(S) links. Raw HTML is disabled and the app image rule
returns null; the renderer's image source remains bundled and is not claimed
absent. Clipboard reads and subscriptions are unused.

Fresh exports and the native bundle gate at `402a12b` pass. The iOS/Android maps
contain 1932/1931 sources, including 93 source paths under the seven added lock
nodes. Both retain native Clerk and Expo Router's active fork; neither contains
forge, braces, micromatch, stream-json, Jayson or Solana sources. Map SHA-256:
iOS `a9c836fa53ff0a388a0943f97d9ae5d043d3c81cc96470f6b3ecc6a82fc6773b`;
Android `76cda2fbf46364bcea862532c3f29453a97f8598a484ad33b1cda8c4307f4db6`.
These hashes identify the dependency-review export, not later callback fixes.

Only after this fresh install, audit and reachability evidence, the reviewed lock
fingerprint is renewed to
`7ba662fcb3d4a2c98f7aa28980947cd146971562f02166b19b5417c61e8adcf9`.
No advisory exception, expiry or fail-closed behavior changes. Focused tests,
typecheck and Doctor 21/21 pass at the dependency-review head; final callback
regressions and complete repository gate are recorded separately in the task
handoff. This evidence does not establish actual native keyboard, clipboard or
link acceptance. Clipboard adds native code and requires a rebuilt binary.


### Historical reading-only verification — 2026-10-15 UTC (October 16 Guam)

Rechecked the isolated reading/composer slice at `df0159c49be950cd4678e91b46d788ec0b511075`, based on main `153419e4d175282f128b0ee93ae6fba5c8d0d6f8`. This includes the loading-to-conversation scroll-ref correction. Fresh physical `npm ci` and `npm ls --all` passed. The lock is byte-identical to the previously reviewed reading lock: `7ba662fcb3d4a2c98f7aa28980947cd146971562f02166b19b5417c61e8adcf9`. Relative to that historical main commit, seven nodes are added; no existing non-root node changes or is removed. The existing exact fingerprint, six advisory IDs and November 3 expiry remain unchanged.

Fresh raw production audit reports 33 affected packages (5 moderate, 28 high, 0 critical), exactly the six reviewed advisory IDs and zero unexpected advisories. The strict runtime audit passes. Installed Markdown URL helper, renderer rules and parser package metadata remain byte-identical to Recipes' corresponding installed files. This is a renewed check of the existing exception, not an advisory fix.

Typed routes, 211 focused mounted/domain tests, TypeScript, Doctor 21/21, all-platform export and native bundle selection checks passed. Fresh native source maps include clipboard, Markdown, native Clerk and the Expo Router fork; the four reviewed build/socket package paths remain absent:

- iOS: 1932 sources; SHA256 `49cac268764ac80c9a7b37f5eae3f17b75c50f67121053bb30308b4fecebf868`.
- Android: 1931 sources; SHA256 `53554d893a5074278a9d42d98568e01a3f1304e4e15c489e4dcab7a718b73376`.

The loading-to-ready mounted regression failed on the preceding runtime specifically because Jump could not call the mounted scroll ref, then passed after the correction. These results establish dependency reachability and focused engineering behavior. Complete repository checks, actual reading/copy/link/keyboard journeys and native Clipboard acceptance remain separate gates; no device acceptance is inferred from export maps.

The historical verification above records its named source and 211 focused tests; it does not describe the later `3fbc8dee37f82189970620e8a60b8ae3040a3b4e` (212 focused tests). Public reading source `96f4cc16453528eb2b1e2cd32a8377c416f5ac39` subsequently passed 224 focused tests and its complete repository gate on October 15 UTC (October 16 Guam). Browser acceptance for that exact source covered phone and desktop, light and dark; native acceptance remains pending.
