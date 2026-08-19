# Håfa Recipes

Håfa Recipes turns cooking videos, recipe websites, photos, and handwritten
recipe cards into a structured recipe library that people can actually cook
from. The product is built in Guam and is designed to preserve the useful part
of a recipe after the social post, video, or family card that inspired it is
hard to find again.

**Production:** [hafa-recipes.com](https://hafa-recipes.com) ·
**API:** [recipe-api-x5na.onrender.com](https://recipe-api-x5na.onrender.com) ·
**iOS:** [App Store](https://apps.apple.com/us/app/h%C3%A5fa-recipes/id6755892896)

## What is in this repository

```text
.
├── api/       # FastAPI service, database models, extraction pipeline, migrations
├── mobile/    # Expo / React Native iOS and Android application
├── web/       # React / Vite marketing, privacy, and support website
├── docs/      # Architecture, migration, deployment, and operational decisions
├── scripts/   # Repository-wide local development and verification commands
└── .github/   # CI for all three independently deployable applications
```

The applications intentionally keep separate dependency systems and lockfiles.
No JavaScript workspace framework is required.

## How the product works

1. A person signs in with Clerk and submits a social-video URL, recipe page,
   image, or manual recipe.
2. The FastAPI service downloads or parses the source, transcribes video audio
   when needed, and asks the configured AI models for structured ingredients,
   steps, nutrition, costs, and tags.
3. Recipes and user-owned features are stored in Neon PostgreSQL; durable media
   is stored in S3.
4. The mobile app provides search, discover, saves, collections, notes, meal
   planning, shared grocery lists, cook mode, timers, OCR, and recipe chat.
5. The public website explains the product and hosts privacy and support pages.

## Local setup

Requirements: Docker, Python 3.12, [uv](https://docs.astral.sh/uv/), Node.js
22.12+ and npm.

```bash
./scripts/setup-dev.sh
./scripts/dev.sh
```

The setup uses an isolated local PostgreSQL database and synthetic seed data.
Paid AI is off by default, and development cannot silently fall back to the
production database or API. See the
[development and dependency runbook](docs/DEVELOPMENT-AND-DEPENDENCY-RUNBOOK.md).

Local URLs:

- API and OpenAPI docs: `http://localhost:8000` and `/docs`
- Marketing website: `http://localhost:5173`
- Expo development server: `http://localhost:8081`

Run the complete repository gate with:

```bash
./scripts/check.sh
```

## Production ownership

- Render deploys `api/` from `main`.
- Netlify deploys `web/` from `main` using the root `netlify.toml`.
- EAS builds `mobile/`; App Store releases are explicit and are not triggered by
  a Git push.
- Clerk, Neon, S3, Sentry, AI-provider, Render, Netlify, and EAS secrets remain
  in their provider dashboards and are never committed.

Start with [the documentation index](docs/README.md) for product intent, the
full-system audit, accepted decisions, the implementation roadmap, and current
runbooks. Read [the architecture and migration program](docs/ARCHITECTURE_AND_MIGRATION_PROGRAM.md)
before changing authentication, ownership, deployment sources, or database
schema. The standalone repositories are retained only as migration archives;
this monorepo is the canonical source.
