# Background export under a matching Recipes workload

Local source `ee95cd2e513d198b190f23107d3b076f1f6e8695` passed 62 focused timing/chat tests and 385 full harness tests without skips, including the timeout-classification fix and chat observations. AST/Ruff/format/diff checks and independent source/context/fixture review passed. Earlier `44ef6e1180d43ee1606ca1149c7f8c7072b57979` passed 40 focused diagnostic and 348 full harness tests. These are exact tested sources; subsequent changes require their own affected local gates before a hosted experiment.

Three hosted failed receipts remain immutable. Run `38106174584` at `316e044db00cc46c6fad45929f6aca69a43aeca1` passed the Recipes baseline but failed mixed relative Recipes latency and an individual-page `/up` witness. Run `38112155265` at `44ef6e11` failed baseline chat p95 at 1,654.883ms against the unchanged 1,000ms write limit. Run `38118689517` at `ee95cd2e` failed the same baseline gate at 1,163.880ms; its chat component diagnosis was unavailable. Neither of the latter runs executed mixed traffic. Their other baseline gates and cleanup passed. No component cause or production optimization is established by these failures.

The branch starts at `7b35c34b8ac135c687437ef9a6e92d334504fc8e` and preserves existing profiles and receipts. The synchronous 1.810-second admission remains failed. Production is unchanged and R04 remains open.

The new coordinator runs a fresh Recipes-only baseline followed by mixed traffic on the same owned PostgreSQL/database, recreating only the API. Each phase first completes client/hash/HTTP preparation and exact-target observer validation under one 60-second pre-phase bound, counted inside the unchanged 1,900-second total work limit. A fresh owned control folder exchanges bounded PREPARED, one fixed future monotonic start T and OBSERVING acknowledgements. Host, load and observer must share the verified Linux time-namespace inode. The monitor acknowledges when its first actual sample begins; only then may prepared client traffic start within one second of T. Missing, late, malformed or failed acknowledgement/clock binding fails.

Traffic, including final polling and HTTP reconciliation, must finish by T+300. Protected last-turn anchors remain 298 seconds; import/Recipes polling targets remain five seconds apart through 295 seconds, with no final sleep that would consume the reconciliation budget. An export still valid under its own 120-second server deadline can nevertheless fail this offered-load window; it is never delayed or truncated to manufacture a pass. Every client HTTP completion is timed. The unchanged host monitor runs 450 seconds; its actual end minus actual last client HTTP completion must be at least 150 seconds, with zero unsettled requests. Absolute times and namespace identifiers stay private; only the fixed numeric interval proof is published.

Both phases retain 450-second observation, 470-second coordinated phase wall limits, one persisted 120-second finalization budget and the 35-minute workflow. Pre-phase preparation is additional bounded work inside 1,900 seconds, not hidden time or an observer extension. Both 150-second tails require actual evidence. Neither is the full acceptance plan's ten-minute idle drain.

Both phases use eight independent protected Recipes readers with two-second initial offsets and absolute 16-second turns. There are 150 requests for each of `/up`, list, detail and search. Mixed adds Workouts library/activity reads without thinning Recipes. Five heavy cycles remain anchored at 0/60/120/180/240 seconds and include the original Recipes text/OCR/manual/video/chat, cache/fallback covers, Workouts text/image/PDF imports and acceptance, activity/coach/manual-workout writes and original-session UUID replay. Both heavy-cycle and protected-reader starts must occur within one second of their original monotonic anchor. A missed slot raises the fixed `workload_slot_missed` failure before starting that turn; later requests never bunch together to fill it. Small scheduling jitter within one second remains allowed. Any workload failure cancels and awaits every sibling reader/heavy/poll task before saving the failed report. No automatic retry fills a missed or failed turn.

Each mixed cycle creates one durable export with its own original request UUID. Its same job is polled every four seconds, validated READY only after actual-end audit and source-reference retirement, downloaded as 19 complete guarded pages, then cancelled. The export owner remains isolated from all heavy actors. The unchanged seed holds 190 workouts and 190 full immutable versions; independent prescription hashes retain every original 40 × 4,000-character note and linked revision. Profile, permissions and consent must remain identical within and across the five exports. Actual projection, JSON, AES and committed writer/finalization stages remain real. The historical 61,231,576 cipher-byte fixture floor cannot shrink; all five cipher totals must match. Nested stage timings remain inclusive and are never summed.

The instrumentation default remains one build. This wrapper explicitly permits at most five sequential builds; it does not replace the worker's source builder or alter application clocks. Per-cycle proof retains 120-second admission-to-deadline,600-second admission-to-expiry, actual-end completion≤120 seconds, one singleton slot and zero remaining snapshot/page/registry/task/heartbeat/pending-ACK/retirement references. New admission is≤1,000 ms; reads/pages/status are≤500 ms. Existing writes, relative Recipes p95≤1.25×/p99≤2×, nearest-rank estimates and 410 MiB pass/460 MiB stop/any-OOM boundaries remain unchanged.

