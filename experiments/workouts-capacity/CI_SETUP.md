# Native x86 CI capacity experiment: source prepared, execution held

This workflow is a bounded engineering experiment for the shared API. It cannot
close R04, establish Render/Neon/provider parity, prove real AI quality, or replace
the remaining legal non-JPEG/concurrent-decoder and longer/restart scenarios.
No production API code or limits are changed. The source remains unpushed until
root inspects the exact coordinator, workflow and reference.

The new separate workflow uses the existing public repository's full
ubuntu-24.04 VM. Checkout/upload actions are pinned; permissions are contents-read,
checkout does not retain credentials, fork PRs are skipped, and there is no
PR-target event, environment, secret, deployment, image publication or paid runner.
A manual dispatch cannot run while the new workflow is absent from the default
branch. After source inspection, a same-repository draft PR can provide its
pull_request event. The coordinator requires that event's exact head SHA, native
x86 host and Docker architecture before creating runtime resources.

It builds the filtered tracked context with the pinned Python amd64 manifest,
unchanged requirements SHA and ffmpeg 5.1.9 Debian package. The resulting image ID,
source label, architecture, Python version, every applicable pinned pip requirement
and selected runtime versions must match before traffic. A new build gets a new
image ID; a local image tag is not treated as a hosted artifact.

Runtime containers use an owned internal network and tmpfs PG. No ports are
published. The API has 512 MiB/equal swap/0.5 CPU; fixture generation, load and
metadata containers use separate cgroups. Only synthetic files and an explicit
fake environment enter containers. The budget authority URI equals the owned
loopback database URI. The provider transport/throughput budget mock is explicit;
real authority/denial testing and paid-provider quality remain separate gates.

A real source grounding preflight runs before load. The annotated image must
retain all expected facts plus its mandatory review warning, with intentional
private acceptance. Text/PDF facts must be ready; an unreadable source remains
rejected. The baseline runs 300 seconds with 450 seconds host observation. Only
if its status/latency/memory/drain/fresh-media checks pass does the coordinator
recreate ONLY the API for mixed, retaining the exact same PG/database. Phase IDs
change canonical video identities; distinct jobs, saved links and real frame
stage deltas are required. No reset or reseed occurs between phases.

Acceptance keeps 410 MiB pass/460 MiB stop, any OOM/protected 5xx/observation loss,
reads 500 ms/writes 1000 ms p95, relative p95≤1.25×/p99≤2×. Export build has no SLO
exemption; its 120-second safety timeout is different. The previous failed mixed
and passing limited baselines remain retained. Readers are staggered without
changing the original combined request rate; this does not prove the original
synchronized burst or a fixed protected-Recipes rate under added work safe.

The CI ledger records intent before creation and exact IDs before start. CID
files recover a lost create reply. Destructive operations recheck owner/run
labels; authoritative exact-ID absence lets interrupted removal resume. Unknown
ownership is left intact and acceptance fails. Processes use recorded start ticks
for the later cleanup step; command lines/environment are not collected. The
workflow has a 35-minute job bound; work has 1,900 seconds and one persisted,
nonresetting 120-second finalization budget. The always-clean step uses the same
ledger and never broad cleanup or retries. Unresolved cleanup fails the receipt.

The public artifact is one whitelisted JSON file, capped at 100 KiB with one-day
retention. It contains code/image/requirements hashes, versions, numeric request
counts/statuses/latencies, memory/CPU/throttling/GC/loop metrics, fresh/save/drain
counts and bounded diagnostic event offsets. Export events get reserved timeline
space; dropped/truncated counts prevent false overlap conclusions. Interrupted
load/report/observation tails produce an explicitly failed partial receipt.
Account/resource IDs, source URLs, raw logs, bodies, health records, fixture files,
exports, images/PDFs, OCI archives and private handoffs are excluded. Private logs
and resource ledgers are never uploaded.

