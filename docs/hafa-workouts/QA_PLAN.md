# Håfa Workouts acceptance and compatibility QA

Depth: comprehensive for the named full-product and Recipes compatibility journeys. Executor: agent for available authorized local/simulator/browser/native operations; exact physical-device/provider actions require real available hardware and secure fixtures, with Leon/operator participation only when the agent cannot execute them. A required unavailable dimension remains blocked or not run.

Current execution status: **0 of 37 cases executed; all cases below are `not_run`.** Planning review is not application acceptance. No app/server/health connection was launched to create this plan.

## Preflight and fixtures

Record exact API/mobile/web commits, native versions/build numbers, provider environment, schema, feature flags, supported OSs and fixture ownership before each run. Verify development cannot fall back to production. Use synthetic local/disposable PostgreSQL fixtures and non-production identity/media targets; never copy real customer/health data into the suite. Provider mocks must be labeled and followed by required real integration cases.

Fixture families:

- U1/U2: unrelated adult test users; U1 has controlled old/new Recipes identity aliases and Workouts enrollment, U2 has no connection. U3: deletion-race user. Confirm OAuth/relay behavior on non-customer accounts where actual provider transport is tested.
- C1: annotated spoken/visual/caption source collection with independently established exercise/prescription facts; C2: missing-value and ambiguous-movement sources; C3: inaccessible/oversized/hostile sources. Include owned/permitted media and no real medical details.
- W1: reviewed grouped workout with unilateral reps, ranges, time and equipment; W2: adapted version; W3: source/program with long text and partial readiness.
- P1: deterministic reviewed programs and schedule expectations across all five families: general fitness, strength/muscle, body composition, running and athletic conditioning, including a beginner with home equipment. P2: interruptions, game/activity days and conflicting goals. Expected rules must exist before evaluating AI proposals.
- S1: local unsynced session, concurrent-device commands, known timestamps and units. Preserve independently expected actual results.
- H1: controlled records on real Apple Health/Health Connect, including a Håfa-written workout, duplicate external activity, corrections, revoked permissions and missing coverage; no GPS routes required. Exact provider IDs remain in private evidence, not public prose.
- F1: link/share/connection grants between test users/products, reviewed allowed fields, approved legacy whole-account deletion design, owned media and simulated external cleanup failures.

Devices: N = physical iPhone and Android for native execution, with relevant minimum/current supported configurations recorded; I/A = platform-specific physical device; L = exact supported Recipes artifact(s), including public 2.6.4 and older-OS installs where supported; W = marketing/share web at phone/desktop with keyboard and screen reader; X = API/database/worker integration. Simulators complement physical coverage rather than replacing native provider acceptance.

An installed Recipes artifact may have a fixed production API address. Use captured contracts and a faithful source-version QA build configured for isolated API data for pre-deployment tests; record every test-only difference. Then verify the actual distributed binary against the deployed compatible API using controlled non-customer fixtures. The QA build does not substitute for exact-binary production smoke acceptance, and unavailable older artifacts/devices remain explicit gaps.

## Required cases

All cases are required unless their explicitly optional dimension is documented before execution. Each case is counted once; each required device dimension receives its own execution status/evidence. The steps below identify the journey; expand device-specific checkpoints during fixture preflight without changing expected behavior to fit observed results.

