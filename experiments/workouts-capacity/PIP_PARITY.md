# Memory-fixed candidate and production-pip test derivative

Root authorized the exact `c9d23b1` pip regressions and corrected baseline.
Executed results are recorded below. All runtime resources were cleaned; a new
harness-only auth/fixture repair now requires root's image/plan inspection before
another baseline. Mixed traffic remains not authorized.

Candidate ancestry retains backend `990cc56`, monitor harness `772ecf4` and the
reviewed memory source `475dffbdb84b44d47ed7475f71eb200b59d66e31`, cherry-picked
with provenance as `5966df1`. Normal Render requirements stay unchanged. The
previous 470.17 MiB failure remains intact; no sampler subtraction or gate change.

## Deployment graph

Production pins are FastAPI 0.122.0, Starlette 0.50.0, OpenAI 2.8.1 and Pydantic
2.12.5. Local UV gates currently run newer packages and cannot substitute for
regressions on this graph. The capacity image inherits the verified installed
production requirements, replaces the full tracked application/migration/harness
source, and records the exact final source and immutable parent image.

`Dockerfile.parity` creates a separate test-only derivative. It installs the exact
six tools in `test-tools.txt` with `--no-deps` and production constraints: pytest
9.1.1, pytest-asyncio 1.4.0, pluggy 1.6.0, iniconfig 2.3.0, packaging 26.3 and
Pygments 2.20.0. These versions were read from the working local tool environment.
The build snapshots every existing distribution and verifies all remain unchanged
before/after installation, then runs `pip check`. The derivative is not the
512 MiB capacity candidate and must never be deployed to Render.

Only Git-tracked tests, pytest configuration and the two tooling files enter the
additional context. Dotenv files, symlinks, missing files and runtime caches are
rejected before copying. No local credentials or environment files enter either
image. The parity entrypoint checks the unchanged runtime graph again before
pytest, requires explicit test mode/fake key and its own loopback scratch database,
and rejects remote/shared database URLs, query overrides, credentials and proxies.
Non-loopback connects and external DNS are blocked in-process; the separate
internal Docker network also prevents egress.

## Concrete test scope and isolation

The entrypoint selects request-context, bulk-ingress, private export snapshots/
response guards/assembly, activity-log, mobile compatibility, thumbnail memory/
normalization, storage and cover-selection modules. Tests are actual tracked
backend tests. The optional socket ingress case remains skipped unless separately
approved; source ASGI fixtures are not physical-provider acceptance.

The prepared parity plan uses a new owned internal network and PostgreSQL 16
amd64 pinned manifest `1a66d744...`, tmpfs data, no published ports and database
`hafa_workouts_pip_parity_test`. It never connects to borrowed `8c9955f44af2`.
The test container shares only that owned PG namespace, mounts its explicit
synthetic environment read-only through `--env-file`, and writes numeric test
outcomes to its separate results directory. Its proposed 2 GiB memory budget is
for pytest/fixtures/subprocess tests only, not a Render/capacity upsize or memory
acceptance claim. The separate capacity plan retains 512 MiB/no extra swap/0.5 CPU.
All exact IDs must be claimed immediately and cleaned after the authorized phase.

The actual production-pip regression results are below. They establish only the
selected tests on that graph, not capacity, native/provider quality or R04 closure.

## Executed c9d23b1 receipts — 2026-10-11

Exact capacity image: `eb5e1a7443b84171a5cc65ae7a66da38797ccacd49cd0eda8002ae0929c4ba74`.
Test-only derivative: `96e13537cfb3f0aaf5ada9c39fd41bce2643a8ab1633330803be0ae97d39cc9a`.
The immutable requirements hash stayed
`9002549c41b56eb84eda74b5e53875daf8899759ec183b532649a973343b5996`.

The first production-pip run was **failed**: 364 passed, 2 failed, 1 skipped in
123.99 seconds. The synthetic test environment unnecessarily enabled Workouts
and supplied an export encryption key, polluting default-off/unconfigured cases.
That result and environment hash are retained. Removing only those two fields
and rerunning the same source/image/packages on a fresh owned PG namespace gave
**366 passed, 1 explicit socket skip** in 131.09 seconds. The package graph was
verified unchanged before pytest. Both parity phases were cleaned completely.

The corrected 300-second baseline then completed, with 218 host samples over the
450-second observer window: peak **309.73 MiB**, final current roughly 219.84 MiB,
zero OOM/5xx and all five extraction/cover pairs drained. Saved counts: 1,010
Recipes, 5 completed extraction jobs, 5 completed cover jobs, zero queued/processing
jobs, 30 synthetic AI provenance records. All original image/video fixture hashes
matched the earlier failed run exactly.

