# Actionable coach backend

This slice implements a persistent adult general-fitness conversation and reviewable actions. It does not change Recipes routes, database initialization, deployed flags, providers, native screens, or production resources. The coach proposes changes; explicit acceptance is the only path that applies them. Completed session rows and historical prescription snapshots are never rewritten.

## Integration hooks

Mount both `coach_router.router` and `coach_router.send_router` in the optional Workouts router assembly, after migration 035 is verified. Reads/clear/undo use `WorkoutsRoute`; message sends and acceptance additionally check the coach capability before authentication or JSON parsing. Existing main middleware must retain no-store headers on Workouts errors. No new migration or configuration field is required: the existing `workout_coach_model`, master product/AI flags, capability registry, and automation tables are used.

Use one process-local `WorkoutCoach` instance. Production defaults to `ProductionCoachProvider`; development requires BOTH `allow_paid_ai_in_development` and an explicitly injected development key. An inherited production key never enables development calls. Test environment refuses the real provider. Root still needs to register/check `workout_coach` accounting and budget controls before activation. Provider requests are always attributed with `job_id=None`, avoiding the Recipes extraction-job foreign key.

After generic AI consent revocation or account/product deletion commits, call `workout_coach.cancel_owner(stable_app_user_id)` to stop this process's active provider calls. Database generation/consent/request-state checks independently fence other processes and late replies. Owner locks are released before HTTP or provider calls. A revocation can race with already transmitted HTTP; cancellation cannot recall an external request. Its returned content cannot commit after the fence changes.

Source-based composition is optional injection:

```python
async def compose_library_program(profile, start_date, weeks, sources):
    # sources: [{"id": str(UUID), "revision": int, "content": dict}]
    # Return the validated ProgramProposal; perform no provider I/O here.
    ...

workout_coach = WorkoutCoach(
    ProductionCoachProvider(), compose_library_program=compose_library_program
)
```

The callback receives owned, health-safe sources and the effective profile, including manual activity conflicts. The receipt pins every source revision and acceptance rechecks each pin. The callback must preserve original sources, attribution and prescription provenance; its returned sessions must be future proposals and validated by the domain programming engine. Without the hook, source planning fails usefully rather than silently substituting a generic plan.

Coach-owned program/adaptation proposals retain the existing bare proposal JSON shape. **Existing generic acceptance routes must delegate coach-owned proposal IDs to `coach_actions.accept_action`**, or reject them with a link to the coach acceptance endpoint. Otherwise they can bypass fresh coach consent/receipt checks and cannot record undo provenance. `receipt_for` identifies coach ownership (404 means generic proposal). Delegate before any existing accepted-record replay path. The helper returns a receipt with `record_id`; a generic route must then fetch the owned saved record and return its existing `RecordResponse` shape rather than returning the receipt under that response model. The new coach endpoint is already safe; this hook is required before exposing existing acceptance to coach IDs. Profile/schedule/progression acceptance is provided only by this slice.

Existing automation export includes conversation and proposal rows. Product erasure already removes automation tables under the account owner lock; whole-account foreign-key cascades still apply. Conversation clearing preserves only content-free request UUID/time/quota tombstones, not old text, hashes, profile snapshots or proposals. Accepted training records remain in the library/program. A cleared request UUID returns 410 rather than recreating memory. Root privacy copy must explain the short quota/idempotency receipts; a later retention cleanup may remove tombstones older than the rolling-day/retry retention policy.

## API and receipts

All mutations require `X-Workouts-Generation`. Each request uses the stable application owner resolved by existing authorization, never the external authentication subject.

| Endpoint | Request/result |
| --- | --- |
| `POST /api/v1/workouts/coach/messages` | `{request_id: UUID, message: string <=4000}`. Returns `id`, `request_id`, `generation`, `state`, user/assistant text, action summaries, and `created_at`. |
| `GET /api/v1/workouts/coach/messages?limit=50&offset=0` | Owner-only history, newest first, limit 1–100. Old context remains available to its user. Cleared tombstones are omitted. |
| `DELETE /api/v1/workouts/coach/messages` | Clears retained conversation content and associated proposal rows; fences in-flight commits. 204. |
| `GET /api/v1/workouts/coach/actions/{proposal_id}` | Owner-only concrete proposal, kind, profile/target revisions and expiry. No internal before/lease/context metadata. |
| `POST /api/v1/workouts/coach/actions/{proposal_id}/accept` | `{title: string}` (default `Training plan`). Explicitly applies a ready, unexpired, current proposal. Returns record ID, revision and accepted state. |
| `POST /api/v1/workouts/coach/actions/{proposal_id}/undo` | Reverts an unchanged future action or removes a completely unused created copy/plan. Fails when history/revisions/usage changed. Returns undone state. |

Message states are `pending`, `completed`, `failed` and internal `cleared`. Action states are `proposed`, `accepted`, `undone`. A UUID replay returns the same stored receipt without another paid call; a different body using that UUID returns 409. Abandoned pending reservations become failed after three minutes; a new UUID is required to retry. Provider failure never leaves a persisted action. Beta quota is 50 reserved messages per rolling day, under the owner lock. Cleared receipts count, and distinct content-free `AIInvocation.request_id` records prevent product-history erasure from resetting paid-call quota. Both Responses turns count once.

The strict tools are:

