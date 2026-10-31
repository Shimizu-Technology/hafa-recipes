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
28 high, 0 critical), the same six previously reviewed advisory IDs, and no
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

## Official source playback (2026-10-15, original branch evidence)

Workouts now directly declares `react-native-webview 13.16.1`, the exact version
already used by Recipes. Compared with `8d654fc`, the lock changes only that root
dependency edge and removes the existing WebView node’s optional/peer flags.
No package version, resolved tarball, integrity or existing dependency edge changed.

Fresh iOS/Android Hermes maps contain 1,833/1,832 sources and select the native
player and the corresponding WebView platform implementation. Native Clerk and
the Router fork remain selected. Forge, braces, micromatch, stream-json, Jayson
and Solana remain absent. The legacy decoder remains bundled under the existing
constraints; source-player URL handling uses built-in URL parsing. The web
surface opens the original source and does not load a native player.

The fresh production audit retains 32 inherited findings (5 moderate, 27 high),
the same six advisory IDs, zero critical and zero unexpected findings. Typecheck,
Doctor 21/21, all-platform export and native bundle checks pass. The reviewed
lock SHA-256 is `b85b6d57e2b55d250636a53612d5eb06bf1bf04bad074687ace67ba080109d93`.
No exception or advisory ID was added; the expiry remains 2026-11-03.

Players are created only after an explicit tap, use official identified provider
documents, require a play action, and restrict navigation and popups. Instagram
and unsupported sources open externally. Mounted tests cover load/error/timeout,
retry, closure and navigation guards; actual native provider playback, background
closure and return-to-workout acceptance remain required before release.

### Combined SDK patch and source playback (2026-10-16)

Against main `66d7e4b`, fresh Node 22/npm frozen installation and `npm ls --all`
pass. The combined lock changes only the root WebView dependency and removes
optional/peer flags on the existing 13.16.1 node. No package version, tarball,
integrity, or other dependency edge changes. The lock SHA-256 is
`6a11e115f873d356f2d264b3030c946e40b33bf79793a3557292569bff065577`.
The production audit retains 32 inherited findings, the same six advisory IDs,
zero critical and zero unexpected findings; the November 3 expiry is unchanged.

217 affected policy, player, Discover and private-form tests, types, Doctor 21/21,
all-platform exports and native bundle checks pass. Fresh iOS/Android Hermes
maps contain 1,838/1,837 sources, select the native player and WebView as well as
native Clerk and the Router fork, and exclude the reviewed build/socket paths.
Map SHA-256: iOS
`78bf7a7c2cbb0ec80df98362061b0efd47ce33c64682ad5e38b37a572317f18e`;
Android `9d40e370e51e665bdb398f196a0c52720b7b51a1270e539f9a0c1bc98dbac62f`.
These are dependency and bundle checks. Actual native/provider playback,
background closure and return-to-workout acceptance remain required; they have
not passed while device automation is unavailable.


## Source playback with current Coach reading — 2026-10-16 UTC

The isolated `f9b177a` dependency-review source combines official source playback
with the reading and clipboard code on main `ef580ab`. The frozen lock changes
only the root WebView 13.16.1 dependency edge and removes its existing node’s
optional/peer flags. No package version, tarball, integrity or other dependency
edge changes. All current Markdown and Clipboard dependencies remain present;
the original playback-only and historical reading evidence above is preserved.

Fresh ordinary Node 22/npm installs and `npm ls --all` pass in an owned physical
four-app fixture. The complete Workouts production audit reports 33 affected
packages (5 moderate, 28 high, 0 critical), exactly the same six reviewed advisory
IDs and no unexpected advisory. The active WebView iOS/Android sources, Markdown
URL helper and render rules, and Markdown-it metadata are byte-identical to the
corresponding fresh Recipes installation. WebView adds no new advisory exception.

243 affected policy, mounted player, Discover and private-form tests, generated
routes, typecheck, Doctor 21/21, fresh all-platform exports and the native bundle
gate pass. Both native maps select `source-player.native.tsx` and WebView’s
platform `src/WebView` implementation alongside native Clerk, the Router fork,
Clipboard and Markdown. Forge, braces, micromatch, stream-json, Jayson and Solana
sources remain absent. The inherited legacy decoder remains bundled under its
existing constraints; source-player URL handling uses built-in URL parsing.

- iOS: 1,941 sources; map SHA-256
  `1e4b93576b564052952234d14b285745565e2e8f68a19ddffa49aacfb43b4bd4`.
- Android: 1,940 sources; map SHA-256
  `d7bf3f2e54e04085924db64d082f33c71bbc2f0f645563411e493dbe96e3101d`.

Only after this fresh install, complete audit and native-map assessment, the
reviewed lock fingerprint is renewed to
`9fd355c87f67cde153f8bbc8063ccaa10b00c1075f14b35ac9ff8bd7d27b1c47`.
The exact six advisory IDs, November 3 expiry and all fail-closed checks are
unchanged. This is renewed reachability evidence, not an advisory fix. Complete
repository checks on the final source and actual native provider playback,
background/focus closure and return-to-workout acceptance remain separate gates.
A rebuilt native binary is required; export maps do not establish device behavior.


