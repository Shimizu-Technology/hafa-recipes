# First isolated runtime smoke: failed baseline

The Workouts-off Recipes baseline reached the 460 MiB stop threshold. The
watchdog stopped the exact owned API; mixed traffic and upload bursts did not run.
This is a material rollout blocker. No production source or settings changed.
R04 remains open.

Runtime source/image are those in [INVENTORY.md](INVENTORY.md): source `fdf0798`,
backend `990cc56`, final image `sha256:cbfd1a03036756e1ef47663978068dedafa5f8e265b78e209419b64596a5d461`.
Linux amd64 ran under ARM64 emulation, with 512 MiB/no extra swap and 0.5 CPU.
Authentication/provider/storage were synthetic; HTTP, Pillow, ffmpeg, PostgreSQL,
actual middleware, migration and job behavior remained real.

## Observed results

- Actual core and Workouts migrations 034–044 passed in an empty owned database.
  Seed: 24 synthetic owners, 1,000 Recipes; initial Recipes table size 14,221,312
  bytes, not the observed production distribution. Large Workouts export fixtures
  belonged to separate owners and were not requested during this baseline.
- Real startup passed: `/` and `/up` returned 200; master-off Workouts returned
  404. The experiment network was internal, without published ports or a gateway.
- The planned 300-second baseline stopped early. Recorded sampling covered
  85.58 seconds and 168 observations. Initial cgroup memory was 175.60 MiB;
  measured current/peak reached **470.17 MiB** (493,010,944 bytes). The first sample
  above the stop threshold triggered shutdown; no OOM was observed.
- Before shutdown, 120 completed HTTP access records were all 200. They included
  two text/OCR/manual/video submissions each, list/search, liveness and job polls.
  This does not mean the interrupted run passed. API exit 137 resulted from the
  watchdog's short stop deadline; Docker reported `OOMKilled=false`.
- Persisted outcomes at shutdown: 1,003 Recipes; one extraction completed with a
  saved recipe, one cover completed, and a second extraction remained processing.
  Eight AI provenance records existed; no Workouts imports, sessions or activity
  logs were created. Processing at an intentional stop is not a tested recovery.
- Latency percentiles are unavailable for this run: the driver raised a connection
  error after shutdown and did not write its final report. That harness defect
  is fixed below; the original failure and missing evidence remain recorded.

## What the samples establish

At the stop sample, API PID 1 had RSS 410.75 MiB and HWM about 429 MiB. The Python
sampler had RSS 25.61 MiB, and concurrent FFmpeg PID 330 had RSS 92.25 MiB.
Earlier FFmpeg subprocess RSS maxima reached 110.70 MiB. RSS can double-count
shared pages: these figures must not be summed to derive cgroup usage. Sampler
memory is included in the measured 470.17 MiB; it must not be subtracted from a
historical peak or used to change the 410/460 thresholds.

The first cover window is visible in the samples: FFmpeg processes ran around
elapsed 25–31 seconds with API RSS near 195 MiB. After they exited, API RSS rose
to roughly 426 MiB, then remained near 410 MiB. At elapsed 85.58 seconds a new
FFmpeg process was present alongside that retained API memory, and the cgroup
crossed the stop threshold. The persisted second extraction was still processing.

The likely mechanism is large-thumbnail Pillow allocation/retention followed by
another media subprocess. This is an inference, not proof of a leak or of one
specific normalizer: the run did not capture exact worker `current_step` or Python
allocation stacks before cleanup.

Source evidence narrows the hypothesis:

- `capacity/app.py:fetch_source` supplies a real 4000×4000 (16 MP) JPEG for source
  thumbnails: 288,911 compressed bytes. The OCR input is 1000×1000 (1 MP), 26,691
  bytes. Video is 12 seconds at 1280×720, 10,079,395 bytes. Fixture dimensions and
  compression matter more than assuming a small JPEG has a small decoded footprint.
- `StorageService._prepare_thumbnail_variants` executes real validation and
  `normalize_thumbnail_variants` in its two-worker thread pool. Normalization
  loads the source, transposes EXIF, converts RGB/RGBA, then downsizes and renders
  variants. Several full-size image allocations can precede the downsizing.
- Cover comparison's `_prepare` separately loads, transposes and converts its
  incumbent before downsizing. Its 16 MP bound admits this exact fixture.
- The real cover/video frame helpers use a process media semaphore and actual
  FFmpeg. Their subprocess commands do not specify a decoder/filter thread cap.
  The observation does not establish thread counts or native Render behavior.

## Harness repairs after this run

Commit `49aae6c` changes experiment code only. The driver now writes partial
metadata with `completed=false` and an exception class when transport fails or
execution is cancelled, preserves the failure, and closes the client. It does
not retain exception messages, source bodies or provider responses.

A second defect explained the absence of detail/chat records: the real backend's
`PaginatedRecipes` envelope uses `items`; the driver guessed `recipes` and silently
skipped those calls. It now reads `items`. A regression constructs the actual
validated backend response model and verifies detail and chat requests through
mock HTTP. Thirteen tests passed, including interrupted/cancelled-report recovery;
Ruff and diff checks passed. This fix has not been built into a new runtime image
or exercised by another smoke. Its stronger workload may consume more memory.

## Proposed next diagnostic run — not started

First replace the Python observer inside the API cgroup. A host-side controller,
claimed by exact PID, should collect only the exact owned Docker API ID:

```text
docker stats --format '{{json .}}' OWNED_API_ID
docker exec OWNED_API_ID cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events
docker top OWNED_API_ID -eo pid,ppid,rss,comm
```

The stats client/controller run outside the API budget. Tiny `cat` executions
still briefly consume in-cgroup resources and must be disclosed. Raw cgroup
current/peak/events remain the stop authority; Docker stats can report a cache-
adjusted working set and must not replace them. Keep 410 MiB pass/460 MiB stop
and any-OOM gates unchanged. Capture timestamps before/after each probe and
retain peak/events before stopping. Record numeric PID/PPID/RSS/name, never argv,
environment, request bodies or URLs with identifiers/tokens.

For attribution, add experiment-only metadata events around the existing
thumbnail preparation and cover/video helpers, calling the original methods
unchanged. Emit fixed stage names, start/end times, input byte/pixel counts and
safe failure class only. Add flushed request-category start/end timing outside
the API and aggregate owned-database job status/current-step counts. No private
source or job identifiers are needed. This should distinguish original-thumbnail
storage, cover comparison and the next extraction's frame subprocess.

Then root can authorize a bounded baseline rerun on a fresh owned synthetic
database/API using the repaired envelope/report and external observer. Start with
one explicit video/cover cycle, drain, then a second cycle while retaining the
protected read traffic; stop immediately at the existing limits. Do not alter
thumbnail limits, media concurrency, allocator settings or FFmpeg flags until
that experiment establishes the mechanism. Native Linux/Render parity, paid
providers, Neon behavior and complete mixed/restart/rollback acceptance remain
separate gates. No rerun is currently authorized or active.

## Evidence and cleanup

Private local results: `/tmp/hafa-capacity-plan-fdf0798-native-health/results`.
`baseline-memory.jsonl`, `baseline-stop-summary.json`, `baseline-saved-counts.json`
and seed/fixture logs are retained. `resources.json` records all exact IDs and
cleanup. All five experiment containers and its network were removed, and absence
verified. Host load/watch/test controllers exited and were released. The borrowed
`8c9955f44af2` PostgreSQL container and other owners' resources remain available.
Owner-scoped lifecycle status is clean. Images, fixtures/results and the worktree
are retained for root review; no runtime resources are handed off.
