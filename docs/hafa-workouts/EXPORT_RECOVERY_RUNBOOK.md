# Private export slot recovery: rollout gate

Migration 045 must remain uninstalled in production, and private jobs must remain
OFF, until the trusted termination verifier, private operator recovery entry point,
alert delivery, and crash acceptance below are implemented and verified. This
runbook describes that required operating boundary; it does not supply a working
platform verifier, wire an alert, or authorize deployment or production recovery.

The singleton slot protects the shared API's memory budget as well as data
publication. After 120 seconds, a stale worker cannot write another page or publish,
but a suspended or unreachable worker can still retain private source memory.
Releasing its slot on a deadline, expired lease, grace period, missing heartbeat,
missing advisory lock, or a healthy replacement replica can permit overlapping
builders. Those observations are not termination evidence.

## Detect the held slot privately

Use the existing trusted database/operator environment, never a new public route.
A monitor should read only this bounded singleton projection and deliver an alert
to private operations when `termination_required` becomes true. It must not
include owner IDs, job/snapshot UUIDs, worker identity, source rows, exception
messages, credentials, or request bodies in its payload or logs.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '750ms';
SET LOCAL lock_timeout = '500ms';
SELECT
  active_job_id IS NOT NULL AS occupied,
  started_at IS NOT NULL AS source_started,
  active_job_id IS NOT NULL AND started_at IS NOT NULL
    AND deadline_at <= clock_timestamp() AS termination_required,
  CASE WHEN active_job_id IS NOT NULL AND deadline_at <= clock_timestamp()
    THEN floor(extract(epoch FROM clock_timestamp() - deadline_at))::bigint
    ELSE 0 END AS seconds_past_deadline
FROM workouts_export_job_slot
WHERE slot = 1;
ROLLBACK;
```

An absent schema, query error, or unreachable database means the monitor's status
is unknown. It must not report healthy or attempt release. Alert frequency and
routing must be bounded and verified before rollout. This Workouts condition
must not trigger a blanket restart of the shared Recipes API or hide its health.

## Obtain actual termination evidence

1. Keep the permit held and avoid accepting another source view. Cancellation and
   maintenance still fence publication and erase artifacts where the database is
   reachable. A different container or host cannot use a missing local PID as proof.
2. Inspect the original process identity through the trusted platform boundary.
   Same-Linux-boot/PID-namespace recovery already requires the exact recorded PID
   and start identity to be terminated or replaced. For another namespace/host,
   require platform evidence that the exact execution environment has ceased
   execution and cannot resume with retained memory. A deploy request, eviction
   request, unreachable host, lease timestamp, or new replica is insufficient.
3. A reviewed platform `OperatorDeathVerifier` adapter must validate that evidence
   against the retained slot identity. The current default verifier returns false
   for every assertion. Do not treat an operator's free-text claim as evidence.
4. Invoke the existing private `ExportJobCoordinator.recover_verified_death`
   boundary only through the audited operator helper once that adapter and helper
   have been implemented. Its transaction rechecks the current slot under lock;
   immutable recovery evidence and release occur together. Never bypass it with a
   handwritten recovery insert, slot update, trigger disable, or schema change.
5. Confirm the slot is idle and ciphertext is absent for a failed/expired job, then
   perform a fresh explicit UUID admission. A started handle must never resume or
   capture a second view. Preserve content-free audit evidence and incident times.

If termination cannot be proved, leave the slot held and report export admission
unavailable. Keep Recipes service available. Disabling the async route switch
alone does not release the slot: after 045, legacy snapshot exports share it too.

## Required acceptance before installation or enablement

Use isolated fixtures and the actual chosen platform verifier/operator boundary.
Prove release after exact process/container termination, including OOM and killed
replica cases, while a replacement runs in a different namespace. Prove refusal
for a live, suspended, partitioned, reused-PID, wrong-namespace, or unverified
worker. Test erasure after job cascade, stale operator evidence racing a new
admission, lost recovery ACK, alert delivery/recovery, and zero overlapping source
builders. Preserve immutable 120-second publication deadlines, 600-second artifact
expiry, fresh privacy and nonce fences, and default denial for unknown evidence.

The current backend tests cover same-namespace predicates with simulated OS
probes and preserve unknown-slot holds. They do not establish platform crash
recovery, alert delivery, or operator readiness. These remain explicit rollout
blockers even if application tests and source review pass.
