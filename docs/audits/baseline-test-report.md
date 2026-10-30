# Baseline and Final Test Report

| Field | Baseline | Repair branch (final) |
|---|---|---|
| Commit | `16c98f2553dd9e90351dca02910e74fd88851224` | `733f6439091f18c3895a90aa7240a7ccae538c2f` (code), plus this documentation commit |
| Environment | Linux host, Node v22.22.0, `npm install` (`npm ci` fails on this commit) | Docker `brightforge-test:local` (`node:20-bookworm@sha256:8f693eaa…`), Node v20.20.2, `npm ci` |
| Isolation | Disposable `git archive` copy | Compose profile `test`: `network_mode: none`, read-only root, tmpfs, `cap_drop: ALL`, `no-new-privileges`, 2 CPU / 2 GB / 512 PIDs |
| Runner | `node src/tests/run-deterministic-suite.js` (same runner for both) | `docker compose --profile test run --rm --no-deps brightforge-test` |
| Result | **66/78 passed, 12 failed** (exit 1) | **86/86 passed, 0 failed** (exit 0) |

The runner marks a script failed if it exits non-zero, or if its output is the self-healing suite's banner when that is not the suite it was asked to run.

**The baseline numbers overstate health.** On the baseline, failed `console.assert` calls cannot fail a test (fixed in `34e1ebd`). The baseline also has 8 fewer scripts, because the regression tests added in this branch did not exist yet.

## 1. Baseline failures (`16c98f2`)

| Script | Result | Cause |
|---|---|---|
| `lint` | exit 1 | `public/js/integrations-panel.js:400` parse error (corrupt rescued file) |
| `test-llm`, `test-design`, `test-conversation`, `test-api`, `test-forge-session`, `test-queue`, `test-scene-analyzer`, `test-world-analyzer`, `test-npc-generator`, `test-interaction-generator`, `test-quest-generator` | exit 0, but the **wrong suite ran** (`[HEALING] 17 passed`) | Unguarded `--test` block in `self-healing-orchestrator.js` ran on import and exited |

Other baseline checks run directly:

| Check | Baseline result |
|---|---|
| `npm ci` | exit 1: `Missing: @mendable/firecrawl-js@1.29.3 from lock file` |
| Guard check (`src/tests/selftest-guard-check.js`) | 121 bare guards; 37 modules ran or exited on import |
| `test-security` | 11 passed, **8 failed**: LAN reachable, no refusal, `/api/health` 401 with key, remote peer allowed, 2 injection payloads 200, **sentinel file created** |
| `test-events-queue` | 6 passed, **3 failed**: dead-letter timeout, no bridged event, payload |
| `test-mesh-flow` | 3 passed, **5 failed**: exported bytes = unoptimised input (sha256 `4256360e…`) |
| `test-frontend-routes` | **fail**: `/api/projects/search` has no route |
| `test-forge3d-e2e` (live server) | 4 passed, **1 failed**: `Missing deadLetterCount field` |
| Python `python/tests` (`python:3.11-slim`, trimesh 5.2.0) | **3 of 4 failed**: optimise fails (`fast_simplification` missing, then the `percent` argument), skip path writes no file |
| Three.js asset URLs | 3 of 3 script URLs do not exist in `three@0.171.0` (checked against the npm package file list) |

## 2. Final results (repair branch, Docker)

All 86 scripts passed. Durations are from the container run.

