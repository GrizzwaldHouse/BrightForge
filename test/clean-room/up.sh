#!/bin/bash
# Start the server + sidecar on an internal (no-internet) Docker network.
set -e
H=$(dirname "$0"); EXTRA_ENV="$@"
docker rm -f bf-server bf-sidecar >/dev/null 2>&1 || true
docker network inspect bf-int >/dev/null 2>&1 || docker network create --internal bf-int >/dev/null
docker run -d --name bf-server --network bf-int --read-only --user node \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 512 --memory 2g --cpus 2 \
  --tmpfs /tmp:size=512m,mode=1777 --tmpfs /app/data:size=256m,uid=1000,gid=1000 \
  --tmpfs /app/sessions:size=64m,uid=1000,gid=1000 --tmpfs /app/logs:size=64m,uid=1000,gid=1000 \
  --tmpfs /app/output:size=64m,uid=1000,gid=1000 --tmpfs /app/.claude:size=16m,uid=1000,gid=1000 \
  -e OLLAMA_TIMEOUT_MS=8000 -e OLLAMA_MODEL=fake:1b -e OLLAMA_BASE_URL=http://127.0.0.1:11434 $EXTRA_ENV \
  brightforge-test:local node bin/brightforge-server.js >/dev/null
docker run -d --name bf-sidecar --network container:bf-server --read-only --user node \
  --cap-drop ALL --security-opt no-new-privileges:true --memory 256m \
  -v "$H/sidecar.mjs:/h/sidecar.mjs:ro" brightforge-test:local node /h/sidecar.mjs >/dev/null
IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "bf-int").IPAddress}}' bf-server)
for i in $(seq 1 60); do curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://$IP:8080/api/health 2>/dev/null | grep -q 200 && break; sleep 1; done
echo "$IP"
