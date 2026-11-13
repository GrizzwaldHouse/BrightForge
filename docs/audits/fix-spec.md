# Fix Spec: pending issues after Phase 06-07

| Field | Value |
|---|---|
| Base | `repair/p0-recovery-2026-10` at `6aa6efa` |
| Method | Spec first. Each requirement has an acceptance test that fails before the change and passes after. Reviewed by an independent agent, then run through the build gate |
| Sources | `adversarial-report.md` (F1-F9), `feature-verification-matrix.md`, `security-and-repository-hygiene.md`, the Phase 06-07 validation notes |

## Requirements

| ID | Requirement | Acceptance test | Likely files |
|---|---|---|---|
| R-A1 (F7) | Normal dashboard use must not hit the 60/min general limit. Loopback peers get a higher limit; remote peers keep 60/min. Switching through all tabs in 60 s yields no 429 | Browser tab sweep: 0 responses with 429 on a fresh server. Unit test for the limiter keyed on peer address | `src/api/middleware/rate-limit.js`, `config/agent-config.yaml` |
| R-A2 (F9) | The `x-brightforge-test` header skips rate limits only when `NODE_ENV=test` | Test: header from loopback is limited when `NODE_ENV` is unset, skipped when `NODE_ENV=test` | `src/api/middleware/rate-limit.js`, test harness `up.sh` (set `NODE_ENV=test` where the suite needs it) |
| R-A3 (F8) | On SIGTERM/SIGINT the server stops accepting connections, lets in-flight requests finish for up to 10 s, then exits 0. A request pending at shutdown gets its response | Test: start server, begin a delayed request, send SIGTERM, assert the response arrives and exit code is 0 | `bin/brightforge-server.js`, `src/api/server.js` |
| R-B1 | `GET /api/prototype/:id` returns the real `pipelineStatus`. The prototypes table stores `pipeline_id` (new migration) and `updatePrototype` persists it | Test: after generate, record has `pipeline_id`; status endpoint returns non-null `pipelineStatus` while the runner entry exists. Migration applies on a fresh DB and on an existing one | `src/forge3d/database.js`, `src/api/routes/prototype.js` |
| R-B2 (F6) | Pipeline events persist without `FOREIGN KEY constraint failed` | Test: run a pipeline with a failing stage; server log has no FK error; events table has the rows | `src/orchestration/event-bus.js`, `src/orchestration/storage.js` |
| R-C1 | Design generation reports partial failure: if any image fails the response includes `warnings` and `imagesFailed`; if all fail it returns a non-2xx with a clear error, never `success:true` with 0 images and no explanation | Test with a fake image client that fails: 502 (all fail) / 200 + warnings (some fail) | `src/core/design-engine.js`, `src/api/routes/design.js` |
| R-C2 | Design code generation routes through a task that exists in `config/llm-providers.yaml` (`code_generation`) | Test: `chat()` receives `task: 'code_generation'`; the key exists in the YAML | `src/core/design-engine.js` |
| R-C3 | `PlanEngine.validate` and `DiffApplier` agree on absolute plan paths: both treat `/x.txt` as relative to the project root (contained) or both reject it. Choose "contained, relative to root" | Test: validate accepts `/abs.txt` and apply writes inside the root; `../x` is rejected by both | `src/core/plan-engine.js`, `src/core/diff-applier.js` |
| R-D1 (F5) | Agent pipeline status is derived from its subtasks. `completed` only if every subtask completed; a critical review finding or failed test makes the pipeline `failed` with the reason. Subtask statuses update as agents run | Test: stub agents; pipeline with a failing tester ends `failed`, subtasks show completed/failed rather than all `pending` | `src/agents/*`, `src/api/routes/agents.js` |
| R-E1 | Orchestration panel does not throw `this.agents.map is not a function`; it accepts both an array and `{agents: []}` responses | Browser test: tab renders with 0 page errors against the real API | `public/js/orchestration-panel.js` |
| R-E2 | Sessions tab shows the real session list from `GET /api/sessions`, not "coming soon" | Browser test: after a chat turn, the Sessions tab lists that session | `public/js/*` (sessions), `public/index.html` |

## Out of scope for this round (tracked)

- R1 dashboard token flow when `BRIGHTFORGE_API_KEY` is set; R2 request-chosen `projectRoot`; CSP; the builder agent's simulated output.
- GPU generation and the on-screen 3D render (needs the PowerSpec; see `powerspec-3d-render-runbook.md`).
- Python dependency gaps (`numpy`, `hy3dgen`, `requests`, cu128 PyTorch) and the Node 22 mismatch for Firecrawl.

## Workstreams (disjoint file ownership so agents do not collide)

