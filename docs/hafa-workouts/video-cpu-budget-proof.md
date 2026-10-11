# Video frame CPU budget: source and proof plan

Håfa Recipes uses video frames for recipe evidence and cover selection. Those
flows must retain their source timestamps, scene selection, bounded image size,
and cancellation cleanup while Håfa Workouts shares the API's CPU budget.

This slice starts from held JPEG PR137, branch
`codex/recipes-thumbnail-memory`, commit
`7a46276caf393b2b632a5781ca46522d50d061f4`. The complete AST bodies of
`VideoService._write_frame` and `_write_scene_change_frames` match integration
commit `519a50c1965d5f47245f845e2b5f2aea55439c52`. It targets that held branch;
it does not authorize a production deployment.

The 2 GB legal-media comparison at `6b5f80a` completed all 11 cases, passed cleanup
and the absolute latency limits, and stayed below the 1640 MiB memory boundary.
All four relative p95 comparisons failed. CPU throttling was 31.526 seconds versus
about 6.9 seconds in its baseline. Those failed results remain required evidence;
this change has no measured performance result yet.

Both frame writers now pass one video-decoder thread before `-i`, one global
filter thread, and one video-encoder thread after `-i`. FFmpeg's input and
output codec options have distinct positional scopes. Its filter thread pool
defaults to the available CPU count. Explicit options bound those pools within
each child; they do not promise exactly one OS thread in the whole process.
See the [official FFmpeg options](https://ffmpeg.org/ffmpeg-all.html).

The 20-second single-frame timeout and 30-second scene timeout remain intact.
The two media permits, two image normalizer workers, scene threshold 0.35,
scene frame cap, absolute PTS offsets, 960-pixel scale, JPEG quality 3, isolated
process sessions and kill/wait cleanup remain intact. There is no API, provider,
database, image-normalizer, export-worker or capacity-harness change.

## Prepared source checks

`api/tests/test_video_cpu_budget.py` exercises the actual writers with bounded
subprocess seams. It checks decoder/output scope, seek rounding, scale/quality,
scene threshold/cap and absolute PTS mapping, missing output, nonzero exit,
original 20/30-second deadlines, timeout kill/wait and cancellation settlement
before a media permit returns. The proxy changes only this module's subprocess
and wait seams; the global event loop and timers remain real.

The focused gate includes these tests and existing video-frame evidence,
cover-frame sampling, cover selection, AI safety and thumbnail normalization/
memory tests. Exclude the existing real-FFmpeg test from a pure unit gate;
execute it in the separately authorized native phase. Source lint, AST parsing
and `git diff --check` precede these gates. The
complete repository gate and affected native flows remain readiness gates.
Prepared tests are not executed acceptance.

## Native before/after acceptance, not run

Use the already verified Linux x86 package graph with FFmpeg
`5.1.9-0+deb12u1` and record the executable version/image digest. The local macOS
FFmpeg 7.x executable cannot establish this parity. Parent authorization and an
exclusive lifecycle window are required before starting any image build,
container or native worker.

1. Generate task-owned synthetic H.264 clips without audio, URLs or user data.
   Use 720p and 1080p clips containing deterministic red/blue/green cuts at 2 and 4
   seconds, plus a moving pattern to expose seek or codec differences. Record
   each clip's bytes, SHA256, dimensions, frame rate and duration. Fixture
   generation uses explicit bounded threads in both comparisons.
2. Run the actual base and candidate writers against the identical fixture
   bytes and arguments. Save the actual argv, child PID/group, return code,
   elapsed time and terminal settlement. Exercise timestamps 0, 1.25, 2.001 and
   near the end, and scene starts 0 and 1.125 with caps 3 and 4. Use separate owned
   directories for each result. No warm-up, retries, traffic delays or changed
   output settings are part of the comparison.
3. Require identical frame counts, parsed absolute scene timestamps and JPEG
   decoded RGB pixels between base and candidate, plus dimensions within the
   original 960-pixel scale. Check cuts against fixture source timestamps so
   matching implementations cannot both silently lose or invent evidence.
   Record mismatches as failures; do not substitute a relaxed pixel tolerance.
4. Exercise cancellation on a longer owned synthetic moving-pattern clip.
   Capture the actual live child PID immediately after spawn and cancel the
   real writer task. Require that task settlement includes child/group death
   and wait, and that its media permit is returned only afterward. If the child
   already exited, that attempt does not prove live cancellation. Exercise
   both writer paths and retain timeout/nonzero unit coverage separately.
5. Use one actual `VideoService(max_concurrency=2)` for concurrent native
   operations. Observe child startup/settlement and verify a third queued
   operation cannot start until a permit is returned. Record observed native
   thread counts as evidence, without equating codec settings with total OS
   thread count. Stop only exact owned children/groups and containers.

Plan generation and synthetic-media preparation are individually bounded at
90 seconds when authorized; focused pytest is bounded at 180 seconds. The
proposed native proof has a separate hard 180-second total, preserves each
writer's original timeout, stops on first failure and has no automatic retry.
Reserve a single 60-second cleanup bound; ordinary claim acknowledgements have
their own 35-second bound. Root must approve the exact worker/container manifest
and these bounds before execution. Each worker and child is claimed immediately, physically
settled, released, and included in final closure. No resource is handed off by
this document.

Only after those source/native gates and review may the parent combine this
slice with the independently tested image-memory candidate and authorize a
fresh unchanged 2 GB comparison. Relative latency and missing protected-page
overlap remain gates. Faster page intervals can make overlap unproved; this
slice does not slow producers, change reader cadence or waive that proof.
