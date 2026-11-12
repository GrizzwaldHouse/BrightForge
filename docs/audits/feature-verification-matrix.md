# Feature Verification Matrix (Phase 06)

| Field | Value |
|---|---|
| Commit | `b7a6ef5` (`brightforge-test:local`, `sha256:722cc68a…`; app code identical to `ed7bfca`) |
| Where | Linux cloud container. Server in Docker on an internal network (no internet; checked: outbound DNS fails with `EAI_AGAIN`), read-only root, non-root, `cap_drop: ALL` |
| Model | Fake Ollama returning a fixed plan (`test/clean-room/sidecar.mjs`). **No real inference** |
| Browser | Headless Chromium (Playwright); all hosts except the server blocked (the page tried `fonts.googleapis.com` and `ui-avatars.com`) |
| Evidence | `docs/audits/evidence/phase-06-07/` (`tabs.json`, `chat.json`, `features.json`, `idle-*.json`, screenshots) |

Verdicts: **PASS** works with the evidence shown · **FAIL** defect reproduced · **FAKE** reports success it did not achieve, or placeholder · **BLOCKED** needs GPU, hardware, keys or network · **UNKNOWN** not exercised.

All 19 tabs rendered with no page (JavaScript) errors.

| Tab | Verdict | Evidence |
|---|---|---|
| Chat | **PASS (fake model)** | UI: prompt → plan shown → Approve → `hello.txt` written in the chosen project root; `POST /api/chat/turn 202`, SSE stream 200, `POST /api/chat/approve 200`; one call reached the fake model. Real inference UNVERIFIED |
| Design | **FAIL** | `POST /api/design/generate` → 500 `this.llmClient.generate is not a function` (`src/core/design-engine.js:193`; the client has `chat()`). Image providers also need network |
| Forge3D | **BLOCKED** | UI states "GPU not available"; `POST /api/forge3d/generate` → 503 `Missing Python packages (need: fastapi, diffusers, trimesh, Pillow, pynvml)` (Node image has no Python stack by design) |
| Scene | **FAIL** (error path) | Pipeline failed at `analyze_scene` (fake model returns no JSON: expected), but the scene record stays `analyzing` forever; the UI never shows the failure. Happy path UNKNOWN |
| World | **FAIL** (error path) | Same: pipeline failed at `parse_world_prompt`; record stays `generating` |
| Gameplay | **FAIL** | `GET /api/prototype/:id` → 500 on every poll: `forge3dDb.getPrototypeNPCs is not a function` (`src/api/routes/prototype.js:167`; the database exposes `getNPCsByPrototype`). Pipeline also left the record `generating` after failing at `generate_npcs` |
| Playtest | **BLOCKED** by Gameplay | `POST /api/playtest/run` → 400 `Prototype is not complete` |
| Pipeline (agents) | **FAKE** | `POST /api/agents/pipeline/start` → `status: completed` in 2 s while all four subtasks stay `pending`; reviewer score 83 alongside a critical finding "1 test(s) failed" for `src/generated/…js` |
| Pipeline Tasks | PASS | Renders empty state, polls status |
| Debug | PASS | Live heap/RSS figures from the server |
| Security | PASS (render) / UNKNOWN (scan) | Watcher "Stopped"; `POST /api/security/scan` without `directory` → 400 (validation works); scan itself not run |
| Recorder | **BLOCKED** | OBS not present; UI shows "Disconnected" honestly |
| Stability | UNKNOWN | 13-minute run not started; `test-stability-quick` passes in the suite |
| Agents (health) | PASS | Renders; "No provider activity yet" before chat |
| Health | PASS (idle) | 26.7 requests/min idle, no errors. 429s only during rapid tab switching (see adversarial report A7) |
| Sessions | **FAKE** (placeholder) | Tab text: "Session history and management coming soon…" although `GET /api/sessions` works |
| Orchestration | PASS | `GET /api/orchestration/agents` returns the registered agents. During rapid switching it showed "Failed to load agents" because of 429s |
| Integrations | **BLOCKED** | Firecrawl needs `FIRECRAWL_API_KEY` and network |
| Models | PASS | Instant scan completed in the container (1 file, 0 runtimes, 0 volumes) |

Server log also shows `[EVENT-BUS] Failed to persist event …: FOREIGN KEY constraint failed` for every scene/world/prototype pipeline event (adversarial report F6).
