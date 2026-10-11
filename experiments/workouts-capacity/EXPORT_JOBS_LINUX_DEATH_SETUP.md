# Linux same-namespace death acceptance: source and execution plan

This is an isolated test-only helper. It supplies no production recovery route,
operator verifier, alert, or deployment authorization. Cross-namespace termination
remains unknown and default-denied. No Docker or hosted run is authorized merely
by committing this document.

## Source boundary

Base is PR145 `7b35c34b8ac135c687437ef9a6e92d334504fc8e`. Its application identity,
coordinator, worker and export builder match integration `7139ccf7` exactly.
Changes are confined to `experiments/workouts-capacity`: parent driver, fresh child,
exact-process control utilities, control-boundary tests and this plan.

The parent binds a Linux pidfd to its live direct child (non-reaping `waitid`
validation). All signals use that kernel handle, so a reused numeric PID cannot
receive them. Missing pidfd support or failed binding blocks the probe; there is
no numeric-PID cleanup fallback. The child constructs its identity after a fresh interpreter starts. It runs the
real `ExportJobWorker.tick()` and builtin `PrivateExportService` page source. A
test-only wrapper awaits the original `_write_page` commit, signals only a fixed
marker, then waits. The production source context, repeatable-read transaction,
projection, encryption, limits, execution fences and heartbeat remain active.
The child never cooperatively acknowledges source end on the success path.

## Proposed finite execution, pending source/plan review

1. Generate a fresh filtered tracked context and `build_jobs_plan` using a unique
   reviewed run ID. Verify the context inventory, API/migration/requirements hashes,
   fake-only environment, exact commit and selected image. Include the new tracked
   helper modules; an older image cannot execute this source.
2. Build the existing capacity Dockerfile from that context. Use its actual pip
   graph. Native Linux x86 is preferred for parity; local ARM Linux, if separately
   authorized, establishes only the kernel identity behavior for that architecture.
   Do not claim Render or hosted parity from an emulated/local test.
3. Create an exact owned internal Docker network and fresh tmpfs PostgreSQL15
   container/database, with no host-port publication. Reuse the plan's loopback
   fixture URI `hafa_workouts_capacity_test` only inside that new environment.
   Record intent before creation and exact IDs immediately afterward. Existing
   local/root/shared databases are never candidates.
   The local plan uses the official LinuxARM64 immutable PostgreSQL15 image
   `docker.io/library/postgres@sha256:7edb00ef081f792e6b08ff2990bb72de1b842581de7cfe516d63c9ce293b26ab`.
   Registry config digest is
   `sha256:f6a528436858e8356a8f9265e67eebf2067a3d8cccc90fc800f8d10fb21c7f35`;
   metadata declares OSlinux/architecturearm64/PG_MAJOR15/version15.19-1.pgdg13+2.
   The original x86 CI `capacity.plan.POSTGRES_BASE` stays unchanged.
   Before build/network/DB startup, pull only this immutable ARM image and verify
   its config ID, official source digest, OS, architecture and PostgreSQL version.
   After creation, verify the actual container image ID matches that config.
4. Execute the existing `capacity.seed` on the empty fixture. It installs actual
   core/optional migrations including045 and creates190 workouts+190 versions for
   capacity-22. The driver independently requires at least11 matched rows, actual
   schema verification and zero preexisting jobs/audits/artifacts. Do not reset
   tables or disable triggers to meet those checks.
5. Start one owned fixture container using the reviewed image and the plan's
   fixture environment. Both parent and child must run in THIS container, sharing
   boot/PID namespace; separate default-namespace containers are not equivalent.
   Set `CAPACITY_LINUX_DEATH=true`, `WORKOUTS_EXPORT_JOBS_ENABLED=true`,
   `JOB_WORKER_ENABLED=true`, `WORKOUTS_AI_ENABLED=false`,
   `WORKOUTS_IMPORTS_ENABLED=false`, `DELETION_CLEANUP_WORKER_ENABLED=false`,
   `CAPACITY_COVER_SCENARIOS=false`. No API server, provider, media or UI traffic.
   Run `python -m capacity.export_jobs_death_driver`; inner execution has a100-second
   deadline. Apply an outer finite container deadline with always-run exact cleanup.
6. Retain private source/build/seed/runtime/cleanup receipts. Public output is one
   bounded JSON object of fixed boolean labels, never owner/job/PID/source data.
   Failure prints only `linux_death_acceptance_failed`, exits2 and cannot count as
   passed. Do not rerun automatically after a failed assertion.

## Required assertions

