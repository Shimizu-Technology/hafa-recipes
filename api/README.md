# Recipe Extractor API

FastAPI backend for extracting structured recipes from cooking videos and recipe websites using AI.

## Quick Start

```bash
# Install dependencies (creates .venv automatically)
uv sync

# Copy environment template
cp .env.example .env
# Edit .env with your credentials

# Run the server
uv run uvicorn app.main:app --reload --host 0.0.0.0

# Or activate venv and run directly
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0
```

Server runs at `http://localhost:8000`

## Environment Variables

Create a `.env` file:

```bash
# Database (required)
DATABASE_URL=postgresql://user:pass@host/dbname
DATABASE_USE_SSL=true

# OpenAI - pinned recipe AI, transcription, and speech (required)
OPENAI_API_KEY=sk-...
RECIPE_EXTRACTION_MODEL=gpt-5.6-luna
RECIPE_EXTRACTION_FALLBACK_MODEL=gpt-5.6-terra
OCR_MODEL=gpt-5.6-luna
OCR_FALLBACK_MODEL=gpt-5.6-terra
RECIPE_CHAT_MODEL=gpt-5.6-luna
COOKING_CHAT_MODEL=gpt-5.6-luna
ENRICHMENT_MODEL=gpt-5.6-luna
AI_CANARY_MODELS={}
AI_CANARY_PERCENTAGES={}
AI_DISABLED_CAPABILITIES=

# Clerk Auth (required; both are accepted during the migration)
CLERK_DEVELOPMENT_ISSUER=https://your-development-instance.clerk.accounts.dev
CLERK_DEVELOPMENT_SECRET_KEY=sk_test_...
CLERK_PRODUCTION_ISSUER=https://clerk.hafa-recipes.com
CLERK_PRODUCTION_SECRET_KEY=sk_live_...
CLERK_PRIMARY_ENVIRONMENT=development

# AWS S3 - thumbnail storage (recommended)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name

# Instagram Authentication (for video extraction)
# Required for Instagram videos - export cookies from logged-in browser
# Can be raw cookie content or path to cookies.txt file
INSTAGRAM_COOKIES=# Netscape HTTP Cookie File...

# Sentry Error Monitoring (optional but recommended)
# Get DSN from: Sentry Dashboard → hafa-recipes-api → Settings → Client Keys
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx

# Optional
ENVIRONMENT=development
# CORS_ORIGINS=https://hafa-recipes.com,https://www.hafa-recipes.com
# ENABLE_SENTRY_DEBUG=false
```

The API role must be able to read bucket versioning and permanently remove
versioned objects: `s3:GetBucketVersioning`, `s3:ListBucketVersions`,
`s3:DeleteObject`, and `s3:DeleteObjectVersion`, in addition to its upload and
read permissions. Chat and account cleanup fail safely and retry when those
permissions are unavailable; they do not report a delete marker as a permanent
image purge.

## Error Monitoring (Sentry)

Sentry captures errors, performance data, and Instagram auth failures.

### Setup
1. Create a Sentry project for FastAPI (`hafa-recipes-api`)
2. Copy the DSN to your `.env` file
3. Add `SENTRY_DSN` to Render environment variables for production

### Testing
Visit `http://localhost:8000/sentry-debug` to trigger a test error in development. In non-development environments, set `ENABLE_SENTRY_DEBUG=true` temporarily before testing.

### What's Monitored
- All unhandled exceptions
- Instagram extraction failures (tagged with `platform:instagram`)
- API performance (20% sampled)

## Instagram Cookie Setup

Instagram requires authentication to extract videos. To enable:

1. **Install browser extension**: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/)
2. **Log into Instagram** in your browser
3. **Go to instagram.com** and export cookies with the extension
4. **Add to Render**: Paste entire content as `INSTAGRAM_COOKIES` environment variable

**Expiration**: Cookies last ~1 year. Refresh when you see "login required" errors in logs.

**Security**: Use a dedicated Instagram account if concerned about flagging.

## How It Works

### Video Extraction
```
User pastes video URL → yt-dlp downloads audio → Whisper transcribes
    → Luna extracts recipe (Terra fallback) → Thumbnail uploaded to S3 → Saved to PostgreSQL
```

### Website Extraction
```
User pastes website URL → Fetch HTML → Parse JSON-LD (or AI fallback)
    → Detect ingredient sections (WPRM/Tasty Recipes/Hearst Media)
    → Split combined steps → Thumbnail uploaded to S3 → Saved to PostgreSQL
```

### Durable async extraction

`POST /api/extract/async` and `POST /api/re-extract/{id}/async` persist the
complete request before returning. A database-backed worker moves each job
through `queued → claimed → processing → completed`, using row locks, renewable
leases, bounded retries, and stale-lease recovery so deploys do not lose work.
Terminal states are `completed`, `failed`, `cancelled`, and `expired`.

Clients should send a new UUID in the `Idempotency-Key` header for each user
action, retain the returned job ID, and poll `GET /api/jobs/{id}` until any
terminal state. Retrying the same request with the same key returns the original
job; reusing a key for a different payload returns `409`.

