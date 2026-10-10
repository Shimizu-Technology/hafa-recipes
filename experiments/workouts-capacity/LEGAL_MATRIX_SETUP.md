# Legal non-JPEG boundary experiment

Status: prepared source only. No matrix traffic, hosted workflow, production
activation, input-cap change or capacity acceptance has run. The earlier 470 MiB
baseline and failed mixed run remain failures. The source estimate of roughly
305 MiB for one full RGBA resize and 610 MiB for two is a conditional risk, not an
observed cgroup failure.

The `legal-image-boundary` job is separate from the core `native-x86` job. Each
uses a fresh standard ubuntu-24.04 VM, its own internal network, tmpfs PostgreSQL,
fixture directory and exact ownership ledger. Same-repository PR head SHA or
manual dispatch only; the reviewed workflow has not been pushed or dispatched.
The work deadline is 1,900 seconds plus one persisted 120-second finalization
budget inside the 35-minute job. It never extends the core job or retries a
failed scenario. A deadline failure retains partial evidence.

Both jobs verify native x86 host/Docker architecture before resources, build the
same strictly filtered tracked source with pinned Python amd64/PG manifests and
unchanged runtime requirements, and inspect the new image ID/source label and
actual Python/FFmpeg/pip graph before traffic. There is no preexisting image ID
for this new source. Nothing is published. The tiny numeric receipt records the
public source/image/requirements hashes and versions; private resource IDs,
URLs, fixture bytes, logs, bodies, credentials and exports never enter artifacts.

## Exact coordinator entry point

After root inspects this source/ref, the separate job uses:

```sh
PYTHONPATH=experiments/workouts-capacity python3 -m capacity.ci_run \
  --legal-matrix \
  --repository "$GITHUB_WORKSPACE" \
  --work "$RUNNER_TEMP/hafa-legal-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
  --receipt "$RUNNER_TEMP/hafa-legal-receipt.json"
```

The same arguments plus `--cleanup-only` run in the always-clean step. This
command refuses local macOS, foreign repository/fork/PR-target, wrong head SHA,
and ARM/emulated Docker before creating resources. The pinned PG manifest is
`sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551`;
it never uses a mutable PostgreSQL tag for startup.

The API has 512 MiB/equal swap/0.5 CPU and no published ports. Load runs in a
separate 256 MiB/equal-swap cgroup. All database/authority traffic uses the exact
owned loopback fixture URI and fake credentials. OpenAI/S3/download boundaries
remain synthetic, with no provider/network quality claim. Real database locks,
Pillow validation/normalization, FFmpeg/ffprobe frame/scene paths and the media
semaphore execute. Fixture generation has a separate 1 GiB cgroup, outside the
API's 512 MiB budget. It never normalizes or downsizes the original fixture bytes.

## Inputs and cases

All four fixtures are low-entropy, nonblank PNGs with real MIME, varying alpha
(including transparent and opaque pixels), and EXIF orientation 6. Source bytes
remain unchanged when passed into the real storage/cover helpers. Each is at
most the existing 10 MiB storage cap. Validation also checks the unchanged
40,000,000-pixel and 12,000-pixel dimension limits.

| Input | Dimensions | Pixels | Mode |
| --- | --- | ---: | --- |
| rgba40 | 8,000 × 5,000 | 40,000,000 | RGBA |
| palette40 | 8,000 × 5,000 | 40,000,000 | Transparent palette |
| wide40 | 12,000 × 3,333 | 39,996,000 | RGBA |
| alpha16 | 4,000 × 4,000 | 16,000,000 | RGBA |

The job first runs the same cold Recipes OFF baseline for 300 seconds with 450
seconds host observation. All original baseline protected statuses, read/write
SLOs, fresh-job/frame/save/drain and memory checks must pass. It then retains
that exact warm API/PG/database and runs the matrix, without resetting memory,
restarting the API, forced GC, allocator trimming or subtracting observer cost.
Eight staggered readers maintain the baseline's protected workload: four calls
per turn, a 16-second period, and two-second initial offsets. Protected routes
must all return 200 with nonzero observations; their p95 remains ≤500 ms and
≤1.25× baseline, p99 ≤2× baseline.

