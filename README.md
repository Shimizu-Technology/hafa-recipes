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
├── api/              # Shared Håfa API: FastAPI, models, extraction, migrations
├── mobile/           # Håfa Recipes Expo / React Native app
├── workouts-mobile/  # Håfa Workouts Expo / React Native app (TestFlight beta)
├── baby-mobile/      # Håfa Baby: private sources, journal, care logs and routines
├── web/              # Håfa Recipes marketing, privacy, and support website
├── workouts-web/     # Håfa Workouts website and shared-workout pages
├── admin/            # Moderation dashboard
├── docs/             # Architecture, migration, deployment, and operational decisions
├── scripts/          # Repository-wide local development and verification commands
└── .github/          # CI for the independently deployable applications
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

## API CI sharding

The API workflow keeps the complete suite and the existing `-k baby` selection
with `BABY_FAMILY_ENABLED=true`. The latter checks a second family-sharing
configuration. Each selection runs in six timing-balanced shards, each with its
own PostgreSQL service/database. The `FastAPI` and `Baby family gate on` status
names fail unless every corresponding shard succeeds. Frozen API dependencies
and the pinned CI-only plugin are downloaded through the uv cache.

`.github/ci/ci_shards.py` assigns whole files using longest-processing-time
first, with deterministic file-name ties. It preserves collection order within
each file, module fixtures, and import-time randomized parameter IDs. API and
Baby use separate file medians in `.github/ci/file-durations.json`; unseen files
receive the selection's mean file duration. Six jobs per configuration remain.

Each shard uploads measured setup/call/teardown timings and JUnit results for
14 days. Refresh the file map from complete green-run artifact directories:

```bash
python3 .github/ci/refresh_timings.py /path/to/run-id /path/to/another-run-id
```

The refresh sums all tests (including files split by the former partitioner)
within each run before taking per-file medians across runs. The initial refresh
uses main run 44904323794 and identical-source green repeat runs 44902882065
and 44902885662. The old per-test seed remains only as pytest-split's timing
output path; it no longer controls assignment. All shards read the same
committed file map.

From `api/`, against an explicitly disposable `TEST_DATABASE_URL`:

```bash
uv sync --frozen --dev
uv pip install --no-deps -r ../.github/requirements-ci.txt
PYTHONPATH=../.github/ci uv run --frozen --no-sync pytest -p ci_shards -c pyproject.toml --rootdir=. --ci-shards 6 --ci-shard 1 --ci-selection api
# Use --ci-selection baby, BABY_FAMILY_ENABLED=true and -k baby for Baby.
uv run --frozen --no-sync python -m unittest discover -s ../.github/ci
uv run --frozen --no-sync python ../.github/ci/audit_shards.py
```

The audit independently collects the baseline and all six shards for each
configuration, checks per-file case counts against the baseline, and requires
one owner per file. No fixtures execute. Shard 1 of each configuration runs its exact-coverage
check before tests; the aggregate status fails closed if it fails.

Only workflow/support files change: no API source, production dependency pins,
hosting settings, or frontend build inputs change.
