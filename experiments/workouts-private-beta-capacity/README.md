# Restricted iPhone beta capacity check

This new check exercises exact private-beta API
`17b78a1c73681d481a4efcba4c17fd0ef5a01068`, first dormant on core schema 33 and
then enabled only for the 24 synthetic tester IDs through optional schema 44.
The seed command enables health only while applying migration036; serving health
stays off. Actual optional ledger34–44 is required before load and rollback.
An explicit seed parent flush guarantees the version FK before its child insert.
Public Workouts and health sync remain off. It changes no application source.

The labelled-PR workflow is isolated to `codex/workouts-private-beta-capacity`
and label `workouts-private-beta-capacity`; neither pushes nor manual dispatch
start it. Root must review the exact source before authorizing one execution.
The branch starts at diagnostic `cac19b6683a77b7d7b125dd2a089dadb1304ac84`.

Reuse: original `405d89446b536f8ca0009739a07d45101ee095de` driver/app/seed/monitor,
existing Recipes-only patch for dormant and rollback, archived ten synthetic
media files and their unchanged hashes, Dockerfile and pinned fixture wheel.
The enabled adapter retains the original FixtureBudget and fake 250 ms provider
transport; configured $5 authority metadata does not make this a financial
admission, billing or provider-quality test. The real authority's tests passed
in the separate 1,838-test source gate; no budget is raised or wiped here.

Private-only changes preserve Recipes reader cadence 16s in both phases, adding
Workouts requests without thinning Recipes. Both fresh reports use the existing
conservative nearest-rank implementation. The separate evaluator uses Leon's
approved 100 ms p95 cap for `/up`, Recipes list/search/detail, while retaining p99
at most 2× the fresh dormant baseline, write p95 ≤ 1000 ms, zero unexpected responses,
410 MiB memory reserve and460 MiB/OOM stop. Original evaluators and the prior failed
hosted receipts are unchanged; none is reclassified as passed.

Each phase offers 300s load with 450s external observation and 470s active phase
bound including startup and API stop. API is 512 MiB/equal swap/0.5 CPU. Its owned
Postgres uses 2 GiB/equal swap with a private disk bind outside the API cgroup;
there is no data tmpfs or anonymous volume. Script 1900s, one 120s cleanup budget,
and 35-minute workflow remain hard caps, including preparation and rollback.
The existing scheduler is retained; this does not claim full sustained R04 or
150s observation after the last client request.

Required persisted outcomes: five Recipe extracts/covers and their real media
stage witnesses, five accepted Workouts imports, coach records, sessions plus
idempotent replays, activity logs, and five ordinary exports with all 95 HTTP
pages/190 library + 190 history rows per snapshot. Snapshot/page cleanup must be
empty. The original large export notes, 16MP image and 30-page PDF remain intact.
Migration 045 and durable export jobs are absent.

After the enabled phase, old master
`823986f48e4eb5de3075969a742f834036b5d473` boots master-off on that same expanded
database. Existing urllib smoke checks liveness/platform/list/search/detail;
all Workouts table counts and per-row fingerprints must match before/after.
No reset or optional DDL occurs during rollback. Only bounded numeric outcomes
are uploaded for one day. On PostgreSQL initialization failure before seed, up to
64 KiB of its setup log is also retained. No application/SQL source bodies exist
at that stage; application logs, DB files and fixture contents are excluded.

Prepared source checks and unit plans are not hosted acceptance. Actual workload,
rollback, installed-client, Clerk/provider-network and production rollback
checks remain not run for this new check. A failure remains a release hold.

The previous source run38185521041 completed both workloads but failed the
100 ms read limit and the retained liveness p99 ratio. Its rollback startup
probe expired before read/fingerprint reconciliation; it remains failed.
The candidate now contains the reviewed Recipes card projection and bounded
export CPU work. No latency improvement is claimed before a new measurement.
The driver retires terminal polls and performs exactly one intentional
same-ID acceptance replay per import, instead of repeatedly accepting a
finished import. Both phases keep the original Recipes cadence, fixtures,
reader count, durations and workload outcomes. Fresh and rollback startup use
the same existing 12-second total deadline, with closed readiness metadata
retained even on failure. No acceptance threshold is raised.
