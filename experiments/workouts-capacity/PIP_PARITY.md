# Memory-fixed candidate and production-pip test derivative

Root authorized setup/build only. No new baseline, mixed traffic, API, network,
PostgreSQL or regression-test container has started. Root must inspect the final
candidate, images and command plan before runtime execution.

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

Runtime test outcomes are NOT_RUN until root approves the concrete images and
plan. Passing the source/setup tests alone does not establish production-pip
regression success, capacity, native behavior, provider quality or R04 closure.

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
