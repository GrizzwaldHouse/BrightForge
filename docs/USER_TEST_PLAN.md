# BrightForge — User Test Plan
**Version:** v4.2.0-alpha
**Date:** 2026-04-16
**Server:** http://localhost:3847
**Prereqs:** Ollama running locally with llama3:8b + nomic-embed-text models

---

## How to Use This Plan

Work through each section in order. Each test has:
- **What to do** — exact steps
- **Expected result** — what you should see
- **Pass criteria** — how to mark it done

Mark each test `PASS`, `FAIL`, or `SKIP` (skip if external service not available).

---

## Section 1 — Server Startup & Health

### T1.1 — Dashboard loads
1. Open `http://localhost:3847` in your browser
2. Verify the BrightForge dashboard loads with dark theme
3. Verify tabs are visible: Chat, Health, Design, Forge3D, Sessions

**Pass:** Dashboard renders, no console errors in browser DevTools

---

### T1.2 — System health endpoint
1. Open `http://localhost:3847/api/health`

**Expected:** JSON with `status: "ok"`, `ollamaRunning: true`, budget showing `$0.00` used

**Pass:** Response is valid JSON, ollama shows green

---

### T1.3 — Health panel in dashboard
1. Click the **Health** tab
2. Look for the provider status list

**Expected:** Ollama shows as green/available. All others show red/no API key.

**Pass:** Providers listed, Ollama distinguishable from the others

---

### T1.4 — WebSocket connection
1. Open browser DevTools → Network → WS
2. Reload the page
3. Look for a WebSocket connection to `ws://localhost:3847/ws/events`

**Pass:** WS connection established and stays open (should see ping/pong frames every 30s)

---

## Section 2 — Chat / Code Agent

### T2.1 — Basic code task (single file)
1. Click the **Chat** tab
2. Set project path to `D:/BrightForge/examples/hello-world`
3. Type: `add a comment at the top of README.md that says "Hello BrightForge"`
4. Click Send

**Expected:**
- Response status changes to "generating..."
- SSE progress bar or spinner appears
- A plan appears showing the README.md modification
- Diff shows the added comment line in green

**Pass:** Plan generated, diff visible, approve/reject buttons present

---

### T2.2 — Plan approval
1. Continue from T2.1
2. Review the diff shown
3. Click **Approve**

**Expected:**
- "Applying changes..." message
- Success confirmation
- File `examples/hello-world/README.md` actually changed on disk

**Pass:** File on disk matches what the plan showed

---

### T2.3 — Plan rejection / rollback
1. Send another task: `delete all content from README.md`
2. When plan appears, click **Reject**

**Expected:** Plan discarded, no file changes made

**Pass:** README.md unchanged after rejection

---

### T2.4 — Git checkpoint (rollback)
1. Send a task that modifies a file in `examples/hello-world`
2. Approve the plan
3. Navigate to `GET http://localhost:3847/api/chat/timeline` (or find Timeline in UI)
4. Verify a BrightForge checkpoint commit appears

**Pass:** Timeline shows checkpoint created before/after the change

---

### T2.5 — SSE cancel mid-generation
1. Start a complex task: `refactor all files in the project to use TypeScript`
2. Immediately click **Cancel** before the plan arrives

**Expected:** Generation stops, "Cancelled" status shown

**Pass:** Server stops generating, no plan appears

---

### T2.6 — Cost tracking
1. After completing T2.1, navigate to `http://localhost:3847/api/cost`
2. Verify cost entry shows for the session

**Pass:** Response shows session with cost (likely $0.0000 for Ollama)

---

### T2.7 — Provider upgrade
1. After a plan generates, look for an **Upgrade** button or `POST /api/chat/upgrade`
2. If present, click it

**Expected:** Same prompt re-runs on next-tier provider (would fail gracefully with "no API key" if cloud keys not set)

**Pass:** Either upgrade succeeds or fails with a clear "no API key" message (not a 500 error)

---

## Section 3 — Design Engine

### T3.1 — Image generation (Pollinations)
1. Click the **Design** tab
2. Enter prompt: `futuristic game UI with neon blue theme`
3. Select style: **blue-glass**
4. Click Generate

**Expected:** Image generation starts, Pollinations provider tried first (free, no key needed). Image appears in the Design Viewer after 5-15 seconds.

