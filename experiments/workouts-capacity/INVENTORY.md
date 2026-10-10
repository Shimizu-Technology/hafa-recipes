# Capacity image and socket preflight — 2026-10-10

This records the preflight checkpoint. The subsequent authorized runtime smoke
and failed baseline are recorded in [SMOKE.md](SMOKE.md).

The pinned image and loopback ingress preflight passed. No capacity API, workload,
network or PostgreSQL container has started. R04 remains open. Root must inspect
the plan and authorize the next runtime phase.

Tested source: `fdf0798d622271dbcec0e26bfd1dd47800bcb607`, branch
`codex/workouts-bulk-ingress-capacity`. It combines backend
`990cc56be64b510f50c589a70bddb79a749ac50a`, harness `f1b35d8`, tracked-context
protection `e3df50e` and dependency-cache correction `45ad0b0`. This report and
the README updates are subsequent documentation changes.

## Artifact identity

| Artifact | Verified identity |
| --- | --- |
| Final inventory image | `sha256:cbfd1a03036756e1ef47663978068dedafa5f8e265b78e209419b64596a5d461` |
| Local final tag | `hafa-capacity:fdf0798d6222` |
| Full pinned dependency image | `sha256:2c0780363f93ea1b1d370348f37d9700f7a17839f646874cad40c3e52f8e6e35` |
| Python 3.12 Bookworm amd64 manifest | `sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d` |
| Python multi-architecture index | `sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258` |
| PostgreSQL 16 Alpine amd64 manifest | `sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551` |
| PostgreSQL multi-architecture index | `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` |
| Requirements SHA-256 | `9002549c41b56eb84eda74b5e53875daf8899759ec183b532649a973343b5996` |
| Temporary source-refresh Dockerfile SHA-256 | `088aca6b02d30f48b0bce15055ed2f38bee3475cf7a5d3635619e49ba024f43c` |

The first image installed the actual pinned `api/requirements.txt` from the
official Python manifest. Its source was `7536dba`; it was inventory only because
that backend's response middleware needed correction. The final image reuses
those installed dependencies after `cmp` verifies unchanged requirements,
removes only its image application/migration/harness directories, and copies
the complete filtered final source. Its labels record the final source and the
original dependency image ID.

BuildKit interpreted an initial raw image-config ID in `FROM` as a registry name
and rejected it. The successful refresh used the exclusive local tag
`hafa-capacity-dependencies:2c0780363f93`, verified against the full original ID.
The ordinary committed Dockerfile remains available for a fresh standalone build
from the pinned official Python base.

A finite container used `--network none`, a read-only filesystem and filtered
context mount, no capabilities, 128 MiB and 0.5 CPU. It imported no application,
started no API or worker, and verified exact contents: application 133 files,
migrations 47 files, harness 10 files. All three trees matched the filtered
context; `pip check` returned `No broken requirements found.`

| Installed component | Version |
| --- | --- |
| Python | 3.12.15 |
| ffmpeg | 5.1.9-0+deb12u1 |
| FastAPI / Starlette | 0.122.0 / 0.50.0 |
| Pydantic / OpenAI | 2.12.5 / 2.8.1 |
| Pillow / pypdf | 12.3.0 / 6.20.0 |
| SQLAlchemy / asyncpg | 2.0.44 / 0.31.0 |
| Uvicorn / uvloop | 0.38.0 / 0.22.1 |
| httpx / boto3 | 0.28.1 / 1.43.72 |
| Sentry SDK / yt-dlp | 2.47.0 / 2026.8.19 |
| Pulled PostgreSQL base metadata | 16.15; no PostgreSQL container started |

Host and Docker daemon are ARM64; target image is Linux amd64. This is emulation,
not native Render latency evidence. Root verified a single Starter Python service
in Singapore and the documented 0.5 CPU/512 MiB plan. The experiment still differs
from native Render Python, Neon, provider/storage networks and production data.

## Inspectable local artifacts

- Plan: `/tmp/hafa-capacity-plan-fdf0798-native-health/plan.json`.
- Synthetic-only environment: the plan directory's `fixture.env` (0600).
- Filtered source: `/tmp/hafa-capacity-filtered-fdf0798-native-health` (192 tracked
  files plus the separately hashed temporary refresh Dockerfile).
- Source hash manifest: `/tmp/hafa-capacity-context-fdf0798.json`.
- Version/exact-source results: `/tmp/hafa-capacity-versions-fdf0798.json`.
- Build evidence: `/tmp/hafa-capacity-build-7536dba.log` and
  `/tmp/hafa-capacity-build-fdf0798.log`.
- Final socket evidence: `/tmp/hafa-workouts-socket-fdf0798.log`.

The plan is JSON argv, not an executable startup script. It references the full
final image ID and official PostgreSQL platform manifest. The parent directory is
0700, environment is 0600, and only the synthetic fixture/results writer folders
are 0777 for container UID 10001. No local environment or private runtime file
enters the context or mounts.

If root authorizes startup, the plan creates a new internal network and a new
PostgreSQL container with 1 GiB memory and temporary `/var/lib/postgresql/data`.
API/fixture/load containers share that container's network namespace; no host
ports are published. The API has 512 MiB, equal memory/swap limits, 0.5 CPU and a
read-only synthetic fixture mount. The generator alone writes fixtures; the load
container alone writes results. No root directory, Docker socket, repository,
credentials or borrowed database is mounted. Authentication is whitelisted
synthetic identity; provider transports and storage are mocked with fake keys.

## Executed checks and cleanup

Final source: 15 ingress tests passed in 1.52 seconds, including actual loopback
Uvicorn `Expect: 100-continue`, unread busy request, disconnect release and normal
subsequent request. Its fixture now uses the same pure ASGI request-context/body
limit/CORS composition as `main.py`. It does not prove full server startup,
production ingress or mixed-load behavior. Ten harness source tests passed in
3.91 seconds; Ruff and diff checks passed.

The owned logical database `hafa_workouts_socket_test` was created only on the
borrowed container `8c9955f44af2`, then dropped; absence count was zero. That
PostgreSQL container remains unchanged and running. All build/test process claims
were released. The finite inventory container
`8d3f8ff7ede56817de0b6b659691cb6bf807629bade8b9a01bf9dd9af09cd569` exited zero
before the immediate lifecycle claim could register it; the helper rejected the
not-running container. Its exact ID was removed and absence verified. An earlier
official PostgreSQL pull process was also refused by the profile's `postgres`
process-name protection; it finished and its exact PID was verified absent.

Owner-scoped lifecycle cleanup and status show no active
`native_health_preflight` resources. Root's borrowed resources remain available.
Images, private temporary evidence and the clean worktree are retained for root
inspection. No workload peak, route latency, queue/restart, rollback, provider
quality, cost or production headroom conclusion follows from this preflight.
