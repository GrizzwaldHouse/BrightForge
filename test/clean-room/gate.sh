#!/usr/bin/env bash
# Build gate for BrightForge (skill: verified-build-gate, report: references/fix-loop.md).
#
# Usage:  test/clean-room/gate.sh [repo-path]        (default: current directory)
#
# Builds from `git archive HEAD` into a temp dir, so only committed content is gated.
# Writes <repo>/.gate/build-gate-report.json and exits 0 only when the verdict is READY.
#
# Environment:
#   GATE_STEPS              comma list of steps to run, default 1,2,3,4 (re-run failed steps alone;
#                           results of the other steps are kept from the previous report for the same HEAD)
#   GATE_STABILITY_SECONDS  length of step 3, default 300 (quick mode: 60)
#   GATE_HEALTH_INTERVAL    seconds between health checks in step 3, default 30
#   GATE_REVIEWER           APPROVED | REJECTED, set by the caller after the separate reviewer agent ran.
#                           READY needs steps 1-4 PASS and APPROVED; otherwise step 5 stays NOT RUN
#   GATE_SUITE_TIMEOUT      seconds for the node deterministic suite, default 3000
#   GATE_NODE_MODULES       node_modules to use for lint and the node helpers (default <repo>/node_modules)
#   GATE_CA_BUNDLE          optional CA file passed to docker build as secret extra_ca (default /root/.ccr/ca-bundle.crt)
#   GATE_BUILD_NETWORK      docker build --network value, default host
#   GATE_KEEP               1 keeps the temp build dir
#
# Steps: 1 build (lint + both test images, no proxy/CA leak in layers), 2 launch (health in 60 s),
#        3 stability (health, memory, WebSocket/SSE, anchored log scan), 4 tests (node suite, python suite,
#        browser tab sweep, chat flow, feature workflows, adversarial API checks), 5 reviewer (external).

set -uo pipefail

REPO_ARG="${1:-.}"
REPO="$(cd "$REPO_ARG" && pwd -P)" || { echo "[GATE] cannot open repo path: $REPO_ARG" >&2; exit 2; }
GATE_STEPS="${GATE_STEPS:-1,2,3,4}"
STAB_SECONDS="${GATE_STABILITY_SECONDS:-300}"
STAB_INTERVAL="${GATE_HEALTH_INTERVAL:-30}"
SUITE_TIMEOUT="${GATE_SUITE_TIMEOUT:-3000}"
BUILD_NETWORK="${GATE_BUILD_NETWORK:-host}"
CA_BUNDLE="${GATE_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}"
REVIEWER_IN="${GATE_REVIEWER:-}"
PROJECT=brightforge-gate

HEAD_SHA="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" || { echo "[GATE] $REPO is not a git repository with a commit" >&2; exit 2; }
GATE_DIR="$REPO/.gate"
REPORT="$GATE_DIR/build-gate-report.json"
mkdir -p "$GATE_DIR"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/bf-gate.XXXXXX")"
SRC="$WORK/src"
OUT="$WORK/out"
mkdir -p "$SRC" "$OUT"
: > "$OUT/steps.jsonl"

IP=""

