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
