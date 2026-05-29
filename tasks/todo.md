# Phase 20 Task List
**Date:** 2026-04-28
**Plan:** `tasks/plan.md`
**Spec:** `docs/superpowers/specs/2026-04-28-phase20-design.md`

---

## Phase 20A — agentApply() Foundation
- [ ] A1 — Add `agentApply(planText, mode)` to `src/api/web-session.js`
- [ ] A2 — Wire `agentApply()` into `src/agents/builder-agent.js`
- [ ] **CHECKPOINT A:** Manual pipeline trigger — verify file written, backup exists, telemetry fires

## Phase 20B — Event Types + Dashboard Panel
- [ ] B1 — Add 3 event types to `src/orchestration/event-bus.js` + `config/orchestration.yaml`
- [ ] B2 — ReviewerAgent emits `pipeline_review_rejected` on score < 60
- [ ] B3 — Create `public/js/pipeline-tasks-panel.js` + wire into `app.js`
- [ ] **CHECKPOINT B:** Dashboard Pipeline Tasks tab renders; WebSocket events drive cards

## Phase 20C — Task A Pilot (daysToKeepDeadLetter) [AGENT-DRIVEN]
- [ ] C1 — `pruneHistory()` in `src/forge3d/database.js` accepts `daysToKeepDeadLetter`
- [ ] C2 — `POST /history/prune` route passes `daysToKeepDeadLetter` through
- [ ] **CHECKPOINT C:** `npm run test-forge-db` passes; Task A card green in dashboard

## Phase 20D — Tasks B+C (Dead-Letter UI) [AGENT-DRIVEN]
- [ ] D1 — `GET /api/forge3d/queue/dead-letters` route in `src/api/routes/forge3d.js`
- [ ] D2 — Dead-letter expandable list in `public/js/forge3d-panel.js`
- [ ] D3 — Per-row `_retryJob(jobId)` wired to existing retry endpoint
- [ ] **CHECKPOINT D:** `npm run test-forge3d-e2e` passes; list renders + per-row retry fires

## Phase 20E — Task D (Export/Import UI) [AGENT-DRIVEN, parallel with 20D]
- [ ] E1 — "Data Management" subtab in `public/js/forge3d-panel.js`
- [ ] **CHECKPOINT E:** Subtab visible; export downloads, import POSTs, prune confirms

## Phase 20F — GPU Item 5 (Direct)
- [ ] F1 — Add nightly torch comment to `python/requirements.txt`
- [ ] F1 — Add `gpu_mode` note to `config/forge3d.yaml`
- [ ] F2 — User runs: `py -3.13 -m pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128`
- [ ] **CHECKPOINT F:** `python/inference_server.py --test` reports CUDA device

## Phase 20G — Integration + Handoff
- [ ] G1 — `npm run lint` — zero errors
- [ ] G1 — `npm run test-forge-db` — pass
- [ ] G1 — `npm run test-forge3d-e2e` — 5/5 pass
- [ ] G1 — `npm run test-ws-bus` — pass
- [ ] G1 — `npm run test-builder` — pass
- [ ] G1 — `npm run test-reviewer` — pass
- [ ] G2 — Write `SESSION_HANDOFF.md`
- [ ] G3 — Update `planning/progress.md` and `planning/task_plan.md`
