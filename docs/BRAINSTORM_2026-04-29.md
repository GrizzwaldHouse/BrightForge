# BRIGHTFORGE — AGENTIC OS COMMAND CENTER BRAINSTORM RESPONSES

Captured: 2026-04-29

This artifact locks the scope of "finish the agentic OS command center" — the union of the dashboard, Phase 20 pipeline panel, integrations panel, and already-built BrightForge surfaces. Work executes inside the constraints defined in `D:\BrightForge\CLAUDE.md` and the existing Phase 20 plan at `tasks/plan.md`.

Marcus stepped away mid-session asking for plan-then-execute on locked calls. Decisions already made (committed work, plan documents, CLAUDE.md mandates) are pre-checked with `[x]`. Genuinely open questions stay `[ ]` and are deferred for Marcus to decide on return.

---

## SECTION 1 — WHAT IS THE COMMAND CENTER

### Q1.1 Which surface is the "command center"?
- [x] BrightForge web dashboard at `:3847`: Single source of truth, already hosts all panels (Chat, Forge3D, Health, Models, Orchestration, Pipeline, Recorder, Stability, Memory, Security, Debug, Playtest, Scene, World, Gameplay).
- [ ] Electron desktop wrapper: Same surface, packaged. Ship after web is stable.
- [ ] CLI: Power-user only, not "command center" in the visual sense.

### Q1.2 What does "finishing it" mean for this session?
- [x] Close out Phase 20 plan checkboxes (`tasks/todo.md`): Specific, scoped, plan-locked.
- [x] Wire the new integrations backend into a frontend surface: Backend committed but unreachable from UI today.
- [x] Lint clean, smoke-tests green, server boots: Quality gate before handoff.
- [ ] Phase 21 design: Out of scope — Marcus chooses next phase on return.

### Q1.3 What is explicitly NOT in scope tonight?
- [x] OMC `.omc/` directory: That is Cowork's own session state, not a BrightForge feature. Do not author code against it.
- [x] GPU enablement runtime install: Marcus has to run the `pip install --pre torch` command himself (`py` launcher, RTX 5080).
- [x] Push to origin/main: Local branch is 4 commits ahead. Marcus reviews and pushes himself.
- [x] Production schema migrations: Known `thumbnail` drift on `generation_history` stays untouched per Phase 19 handoff.

---

## SECTION 2 — PHASE 20 EXECUTION (PLAN-LOCKED)

The full plan lives in `tasks/plan.md`. The questions below are about how to execute it tonight given Marcus is away.

### Q2.1 Phase 20A — agentApply() foundation
- [x] A1 — `agentApply()` on WebSession: Already committed in `ee1123c` (plan and direct modes). DONE.
- [x] A2 — BuilderAgent calls `agentApply()`: Already committed. DONE.
- [x] Security review of agentApply: Already committed in `94cb38c` (six findings patched). DONE.

### Q2.2 Phase 20B — event types + dashboard panel
- [x] B1 — Add 3 event types to `event-bus.js` and `config/orchestration.yaml` (`pipeline_task_failed`, `pipeline_review_rejected`, `pipeline_agent_apply`): Foundation for typed pipeline events.
- [x] B2 — ReviewerAgent emits `pipeline_review_rejected` on score < 60: Phase 20 pilot threshold (raised to 70 in Phase 21 per plan).
- [x] B3 — Create `public/js/pipeline-tasks-panel.js` and wire into `app.js`: New tab; subscribes to `agents` WS channel; renders queued/in-progress/complete/failed cards with retry on failed.

### Q2.3 Phase 20C/D/E — Forge3D additions: agent-driven or direct?
- [x] Build directly in this session: Plan calls for agent-driven execution to dogfood the pipeline, but that requires a running server, GPU, and live agent loop. Marcus is away. Direct implementation is faster, still produces the same code, and lets us hand off agent-dogfooding for Phase 21 when Marcus can watch the dashboard live. Trade-off recorded.
- [ ] Wait for Marcus to drive the agent pipeline himself: Defers everything until he's back.

### Q2.4 Phase 20C — `daysToKeepDeadLetter` parameter
- [x] C1 — `pruneHistory()` accepts `{ daysToKeep, daysToKeepDeadLetter }`: Optional; falls back to `daysToKeep` when not provided.
- [x] C2 — `POST /history/prune` route forwards both params from body.

