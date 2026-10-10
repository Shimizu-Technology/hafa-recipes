# Workout domain engine and programming review

This slice implements pure Pydantic 2 models, a small original exercise catalog,
deterministic starter proposals for all five goal families, personal adaptation,
and result-based progression proposals. It has no database, authentication,
provider, application-startup or network dependencies. No user history is mutated.

It is an engineering foundation, not completion of P07/T03 or D03. The exact
catalog, numeric doses, substitutions, progression, goal conflicts and returning
user rules still need the planned qualified programming review before public
personal programming is represented as approved. Do not close D03 from unit-test
counts. The API owner must gate public programming until that review is recorded.

## Verified sources and original policies

Research checked 2026-10-10. ACSM revised its resistance guidance in March 2026;
the public summary was available, but the full linked journal paper did not load.

| Source ID | Guidance used |
| --- | --- |
| [cdc-adults](https://www.cdc.gov/physical-activity-basics/guidelines/adults.html) | Adult public-health reference: 150 moderate or 75 vigorous aerobic minutes weekly, or equivalent combination; strengthening major muscles on at least two days. Some activity is useful. This is not an immediate novice dose. |
| [hhs-gradual](https://www.niddk.nih.gov/-/media/Files/Diet-Nutrition/Physical_Activity_Guidelines_2nd_edition.pdf) | Low-fitness adults can begin with small comfortable additions, e.g. 5–15 minutes two or three times weekly, and increase gradually. Build duration/frequency before intensity; consider fitness, age and experience. |
| [cdc-effort](https://www.cdc.gov/physical-activity-basics/measuring/index.html) | Aerobic relative effort and talk-test guidance. Aerobic effort is distinct from resistance-training repetitions in reserve. |
| [acsm-2026](https://acsm.org/resistance-training-guidelines-update-2026/) | Regular training and individualization matter; bodyweight, bands and home exercise can work. Strength/hypertrophy optimization differ; failure and complicated periodization are not universal requirements. |
| [nhs-strength](https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/) | One general-strength reference uses 8–12 repetitions and two or three sets, introduced gradually. It is not the only valid prescription. |
| [nsca-frequency](https://www.nsca.com/education/articles/kinetic-select/determination-of-resistance-training-frequency/) | Frequency/recovery depend on experience, program structure, other activity and schedule. A day between overlapping muscle work is a general guide, not a guarantee of recovery. |
| [nhs-running](https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/couch-to-5k-running-plan/) | Beginner run/walk sessions, recovery days and repeatable stages. The stated endpoint is continuous time, not guaranteed distance or completion date. |
| [cdc-weight](https://www.cdc.gov/healthy-weight-growth/physical-activity/) | Activity supports weight management; individual needs vary and exercise alone does not establish a predicted weight change. |
| [cdc-older](https://www.cdc.gov/physical-activity-basics/guidelines/older-adults.html) | Adults 65+ also need balance activity fitting their abilities. |
| [nsca-athletic](https://dxpprod.nsca.com/education/articles/kinetic-select/application-of-program-design-to-training-seasons/) | Sport/season workloads influence general conditioning; this engine is not technical sport coaching. |

All exercise instructions are original short text. No source images, audio,
videos, paywalled tables or full branded programs are redistributed. Source links
and paraphrases do not establish rights to rehost media or organizational
endorsement. Numeric policies below are original Håfa defaults, pending review.

## Interfaces

Import from `app.domains.workouts.schemas` and `.programming`:

```python
build_program(profile: TrainingProfile, start_date: date, weeks: int = 4) -> ProgramProposal
adapt_workout(content: WorkoutContent, profile: TrainingProfile, minutes: int | None = None) -> AdaptationProposal
evaluate_progression(prescription: ExercisePrescription, completed: list[CompletedExposure], profile: TrainingProfile) -> ProgressionProposal
evaluate_running_progression(stage: int, completed: list[RunningStageResult], profile: TrainingProfile) -> ProgressionProposal
```

Models forbid extra fields and non-finite numeric values. `model_dump(mode="json")`
produces persistent JSON and `model_validate`/`model_validate_json` revalidates it.
The calling API must apply authorization, identity ownership, current revision
checks, field-specific consent and idempotency before reads or writes. The models
do not carry database owners or imply authorization. Do not persist server data
from a direct `model_copy(update=...)` on untrusted input, which bypasses validation.

`TrainingProfile` fields:

- `adult_confirmed`, `primary_goal` (`general_fitness`, `strength`,
  `body_composition`, `running`, `athletic_conditioning`), `secondary_goals`.
- `experience` (`new`, `returning`, `regular`); `equipment` nullable list of exact
  catalog identifiers; `available_days` Monday=0 through Sunday=6; IANA
  `timezone`; `session_minutes` 5–180.
- Optional `age_years` 18–120, `weight_kg`, `height_cm`; none is required to generate
  a basic adult proposal. Adult confirmation is separate from exact age.
- `readiness` (`ready`, `unknown`, `limited`), `movement_exclusions` (catalog IDs or
  movement tags), `limitations` (unresolved free text), `interrupted`.
- `running_baseline`: `novice_start_confirmed`, `accepted_stage` 0–8,
  `comfortable_walk_minutes`, `comfortable_run_minutes`, `recent_weekly_minutes`,
  `recent_runs_per_week`, optional `event_distance_km` and `event_date`.
- `other_activities`: local `date`, `name`, nullable `strenuous`, nullable
  `duration_minutes`, nullable `origin_id`.
- Optional `strength_priority` (`strength`, `muscle`, `both`),
  `body_composition_priority` (`maintain`, `fat_loss`, `muscle_gain`),
  `activity_focus`, `available_loads_kg` (same load convention as the prescription).

Unknown equipment is distinct from an empty inventory. Unknown baseline/readiness
is not a fabricated baseline or medical clearance. Unrecognized exclusion strings
and unresolved limitation text require a question rather than diagnosis or silent
ignoring. UI should offer catalog tags while preserving declared wording elsewhere.

`WorkoutContent` has `id`, `version`, `parent_version_id`, `title`, `kind`
(`exercise`, `accessory`, `session`, `program`), `provenance`
(`source`, `user`, `suggestion`), ordered `blocks`, `source_url`, required/optional
equipment, optional estimated minutes and notes.

Blocks have `id`, `label`, `grouping` (`sequential`, `circuit`, `superset`,
`interval`), nullable `rounds` and round-rest seconds, ordered `exercises`, and
evidence. Exercise prescriptions separately support sets, rep ranges, per-side
meaning, duration, distance, rest, tempo, effort, load/unit/convention, notes and
field evidence. Load conventions are total, per-hand, added or assistance. Source
rounds never silently become sets; a source load never becomes a personal load.

`ProgramProposal` returns `status` (`ready`, `needs_information`, `conflicts`,
`unsupported`), rule version, source IDs, questions, warnings, assumptions,
progression policy and `sessions` (`id`, local `date`, `purpose`, `workout`). A
conflict or unsupported event target can contain useful partial alternatives;
do not label those an accepted complete solution. IDs are deterministic hashes of
the date, rule and prescription. They are not database ownership or privacy grants.

Adaptation returns a separate suggestion version only when review prerequisites
are met. Unknown movement/dose or a time reduction without verified structure
returns questions, not a guessed shortened result. Changed movement evidence is
removed from the suggestion; the untouched source parent retains it.

## Starter behavior and progression

- General fitness combines two short strength opportunities with comfortable
  walking opportunities, where availability permits. The adult 150-minute
  reference is visible as context, not an immediate demand or claimed outcome.
- Strength uses the catalog's squat/hip/push/pull/trunk coverage. New/returning
  users start with one introductory set, regular users with two, using 8–12
  controlled reps. Equipment/exclusion/time gaps are explicit. This small catalog
  is a foundation template, not complete advanced strength or hypertrophy tuning.
- Body composition requires a declared maintain/fat-loss/muscle-gain priority,
  combines strength and aerobic work and makes no calorie/weight-loss prediction.
- Running requires an explicit novice choice and walking baseline or current
  running frequency, minutes and comfortable continuous time. Beginner sessions
  use recovery-day spacing. Original stages begin at six 30-second runs/90-second
  walks plus five-minute walking ends; later stages are separate reviewed
  progression proposals. They are not NHS's program. Established runners receive
  an easy maintenance proposal bounded by their declared baseline/time. Race
  targets are explicitly unsupported by this catalog with maintenance alternatives.
- Athletic conditioning uses general strength/aerobic work and reserves sports
  dates, avoiding adjacent-day extra strength as an explicit product policy. No
  sprint/jump/ballistic or technical sport prescription is invented.
- Adults 65+ receive balance work when stable support is declared, or an explicit
  coverage gap. No template guarantees injury prevention or recovery.

Preparation/work/rest/transition estimates stay inside the stated time cap.
Reduced coverage is disclosed; rest is not compressed to force a fit. Supplied
dates are local to the profile timezone. No function uses the current system
clock. Plan generation is not a rescheduler: API orchestration must preserve
completed sessions, show future-scope changes and avoid missed-session stacking.

Baseline weeks repeat until actual results justify a separately accepted change.
Load progression proposes the smallest declared load increment within a 5% Håfa
cap after two distinct comparable upper-range exposures with complete sets,
manageable/easy feedback and explicit absence of pain. Same-day duplicates,
conflicting records, missing feedback, different load conventions and assistance
loads do not qualify. This exact rule is a product default, not ACSM's mandate.

Running stages advance only after three distinct dated comfortable, complete,
pain-free results; duplicates/conflicts and incomplete feedback repeat the stage.
The API accepts the proposed stage into the profile only through a reviewed
future change. No calendar-based escalation or silently applied progression.

## Test coverage and integration handoff

`api/tests/test_workout_programming.py` covers the research G01–G28 behaviors where
the pure engine owns them, plus JSON round trips, bounds, all five families,
running-stage feedback, unknown movements, supports, shortened-workout questions,
units, duplicate actuals, source preservation and missing dose. The G25 test proves
domain-exposure deduplication, not Health synchronization. G12 proves new-plan
calendar uniqueness, not the full UI missed-session rescheduling flow. G24 proves
source immutability, not durable database-history acceptance.

No UI/native/provider/comprehensive application acceptance has been executed for
this slice. The main implementation owner must test authorization and saved
outcomes after integration, and keep the broader QA ledger honest. No servers,
tabs, devices or containers were started; the local uv environment is a development
dependency directory, not a running resource. Branch/worktree are preserved for
integration by the main task owner.
