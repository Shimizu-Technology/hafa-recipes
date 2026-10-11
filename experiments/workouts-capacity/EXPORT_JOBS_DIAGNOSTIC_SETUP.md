# One background-export diagnostic

This separate diagnostic measures the new durable export API. The original synchronous diagnostic and its failed receipts remain unchanged. Its latest 1.810-second snapshot admission still exceeds the 1,000 ms write gate. A passing background probe would establish only this bounded synthetic workload, not R04, all-format image safety, real-provider quality, sustained traffic or Render/Neon parity.

Source preparation begins at `cd8d1fb433dcaba482dffb7d3d55ced04503d149` in `codex/workouts-export-jobs-diagnostic`. The final reviewed backend export-jobs pin must be merged before preparation can claim end-to-end readiness. No WIP backend bytes, local Docker runtime, push or hosted execution are authorized by this document.

## Workload and contract

The owned empty fixture database receives actual migrations, including 045, and the unchanged seed: 1,000 private Recipes, 190 large workouts and 190 full immutable versions for the export owner. Source padding and volume remain unchanged. No fixture reset, alternative projection or smaller export is permitted.

Eight protected readers retain four sequential liveness/list/search/private-detail requests every 16 seconds, staggered by 2 seconds. Each protected category must have exactly 80 successful 200 responses. Five recipe-chat probes retain offsets 0, 32, 48.25, 96, 128 seconds. Traffic stops inside 180 seconds and the external host observer runs 210 seconds. Actual request/stage spans determine overlap; no overlap is inferred from the planned offsets.

Exactly one original request UUID is admitted at 48 seconds through actual `POST /api/v1/workouts/export/jobs`, returning 202 in at most1,000 ms. Four-second status reads use that same job handle, with no admission replay, new UUID or automatic retry. The job's immutable original admission-to-deadline window must be 120 seconds and its admission-to-expiry window 600 seconds. Only READY with an actual-end audit, idle singleton slot and retired source-task/heartbeat/registry references permits downloading. The actual database admission-to-end-ACK duration must be at most 120 seconds. A scalar pending-ACK tuple can briefly remain after its committed release; final drain separately requires it to be absent.

The client reads all 19 guarded snapshot pages. It checks every manifest total, generation, page identity/order, unchanged profile/permissions, complete 190 workouts and 190 versions, and unique exported row identities. Before trace origin and timed traffic, it independently prepares the 190 deterministic seed payload hashes, including version 1, user provenance and all 40 notes of 4,000 characters each. Only one expected payload is generated at a time; only small hash/index sets remain. Page decoding and content checks run in one awaited thread outside the API budget, preserving the protected client event loop. Each expected prescription must appear exactly once in both datasets, retain its row/content relationship and match its linked immutable version. Counts alone cannot pass a truncated-note or changed-rep export. Private rows, hashes and raw job timestamps never enter the report; the only added public result is `prescriptions_matched`. Only after complete validation does it call `POST /export/jobs/{same_job}/cancel`, expecting 200 with cancelled state and no pending cleanup. Final snapshot/page counts and global slot/task/heartbeat/ACK references must all be zero. Existing training and version history remain saved.

## Isolation and instrumentation

The API uses the existing pinned Python 3.12.15 / FFmpeg 5.1.9 / 81-distribution requirements image, 512 MiB memory with equal memory-plus-swap and 0.5 CPU. Native Ubuntu 24.04/x86 and the newly built immutable image/source/runtime graph must be verified before traffic. Official pinned Python/PostgreSQL digests, filtered tracked context, no published ports, an internal owned network, fake-only keys and the exact owned loopback main/financial-authority URI remain required.

The subclass preparation-plan hook adds only `WORKOUTS_EXPORT_JOBS_ENABLED=true` to the private synthetic fixture environment consumed by the actual seed command. This installs045 before API startup; enabling it only on the later API argv would leave the schema absent. Default capacity/synchronous plan environments remain unchanged, and arbitrary URI/key overrides are rejected. The actual PG seam gate must verify the045 ledger, tables and triggers before the future API starts.

`WORKOUTS_EXPORT_JOBS_ENABLED=true` and `JOB_WORKER_ENABLED=true` enable the actual dispatch path. The existing Recipes worker is intentionally enabled but receives no media/extraction/cover jobs. Imports, deletion maintenance and cover scenarios are disabled. No test-only dispatcher bypass, provider request, source-media generation, production DDL or Render resizing is allowed. Final drain also requires the worker’s shutdown-only `retirement_task` to be absent.