### Q2.5 Phase 20D — dead-letter list UI
- [x] D1 — `GET /api/forge3d/queue/dead-letters` route (registered before `/queue/:id` to avoid Express param collision, same pattern as Phase 19 retry route).
- [x] D2 — Expandable list under the badge bar in `forge3d-panel.js`; rows show truncated job ID + 80-char error + retry button.
- [x] D3 — Per-row `_retryJob(jobId)` posts to existing Phase 19 retry endpoint with `{ jobId }`.

### Q2.6 Phase 20E — Data Management subtab
- [x] E1 — Subtab in Forge3D panel with three sections: Export (download), Import (FileReader → POST), Prune (number input + confirmation modal — irreversible).

### Q2.7 Phase 20F — GPU enablement docs
- [x] F1 — `python/requirements.txt` already updated with cu128 nightly comment (uncommitted, recovers on commit).
- [x] F1 — `config/forge3d.yaml` updated with extended timeouts and health-check tolerance (uncommitted).
- [ ] F2 — Marcus runs `py -3.13 -m pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128` himself — environment install, not a code change.

### Q2.8 Phase 20G — integration and handoff
- [x] G1 — Run all relevant test scripts and lint, document pass/fail.
- [x] G2 — Write SESSION_HANDOFF.md update for Phase 20 (replaces the Phase 19 doc — old one already shows in git status as modified).
- [x] G3 — Update `planning/progress.md` and `planning/task_plan.md` mid-session.

---

## SECTION 3 — INTEGRATIONS LAYER (NEW, UNCOMMITTED)

Backend committed in working tree but not yet routed end-to-end. Adds Firecrawl and Model Knowledge Sync.

### Q3.1 Where does the integrations frontend live?
- [x] New "Integrations" panel as a top-level tab: Most discoverable. Houses Firecrawl status + provider list + sync trigger + last-sync results. Pattern matches existing panels (constructor / init / _render / _bindEvents).
- [ ] Sub-section under Models tab: Cohesive (model knowledge syncs INTO the model intelligence system) but visually buried.
- [ ] Settings-only: Power-user feel; loses the SSE progress stream surface.

### Q3.2 Should `model-knowledge-sync` run on a schedule?
- [ ] Scheduled cron daily: Keeps the model knowledge fresh automatically.
- [x] Manual-only for tonight: User-triggered button. Scheduling is a Phase 21 concern; ship the button now.
- [ ] On every server boot: Wasteful and slow at startup.

### Q3.3 Firecrawl API key handling
- [x] `FIRECRAWL_API_KEY` env var, fail soft if absent: Matches existing `dotenv` pattern. Status endpoint reports unhealthy without crashing.
- [ ] In-database secret: Adds rotation/audit complexity outside scope.
- [ ] Hardcoded: Violates CLAUDE.md (no hardcoded credentials).

### Q3.4 Untracked `src/integrations/` test scripts
- [x] Add `test-firecrawl` and `test-model-sync` npm scripts (already added in package.json diff): Existing self-test pattern.
- [x] Run them as part of G1 if `FIRECRAWL_API_KEY` is set; skip cleanly if absent: Don't gate the build on a third-party API.

---

## SECTION 4 — UNTRACKED WORKING SET (TRIAGE)

Several new directories and files exist in the working tree but aren't tracked. Decisions on each.

### Q4.1 `defaults/`, `generated/`, `planning/`, `tasks/` directories
- [x] `tasks/` and `planning/` — Keep, commit: Phase 20 plan + progress lives there per Phase 19 handoff.
- [x] `generated/review/` — Add to `.gitignore` if not already: Build artifact, not source.
- [x] `defaults/` — Read once, decide: Has `prompts.json` + `models/` subfolder. Likely seed data for `generate-and-validate-models.js` script. Commit if used by code, gitignore if scratch.

### Q4.2 `public/mockups/`, `public/icons/`, `public/spline/`, `public/tools/`
- [x] Mockups (direction-a/b/c.html) — Keep, commit: Design exploration tied to PRODUCT.md anti-references.
- [x] Icons (brightforge-icon.svg, image-prompts.md, preview.html) — Keep, commit: Brand assets.
- [x] Spline README, tools (brainstorm-template, vetassist) — Keep, commit: Documented adjuncts.
- [ ] Decide tonight whether any of these need integration into the dashboard route map: Defer to Marcus.

