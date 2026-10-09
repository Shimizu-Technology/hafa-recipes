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
| C1 | Video import saves promptly; photo processing cannot block cooking | passed | Native private import 01; opened detail and cooking step 1 of 2 while grading waited; PostgreSQL confirmed one saved recipe |
| C2 | Pending detail updates to selected photo without navigating/reimporting; warnings/source preserved | passed | Native import 02: blurred original became sharp pizza in place, with source, 2 servings, 25 minutes, $4.20, warning and private state preserved |
| C3 | Manual replacement during grading survives completion and reload | passed | Fresh native import 07: chose/cropped burger and saved while cover job was processing; revision 2 and manual image remained after completed job, library navigation and detail reopen |
| C4 | Failed/abstained grading retains durable original and stops pending state | passed | Native import 01 exceeded grading timeout and retained original; worker tests verify abstention, deadline cleanup and provider failure |
| C5 | Restart/stale lease recovers image work without duplicate recipe/job | passed | Disposable PostgreSQL integration tests exercise restart acquisition, lease recovery, parent dependency and atomic rollback |
| C6 | Deleted recipe/account and stale owner/revision/lease prevent media writes | passed | PostgreSQL ownership/revision/lease/deletion tests, including cancelled S3-thread lock ordering and account deletion |
| C7 | Background/offline pauses refresh; foreground reconnect retrieves saved photo | passed | Native import 08: backgrounded before completion; stopped only owned API, cached recipe remained with refresh guidance; restarted API and foregrounded, selected photo appeared. Hook tests verify offline pause/reconnect; no native airplane-mode test |
| C8 | Old API payload, website/manual recipe, library card, light/dark and tablet remain usable | passed | iPhone light/dark cards; native iPad Air 11-inch library/detail/player, private manual save and website retry/save. Hook tests cover omitted pending fields. See execution limits below |
| C9 | Real-provider comparison selects correct dish or abstains on unrelated candidates | passed | Eight actual pinned-provider cases passed; see COVER-SELECTION-EVAL-2026-10-09.md |
| C10 | Exact merged API deployment and iOS build finish processing and reach internal TestFlight | not_run | Release steps follow accepted QA and review |

Each execution record must name commit/build, environment, device, fixture,
observed interaction and stored outcome. Synthetic provider responses establish
integration and UI behavior, not live grading quality. Provider quality and
platform acquisition are evaluated separately with public/permissioned media.

## Release record

PR #130 is open; merge and delivery follow final review. Record the final reviewed head, merge SHA,
local gate, scenario outcomes, Render deployment, EAS build source/version,
Apple processing, tester availability, and exact resource cleanup here.

### Execution evidence — October 9, 2026

The earlier combined local gate at `f47583e` passed (superseded by the
`1c51736` gate below): 881 API tests, 34 documented
skips, 783 mobile tests, 13 admin tests, Expo Doctor 21/21, types, lint, builds
and dependency audit policy. Native checks used an owned iPhone 17 Pro on
iOS 26.5, current 2.6.11 JavaScript, and a compatible development shell
2.6.6/build 84. The fresh EAS release will compile the final native source.

Native journeys used an isolated development Clerk fixture, real JWT/application
identity resolution, real local API/workers and disposable PostgreSQL. Named
COVERQA sources supplied controlled source extraction, ranking and local S3
transports using public CC0 pizza/burger photos. This proves integration, native
uploads, refresh and saved outcomes; it does not prove live platform acquisition
or representative model quality across all cooking videos. The separate eight
actual-provider comparisons establish a bounded quality canary. A larger real
video benchmark, physical-device and Android checks remain outside this batch.

The first C3 run failed because Expo 57 rejected the old native FormData file
object. Commit `ce59240` adds a shared byte-capable adapter for edit/create/OCR
uploads and regression tests using Expo's actual converter. Fixture 06 confirmed
native save after that fix, but its grading job expired before the race check.
Fresh fixture 07 completed the required race check: revision 2, manual photo
digest `3964bcab9a2e88aed9f944a92327e77da67ef982241d58f45a59463080f23f1c`,
job completed with scrubbed notes, same photo in library and reopened detail.

C1–C9 are local readiness gates. C10 is the subsequent delivery gate, completed
only after reviewed merge, deployment, build processing and tester availability.

Final code head `1c51736` passed the full gate with disposable PostgreSQL enabled:
883 API tests, 34 opt-in skips, 785 mobile tests, 13 admin tests, Expo Doctor
21/21 and all other repository checks. A run without TEST_DATABASE_URL also
passed, but skipped PostgreSQL cases; it is not the database acceptance evidence.

Native tablet checks used an owned iPad Air 11-inch (M4), iOS 26.5, same
development shell/account/API. At `b363381`/`1c51736`, fresh video 09 changed
its cover while the embedded player remained open; explicit close revealed the
selected photo. Native re-extraction then completed, incremented revision to 2
and retained that photo. The older synchronous route's narrower concurrent
cover race has two PostgreSQL regressions at `1c51736`. Manual Toast saved
privately with one ingredient/step and no cover job. Website 10 first exercised
404 recovery, then retried with a controlled valid website transport and saved
privately without a cover job. Its intentionally unavailable external photo
exercised the existing no-photo layout. Native OCR/create-with-photo transport
checks are not claimed; Expo converter tests cover the shared adapter paths.
Tablet portrait was tested; tablet landscape, Android, physical devices and
airplane-mode were not run.
