# Cold source and diagnostic setup; runtime not started

The previous mixed phase remains failed. This revision changes only experiment
code, fixtures, tests and plans. Production API modules, parser limits,
requirements and the 410/460 MiB, 500/1000 ms, 1.25× p95 and 2× p99 gates remain
unchanged. No optimization or capacity acceptance follows from this setup.

The workout image is now separately annotated with Push-up, four sets of six
to ten reps and 75 seconds rest. The PDF independently prescribes Reverse lunge,
two sets of ten reps per side and 60 seconds rest. The text source retains its
Squat prescription. None of these are exercise recommendations. Recipe covers
are not treated as workout source images. Provider fixtures read the actual
source part/image label from the real request; they do not assume image:1.

A real extraction/schema/grounding preflight verifies every expected fact. The
image must remain incomplete with only the mandatory visual review warning;
tests exercise the real import handler's explicit acknowledgment and private
save path with synthetic storage. Wrong-location facts are removed; an
unreadable source fallback still fails 422. Text/PDF must be ready on a supported
parser environment. The current amd64 emulator cannot satisfy the PDF check,
so the plan blocks Workouts load rather than bypassing or raising the limit.
These tests use synthetic provider results and do not establish vision quality.

Cold videos have distinct eleven-character canonical YouTube IDs in each
phase: capacityB00 for baseline, capacityM00 for mixed, with bounded indices.
Tests use the actual canonicalizer and show the identity changes while tracking
queries do not. Duplicate/reused job IDs now fail coverage. A completed job must
have a saved recipe link, and all saved links must be distinct. Numeric metadata
checkpoints before/after require actual frame/cover-stage completion deltas.
Source URLs, account IDs and private payloads are absent from those checkpoints.

Readers now stagger their first arrivals across the existing period. Eight
readers retain the original approximate two combined requests/second: four
calls/16 seconds in baseline and six/24 seconds in mixed. This changes arrival
shape, not acceptance thresholds; it does not prove the old synchronized burst
safe or establish a fixed protected Recipes rate under added Workouts traffic.
A separate stronger fixed-Recipes-rate scenario remains a future proposal.

Experiment-only wrappers mark real export build/read calls. A 250 ms coroutine
in the existing API records numeric loop delay; a GC callback records only pause
count/total/max. Pauses are emitted after collection, not from inside the GC
callback. There is no extra observer process inside the API. This instrumentation
has overhead, which remains included in the cgroup and latency measurements.
The external exact-ID host probe also reads cpu.stat, including usage and
throttling counters; missing CPU metadata fails observation. No heap, objects,
source content, credentials or command lines are collected.

Historical request traces show all 88 liveness spans outside export build/page
windows (root independent review); the six slow replies form one batch near
1791647130.34–7130.79. Thus export causation is unproved. Export build p95 of
6.8 seconds independently violates the declared one-second write SLO, despite
its separate 120-second safety timeout. Both material gaps remain. The trace
uses start/end/failed; the earlier unmatched-begins calculation was invalid.
The corrected private receipt has one unmatched start after deliberate stop.

## Finite native ARM PDF diagnostic

The official Python 3.12.15 slim-bookworm index is
sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258.
Its amd64 manifest remains 2ed6491b; the ARM64v8 manifest is
sha256:739ba32ae445e8d58f3d90feb85f83bebc8346f8dd280fa1eb5848f4ff1ed163,
with Debian bookworm base manifest a1b86db52ce3daef089e45aabe36dfec4091f82464c25c1fdcf03de197cbe82a.
The prepared Dockerfile installs only the unchanged relevant parser graph:
pypdf 6.20.0, cryptography 46.0.3, cffi 2.0.0 and pycparser 2.23. This is not the full
API dependency graph and is not native Render parity.

The finite probe uses the unchanged production pdf_text.py with 96 MiB address
space, ten seconds CPU and fifteen seconds wall per case. It checks one and 30
pages plus rejected 31-page/malformed fixtures. No diagnostic fallback removes
limits. It requires native aarch64 and Python 3.12.15 before parsing, runs as
UID 10001 with 256 MiB/equal swap/0.5 CPU, network none, read-only root and a
read-only synthetic fixture mount. It uses no database, API server, provider
credentials or Docker socket. Root must inspect the exact image/context/argv
before executing the probe. ARM success would isolate the emulator conflict;
it would not validate the full x86 Render workload or close R04.

Source gate: 36 tests passed in 12.85 seconds; Ruff/diff passed. Native ARM probe,
new cold capacity traffic, longer/repeated/burst/non-JPEG/restart cases are
NOT_RUN. All earlier runtime resources were cleaned; root 8088/8089/simulator
and shared services remain borrowed and untouched.

## Built artifacts and executed native diagnostic