This baseline is **not accepted**: all 152 private-detail requests returned 404.
The synthetic wrapper overrode required auth but omitted optional auth used by
the private-detail route. Lists/search/manual/chat returned 200; chat had five
requests. Protected p95: liveness 98.84 ms, list 489.41 ms, search 234.82 ms,
manual write 40.94 ms, chat 424.29 ms. The 404 detail latency is not valid success
coverage. No mixed/burst/ten-minute-drain/native-Render acceptance follows.

The experiment-only repair now applies the same whitelist to optional auth,
returns guest for absent/invalid synthetic headers, and retains production owner/
foreign visibility rules. An actual mounted private-detail regression proves
owner access and guest/foreign refusal. That regression also exposed incomplete
seeded recipe JSON: it lacked required `sourceUrl`. The seed now matches the
manual-save shape and validates each record with the real `RecipeExtracted`
schema. All protected categories must exist and return 200; the driver now exits
with `AcceptanceFailure` and per-category counts if any fail. No production route,
request expectation, dependency or memory threshold changed. Twenty-nine source
tests passed; actual runtime retry of this repair awaits root inspection.

Private evidence roots: `/tmp/hafa-parity-plan-c9d23b1/results`,
`/tmp/hafa-parity-plan-c9d23b1-retry/results`, and
`/tmp/hafa-capacity-plan-c9d23b1-fixed/results`. All exact owned containers/networks
and host controllers were removed/released; borrowed root PG was untouched.

## Accepted bounded fd2ef919 baseline — 2026-10-11

After root inspected the harness repair and immutable image `131ff22e...`, the
authorized 300-second Recipes-off baseline and 450-second host observation both
completed. This one local baseline passes the agreed gates; it does not close R04.
Production bytes, package pins, environment, original image/video fixture hashes
and the 410/460 MiB limits were unchanged. Seed JSON now meets the actual schema.

Peak cgroup memory was **311.77 MiB** (326,914,048 bytes), final current **220.25
MiB**, across 223 external-host samples. No OOM, protected 5xx, unexpected request
or observation failure occurred. All required categories were exercised and all
returned 200: liveness/list/search/private detail each 152, manual writes 5 and
chat 5. Protected acceptance explicitly passed.

| Category | p95 milliseconds |
| --- | ---: |
| Liveness | 56.78 |
| Recipes list | 221.14 |
| Recipes search | 185.88 |
| Private detail | 96.07 |
| Manual write | 31.72 |
| Recipe chat | 359.74 |

All protected reads were below 500 ms and writes/chat below 1,000 ms. Saved
outcomes were 1,010 Recipes, 5 completed extraction jobs and 5 completed cover
jobs, each with a saved recipe link; queued/processing count was zero. Thirty
synthetic AI provenance records existed. The earlier memory/coverage/environment
failures remain separate retained evidence.

Results: `/tmp/hafa-capacity-plan-fd2ef91-auth/results/baseline-acceptance-summary.json`,
`baseline.json`, `baseline-external.jsonl` and its summary, request timing sidecar,
and `baseline-saved-counts.json`. The exact five owned containers/network and
host controllers were cleaned and absence verified. Shared/borrowed resources
were left available. No runtime handoff is outstanding.

Mixed traffic, bursts, legal non-JPEG concurrency, repeated runs, ten-minute idle
return, restart/rollback, actual provider quality and native Render/Neon parity
remain NOT_RUN. Root must inspect this baseline before authorizing further load;
no automatic upsize or general production headroom conclusion is supported.

## Memory-fix receipts and remaining image boundary

The memory agent's fresh macOS process comparisons used the same retained
288,911-byte 16 MP JPEG: eight StorageService preparations reduced additional
peak/retained memory from roughly 212 to 51 MiB; production-style cover preparation
reduced roughly 195 to 41 MiB while retaining one accepted candidate and crop
sizes. These are process increments, not cgroup or Render measurements.

The first corrected baseline keeps the original JPEG/video fixtures and protected
read/detail/chat traffic. Mixed load follows only after inspected authorization
and a baseline without material failure. The legal non-JPEG boundary remains
**NOT_RUN and a material activation limit**: valid PNG/GIF/palette/RGBA sources
can reach 40 MP/12k dimensions, with two thumbnail normalizer workers and FFmpeg
concurrency. A 16 MP JPEG run cannot prove that those inputs fit.

A later separately approved scenario must generate worst-accepted non-JPEG inputs
outside the API budget, retain existing byte/pixel caps, exercise one and then
concurrent accepted images alongside protected reads, and stop at the same
460 MiB/any-OOM gates. No automatic Render upsize or silent reduction of Recipes
input caps is permitted. If it fails, investigate weighted decoder admission or
bounded isolation while preserving accepted-input behavior; no such production
change is made by this harness preparation.
