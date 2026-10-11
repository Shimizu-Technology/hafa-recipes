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

The new `workouts-capacity-comparison.yml` is **manual-only**. Its closed scenario
and profile choices are passed as quoted environment-backed CLI arguments. It
checks out `github.sha` without stored credentials. The coordinator additionally
requires the trusted repository, workflow_dispatch event and native Linux x86;
the existing context verifier binds the exact checkout to GITHUB_SHA. Existing
PR workflows do not automatically run the larger profile.

GitHub requires a workflow_dispatch workflow to exist on the default branch
before it can receive dispatch. Therefore this new file is not assumed runnable
on the unmerged stack. Do not merge main merely to register an experiment. Until
normal ready-PR integration registers it, hosted dispatch is blocked; a separately
reviewed explicit opt-in trigger would require its own source/authorization review.
See [GitHub manual workflow requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

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
