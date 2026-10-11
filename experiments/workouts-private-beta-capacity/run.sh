#!/usr/bin/env bash
# One direct Docker comparison; no app deployment, provider calls, or retries.
set -Eeuo pipefail
: "${GITHUB_WORKSPACE:?}" "${CONTROL_WORK:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
[[ "$GITHUB_ACTIONS" == true && "$GITHUB_REPOSITORY" == Shimizu-Technology/hafa-recipes ]] || exit 1
[[ "$(uname -m)" == x86_64 && "$(uname -s)" == Linux ]] || exit 1
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || exit 1
cd "$GITHUB_WORKSPACE"
control="$GITHUB_WORKSPACE/workflow/experiments/recipes-capacity-control"
beta="$GITHUB_WORKSPACE/workflow/experiments/workouts-private-beta-capacity"
run="beta-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
owner=native_health_preflight
mkdir -m 700 "$CONTROL_WORK"
work="$CONTROL_WORK"
api= pg= load= finite= monitor= network=
stage=source_preflight
failure_line=0
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
  trap - EXIT TERM INT ERR
  # Only pre-seed PG initialization logs: no app/SQL source bodies exist yet.
  if [[ -n "$pg" && "$stage" == postgres_setup_* ]]; then
    limited 5 docker logs "$pg" 2>&1 | head -c 65536 >"$work/pg-setup.log" || true
  fi
  # Retain role/state/error-class metadata, never environment or command dumps.
  for role in api pg load finite; do
    id="${!role}"
    [[ -z "$id" ]] && continue
    limited 5 docker inspect --format '{"running":{{.State.Running}},"oom":{{.State.OOMKilled}},"exit_code":{{.State.ExitCode}}}' "$id" >"$work/$role-state.json" 2>/dev/null || true
    if [[ "$role" == finite ]]; then
      limited 5 docker logs "$id" 2>&1 | python3 -c 'import json,re,sys; text=sys.stdin.read(1048576); classes=re.findall(r"^([A-Za-z][A-Za-z0-9_.]*(?:Error|Exception)):",text,re.M); print(json.dumps({"error_classes":sorted(set(classes))}))' >"$work/finite-errors.json" || true
    fi
  done
  if [[ -n "$monitor" ]]; then kill "$monitor" 2>/dev/null || true; wait "$monitor" 2>/dev/null || true; fi
  for id in "$load" "$api" "$finite" "$pg"; do owned_remove "$id" || cleanup_ok=false; done
  # Reconcile creation interrupted before its stdout ID was assigned.
  recovered=$(limited 10 docker ps -aq --no-trunc --filter "label=hafa.capacity.run=$run" --filter "label=hafa.capacity.owner=$owner") || cleanup_ok=false
  for id in ${recovered:-}; do owned_remove "$id" || cleanup_ok=false; done
  if remaining_owned=$(limited 5 docker ps -aq --filter "label=hafa.capacity.run=$run" --filter "label=hafa.capacity.owner=$owner"); then
    if [[ -z "$remaining_owned" ]]; then
      for data in "$work/off/pgdata" "$work/enabled/pgdata"; do
        if [[ -d "$data" && ! -L "$data" ]]; then limited 10 sudo rm -r -- "$data" || cleanup_ok=false; fi
      done
    fi
  else cleanup_ok=false; fi
  if [[ -n "$network" ]]; then
    [[ "$(limited 10 docker network inspect --format '{{index .Labels "hafa.capacity.run"}}' "$network")" == "$run" ]] && limited 10 docker network rm "$network" >/dev/null || cleanup_ok=false
  fi
  python3 - "$work" "$cleanup_ok" "$status" "$stage" "$failure_line" <<'PY'
import json,sys
from pathlib import Path
w=Path(sys.argv[1]); p=w/'receipt.json'
r=json.loads(p.read_text()) if p.exists() else {'passed':False,'failure':'incomplete_run'}
r.setdefault('phases',{})
for name in ['off','enabled']:
    phase={}
    for file,key in [('latency.json','latency'),('memory.jsonl.summary.json','memory'),('counts.json','counts'),('readiness.json','startup_readiness'),('counts-before.json','counts_before'),('workouts-counts.json','workouts_counts'),('schema-ledger-before.json','optional_schema_ledger')]:
        f=w/name/file
        if f.exists():
            value=json.loads(f.read_text())
            phase[key]=({'completed':value.get('completed'),'routes':value.get('routes',{}),'protected_acceptance':value.get('protected_acceptance')} if key=='latency' else value)
    if phase:r['phases'].setdefault(name,phase)
