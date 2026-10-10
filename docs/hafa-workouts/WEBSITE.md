# Workouts website implementation and acceptance handoff

## Verified scope and sources

This independent slice starts from `ff8cadd` (October 10, 2026), with branch `codex/workouts-web` and isolated checkout `hafa-recipes-worktrees/workouts-web`. Ownership is only `workouts-web/`, this brief, and `.github/workflows/workouts-web.yml`. Root owns backend mounting, shared CI/native manifests, actual browser QA, provider configuration, hosting, PR review/merge and release. No Recipes web or mobile files were changed.

The intended visitors are adults discovering Workouts, beta testers seeking help, account owners inspecting removal scope, and intentional recipients of reviewed public snapshots. The primary outcomes are to understand capture→review→plan→train, inspect sharing safely, and reach real support or deletion instructions. iPhone/Android beta availability is explicitly pending; no invented install, TestFlight, domain, waitlist, price or download count appears.

Sources rechecked: native `components/ui.tsx` for cream/forest/lime tokens; native DM Sans assets; `web/src/pages/{Support,DeleteAccount,Privacy}.tsx` for existing support address and Shimizu links; Brain Dump `work/shimizu-tech/hafa-recipes.md` for private capture/review and app portfolio context; canonical frontend/testing guides for experience and QA; `workouts-jobs-coach` sharing projection, import-usage/lifecycle, health, coach and export snapshot source for data-flow claims. Parent's full product decisions remain authoritative over old Recipes notes. OpenAI's current [data controls](https://developers.openai.com/api/docs/guides/your-data) were checked for the explicit distinction between `store:false` and provider retention. No Zero Data Retention status is claimed.

## Experience decisions

The direction extends the app: warm cream surfaces, forest actions, lime accents, local DM Sans, a strong asymmetric opening, numbered workflow, quiet family/permission sections, and a clear beta boundary. A product-shaped illustration explains source→reviewed session→actuals and is labeled illustrative; it is not a screenshot, account fixture or training recommendation. No stock photograph or invented endorsement is used.

The opening copy and illustration settle with a short opacity/translation entrance. Links/buttons give quick press feedback; browser-native details controls keep FAQs predictable. Reduced motion removes transitions/entrance and smooth scrolling. Source and legal pages remain still. Phone layouts stack content and preserve 48 px primary controls, native focus outlines, clear labels and a skip link. Local fonts and the absence of third-party scripts prevent a font/telemetry request from carrying link context.

## Public-share boundaries

The reader accepts exactly 43 literal URL-safe token characters, either `/shared#token` or the existing `/shared/token`; queries/encoded aliases/overlong tokens fail before transport. Legacy paths are immediately scrubbed to the fragment. Copied links use fragments so the token is not sent to website hosting on initial navigation. Native `hafaworkouts://shared/token` opens only on a deliberate click. There is no auto-import, auth token, recipient mutation, private library, public Discover feed, or clipboard write before a click.

The only network request is the public snapshot GET. It sends no credentials/referrer, disallows redirects, uses no-store, has a 20 second deadline and reads at most 2 MiB of streamed JSON. The parser bounds arrays/string lengths/numbers and creates a fresh explicit projection; private IDs, profile/history/Health, creator notes and source evidence are not retained/rendered. Source URLs are HTTPS, without credentials/local address literals. React escapes text; there is no raw HTML rendering. Missing reps/sets/timing remain visibly unspecified, source load units/conventions stay unchanged, grouping rounds remain distinct from exercise sets, and programs expose relative offsets rather than private calendar dates. Program sessions and workout parts have bounded incremental display. Revocation/expiry have recoverable unavailable states; already read previews and deliberate recipient copies cannot be recalled.

A link remains a bearer access capability. This site includes no analytics, session replay, query logger, tracking cookies, local/session storage, error-body display or token telemetry. Referrer-Policy is no-referrer; shared pages are no-store/noindex/nofollow/noarchive. Legacy path links still reach the hosting provider before browser code scrubs them, and the API URL necessarily carries its public token. Root must verify/redact provider access/edge/error logs and retention before publishing; client code cannot guarantee provider log policy. Fragments reduce website exposure but are not an authorization boundary against the recipient.

## Build and hosting

The self-contained Vite8/React19 site prerenders home, support, privacy, deletion, terms and the generic shared loading page. Public policy/help content is available without JavaScript. Client hydration only reuses the matching prerender route; unknown routes render recovery instead of hydrating homepage content into a mismatch. No shared content/token is rendered at build time.

The explicit `VITE_WORKOUTS_PUBLIC_API_BASE` must be a verified HTTPS origin in production. Empty configuration permits marketing/help but fails closed on share reading. Dev accepts loopback HTTP only. Build creates `_headers` with CSP allowing self and exactly that validated API origin; no inline/external fonts/scripts, unsafe-inline, generic wildcard connect, objects, frames or forms. Root must set matching CORS and choose distinct preview/release API environments. No production origin is defaulted into development.

`workouts-web/netlify.toml` is for a separate Workouts site and leaves Recipes configuration intact. Base/publish/build values, static policy routes and legacy shared fallback are ready for review. Nothing was deployed/provisioned. The header generation must be verified on an actual Deploy Preview before production; local Vite does not apply Netlify headers. Optional platform logging/HTTPS/custom-domain/install links, final privacy owner review, and actual released source remain root gates.

Exact active dependency pairs: Vite 8.2.1, plugin-react 6.1.2 (peer Vite 8), React/react-dom 19.2.3, TypeScript 6.0.3, Vitest 4.1.11. npm 10's fresh optional Vite devtools peer expansion failed inside Arborist (`edgesOut`); project `.npmrc` retains the legacy-peer-deps workaround, which ignores all peer resolution. The checked-in lock also installs with strict peer validation on Node22.22.3/npm10.9.8. Active pairs are explicitly compatible and source/build gates pass; see the README follow-up receipt for the reproduced distinction between locked install and fresh resolution. Vitest 4.1.11 closes GHSA-82fw-gwwq-j7x9 found in 4.1.10. Runtime dependencies are only React/react-dom; no server is deployed. DM Sans is copied from the native font package with its OFL license.

## Source gates and execution ownership

Agent source checks: typecheck,10 meaningful token/projection/source-link/transport/size/program/static-content tests, prerendered production build and dependency audit. Final results are reported with the commit after completion. No permanent server, browser tab, simulator/emulator or container was started. Static HTML/automated tests are not actual screen interaction acceptance or screenshots.

Parent/root executes the following affected website QA cases with owned non-production fixtures. No real support email is sent for testing. Screenshots and browser/device evidence remain not_run here; root records exact tested head, viewport, input mode and resource cleanup. Android/iOS installed-app fallback requires the actual native build and remains distinct from a resized desktop browser.

| Case | Fixture, actions and required outcomes | Required dimensions | Status |
| --- | --- | --- | --- |
| WW01 | Home→workflow→beta: promise clear, conceptual layout labeled, no fake install link; reach real support draft deliberately | 390px/desktop1440px, keyboard, reduced motion | not_run |
| WW02 | Open support/privacy/deletion/terms directly, reload with JS off; correct shared-account/product scopes and retention visible | phone/desktop, keyboard/focus | not_run |
| WW03 | Synthetic public workout with missing reps, per-side/load convention, circuit rounds, long content; inspect original source only on click | phone/desktop, screen reader labels | not_run |
| WW04 | Synthetic public program with relative offsets and more than 5 sessions; navigate pages/parts without missing content | phone/desktop, keyboard | not_run |
| WW05 | Malformed token, revoked/expired link, unconfigured backend, timeout, failed CORS, oversized response; understandable recovery, no partial import/private leakage | phone/desktop, controlled nonprod service | not_run |
| WW06 | Copy valid fragment link, reload it, intentionally open installed app or show fallback if absent | clipboard permission/denial, iPhone/Android native | not_run |
| WW07 | Deploy Preview headers/CSP/CORS/referrer/robots/cache plus hosting/API log redaction; no token/provider content in telemetry | actual hosted preview/network evidence | not_run |
| WW08 | Delete-account help shows Workouts-only vs both products, legacy Recipes behavior, 48 hour content-free allowance and external copy/Health controls | phone/desktop, owner content review | not_run |

Required acceptance remains open. Root will capture real screenshots and fix observed layout/recovery problems before calling this site release ready.


## Local origin/CSP follow-up

The isolated follow-up starts from website `9e24831`, branch
`codex/workouts-web-local-preview`. Scope is only website origin/configuration,
tests and docs; native/backend/shared CI and dependency pins are untouched.
Strict dev loopback spellings are localhost, 127.0.0.1 and [::1]; source links
still retain their independent HTTPS/nonlocal restrictions. Vite serve uses
exact-origin dev CSP with an exact selected HMR socket and dev-only inline
Refresh/style allowance. Build-time gating keeps every built release HTTPS-only
even if build mode/NODE_ENV says development; production generated CSP is
unchanged. 38 tests, typecheck and production/prerender gates passed; compiled
SSR and generated HTTPS CSP checks also passed. Strict locked npm ci succeeds,
while an isolated fresh optional-peer expansion reproduces Arborist edgesOut;
no blind dependency upgrade was made. Temporary fixtures were removed. Browser
CUA, HMR/CORS happy path, physical devices, deployment and provider-log controls
remain root acceptance gates and were not executed here.
