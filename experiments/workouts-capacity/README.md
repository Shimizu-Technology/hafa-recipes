# Isolated Workouts capacity experiment

This directory is an experiment harness, not deployed application code. Render
uses native Python, a single Uvicorn process and `api/requirements.txt`; the
experiment Dockerfile is not a production Dockerfile. The authorized pinned-image
and loopback socket preflight is recorded in [INVENTORY.md](INVENTORY.md). No
capacity resources remain running. The first authorized runtime smoke failed the
Workouts-off Recipes memory gate; see [SMOKE.md](SMOKE.md). Mixed traffic and bursts
were not run. R04 remains open; root must authorize further runtime execution.

The source ingress fix is separate commit `71d49d0`. It protects the 3 MiB import
body before auth/JSON using one nonblocking process permit and a 60-second total
deadline. Other Workouts endpoints retain their existing limits; Recipes routes
are unchanged. Future replicas multiply ingress permits.

## Prepare an inspectable plan

From the committed candidate checkout, using the installed Python environment:

```bash
PYTHONPATH=experiments/workouts-capacity python -m capacity.plan \
  --repository "$PWD" --output /tmp/hafa-capacity-unique-run \
  --run-id unique-run --cpus VERIFIED_RENDER_CPU --platform linux/amd64
```

Replace the CPU placeholder with the verified Render allocation. The program only
writes a filtered context, fixture-only environment and JSON argv plan. It never
executes Docker. It rejects tracked uncommitted changes and existing output
folders. Only `api/app`, migrations, pinned requirements and the harness package
enter the context. The copier selects Git-tracked candidate files only, excludes
all untracked runtime files, and refuses tracked dotenv files or symlinks before
copying. `.git`, `.env`, dependency caches and private runtime files do not. Resolve/pin Python and PostgreSQL image digests before recording artifact
parity. Record Python/package/ffmpeg versions and the actual candidate commit.
The source label is declared after dependency installation so a new commit does
not change the dependency RUN environment and invalidate otherwise reusable layers.

After inspection, root executes the plan's argv steps individually, verifying
names are absent first and recording each returned exact container/network ID.
Use the current lifecycle session and claim each started resource immediately.
The network is internal. PostgreSQL has an owned test database in temporary
storage; API/load/fixture processes share its network namespace but use separate
memory cgroups. The API reaches PostgreSQL through `127.0.0.1:5432`, satisfying
existing local-only SSL safety. Nothing is published to host or public ports.
Do not reconnect or mutate a borrowed PostgreSQL container. Temporary fixture,
seed and load containers also need lifecycle tracking until they finish.

The API is constrained to 512 MiB with no extra swap and the chosen CPU budget.
The generator and PostgreSQL are outside that API budget. The planner makes only its synthetic fixture/result directories writable by
image UID 10001, inside a private 0700 output folder; the fixture environment stays
0600. Do not apply broad filesystem permission changes.
`pg_isready` must pass before seed. Seed refuses an existing Recipes schema and
runs the actual core/optional migration runner through 044. It does not invoke
the Render grocery repair with production-specific expected counts.

## What stays real and what is simulated

Real: application startup and middleware, HTTP sockets, bounded receive/JSON,
base64/image validation, Pillow cover preparation and thumbnail normalization,
PDF parsing subprocess/limits, ffprobe/ffmpeg frame helpers, PostgreSQL models/
queries/locks, durable workers, version/replay behavior, export projection,
serialization and AES-GCM encryption. The filtered image installs pinned
`requirements.txt`, not the different `uv.lock` development environment.

Simulated: authenticated identity is a fixed whitelist of 24 synthetic stable
owners. Provider HTTP is intercepted only at transport; normal application
payload construction/serialization and response validation still run. Workouts
providers override only their test-environment availability check and inject a
synthetic budget for throughput. This is not real financial admission/billing;
the separate real-PG budget/denial suites remain required. No real provider key,
Clerk credentials, proxy/cookies, AWS credentials or Sentry DSN is permitted.
Unknown provider endpoints/hosts fail closed; the internal network independently
prevents external egress.

Social acquisition returns local fixture metadata/files; real frame/probe/media
semaphore helpers remain. Source download/anti-bot behavior is not measured.
S3 receives actual prepared bytes through a fake client; no cloud object/network
latency is measured. Cover judging is synthetic and deliberately abstains, so
preserving the original photo is expected. No result proves recipe/workout AI
quality, actual external delivery, Health device behavior or native usability.