for name in ['comparison','rollback']:
    f=w/('rollback/rollback.json' if name=='rollback' else 'comparison.json')
    if f.exists():r[name]=json.loads(f.read_text())
r['cleaned_owned_resources']=sys.argv[2]=='true';r['exit_code']=int(sys.argv[3])
r['last_stage']=sys.argv[4];r['failure_line']=int(sys.argv[5])
r['setup_metadata']={f.stem:json.loads(f.read_text()) for name in ['api-state.json','pg-state.json','load-state.json','finite-state.json','finite-errors.json'] if (f:=w/name).exists() and f.stat().st_size}
r['passed']=r.get('passed',False) and r['cleaned_owned_resources'] and r['exit_code']==0
p.write_text(json.dumps(r,indent=2)+'\n')
PY
  [[ "$cleanup_ok" == true ]] || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'failure_line=$LINENO' ERR
trap 'exit 130' INT
trap 'exit 143' TERM
# Exact pre045 application for both load phases; old master only for rollback.
[[ "$(git -C candidate-source rev-parse HEAD)" == 253660117800ffd83494d91230beb199851ec427 ]]
[[ "$(git -C rollback-source rev-parse HEAD)" == 823986f48e4eb5de3075969a742f834036b5d473 ]]
[[ "$(git -C harness-source rev-parse HEAD)" == 405d89446b536f8ca0009739a07d45101ee095de ]]
[[ -z "$(find candidate-source/api/migrations -maxdepth 1 -name '045*' -print -quit)" ]]
python3 - <<'CHECK_PINS'
from pathlib import Path

def require_matching_requirements(baseline, candidate):
    def lines(content):
        return [line.strip() for line in content.splitlines()
                if line.strip() and not line.strip().startswith('#')]
    old, new = lines(baseline), lines(candidate)
    extra = 'pypdf==6.20.0'
    assert new.count(extra) == 1, 'expected_one_unconditional_pypdf_pin'
    new.remove(extra)
    assert new == old, 'dependency_lines_or_order_changed'

require_matching_requirements(
    Path('rollback-source/api/requirements.txt').read_text(),
    Path('candidate-source/api/requirements.txt').read_text(),
)
CHECK_PINS
mkdir "$work/context" "$work/fixtures" "$work/rollback"
chmod 777 "$work/rollback"
cp -R candidate-source/api "$work/context/api"
cp -R harness-source/experiments/workouts-capacity/capacity "$work/context/capacity"
cp "$control/Dockerfile" "$work/context/Dockerfile"
cp "$control/fixture.requirements.txt" "$work/context/fixture.requirements.txt"
cp "$GITHUB_WORKSPACE/workflow/experiments/workouts-capacity/capacity/statistics.py" "$work/context/capacity/statistics.py"
cp "$beta/private_report.py" "$work/context/capacity/private_beta_report.py"
cp "$beta/rollback_smoke.py" "$work/context/capacity/rollback_smoke.py"
(cd "$work/context/capacity" && patch --fuzz=0 -p1 < "$beta/private-beta.patch")
mkdir "$work/off-adapter"
cp -R "$work/context/capacity" "$work/off-adapter/capacity"
(cd "$work/off-adapter/capacity" && patch --fuzz=0 -p1 < "$control/recipes-only.patch")
(cd "$work/context/capacity" && patch --fuzz=0 -p1 < "$beta/enabled-seed.patch")
python3 - "$beta/adapter-sha256.json" "$work" <<'PY'
import hashlib,json,sys
from pathlib import Path
for name,digest in json.loads(Path(sys.argv[1]).read_text()).items():
    assert hashlib.sha256((Path(sys.argv[2])/name).read_bytes()).hexdigest()==digest,name
PY
cp "$control/fixture.env" "$work/off.env"
cp "$control/fixture.env" "$work/enabled.env"
python3 - "$work/enabled.env" <<'ENABLED'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
for key in ['WORKOUTS_API_ENABLED','WORKOUTS_IMPORTS_ENABLED','WORKOUTS_AI_ENABLED']:
    s=s.replace(key+'=false',key+'=true')
