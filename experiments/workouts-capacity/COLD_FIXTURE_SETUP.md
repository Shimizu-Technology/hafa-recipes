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
unreadable source fallback still fails422. Text/PDF must be ready on a supported
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

Historical request traces show all88 liveness spans outside export build/page
windows (root independent review); the six slow replies form one batch near
1791647130.34–7130.79. Thus export causation is unproved. Export build p95 of
6.8 seconds independently violates the declared one-second write SLO, despite
its separate 120-second safety timeout. Both material gaps remain. The trace
uses start/end/failed; the earlier unmatched-begins calculation was invalid.
The corrected private receipt has one unmatched start after deliberate stop.

## Finite native ARM PDF diagnostic

The official Python3.12.15 slim-bookworm index is
sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258.
Its amd64 manifest remains2ed6491b; the ARM64v8 manifest is
sha256:739ba32ae445e8d58f3d90feb85f83bebc8346f8dd280fa1eb5848f4ff1ed163,
with Debian bookworm base manifesta1b86db52ce3daef089e45aabe36dfec4091f82464c25c1fdcf03de197cbe82a.
The prepared Dockerfile installs only the unchanged relevant parser graph:
pypdf6.20.0, cryptography46.0.3, cffi2.0.0 and pycparser2.23. This is not the full
API dependency graph and is not native Render parity.

The finite probe uses the unchanged production pdf_text.py with96 MiB address
space, ten seconds CPU and fifteen seconds wall per case. It checks one and30
pages plus rejected31-page/malformed fixtures. No diagnostic fallback removes
limits. It requires native aarch64 and Python3.12.15 before parsing, runs as
UID10001 with256 MiB/equal swap/0.5 CPU, network none, read-only root and a
read-only synthetic fixture mount. It uses no database, API server, provider
credentials or Docker socket. Root must inspect the exact image/context/argv
before executing the probe. ARM success would isolate the emulator conflict;
it would not validate the full x86 Render workload or close R04.

Source gate:36 tests passed in12.85 seconds; Ruff/diff passed. Native ARM probe,
new cold capacity traffic, longer/repeated/burst/non-JPEG/restart cases are
NOT_RUN. All earlier runtime resources were cleaned; root8088/8089/simulator
and shared services remain borrowed and untouched.
