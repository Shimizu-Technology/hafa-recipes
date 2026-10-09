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
