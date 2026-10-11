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