s=s.replace('WORKOUTS_AI_BUDGET_24H_MICROUSD=0','WORKOUTS_AI_BUDGET_24H_MICROUSD=5000000')
s=s.replace('CAPACITY_PHASE=baseline','CAPACITY_PHASE=mixed')
s+='WORKOUTS_TESTER_USER_IDS='+','.join(f'capacity-{i:02d}' for i in range(24))+'\n'
p.write_text(s)
ENABLED
chmod 600 "$work/off.env" "$work/enabled.env"
chmod 777 "$work/fixtures"
stage=image_build
timeout 600s docker build --platform linux/amd64 --build-arg PYTHON_BASE=python@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d --build-arg SOURCE_COMMIT=253660117800ffd83494d91230beb199851ec427 -t "$run" "$work/context" >"$work/build.log" 2>&1
image=$(timeout 10s docker image inspect --format '{{.Id}}' "$run")
[[ "$(timeout 10s docker image inspect --format '{{.Architecture}}' "$image")" == amd64 ]]
network="$run"
stage=network_setup
timeout 15s docker network create --internal --label "hafa.capacity.run=$run" "$network" >"$work/network-id.txt"
labels=(--label "hafa.capacity.run=$run" --label "hafa.capacity.owner=$owner")
stage=original_fixture_check
python3 - "$control/fixture-sha256.json" "$control/fixtures.tar.gz" "$work/fixtures" <<'PY'
import hashlib,json,sys,tarfile
from pathlib import Path
manifest=json.loads(Path(sys.argv[1]).read_text())
archive=Path(sys.argv[2]); target=Path(sys.argv[3])
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='36462237e1e4b585364ded88480640ea86eabba8b35738647954871f1c5c1e08','fixture_archive_hash'
# Only the ten original regular files are admitted; no path/link extraction.
with tarfile.open(archive,'r:gz') as packed:
    members=packed.getmembers()
    assert len(members)==len(manifest) and {m.name for m in members}==set(manifest),'fixture_archive_names'
    for member in members:
        assert member.isfile() and member.size==manifest[member.name]['bytes'],member.name
        payload=packed.extractfile(member)
        assert payload is not None,member.name
        with payload, (target/member.name).open('xb') as output:
            while chunk:=payload.read(65536):output.write(chunk)
for name,item in manifest.items():
    p=target/name
    assert p.stat().st_size==item['bytes'],f'fixture_size:{name}'
    assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],f'fixture_hash:{name}'
PY
# Fresh Recipes seed in each phase; enabled additionally runs optional034–044.
for source in off enabled; do
  mkdir "$work/$source"; chmod 777 "$work/$source"
  result="$work/$source"
  mkdir -m 700 "$result/pgdata"
  adapter="$work/context"; profile=mixed; phase=mixed
  if [[ "$source" == off ]]; then adapter="$work/off-adapter"; profile=recipes-baseline; phase=baseline; fi
  stage="postgres_setup_$source"
  pg=$(timeout 15s docker run -d --name "capacity-pg-$run" "${labels[@]}" --network "$network" --memory 2g --memory-swap 2g --mount "type=bind,source=$result/pgdata,target=/var/lib/postgresql/data" -e POSTGRES_PASSWORD=capacity_local_only -e POSTGRES_DB=hafa_workouts_capacity_test postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551)
  for ((n=0;n<60;n++)); do timeout 5s docker exec "$pg" pg_isready -h 127.0.0.1 -U postgres -d hafa_workouts_capacity_test >/dev/null 2>&1 && break; sleep 0.5; done
  timeout 5s docker exec "$pg" pg_isready -h 127.0.0.1 -U postgres -d hafa_workouts_capacity_test >/dev/null
  common=("${labels[@]}" --network "container:$pg" --env-file "$work/$source.env" -v "$GITHUB_WORKSPACE/candidate-source/api:/api:ro" -v "$adapter/capacity:/adapter/capacity:ro" -v "$work/fixtures:/fixtures:ro" --workdir /tmp)
  stage="seed_$source"
  seed_flags=()
  if [[ "$source" == enabled ]]; then seed_flags=(-e WORKOUTS_HEALTH_SYNC_ENABLED=true); fi
  finite=$(timeout 15s docker run -d "${common[@]}" "${seed_flags[@]}" "$image" python -m capacity.seed)
  [[ "$(timeout 180s docker wait "$finite")" == 0 ]]; owned_remove "$finite"; finite=
  timeout 5s docker exec "$pg" psql -U postgres -d hafa_workouts_capacity_test -At -c "SELECT json_build_object('schema',(SELECT max(version) FROM schema_migrations),'recipes',(SELECT count(*) FROM recipes),'jobs',(SELECT count(*) FROM extraction_jobs),'workouts_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'workouts%'));" >"$result/counts-before.json"
  if [[ "$source" == enabled ]]; then
    timeout 5s docker exec "$pg" psql -U postgres -d hafa_workouts_capacity_test -At -c "SELECT json_agg(version ORDER BY version) FROM workouts_schema_migrations;" >"$result/schema-ledger-before.json"
    python3 - "$result/schema-ledger-before.json" <<'LEDGER'
