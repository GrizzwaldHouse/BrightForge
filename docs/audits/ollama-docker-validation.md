# Ollama and Docker Validation

| Field | Value |
|---|---|
| Commit tested | `733f6439091f18c3895a90aa7240a7ccae538c2f` |
| Docker | Engine 29.8.2, BuildKit, cgroup v1 (Linux container) |
| `docker compose config -q` | exit 0 |
| Base images (pinned) | `node:20-bookworm-slim@sha256:2cf067cf…` (server), `node:20-bookworm@sha256:8f693eaa…` (tests), `python:3.11-slim@sha256:673719e0…` |

## 1. Images built

Build command:

```
docker build --target <stage> -t brightforge-<stage>:local .
```

In this sandbox the build also needed `--network host`, `--secret id=extra_ca,…` and proxy build args. Those are environment-specific and are not part of the Dockerfile defaults.

| Target | Exit | User | Size | Image ID |
|---|---|---|---|---|
| `node-server` | 0 | `node` | 412 MB | `sha256:07b4af0b…` |
| `test` | 0 | `node` | 2.11 GB | `sha256:96353321…` |
| `python-test` | 0 | `tester` | 297 MB | `sha256:b1295d68…` |
| `python-server` (GPU) | **not built** | root | — | Needs CUDA base image and GPU host |

`node-server` could not be built on the baseline: `.dockerignore` removed `package-lock.json`, so `npm ci` failed. It builds after `733f643`.

Checks:
- The image history (`docker history --no-trunc`) contains no proxy URL or CA material.
- `/app` contains no certificate files, and `/run/secrets` does not exist at run time.

## 2. Hardening of the test profiles

| Requirement | `brightforge-test` | `brightforge-python-test` | `brightforge-ollama-test` |
|---|---|---|---|
| Non-root user | `node` (uid 1000) | `tester` (uid 1000) | `node` |
| Privileged | no | no | no |
| Docker socket mount | none | none | none |
| Host filesystem mounts | none (source baked into image) | none | none |
| Root filesystem | read-only | read-only | read-only |
| Writable paths | tmpfs: `/tmp` 512m, `data` 256m, `sessions`/`logs`/`output` 64m, `qa-reports`/`.claude` 16m | tmpfs `/tmp` 256m | tmpfs `/tmp`, `data`, `logs`, `.claude` |
| Network | `none` | `none` | bridge (must reach host Ollama) |
| Capabilities | `cap_drop: ALL`, `no-new-privileges` | same | same |
| Limits | 2 CPU, 2 GB, 512 PIDs; 300 s per script | 1 CPU, 1 GB, 256 PIDs | 1 CPU, 1 GB, 256 PIDs |
| API keys | none passed | none | none (only `OLLAMA_*`) |
| GPU | not required | not required | not required |

The read-only root filesystem caught real defects: self-tests were writing into tracked files (`test/sample-llm-output.txt`, `defaults/`). Both are fixed in `34e1ebd`.

## 3. Test runs

| Run | Command | Exit | Result |
|---|---|---|---|
| Deterministic Node suite | `docker compose --profile test run --rm --no-deps brightforge-test` | 0 | 86/86 scripts passed |
| Python mesh tests | `docker compose --profile test run --rm --no-deps brightforge-python-test` | 0 | 4/4 tests OK |
| Ollama profile | `docker compose --profile ollama run --rm --no-deps brightforge-ollama-test` | 0 | 17/17 deterministic checks passed; live step **skipped** (see below) |

## 4. Ollama integration

| Requirement | Implementation | Evidence |
|---|---|---|
| Optional external service | Ollama is never required by the default suite; the deterministic tests use an in-process fake that speaks `/api/tags` and `/v1/chat/completions` | `npm run test-llm-contract` (also run by `npm run test-llm`) |
| Configurable model | `OLLAMA_MODEL` overrides code/fast/default routing; `OLLAMA_BASE_URL`, `OLLAMA_TIMEOUT_MS` | Contract test section [1] |
| Health check and timeout | `getOllamaHealth({ timeoutMs })` returns running, installed models, configured model present | Contract test section [2] |
| Never pulls models | Health and live checks only call `/api/tags` and the completion endpoint; the test asserts no `/api/pull` request | Contract test: "health never pulls a model" |
| Server unavailable | Network error, reported as not running | Contract test sections [2] and [3] |
| Missing model | 404 surfaced as an explicit error | Contract test section [3] |
| Timeout | Request aborted within the limit; a caller `AbortSignal` no longer disables the timeout | Contract test section [3] |
| Malformed output | Non-JSON or choice-less responses raise "malformed response" errors (previously returned empty content) | Contract test section [3] |
| Successful local inference | Against the fake: content returned, cost 0 | Contract test section [3] |
| Live inference (opt-in) | `npm run test-ollama-live` or the compose `ollama` profile; runs only if the model is already installed | **NOT VERIFIED**: no Ollama reachable from this environment (`running=false`, live step skipped) |
| Model output never executes commands | The LLM client returns text only. Plan application goes through the plan review/approval flow, and generated tests run through `src/security/sandbox.js` (no shell) | Code inspection. Isolation of generated code is a remaining risk (security report R3) |

### Running the live check on a workstation

```bash
ollama list                                   # confirm the model is installed (do not pull in tests)
OLLAMA_MODEL=llama3:8b npm run test-ollama-live
# or, containerised (host Ollama):
OLLAMA_MODEL=llama3:8b docker compose --profile ollama run --rm brightforge-ollama-test
```

Live results are reported in their own `[LIVE]` section and are never counted towards the deterministic suite.

## 5. GPU profile

Not exercised. The existing `python` service (`python-server` target, CUDA 12.4 base) is unchanged apart from loopback-only port publishing.

Recommended first GPU run on the PowerSpec host, after the CPU suite passes:
1. `docker compose build python`
2. Verify `nvidia-smi` inside the container without `privileged`.
3. Run one small generation and verify the GLB with the checks in `python/tests/test_mesh_postprocess.py`.
