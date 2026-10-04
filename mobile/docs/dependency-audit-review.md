# Temporary build dependency audit exceptions

Reviewed October 4, 2026; expires November 3, 2026 at 00:00 UTC. These exceptions do not patch the affected packages. `npm run audit:runtime` fails after expiry or if the reviewed dependency tree changes.

| Advisory | Locked package | Exposure |
|---|---|---|
| [CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), npm source 1240992 | braces 3.0.3 | Recursive pattern parsing can crash a Node process. In this tree, micromatch brings it into Metro file watchers and workspace discovery. Inputs come from repository/build configuration. |
| [CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv), npm source 1240912 | node-forge 1.4.0 | RSA signature verification accepts extra nested ASN.1 elements. Its declaring parents are Expo CLI and Expo's code-signing certificate utility. That utility does verify certificates/CSRs and signatures; the affected primitive exists in build tooling. |

The primary advisories list no patched versions. Registry queries on the review date confirm that these locked versions remain the latest published releases. Forge has an [upstream fix PR](https://github.com/digitalbazaar/forge/pull/1152); it is not a published dependency update we can adopt yet.

The review's real iOS release source map contained 2,877 sources and no node-forge, braces, or micromatch source. The app's recipe inputs therefore do not reach these packages in that bundle. This is evidence about the reviewed bundle, not a general claim that build tooling is safe. Builds must use reviewed repository patterns and developer-controlled signing material; attacker-supplied patterns, certificates, or CSRs can still expose the tooling vulnerability.

The policy pins package and parent versions/integrities, exact declaring parents and dependency ranges/kinds, and rejects nested duplicate installations. Tests cover changed metadata, additional runtime parents, changed advisory IDs, and expiry. Before extending the review or changing these packages, check upstream releases, regenerate the actual iOS release bundle with source maps, inspect reachability and signing inputs, and document the result. Prefer an upstream patched release when one becomes available; remove the corresponding exception then.