An independent read-only reviewer found interrupted-removal recovery, truncated
phase evidence and resetting cleanup-deadline flaws. Those were fixed with
regressions. The source gates include the real schema/grounding/handler checks,
foreign-owner refusal, lost-create recovery, exact API recreation, old export/up
SLO failures, receipt filtering, interrupted evidence and finalization bounds.
The gate at source `89a2ed9` passed 49 tests in 10.44 seconds; the export-priority timeline regression and
focused CI suite passed 13 tests. Ruff/diff and workflow structure checks passed.
Actual hosted execution, end-to-end coordinator behavior and the additional
legal boundary matrix are NOT_RUN; passing source tests does not claim those
journeys passed.

No workflow was dispatched, no PR/push was made, and no new capacity traffic was
started. Owned resources are clean. Root's API 8088/Metro 8089/simulator, borrowed
PG and protected shared services remain untouched.

Future reports use one documented percentile definition: empirical nearest rank,
selecting sorted observation `ceil(N × q)` with one-based ranks. With five
observations `[100, 100, 100, 100, 6800]`, p95 and p99 are both 6,800 ms, so the
1,000 ms write gate fails. Complete reports and interrupted trace recovery call
the same helper. Both baseline and comparison reports must declare that method;
old or unknown definitions cannot enter a new passing comparison. Small samples
remain small samples; nearest rank does not imply statistical confidence.
Historical receipts retain their original values and estimator. They are not
rewritten or substituted for a fresh matching baseline. The numeric public
receipt declares `percentile_nearest_rank` for this future coordinator.

The subsequent review fixes passed 94 source tests in 20.98 seconds. They cover the
five-observation write outlier, separate relative read p95/p99 gates, matching
complete/partial estimates, and a late held `/up` reader across drain, load
deadline and cancellation. Runtime execution remains NOT_RUN.

The first hosted attempt failed during startup before any observation sample or
protected workload request. Its actual native x86 image/runtime provenance and
cleanup receipts are preserved in `HOSTED_FIRST_RUN.md`; zero samples provide no
memory acceptance. The harness now tests the actual public `/up` response
`{"status":"ok"}` rather than the admin diagnostic status. Future tiny receipts
include only whitelisted failure code/phase enums, preserving the first cause
without copying exception strings or identifiers. Another execution needs root's
inspection of the new source/setup; no automatic rerun is authorized.

Finalization now isolates deadline persistence, traffic stop, partial capture and
targeted cleanup. A Docker timeout, interruption or cancellation in one stage
cannot skip the remaining attempts. One persisted 120-second finalization budget
is retained; it is never restarted. If its initial save fails before a durable
deadline is known, the primary refuses timed Docker/process cleanup. Always-clean
can recover storage and establish the single budget without adding another budget
already spent by the primary. If the failed save actually committed, recovery
uses that earlier timestamp; a known preexisting deadline also remains unchanged.
The first safe failure remains visible, while unsuccessful cleanup sets its
separate flag false.
An unsuccessful always-clean invocation also writes a failed receipt rather than
leaving an older passing receipt as the final result.

Receipt serialization failure attempts a minimal failed receipt containing only
fixed diagnostics and the cleanup flag. If that write also fails, the coordinator
attempts to remove any stale receipt, prints fixed text and exits unsuccessfully;
it cannot guarantee writing evidence to an unavailable filesystem. The process
entry point suppresses raw tracebacks and private command arguments. These are
finite source regressions, not evidence of recovery from an actual hosted Docker
hang. The source suite passed 125 tests in 15.06 seconds; no rerun is authorized.
The subsequent two-process persistence regressions passed with the full suite:
127 tests in 14.06 seconds. They start with no deadline in the real ledger file,
then test both a failed uncommitted save and a committed write followed by error.

The PNG matrix also cannot establish all-format memory safety. Legal nonblank
40 MP WebP inputs within the 10 MiB cap remain a required NOT_RUN dimension:
their full decoder canvas and subsequent copies differ from PNG. Conditional
RGBA/LA premultiplication risks are not observed OOM results. R04 stays open.
