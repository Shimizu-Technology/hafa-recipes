# Admin Moderation and UGC Safety Runbook

Last reviewed: 2026-08-19

This runbook describes the Håfa Recipes moderation system and its focused `admin/` client. It is intentionally narrower than a database console: operators can review reports, reverse public visibility, curate featured recipes, and recover extraction jobs through explicit domain actions. They cannot browse private recipe bodies, personal notes, chat history, reassign ownership, impersonate users, execute arbitrary SQL, or hard-delete content through these APIs.

## Trust boundaries

- Clerk authenticates the operator. The JWT must include `public_metadata.role = "admin"`.
- FastAPI enforces the admin role on every `/api/admin/*` route. The `admin/` client is not an authorization boundary.
- Non-admin attempts receive `403` and create a bounded structured warning containing actor ID, method, and route only.
- Admin searches return public recipe metadata or redacted placeholders. Extraction jobs expose the source hostname, never the full URL, query string, user notes, or provider error body.
- Normal users can report only currently public, active content and cannot report themselves. A personal block does not prevent a subsequent report, so “block and report” works in either order.
- A block changes only the blocker’s views. It does not modify or delete the contributor’s data.

## Moderation semantics

Sharing and moderation are independent:

- `is_public` records the owner’s sharing choice.
- `moderation_status = hidden` removes a recipe from every non-owner surface while preserving that sharing choice and the evidence.
- Owners retain access to their own hidden recipes.
- A hidden contributor’s public recipes are removed from public surfaces as a group.
- Unhiding restores visibility only when the owner still wants the recipe public.
- Featuring requires an active, public recipe and a unique non-negative order. Unfeaturing clears the order.

The shared visibility policy applies to Discover, public search/counts/tags/contributors, random and similar recipes, duplicate lookup, ingredient search, saved lists, collections, meal-plan displays, recipe chat, notes, and direct links. Signed-in views also exclude contributors that viewer blocked.

## User safety endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/reports` | Report a visible recipe or contributor. |
| `GET` | `/api/reports/mine` | Follow the status of the caller’s reports and appeals. |
| `POST` | `/api/appeals` | Appeal a moderation hold on the caller’s recipe or contributor account. |
| `GET` | `/api/safety/status` | Read only the caller’s appeal-relevant account moderation state. |
| `GET` | `/api/blocks` | List contributors blocked by the caller. |
| `POST` | `/api/blocks/{contributor_id}` | Block a public contributor idempotently. |
| `DELETE` | `/api/blocks/{contributor_id}` | Unblock a contributor idempotently. |

Report categories are `spam`, `unsafe`, `inappropriate`, `copyright`, `impersonation`, and `other`. `appeal` is reserved for `/api/appeals`. Open duplicates from the same reporter are returned instead of creating another queue item, and a caller with 50 active reports/appeals must wait for review before adding more.

The mobile recipe menu exposes report-recipe, report-contributor, and block actions only for non-owned public content. Blocking immediately invalidates recipe, Discover, saved, recommendation, and contributor caches so hidden content does not linger locally. Settings → Safety Center lists the caller’s blocked contributors and report/appeal statuses, supports unblock, and offers an account appeal only while the account is held. Owners receive their own recipe moderation status so a held recipe can explain its public visibility and offer an appeal; that status is never populated for a non-owner response.

## Admin endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/dashboard` | Counts for open reports, hidden content, jobs needing attention, and recent actions. |
| `GET` | `/api/admin/reports` | Oldest-first report/appeal queue with bounded target context. |
| `PUT` | `/api/admin/reports/{id}` | Move a report to reviewing, resolved, or dismissed with a reason. |
| `GET` | `/api/admin/recipes` | Search intentionally public recipe metadata, including admin-hidden recipes. |
| `PUT` | `/api/admin/recipes/{id}/moderation` | Hide/unhide and feature/unfeature with a reason. |
| `GET` | `/api/admin/contributors` | Search contributors that have intentionally public recipes. |
| `PUT` | `/api/admin/contributors/{id}/moderation` | Hide/unhide a contributor with a reason. |
| `GET` | `/api/admin/jobs` | View failed, expired, or stale jobs without private job input. |
| `POST` | `/api/admin/jobs/{id}/retry` | Safely reset a failed/expired job and wake the durable worker. |
| `POST` | `/api/admin/jobs/{id}/cancel` | Fence an active job or archive a failed/expired job as cancelled. |
| `GET` | `/api/admin/audit` | Read append-only admin history, optionally filtered by action or target. |

All mutations lock the target row, require a 3–500 character reason, commit the domain change and audit event in one transaction, and return `409` for an invalid state transition. Job retry refuses legacy jobs without an owner and re-extractions whose target recipe no longer exists.

## Audit history

`admin_audit_events` stores actor, action, target type/id, reason, timestamp, and small before/after state summaries. It has no ownership foreign key, so account cleanup cannot rewrite history. A PostgreSQL trigger rejects every update or delete. Recipe bodies, report reporter identities, chat content, full job URLs, user notes, and provider error bodies do not enter the audit summaries.

Allowed actions are recorded in the database. Denied authenticated attempts are recorded in structured application logs because letting an untrusted caller write unlimited durable audit rows would itself be an abuse path.

## Deployment and verification

Render runs the versioned `python -m migrations.run` entrypoint, which currently applies migrations 016–023 in order. Adding a migration requires updating that checked-in runner, not hand-editing a provider command chain. The migrations are additive and idempotent. Startup refuses to serve if migration 022's moderation marker, required columns/tables, validated constraints, featured-order uniqueness, current appeal/target checks, or append-only trigger are missing; the grocery synchronization boundary separately verifies migration 023.

The active legacy Render service currently keeps the repository root as its service root, so its dashboard command is `cd api && python -m migrations.run`. The checked-in Blueprint sets `rootDir: api` and therefore uses `python -m migrations.run`. Tests require both configurations to point at the same versioned runner and fail when a newer numbered migration file is not registered.

The admin portal deploys independently from `admin/` as a static Netlify site.
Its checked-in configuration sets SPA routing, immutable hashed assets, a
no-store shell, security headers, and the Clerk/API content-security policy.
Production requires the Clerk browser key and HTTPS API URL at build time. Add
the exact deployed admin origin to API CORS and any enabled Clerk origin
restrictions; never use a wildcard. See `admin/README.md` for setup and build
verification.

Local verification:

```bash
cd api
uv run ruff check app migrations tests
TEST_DATABASE_URL=postgresql+asyncpg://... uv run pytest -q
uv run python -m migrations.run
uv run python -m migrations.run
```

After deploy:

1. Confirm `/up` is healthy.
2. Confirm a normal authenticated user receives `403` from `/api/admin/dashboard`.
3. Confirm an admin can read the empty/current dashboard.
4. Submit a synthetic report, move it to reviewing, and resolve it with a reason.
5. Hide and unhide a synthetic public recipe and confirm non-owner direct links and all discovery surfaces agree.
6. Confirm both actions appear in `/api/admin/audit`.
7. Do not use real private content for release verification.

## Rollback

Prefer application rollback while leaving migration 022 and its history in place. The new columns and tables are additive; old application code ignores them. Do not drop audit records or disable the append-only trigger as a routine rollback. If public visibility is unexpectedly restrictive, disable the affected release, inspect the shared policy and moderation rows, and restore only through an explicit admin action with a reason.

## Remaining product and policy work

The implemented backend and consumer controls do not replace the remaining policy work:

- align support, policy, App Store, Play Store, and website links;
- obtain appropriate legal/privacy review before publishing changed terms.