### Q4.3 PRODUCT.md
- [x] Keep at repo root, commit: Product context doc, referenced anti-pattern list. Belongs alongside CLAUDE.md.

### Q4.4 New skill files in `.claude/skills/`
- [x] `cli-tool-wrapping.md`, `compound-engineering.md`, `planning-with-files.md`, `pm-frameworks.md` — Already in working tree, leave for Marcus to commit through skill orchestrator: Touching `.claude/skill_registry.json` from outside the orchestrator violates the lifecycle.

---

## SECTION 5 — QUALITY GATES (PRE-HANDOFF)

### Q5.1 Required before declaring done tonight
- [x] `npm run lint` — zero errors (108 CRLF errors in `forge-bg.js` already auto-fixed).
- [x] `npm run test-api` — pass (smoke-tested, currently passes).
- [x] `npm run test-plan` — pass (smoke-tested, currently passes).
- [x] `npm run test-forge-db` — pass (verifies Phase 20C `pruneHistory` change).
- [x] `npm run test-ws-bus` — pass (verifies Phase 20B1 event types).
- [x] `npm run test-builder` — pass (verifies agentApply path through BuilderAgent).
- [x] `npm run test-reviewer` — pass (verifies Phase 20B2 typed rejection).
- [x] Server boot smoke: `node bin/brightforge-server.js` starts, `/api/health` returns 200, `/api/integrations/firecrawl/status` reachable.

### Q5.2 What if a test fails I cannot fix tonight?
- [x] Stop, document the failure in handoff, mark related task as in_progress (not completed): Per CLAUDE.md task lifecycle — don't lie about completion.
- [ ] Skip the test: Violates CLAUDE.md.

### Q5.3 Commit policy this session
- [x] No commits without Marcus reviewing: He's away. Stage the work, document everything in handoff. Branch is already 4 commits ahead of origin.
- [x] Edit existing files in place where the spec says (don't refactor adjacent code): Karpathy surgical-changes principle.

---

## SECTION 6 — RISK REGISTER

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `pipeline-tasks-panel.js` HTML mount point doesn't exist in `index.html` | Medium | Inspect index.html before writing; add tab + content `<div>` if missing |
| WebSocket channel name mismatch (panel subscribes wrong channel) | Low | Re-read `ws-event-bus.js` channel constants before wiring |
| `dead-letters` route param-order collision with `:id` | Already mitigated | Same pattern as Phase 19 retry route — register before `/queue/:id` |
| Untracked `src/integrations/firecrawl-client.js` depends on a missing npm package | Low | Already in `package.json` diff (`@mendable/firecrawl-js ^1.0.0`); run `npm install` first |
| `agentApply()` direct mode writes outside project root | Already mitigated | Phase 20A security audit (`94cb38c`) patched path traversal + 5 other findings |
| Frontend tab registration order matters | Low | Append at end of `app.js` panel block, mirror `OrchestrationPanel` pattern (line 197) |

---

## EXECUTION ORDER (LOCKED)

Tonight's sequence — every item already locked above:

1. `npm install` (pull `@mendable/firecrawl-js`).
2. Phase 20B1 — three event types in `event-bus.js` + `config/orchestration.yaml`.
3. Phase 20B2 — ReviewerAgent typed rejection.
4. Phase 20B3 — `public/js/pipeline-tasks-panel.js` + `app.js` wire.
5. Phase 20C1/C2 — `pruneHistory` `daysToKeepDeadLetter` + route forward.
6. Phase 20D1 — `GET /queue/dead-letters` route.
7. Phase 20D2/D3 — expandable list + per-row retry in `forge3d-panel.js`.
8. Phase 20E1 — Data Management subtab.
9. Integrations frontend — `public/js/integrations-panel.js` + `app.js` wire.
10. Run tests + lint (G1).
11. Write `SESSION_HANDOFF.md` for Phase 20 (G2).
12. Update `planning/progress.md` (G3).

---

## DEFERRED FOR MARCUS

Items where this session pauses and waits:

- Whether to push the 4 ahead-of-origin commits to `origin/main`.
- Whether to schedule `model-knowledge-sync` (Q3.2 — kept manual tonight).
- Phase 21 scope and direction.
- GPU pip install command (Marcus runs in his shell; no code action).
- Final review of the Phase 20 panel UX before Phase 21 dogfooding.