| ID | Fixture and actions | Expected visible and saved outcome | Coverage |
| --- | --- | --- | --- |
| C01 | U1/C1: share supported links from source apps, leave during processing, reopen activity | Capture persists before work; appropriate extracted facts/evidence and attribution save; return context survives | N, X |
| C02 | U1: submit annotated text, image/document and manual variants; edit and reload | All advertised input modes save the independently expected structure; draft edits persist | N, X |
| C03 | U1/C2: inspect missing sets/rest and ambiguous movement; save draft; accept a separate suggestion | Missing facts remain visible; no inferred value becomes extracted fact; accepted adaptation has its own version | N, X |
| C04 | U1/C3: import private/deleted/unsupported/oversized/hostile source, then retry/manual completion | Bounded actionable failure; retained private source draft; no internal-network access or secret leakage | N, X |
| C05 | Repeat native share/retry; terminate worker during claim; replay/cancel/delete race | One intended saved result; restart recovery; bounded retries; cancelled/deleted work cannot resurrect | N, X |
| C06 | U1/W1–W3: search/filter/collect/edit; open source/exercise and return | Correct private records/version; filters/drafts preserved; catalog change does not alter history | N, X |
| C07 | U1/F1: preview share, recipient opens/copies, sender revokes | Only intended prescription/source fields exposed; no profile/chat/history; revoke blocks grant access; retained-copy semantics honest | N, W, X |
| C08 | Decline/revoke extraction AI consent; capture each content class and use manual/local draft; inspect provider transport | No third-party AI transmission without consent; useful manual/draft operation; server upload only under its separately disclosed allowed use | N, X |
| T01 | U1 new/existing identity: enroll as adult, skip optional fields, sign out/in, recover | Same stable owner; useful manual start; no duplicate account or implicit data/AI grant | N, X |
| T02 | U1 profile: change goals/equipment/units/timezone; add temporary feedback; expire/remove it | Updated context is inspectable; temporary status expires; removed data stops informing new proposals | N, X |
| T03 | U1/P1: create/import/manual program across all five goal families and beginner/home fixture; inspect and accept | Each promised family fits its independently reviewed availability/equipment/rules; purposes/assumptions visible; persists consistently | N, X |
| T04 | U1/P2: missed days, new basketball/run activity, pause, shortened session and return | Reviewable future changes; no automatic missed-session stacking; completed history/rest preserved | N, X |
| T05 | U1/W1–W2: adapt unavailable equipment/time and user-declared restriction; reject/edit proposal | Reviewed substitutes with rationale; uncertainty/limitations honored; source and personal versions remain distinct | N, X |
| T06 | U1: request direct move then broad plan replacement; change plan while proposal is pending | Domain authorization/revision checks; low-impact receipt/undo; broad preview; stale proposal cannot overwrite changes | N, X |
| T07 | C2/P2 safety suite: incomplete source, hostile prompt text, unsupported medical request, conflicting goals | No source instruction overrides policy/tools; uncertainty preserved; no medical clearance/treatment claim; reviewed rubric passes | N, X |
| T08 | Disable AI/decline consent during planning/training; retry provider failure within bounded budget | Manual profile/plan/workout/logging remain usable; clear finite failure and safe retry, no fabricated success | N, X |
| S01 | U1/W1: start, log ranges/unilateral/timed/distance/grouped work, substitute and finish | Exact actual results save; intended block meaning and prior performance are clear | N, X |
| S02 | S1: lose network, background/terminate/reboot, reopen and reconnect | Same unfinished session resumes; replay saves once; no time-inferred completion; sync state honest | N, X |
| S03 | S1: rapid double-tap, undo after sync, concurrent-device edit and post-delete replay | Idempotency/correction history; explicit conflict; no overwritten or resurrected session | N, X |
| S04 | Controlled clocks: timer pause/resume, notifications declined, timezone/day boundary, mixed units | Accurate timer/date/unit outcomes; no stale notification after stop; accessible in-app behavior without permission | N, X |
| S05 | Complete/partially complete P1, correct actual result, edit later template, inspect progress | History/progress reconcile; comparability/provenance honest; template changes never rewrite prior actual work | N, X |
| H01 | H1/iPhone: connect minimal Health types, partial/no visible data, app relaunch; refresh | Actual eligible records/freshness; no false denial/inactivity claim; app works without data | I, X |
| H02 | H1/Android: permissions/feature/history/background variants; refresh, pagination and cursor reset | Capability-aware bounded sync and deduplication; limits displayed; unavailable features retain manual use | A, X |
| H03 | H1: separately allow server/AI use; revoke one while retaining another | Only eligible minimized context transmitted; grant revocation invalidates memory/use; Recipes sees no health data | N, X |
| H04 | S1/H1: write completed/partial workout, retry, reimport, correct/remove Håfa-owned write | Actual supported fields only; one canonical session; no feedback loop or deletion of another app's records | N, X |
| H05 | H1: overlapping device/source activity, upstream correction/deletion, restricted-origin sample | Reconcile with provenance; no duplicate training load; restricted/unknown samples excluded from AI until reviewed | N, X |
| F01 | U1/U2: cross-user IDs, account switch, signed-out deep links, removed grants and private images | Backend isolation and bounded safe projections; no cache leak; sign-in restores exact authorized destination | N, W, X |
| F02 | U1/F1: Håfa apps entry with other app installed/absent; opt in/out of Recipes context | Relationship understandable; correct app/store fallback; only granted direction/categories used; revocation effective | N, W, X |
| F03 | U3/F1: export, product-data removal, approved global deletion, pending jobs/health sync/cleanup failure | Correct scoped erasure/export; no late recreation; external cleanup retried; legacy semantics reviewed and executed | N, L, X |
| F04 | Public signup/free-beta states, operational quota/provider outage, admin job retry and privacy inspection | Open adult access; no active paywall; disclosed bounded limits; audited authorized admin actions without private health browsing | N, W, X |
| F05 | Long content, large text, VoiceOver/TalkBack, numeric keyboard, reduced motion, slow network | Required controls remain discoverable/reachable; no covered inputs/lost drafts/indefinite spinner | N, W |
| R01 | Supported L clients/U1: Apple/Google/email/recovery/relay, session refresh, same account on old/new clients | Existing identity and ownership intact; issuer/redirect rules preserved; no mandatory new app to retain access | L, N, X |
| R02 | L/U1: Recipes capture/import/cover/source playback, saves/collections, edits/chat, meal plan/groceries/widget | Existing visible and saved results match pre-change expectations; recently shipped media behavior preserved | L, X |
| R03 | Old/new clients/F1: grocery sharing and legacy account deletion with approved shared-account design | Existing privacy/sharing preserved; deletion meaning and actual cleanup agree with reviewed disclosure/design | L, N, X |
| R04 | Mixed workload: recipe+workout imports/cover/chat/session logs; replicas, deployment and compatible rollback | No starvation/duplicate jobs; service meets agreed latency/resource budgets; rollback preserves post-deploy data | X; N/L smoke |
| R05 | Exact store/TestFlight/Play artifacts: privacy/health declarations, reviewer flows, release/download | Real provider/device acceptance and actual public availability mapped to exact source; no claim from upload alone | I, A, W |
| R06 | Synthetic owned data: replay additive migrations, start old/new API releases, capture legacy responses, disable capabilities and roll back code | Stable ownership and new records retained; strict old-client contracts/startup checks compatible; booted `/up` makes no dependency query | X; L contract |