Actual build and individual-page overlaps are independently derived from settled spans for every cycle/category. Reader turns are never moved to force witnesses. A naturally unwitnessed interval fails this scenario's concurrency proof; it does not justify slowing/holding the producer or claiming that a planned offset overlapped. Interrupted/missing/truncated/slow witness evidence cannot be hidden in aggregate percentiles.

The API remains 512 MiB/equal swap/0.5 CPU on native x 86 with the existing pinned Python/FFmpeg/81-package graph. Seed installs 045 before startup. Internal workers/routes, DB, media/PDF/codec/encryption execute normally. Authentication, provider HTTP, acquisition and S 3 remain synthetic. Fake provider attempts are expected; real provider calls remain zero. There are no real keys, published ports, production DDL, deployment or resource resizing. Filtered tracked contexts, exact ownership, internal networks and always-clean remain mandatory.

The new workflow admits only the exact same-repository `codex/workouts-export-jobs-mixed` branch and reviewed head. Old capacity/legal jobs explicitly exclude that branch; old synchronous/one-job workflows retain their own strict branch predicates. Only the bounded whitelisted numeric receipt is uploaded, at most 100 KiB with one-day retention. No raw spans/timestamps, job/owner/resource IDs, payloads, hashes of private rows, URLs, logs, fixtures or exports are uploaded.

Next gate: independently review source, run prepared finite regressions/static gates in an explicitly owned lifecycle window, then inspect the exact committed filtered plan and runtime graph before authorizing one hosted run. No automatic push or run is authorized by this document. Full three repetitions×15-minute mixed traffic, ten-minute memory return≤10 MiB, legal non-JPEG/concurrent decoding, upload bursts, backpressure, actual crash/recovery/operator proof, compatible rollback, Render/Neon parity and exact installed Recipes smoke remain separate required work.

The numeric receipt also diagnoses protected-route latency during actual export
build intervals, individual page requests, and intervals outside both. These
subsets use nearest-rank p95/p99 and maximum latency. A request spanning build
and page work appears in both subsets; the shared count preserves the total of
150 requests per route. Empty gaps between page requests remain outside.
For each missing build/page witness, the receipt records the closest observed
request-to-interval gap in milliseconds. A zero gap at a touching endpoint still
does not prove overlap. Projection, JSON encoding and AES timings come from the
existing wrappers; their inclusive timings are reported separately and never
summed. Missing, truncated or malformed inputs leave diagnosis unavailable.
All calculations occur after traffic, add no requests or sampling timers, and
retain the existing thresholds and 100KiB numeric-only receipt limit. These
diagnostics cannot change a failed acceptance result or classify a prior run
whose individual request spans were not retained in its public receipt.

The next unchanged workload also observes its five original Recipes chat calls.
Their existing request trace supplies relative start offsets and client duration;
the same monitor sample origin aligns completed GC, event-loop and media stage
intervals. Counts indicate temporal overlap, without asserting causation.
The new wrapper records the real tracker body's SDK and response-validation
duration, accounting-exit duration, and the actual fake-transport duration and
requested wait. SDK resources stay lazy: installation never accesses cached
`.chat` or `.completions` resources. The fake transport retains its original
250ms wait. These timings are inclusive and cannot be added together.
The existing final checkpoint carries the numeric observations once; no extra
HTTP request, parsing pass, clock change or polling timer is introduced.
Only five complete successful numeric rows may be published. Missing pairs,
failed or cancelled calls, overflow or malformed evidence leave this diagnosis
unavailable. No request arguments, prompts, responses, SQL or identifying data
are captured by these hooks. The new coordinator writes compact JSON to retain
the complete numeric receipt under the unchanged 100KiB bound; original
coordinators retain their two-space format. These observations cannot change
acceptance thresholds or turn any preserved failed run into a pass.

Unavailable chat observations carry a separate closed rejection record. Its
fixed boundary and code identify component snapshot, checkpoint, trace, stage
or public-validation rejection; an ordinal is limited to zero through five and
a count to zero through 4,097. A captured component rejection survives later
trace validation without being replaced by missing-row evidence. Unknown input
remains unattributed. Successful observations and unavailable observations keep
their existing contracts; these records never alter acceptance or replay a call.
The pipeline regression exercises real tracker/SDK/250ms transport and the
original status schema through actual driver checkpoint, report and trace
validation, including 813 requests and 1,626 trace lines. It also injects
component, missing-checkpoint and trace faults into this complete observation
path. This is pure fixture verification, not hosted offered-load acceptance.