| Stream | Requirements | Owns |
|---|---|---|
| A: server | R-A1, R-A2, R-A3 | `src/api/middleware/rate-limit.js`, `bin/brightforge-server.js`, `src/api/server.js`, `config/agent-config.yaml` |
| B: data | R-B1, R-B2 | `src/forge3d/database.js`, `src/api/routes/prototype.js`, `src/orchestration/*` |
| C: core | R-C1, R-C2, R-C3 | `src/core/design-engine.js`, `src/api/routes/design.js`, `src/core/plan-engine.js`, `src/core/diff-applier.js` |
| D: agents | R-D1 | `src/agents/*`, `src/api/routes/agents.js` |
| E: dashboard | R-E1, R-E2 | `public/js/*`, `public/index.html` |

Each stream adds its tests to its own new file under `src/tests/` (named `fix-<stream>-*.js`) and a `test-fix-<stream>` npm script, so streams do not edit the same test file or `package.json` lines in conflicting ways (the integrator resolves `package.json`).

## Build gate (adapted from the verified-build-gate skill)

The skill assumes `npm run build`, Vitest and Playwright npm scripts that BrightForge does not have. Equivalents used here:

| Gate step | BrightForge equivalent |
|---|---|
| 1 Build | `npm run lint` plus Docker image build of the `test` target |
| 2 Launch runtime | Server container on the internal Docker network; `GET /api/health` within 60 s |
| 3 Stability (5 min) | Health every 30 s, memory growth under 50 %, no unhandled errors in the log, WebSocket stays connected |
| 4 Tests | Deterministic suite (all `test-*` scripts), the new `test-fix-*` and `test-clean-room-fixes`, Python tests, browser tab sweep, adversarial script |
| 5 Reviewer | Independent read-only agent given only the diff, spec, logs and results; outputs APPROVED or REJECTED |
| 6 Final | `build-gate-report.json` with READY / NOT READY. Any failure means NOT READY |

## Round 2 (from the code review of `1590e5f..eec3ed2`)

| ID | Requirement | Acceptance test | Owns |
|---|---|---|---|
| R2-F1 (security) | No code path reads a file outside the project root because of a plan path. `MasterAgent` (and any other place that loads `op.original` for a diff, e.g. `web-session.js`) uses the same containment check as `DiffApplier`; an escaping operation gets no `original`/`diff` content and is marked refused | Test: plan with `## FILE: ../secret.txt` / `ACTION: modify` where the file exists outside the root: the returned plan contains none of its bytes | `src/agents/master-agent.js`, `src/api/web-session.js`, `src/core/diff-applier.js` (export the helper) |
| R2-F2 | A plan whose operations were all refused for containment ends with status `refused` (not `partial`), with the refusal reasons in `errors`; no rollback entry is offered. `resolveInsideRoot` accepts paths under a filesystem root (`/`, `C:\`) | Tests: all-refused plan -> `refused`; root `/` with `a.txt` -> allowed | same as R2-F1 |
| R2-G1 | Agent pipeline runs are isolated: each run holds its own state object; a cancelled run never writes to a newer run's state; a cancelled run stays `cancelled` (the catch block does not overwrite it with `failed`) | Test: start, cancel, start again with stub agents; the first run's late completion does not change the second run's subtasks or status | `src/api/routes/agents.js` |
| R2-H1 | Pipeline events keep a valid integrity hash and stay queryable: the asset pipeline runner passes its orchestration task id (`orchTaskId`) as `taskId`, so `insertEvent` no longer rewrites ids; keep a defensive fallback that never changes a hashed field | Test: emitted pipeline event stored with the orchestration task id; `verifyIntegrity` on the reloaded row is true | `src/forge3d/pipeline/asset-pipeline-runner.js`, `src/orchestration/storage.js` |
| R2-H2 | Terminal-status handling lives in one place: `assetPipelineRunner.start(name, ctx, { onFailed })` (or a runner-level hook) replaces the three copied listener blocks; if `_execute` rejects, `pipeline_failed` is emitted so the record becomes `failed`; no listener accumulates per request | Tests: `_execute` rejection -> record `failed`; 20 generate requests leave the runner's listener count unchanged | `src/forge3d/pipeline/asset-pipeline-runner.js`, `src/api/routes/{scene,world,prototype}.js` |
| R2-H3 | Migration v12 is idempotent: it adds `pipeline_id` only if the column is missing, and a re-run after partial application succeeds | Test: run migrations on a DB that already has the column but no v12 row: opens without error | `src/forge3d/database.js` |
| R2-I1 (amends R-C1) | If every image fails, design generation still produces the layout (local-first, text-only design must work offline) and returns 200 with `imagesRequested`, `imagesFailed`, `warnings`; it returns 502 only when the layout itself fails. Partial image failure behaves the same way. `success` is never true without the warnings when an image failed | Tests: all images fail + layout ok -> 200, html present, `imagesFailed == imagesRequested`, warnings set; layout throws -> 5xx | `src/core/design-engine.js`, `src/api/routes/design.js` |
| R2-I2 | Dashboard: do not reload sessions on SSE `complete` (sessions are only written on approve/reject); remove the dead `switchSession`/`addSession`/`isActive` code; escape session fields rendered into `innerHTML` | Tests: no `/api/sessions` request on `complete`; rendered list escapes `<script>` in a session id | `public/js/app.js`, `public/js/session-manager.js` |