Fixtures contain deterministic 1/4/16 MP JPEGs, 1/30/31-page text PDFs, malformed
PDF, a near-3-MiB valid JSON body, video/audio, hashes and byte sizes. The seeded
Recipes stress dataset has 1,000 records with noncompressible synthetic notes;
its actual table bytes are recorded rather than assuming it matches the observed
20.3 MiB production distribution. Two separate owners hold a roughly 60 MiB
valid export and a page-projection rejection fixture. Ordinary coach users do
not hold those oversized context fixtures. All test inputs are synthetic.

## Execute and record each phase

Run three repetitions on the same artifact/CPU configuration. Create a fresh API
container per phase so `memory.peak` starts from a known lifetime. Do not reset
real data or any borrowed database. Use distinct result filenames per phase.

1. **Workouts-off baseline:** the plan starts the real candidate with the master
   off. Warm it, run `recipes-baseline` for five minutes, then drain ten minutes.
   The eight independent readers produce approximately two cheap requests/second;
   an independent heavy loop performs Recipes text/OCR/video/chat every minute.
   Record completed video/cover outcomes, not only submission responses.
2. **Mixed load:** recreate only the owned API container with master on; keep its
   owned synthetic database. Run `mixed` for fifteen minutes. HTTP preparation
   confirms enrollment/profile/AI disclosure; measurement excludes that setup.
   Background readers continue while heavy work submits image/PDF/text imports,
   logs completed activity and explicit synthetic session actuals, replays the
   session UUID, chats and builds/reads/removes the large private export.
3. **Ingress boundaries:** run `upload-boundaries --concurrency 4`, then 8 and 16.
   Test near-cap, chunked, unauthenticated and oversized requests. Busy 429 is
   expected; an admitted request must still reach a persisted valid outcome.
   The separate opt-in Uvicorn socket test verifies unread Expect: 100-continue
   and disconnect recovery. Do not call ASGI tests physical network acceptance.
4. **Export backpressure:** run `export-backpressure`. Its raw socket has a small
   receive window and leaves the page unread. A competing request must get 429;
   after the actual 30-second response deadline, a fresh GET must succeed. If
   the page already drained, the harness fails rather than claiming backpressure.
   It discards private partial bytes and removes the temporary snapshot.
5. **Restart/replay:** start an owned API with `CAPACITY_PROVIDER_DELAY=10` and run
   `restart-prepare`. It saves the original synthetic UUID/body after observing
   `processing`. Root immediately kills only that recorded API container ID and
   starts it again against the same DB/fixtures. Run `restart-check`; it waits
   through the actual 300-second lease (up to 360 seconds), expects the same job
   ID and one acceptance result on replay. Confirm one usage receipt in PG.
   Separately fault a Recipes extraction/cover and export build using observed
   persisted phases. Recipe leases are 600 seconds; cover expiration can retain
   the incumbent photo instead of completing enhancement. Never shorten those
   production clocks just to obtain a passing recovery result.
6. **Rollback/deployment:** use another owned image from the verified deployed
   Recipes commit, Workouts off, against this synthetic additive schema. Confirm
   `/`, `/up`, old-client library/import/chat contracts and retained Workouts data.
   No down migrations. This step is operator-owned and not automated by the new
   driver; it needs the current actual production source/runtime inventory.

Driver command interface (inside a separate load container from the plan):

```text
python -m capacity.driver --profile mixed --seconds 900 --output /results/mixed.json
python -m capacity.driver --profile upload-boundaries --concurrency 8
python -m capacity.driver --profile export-backpressure
python -m capacity.driver --profile restart-prepare
python -m capacity.driver --profile restart-check
```

Capture memory from a claimed host process using the exact owned API and
PostgreSQL IDs and the new plan's ownership labels:

```text
PYTHONPATH=experiments/workouts-capacity python -m capacity.host_monitor --ledger OWNED_RESOURCES_JSON --api-id FULL_API_ID --pg-id FULL_PG_ID --run-id RUN_ID --phase baseline --seconds 450 --output NEW_EXTERNAL_JSONL
```

The monitor writes numeric JSONL and an interruption-safe summary, never replacing
historical evidence. It validates full container IDs against the creation ledger,
owner/run/name labels, unpublished ports and the API's 512 MiB/no-extra-swap limit.
It executes only tiny `cat` probes inside the API; Python, Docker stats/top and
reporting run on the host. The `cat` overhead remains included. Docker stats'
cache-adjusted memory does not replace raw cgroup accounting. RSS sums may
double-count shared pages; `memory.peak` catches missed spikes.