## Evaluation and workload evidence

Annotated extraction fixtures cover spoken, visual, caption-only, combined, music-only, incomplete, multiple-workout and inaccessible sources. Score exercise/block identity and source-supported prescription separately from schema validity and speed. Record unsupported/missing facts honestly; a model's confidence string is not independent evaluation. Workout/program content review and numeric progression rules remain D03.

AI evaluations include repeatable profile/history contexts, prompt injection, self-reported limitations, goal conflicts, missed sessions and stale tools. Compare cost/latency against quality per capability; establish authorized paid-provider budgets before invoking real evaluations. Never claim a mocked provider proves model quality.

Mixed-workload fixtures exercise realistic permitted media sizes and concurrent chat/logging under proposed memory limits. Agree stop/pass thresholds before the run, including latency/error/queue/resource and restart recovery. Sustained sampled idle metrics do not substitute for this test. Use isolated environments, then controlled production smoke and representative observation.

## Execution ledger and completion

For each case persist role, fixture ownership/reset, exact actions/expected outcome, commit/build/environment/date, device/input dimensions, status (`passed`, `failed`, `blocked`, `not_run`), actual observations, screenshot/recording plus saved-result evidence, defect/fix/retest history and next checkpoint. Count once per case; any required untested dimension prevents acceptance.

Before each runtime phase use lifecycle session baseline/claims, clean only owned resources, and record cleanup or exact handoff. Never stop borrowed servers/devices/services. Domain fixtures have their own cleanup; a server shutdown does not erase test health data automatically.

Run affected cases again after material review/integration fixes and preserve original failure evidence. Report automated gates, review coverage, executed scenario acceptance and actual release delivery separately. Full completion requires all 37 case outcomes and required dimensions, D02/D03 review, and the supported-client/provider/device inventory to be closed without material blockers.

Separate deployment readiness, store-submission readiness and final delivery. Isolated/native pre-deployment checks pass before the dormant compatible API is deployed. Actual distributed Recipes binary smoke and remaining production-dependent dimensions follow that deployment. All 36 cases other than R05, plus R05's build/reviewer/privacy/provider checkpoints, must pass before store submission; final public-download/availability checkpoints occur only after approval/release. R05 remains incomplete until those real results exist. These distinct gates avoid pretending deployment/public delivery was already tested.
