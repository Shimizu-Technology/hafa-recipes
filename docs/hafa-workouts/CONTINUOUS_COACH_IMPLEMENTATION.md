# Continuous coach follow-up

This backend slice extends the actionable coach from `4c194cf`. It changes only coach modules, their tests and documentation. No migration, deployed setting, provider account, native screen, production database or shared container is changed. Native journeys, live model selection/quality, and qualified programming review are separate acceptance gates.

## Continuous training actions

`review_actual_progression` now checks exact prescribed `(round_index, set_index, side)` cells. A circuit with three rounds and two sets per exercise has six executions; neither the stored round count nor the set count is changed to describe that comparison. A grouped source with an explicit round count and no separate set count is treated as one exercise execution per round, with `sets=None` preserved. Missing round structure, missing sides, duplicates (including normalized `None`/`both` sides), extra cells, partial completion, changed prescriptions, loads/conventions, missing difficulty or pain feedback all hold. Both sides must qualify independently. Loaded cells reuse the existing load-increment rule independently and must produce the same proposed increment.

Bodyweight movements with a reviewed catalog ID can propose one additional repetition after two comparable comfortable, complete, explicitly pain-free exposures. The range endpoints increase by one where known; sets, rounds, sides and absence of an external load stay unchanged. The original Håfa cap is 15 repetitions. At the cap, wall push-up → push-up and sit-to-stand → bodyweight squat can produce a **variant review** with a request to establish the new movement's baseline, not an automatically accepted dose or claimed equivalence. Missing loads on a resistance movement, assistance loads, timed/distance work, and unrecognized movements do not become bodyweight progression.

`review_program_exercise` applies the same comparison to a selected future program session. It proposes changes only to matching future blocks; recorded/today/past entries are preserved byte-for-byte. Accepted changes create a program version rather than editing any actual or historical prescription. A standalone library progression still creates a separate accepted copy.

`review_running_stage` uses the existing original Håfa introductory-stage engine. Three distinct local-date results must match the current full warmup/run/recovery/cooldown structure, record every timed execution, explicitly report comfortable difficulty and no pain, and have coherent actual durations within the recorded wall interval. Additional resistance/recovery, truncated rounds, partial/missing feedback and incoherent timestamps do not receive full-stage credit. Calendar passage is never completion. Stage 8 repeats rather than overflowing the catalog. The next full stage must fit confirmed session time. Existing event-specific or established-running training is not silently converted to the introductory progression.

Acceptance can atomically update the declared accepted stage and matching future program workouts. Frozen sessions remain unchanged. A finished program can produce a profile-only next-stage proposal for a subsequent plan. Undo creates new profile/program revisions and is blocked by changed history, revisions or dependent program changes. Feedback is limited to the latest physical dates among the bounded retrieved actuals. The 28-day recency window is an original Håfa policy: future-dated or older observations do not establish a current baseline.

The [NHS strength guide](https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/) supports bodyweight resistance and gradual development. The [NHS running guide](https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/couch-to-5k-running-plan/) supports comfortable run/walk training, recovery days, preparation and cooldown. These references support those general concepts. Håfa's exact stage doses, two/three exposure counts, +1 rep rule, 15-rep cap, load cap and recency window are original product policies **pending D03 qualified review**, not NHS mandates or medical approval. The NHS plan is not reproduced or rehosted.

## Calendar, pause and return

`adjust_program_calendar` has `operation` `shift`, `pause` or `return`, `program_id`, `expected_revision`, nullable `shift_days` (-365 through 365) and nullable `start_date`. Shift requires a nonzero day offset. Return requires a future date. The tool schema requires nullable fields explicitly; server parsing also supports omitted optional fields.

All recorded prescription IDs are protected, including partial/historical recordings beyond the last 30 rows. Past and today entries are frozen. Bulk changes preserve future ordering and at least the original gaps, declared availability, occupied days, rest between structured hard sessions, and declared activity/game restrictions. An unavailable target moves forward in the preview, not into a missed-session pile. Searches and future planning are bounded to two years. Missed uncompleted pre-pause sessions remain in history; they are never automatically added to return workload.

Pause moves strictly future, unrecorded entries out of the active calendar into the same program's private queue. It is available even when readiness is unknown/limited. Saved content is:

```json
{
  "title": "My plan",
  "proposal": {"sessions": ["past/today/recorded ScheduledPrescription objects"]},
  "schedule_state": {
    "status": "paused",
    "paused_at": "ISO timestamp in UTC, stamped at acceptance",
    "paused_sessions": ["original future ScheduledPrescription objects"]
  }
}
```

