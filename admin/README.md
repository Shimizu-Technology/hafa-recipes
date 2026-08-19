# Håfa Recipes Admin

The admin portal is a focused desktop operations surface for moderation,
curation, extraction recovery, and append-only audit review. It intentionally
does not expose arbitrary database editing, hard deletion, impersonation,
private recipe bodies, notes, chat history, full extraction URLs, or provider
error bodies.

## Authorization boundary

Clerk signs the operator in, but the browser is never the authorization
boundary. Every request carries the current Clerk bearer token and FastAPI
independently requires `public_metadata.role = "admin"` on every
`/api/admin/*` route. A normal authenticated account receives `403` even if it
manually calls an endpoint or modifies this client.

Every mutation requires a 3–500 character reason and a confirmation. The API
commits the domain change and its append-only audit event together.

## Local development

Use Node 22.22.2 or newer within the supported Node 22 line:

```bash
cd admin
cp .env.example .env.local
npm ci
npm run dev
```

Set `VITE_CLERK_PUBLISHABLE_KEY` to the browser key for the same Clerk instance
trusted by the API. Local development defaults to `http://127.0.0.1:8000`; set
`VITE_API_BASE_URL` explicitly when the API is elsewhere. Production builds
reject non-HTTPS API URLs.

`/dev.html` is a development-only, synthetic-data preview for visual review.
It is not an input to the production build and must never contain real user
data.

## Verification

```bash
npm audit --omit=dev --audit-level=high
npm run typecheck
npm run lint
npm test
VITE_CLERK_PUBLISHABLE_KEY=pk_test_ci_placeholder \
  VITE_API_BASE_URL=https://recipe-api-x5na.onrender.com \
  npm run build
```

Also confirm that `dist/` contains neither `dev.html` nor mock fixture names.
The repository-level `scripts/check.sh` includes these checks alongside the
API, mobile app, and marketing site.

## Deployment

Deploy this directory as its own Netlify site with `admin/` as the site base.
The checked-in `netlify.toml` builds `dist/`, configures SPA routing, pins Node,
and supplies security and cache headers. Its Clerk CSP matches the production
Frontend API at `clerk.hafa-recipes.com`, includes Clerk's current abuse/fraud
protection hosts, and disables optional Clerk development telemetry. Configure
these build variables:

- `VITE_CLERK_PUBLISHABLE_KEY`: production Clerk browser key trusted by the API.
- `VITE_API_BASE_URL`: `https://recipe-api-x5na.onrender.com` for production.

Then add the exact admin origin to the API's `CORS_ORIGINS`. Do not use a
wildcard with credentialed requests. If Clerk origin restrictions are enabled,
allow the exact admin origin there as well.

After deployment, follow the authenticated checks in
`../docs/ADMIN-MODERATION-RUNBOOK.md`. Release verification uses synthetic
content only and includes a non-admin `403`, an admin read, a reversible action,
and the resulting audit event.
