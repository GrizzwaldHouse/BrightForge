#!/bin/bash
# Build gate (adapted from verified-build-gate). Usage: gate.sh <gate-dir>
G=$1; O=$G/out; NM=/tmp/claude-0/-home-user-BrightForge/267d898d-a30f-541f-8ec5-5a03c6f4fccf/scratchpad/bf-repair/node_modules
step(){ echo "{\"step\":\"$1\",\"name\":\"$2\",\"result\":\"$3\",\"detail\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$4")}" >> $O/steps.jsonl; echo "[GATE] $1 $2: $3 - $4"; }
: > $O/steps.jsonl
cd $G
# 1 BUILD
PA="--build-arg HTTP_PROXY=$HTTP_PROXY --build-arg HTTPS_PROXY=$HTTPS_PROXY --build-arg http_proxy=$HTTP_PROXY --build-arg https_proxy=$HTTPS_PROXY"
( ln -sfn $NM node_modules && npx eslint src/ public/js/ bin/ --ext .js > $O/lint.log 2>&1 ); L=$?; rm -f node_modules
B1=0; for t in test python-test; do DOCKER_BUILDKIT=1 docker build --network host --secret id=extra_ca,src=/root/.ccr/ca-bundle.crt $PA --target $t -t brightforge-$t:local . > $O/build-$t.log 2>&1 || B1=1; done
LEAK=$(docker history --no-trunc brightforge-test:local brightforge-python-test:local 2>/dev/null | grep -ciE 'proxy|BEGIN CERT|ccr')
[ $L -eq 0 ] && [ $B1 -eq 0 ] && [ "$LEAK" = "0" ] && step 1 build PASS "lint exit $L; images built; layer leak matches $LEAK" || step 1 build FAIL "lint exit $L; build fail=$B1; layer leak matches $LEAK"
# 2 LAUNCH
cd $G/test/clean-room; T0=$(date +%s); IP=$(./up.sh 2>$O/up.err | tail -1); T1=$(date +%s)
HC=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://$IP:8080/api/health)
[ "$HC" = "200" ] && [ $((T1-T0)) -le 60 ] && step 2 launch PASS "health 200 at $IP in $((T1-T0))s" || step 2 launch FAIL "health $HC after $((T1-T0))s"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' bf-server | grep -E '^NODE_ENV' > $O/server-env.txt
# 3 STABILITY (5 min): WebSocket + SSE subscribed, health every 30 s, memory, errors
MEM0=$(docker stats --no-stream --format '{{.MemUsage}}' bf-server | cut -d/ -f1)
NODE_PATH=$NM node - "$IP" > $O/stability.json 2>$O/stability.err <<'JS'
const WebSocket = require('ws'); const ip = process.argv[2]; const base = `http://${ip}:8080`;
const r = { health: [], wsOpen: 0, wsClose: 0, wsMsgs: 0, sseChunks: 0, sseErrors: 0 };
const ws = new WebSocket(`ws://${ip}:8080/ws/events`);
ws.on('open', () => r.wsOpen++); ws.on('close', () => r.wsClose++); ws.on('message', () => r.wsMsgs++); ws.on('error', () => {});
const ctl = new AbortController();
fetch(`${base}/api/metrics/stream`, { signal: ctl.signal }).then(async (s) => { for await (const _ of s.body) r.sseChunks++; }).catch((e) => { if (e.name !== 'AbortError') r.sseErrors++; });
let n = 0; const tick = async () => { const t = Date.now(); let st = 0; try { st = (await fetch(`${base}/api/health`)).status; } catch {} r.health.push({ n, status: st, ms: Date.now() - t }); };
tick(); const iv = setInterval(async () => { n++; await tick(); if (n >= 10) { clearInterval(iv); ctl.abort(); ws.close(); setTimeout(() => { console.log(JSON.stringify(r)); process.exit(0); }, 500); } }, 30000);
JS
MEM1=$(docker stats --no-stream --format '{{.MemUsage}}' bf-server | cut -d/ -f1)
docker logs bf-server > $O/stability-server.log 2>&1
UNH=$(grep -ciE 'unhandled|uncaughtException|FATAL' $O/stability-server.log)
python3 - "$O" "$MEM0" "$MEM1" "$UNH" > $O/stability-summary.txt <<'PY'
import json,sys,re
o,m0,m1,unh=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4])
def mib(s):
    v=float(re.findall(r'[\d.]+',s)[0]); return v/1024 if 'KiB' in s else v*1024 if 'GiB' in s else v
