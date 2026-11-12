# Clean-room harness (Phases 06 and 07)

Test-only tooling. Nothing here is loaded by the application.

| File | Purpose |
|---|---|
| `up.sh` | Starts `brightforge-test:local` as the server on an internal Docker network (`--internal`: no internet), read-only root, tmpfs, all capabilities dropped, plus `sidecar.mjs` in the same network namespace. Extra `-e` flags are passed to the server |
| `sidecar.mjs` | TCP forwarder `0.0.0.0:8080 -> 127.0.0.1:3847` (so the loopback-only server is reachable) and a fake Ollama on `127.0.0.1:11434`. Modes via `/__mode/<ok|slow|malformed|empty|http500|garbage|traversal|absolute>` |
| `tabs.cjs` | Playwright: clicks every `[data-tab]`, records `/api` calls, console and page errors, panel text, screenshot. Blocks every non-server host |
| `chat.cjs` | Playwright: chat plan -> approve -> apply through the UI; with a seconds argument (and optional tab), measures idle polling |
| `features.mjs` | Starts each workflow through the API (scene, world, prototype, playtest, agent pipeline, design, model scan, security scan, Forge3D) |
| `adversarial.mjs` | Input validation, unsafe plan paths, provider failures and timeouts, cancel, SSE disconnect, concurrent sessions, rate limits, bounded load, headers |

Run (needs Docker and the `test` image built from the same commit; the browser and Node scripts run on the Docker host):

```bash
./up.sh                                   # prints the server IP, e.g. 172.18.0.2
node tabs.cjs http://172.18.0.2:8080/ ./out
node chat.cjs http://172.18.0.2:8080/ ./out
node chat.cjs http://172.18.0.2:8080/ ./out 90 health
node features.mjs http://172.18.0.2:8080 ./out
node adversarial.mjs http://172.18.0.2:8080 ./out
docker rm -f bf-server bf-sidecar
```

All model output is fake. A pass here does not show that real inference works.