| Case | Actual operation and required outcome |
| --- | --- |
| single_rgba | One real storage normalization on the already-warm API |
| two_rgba / two_palette | Two decoder workers, distinct actual synthetic recipes and media locks |
| wide_rgba | Actual storage normalization at the 12,000-pixel dimension boundary |
| rgba_ffmpeg / palette_ffmpeg | Two active decoder calls and a live real FFmpeg child share an observed interval; real frame and scene paths succeed |
| alpha_cover_ffmpeg | Real 16 MP cover preparation, storage normalization and live FFmpeg overlap; cover candidate remains usable |
| cancel_normalizer | Cancel caller while a real executor worker runs; wait for the uncancellable thread to settle and verify next operation recovery |
| cancel_media | Cancel during a live FFmpeg child while the real media permit is held; child terminates and permit returns |
| burst | Four bounded submissions to the unchanged two-worker executor; all settle |
| retained_cycles | Eight sequential alternating RGBA/palette cycles on the same API process |

Eight additional private synthetic recipe records are seeded once, so storage
runs its actual PostgreSQL media-write guard. Only external S3 puts are fake.
The test-only `/capacity/legal/operation` route accepts an enumerated case, not
arbitrary files, URLs, recipe IDs or body bytes. It requires the strict synthetic
identity whitelist, `CAPACITY_LEGAL_MATRIX=true`, and Recipes OFF baseline flags;
it is never imported or mounted by production `app/main.py`. Concurrent requests
are refused. Internal cancellation/overlap instrumentation forwards the actual
production functions and does not change their limits or decoder/media pools.
A short two-worker start barrier establishes simultaneous submissions; acceptance
requires a common live-child/active-decoder witness, not separate peak counts.

The matrix has a 300-second load deadline, each operation a 60-second deadline,
and 450 seconds external observation. Slow/failed/missing/filtered cases fail;
the job does not silently omit them. Direct synthetic helper calls are compute
probes, not product write requests. Their duration is reported through numeric
stage markers; baseline real writes keep their existing 1,000 ms p95 gate. This
matrix does not establish normal application admission fairness or every legal
codec/input combination.

## Observation, failure and cleanup

The external host sampler reads exact-ID cgroup current/peak/OOM/CPU metadata,
Docker process RSS/child counts, protected status counts, queue aggregates, and
bounded stage/loop-lag/GC metadata. Its tiny cat/exec overhead remains included.
There is no Python observer inside the API cgroup. Passing peak is ≤410 MiB;
460 MiB, any OOM, repeated protected 5xx or lost trusted observation stops the
owned API. Original thresholds and cleanup rules remain unchanged.

Case snapshots use atomic replacement. Interrupted runs recover flushed request
metrics and stage timeline/OOM state; they remain failed. The public receipt
copies only fixed numeric/boolean fields and case names. No private recipe,
container, network or account ID is copied. The ledger/always-clean step removes
only validated owned containers/processes/network. Unknown ownership is left
untouched and fails acceptance. Existing root API/Metro/simulator, borrowed PG,
production services and protected shared resources are not used.

Source tests cover real executor observation despite missing ContextVar
propagation, caller cancellation/recovery, exact fixture admission/metadata,
wrong-case refusal, overlap witnesses, unchanged thresholds, partial evidence,
and the numeric-only receipt. Independent source review found and repaired the
reader-rate, separate-maxima overlap and interrupted-report flaws. Runtime,
physical Render/Neon/provider behavior, longer/repeated traffic, every codec,
restart/rollback and complete R04 acceptance remain NOT_RUN.

Latency statistics use empirical nearest rank `ceil(N × q)` (one-based), shared
with complete and interrupted core reports. Five observations select their
maximum for both p95 and p99. The legal and baseline reports must declare that
same definition before relative gates can pass. Old receipts remain unchanged;
a new comparison requires fresh matching reports, not an old lower-rank baseline.

Matrix completion stops new protected-reader turns, then drains outstanding
turns for at most 30 seconds inside the existing 300-second load deadline. The
final atomic snapshot is written only after readers settle. A drain/load timeout
or interruption cancels pending requests, records their unexpected status 0 and
flushed trace failure, and saves `completed=false`. A held late `/up` request
cannot disappear from the final passing receipt. This settlement behavior is
covered with the real Driver request bookkeeping and a controlled HTTP transport;
those tests start no sockets or capacity resources.