**Pass:** Image renders in the UI

---

### T3.2 — Design with layout
1. Same as T3.1 but observe if an HTML layout is also generated alongside the image
2. Check `output/designs/` or `data/output/` for generated files

**Pass:** Either an image + HTML layout appears, or image alone with clear status

---

### T3.3 — Design API direct
```bash
curl -X POST http://localhost:3847/api/design/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"dark industrial button component","style":"dark-industrial"}'
```

**Pass:** Response includes `imageUrl` or base64 image data, no 500 error

---

## Section 4 — Project Memory

### T4.1 — Read project memory
```bash
curl http://localhost:3847/api/memory?projectPath=D:/BrightForge/examples/hello-world
```

**Expected:** JSON with `conventions: []`, `techStack: {}` (empty for new project) or auto-detected stack

**Pass:** 200 response, valid JSON structure

---

### T4.2 — Write a convention
```bash
curl -X POST http://localhost:3847/api/memory/convention \
  -H "Content-Type: application/json" \
  -d '{"projectPath":"D:/BrightForge/examples/hello-world","category":"style","convention":"always use single quotes"}'
```

**Pass:** 200 response, convention saved

---

### T4.3 — Memory persists in LLM prompt
1. After saving a convention in T4.2
2. Send a new chat task for the same project
3. Check that the generated plan respects the saved convention

**Pass:** Behavior is consistent with saved preference, OR verify via `GET /api/memory` that it was stored

---

## Section 5 — Forge3D Pipeline

### T5.1 — Projects CRUD
```bash
# Create
curl -X POST http://localhost:3847/api/forge3d/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Project","description":"Test 3D generation"}'

# List
curl http://localhost:3847/api/forge3d/projects
```

**Pass:** Project created with an ID, appears in list

---

### T5.2 — Queue status
```bash
curl http://localhost:3847/api/forge3d/queue
```

**Expected:** `{"paused":false,"processing":false,"queuedCount":0,"jobs":[]}`

**Pass:** Valid JSON, no errors

---

### T5.3 — Bridge status
```bash
curl http://localhost:3847/api/forge3d/bridge
```

**Expected:** Bridge state shows (likely "starting" or "stopped" if Python GPU server not running — this is expected)

**Pass:** Response returns bridge state without 500 error

---

### T5.4 — 3D generation attempt (requires Python server)
**SKIP if Python inference server not running.**

```bash
curl -X POST http://localhost:3847/api/forge3d/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"text","prompt":"a low-poly game character","projectId":"<id-from-T5.1>"}'
```

**Pass:** Returns 202 with sessionId, status polling works

---

### T5.5 — Forge3D post-processing presets
```bash
curl http://localhost:3847/api/forge3d/presets
```

**Expected:** Returns Mobile/Web/Desktop/Unreal poly count presets

**Pass:** All 4 presets present in response

---

## Section 6 — Multi-Agent Pipeline

### T6.1 — Agent list
```bash
curl http://localhost:3847/api/agents
```

**Expected:** 6 agents: Planner, Builder, Tester, Reviewer, Survey, Recorder — all status "idle"

**Pass:** All 6 present with idle status

---

### T6.2 — Start pipeline
```bash
curl -X POST http://localhost:3847/api/agents/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{"task":"create a simple hello world function","projectPath":"D:/BrightForge/examples/hello-world"}'
```

**Expected:** Pipeline starts, Planner picks up task

**Pass:** 200 response, pipeline status changes to "running" when polled

---

### T6.3 — Pipeline status polling
```bash
curl http://localhost:3847/api/agents/pipeline/status
```

**Pass:** Returns current step, agent statuses, no 500

---

### T6.4 — Pipeline cancel
```bash
curl -X POST http://localhost:3847/api/agents/pipeline/cancel
```

**Pass:** Pipeline stops, agents return to idle

---

## Section 7 — Idea Intelligence System

### T7.1 — Run idea pipeline via direct test
```bash
cd D:/BrightForge && node src/idea/test-pipeline.js
```

**Expected:** "All pipeline steps passed" with timing

**Pass:** Exit code 0, all steps shown as passing

---

### T7.2 — Idea ingestion API (if wired)
Check `http://localhost:3847/api/ideas` or use the idea modules directly via `src/idea/index.js`.