Build source: `93b6ab0ebe64b3bd51d2d124906339db303f26d6`; later report-only
commits do not change these images.

- Capacity image: `sha256:265a0513baf773e5649eb561de686e8d88df25a4c322d77deeb7c0957754b15a` (amd64).
- Native parser diagnostic: `sha256:5c87e18b2a7dbf9e49c8de732676684451b9f17ea1406d0efeae86b5c6342fb0` (arm64).
- Capacity private plan: `/tmp/hafa-capacity-plan-93b6ab0-cold/plan.json`, SHA256 `9e961eb995eba9c10ba099d2ee3471dbe3e28e36994ff0acf234474a871d5895`.
- Capacity 203-file context manifest SHA256: `5bd5626efd5c728b5002b380b7e51a97af1c2a777a60d1e7d7230d5d942d426e`; fake environment SHA256 remains `ac3ada99436589a0d5123f56b5222a0b38538fc24edadcf9538cf85ee34c4291`.
- Native private plan: `/tmp/hafa-native-pdf-93b6ab0/plan.json`, SHA256 `27648c62c29d4970fde4a12f3b80ca4931298c23c5f60b152724093f6a603aae`.
- Native five-file context manifest SHA256: `6319c5b0d32248f88ab0d2c09a400ae500052e190f144da8cfa3780371d84675`.
- Unchanged production parser SHA256: `23a86339dd774f7c5c05298b8db3b77d61f6db819b94b9ac91c64a73233b1617`.

Root inspected the exact native plan/context/image and authorized only its
finite network-none execution. Four cases passed, exit 0/OOM false, in about
3.55 seconds overall. Native aarch64/Python 3.12.15/Debian 12 bookworm and the
four pinned parser versions were verified by the running diagnostic. One page
parsed in 0.799 seconds; 30 pages in 0.684. The 31-page and malformed fixtures
returned `pdf_unreadable_or_limit` in 0.674/0.718 seconds. The 96 MiB address-space,
ten-second CPU and fifteen-second wall limits were unchanged. No bypass was
used in this accepted diagnostic. It is not full API or Render parity.

Evidence: `/tmp/hafa-native-pdf-93b6ab0/receipt.json` and `probe.log`.
Exact container `a5b023aead0d84df043951016832f10513c714e45feb746ab81d003f90b190eb`
was removed and checked absent. Build processes ended; owner-scoped lifecycle
status is clean. Images, private synthetic host fixtures and receipts remain.
Root's API 8088/Metro 8089/simulator and shared services remain untouched. New
capacity traffic and workflow dispatch are NOT_RUN and remain unauthorized.

## Native x86 hosted-runner feasibility; source only

The existing `Shimizu-Technology/hafa-recipes` repository was verified public.
GitHub documents free standard hosted execution for public repositories and an
Ubuntu 24.04 x64 VM with 4 CPU/16 GiB/14 GiB. A full VM can provide native x86
Docker execution; `ubuntu-slim` is unsuitable for the required Docker/cgroup
operations. [Official runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

A reviewed manual experiment could use pinned actions, contents-read permission,
checkout without persisted credentials, no repository secrets/environments or
deployment hooks, and only generated synthetic fixtures. A strict tracked build
context would use the pinned Python amd64 manifest and requirements; the runner
must capture actual package/ffmpeg/kernel versions and image ID. Rebuilding there
would produce a new image, not establish identity with a local tag. The current
apt-installed ffmpeg footprint must be verified or pinned before parity claims.

Keep the same internal PG/database between baseline and mixed, API 512 MiB/equal
swap/0.5 CPU/no ports, fake-only authority URI and all existing stop/latency gates.
Verify host Docker architecture as well as container x86_64, avoiding QEMU.
Use a CI-owned exact resource ledger rather than inventing a Mac lifecycle hook;
targeted cleanup must run on failure/cancellation, with bounded job/phase timeouts.
About 35 minutes accommodates build plus baseline 300/host 450 and mixed 300/host 450;
only one inspected attempt should run, without automatic repetition.

The public artifact must contain only whitelisted numeric counts/statuses,
latencies, memory/CPU/GC/loop measurements, acceptance booleans and source/image
provenance. Exclude fixture files, images/PDFs, response bodies, raw logs, account
IDs, source URLs, tokens, exports and Docker archives. Keep artifacts tiny with
one-day retention; free public compute does not imply unlimited free artifact
storage. Runtime egress stays internal after image preparation, with no provider
or Neon credentials. Workflow permissions should be minimal. [Official secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)

This could avoid another Render instance and supply native x86 engineering
measurements. It still would not prove Render hardware/Neon/provider/network
parity, real AI quality or R04 closure. No workflow was created, edited or
dispatched in this preflight.
