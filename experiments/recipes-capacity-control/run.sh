#!/usr/bin/env bash
# One direct Docker comparison; no app deployment, provider calls, or retries.
set -Eeuo pipefail
: "${GITHUB_WORKSPACE:?}" "${CONTROL_WORK:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
[[ "$GITHUB_ACTIONS" == true && "$GITHUB_REPOSITORY" == Shimizu-Technology/hafa-recipes ]]
[[ "$(uname -m)" == x86_64 && "$(uname -s)" == Linux ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
cd "$GITHUB_WORKSPACE"
control="$GITHUB_WORKSPACE/workflow/experiments/recipes-capacity-control"
run="recipes-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
owner=native_health_preflight
mkdir -m 700 "$CONTROL_WORK"
work="$CONTROL_WORK"
api= pg= load= finite= monitor= network=
cleanup_deadline=0
cleanup_ok=true
owned_remove() {
  local id="$1" label
  [[ -z "$id" ]] && return 0
  label=$(timeout 10s docker inspect --format '{{index .Config.Labels "hafa.capacity.run"}}/{{index .Config.Labels "hafa.capacity.owner"}}' "$id") || return 1
  [[ "$label" == "$run/$owner" ]] || return 1
  [[ "$cleanup_deadline" == 0 || "$SECONDS" -lt "$cleanup_deadline" ]] || return 1
  timeout 10s docker stop --time 3 "$id" >/dev/null && timeout 5s docker rm "$id" >/dev/null
}
cleanup() {
  local status=$?
  cleanup_deadline=$((SECONDS+120))
  trap - EXIT TERM INT
  if [[ -n "$monitor" ]]; then kill "$monitor" 2>/dev/null || true; wait "$monitor" 2>/dev/null || true; fi
  for id in "$load" "$api" "$finite" "$pg"; do owned_remove "$id" || cleanup_ok=false; done
  if [[ -n "$network" ]]; then
    [[ "$(timeout 10s docker network inspect --format '{{index .Labels "hafa.capacity.run"}}' "$network")" == "$run" ]] && timeout 10s docker network rm "$network" >/dev/null || cleanup_ok=false
  fi
  python3 - "$work" "$cleanup_ok" "$status" <<'PY'
import json,sys
from pathlib import Path
w=Path(sys.argv[1]); p=w/'receipt.json'
r=json.loads(p.read_text()) if p.exists() else {'passed':False,'failure':'incomplete_run'}
r.setdefault('phases',{})
for name in ['main','candidate']:
    phase={}
    for file,key in [('latency.json','latency'),('memory.jsonl.summary.json','memory'),('counts.json','counts')]:
        f=w/name/file
        if f.exists():
            value=json.loads(f.read_text())
            phase[key]=({'completed':value.get('completed'),'routes':value.get('routes',{}),'protected_acceptance':value.get('protected_acceptance')} if key=='latency' else value)
    if phase:r['phases'].setdefault(name,phase)
r['cleaned_owned_resources']=sys.argv[2]=='true';r['exit_code']=int(sys.argv[3])
r['passed']=r.get('passed',False) and r['cleaned_owned_resources'] and r['exit_code']==0
p.write_text(json.dumps(r,indent=2)+'\n')
PY
  [[ "$cleanup_ok" == true ]] || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Check both exact sources and the unmodified dependency graph before builds.
[[ "$(git -C main-source rev-parse HEAD)" == 823986f48e4eb5de3075969a742f834036b5d473 ]]
[[ "$(git -C candidate-source rev-parse HEAD)" == 8d4b175fc43a5e2d561b0e4c158718ac9c20500f ]]
[[ "$(git -C harness-source rev-parse HEAD)" == 405d89446b536f8ca0009739a07d45101ee095de ]]
cmp main-source/api/requirements.txt candidate-source/api/requirements.txt
mkdir "$work/context" "$work/fixtures"
cp -R candidate-source/api "$work/context/api"
cp -R harness-source/experiments/workouts-capacity/capacity "$work/context/capacity"
cp workflow/experiments/workouts-capacity/Dockerfile "$work/context/Dockerfile"
(cd "$work/context/capacity" && patch --fuzz=0 -p1 < "$control/recipes-only.patch")
python3 - "$control/adapter-sha256.json" "$work/context/capacity" <<'PY'
import hashlib,json,sys
from pathlib import Path
for name,digest in json.loads(Path(sys.argv[1]).read_text()).items():
    assert hashlib.sha256((Path(sys.argv[2])/name).read_bytes()).hexdigest()==digest,name
PY
cp "$control/fixture.env" "$work/fixture.env"
chmod 600 "$work/fixture.env"
chmod 777 "$work/fixtures"
timeout 600s docker build --platform linux/amd64 --build-arg PYTHON_BASE=python@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d --build-arg SOURCE_COMMIT=8d4b175fc43a5e2d561b0e4c158718ac9c20500f -t "$run" "$work/context" >"$work/build.log" 2>&1
image=$(docker image inspect --format '{{.Id}}' "$run")
[[ "$(docker image inspect --format '{{.Architecture}}' "$image")" == amd64 ]]
network=$(docker network create --internal --label "hafa.capacity.run=$run" "$run")
labels=(--label "hafa.capacity.run=$run" --label "hafa.capacity.owner=$owner")
finite=$(docker run -d "${labels[@]}" --network none --env-file "$work/fixture.env" -v "$work/fixtures:/fixtures" -e PYTHONPATH=/harness:/api "$image" python -m capacity.fixtures /fixtures)
[[ "$(timeout 120s docker wait "$finite")" == 0 ]]
owned_remove "$finite"; finite=
python3 - "$control/fixture-sha256.json" "$work/fixtures" <<'PY'
import hashlib,json,sys
from pathlib import Path
manifest=json.loads(Path(sys.argv[1]).read_text())
for name,item in manifest.items():
    p=Path(sys.argv[2])/name;assert p.stat().st_size==item['bytes'];assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
PY
# Fresh identical database per source avoids old completed-job/cache contamination.
for source in main candidate; do
  mkdir "$work/$source"; chmod 777 "$work/$source"
  result="$work/$source"
  pg=$(docker run -d --name "capacity-pg-$run" "${labels[@]}" --network "$network" --memory 512m --memory-swap 512m --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=512m -e POSTGRES_PASSWORD=capacity_local_only -e POSTGRES_DB=hafa_workouts_capacity_test postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551)
  for ((n=0;n<60;n++)); do timeout 5s docker exec "$pg" pg_isready -U postgres -d hafa_workouts_capacity_test >/dev/null 2>&1 && break; sleep 0.5; done
  timeout 5s docker exec "$pg" pg_isready -U postgres -d hafa_workouts_capacity_test >/dev/null
  common=("${labels[@]}" --network "container:$pg" --env-file "$work/fixture.env" -v "$GITHUB_WORKSPACE/$source-source/api:/api:ro" -v "$work/context/capacity:/adapter/capacity:ro" -v "$work/fixtures:/fixtures:ro" --workdir /tmp)
  finite=$(docker run -d "${common[@]}" "$image" python -m capacity.seed)
  [[ "$(timeout 180s docker wait "$finite")" == 0 ]]; owned_remove "$finite"; finite=
  api=$(docker run -d --name "capacity-api-$run" "${common[@]}" --memory 512m --memory-swap 512m --cpus 0.5 "$image" python -m uvicorn capacity.app:app --host 0.0.0.0 --port 18047)
  [[ "$(docker inspect --format '{{.HostConfig.Memory}}/{{.HostConfig.MemorySwap}}/{{.HostConfig.NanoCpus}}' "$api")" == 536870912/536870912/500000000 ]]
  for ((n=0;n<60;n++)); do timeout 5s docker exec "$pg" wget -qO- http://127.0.0.1:18047/up >/dev/null 2>&1 && break; sleep 0.5; done
  timeout 5s docker exec "$pg" wget -qO- http://127.0.0.1:18047/up >/dev/null
  python3 - "$result/ledger.json" "$api" "$pg" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'owner':'native_health_preflight','containers':{'api':sys.argv[2],'pg':sys.argv[3]},'cleaned':False}))