**Pass:** Either endpoint exists and responds, or module test passes as above

---

## Section 8 — Model Intelligence System

### T8.1 — Model scanner status
```bash
curl http://localhost:3847/api/models/status
```

**Expected:** `{"initialized":true,"lastScan":null,"stats":{...}}`

**Pass:** 200 response, no errors

---

### T8.2 — Trigger a scan
```bash
curl -X POST http://localhost:3847/api/models/scan \
  -H "Content-Type: application/json" \
  -d '{"directory":"D:/BrightForge/data/models"}'
```

**Pass:** Scan starts or completes, stats update

---

## Section 9 — Security & Monitoring

### T9.1 — Security watcher status
```bash
curl http://localhost:3847/api/security/status
```

**Expected:** `{"watching":false,"fileCount":0,"alertCount":0}`

**Pass:** 200 response with watcher state

---

### T9.2 — Error log
```bash
curl http://localhost:3847/api/errors
```

**Pass:** Returns array (may include old EPIPE error from previous sessions), no 500

---

### T9.3 — Metrics / telemetry
```bash
curl http://localhost:3847/api/metrics
```

**Expected:** Uptime, memory RSS/heap, provider stats, latency percentiles

**Pass:** Valid JSON, `uptime` > 0

---

### T9.4 — Rate limiting
Send 20 rapid requests to the same endpoint:
```bash
for i in {1..20}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3847/api/health; done
```

**Pass:** All return 200 (health check shouldn't hit rate limit). If any return 429, note the threshold.

---

## Section 10 — Skills Orchestrator

### T10.1 — List skills
```bash
curl http://localhost:3847/api/skills
```

**Pass:** Returns skill registry with active/cached skills

---

### T10.2 — Skills stats
```bash
curl http://localhost:3847/api/skills/stats
```

**Pass:** Returns counts of active/cached/archived skills

---

## Section 11 — Sessions & History

### T11.1 — Session history
```bash
curl http://localhost:3847/api/sessions
```

**Pass:** Returns session list (may be empty or show old sessions)

---

### T11.2 — Session persistence after restart
1. Complete a chat task (T2.1 + T2.2)
2. Stop the server (Ctrl+C)
3. Restart: `npm run server`
4. Check `http://localhost:3847/api/sessions`

**Pass:** Previous session appears in the list

---

## Section 12 — Creative Pipeline (Cross-Domain)

### T12.1 — Pipeline detection
```bash
curl -X POST http://localhost:3847/api/chat/pipeline/detect \
  -H "Content-Type: application/json" \
  -d '{"message":"build a landing page with a 3D hero element and generated background image"}'
```

**Expected:** Response identifies code + design + forge3d domains, `detected: true`

**Pass:** Multi-domain intent detected correctly

---

### T12.2 — Creative pipeline execute
```bash
curl -X POST http://localhost:3847/api/chat/pipeline/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt":"create a simple landing page with a hero image","projectPath":"D:/BrightForge/examples/landing-page"}'
```

**Expected:** Steps execute sequentially. May be slow (image gen + code gen).

**Pass:** Response shows steps completed or in-progress, no 500

---

## Test Results Summary

| Section | Tests | Pass | Fail | Skip |
|---------|-------|------|------|------|
| 1. Startup & Health | 4 | | | |
| 2. Chat / Code Agent | 7 | | | |
| 3. Design Engine | 3 | | | |
| 4. Project Memory | 3 | | | |
| 5. Forge3D Pipeline | 5 | | | |
| 6. Multi-Agent Pipeline | 4 | | | |
| 7. Idea Intelligence | 2 | | | |
| 8. Model Intelligence | 2 | | | |
| 9. Security & Monitoring | 4 | | | |
| 10. Skills | 2 | | | |
| 11. Sessions | 2 | | | |
| 12. Creative Pipeline | 2 | | | |
| **Total** | **40** | | | |

---

## Known Limitations (Not Bugs)

- Cloud LLM providers (Groq, Gemini, Claude, etc.) will fail with "no API key" — expected, add keys to `.env.local` to test
- Python inference server (Forge3D) requires GPU setup — skip T5.4 if not configured
- OBS recording requires OBS Studio running — skip recorder agent tests if not installed
- `test-model-scanner-py` requires Python with torch installed