- **Core self-tests:** `lint`, `test-llm`, `test-plan`, `test-context`, `test-diff`, `test-session`, `test-terminal`, `test-image`, `test-image-suite`, `test-design`, `test-history`, `test-conversation`, `test-multi-step`, `test-api`, `test-skills`, `test-sandbox`, `test-failure-classifier`, `test-healing`.
- **Forge3D, scene and world:** `test-bridge`, `test-forge-session`, `test-forge-db`, `test-project-manager`, `test-queue`, `test-downloader`, `test-config`, `test-monitor`, `test-multi-model`, `test-pipeline`, `test-scene-graph`, `test-scene-analyzer`, `test-scene-routes`, `test-world-graph`, `test-world-analyzer`, `test-npc-generator`, `test-interaction-generator`, `test-quest-generator`, `test-logic-builder`, `test-biome-generator`, `test-streaming-layout`, `test-world-routes`, `test-prototype-routes`, `test-quest-solver`, `test-path-analyzer`, `test-agent-simulator`, `test-balance-analyzer`, `test-playtest-routes`.
- **Orchestration and agents:** `test-orch-db`, `test-event-bus`, `test-task-state`, `test-supervisor`, `test-handoff`, `test-orchestrator`, `test-ws-bus`, `test-planner`, `test-builder`, `test-tester`, `test-reviewer`, `test-survey`, `test-recorder`, `test-integration`, `test-stability-quick` (60 s).
- **Idea, model intelligence and integrations:** `test-idea-*` (7), `test-model-config`, `test-model-db`, `test-model-events`, `test-model-scanner`, `test-model-writer`, `test-model-intel`, `test-model-router`, `test-generate-defaults`, `test-firecrawl`, `test-model-sync`.
- **New regression tests:** `test-selftest-guard`, `test-security`, `test-bind-policy`, `test-events-queue`, `test-frontend-assets`, `test-mesh-flow`, `test-frontend-routes`, `test-llm-contract`.

Python (`brightforge-python-test`, network none, read-only):

```
python -m unittest discover -s python/tests -v
Ran 4 tests ... OK
```

Headless browser (Chromium 1194 + playwright-core, scratch environment, not committed):
- The real dashboard loaded and the cube fixture rendered through `Forge3DViewer`: 24 vertices, 12 triangles, 50471 of 120000 pixels non-background, 73 Lucide icons.
- Only console error: a blocked third-party avatar request (`ui-avatars.com`).
- Screenshot: `docs/audits/viewer-render-evidence.png`.

## 3. Scripts excluded from the deterministic run (and why)

These are listed in `EXCLUDED` in `src/tests/run-deterministic-suite.js` and appear in every report JSON.

| Script | Reason | Status |
|---|---|---|
| `test-forge3d-e2e` | Needs a running server and the Python bridge | Run separately before the fix: 4/5 (dead-letter). The dead-letter path is now covered by `test-events-queue`. **Full e2e with generation: NOT RUN** (no GPU) |
| `test-load*`, `test-load-smoke` | Need a running server | Not run in this session |
| `test-stability` | 13-minute soak | Not run (quick variant passes) |
| `test-visual`, `test-visual-headed` | Python Playwright and a display | Not run; replaced by the scratch Chromium check above |
| `test-fbx-converter`, `test-python-mesh` | Python | `python/tests` run in the `python-test` image. **FBX conversion: NOT TESTED** (no pyassimp/Blender) |
| `test-model-scanner-py` | Windows-only `py` launcher | **NOT TESTABLE** here |
| `test-ollama-live` | Opt-in live Ollama | Profile run: server not reachable, live step skipped (see `ollama-docker-validation.md`) |
| aggregates (`test-all-core`, `test-agents`, `test-idea`) | Members run individually | n/a |

## 4. Unverified capabilities

| Capability | Status |
|---|---|
| GPU generation (SDXL, Hunyuan3D, Shap-E), real text→image→mesh | **UNVERIFIED**: no GPU, no torch in this environment |
| Mesh optimisation through the real FastAPI endpoint | Python function tested directly; Node↔Python HTTP path tested with a fake server only |
| FBX export (pyassimp / Blender) | **UNVERIFIED** |
| Live LLM providers (Groq, Gemini, Claude, OpenAI, …) | **UNVERIFIED**: no keys; routing, budget and error handling tested against a fake provider |
| Live Ollama inference | **UNVERIFIED**: no Ollama server reachable |
| Windows-specific behaviour (desktop launcher, `py` discovery, path handling on `C:\`) | **UNVERIFIED** |
| Dashboard with `BRIGHTFORGE_API_KEY` set | **Known broken** (UI sends no token); see the security report, R1 |
| CI on GitHub Actions | Not observed for this branch (workflows target `main` push/PR) |
