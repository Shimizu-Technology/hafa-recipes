# Håfa Recipes — AGENTS.md

## Product

This monorepo holds two Håfa consumer apps that share one account and one API:

- **Håfa Recipes** is live on the App Store with real users. It turns cooking
  videos, websites, images and manual input into a personal, shareable cooking
  library.
- **Håfa Workouts** is a private TestFlight beta for named testers. It turns
  workout videos into a library, training plans, tracked sessions and AI
  coaching. The current plan is `docs/hafa-workouts/ROADMAP.md`; the design
  plan is `docs/hafa-workouts/DESIGN_PLAN.md`.

## Architecture

- `api/`: the shared Håfa API. Python 3.12, FastAPI, SQLAlchemy, Neon
  PostgreSQL. Recipes routes are in `app/routers/`; Workouts lives in
  `app/domains/workouts/` under `/api/v1/workouts`.
- `mobile/`: Håfa Recipes app (Expo, React Native, Expo Router, Clerk).
- `workouts-mobile/`: Håfa Workouts app (Expo, React Native, Expo Router, Clerk).
- `web/` and `workouts-web/`: marketing and support websites (React, Vite).
- `admin/`: moderation dashboard (React, Vite).
- Hosting: one Render service for the API, which auto-deploys `main` to
  production for both apps. The websites deploy on Netlify. Mobile releases
  go through EAS, TestFlight and the App Store.

## Working agreements

- Keep PRs small (about 500 lines of real code or fewer) and base them on
  `main`. Avoid long stacked PR chains.
- Every PR body says what a user will notice.
- Ask Leon before adding new test harnesses, capacity experiments or process
  documents. Prefer updating `ROADMAP.md` over writing a new planning doc.
- A merge to `main` deploys the shared API to production. Verify the API and
  Recipes health after merging backend changes.
- New database migrations must be additive. The deployed code must keep
  working before the migration is applied.

## Guardrails

- Treat authentication and every `user_id` column as data-integrity-sensitive.
- Business logic must use a stable application user ID, never assume a Clerk
  subject is the permanent application identity.
- Never bulk-rewrite ownership during an identity-provider cutover.
- Backfills and provisioners are dry-run by default, idempotent, auditable, and
  conflict-stopping. They never delete user data.
- Keep development and production Clerk issuers explicit and issuer-scoped.
- Test old and new mobile versions concurrently before retiring an issuer.
- Back up and establish a restore point before applying production migrations.
- Never commit credentials, provider exports, user data, cookies, App Store
  artifacts, build products, or production database dumps.
- Preserve independent deployability for `api/`, `mobile/`, and `web/`.
- Run `./scripts/check.sh` for repository-wide changes and the affected runtime
  flows before every PR is considered ready.
