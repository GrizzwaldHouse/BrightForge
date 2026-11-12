# Adversarial and Load Report (Phase 07)

Same isolated setup as `feature-verification-matrix.md`. Script: `test/clean-room/adversarial.mjs` (results in `evidence/phase-06-07/adversarial.json`). Bounded load only (300 requests); no 1000-user tests.

## Findings (new)

| ID | Severity | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| F1 | **High** | **Model output can write outside the project.** A plan line `## FILE: ../escape.txt` is flagged by validation (`Security error: … attempts to escape project root`) but approving still writes `/tmp/escape.txt`. Validation results are only logged: `web-session.approvePlan`, `master-agent.js:213` (warning only) and `agentApply` (validates without a project root). `DiffApplier` joins paths with no containment check (`src/core/diff-applier.js:54,179`). On Windows the same pattern could reach the Startup folder. Absolute paths are contained (joined under the root) | Approve → 200 `applied`; file present at `/tmp/escape.txt` | Enforce containment inside `DiffApplier` (resolve and compare with a trailing separator), refuse plans with validation errors in all three paths, add a regression test |
| F2 | High (functional) | Gameplay status endpoint always fails: `forge3dDb.getPrototypeNPCs is not a function` | 500 on every `GET /api/prototype/:id` | Call `getNPCsByPrototype` (and check the quest/interaction calls next to it) |
| F3 | Medium | Design generation broken: `this.llmClient.generate is not a function` | 500 from `POST /api/design/generate` | Use `llmClient.chat()` |
| F4 | Medium | Failed scene/world/prototype pipelines leave records `analyzing`/`generating` forever | DB status after pipeline `FAILED` | Write `failed` + error to the record in the pipeline failure handler |
| F5 | Medium | Agent pipeline reports `completed`, score 83, with all subtasks `pending` and a critical test failure | `GET /api/agents/pipeline/status` | Derive status from subtasks; fail on critical findings |
| F6 | Low–Medium | Event bus cannot persist pipeline events: `FOREIGN KEY constraint failed` | Server log, every pipeline event | Create the referenced task row first, or relax the FK for orphan events |
| F7 | Low | Dashboard trips the 60/min general rate limit during normal tab switching (Health tab fires ~11 calls at once) | 18 responses with 429 in `tabs.json`; idle polling is 15–27/min | Raise the general limit for loopback, or batch panel calls |
| F8 | Low | Shutdown does not drain in-flight requests: a pending chat request got no response | `docker stop` → exit 0 in 1.1 s; client `000` | Stop accepting, wait for in-flight requests with a deadline |
| F9 | Low | Header `x-brightforge-test: true` from loopback skips all rate limits | 200 after the limit was hit | Enable only when `NODE_ENV=test` |

Known risks confirmed: **R1** (dashboard gets 401 on 6 of 8 initial API calls when a key is set), **R2** (request body `projectRoot: /tmp/elsewhere` → file written there), **R6** (no CSP header).

## Checks that passed

| Area | Result |
|---|---|
| Input validation | Missing/numeric message 400; malformed JSON 400 without stack trace; 5 MB body 413; unknown session 400; SQL-like and `../` IDs 404 |
| Revert endpoint | `HEAD`, `HEAD~1..HEAD`, `--help`, 5000-char input, `main` → all 400 |
| Provider failures | Malformed JSON, empty choices, HTTP 500, prose instead of a plan: each reported as an error or `no_changes`, server stays up |
| Provider timeout | Model that never answers → error after 39 s (`OLLAMA_TIMEOUT_MS=8000` plus fallback attempts) |
| Cancel | `POST /api/chat/cancel/:id` → 200 and SSE `cancelled` |
| SSE disconnect | Client aborts mid-stream; server healthy |
| Session isolation | Two concurrent sessions: distinct IDs, each file in its own root, no history mixing |
| Rate limit | 70-request burst: 59 × 200, 11 × 429 |
| Auth (key set, `0.0.0.0` bind) | Remote without key 401; wrong key 401; right key 200; `/api/health` public 200; spoofed `X-Forwarded-For: 127.0.0.1` 401; loopback without key 401; WebSocket without key 401, with key open |
| Load | 300 × `GET /api/health`, 10 concurrent: 0 errors, p50 39 ms, p95 64 ms, max 199 ms |
| Headers | `X-Content-Type-Options: nosniff`, no `X-Powered-By` |
| Isolation | Server container could not reach the internet (DNS `EAI_AGAIN`) |
