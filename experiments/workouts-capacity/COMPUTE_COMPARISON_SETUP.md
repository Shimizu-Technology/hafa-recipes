# Explicit compute comparison

This is synthetic test infrastructure. It changes no Render service, billing,
production environment or application code. A comparison pass does not erase
the historical 512MiB failure or establish Render/Neon parity or full R04.

## Closed profiles

| Selection | API memory / equal swap | CPU | Pass peak | Stop current or peak |
| --- | --- | --- | --- | --- |
| `render-0.5c-512mb` | 512MiB | 0.5 | 410MiB | 460MiB |
| `render-1c-2g` | 2048MiB | 1 | 1640MiB | 1840MiB |

The larger profile preserves the original headroom proportions. These are
explicit synthetic budgets, not a relaxation of the old profile. No arbitrary
environment override or numeric budget argument is supported. Legacy entry
points retain their original default resource limits and receipt shape. Their
historical observer does not claim CPU verification; explicitly selected
comparison profiles verify actual Docker CPU quota as well as memory/equal swap.

Selection propagates through preparation, API creation, observer, receipts and
recovered cleanup. Observations carry a fixed profile vocabulary. Mixed phases
require a fresh same-profile baseline; receipts reject absent or mismatched
report/observer/baseline profile evidence. The API observer checks each actual
container before sampling or stopping it. CPU is verified from NanoCpus or a
matching quota/period, never inferred merely from command arguments.

## Offered load and boundaries

The mixed experiment retains all existing inputs, five heavy cycles, 150
protected reads per route, reader offsets, full exports/pages/cancellations,
actual overlap witnesses, content checks and source retirement assertions.
The legal matrix retains its exact images, cases, concurrency and retained API.
Each job creates its own baseline/fixture database; it cannot import a historical
baseline. Mixed recreates only its API between phases while preserving its DB.

Read/write p95 limits remain500/1000ms, protected relative p95/p99 limits remain
1.25/2, and nearest-rank statistics are unchanged. Export120/600-second intervals,
450-second observation, phase bounds,1900-second whole budget, single120-second
finalization budget and35-minute workflow maximum remain unchanged. Any OOM,
protected error, incomplete observation or ownership uncertainty fails. Fixed
profile fields appear in normal/partial/fallback comparison receipts; raw private
identifiers, environment values and bodies never become public receipt fields.

## Trigger and exact source

The `workouts-capacity-comparison.yml` retains manual dispatch with closed
scenario/profile choices and exact `github.sha` checkout. Manual dispatch still
requires registration on the default branch; do not merge an unaccepted stack
merely to register it.

A separate opt-in path uses only `pull_request` activity `labeled` on the exact
same-repository branch `codex/workouts-capacity-profiles`. The two fixed labels
`capacity-compare-1c-2g-mixed` and `capacity-compare-1c-2g-legal` select separate
jobs with literal `render-1c-2g` and mixed/legal arguments. Opening or updating a
PR does not run these jobs. Adding a label is an explicit execution step requiring
review of that exact head; changed heads require fresh review and remove/re-add.
No label is applied by this source change. Existing512 automatic PR checks remain
unchanged and their historical failures are not erased.

The job checks out `github.event.pull_request.head.sha` without stored
credentials. Before constructing a coordinator, the entry point reads at most
1MiB of event JSON and checks action, repository/base/head ownership, branch,
label, selected fixed scenario/profile and exact source SHA. Malformed nested
objects and unknown selections refuse. The existing preparation verifier then
independently binds actual checked-out HEAD to the same event head before any
build/resource creation. There is no `pull_request_target`, secret access, write
permission or PR-controlled shell argument. Event label text only participates
in comparisons, never command interpolation.

GitHub documents labelled PR events and explicit head checkout; unlike manual
dispatch, this offers an opt-in route for an unmerged mergeable PR. A merge
conflict blocks the normal PR workflow. Actual registration/event delivery remains
unverified until separately authorized execution; no hosted run is claimed.
See [GitHub event requirements](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

Work/ledger/receipt names are unique to each workflow run/attempt; artifact names
include scenario and profile. Retention remains one day and receipts stay at most
100KiB. The always-clean step uses the same selection and the durable ledger's
single finalization deadline. A mismatched cleanup profile refuses and reports
cleanup uncertainty rather than touching unknown resources. Exact reconciliation
then requires reviewing the retained ledger. No broad cleanup or pruning exists.

## Verification and execution status

Source control tests are separate from workload acceptance. No comparison
workload, Docker runtime, hosted execution, production upsize or paid resource
has been executed by this slice. Keep finite source-gate outcomes and setup
failures in the private evidence. Before runtime, commit the source, generate a
fresh filtered plan and verify exact
source/context/env hashes, selected budgets, immutable images and cleanup limits.
No earlier plan/receipt proves this changed source.

Local ARM can establish bounded kernel/functional behavior only; it cannot claim
native hosted x86 parity. Verify Docker VM allocation and available memory/disk
before any local run. A nominal2GiB API limit does not guarantee worst legal
decoding or sustained mixed latency will pass. Hosted runner headroom and actual
Render quota/binary/deployment bindings remain separate evidence.