r=json.load(open(o+'/stability.json')); bad=[h for h in r['health'] if h['status']!=200]
g=(mib(m1)-mib(m0))/mib(m0)*100
ok = not bad and len(r['health'])>=11 and r['wsOpen']==1 and r['wsClose']<=1 and r['sseErrors']==0 and unh==0 and g<50
print(('PASS' if ok else 'FAIL')+f" health {len(r['health'])-len(bad)}/{len(r['health'])} ok; ws open={r['wsOpen']} msgs={r['wsMsgs']}; sse chunks={r['sseChunks']} errors={r['sseErrors']}; memory {m0.strip()} -> {m1.strip()} ({g:.1f}%); unhandled={unh}")
PY
S3=$(cat $O/stability-summary.txt); step 3 stability "${S3%% *}" "${S3#* }"
# 4 TESTS
cd $G; F=0
timeout 3000 docker compose --profile test run --rm --no-deps --pull never brightforge-test > $O/suite-node.log 2>&1 || F=1
timeout 600 docker compose --profile test run --rm --no-deps --pull never brightforge-python-test > $O/suite-python.log 2>&1 || F=1
NS=$(grep -E '^\[SUITE\] [0-9]+/[0-9]+ passed' $O/suite-node.log | tail -1); PS=$(grep -E '^(OK|FAILED)' $O/suite-python.log | tail -1); PR=$(grep -E '^Ran ' $O/suite-python.log | tail -1)
cd $G/test/clean-room
./up.sh >/dev/null 2>&1; NODE_PATH=$NM node tabs.cjs http://$IP:8080/ $O > $O/tabs.log 2>&1 || F=1
T429=$(python3 -c "import json;l=json.load(open('$O/tabs.json'));print(sum(1 for k,v in l.items() if not k.startswith('__') for a in v['api'] if a.endswith(' 429')))")
TPE=$(python3 -c "import json;l=json.load(open('$O/tabs.json'));print(sum(len(v['pageErrors']) for k,v in l.items() if not k.startswith('__')))")
ORCH=$(python3 -c "import json;l=json.load(open('$O/tabs.json'));v=l.get('orchestration',{});print(len([e for e in v.get('consoleErrors',[]) if 'map is not a function' in e]))")
./up.sh >/dev/null 2>&1; docker exec bf-server mkdir -p /tmp/demo; NODE_PATH=$NM node chat.cjs http://$IP:8080/ $O > $O/chat.log 2>&1 || F=1
CH=$(python3 -c "import json;r=json.load(open('$O/chat.json'));print(r.get('planShown'))"); HELLO=$(docker exec bf-server cat /tmp/demo/hello.txt 2>/dev/null)
SESS=$(curl -s --noproxy '*' http://$IP:8080/api/sessions | python3 -c "import json,sys;print(json.load(sys.stdin).get('count'))")
./up.sh >/dev/null 2>&1; NODE_PATH=$NM node features.mjs http://$IP:8080 $O > $O/features.log 2>&1 || F=1
./up.sh >/dev/null 2>&1; NODE_PATH=$NM node adversarial.mjs http://$IP:8080 $O > $O/adversarial.log 2>&1 || F=1
ADV=$(tail -1 $O/adversarial.log)
docker rm -f bf-server bf-sidecar >/dev/null 2>&1
NSOK=$(echo "$NS" | grep -cE ' ([0-9]+)/\1 passed'); ADVOK=$(echo "$ADV" | python3 -c "import sys,re;m=re.search(r'(\d+)/(\d+) PASS',sys.stdin.read());print(1 if m and m.group(1)==m.group(2) else 0)")
DET="node: $NS | python: $PR $PS | tabs: 429s=$T429 pageErrors=$TPE orchestration-map-errors=$ORCH | chat: planShown=$CH file='$HELLO' sessions=$SESS | adversarial: $ADV"
[ $F -eq 0 ] && [ "$NSOK" = "1" ] && [ "$PS" = "OK" ] && [ "$T429" = "0" ] && [ "$TPE" = "0" ] && [ "$ORCH" = "0" ] && [ "$CH" = "True" ] && [ "$ADVOK" = "1" ] && step 4 tests PASS "$DET" || step 4 tests FAIL "$DET (runner failures=$F)"
echo "[GATE] done"