Supported sites: AllRecipes, Budget Bytes, Half Baked Harvest, Delish, Pinch of Yum, Sally's Baking, and hundreds more.

**AI Stack:**
| Task | Model |
|------|-------|
| Transcription | `whisper-1` |
| Recipe Extraction (Video) | GPT-5.6 Luna (routine), GPT-5.6 Terra (fallback) |
| Recipe Extraction (Website) | JSON-LD parsing (primary), Luna/Terra AI fallback |
| Recipe Extraction (OCR) | GPT-5.6 Luna (routine), GPT-5.6 Terra (fallback) |
| Recipe and Cooking Chat | GPT-5.6 Luna |
| Tag/Nutrition AI | GPT-5.6 Luna |
| Text-to-Speech | `tts-1` |

Model changes are evaluation-gated. `AI_CANARY_MODELS` and
`AI_CANARY_PERCENTAGES` accept JSON objects keyed by capability; routing is
deterministic for a request/job, and setting a percentage to `0` is the
immediate rollback. Every provider attempt stores only operational provenance
(model, prompt/schema version, latency, usage, cost estimate, rollout/fallback
reason, and stable error code). Prompts, responses, full URLs, and recipe text
are never written to the provenance table or structured AI log.

Validate the redacted five-category benchmark without making provider calls:

```bash
cd api
.venv/bin/python -m evals.run_recipe_model_eval --dry-run
```

Run a comparative Luna/Terra report with an explicitly selected local secret
file (reports never contain model output):

```bash
.venv/bin/python -m evals.run_recipe_model_eval \
  --env-file /absolute/path/to/local-eval.env \
  --models gpt-5.6-luna gpt-5.6-terra
```

Model IDs are environment-pinned rather than provider aliases. Routine AI uses
`reasoning_effort=none`; Terra is not called unless extraction/OCR needs a
fallback. `AI_DISABLED_CAPABILITIES` can stop one paid capability (or `all`)
without a deploy. Chat inputs are bounded, image bytes are decoded and checked,
and per-user request/concurrency limits protect provider spend.

## Project Structure

```
app/
├── main.py           # FastAPI app entry point
├── auth.py           # Clerk JWT verification
├── config.py         # Settings from environment
├── db/               # Database connection
├── models/           # SQLAlchemy models
├── routers/          # API endpoints
│   ├── extract.py    # Extraction & job status
│   ├── recipes.py    # CRUD, search, share, chat
│   ├── grocery.py    # Grocery list management
│   ├── collections.py
│   └── meal_plans.py # Meal planning
└── services/         # Business logic
    ├── extractor.py  # Main extraction orchestrator
    ├── video.py      # yt-dlp audio download
    ├── website.py    # Website recipe extraction (JSON-LD, HTML parsing)
    ├── llm_client.py # Luna/Terra extraction and OCR
    ├── openai_client.py  # Whisper + direct extraction
    └── storage.py    # S3 uploads
```

## API Endpoints

### Extraction
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/extract/async` | Start extraction job (authenticated) |
| POST | `/api/extract/ocr` | Extract from single image (authenticated) |
| POST | `/api/extract/ocr/multi` | Extract from multiple images (authenticated) |
| POST | `/api/re-extract/{id}/async` | Re-extract with latest AI (owner/admin) |
| GET | `/api/jobs/{id}` | Get job status (owner-scoped) |
| GET | `/api/locations` | Available cost locations |

### Recipes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/recipes` | List user's recipes |
| GET | `/api/recipes/discover` | Public recipes |
| GET | `/api/recipes/{id}` | Get single recipe |
| GET | `/api/recipes/search?q=` | Search recipes |
| POST | `/api/recipes/manual` | Create manual recipe |
| PATCH | `/api/recipes/{id}` | Edit recipe |
| DELETE | `/api/recipes/{id}` | Delete recipe |
| POST | `/api/recipes/{id}/share` | Toggle public sharing |
| POST | `/api/recipes/{id}/chat` | AI chat about recipe |
| POST | `/api/recipes/{id}/save` | Bookmark recipe |
| DELETE | `/api/recipes/{id}/save` | Remove bookmark |

### Community safety
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/reports` | Report a visible recipe or contributor |
| GET | `/api/reports/mine` | Track the caller's reports and appeals |
| POST | `/api/appeals` | Appeal a moderation hold on owned content/account |
| GET | `/api/safety/status` | Read the caller's appeal-relevant account state |
| GET/POST/DELETE | `/api/blocks` | List, add, or remove contributor blocks |

### Admin moderation
All routes require the Clerk `admin` metadata role. See `../docs/ADMIN-MODERATION-RUNBOOK.md` for the complete route table and privacy rules.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard` | Reports, hidden content, stuck jobs, and recent actions |
| GET/PUT | `/api/admin/reports` | Review and resolve reports/appeals |
| GET/PUT | `/api/admin/recipes` | Public-safe search and reversible moderation/curation |
| GET/PUT | `/api/admin/contributors` | Public-safe search and reversible contributor moderation |
| GET/POST | `/api/admin/jobs` | Bounded job visibility and safe retry/cancel |
| GET | `/api/admin/audit` | Append-only admin action history |
| POST | `/api/recipes/{id}/restore` | Restore original version |

