# Cached cover reuse and durable fallback

Status: source prepared for review; no new hosted run, Docker traffic or provider
call is authorized. Runs 38075747590 and 38077189290 remain failed. The second
run's partial 239.9–242.5 MiB peaks and successful recorded HTTP responses do not
establish an accepted baseline, drain outcome or headroom.

The retained second-run timeline has five extraction-frame, thumbnail and cover
comparison cycles, with no separate cover-frame extraction. The original harness
required both frame stages. The actual worker can reuse extraction candidates:
`CoverJobWorker._enhance` consumes its bounded transient cache, and calls
`extract_cover_frames` only when it lacks a non-platform candidate. That source
condition suggests a coverage mismatch; the old receipt cannot prove which
driver assertion failed. Its generic failure is preserved without reinterpretation.

There is no public cover-regeneration endpoint in this source. Manual creation
chooses a `manual://` source, and re-extraction would acquire candidates again.
Cover jobs are deliberately excluded from public extraction-job status routes.
The new scenario therefore uses a strictly test-only helper, never a claimed
product route or simulated public job result.

Each baseline or mixed phase retains the original five video extraction cycles,
five manual writes, text/OCR/chat calls and protected reader cadence. Exactly one
additional request to `/capacity/cover-fallback` creates one private synthetic
external-source recipe and invokes the real `enqueue_cover_job` with empty
transient candidates. It wakes the unchanged durable worker. This models cover
recovery after an absent process cache without clearing another job's cache or
forcing redundant decoding on the normal path. The fixed source identity uses
the phase's actual YouTube identity at index 99, distinct from indices 0–4 and
from the other phase. No extraction is added for this recipe.

The helper is mounted only by the experiment app when
`CAPACITY_COVER_SCENARIOS=true`; the existing strict fake environment is validated
first. It accepts only an enum phase matching the API process and the one fixed
synthetic owner. Extra fields, arbitrary URLs/IDs/content, foreign identities,
phase mismatches, concurrent requests and previously created records are refused.
A deterministic recipe ID plus the per-process lock prevents a duplicate fixture.
An interrupted uncommitted transaction rolls back and releases the lock. A job
committed before interrupted bookkeeping remains real queued work, never a claimed
completed outcome. Its handle stays private to the load driver.

Acceptance now distinguishes two real branches:

| Scenario | Observed jobs | Completed durable jobs | Distinct linked owned recipes |
| --- | ---: | ---: | ---: |
| Reused extraction candidates | 5 | 5 | 5 |
| Cache-absent fallback | 1 | 1 | 1 |

The cache observer records use only within the real worker's `_enhance` context;
cache eviction or cleanup cannot manufacture reuse. A numeric checkpoint reads
the actual persisted job status and matching owned recipe. Merely entering a
function or ending a wrapper does not count as successful completion. Real
extraction frames, cover fallback frames and cover comparison must all execute.
Expected database deltas per phase become 11 recipes, five extraction jobs/saves
and six cover jobs/saves. The five normal cycles remain intact; this is an explicit
additional fallback workload, not removal of an unobserved coverage gate.

The new fallback submission is also subject to the 1,000 ms write p95 gate.
All existing limits remain: 512 MiB/equal swap/0.5 CPU, 410 MiB pass/460 MiB stop,
OOM/protected status checks, 500 ms read p95, relative p95/p99 1.25×/2×,
300-second load/450-second observation, 1,900 seconds work and one durable
120-second finalization budget inside each 35-minute hosted job. Core mixed still
retains the exact baseline database; the separate legal job owns a fresh baseline.
Extra work must fit these bounds. No threshold waiver or automatic retry follows
a failure.

The driver writes a fixed failure-code enum and numeric saved-outcome/checkpoint
aggregates on failure. Public receipts filter every field again, exclude IDs,
URLs, bodies and raw error text, and preserve missing evidence as unavailable.
After stopping traffic, a bounded private database snapshot can establish saved
deltas and drain flags. If that read fails, flags remain null; they are not turned
into observed failures or successes. Missing or truncated driver reports also
leave their failure reason unknown rather than inferring one from the timeline.

Source regressions execute the unchanged real `_enhance` and `_finish` branches
with synthetic database/provider/storage boundaries. They also exercise the
guarded ASGI helper, real enqueue/cache behavior, cancellation/error recovery,
fixed failure projection and partial drain recovery. These are source contracts,
not native hosted memory, real database or provider acceptance. The coordinator
still imports on standard-library Python without installed HTTP/application SDKs.
The final source suite passed 140 tests in 13.39 seconds; Ruff and diff checks
passed. These checks ran without Docker, a database server or provider calls.

The native x86 workflow commands remain those in `CI_SETUP.md` and
`LEGAL_MATRIX_SETUP.md`. A new exact source/image/config/runtime graph must be
reviewed and verified before any traffic. PNG results cannot close legal WebP or
all-format memory safety. Longer/restart, physical Render/Neon/provider and full
R04 acceptance remain open.