## Dictation and read-aloud with Photo and source playback — 2026-10-16 UTC

The private `4c9cabf` prototype combines accepted Photo 718, dictation 2c3 and
read-aloud 65 on main `f33e523`, including the inline-code text correction. Its
lock adds only the `expo-speech` 57.0.3 and `expo-speech-recognition` 57.1.1 nodes
and root dependency edges. Every inherited package node remains unchanged,
including WebView 13.16.1, Markdown and Clipboard. A fresh ordinary owned install
added 906 packages; the installed dependency tree passed.

Doctor 21/21, fresh iOS/Android/web JavaScript exports with two Metro workers,
and the unchanged native-bundle gate pass on this exact source. Both native maps
include `expo-speech/build/ExponentSpeech.js`, which requires native `ExpoSpeech`,
and `expo-speech-recognition/build/ExpoSpeechRecognitionModule.js`, which requires
native `ExpoSpeechRecognition`. The native module entry files are selected rather
than their `.web.js` alternatives; the SDK's shared `ExpoWebSpeechRecognition.js`
wrapper is also present. Native Clerk, the Expo Router fork, platform WebView,
Markdown and Clipboard remain selected. Forge, braces, micromatch, stream-json,
Jayson and Solana source groups remain absent. The legacy decoder 0.2.2 remains
bundled under its existing conditional Router/fallback constraints; elimination
or unconditional unreachability is not claimed.

- iOS: 1,960 sources; map SHA-256
  `8b76dbf1a949c99bcc0bfddf79ccdf79de97c699610ada606bd71a83e3ed4f89`.
- Android: 1,959 sources; map SHA-256
  `a0ef9b7f223d9d035ca0aec0c18f93bf434c11218c388494057f19cce588e52e`.

The complete production audit reports 33 affected packages (5 moderate, 28 high,
0 critical), exactly the same six advisory IDs and no unexpected advisory.
The reviewed fingerprint is
`a6489ad064e24ab0a2f4e03826935c4b7fe1a50d0ea892c4085e5575b6e88169`.
The exact six advisory IDs, November 3 expiry, date bounds and all fail-closed
checks remain unchanged. This is dependency reachability evidence, not an
advisory fix. The fingerprint is renewed after review of the complete audit,
installed native entry points and both actual native source maps.

The initial composed source passed 412 tests across seven existing suites.
After the inline-code correction, 162 affected read-aloud/Coach tests and types,
routes and dependency-tree checks pass on `4c9cabf`. No complete repository gate,
native prebuild/build, or actual combined speech/photo acceptance has run for
this prototype. Native registration, permissions, recognition availability,
confirmed speech stop before capture, and the photo/voice composer with the
keyboard remain required acceptance. Device speech services may use networking;
these checks make no offline or audible-output claim.

## Markdown-it 14.3.3 and Fraunces (2026-10-21)

Two Markdown-it advisories published on 2026-10-20 (1242600 high, quadratic
smartquotes; 1242646 low, inline HTML parsing) affect 14.3.1, which Workouts
pins directly and through an override. Both pins move to the fixed 14.3.3; the
renderer package is unchanged. `@expo-google-fonts/fraunces` 0.4.1 (font assets
only, no native code; the same package Håfa Recipes ships) is added for screen
titles. A fresh production audit reports 33 affected packages (5 moderate,
28 high, 0 critical), exactly the six reviewed advisory IDs and no unexpected
advisory. The reviewed fingerprint is renewed to
`e626ed7e2eb925dcb26462aba600cf184267d9407814c6346ec9e3368f6d0b23`.
The six advisory IDs, November 3 expiry and fail-closed checks are unchanged.
Recipes takes the same Markdown-it override and `follow-redirects` 1.16.1
(advisories 1242604 and 1242605) through its own audit policy.


## Dependency review renewal — 2026-10-24

Reviewed `workouts-mobile/package-lock.json` from `fca37f99` with the audit-policy renewal.
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

The whole-lock SHA-256 is renewed to
`b642369988a63a06a1e819305b98b3f470575b1f8d06576fcdcf0cc2fbca3686`.
The exact lock fingerprint preserves all installed versions, integrity values and
declaring edges; any lock change still requires review. The reviewed advisory set
retains braces 3.0.3 (`1240992`), decode-uri-component 0.2.2 (`1147955`),
node-forge 1.4.0 (`1240912`), and stream-json 1.9.1 (`1164823`, `1241262`, `1241263`), and adds only Zod 3.25.76 (`1243066`).
The current registry no longer emits the retained braces advisory. Metro globs
remain trusted repository configuration. Router's active native implementation
still selects the fork/URLSearchParams; malformed incoming-link and device OAuth
acceptance remain separate runtime gates. No new decoder exception is added.

