# External monitor: source readiness

The observer now runs on the host. No Python observer process is started inside
the API's 512 MiB cgroup. Tiny `cat` probes still consume brief in-cgroup resources;
that overhead stays included. The failed 470.17 MiB baseline and its included
Python sampler remain unchanged evidence in SMOKE.md.

Before probing, `capacity.host_monitor` requires two full 64-character Docker IDs
from the supplied uncleaned creation ledger, owner `native_health_preflight`,
matching owner/run/name labels, unpublished ports and the API's 512 MiB memory
and equal memory/swap limits. Every stop revalidates that exact API identity.
It never stops PostgreSQL, finds a target by port/name alone, or reads environment,
argv, provider responses or source data. The new planner adds the required labels.
Old unlabelled containers are rejected; generate a fresh plan for the fixed candidate.

The observer collects raw cgroup current/peak/OOM, exact `docker top` PID/PPID/RSS/
known process names and Docker numeric CPU/PID statistics. It deliberately omits
Docker's cache-adjusted memory from the gate. Process IDs come from the Docker
host VM; RSS may double-count shared pages. Aggregate owned-database rows contain
only whitelisted kinds/status/steps, counts and oldest ages, capped at 32 groups.
Unknown names/steps become `other`. No record/account/job identifiers are exported.

The 410 MiB pass and 460 MiB stop gates are unchanged. Current or retained peak
at 460 MiB, any OOM or three protected 5xx responses stop the exact owned API.
Memory is checked before slower auxiliary queries. Loss of trustworthy observation
also fails closed on a target whose identity still validates. Each row records
probe start/end times; Docker command latency means a nominal 0.5-second delay
does not guarantee a 0.5-second sampling interval. A summary survives interruption,
includes actual completion/failure, and cannot turn partial coverage into a pass.

Experiment-only wrappers emit fixed start/end/failure markers around the original
thumbnail, cover-comparison and frame methods. They preserve arguments/results/
cancellation, emit byte counts without decoding extra images, and run in the
existing API process. Their small logging overhead remains part of the run.
The separate load container flushes fixed request-category timing events, with
numeric request counters/status/duration/bytes and no raw URLs or error messages.
The repaired actual `items` Recipes envelope and partial-error reports remain.

Verification: 23 source tests passed, including actual bound production storage/
cover wrapper signatures without network/startup, the backend pagination schema,
cancelled/failed reporting, exact target selection, foreign-owner refusal,
current/peak/OOM stops before auxiliary probes, protected 5xx, malformed/nonfinite
metadata, marker redaction and historical-output preservation. Ruff passed.
Docker interaction is mocked in these monitor regressions; they do not prove a
physical monitor, fixed-candidate capacity or production behavior.

No baseline/mixed/API/network/PostgreSQL retry is authorized or running. Root will
provide the reviewed Pillow-memory candidate, inspect the new image/plan, and
authorize bounded runtime validation. Until then, the baseline failure remains
a rollout blocker and R04 remains open. A harness-only image may be built for
inventory, but its backend still contains the historical failing normalization.