selected() { case ",$GATE_STEPS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# record STEP NAME RESULT CLASS DETAIL   (CLASS "-" means null)
record() {
  python3 - "$OUT/steps.jsonl" "$1" "$2" "$3" "$4" "$5" <<'PY'
import json, sys
path, step, name, result, cls, detail = sys.argv[1:7]
with open(path, "a") as f:
    f.write(json.dumps({"step": int(step), "name": name, "result": result,
                        "failure_class": None if cls == "-" else cls, "detail": detail}) + "\n")
PY
  echo "[GATE] step $1 $2: $3$( [ "$4" = "-" ] || printf ' [%s]' "$4" ) - $5"
}

cleanup() {
  docker rm -f bf-server bf-sidecar >/dev/null 2>&1 || true
  mkdir -p "$GATE_DIR/logs"
  cp -f "$OUT"/*.log "$OUT"/*.json "$OUT"/*.txt "$OUT"/*.jsonl "$GATE_DIR/logs/" 2>/dev/null || true
  if [ "${GATE_KEEP:-0}" != "1" ]; then rm -rf "$WORK"; else echo "[GATE] kept $WORK"; fi
}
trap cleanup EXIT

if [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
  echo "[GATE] warning: working tree has uncommitted changes; only HEAD ${HEAD_SHA:0:7} is gated" >&2
fi

git -C "$REPO" archive HEAD | tar -x -C "$SRC" || { echo "[GATE] git archive failed" >&2; exit 2; }

NM="${GATE_NODE_MODULES:-$REPO/node_modules}"
[ -d "$NM" ] && NM="$(cd "$NM" && pwd -P)"
GLOBAL_NM="$(npm root -g 2>/dev/null || true)"
NODE_PATH_ALL="$NM${GLOBAL_NM:+:$GLOBAL_NM}"

# ---------------------------------------------------------------- docker helpers
ensure_docker() {
  docker info >/dev/null 2>&1 && return 0
  if ! command -v dockerd >/dev/null 2>&1; then DOCKER_ERR="docker daemon is down and dockerd is not installed"; DOCKER_CLASS=OWNER; return 1; fi
  echo "[GATE] docker daemon down, starting dockerd"
  nohup dockerd > "${GATE_DOCKERD_LOG:-/tmp/dockerd.log}" 2>&1 &
  local i
  for i in $(seq 1 60); do docker info >/dev/null 2>&1 && return 0; sleep 1; done
  DOCKER_ERR="dockerd did not become ready in 60 s (see ${GATE_DOCKERD_LOG:-/tmp/dockerd.log})"; DOCKER_CLASS=HARNESS
  return 1
}

image_head() { docker image inspect -f '{{index .Config.Labels "gate.head"}}' "$1" 2>/dev/null || true; }

build_images() {
  local args=() t rc=0
  [ -n "${HTTP_PROXY:-}" ] && args+=(--build-arg "HTTP_PROXY=$HTTP_PROXY" --build-arg "http_proxy=$HTTP_PROXY")
  [ -n "${HTTPS_PROXY:-}" ] && args+=(--build-arg "HTTPS_PROXY=$HTTPS_PROXY" --build-arg "https_proxy=$HTTPS_PROXY")
  [ -f "$CA_BUNDLE" ] && args+=(--secret "id=extra_ca,src=$CA_BUNDLE")
  rm -f "$SRC/node_modules"
  for t in test python-test; do
    DOCKER_BUILDKIT=1 docker build --network "$BUILD_NETWORK" "${args[@]}" --label "gate.head=$HEAD_SHA" \
      --target "$t" -t "brightforge-$t:local" "$SRC" > "$OUT/build-$t.log" 2>&1 || rc=1
  done
  return $rc
}

ensure_images() {
  [ "$(image_head brightforge-test:local)" = "$HEAD_SHA" ] && [ "$(image_head brightforge-python-test:local)" = "$HEAD_SHA" ] && return 0
  echo "[GATE] images are not built from ${HEAD_SHA:0:7}, building"
  build_images
}

# up: restart the isolated server + sidecar, set IP
up() {
  IP="$(cd "$SRC/test/clean-room" && ./up.sh 2>>"$OUT/up.err" | tail -1)"
  [ -n "$IP" ]
}

health_code() { curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 "http://$IP:8080/api/health" 2>/dev/null || echo 000; }

# ---------------------------------------------------------------- step 1: build
step1() {
  local lint_rc=0 build_rc=0 leak="n/a" detail cls="-"
  if [ -d "$NM" ]; then
    ln -sfn "$NM" "$SRC/node_modules"
    (cd "$SRC" && npx eslint src/ public/js/ bin/ --ext .js) > "$OUT/lint.log" 2>&1 || lint_rc=$?
    rm -f "$SRC/node_modules"
  else
    echo "no node_modules at $NM" > "$OUT/lint.log"; lint_rc=127
  fi
  if ! ensure_docker; then
    record 1 build FAIL "${DOCKER_CLASS:-HARNESS}" "lint exit $lint_rc; ${DOCKER_ERR:-docker unavailable}"
    return
  fi
  build_images || build_rc=1
  leak="$(docker history --no-trunc brightforge-test:local brightforge-python-test:local 2>/dev/null | grep -ciE 'proxy|BEGIN CERT|ccr' || true)"
  detail="lint exit $lint_rc; images built=$([ $build_rc -eq 0 ] && echo yes || echo no); layer leak matches ${leak:-0}"
  if [ $lint_rc -eq 0 ] && [ $build_rc -eq 0 ] && [ "${leak:-0}" = "0" ]; then
    record 1 build PASS - "$detail"
  else
    if [ $lint_rc -eq 127 ] || grep -qiE 'rate limit|toomanyrequests|TLS handshake|i/o timeout|no such host' "$OUT"/build-*.log 2>/dev/null; then cls=HARNESS; else cls=PRODUCT; fi
    record 1 build FAIL "$cls" "$detail"
  fi
}

# ---------------------------------------------------------------- step 2: launch
step2() {
  local t0 t1 code
  if ! ensure_docker || ! ensure_images; then
    record 2 launch FAIL "${DOCKER_CLASS:-HARNESS}" "${DOCKER_ERR:-test images could not be built}"
    return
  fi
  t0=$(date +%s); up; t1=$(date +%s)
  code="$(health_code)"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' bf-server 2>/dev/null | grep -E '^NODE_ENV' > "$OUT/server-env.txt" || true
  if [ "$code" = "200" ] && [ $((t1 - t0)) -le 60 ]; then
    record 2 launch PASS - "health 200 at $IP in $((t1 - t0))s"
  else
    record 2 launch FAIL PRODUCT "health $code after $((t1 - t0))s at ${IP:-no ip}"
  fi
}

# ---------------------------------------------------------------- step 3: stability
write_stability_probe() {
  cat > "$OUT/stability.cjs" <<'JS'
// Subscribes to the WebSocket and the metrics SSE stream, polls /api/health, prints one JSON result.
const WebSocket = require('ws');
const ip = process.argv[2]; const secs = +process.argv[3]; const every = +process.argv[4];
const base = `http://${ip}:8080`;
const r = { health: [], wsOpen: 0, wsClose: 0, wsMsgs: 0, sseChunks: 0, sseErrors: 0 };
const ws = new WebSocket(`ws://${ip}:8080/ws/events`);
ws.on('open', () => r.wsOpen++); ws.on('close', () => r.wsClose++); ws.on('message', () => r.wsMsgs++); ws.on('error', () => {});
const ctl = new AbortController();
fetch(`${base}/api/metrics/stream`, { signal: ctl.signal })
  .then(async (s) => { for await (const _chunk of s.body) r.sseChunks++; })
  .catch((e) => { if (e.name !== 'AbortError') r.sseErrors++; });
const ticks = Math.max(1, Math.ceil(secs / every)); let n = 0;
const tick = async () => {
  const t = Date.now(); let st = 0;
  try { st = (await fetch(`${base}/api/health`)).status; } catch (_e) { st = 0; }
  r.health.push({ n, status: st, ms: Date.now() - t });
};
tick();
const iv = setInterval(async () => {
  n++; await tick();
  if (n >= ticks) {
    clearInterval(iv); ctl.abort(); ws.close();
    r.ticks = ticks;
    setTimeout(() => { console.log(JSON.stringify(r)); process.exit(0); }, 500);
  }
}, every * 1000);
JS
}

step3() {
  local mem0 mem1 summary res detail cls
  if ! ensure_docker || ! ensure_images; then
    record 3 stability FAIL "${DOCKER_CLASS:-HARNESS}" "${DOCKER_ERR:-test images could not be built}"
    return
  fi
  if [ "$(health_code 2>/dev/null)" != "200" ] || [ -z "$IP" ]; then up; fi
  if [ "$(health_code)" != "200" ]; then record 3 stability FAIL PRODUCT "server not healthy at start (health $(health_code))"; return; fi
  if ! NODE_PATH="$NODE_PATH_ALL" node -e "require('ws')" 2>/dev/null; then
    record 3 stability "NOT RUN" HARNESS "Cannot find module 'ws' (NODE_PATH=$NODE_PATH_ALL); stability probe did not run"
    return
  fi
  write_stability_probe
  mem0="$(docker stats --no-stream --format '{{.MemUsage}}' bf-server | cut -d/ -f1)"
  NODE_PATH="$NODE_PATH_ALL" node "$OUT/stability.cjs" "$IP" "$STAB_SECONDS" "$STAB_INTERVAL" > "$OUT/stability.json" 2> "$OUT/stability.err" || true
  mem1="$(docker stats --no-stream --format '{{.MemUsage}}' bf-server | cut -d/ -f1)"
  docker logs bf-server > "$OUT/stability-server.log" 2>&1 || true
  summary="$(python3 - "$OUT" "$mem0" "$mem1" <<'PY'
import json, re, sys
out, m0, m1 = sys.argv[1:4]
def mib(s):
    v = float(re.findall(r'[\d.]+', s)[0])
    return v / 1024 if 'KiB' in s else v * 1024 if 'GiB' in s else v
try:
    r = json.load(open(out + '/stability.json'))
except Exception as e:
    print("FAIL UNEXPLAINED stability probe produced no result: %s" % e); sys.exit(0)

# Real error formats only. Startup lines such as
# "[ERROR-HANDLER] Process handlers registered (uncaughtException, unhandledRejection)" never match.
lines = open(out + '/stability-server.log', errors='replace').read().splitlines()
pats = [re.compile(r'^(ERROR|FATAL)\b'), re.compile(r'UnhandledPromiseRejection'),
        re.compile(r'Unhandled rejection at')]
found = []
for i, ln in enumerate(lines):
    if any(p.search(ln) for p in pats):
        found.append(ln.strip()[:120]); continue
    nxt = lines[i + 1] if i + 1 < len(lines) else ''
    stack_next = re.match(r'\s+at ', nxt) is not None
    if stack_next and (re.search(r'uncaughtException:', ln) or re.match(r'^\w*Error: ', ln)):
        found.append(ln.strip()[:120])
ignored = sum(1 for ln in lines if 'Process handlers registered' in ln)

bad = [h for h in r['health'] if h['status'] != 200]
expected = r.get('ticks', 10) + 1
g = (mib(m1) - mib(m0)) / mib(m0) * 100
reasons = []
if bad: reasons.append('%d health failures' % len(bad))
if len(r['health']) < expected: reasons.append('only %d/%d health samples' % (len(r['health']), expected))
if r['wsOpen'] != 1: reasons.append('WebSocket did not open (open=%d)' % r['wsOpen'])
if r['wsClose'] > 1: reasons.append('WebSocket closed %d times' % r['wsClose'])
if r['sseErrors']: reasons.append('%d SSE errors' % r['sseErrors'])
if found: reasons.append('%d error lines in server log: %s' % (len(found), found[0]))
if g >= 50: reasons.append('memory growth %.1f%%' % g)
note = "health %d/%d ok; ws open=%d msgs=%d (idle zero is recorded, not a failure); sse chunks=%d errors=%d; memory %s -> %s (%.1f%%); error lines=%d (startup lines ignored=%d)" % (
    len(r['health']) - len(bad), len(r['health']), r['wsOpen'], r['wsMsgs'], r['sseChunks'], r['sseErrors'], m0.strip(), m1.strip(), g, len(found), ignored)
if reasons:
    cls = 'HARNESS' if any('Process handlers registered' in x for x in found) else 'PRODUCT'
    print("FAIL %s %s | %s" % (cls, note, '; '.join(reasons)))
else:
    print("PASS - " + note)
PY
)"
  res="${summary%% *}"; summary="${summary#* }"; cls="${summary%% *}"; detail="${summary#* }"
  record 3 stability "$res" "$cls" "$detail (${STAB_SECONDS}s)"
}

# ---------------------------------------------------------------- step 4: tests
json_get() { python3 - "$1" "$2" <<'PY'
import json, sys
path, expr = sys.argv[1:3]
try:
    d = json.load(open(path))
except Exception:
    print("n/a"); sys.exit(0)
if expr == "tabs429":
    print(sum(1 for k, v in d.items() if not k.startswith('__') for a in v.get('api', []) if a.endswith(' 429')))
elif expr == "tabsPageErrors":
    print(sum(len(v.get('pageErrors', [])) for k, v in d.items() if not k.startswith('__')))
elif expr == "orchErrors":
    v = d.get('orchestration', {})
    print(len([e for e in v.get('consoleErrors', []) if 'map is not a function' in e]))
elif expr == "planShown":
    print(d.get('planShown'))
PY
}

step4() {
  local f_harness=0 f_product=0 f_unexpl=0 notes=() ns ps pr node_ok py_ok
  local t429 tpe orch ch hello adv advok browser_ok=1 mod_msg
  if ! ensure_docker || ! ensure_images; then
    record 4 tests FAIL "${DOCKER_CLASS:-HARNESS}" "${DOCKER_ERR:-test images could not be built}"
    return
  fi
  rm -f "$SRC/node_modules"

  # 4a node deterministic suite (offline container). Failed scripts are re-run alone to classify them.
  (cd "$SRC" && timeout "$SUITE_TIMEOUT" docker compose -p "$PROJECT" --profile test run --rm --no-deps --pull never brightforge-test) > "$OUT/suite-node.log" 2>&1 || true
  ns="$(grep -E '^\[SUITE\] [0-9]+/[0-9]+ passed' "$OUT/suite-node.log" | tail -1)"
  node_ok=0; echo "$ns" | grep -qE ' ([0-9]+)/\1 passed' && node_ok=1
  if [ $node_ok -ne 1 ]; then
    local name alone fails=()
    while read -r name; do
      [ -z "$name" ] && continue
      fails+=("$name")
      if (cd "$SRC" && timeout 600 docker compose -p "$PROJECT" --profile test run --rm --no-deps --pull never brightforge-test node src/tests/run-deterministic-suite.js --only "$name") > "$OUT/suite-alone-$name.log" 2>&1; then
        alone="passes alone"; f_unexpl=1
      else
        alone="fails alone"; f_product=1
      fi
      notes+=("$name: $alone")
    done < <(grep -E '^\[SUITE\] FAIL' "$OUT/suite-node.log" | awk '{ for (i = 2; i <= NF; i++) if ($i ~ /^test-|^lint$/) { print $i; break } }')
    if [ ${#fails[@]} -eq 0 ]; then f_unexpl=1; notes+=("suite produced no summary (see suite-node.log)"); fi
  fi

  # 4b python suite
  (cd "$SRC" && timeout 600 docker compose -p "$PROJECT" --profile test run --rm --no-deps --pull never brightforge-python-test) > "$OUT/suite-python.log" 2>&1 || true
  ps="$(grep -E '^(OK|FAILED)' "$OUT/suite-python.log" | tail -1)"; pr="$(grep -E '^Ran ' "$OUT/suite-python.log" | tail -1)"
  py_ok=0; [ "$ps" = "OK" ] && py_ok=1
  [ $py_ok -eq 1 ] || f_product=1

  # 4c browser tooling check, then the browser/API scripts. A missing module or browser is a HARNESS
  # problem and the browser checks count as NOT RUN, never as a product failure.
  local cr="$SRC/test/clean-room" harness_re="Cannot find module|Executable doesn't exist|browserType.launch: Failed to launch|playwright install"
  mod_msg="$(NODE_PATH="$NODE_PATH_ALL" node -e "require('playwright')" 2>&1 | grep -m1 -E "Cannot find module|Error" || true)"
  t429="not run"; tpe="not run"; orch="not run"; ch="not run"; hello=""
  if ! NODE_PATH="$NODE_PATH_ALL" node -e "require('playwright')" >/dev/null 2>&1; then
    browser_ok=0; f_harness=1
    notes+=("browser sweep and chat flow NOT RUN: ${mod_msg:-playwright not resolvable} (NODE_PATH=$NODE_PATH_ALL)")
  else
    up; (cd "$cr" && NODE_PATH="$NODE_PATH_ALL" node tabs.cjs "http://$IP:8080/" "$OUT") > "$OUT/tabs.log" 2>&1; local tabs_rc=$?
    if [ $tabs_rc -ne 0 ] && grep -qE "$harness_re" "$OUT/tabs.log"; then
      browser_ok=0; f_harness=1
      notes+=("browser sweep and chat flow NOT RUN: $(grep -m1 -E "$harness_re" "$OUT/tabs.log" | cut -c1-120)")
    else
      [ $tabs_rc -eq 0 ] || f_product=1
      t429="$(json_get "$OUT/tabs.json" tabs429)"; tpe="$(json_get "$OUT/tabs.json" tabsPageErrors)"; orch="$(json_get "$OUT/tabs.json" orchErrors)"
      up; docker exec bf-server mkdir -p /tmp/demo >/dev/null 2>&1 || true
      (cd "$cr" && NODE_PATH="$NODE_PATH_ALL" node chat.cjs "http://$IP:8080/" "$OUT") > "$OUT/chat.log" 2>&1 || f_product=1
      ch="$(json_get "$OUT/chat.json" planShown)"; hello="$(docker exec bf-server cat /tmp/demo/hello.txt 2>/dev/null || true)"
      if [ "$t429" != "0" ] || [ "$tpe" != "0" ] || [ "$orch" != "0" ] || [ "$ch" != "True" ] || [ -z "$hello" ]; then f_product=1; fi
    fi
  fi
  up; (cd "$cr" && NODE_PATH="$NODE_PATH_ALL" node features.mjs "http://$IP:8080" "$OUT") > "$OUT/features.log" 2>&1 || f_product=1
  up; (cd "$cr" && NODE_PATH="$NODE_PATH_ALL" node adversarial.mjs "http://$IP:8080" "$OUT") > "$OUT/adversarial.log" 2>&1 || f_product=1
  adv="$(tail -1 "$OUT/adversarial.log")"
  advok="$(echo "$adv" | python3 -c "import sys,re;m=re.search(r'(\d+)/(\d+) PASS',sys.stdin.read());print(1 if m and m.group(1)==m.group(2) else 0)")"
  [ "$advok" = "1" ] || f_product=1
  docker rm -f bf-server bf-sidecar >/dev/null 2>&1 || true

  local det="node: ${ns:-no summary} | python: ${pr:-?} ${ps:-?} | tabs: 429s=$t429 pageErrors=$tpe orchestration-map-errors=$orch | chat: planShown=$ch file='${hello:-}' | adversarial: ${adv:-none}"
  [ ${#notes[@]} -gt 0 ] && det="$det | ${notes[*]}"
  if [ $node_ok -eq 1 ] && [ $py_ok -eq 1 ] && [ $browser_ok -eq 1 ] && [ $f_product -eq 0 ] && [ $f_unexpl -eq 0 ] && [ $f_harness -eq 0 ]; then
    record 4 tests PASS - "$det"
  elif [ $f_product -eq 1 ]; then
    record 4 tests FAIL PRODUCT "$det"
  elif [ $f_unexpl -eq 1 ]; then
    record 4 tests FAIL UNEXPLAINED "$det"
  elif [ $browser_ok -eq 0 ]; then
    record 4 tests "NOT RUN" HARNESS "$det"
  else
    record 4 tests FAIL UNEXPLAINED "$det"
  fi
}

# ---------------------------------------------------------------- run selected steps
for s in 1 2 3 4; do
  if selected "$s"; then "step$s"; fi
done

# ---------------------------------------------------------------- report
python3 - "$OUT/steps.jsonl" "$REPORT" "$HEAD_SHA" "$GATE_STEPS" "$REVIEWER_IN" "$STAB_SECONDS" <<'PY'
import json, os, re, sys
steps_path, report_path, head, selected, reviewer_in, stab = sys.argv[1:7]
names = {1: "build", 2: "launch", 3: "stability", 4: "tests"}
prev = {}
round_no = 1
if os.path.exists(report_path):
    try:
        old = json.load(open(report_path))
        if old.get("head") == head:
            round_no = int(old.get("round", 0)) + 1
            prev = {s["step"]: s for s in old.get("steps", []) if s.get("step") in names}
    except Exception:
        pass
new = {}
for line in open(steps_path):
    if line.strip():
        d = json.loads(line); new[d["step"]] = d
steps = []
for n in (1, 2, 3, 4):
    if n in new:
        steps.append(new[n])
    elif n in prev:
        carried = prev[n]
        m = re.search(r"\((\d+)s\)\s*$", carried.get("detail", ""))
        if n == 3 and carried.get("result") == "PASS" and m and int(m.group(1)) < 300:
            carried = {"step": 3, "name": "stability", "result": "NOT RUN", "failure_class": "HARNESS",
                       "detail": "earlier stability pass was only %ss; a full 300s run is required before READY" % m.group(1)}
        steps.append(carried)
    else:
        steps.append({"step": n, "name": names[n], "result": "NOT RUN", "failure_class": None,
                      "detail": "not selected in this run (GATE_STEPS=%s) and no earlier result for this commit" % selected})
all_pass = all(s["result"] == "PASS" for s in steps)
if all_pass and reviewer_in == "APPROVED":
    reviewer = "APPROVED"
elif all_pass and reviewer_in == "REJECTED":
    reviewer = "REJECTED"
else:
    reviewer = "NOT RUN"
steps.append({"step": 5, "name": "reviewer", "result": {"APPROVED": "PASS", "REJECTED": "FAIL"}.get(reviewer, "NOT RUN"),
              "failure_class": None,
              "detail": {"APPROVED": "independent reviewer approved",
                         "REJECTED": "independent reviewer rejected",
                         "NOT RUN": "reviewer agent not run (needs steps 1-4 PASS; after the reviewer approves, run with GATE_REVIEWER=APPROVED GATE_STEPS=5)"}[reviewer]})
verdict = "READY" if all_pass and reviewer == "APPROVED" else "NOT READY"
mapping = ("1 build = eslint over src/ public/js/ bin/ plus docker build of the test and python-test images from git archive HEAD, "
           "layers checked for proxy/CA leaks; 2 launch = isolated server (no internet) answers /api/health within 60 s; "
           "3 stability = %ss with health checks, memory growth under 50%%, WebSocket and metrics SSE kept connected, "
           "server log scanned for real error formats only; "
           "4 tests = offline node deterministic suite, python suite, Playwright tab sweep, chat plan/approve/apply flow, "
           "feature workflows and adversarial API checks against the isolated server; "
           "5 reviewer = independent read-only reviewer agent given results and logs only" % stab)
report = {"head": head, "verdict": verdict, "round": round_no, "mapping": mapping, "steps": steps, "reviewer": reviewer}
with open(report_path, "w") as f:
    json.dump(report, f, indent=2); f.write("\n")
print("[GATE] verdict %s at %s (round %d)" % (verdict, head[:7], round_no))
for s in steps:
    print("[GATE]   %d %-9s %s%s" % (s["step"], s["name"], s["result"], " [%s]" % s["failure_class"] if s.get("failure_class") else ""))
sys.exit(0 if verdict == "READY" else 1)
PY
exit $?