The monitor stops only its revalidated owned API on 460 MiB/current-or-peak, any
OOM or three protected 5xx responses. Probe failure/cancellation preserves a
partial report and fails closed on a still-verifiable target. It collects numeric
CPU/PID/RSS and bounded aggregate queue counts/ages. Fixed source-stage markers
identify thumbnail normalization, cover comparison and cover/evidence frames;
existing methods retain their behavior. Request-category start/end/failure events
flush into the separate load container's results directory. They contain no
identities, raw URLs, source bodies or exception messages. Set `CAPACITY_PHASE`
explicitly when moving from baseline to mixed/boundaries so markers align.
The configured interval is a minimum delay, not a guaranteed sampling frequency;
each row includes probe start/end times. Also review saved outcomes, descriptor/
temporary-file growth and final drained memory. No observer result closes R04.

The old `capacity.metrics` Python-in-API sampler remains solely to explain the
failed historical run. Its included 25.61 MiB RSS must not be subtracted from the
470.17 MiB peak, and the 410/460 MiB gates remain unchanged. See
[HOST_MONITOR.md](HOST_MONITOR.md) for the source-only validation and next gate.

## Internal gates and remaining acceptance

Pass combined peak at most 410 MiB; stop workload/API at 460 MiB or any OOM event.
No unexpected 5xx/restart, duplicate results or ownership leaks. Protected reads
have p95 at most 500 ms; ordinary writes at most one second. Protected Recipes
p95 must also stay within 1.25x baseline and p99 within 2x. Stable backlog must
drain, and ten-minute idle memory must return within 10 MiB of the warm baseline.

`capacity.report` checks the recorded peak/status/latency gates. Missing Linux
samples/baseline routes are blocked, never zero. Its local pass cannot close R04:
three repetitions, queue/outcome/drain/restart/rollback review still apply. Apple
Silicon emulation cannot establish native Render CPU latency. Native Linux runtime
parity, live source/provider/Clerk/storage behavior, Neon latency/compute cost,
actual model quality, installed Recipes binary smoke and release approval remain
separate gates. A historical 397 MiB sample is not verified combined headroom.

At completion capture metrics before removing containers, stop/remove only exact
owned IDs, remove only the owned network ID and verify absence. Temporary PG data
belongs solely to this experiment; no Docker prune, routine volume/image removal,
shared-container shutdown or provider mutation. Retain the named worktree/results
for root review. The first authorized smoke and its stop are recorded in SMOKE.md.

## Implementation verification handoff

Twenty-two source tests pass: strict fake environment, filtered/no-secret context,
synthetic provider payload and blocked unexpected egress, deterministic real
PDF/image fixtures and caps, numeric cgroup stop data, content bounds, conservative
report gates, original driver account/generation headers and metadata-only output,
and actual wrapper import with socket connect/bind/listen/DNS operations forbidden.
The import test confirms no worker started and no synthetic provider attempt ran.
Ruff, Python compilation and CLI help checks pass. These use the development
Python environment; pinned image and finite version inventory passed separately.

| Case | Required evidence | Status |
| --- | --- | --- |
| IC01 | Busy/master-off bodies unread; final-send/error/cancellation/deadline recovery | 14 ASGI tests passed; actual persisted-import/usage bundle 69 passed |
| IC02 | Real socket Expect: 100-continue, disconnect, normal recovery | passed; final 15-test ingress suite with middleware composition |
| CP01 | Pinned image, exact source/dependency/binary/CPU/architecture inventory, real startup/migrations | image inventory and first real startup/migrations passed; emulation/provider limits remain |
| CP02 | Three baseline/mixed repetitions, cgroup peak/RSS/latency/queues and saved outcomes | first baseline failed memory stop; mixed/repetitions not_run |
| CP03 | Upload4/8/16, PDF/image rejection, export backpressure and timeout recovery | not_run |
| CP04 | Real lease restart, one result/receipt, Recipes cover/fallback and snapshot cleanup | not_run |
| CP05 | Compatible deployed Recipes image rollback plus retained additive data | not_run; operator-owned source inventory required |

Finite ingress/socket PostgreSQL tests used the borrowed local container. Their
dedicated databases were dropped and absence verified. Image pulls/builds, a finite
network-none inventory container and loopback socket fixture were authorized and
cleaned. The first capacity network/API/PostgreSQL/load smoke was authorized,
stopped on its memory gate and fully cleaned. No real provider or production
operation started. Root owns the next runtime authorization,
resource claims, exact experiment execution, further fixes and capacity acceptance.
