# Håfa Recipes — AGENTS.md

## Product

Håfa Recipes is a live consumer recipe product with real App Store users. It
converts cooking videos, websites, images, and manual input into a personal and
shareable cooking library.

## Architecture

- Monorepo: `api/` + `mobile/` + `web/`
- API: Python 3.12, FastAPI, SQLAlchemy, Neon PostgreSQL
- Mobile: Expo 54, React Native, Expo Router, Clerk
- Web: React, TypeScript, Vite
- Hosting: Render API, Netlify website, EAS / App Store mobile releases

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
