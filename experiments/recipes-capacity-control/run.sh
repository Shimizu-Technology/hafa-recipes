#!/usr/bin/env bash
# One direct Docker comparison; no app deployment, provider calls, or retries.
set -Eeuo pipefail
: "${GITHUB_WORKSPACE:?}" "${CONTROL_WORK:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
[[ "$GITHUB_ACTIONS" == true && "$GITHUB_REPOSITORY" == Shimizu-Technology/hafa-recipes ]] || exit 1
[[ "$(uname -m)" == x86_64 && "$(uname -s)" == Linux ]] || exit 1
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || exit 1
cd "$GITHUB_WORKSPACE"
control="$GITHUB_WORKSPACE/workflow/experiments/recipes-capacity-control"
run="recipes-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
owner=native_health_preflight
mkdir -m 700 "$CONTROL_WORK"
work="$CONTROL_WORK"
api= pg= load= finite= monitor= network=
cleanup_deadline=0
cleanup_ok=true
limited() {
  local seconds="$1" remaining
  shift
  if ((cleanup_deadline>0)); then
    remaining=$((cleanup_deadline-SECONDS))
    ((remaining>0)) || return 1
    ((seconds<=remaining)) || seconds=$remaining
  fi
  timeout "${seconds}s" "$@"
}
owned_remove() {
  local id="$1" label
  [[ -z "$id" ]] && return 0
  label=$(limited 10 docker inspect --format '{{index .Config.Labels "hafa.capacity.run"}}/{{index .Config.Labels "hafa.capacity.owner"}}' "$id") || return 1
  [[ "$label" == "$run/$owner" ]] || return 1
  [[ "$cleanup_deadline" == 0 || "$SECONDS" -lt "$cleanup_deadline" ]] || return 1
  limited 10 docker stop --time 3 "$id" >/dev/null && limited 5 docker rm "$id" >/dev/null
}
cleanup() {
  local status=$?
  cleanup_deadline=$((SECONDS+120))
  trap - EXIT TERM INT
  if [[ -n "$monitor" ]]; then kill "$monitor" 2>/dev/null || true; wait "$monitor" 2>/dev/null || true; fi
  for id in "$load" "$api" "$finite" "$pg"; do owned_remove "$id" || cleanup_ok=false; done
  # Reconcile creation interrupted before its stdout ID was assigned.
  recovered=$(limited 10 docker ps -aq --no-trunc --filter "label=hafa.capacity.run=$run" --filter "label=hafa.capacity.owner=$owner") || cleanup_ok=false
  for id in ${recovered:-}; do owned_remove "$id" || cleanup_ok=false; done
  if [[ -n "$network" ]]; then
    [[ "$(limited 10 docker network inspect --format '{{index .Labels "hafa.capacity.run"}}' "$network")" == "$run" ]] && limited 10 docker network rm "$network" >/dev/null || cleanup_ok=false
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
image=$(timeout 10s docker image inspect --format '{{.Id}}' "$run")
[[ "$(timeout 10s docker image inspect --format '{{.Architecture}}' "$image")" == amd64 ]]
network="$run"
timeout 15s docker network create --internal --label "hafa.capacity.run=$run" "$network" >"$work/network-id.txt"
labels=(--label "hafa.capacity.run=$run" --label "hafa.capacity.owner=$owner")
finite=$(timeout 15s docker run -d "${labels[@]}" --network none --env-file "$work/fixture.env" -v "$work/fixtures:/fixtures" -e PYTHONPATH=/harness:/api "$image" python -m capacity.fixtures /fixtures)
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
  pg=$(timeout 15s docker run -d --name "capacity-pg-$run" "${labels[@]}" --network "$network" --memory 512m --memory-swap 512m --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=512m -e POSTGRES_PASSWORD=capacity_local_only -e POSTGRES_DB=hafa_workouts_capacity_test postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551)
  for ((n=0;n<60;n++)); do timeout 5s docker exec "$pg" pg_isready -U postgres -d hafa_workouts_capacity_test >/dev/null 2>&1 && break; sleep 0.5; done
  timeout 5s docker exec "$pg" pg_isready -U postgres -d hafa_workouts_capacity_test >/dev/null
  common=("${labels[@]}" --network "container:$pg" --env-file "$work/fixture.env" -v "$GITHUB_WORKSPACE/$source-source/api:/api:ro" -v "$work/context/capacity:/adapter/capacity:ro" -v "$work/fixtures:/fixtures:ro" --workdir /tmp)
  finite=$(timeout 15s docker run -d "${common[@]}" "$image" python -m capacity.seed)
  [[ "$(timeout 180s docker wait "$finite")" == 0 ]]; owned_remove "$finite"; finite=
  start=$SECONDS
  api=$(timeout 10s docker run -d --name "capacity-api-$run" "${common[@]}" --memory 512m --memory-swap 512m --cpus 0.5 "$image" python -m uvicorn capacity.app:app --host 0.0.0.0 --port 18047)
  [[ "$(timeout 10s docker inspect --format '{{.HostConfig.Memory}}/{{.HostConfig.MemorySwap}}/{{.HostConfig.NanoCpus}}' "$api")" == 536870912/536870912/500000000 ]]
  finite=$(timeout 5s docker run -d "${common[@]}" "$image" python -c 'import json,time,urllib.request
for attempt in range(20):
 try:
  assert json.load(urllib.request.urlopen("http://127.0.0.1:18047/up",timeout=1))=={"status":"ok"};break
 except Exception:
  time.sleep(.2)
else:raise SystemExit(1)')
  [[ "$(timeout 10s docker wait "$finite")" == 0 ]]; owned_remove "$finite"; finite=
  # Admit the unchanged 450-second observer only with startup/cleanup headroom.
  [[ $((SECONDS-start)) -le 12 ]] || exit 1
  python3 - "$result/ledger.json" "$api" "$pg" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'owner':'native_health_preflight','containers':{'api':sys.argv[2],'pg':sys.argv[3]},'cleaned':False}))