import json,sys
from pathlib import Path
assert json.loads(Path(sys.argv[1]).read_text())==list(range(34,45))
LEDGER
  fi
  start=$SECONDS
  startup_deadline=$(python3 -c 'import time; print(time.monotonic()+12)')
  stage="api_start_$source"
  api=$(timeout 10s docker run -d --name "capacity-api-$run" "${common[@]}" --memory 512m --memory-swap 512m --cpus 0.5 "$image" python -m uvicorn capacity.app:app --host 0.0.0.0 --port 18047)
  [[ "$(timeout 10s docker inspect --format '{{.HostConfig.Memory}}/{{.HostConfig.MemorySwap}}/{{.HostConfig.NanoCpus}}' "$api")" == 536870912/536870912/500000000 ]]
  stage="api_readiness_$source"
  finite=$(timeout 5s docker run -d "${common[@]}" -v "$result:/results" "$image" python -c 'import json,sys,time,urllib.request,urllib.error
from pathlib import Path

def readiness(deadline,clock,sleep,open_url):
    attempts=0
    error="DeadlineExceeded"
    while (remaining:=deadline-clock())>0:
        attempts+=1
        try:
            with open_url("http://127.0.0.1:18047/up",timeout=min(1,remaining)) as response:
                valid=json.load(response)=={"status":"ok"}
            if valid and clock()<=deadline:
                return {"ready":True,"expired":False,"attempts":attempts,"error_class":"None"}
            error="InvalidLiveness" if not valid else "DeadlineExceeded"
        except Exception as exc:
            reason=getattr(exc,"reason",exc)
            name=type(reason).__name__
            error=name if name in {"ConnectionRefusedError","TimeoutError","HTTPError","URLError","OSError","JSONDecodeError"} else "OtherError"
        remaining=deadline-clock()
        if remaining>0:sleep(min(.2,remaining))
    return {"ready":False,"expired":True,"attempts":attempts,"error_class":error}

value=readiness(float(sys.argv[1]),time.monotonic,time.sleep,urllib.request.urlopen)
Path("/results/readiness.json").write_text(json.dumps(value))
raise SystemExit(0 if value["ready"] else 1)' "$startup_deadline")
  [[ "$(timeout 10s docker wait "$finite")" == 0 ]]; owned_remove "$finite"; finite=
  # Admit the unchanged 450-second observer only with startup/cleanup headroom.
  stage="startup_budget_$source"
  [[ $((SECONDS-start)) -le 12 ]] || exit 1
  python3 - "$result/ledger.json" "$api" "$pg" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'owner':'native_health_preflight','containers':{'api':sys.argv[2],'pg':sys.argv[3]},'cleaned':False}))
PY
  PYTHONPATH="$adapter" python3 -m capacity.host_monitor --ledger "$result/ledger.json" --api-id "$api" --pg-id "$pg" --run-id "$run" --phase "$phase" --output "$result/memory.jsonl" --seconds 450 --interval 0.5 >"$result/monitor.log" 2>&1 &
  monitor=$!
  stage="workload_$source"
  load=$(timeout 10s docker run -d "${common[@]}" -v "$result:/results" "$image" python -m capacity.driver --profile "$profile" --seconds 300 --fixtures /fixtures --output /results/latency.json)
  [[ "$(timeout 320s docker wait "$load")" == 0 ]]
  # GNU timeout cannot wait on a shell child; exact PID is polled within phase bound.
  while kill -0 "$monitor" 2>/dev/null; do [[ $((SECONDS-start)) -lt 465 ]]; sleep 0.5; done
  monitor_status=0; wait "$monitor" || monitor_status=$?; monitor=
  stage="phase_result_$source"
  python3 - "$result/memory.jsonl.summary.json" "$source" "$monitor_status" <<'PY'