PY
  start=$SECONDS
  PYTHONPATH="$work/context" python3 -m capacity.host_monitor --ledger "$result/ledger.json" --api-id "$api" --pg-id "$pg" --run-id "$run" --phase baseline --output "$result/memory.jsonl" --seconds 450 --interval 0.5 >"$result/monitor.log" 2>&1 &
  monitor=$!
  load=$(docker run -d "${common[@]}" -v "$result:/results" "$image" python -m capacity.driver --profile recipes-baseline --seconds 300 --fixtures /fixtures --output /results/latency.json)
  [[ "$(timeout 320s docker wait "$load")" == 0 ]]
  # GNU timeout cannot wait on a shell child; exact PID is polled within phase bound.
  while kill -0 "$monitor" 2>/dev/null; do [[ $((SECONDS-start)) -lt 465 ]]; sleep 0.5; done
  wait "$monitor"; monitor=
  python3 - "$result/memory.jsonl.summary.json" <<'PY'
import json,sys
from pathlib import Path
r=json.loads(Path(sys.argv[1]).read_text())
assert r['completed'] and not r['failure_code'] and not r['failure_type']
PY
  timeout 5s docker exec "$pg" psql -U postgres -d hafa_workouts_capacity_test -At -c "SELECT json_build_object('schema',(SELECT max(version) FROM schema_migrations),'recipes',(SELECT count(*) FROM recipes),'extract',(SELECT count(*) FROM extraction_jobs WHERE job_kind='extract' AND status='completed'),'cover',(SELECT count(*) FROM extraction_jobs WHERE job_kind='cover' AND status='completed'),'active',(SELECT count(*) FROM extraction_jobs WHERE status IN ('queued','claimed','processing')),'workouts_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'workouts%'));" >"$result/counts.json"
  owned_remove "$load"; load=; owned_remove "$api"; api=; owned_remove "$pg"; pg=
  [[ $((SECONDS-start)) -le 470 ]]