- Exactly one real page commits while the unfinished child holds actual source.
  Match the DB worker identity to its owned PID and original `/proc` start, boot
  and namespace. Refuse a second admission; default operator assertion returns409.
- SIGSTOP the exact matching child. Observe its kernel stopped state and the
  natural DB lease expiry (15 seconds); no clock/lease/deadline rewrite. Maintenance
  fences the job and removes ciphertext but keeps the slot. No second claim or
  admission is accepted. The stopped process is still alive, so it is never death
  evidence. Original120/600-second intervals remain exact.
- SIGKILL that same validated child, wait/reap it, and verify its `/proc` identity
  is absent. Only then may the existing `maintain()` verifier release the slot.
  Require one immutable `same_namespace_dead` audit and no manufactured
  `actual_end` ACK for the killed job. The wrong-namespace predicate still refuses;
  this synthetic negative case is not actual cross-namespace recovery acceptance.
- Replay the original UUID: same terminal failed job, no cleanup pending and no
  restarted source. Admit a fresh UUID; complete its real multi-page export with
  actual-end ACK and exact workout/version totals. Remove its artifact using the
  real service. Verify idle slot, zero artifacts and retired worker references.

## Cleanup and remaining gates

`capacity.export_jobs_death_local` now prepares the filtered local ARM plan. Run
its `--prepare` mode with repository, fresh output directory, unique run ID and
the verified local Docker context, exact UNIX socket endpoint, daemon ID and name.
The actual reviewed machine uses the Colima `colima-aire-payroll-staging` context;
the private prepared plan pins its observed endpoint and daemon identity.
Preparation
starts nothing: it records the commit, every context file hash, API parity against
the explicit reference, requirements/env hashes and selected bounded commands.
Every Docker argv explicitly selects that pinned context. Each Docker/helper
operation rechecks context endpoint and daemon identity/ARM Linux architecture;
the helper inherits only the pinned Docker selection, with DOCKER_HOST cleared.
No global context switch occurs. TCP/SSH or altered socket/daemon identity aborts
before the operation. A default context change cannot redirect the commands.
Root must inspect `linux-death-plan.json` and its SHA256 before authorizing
`--execute --approved-plan-sha <reviewed hash> --session <lifecycle session>`.
Claim the external finite runner process before entering execute mode.

Execute mode requires the same clean source/context/environment and native ARM
host/daemon, installs the actual pip graph, seeds190+190 rows and starts no API
server. It uses the existing exact-label Ledger. Full64-character identities stay
in that ledger; ordinary helper claims/releases use the validated unique12-character
collector ID. Every short-lived container waits at a start gate until its claim
succeeds. Safety rejection or uncertain lifecycle completion aborts execution;
no override or automatic retry is supplied.

The runner bounds setup/runtime to1000 seconds, with a separate120-second exact
cleanup budget; build600, inventory60, PG readiness30, seed180 and driver130-second
stage maxima remain inside that whole budget. SIGTERM raises into its cleanup
finally. The driver retains its inner100-second bound. The external owner must
still perform exact ledger cleanup and reconcile lifecycle records after an
uncatchable runner kill or machine interruption; no program can promise cleanup
after those events. Images/build cache remain available and are not pruned.
The local-only database preflight adds a120-second pull stage inside the unchanged
whole budget. Existing app dependency layers remain cacheable; no no-cache rebuild
or fallback tag is supplied. The first6e execution built its ARM app image but
failed before DB startup because the generic x86 PostgreSQL digest was AMD64.
That failed receipt is preserved; seed, pin inventory and kernel cases were
NOT_RUN. Selecting a corrected immutable ARM DB image requires a fresh reviewed
plan and separately authorized execution, not an automatic retry.

The parent kills/reaps only its bound child, checking exact identity for scenario
signals, stops only its own worker and disposes its engine. If binding fails,
outer exact container cleanup must end the child. A helper failure may
leave a fixture slot occupied, which is preserved as failure evidence until the
entire owned disposable environment is removed. No slot-repair SQL is permitted.
The external runner must validate labels/IDs, stop/remove only its exact new
containers/network and retain lifecycle receipts. Do not delete shared volumes,
images or caches. No resource may be silently left running.

This covers one same-namespace SIGKILL and a natural expired lease while suspended.
OOM, killed replicas in different namespaces, partitioned/unreachable environments,
PID reuse against a real kernel, job cascade, lost recovery ACK, operator evidence
races, platform verifier, monitoring/alert delivery, Render/Neon parity and rollout
remain separate required acceptance. Local source tests do not establish this
Linux/DB acceptance. Full repository/application gates remain required before PR
readiness; this slice remains held pending those checks and runtime execution.
