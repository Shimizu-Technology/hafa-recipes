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