import json,sys
from pathlib import Path
r=json.loads(Path(sys.argv[1]).read_text())
assert r['completed'] and not r['failure_code'] and not r['failure_type']
assert int(sys.argv[3])==0 and r['local_memory_gate']=='passed'
PY
  [[ "$(timeout 5s docker inspect --format '{{.State.Running}}/{{.State.OOMKilled}}' "$api")" == true/false ]] || exit 1
  timeout 5s docker exec "$api" cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events >"$result/final-cgroup.txt"
  PYTHONPATH="$work/context" python3 - "$result" "$phase" <<'PY'
import json,sys,time
from pathlib import Path
from capacity.host_monitor import cgroup
p=Path(sys.argv[1]); sample=cgroup((p/'final-cgroup.txt').read_text())
sample.update(timestamp=time.time(),phase=sys.argv[2],stages=[],stop_required=max(sample['memory_current'],sample['memory_peak'])>=460*1024**2 or sample['oom']>0 or sample['oom_kill']>0)
with (p/'memory.jsonl').open('a') as f:f.write(json.dumps(sample)+'\n')
assert not sample['stop_required']
PY
  timeout 5s docker exec "$pg" psql -U postgres -d hafa_workouts_capacity_test -At -c "SELECT json_build_object('schema',(SELECT max(version) FROM schema_migrations),'recipes',(SELECT count(*) FROM recipes),'extract',(SELECT count(*) FROM extraction_jobs WHERE job_kind='extract' AND status='completed'),'cover',(SELECT count(*) FROM extraction_jobs WHERE job_kind='cover' AND status='completed'),'active',(SELECT count(*) FROM extraction_jobs WHERE status IN ('queued','claimed','processing')),'workouts_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'workouts%'));" >"$result/counts.json"
  owned_remove "$load"; load=; owned_remove "$api"; api=
  [[ $((SECONDS-start)) -le 470 ]]
  if [[ "$source" == enabled ]]; then
    stage=enabled_saved_outcomes
    timeout 10s docker exec "$pg" psql -U postgres -d hafa_workouts_capacity_test -At -c "SELECT json_build_object('optional_schema',(SELECT max(version) FROM workouts_schema_migrations),'imports',(SELECT count(*) FROM workouts_import_jobs),'accepted',(SELECT count(DISTINCT accepted_workout_id) FROM workouts_import_jobs WHERE accepted_workout_id IS NOT NULL),'active_imports',(SELECT count(*) FROM workouts_import_jobs WHERE status IN ('queued','processing')),'library',(SELECT count(*) FROM workouts_library),'versions',(SELECT count(*) FROM workouts_library_versions),'coach',(SELECT count(*) FROM workouts_coach_messages),'sessions',(SELECT count(*) FROM workouts_sessions),'activity',(SELECT count(*) FROM workouts_activity_log),'snapshots',(SELECT count(*) FROM workouts_export_snapshots),'pages',(SELECT count(*) FROM workouts_export_pages));" >"$result/workouts-counts.json"
    # Old code uses the exact enabled DB; no reset, optional DDL or re-seed.
    stage=rollback_before_fingerprint
    finite=$(timeout 10s docker run -d "${common[@]}" -v "$work/rollback:/results" "$image" python -m capacity.rollback_smoke fingerprint --output /results/workouts-before.json)
    [[ "$(timeout 30s docker wait "$finite")" == 0 ]]; owned_remove "$finite"; finite=
    rollback_common=("${labels[@]}" --network "container:$pg" --env-file "$work/off.env" -v "$GITHUB_WORKSPACE/rollback-source/api:/api:ro" -v "$work/off-adapter/capacity:/adapter/capacity:ro" -v "$work/fixtures:/fixtures:ro" --workdir /tmp)
    stage=rollback_api_start
    api=$(timeout 10s docker run -d --name "capacity-api-$run" "${rollback_common[@]}" --memory 512m --memory-swap 512m --cpus 0.5 "$image" python -m uvicorn capacity.app:app --host 0.0.0.0 --port 18047)
    finite=$(timeout 10s docker run -d "${rollback_common[@]}" "$image" python -c 'import time,urllib.request
for attempt in range(30):
 try:
  urllib.request.urlopen("http://127.0.0.1:18047/up",timeout=1);break
 except Exception:time.sleep(.2)
else:raise SystemExit(1)')
    [[ "$(timeout 15s docker wait "$finite")" == 0 ]]; owned_remove "$finite"; finite=
    stage=rollback_read_smoke
    finite=$(timeout 10s docker run -d "${rollback_common[@]}" -v "$work/rollback:/results" "$image" python -m capacity.rollback_smoke smoke --before /results/workouts-before.json --output /results/rollback.json)
    [[ "$(timeout 30s docker wait "$finite")" == 0 ]]; owned_remove "$finite"; finite=
    owned_remove "$api"; api=
  fi
  owned_remove "$pg"; pg=
  limited 10 sudo rm -r -- "$result/pgdata" || { cleanup_ok=false; exit 1; }

done
stage=final_comparison
PYTHONPATH="$work/context" python3 -m capacity.private_beta_report --baseline "$work/off/latency.json" --mixed "$work/enabled/latency.json" --memory "$work/enabled/memory.jsonl" --baseline-memory "$work/off/memory.jsonl" --output "$work/comparison.json"
python3 - "$work" <<'PY'
import collections,json,sys
from pathlib import Path
w=Path(sys.argv[1]); comparison=json.loads((w/'comparison.json').read_text()); phases={}
for name in ['off','enabled']:
    p=w/name; latency=json.loads((p/'latency.json').read_text()); memory=json.loads((p/'memory.jsonl.summary.json').read_text()); counts=json.loads((p/'counts.json').read_text())
    assert memory['completed'] and not memory['failure_code'] and not memory['failure_type']
    ready=json.loads((p/'readiness.json').read_text())
    assert ready['ready'] and not ready['expired']
    before=json.loads((p/'counts-before.json').read_text())
    assert before['schema']==33 and before['recipes']==1000 and before['jobs']==0
    assert counts['schema']==33 and counts['recipes']==1010 and counts['extract']==5 and counts['cover']==5 and counts['active']==0
    assert (counts['workouts_tables']==0) if name=='off' else (counts['workouts_tables']>0)
    assert latency['completed'] and latency['protected_acceptance']['passed']
    samples=[json.loads(line) for line in (p/'memory.jsonl').read_text().splitlines()]
    ends=collections.Counter(e['stage'] for row in samples for e in row['stages'] if e['event']=='end')
    assert all(not row.get('stop_required') and row.get('oom',0)==0 and row.get('oom_kill',0)==0 for row in samples)
    assert ends=={'evidence_frames':5,'thumbnail_normalize':5,'cover_compare':5},ends
    phases[name]={'memory':memory,'routes':latency['routes'],'counts':counts,'counts_before':before,'startup_readiness':ready}
    if name=='enabled':
        ledger=json.loads((p/'schema-ledger-before.json').read_text())
        assert ledger==list(range(34,45))
        phases[name]['optional_schema_ledger']=ledger
        saved=json.loads((p/'workouts-counts.json').read_text())
        assert saved=={'optional_schema':44,'imports':5,'accepted':5,'active_imports':0,'library':212,'versions':212,'coach':5,'sessions':5,'activity':5,'snapshots':0,'pages':0},saved
        assert latency['saved_outcomes']['accepted_workout_count']==5
        for label,status,count in [('workouts/import-submit','202',5),('workouts/coach','200',5),('workouts/session-write','201',5),('workouts/session-replay','200',5),('workouts/activity-write','201',5),('workouts/export-build','201',5),('workouts/export-page','200',95),('workouts/export-remove','204',5)]:
            row=latency['routes'][label]
            assert row['count']==count and row['statuses']=={status:count} and row['unexpected']==0,(label,row)
        phases[name]['workouts_counts']=saved
rollback=json.loads((w/'rollback/rollback.json').read_text())
assert rollback['five_recipe_reads_passed'] and rollback['workouts_data_preserved']
r={'passed':comparison['local_gate']=='passed','api_source':'253660117800ffd83494d91230beb199851ec427','rollback_source':'823986f48e4eb5de3075969a742f834036b5d473','comparison':comparison,'phases':phases,'rollback':rollback,'render_parity':False,'r04_closed':False,'real_provider_calls':0,'financial_admission_tested':False}
(w/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
raise SystemExit(0 if r['passed'] else 1)
PY