Class-level wrappers await the unchanged `PrivateExportService.create`, source-inventory constructor, shared page builder, encoder, AES and writer/finalization methods. The worker's constructed builtin page source is preserved; this app does not replace it with the old HTTP singleton callback. Stage durations/query counts remain inclusive and must never be added together. The separate fixed-owner synthetic measurements endpoint accepts no supplied job ID, URL, owner or payload. It reads actual singleton/job/recovery metadata and worker reference counts; it emits only fixed numeric/boolean measurements.

Memory passes at no more than 410 MiB and stops at 460 MiB, OOM, repeated protected 5xx or lost/untrusted observation. Protected reads and snapshot/status reads retain 500 ms p95; chat, admission and cancellation retain 1,000 ms p95. Nearest-rank quantiles remain required. A completed but slow probe fails performance; unknown OOM/cleanup evidence cannot pass safety. No sampler subtraction, GC trimming, clock/deadline reset or relaxed threshold is allowed.

## Future execution and evidence

Only the exact diagnostic branch on the existing public repository can run the new 35-minute workflow. Both original capacity jobs skip this branch; the original synchronous diagnostic admits only its own branch. No fork, pull-request-target event, environment, secret, stored checkout credential, paid runner, published OCI image or deployment is involved.

The coordinator reuses the reviewed ownership ledger, exact-ID cleanup,1,900-second work deadline, single durably persisted 120-second finalization deadline and safe exception/failed-receipt fallback. Always-clean runs even when setup or traffic fails. The only uploaded artifact is a fixed numeric receipt bounded to 100 KiB with one-day retention. Public code/image/requirements hashes and runtime versions bind it to source. Raw IDs, URLs, timestamps, SQL, payloads, fixtures, logs, provider keys and private handoffs are excluded. Stage/request offsets and durations permit correlation without absolute timestamps.

Controlled command after root inspects the final pin and prepared hashes:

```sh
python3 -m capacity.export_jobs_diagnostic_ci \
  --repository "$GITHUB_WORKSPACE" \
  --work "$RUNNER_TEMP/hafa-export-jobs-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
  --receipt "$RUNNER_TEMP/hafa-export-jobs-receipt.json"
```

Always-clean uses the same arguments plus `--cleanup-only`. This command refuses local/non-Linux/untrusted branch execution. All runtime and hosted acceptance is NOT_RUN until root explicitly authorizes one reviewed run. Source tests, static checks and a prepared plan alone do not establish admission, completion, saved outcomes, cleanup or performance.

## Protected reads during export

The original run 38096784338 at `d23fb71746046672bfc3c24555aa9e497c889fb1` passed its declared diagnostic. Its faster build and page downloads fell between the protected reader turns, so neither phase witnessed a protected request. Its receipt and scoped result remain unchanged.

This follow-up scenario moves exactly two existing four-request rounds: reader 0 round 3 waits for an observed active build, and reader 1 round 3 waits for the actual first page-request start. The other 78 rounds keep their absolute `start + 2*reader + 16*round` schedule. Each reader still runs ten rounds and every protected category still receives 80 requests. Later turns at 64 and 66 seconds remain anchored rather than drifting after either barrier. The original capacity and synchronous schedulers remain unchanged.

One additional fixed observation GET is allowed only in the strict synthetic jobs app for owner `capacity-22`. It checks the existing class-wrapper metrics signal: one build has started and has neither completed nor failed. It performs no SQL or provider request and never holds the producer. Its asynchronous wait is bounded to 450 ms, leaving time inside the same 500 ms read gate; the client timeout also respects the original job deadline. Missing the active phase fails the scenario without starting another job or retrying the observation. The native four-second status cadence and all admission/page/cancel counts remain unchanged.

Final acceptance independently aligns settled server build and client request spans using their recorded origins. Each of `/up`, list, detail and search must have a successful request with positive intersection during the build and during an individual page GET. Touching boundaries or falling between page requests does not count. Missing, failed, truncated, nonfinite or unsettled evidence fails. The receipt emits only fixed booleans and per-category witness counts/p95 values. The same 500 ms threshold applies to each witnessed phase subset, including a single witness; the global80-sample p95 remains unchanged. An isolated slow witness cannot hide among the other fast requests.

This remains source preparation until a new exact pin, review and explicit run authorization. No previous receipt is reinterpreted, and passing this scenario would still leave sustained load, legal image boundaries, restart/death proof, Render/Neon parity and fullR04 acceptance open.
