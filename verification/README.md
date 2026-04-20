# BrightForge Phase 2 Verification Harness

This directory contains the PowerShell-based verification harness that runs the Phase 2 QA pass against a real BrightForge server. No mocks. No stubs. Real HTTP, real Python bridge if requested.

## What it does

Running `Invoke-Phase2Verification.ps1` performs the following, in order:

1. Rebuilds `better-sqlite3` for the current Node ABI so the native module actually loads.
2. Optionally starts the Python inference bridge (`python\inference_server.py`) with `-StartBridge`.
3. Starts the server via `npm run server`, capturing stdout and stderr to separate log files.
4. Polls `GET /api/health` until it reports `200` or until the 60 s readiness window elapses.
5. Runs the four Phase 2 UI flows as real HTTP calls:
   - Scene generation (`GET /api/scene/list`, `POST /api/scene/generate`)
   - World generation (`GET /api/world/list`, `POST /api/world/generate`)
   - Forge3D (15 read endpoints + `POST /api/forge3d/generate`)
   - Orchestration pipeline (status, task, tasks, agents + `/api/pipelines/templates` + `/api/pipelines/run`)
6. Records, per request: `method`, `url`, `status`, `durationMs`, `attempts`, `timedOut`, `hung`, `error`, `bodySummary`.
7. Emits a structured JSON report at `verification/report.json` (and a dated copy under `verification/phase2-YYYYMMDD-HHMMSS/report.json`).
8. Stops the server and the Python bridge.

## Fail-fast behavior

The harness flags a test as `fail` when any of the following hits:

- `status == 500`
- `status == 0` (no response received)
- `timedOut == true`
- `hung == true` (single attempt took >= `hangWarningSeconds`)
- `status` not in the per-endpoint accepted list

With `-Strict`, the harness throws on the first failure so CI can gate on a single red signal instead of finishing the full battery.

The overall exit code is `0` when every flow passes and `2` when any failed, which matches typical CI gate conventions.

## 429 retry logic

HTTP 429 responses are retried up to 4 times with exponential backoff (500 ms, 1 s, 2 s). Other non-2xx responses are terminal for that call — rate limiting is the only retryable failure mode, because retrying a 500 or a hang would just mask the bug.

## Usage

```powershell
# Minimum: rebuild sqlite, start server, run every flow, write JSON report
pwsh -File .\verification\Invoke-Phase2Verification.ps1

# Strict mode (halt on first failure — good for CI gates)
pwsh -File .\verification\Invoke-Phase2Verification.ps1 -Strict

# Also spin up the Python inference bridge so the Forge3D pipeline
# has a real downstream target (required if you want the full F-06 path to pass)
pwsh -File .\verification\Invoke-Phase2Verification.ps1 -StartBridge

# Keep the server running after tests for manual exploration
pwsh -File .\verification\Invoke-Phase2Verification.ps1 -NoShutdown
```

## Output layout

```
verification/
  report.json                              <- latest run, always overwritten (what CI reads)
  phase2-20260418-160000/
    report.json                            <- dated, permanent copy
    server.pid
    stdout.log
    stderr.log
    bridge-stdout.log                      <- only when -StartBridge
    bridge-stderr.log                      <- only when -StartBridge
    npm-rebuild.log
    responses/
      scene-list.json
      scene-generate.json
      world-list.json
      world-generate.json
      f3d-api_forge3d_bridge.json
      ...
      orch-status.json
      orch-task.json
      pipes-templates.json
      pipes-run.json
```

## Report schema

```jsonc
{
  "runId":        "phase2-20260418-160000",
  "generatedAt":  "2026-04-18T16:00:00.000Z",
  "node":         "v22.22.0",
  "port":         3847,
  "baseUrl":      "http://localhost:3847",
  "strictMode":   false,
  "pythonBridge": { "requested": false, "pid": null, "running": false },
  "health":       { "ready": true, "readyAfterMs": 3200, "status": 200, "body": {...} },
  "summary":      {
    "total":     24,
    "passed":    18,
    "failed":    6,
    "hung":      2,
    "timedOut":  2,
    "serverErr": 3,
    "guard503":  1
  },
  "flowSummaries": {
    "scene":         { "total": 2, "passed": 0, "failed": 2 },
    "world":         { "total": 2, "passed": 0, "failed": 2 },
    "forge3d":       { "total": 16, "passed": 12, "failed": 4 },
    "orchestration": { "total": 6, "passed": 6, "failed": 0 }
  },
  "results": [
    {
      "flow":        "scene",
      "label":       "POST /api/scene/generate",
      "method":      "POST",
      "url":         "/api/scene/generate",
      "status":      500,
      "verdict":     "fail",
      "reason":      "server returned 500",
      "durationMs":  45.2,
      "attempts":    1,
      "timedOut":    false,
      "hung":        false,
      "error":       null,
      "bodySummary": "{\"error\":\"Internal server error\",\"errorId\":\"...\"}"
    },
    ...
  ],
  "logs": { "stdout": "...", "stderr": "...", "responses": "...", "runDir": "..." }
}
```

## What this harness does *not* do

- No browser automation. The dashboard is a single-page static HTML with JS that only calls these same HTTP endpoints, so driving the endpoints directly exercises the same code paths. If you want headless Chrome screenshots on top, wrap this script in a second pass using Puppeteer or Playwright.
- No Ollama / cloud LLM provisioning. Scene/World/Forge3D pipelines that require an LLM will run against whatever you have configured in `.env.local`.
- No Python venv creation. `-StartBridge` assumes the Python environment under `python\` is already installed per `INSTALL.md`.
