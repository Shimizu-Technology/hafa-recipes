# One pinned Recipes control on hosted x86

This diagnostic compares main `823986f48e4eb5de3075969a742f834036b5d473`
with the held JPEG/thread candidate `8d4b175fc43a5e2d561b0e4c158718ac9c20500f`.
It addresses inconsistent local tail-latency comparisons before any shared-API
rollout. It changes no application code, Render resources, credentials, or flags.
The independently writable branch starts at reviewed capacity-profile source
`6b5f80a2e3bf6157b114e81b6e9e223dc8013b18`.

The workflow runs only when `recipes-capacity-control` is added to the same-repo
PR on `codex/recipes-hosted-control`. Review the exact PR head before applying the
label. The candidate commit must be pushed separately before execution. There
is no dispatch, automatic retry, or default-branch registration requirement.
Removing/readding the label is another execution and requires a new decision.

Both application checkouts and the existing harness checkout are exact commits.
The harness is `405d89446b536f8ca0009739a07d45101ee095de`; its driver/report,
fixtures, provider mocks, and observation rules remain byte-identical to the
local control. The previously reviewed three-file patch removes optional
Workouts setup from app/seed/observer. SHA256 checks cover every retained adapter
module and the synthetic fixture bytes. Fuzzed patches are refused.

The direct script builds one native x86 image with the existing pinned Python
base, API requirements and FFmpeg version. Its unchanged seed helper imports
`pypdf==6.20.0`, absent from the Recipes dependency list. A harness-only
wheel-hash pin installs that one package with no dependency resolution; no
production lock or requirement changes. Main and candidate use that identical
image, adapter and read-only fixtures, with their own read-only application
source mounts. Each gets a fresh isolated core-schema database with 1,000 recipes;
no historical job/cache identity can leak between phases. An internal Docker
network, dummy credentials and existing provider transport exclude paid inference
and production data. Workouts flags and the AI budget stay off/zero.

Limits remain 512 MiB/equal swap and half a CPU, 410 MiB pass/460 MiB stop,
300 seconds of offered load, 450 seconds of external observation, 470 seconds
including phase cleanup, 1900 seconds for the script and a separate 120-second
cleanup budget. The job maximum is 35 minutes. Both phases run once; a main
410 MiB reserve failure is preserved as an existing control failure, while
460 MiB/OOM/incomplete observation stops execution. Candidate comparison uses
the unchanged 500 ms read p95 and 1.25/2 relative p95/p99 evaluator. It checks
five saved extracts, five covers, drained queues, three actual media stages per
cycle, schema 33 and absence of Workouts tables.

Only the numeric receipt is uploaded for one day. Partial outcomes and cleanup
failure remain explicit. Raw bodies, database contents, fixture payloads and
runtime logs are not uploaded. Containers are removed only after their exact
IDs/labels match; the internal network is removed only after its label matches.
No shared resource or image cache is pruned.

The first hosted run38159665938 failed the original fixture-byte preflight
before starting either workload. Its generic assertion did not identify which
regenerated file differed. That failure remains recorded; no expected hash was
replaced. The diagnostic now carries the ten original generated synthetic test
files in a hash-pinned archive. Extraction admits only those regular filenames
and checks every original size/SHA before either phase. These files contain
synthetic test patterns/text, not application binaries or user data. Both native
x86 phases therefore use the exact original media instead of relying on
cross-platform encoding to reproduce its bytes.

Local source/structure checks do not establish hosted acceptance. A passing
candidate comparison cannot turn a failed main memory control into a pass,
prove Render/Neon parity, approve enabled Workouts load, or close full R04.
Existing failed local and hosted receipts remain authoritative history.