The strings inside arrays above describe objects, not literal values in the API. Queue objects keep their IDs, original dates, purpose and workout. No prescription is duplicated into the active calendar. Return reschedules only the intentionally queued unrecorded entries and stores `schedule_state={"status":"active"}`; any recorded queued entry preserves its original prescription. Fresh readiness must be confirmed **after** `paused_at`. The current profile must resolve baseline/readiness/limitation questions and have `interrupted=false`; the coach never clears that declaration silently.

Return acceptance requires a direct human checkbox in the API body:

```json
{"title":"My plan","confirm_return_baseline":true}
```

`confirm_return_baseline` is a `StrictBool`, defaults to false, and is absent from model tools. It confirms that the concrete shown prescriptions match the user's current comfortable baseline; it is not medical clearance. Other accepts can continue sending only a title. Accepted/undone operations retain concrete receipts and version/history guards. Undo of a return restores the dormant pause queue, even when its stored ordinal dates have aged into the past; it never moves active training into the past or changes actuals.

`prepare_session_alternative` previews swapping two future unrecorded session dates or shortening a known timed walk/run-walk. Swaps preserve identities and repeat recovery/conflict checks. Shorter run/walk keeps the explicit five-minute preparation/cooldown and reduces complete interval repetitions; it cannot earn full-stage credit. Arbitrary source/strength work with only a duration estimate asks which work is optional rather than pretending to preserve its purpose. Established or arbitrary interval structures outside this adapter likewise require review.

## Context and integration contract

Message requests add optional `context_workout_id`, `context_program_id` or `context_session_id` (one only), and optional `context_revision` for a workout/program. Owned focused records can be retrieved even outside the default recent-library window. Unknown/unowned/provenance-blocked contexts fail before a provider send; a selected stale revision returns 409. Current corrected actuals remain the default; an explicitly selected superseded session is labeled with its correction ID rather than counted as a second current exposure. Eligible prior messages are scoped to the same focus and still must be newer than both current profile and consent timestamps. The response includes `focus` for native context preservation. Existing two-field requests and their idempotency hashes remain compatible.

Native must render paused status/queue counts, future operation previews, source versus actual versus suggestion provenance, current/frozen sessions, and explicit return confirmation. Clearing conversation remains global in this API; focused-history pagination and an individual-message deletion UX are not added here. Program summaries in provider context now include pause status/time/count, without raw source URLs or full queued content.

Root integration owns:

- Generic program/adaptation acceptance delegation before the existing accepted-record replay path, keeping consent and undo receipts intact.
- A generic paused-program PUT guard: do not silently replace `proposal` and discard `schedule_state.paused_sessions` through the older `ProgramRequest` shape. Return or explicitly reconcile the pause queue first.
- Post-commit cancellation after global AI revocation, product erasure and whole-account deletion.
- `refresh_optional_source_metadata(db, saved)` before coach-created/adapted/progressed library records commit; that root helper does not exist in this slice's base, so no error-hiding optional import is installed here.
- Native focus fields/return checkbox/calendar flows, real model safety/quality, source-composition integration, physical-device acceptance and release gates.

## Scope and evidence

P07 gains result-based continuation for introductory running and exact grouped/per-side exercise feedback. Five-family baseline plan generation and source/mixed composition remain the existing engine/root callback. P08 gains shift/pause/return, swap, known timed shorter alternatives and preserved history; event date/distance declarations remain in the existing profile editor. P11 gains versioned program actions and explicit workout/program/session focus. Catalog adaptation can still propose reviewed same-purpose replacements as a separate copy.

Genuine unsupported boundaries remain: qualified event/race periodization and pace/speed/power prescriptions; health-import-based progression; new movement baselines inferred from a previous variant; automatic timed/distance exercise progression; arbitrary strength/source shortening with unknown optional work; direct arbitrary movement substitution/profile-health confirmation through chat; and automatic multi-action dependency execution. These ask for information or an explicit manual edit rather than inventing dose/equivalence. This is backend coverage, not full P07/P08/P11 native/model acceptance.

Agent-executed tests use synthetic providers and an independently named disposable `hafa_workouts_continuous_test` database on the borrowed root container. Golden cases cover all nine running stages, round/set/side preservation, bodyweight rep/variant proposals, missing/incomparable/pain feedback, local date/recency boundaries, pause/return/games/spacing/frozen history, and no missed stacking. Real API/PG cases cover atomic profile+future-stage acceptance/undo, older recorded protection, actual immutability, direct strict confirmation, source revision/context ownership, swaps and shorter alternatives. No live paid provider, OS Health prompt or native UI is exercised. The DB is dropped after the final gate; the borrowed container stays running unchanged.

Final source gate: **190 passed** across coach unit/policy/API, existing programming and automation suites; **103** are coach/continuity cases. Ruff and staged whitespace checks pass. Whole-app integration and native/model acceptance are not inferred from these counts.