New recipes are private by default across extraction, OCR, and manual creation.
Publishing is an explicit user action through the share controls. Public recipe
responses expose a stable `contributor_id` (`chef_...`) and `is_owner` instead
of exposing another user's Clerk subject. The legacy `user_id` field remains
temporarily available for client compatibility, but contains the opaque public
contributor ID unless the authenticated viewer owns the recipe. Public detail
responses also omit extraction source text; owners still receive their own
source text for editing and diagnostics.

### Personal Notes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/recipes/{id}/notes` | Get your note for a recipe |
| PUT | `/api/recipes/{id}/notes` | Create/update your note |
| DELETE | `/api/recipes/{id}/notes` | Delete your note |

### Version History
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/recipes/{id}/versions` | List all versions |
| GET | `/api/recipes/{id}/versions/{vid}` | Get specific version |
| POST | `/api/recipes/{id}/versions/{vid}/restore` | Restore to version |

### Grocery List
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/grocery` | Get grocery list |
| POST | `/api/grocery` | Add item |
| POST | `/api/grocery/from-recipe` | Add from recipe |
| PUT | `/api/grocery/{id}/toggle` | Toggle checked |
| DELETE | `/api/grocery/{id}` | Delete item |

### Collections
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/collections` | List collections |
| POST | `/api/collections` | Create collection |
| POST | `/api/collections/{id}/recipes` | Add recipe |
| DELETE | `/api/collections/{id}/recipes/{rid}` | Remove recipe |

### Meal Planning
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/meal-plans/week` | Get week's meal plan |
| GET | `/api/meal-plans/day` | Get day's meal plan |
| POST | `/api/meal-plans/` | Add meal to plan |
| PUT | `/api/meal-plans/{id}` | Update meal entry |
| DELETE | `/api/meal-plans/{id}` | Remove meal |
| DELETE | `/api/meal-plans/day/{date}` | Clear day |
| POST | `/api/meal-plans/to-grocery` | Add plan to grocery |
| POST | `/api/meal-plans/copy-week` | Copy week |

## Admin Setup

Admins can re-extract any recipe and read bounded operational diagnostics. Set
the role via Clerk:

1. **Clerk Dashboard** → Users → Select user
2. **Public metadata** → Add:
   ```json
   { "role": "admin" }
   ```

3. **JWT Template** → Create with claim:
   ```json
   { "public_metadata": "{{user.public_metadata}}" }
   ```

## Database Migrations

This repo uses simple numbered migration scripts in `migrations/` rather than Alembic.

```bash
# Run the complete active, idempotent chain against the configured DATABASE_URL.
uv run python -m migrations.run
```

Run migrations intentionally for each environment; do not run production migrations from a local shell unless you have confirmed the target database.

Migration 016 is additive: it makes each existing development Clerk subject a
stable application user ID and does not rewrite ownership columns. After it is
applied, validate the development inventory and then plan production users:

```bash
# Both commands are dry-run by default and exit non-zero on missing/conflicting users.
uv run python -m app.clerk_transition audit-development
uv run python -m app.clerk_transition provision-production

# Apply only after reviewing a clean dry-run. Rerun to prove idempotence.
uv run python -m app.clerk_transition audit-development --apply
uv run python -m app.clerk_transition provision-production --apply
```

The transition tool never deletes or merges users. Production matching requires
one exact verified primary email and a non-conflicting stable external ID.

Migration 017 adds the hash-at-rest, device-scoped grants used by the two-build
mobile cutover. A development session creates a grant at
`POST /api/auth/clerk-transition/grants`; the production-key build redeems it at
`POST /api/auth/clerk-transition/redeem` for a 60-second, one-use Clerk ticket.
The redeem request carries the grant in the `Authorization: Bearer` header so
standard HTTP/Sentry secret scrubbing applies. Raw grants and tickets must never
be logged.

Migration 018 expands the existing extraction-job table into the durable queue
state machine. It is idempotent and intentionally leaves job history in place.
Apply it before enabling `JOB_WORKER_ENABLED`; the API startup preflight refuses
to run the worker against an incomplete queue schema. See
`docs/DURABLE_EXTRACTION_QUEUE_RUNBOOK.md` for rollout and rollback steps.

## Deployment (Render)

1. Connect GitHub repo to Render
2. Set environment variables in dashboard
3. Set the pre-deploy command to `python -m migrations.run`
4. Set the health-check path to `/up`
5. Auto-deploys on push to `main`

**Build Command:** `pip install -r requirements.txt`  
**Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

The checked-in Blueprint uses `api/` as its root directory. A legacy service
whose Render root is still the repository root must use
`cd api && python -m migrations.run`; do not copy the numbered migration list
into the provider dashboard.

## License

Private - Shimizu Technology
