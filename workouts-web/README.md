# Håfa Workouts website

Independent static marketing, support, privacy, deletion, terms and intentional public sharing website. The Recipes website is untouched. iPhone/Android beta links are explicitly pending.

Node 22.22.3: `npm ci`, `npm run check`. `npm run dev` is a local runtime; claim and clean it through the lifecycle skill. Build emits `dist/` with prerendered public pages and a generated strict CSP `_headers`. Tests use synthetic public projections and make no live API/provider request.

Set `VITE_WORKOUTS_PUBLIC_API_BASE` to the selected verified HTTPS API origin before build. Empty config keeps the public website usable but disables snapshot reading. Never put an API key, Clerk secret, access token or private service URL in a VITE variable. Preview and production must have deliberately selected API origins and matching CORS; no production default exists.

Use `netlify.toml` only on an independent Workouts site. Configure the base as `workouts-web`, publish `dist`, and verify generated CSP/referrer/cache/robots headers on a Deploy Preview. No site/domain was provisioned by this implementation. The main release task owns deployment, final policies and install links.

Preferred web share links use `/shared#token`. Existing `/shared/token` works and is scrubbed to the fragment in browser history. No client telemetry, referrer, storage or automatically sent mail/import is added. Hosting/API access logs require separate redaction/retention verification; a browser cannot erase a legacy token path that hosting already received.

See [website brief and QA ledger](../docs/hafa-workouts/WEBSITE.md) for source attribution, security bounds, exact dependency decisions and actual interaction/release gates.
