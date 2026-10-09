# Recipe cover selection

## Context and acceptance

Implementation started October 9, 2026 from `de77118` on `main`. Håfa Recipes
helps collectors and household cooks turn social videos, websites, screenshots,
and family recipes into a searchable library connected to planning, shopping,
and cooking. The personal origin and current import behavior are documented in
`PRODUCT-AND-SYSTEM.md` and `CONVENIENT-IMPORTS.md`.

The affected journey is a video/slideshow import, automatically saved recipe,
its detail photo, and subsequent library/discover use. The original source,
ownership, visibility, quantities, warnings, nutrition, and cooking actions must
remain intact. A user edit always takes precedence over delayed photo work.

The target is better recognition of the correct dish in the existing square
cards and 4:3/16:9 detail photos. No generated image is introduced. Provider or
media failure must preserve the saved recipe and any durable original image.

## Implementation

New usable social-video imports enqueue a `cover` job in the existing durable
job table, atomically with the recipe. A separate leased worker processes those
jobs, so image enhancement does not delay recipe extraction or appear as another
import in the consumer inbox. There are no new database columns or migrations.

Available slideshow/evidence images are reused through a bounded temporary
process cache. After restart or cross-replica execution, jobs reacquire their
source. The cover sampler covers opening, middle, closing, and early/late scene
changes. Candidate filtering removes invalid, blank, severely blurred, and
near-duplicate images. One bounded vision request grades the shortlist in the
actual hero and square-card crops. Correct dish and finished food outrank
presentation style. The selector can abstain and retains an incumbent unless a
replacement meets suitability and improvement thresholds.

Only validated source bytes enter the existing content-addressed S3 list/hero
pipeline. Writes require the original owner, source, content revision, current
thumbnail, live job lease, and recipe's media lock. Selection changes no cooking
fields or review evidence. Candidate bytes are never persisted; terminal jobs
discard expiring image URLs. Model/prompt versions and bounded numeric selection
metadata remain internal, while consumers receive only a pending boolean and
deadline. Mobile refreshes while pending, online, and foregrounded; it stops at
completion, deadline, or repeated failure.

## Configuration and rollback

- `RECIPE_COVER_SELECTION_ENABLED`: controls new jobs and the cover worker.
- `RECIPE_COVER_MODEL`: pinned configured vision model.
- `RECIPE_COVER_MAX_CANDIDATES`: shortlist, maximum eight.
- `RECIPE_COVER_FRAME_MAX_COUNT`: bounded source sample, maximum twelve.
- `RECIPE_COVER_RANK_TIMEOUT_SECONDS`: one grading-call timeout.
- `RECIPE_COVER_JOB_TIMEOUT_SECONDS`: total per-attempt media/grading bound.
- `AI_DISABLED_CAPABILITIES=cover_selection`: disables paid grading while
  retaining original-thumbnail delivery. Normal development paid-AI protections
  apply unchanged.

Jobs expire after five minutes with at most two attempts. Turning selection off
restores the existing synchronous thumbnail path for new imports. Old clients
ignore the additive pending fields. No existing recipe images are backfilled.

## QA ledger

Execution owner: agent. Depth: comprehensive coverage of the changed import and
photo journeys, plus adjacent recipe/library/cooking behavior. This is not a
claim to retest every application feature. Native iPhone and tablet coverage,
local API, disposable PostgreSQL, and explicit fixture boundaries are recorded
below. Physical TestFlight checks remain Leon's follow-up; App Review/public
release are outside this request.

| ID | Required scenario and saved outcome | Status | Evidence |
|---|---|---|---|
| C1 | Video import saves promptly; photo processing cannot block cooking | not_run | Pending native UI execution |
| C2 | Pending detail updates to selected photo without navigating/reimporting; warnings/source preserved | not_run | Pending native UI execution |
| C3 | Manual replacement during grading survives completion and reload | not_run | Pending native UI and database verification |
| C4 | Failed/abstained grading retains durable original and stops pending state | not_run | Pending native UI and worker verification |
| C5 | Restart/stale lease recovers image work without duplicate recipe/job | not_run | Pending PostgreSQL integration execution |
| C6 | Deleted recipe/account and stale owner/revision/lease prevent media writes | not_run | Pending PostgreSQL integration execution |
| C7 | Background/offline pauses refresh; foreground reconnect retrieves saved photo | not_run | Pending native UI execution |
| C8 | Old API payload, website/manual recipe, library card, light/dark and tablet remain usable | not_run | Pending native UI execution |
| C9 | Real-provider comparison selects correct dish or abstains on unrelated candidates | not_run | Development credentials and permissioned fixtures to verify |
| C10 | Exact merged API deployment and iOS build finish processing and reach internal TestFlight | not_run | Release steps follow accepted QA and review |

Each execution record must name commit/build, environment, device, fixture,
observed interaction and stored outcome. Synthetic provider responses establish
integration and UI behavior, not live grading quality. Provider quality and
platform acquisition are evaluated separately with public/permissioned media.

## Release record

Not yet merged or delivered. Record the PR, final reviewed head, merge SHA,
local gate, scenario outcomes, Render deployment, EAS build source/version,
Apple processing, tester availability, and exact resource cleanup here.