done
PYTHONPATH="$work/context" python3 -m capacity.report --baseline "$work/main/latency.json" --mixed "$work/candidate/latency.json" --memory "$work/candidate/memory.jsonl" --output "$work/comparison.json"
python3 - "$work" <<'PY'
import collections,json,sys
from pathlib import Path
w=Path(sys.argv[1]); comparison=json.loads((w/'comparison.json').read_text()); phases={}
for name in ['main','candidate']:
    p=w/name; latency=json.loads((p/'latency.json').read_text()); memory=json.loads((p/'memory.jsonl.summary.json').read_text()); counts=json.loads((p/'counts.json').read_text())
    assert memory['completed'] and not memory['failure_code'] and not memory['failure_type']
    assert counts=={'schema':33,'recipes':1010,'extract':5,'cover':5,'active':0,'workouts_tables':0}
    assert latency['completed'] and latency['protected_acceptance']['passed']
    samples=[json.loads(line) for line in (p/'memory.jsonl').read_text().splitlines()]
    ends=collections.Counter(e['stage'] for row in samples for e in row['stages'] if e['event']=='end')
    assert ends=={'evidence_frames':5,'thumbnail_normalize':5,'cover_compare':5},ends
    phases[name]={'memory':memory,'routes':latency['routes'],'counts':counts}
r={'passed':comparison['local_gate']=='passed','main':'823986f48e4eb5de3075969a742f834036b5d473','candidate':'8d4b175fc43a5e2d561b0e4c158718ac9c20500f','comparison':comparison,'phases':phases,'render_parity':False,'r04_closed':False,'real_provider_calls':0}
(w/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
raise SystemExit(0 if r['passed'] else 1)
PY