PY
  PYTHONPATH="$work/context" python3 -m capacity.host_monitor --ledger "$result/ledger.json" --api-id "$api" --pg-id "$pg" --run-id "$run" --phase baseline --output "$result/memory.jsonl" --seconds 450 --interval 0.5 >"$result/monitor.log" 2>&1 &
  monitor=$!
  load=$(timeout 10s docker run -d "${common[@]}" -v "$result:/results" "$image" python -m capacity.driver --profile recipes-baseline --seconds 300 --fixtures /fixtures --output /results/latency.json)
  [[ "$(timeout 320s docker wait "$load")" == 0 ]]
  # GNU timeout cannot wait on a shell child; exact PID is polled within phase bound.
  while kill -0 "$monitor" 2>/dev/null; do [[ $((SECONDS-start)) -lt 465 ]]; sleep 0.5; done
  monitor_status=0; wait "$monitor" || monitor_status=$?; monitor=
  python3 - "$result/memory.jsonl.summary.json" "$source" "$monitor_status" <<'PY'
import json,sys
from pathlib import Path
r=json.loads(Path(sys.argv[1]).read_text())
assert r['completed'] and not r['failure_code'] and not r['failure_type']
assert int(sys.argv[3])==0 or (sys.argv[2]=='main' and int(sys.argv[3])==2 and r['local_memory_gate']=='failed')
PY
  [[ "$(timeout 5s docker inspect --format '{{.State.Running}}/{{.State.OOMKilled}}' "$api")" == true/false ]] || exit 1
  timeout 5s docker exec "$api" cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events >"$result/final-cgroup.txt"
  PYTHONPATH="$work/context" python3 - "$result" <<'PY'
import json,sys,time
from pathlib import Path
from capacity.host_monitor import cgroup
p=Path(sys.argv[1]); sample=cgroup((p/'final-cgroup.txt').read_text())
sample.update(timestamp=time.time(),phase='baseline',stages=[],stop_required=max(sample['memory_current'],sample['memory_peak'])>=460*1024**2 or sample['oom']>0 or sample['oom_kill']>0)
with (p/'memory.jsonl').open('a') as f:f.write(json.dumps(sample)+'\n')
assert not sample['stop_required']
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
    assert all(not row.get('stop_required') and row.get('oom',0)==0 and row.get('oom_kill',0)==0 for row in samples)
    assert ends=={'evidence_frames':5,'thumbnail_normalize':5,'cover_compare':5},ends
    phases[name]={'memory':memory,'routes':latency['routes'],'counts':counts}
r={'passed':comparison['local_gate']=='passed','main':'823986f48e4eb5de3075969a742f834036b5d473','candidate':'8d4b175fc43a5e2d561b0e4c158718ac9c20500f','comparison':comparison,'phases':phases,'render_parity':False,'r04_closed':False,'real_provider_calls':0}
(w/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
raise SystemExit(0 if r['passed'] else 1)
PY