Fresh audit: 12 inherited findings, zero critical and zero unexpected.
The unused Clerk/Solana stream-json path is unchanged and absent from both native bundles.
Android: 2000 sources; map SHA-256 `f6ddcdeab1875544e4c6c78397949106cfa0165d250b4126fa117573af7b3b3b`.
iOS: 2001 sources; map SHA-256 `addb3d6cb790560cb4ff941804427ada845f2976a5bf6f076fc9b3ddebabbb88`.
Both Hermes maps select native Clerk and the Router fork and contain no Zod,
abitype, ox, viem, Base/Coinbase wallet, forge, braces or stream-json module sources.
These exports support dependency reachability only; no installed-device journey
acceptance is claimed. Web remains a preview/export surface, not a supported
release target; this review does not approve enabling wallet flows on web.

Validation on 2026-10-24 under Node 22.22.2: `npm ci`, `npm test` (1,594 (one existing skip)),
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

Workouts locks decoder 0.2.2 under query-string. `lib/native-intent.ts` bounds
native system paths to 8,192 JavaScript characters, rejects control characters,
backslashes and malformed encoding, and restricts accepted routes/origins.
These checks do not bound every internal navigation parameter or web URL.
The vulnerable decoder remains bundled; native guards and the active fork are
mitigations, not elimination of the runtime risk.

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

Node 22.22.2 validation: fresh `npm ci`, full app tests (1,597 passed, one existing skip),
`npm run typecheck`, Doctor (21/21), and `npm run audit:runtime` pass. `npm run export:all` (iOS/Android/web) and the strengthened
`npm run check:native-bundles` pass. Native source maps retain query-string, the decoder and the
core parsing helper, and contain no deepmerge or @expo/config sources:

- Android: 2,000 sources; SHA-256 `7fd4544077c8fccc1b6169333ededef3d106d956093a1beca73999057724dc81`.
- iOS: 2,001 sources; SHA-256 `7c802c41d4b49ac43815b22f77b800f9e02ea34628a325bb54f64028a9669438`.

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

Reviewed workouts-mobile lock SHA-256: `8038dba664d741643a91f97578b1b69931973f0de9cd429dcc18f5868dc320dc`.

| Package/path | Version | Integrity |
|---|---|---|
| `node_modules/@expo/config` | 57.0.10 | `sha512-YpexTqLWEXdbbXgHh7Zhpq+qA5diuvO46lb7TiY81JwqKLAl9zK31APY1D7jUFlDX56owje5RtK0o5bMmGIMUg==` |
| `node_modules/@expo/config-plugins` | 57.0.11 | `sha512-lnNF0cNXqLQPpQVeb/AAu7O0KhdwMFx99rJkO11mrd0IbQDhnOVObpgaR/Ja2D1jAOoKuqk55jwS4l+ZD1j7aw==` |
| `node_modules/@expo/fingerprint` | 0.20.14 | `sha512-7sihStGX1ZepJBNbYgeQY7cU2GQ+PSkSROe3g7JOQqnT6OOuX0rXKY0ZNoVnlB2Y/H5FWnnJ6QrPlK3fNg9+bQ==` |
| `node_modules/@expo/metro-config` | 57.0.13 | `sha512-r+YCwqh8FM5cymkC3MdYO32DqLZQ2wDWkGEnzwgwI40Bj355BvL4XoY0hGgao9vNHjYa7be7XxbVqtMTi76snw==` |
| `node_modules/expo/node_modules/@expo/cli` | 57.0.32 | `sha512-3p1qL/pvWblGNwDE1bt2wh/NUiGpSer61s5GKKFfpEpBkZTYnqve0pdK1UvEFzJGT6PW9vX2RofQQ2LP6MgvDQ==` |
| `node_modules/glob` | 13.0.0 | `sha512-tvZgpqk6fz4BaNZ66ZsRaZnbHvP/jG3uKJvAZOwEVUL4RTA5nJeeLYfyN9/VA8NX/V3IBG+hkeuGpKjvELkVhA==` |
| `node_modules/minimatch` | 10.2.6 | `sha512-vpLQEs+VLCr1nU0BXS07maYoFwlDAH0gngQuuttxIwutDFEMHq2blX+8vpgxDdK3J1PwjCJiep77OitTZ4Ll1A==` |

Declaring dependencies (all are `dependencies`, no optional/peer/dev declarations):

- `glob`: `node_modules/@expo/config` → `^13.0.0`, `node_modules/@expo/config-plugins` → `^13.0.0`, `node_modules/@expo/fingerprint` → `^13.0.0`, `node_modules/@expo/metro-config` → `^13.0.0`, `node_modules/expo/node_modules/@expo/cli` → `^13.0.0`.
- `minimatch`: `node_modules/@expo/fingerprint` → `^10.2.2`, `node_modules/glob` → `^10.1.1`.