| Tool | Server behavior |
| --- | --- |
| `propose_training_plan` | Deterministic `build_program` for all five goal families, or injected source composition. Requires current declared baseline/readiness for ready output. Dates are explicit and use profile timezone. |
| `adapt_saved_workout` | Creates a separately accepted adapted copy with original source version ancestry. Missing timing/baselines remain questions; source loads are not adopted as personal loads. |
| `update_training_preferences` | Proposes goal, experience, equipment, available days and session minutes. No weight, age, height, medical limitation, readiness or health-import fields can be written by this tool. Such changes require the profile editor. |
| `edit_future_schedule` | Moves/skips one strictly future uncompleted session. Moving maintains a rest day, rejects occupied days and declared unknown/strenuous activity conflicts. Acceptance and undo repeat date/actual guards. |
| `review_actual_progression` | Server evaluates two comparable loaded sequential bilateral exposures using reviewed catalog IDs, exact prescription snapshots, current corrections, declared available increments, completion, difficulty and explicit pain feedback. A supported increment creates a separate suggested copy; absent/unsafe/unsupported evidence holds. |

Undo creates a new profile/program revision rather than editing a version. New workout/plan copies can be removed only when unchanged and unused: actuals, program version references and derived workout copies block removal. Past/today plans and schedule entries cannot be undone through this future-only action path. Existing manual editing and immutable correction flows remain separate.

## Context and provider constraints

The structured current profile overrides earlier conversational assertions. Only completed prior messages created **after both** the current profile update and current AI consent acceptance are eligible for model context. Re-consent never revives earlier messages. The user can still read them in history. Fresh generation, consent timestamp, profile, readiness, history, library/program revisions and reservation nonce are checked before each provider send and before the atomic final message/proposal commit. Acceptance repeats consent, revision, history and expiry checks.

Context inspects bounded current library items, compact program schedules, current corrected actuals and manual activity declarations. Limits are disclosed in `coverage`: latest 10 library items, 3 programs, 36 schedule entries per program, 12 actual sessions and 20 actual sets per session; latest six eligible conversation pairs. Source URLs, raw notes/captions and evidence text are omitted from provider input. Oversized library entries are omitted and uninspected IDs are rejected. Context exceeding 60 KiB fails before a reservation/send rather than claiming a complete inspection.

Imported activities with any origin ID are excluded. Health/provenance flags, restricted provider sources and nested health derivatives are excluded from library, program and session snapshots. No Health backend route or observation table is queried by this slice; `used_health_context=False` denotes no imported Health context, while user-declared profile body metrics remain governed by existing global AI disclosure. Root must preserve explicit provenance flags on any future health-derived program/session snapshots and apply `health_activity_exclusion_clause` in any future activity query. Neither a device permission nor an `ai_health_context` grant activates Health context in this coach.

Responses uses strict function schemas (`additionalProperties:false`, every field required, nullable optional values), `store:false`, no parallel tool calls, at most three actions and two provider requests, 1800 output tokens per request, 45-second HTTP timeout and a 100-second orchestration deadline. The second request includes all original output/reasoning items and function outputs; tools are disabled on that final turn. Input and response bodies are bounded. Refusal, incomplete output, malformed/unknown tools and uninspected IDs fail closed. Tracker usage is explicitly normalized from Responses input/output token fields into the existing accounting interface, without response content. Raw provider errors are never returned or logged by this slice.

The provider contract follows OpenAI's official [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) and [Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses). Those references support the schema/continuation/request contract; they do not establish the quality or safety of this application's coaching behavior.

Untrusted source names/messages stay in data/user input and cannot become developer/system instructions. Static diagnosis/rehabilitation/clearance and chest-pain/fainting requests receive an appropriate general-fitness boundary without a provider send. This keyword boundary is only one layer; prompt quality, ambiguous medical requests, disordered-exercise/dieting requests and tool-selection behavior require live model acceptance, not just unit tests.

## Validation and remaining acceptance

Tests use fake providers/HTTP transport and a separately named disposable PostgreSQL database on the borrowed root test container. They cover strict schemas, Responses contract/accounting, explicit development-key guards, persistent/idempotent history, owner isolation, rolling quotas including cleared/audit receipts, concrete previews, acceptance/undo/versioning, normal four-week schedule inspection, source pinning, comparable actual progression, missing/pain feedback hold, actual/source immutability, medical boundaries, unknown IDs/tools, no inferred body metrics, and real in-flight consent/clear/profile/cancellation fences. No actual provider request or Health/device prompt is made.

Final local validation: 43 coach cases pass; the combined coach, programming and existing automation gate passes 130 cases. Ruff and staged diff whitespace checks pass. The disposable `hafa_workouts_coach_test` database is removed after the run; the borrowed root container and its other databases remain unchanged. No servers, browsers, simulators or provider resources were started.

Full app integration, required reviewer/CI gates, native conversation/preview/accept/undo/error journeys, real model safety/quality acceptance, production-budget enforcement and TestFlight acceptance remain root work. Qualified review of the underlying programming policy remains D03 pending; neither a proposed plan nor a passed backend test is medical or qualified programming approval. Running-stage advancement, unilateral/circuit progression, richer schedule shifts and a coach profile-editor confirmation bridge are not implemented by these tools; unsupported progression holds rather than inventing equivalence. The underlying deterministic running stage engine remains available for a later validated action adapter.
