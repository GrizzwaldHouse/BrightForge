# Graph Report - docs  (2026-11-13)

## Corpus Check
- Corpus is ~47,939 words - fits in a single context window. You may not need a graph.

## Summary
- 423 nodes · 728 edges · 25 communities
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 112 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Clean-Room Run and CI
- Agent Pipeline and Queue (Phase 20)
- Forge3D API Endpoints
- Adversarial Audit Findings
- Competitive Analysis and Roadmap
- Branch Reconciliation
- OWASP Pen-Test Plan
- Honeybadger Bridge Spec
- Baseline Defects and Gaps
- Test Reports and Suites
- Security Fixes and Hygiene
- API Reference and Metrics
- Auth and Bind Policy
- Chat API and Plan Flow
- User Test Plan
- Codex Verification Handoff
- Setup and ForgePipeline Guide
- GPU and VRAM Risks
- Assertion Guard Fixes
- Demo Script and Providers
- Design Engine
- Self-Test Guard
- Docker and Build Hygiene
- Health and Config
- Events and Dead-Letter

## God Nodes (most connected - your core abstractions)
1. `Branch Reconciliation Report` - 38 edges
2. `Security and Repository Hygiene` - 29 edges
3. `Feature Verification Matrix (Phase 06)` - 23 edges
4. `Final Change Manifest` - 22 edges
5. `Threat Model` - 21 edges
6. `Adversarial and Load Report (Phase 07)` - 17 edges
7. `Baseline and Final Test Report` - 15 edges
8. `BrightForge User Test Plan` - 14 edges
9. `Honeybadger Vault Bridge - Architecture Specification` - 14 edges
10. `BrightForge Strategic Competitive Analysis (2026-03-02)` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Dogfood pipeline: BrightForge agents build BrightForge` --semantically_similar_to--> `Feature 5: Creative Pipeline Command`  [INFERRED] [semantically similar]
  superpowers/specs/2026-04-28-phase20-design.md → feature-strategy-2026.md
- `Web dashboard :3847 as command center` --conceptually_related_to--> `BrightForge API Reference`  [INFERRED]
  BRAINSTORM_2026-04-29.md → API.md
- `Verify installation (self-test suite)` --conceptually_related_to--> `BrightForge User Test Plan`  [INFERRED]
  SETUP.md → USER_TEST_PLAN.md
- `A01 Broken Access Control / IDOR` --semantically_similar_to--> `Authentication / multi-tenancy gap (CRI blocker)`  [INFERRED] [semantically similar]
  pen-test-plan.md → competitive-analysis-2026.md
- `SSE endpoint /api/chat/stream/:sessionId` --references--> `Feature 3: SSE Streaming + Smart Interrupts`  [INFERRED]
  pen-test-plan.md → feature-strategy-2026.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **BrightForge REST route groups** — api_chat_endpoints, api_session_endpoints, api_configuration_endpoints, api_error_endpoints, api_metrics_endpoints, api_design_endpoints, api_forge3d_endpoints [EXTRACTED 1.00]
- **Phase 20 deliverables** — brainstorm_2026_04_29_agentapply, brainstorm_2026_04_29_pipeline_event_types, brainstorm_2026_04_29_pipeline_tasks_panel, brainstorm_2026_04_29_dead_letter_ui, brainstorm_2026_04_29_data_management_subtab [EXTRACTED 1.00]
- **GPU/VRAM risk and mitigation guidance** — red_team_report_vram_exhaustion, red_team_report_tdr_timeout, setup_windows_tdr_fix, setup_vram_management, red_team_report_single_model_mutex [INFERRED 0.85]
- **Trust-building transparency features (cost, routing, rollback)** — feature_strategy_2026_feature_cost_dashboard, feature_strategy_2026_feature_git_rollback_timeline, feature_strategy_2026_feature_provider_routing [INFERRED 0.85]
- **Honeybadger bridge core components** — honeybadger_bridge_spec_bridge_outbound, honeybadger_bridge_spec_bridge_inbound, honeybadger_bridge_spec_request_envelope, honeybadger_bridge_spec_retry_policy, honeybadger_bridge_spec_idempotency_seen_set [EXTRACTED 1.00]
- **Phase 20 pipeline agent chain (Planner, Builder, Tester, Reviewer)** — superpowers_specs_2026_04_28_phase20_design_planner_agent, superpowers_specs_2026_04_28_phase20_design_builder_agent, superpowers_specs_2026_04_28_phase20_design_tester_agent, superpowers_specs_2026_04_28_phase20_design_reviewer_agent [EXTRACTED 1.00]
- **Shell injection fixes S1-S3** — audits_security_and_repository_hygiene_s1, audits_security_and_repository_hygiene_s2, audits_security_and_repository_hygiene_s3, audits_final_change_manifest_c_cd80966 [EXTRACTED 1.00]
- **Network exposure and auth fixes S4-S7, S9** — audits_security_and_repository_hygiene_s4, audits_security_and_repository_hygiene_s5, audits_security_and_repository_hygiene_s6, audits_security_and_repository_hygiene_s7, audits_security_and_repository_hygiene_s9, audits_security_and_repository_hygiene_bind_policy [EXTRACTED 1.00]
- **Four-tier sandbox validation ladder** — audits_sandbox_design_tier1, audits_sandbox_design_tier2, audits_sandbox_design_tier3, audits_sandbox_design_tier4 [EXTRACTED 1.00]

## Communities (25 total, 0 thin omitted)

### Community 0 - "Clean-Room Run and CI"
Cohesion: 0.06
Nodes (41): Defect 12 forceProvider unused, budget incomplete (CONFIRMED), CI python-mesh job (.github/workflows/tests.yml), Deterministic Node suite 90/90 at ed7bfca, Clean-Room Run at ed7bfca, git archive clean-room snapshot method, Not covered by clean-room run, Python tests 14/14 after fixes, python/requirements-test.txt (+33 more)

### Community 1 - "Agent Pipeline and Queue (Phase 20)"
Cohesion: 0.09
Nodes (47): agentApply(planText, mode, taskId), POST /queue/dead-letter/retry (Phase 19), GET /api/forge3d/queue/dead-letters, DiffApplier, Phase 20 Implementation Plan, BuilderAgent._executeSubtask(), Phase 18 export/import endpoints, BuilderAgent._getAgentSession() (+39 more)

### Community 2 - "Forge3D API Endpoints"
Cohesion: 0.05
Nodes (42): POST /api/forge3d/queue/dead-letter/retry, GET /api/forge3d/bridge, Forge3D Endpoints (/api/forge3d), Forge3D export/import (data management), Forge3D Generation Queue endpoints, POST /api/forge3d/history/prune, POST /api/forge3d/generate, Python inference bridge (ModelBridge) (+34 more)

### Community 3 - "Adversarial Audit Findings"
Cohesion: 0.06
Nodes (41): test/clean-room/adversarial.mjs, Auth checks with key set and 0.0.0.0 bind, Adversarial checks that passed, DiffApplier (src/core/diff-applier.js), Adversarial and Load Report (Phase 07), F1 Model output writes outside project (path escape), F2 Gameplay status endpoint always 500 (getPrototypeNPCs missing), F3 Design generation broken (llmClient.generate missing) (+33 more)

### Community 4 - "Competitive Analysis and Roadmap"
Cohesion: 0.11
Nodes (36): Aider (competitor), Authentication / multi-tenancy gap (CRI blocker), Cline (competitor), Commercial Readiness Index (CRI), CRI Roadmap to Launch-Ready (8-10 weeks, 4 phases), Dify (competitor), BrightForge Strategic Competitive Analysis (2026-03-02), Competitive Grading Rubric (12 dimensions) (+28 more)

### Community 5 - "Branch Reconciliation"
Cohesion: 0.11
Nodes (31): Candidate baseline 16c98f2 (feat/migrate-d-drive-untracked-work), claude/mcp-deepseek-integration-1ymcK (MCP + DeepSeek), claude/brightforge-master-execution-UYu2k (engine/ C++ scaffold), Contradiction about canonical copy, Uploaded clean-room snapshot (385 files), Local-only commits 7abd9c6 and e8cc1a9 (tag v4.2.0-reconciled), Defect 13 duplicate C++ renderer folders (CONFIRMED), Branch Reconciliation Report (+23 more)

### Community 6 - "OWASP Pen-Test Plan"
Cohesion: 0.16
Nodes (21): A01 Broken Access Control / IDOR, A02 Cryptographic Failures, A03 Injection (SQL, path traversal, command), A04 Insecure Design (queue abuse, enumeration), A05 Security Misconfiguration, A06 Vulnerable and Outdated Components, A07 Identification and Authentication Failures (SSE session hijack), A08 Software and Data Integrity (malicious plan injection) (+13 more)

### Community 7 - "Honeybadger Bridge Spec"
Cohesion: 0.24
Nodes (18): BridgeInbound, Bridge observability events (sent/failed/received/rejected/duplicate), BridgeOutbound, data/bridge-failed.jsonl dead-letter file, Decoupled transport-only design principle, Honeybadger Vault Bridge - Architecture Specification, Honeybadger Vault (HBV), IdeaIntelligence (BrightForge idea pipeline) (+10 more)

### Community 8 - "Baseline Defects and Gaps"
Cohesion: 0.15
Nodes (15): Three.js script URLs missing in three@0.171.0, Unverified capabilities, Defect 1 npm ci fails on lockfile (CONFIRMED), Defect 14 no SSM functionality (CONFIRMED), Defect 5 three.js CDN files missing (CONFIRMED), N1 Corrupt rescued integrations-panel.js, Commit 1387bfe fix(viewer) pinned three.js/lucide, Commit 49f1a90 fix(deps) sync lockfile (+7 more)

### Community 9 - "Test Reports and Suites"
Cohesion: 0.23
Nodes (14): Baseline and Final Test Report, Scripts excluded from deterministic run, Final run on repair branch: 86/86 passed, test-frontend-routes, test-mesh-flow (baseline 3 pass/5 fail), Eight new regression tests, Python python/tests (baseline 3 of 4 failed; final 4/4 OK), src/tests/run-deterministic-suite.js (+6 more)

### Community 10 - "Security Fixes and Hygiene"
Cohesion: 0.21
Nodes (14): Headless Chromium viewer render check, Defect 2 revert endpoint shell injection (CONFIRMED), Commit cd80966 fix(security) shell interpolation, Security and Repository Hygiene, R1 Dashboard sends no Authorization header, R5 Runtime third-party imports (@splinetool/runtime@latest, ui-avatars.com), R6 Helmet CSP disabled; ~131 innerHTML assignments, R8 Gemini API key sent in URL query string (+6 more)

### Community 11 - "API Reference and Metrics"
Cohesion: 0.25
Nodes (8): BrightForge API Reference, Error Endpoints (/api/errors), Global Error Response Format, Metrics Endpoints (/api/metrics), GET /api/metrics/stream (SSE), TelemetryBus, Web API without authentication, Section 9: Security and monitoring

### Community 12 - "Auth and Bind Policy"
Cohesion: 0.33
Nodes (9): Defect 11 API reachable without auth (CONFIRMED), Defect 3 binds all interfaces without auth (CONFIRMED), Attention 3 Auth behind same-host reverse proxy, Commit c323f8d fix(security) loopback bind + API key, src/api/bind-policy.js and auth middleware, S4 Server listened on 0.0.0.0 by default, S5 API reachable without authentication, S6 Public-endpoint lookup case mismatch (+1 more)

### Community 13 - "Chat API and Plan Flow"
Cohesion: 0.36
Nodes (7): Chat Endpoints (/api/chat), GET /api/chat/status/:id, POST /api/chat/approve, POST /api/chat/rollback, POST /api/chat/turn, Coding agent demo scene, Section 2: Chat / code agent

### Community 14 - "User Test Plan"
Cohesion: 0.25
Nodes (8): Session Endpoints (/api/sessions), BrightForge User Test Plan, Section 12: Creative pipeline (cross-domain), Section 7: Idea Intelligence System, Section 8: Model Intelligence System, Section 4: Project memory, Section 11: Sessions and history, Section 10: Skills Orchestrator

### Community 15 - "Codex Verification Handoff"
Cohesion: 0.25
Nodes (8): Attention 1 Self-test guard isMainModule on Windows, Attention 4 Revert endpoint adversarial inputs, Attention 5 Mesh flow FastAPI endpoint not exercised, Attention 7 Justify excluded scripts, Suggested verification command sequence, Handoff for Independent Verification, Independent verification (docs/audits/codex-independent-verification.md), Merge preconditions

### Community 16 - "Setup and ForgePipeline Guide"
Cohesion: 0.25
Nodes (8): CLI demo scene, First run options (dashboard, CLI, Electron), ForgePipeline Setup Guide, Model downloads (InstantMesh, SDXL), Node.js setup, python/setup.py validator, System requirements, Verify installation (self-test suite)

### Community 17 - "GPU and VRAM Risks"
Cohesion: 0.29
Nodes (7): Single-model mutex mitigation, Windows TDR timeout, VRAM exhaustion risk (CRITICAL), GPU configuration, Sequential VRAM management, Windows TDR timeout registry fix, Known limitations (not bugs)

### Community 18 - "Assertion Guard Fixes"
Cohesion: 0.33
Nodes (6): Baseline run at 16c98f2: 66/78 passed, 12 failed, Attention 2 Assertion guard overrides process.exit, Commit 34e1ebd fix(tests) console.assert and repo-writing tests, H5 782 console.assert calls could never fail a test, H6 Self-tests rewrote tracked files, T12 Self-tests writing tracked files

### Community 19 - "Demo Script and Providers"
Cohesion: 0.33
Nodes (6): BrightForge Demo Video Script, Docker deployment scene, Free-first provider chain, OBS Studio (recording tool), Environment variables reference, LLM provider priority order

### Community 20 - "Design Engine"
Cohesion: 0.40
Nodes (5): Design Endpoints (/api/design), Design Engine, POST /api/design/generate, Design engine demo scene, Section 3: Design engine

### Community 21 - "Self-Test Guard"
Cohesion: 0.60
Nodes (5): selftest-guard-check.js, Wrong suite ran (self-healing [HEALING] 17 passed), Defect 4 self-healing import hijacks suites (CONFIRMED), Commit ff899df fix(tests) self-test entry-point guard, H4 Self-tests ran on import; basename guard collisions

### Community 22 - "Docker and Build Hygiene"
Cohesion: 0.50
Nodes (5): N2 .dockerignore excludes package-lock.json, Commit 733f643 build(docker) test and Ollama profiles, Docker images built (node-server, test, python-test; python-server GPU not built), H3 .dockerignore excluded package-lock.json, S10 Containers ran as root with unpinned bases

### Community 23 - "Health and Config"
Cohesion: 0.50
Nodes (4): Configuration Endpoints (/api/config, /api/health), GET /api/health, Health monitoring demo scene, Section 1: Server startup and health

### Community 24 - "Events and Dead-Letter"
Cohesion: 0.83
Nodes (4): test-events-queue (baseline 6 pass/3 fail), Defect 6 WebSocket bridge/dashboard path wrong (CONFIRMED), Defect 7 jobs cannot reach dead-letter (CONFIRMED), Commit 0dfb1ed fix(events) WS bridge + dead-letter

## Knowledge Gaps
- **67 isolated node(s):** `GET /api/chat/status/:id`, `Global Error Response Format`, `TelemetryBus`, `agentApply() on WebSession (Phase 20A)`, `ReviewerAgent typed rejection (score < 60)` (+62 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 71 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Security and Repository Hygiene` connect `Security Fixes and Hygiene` to `Clean-Room Run and CI`, `Adversarial Audit Findings`, `Branch Reconciliation`, `Baseline Defects and Gaps`, `Test Reports and Suites`, `Auth and Bind Policy`, `Assertion Guard Fixes`, `Self-Test Guard`, `Docker and Build Hygiene`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **What connects `GET /api/chat/status/:id`, `Global Error Response Format`, `TelemetryBus` to the rest of the system?**
  _67 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Clean-Room Run and CI` be split into smaller, more focused modules?**
  _Cohesion score 0.06205673758865248 - nodes in this community are weakly interconnected._
- **Why does `Branch Reconciliation Report` connect `Branch Reconciliation` to `Clean-Room Run and CI`, `Adversarial Audit Findings`, `Baseline Defects and Gaps`, `Test Reports and Suites`, `Security Fixes and Hygiene`, `Auth and Bind Policy`, `Self-Test Guard`, `Docker and Build Hygiene`, `Events and Dead-Letter`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Should `Agent Pipeline and Queue (Phase 20)` be split into smaller, more focused modules?**
  _Cohesion score 0.08880666049953746 - nodes in this community are weakly interconnected._
- **Why does `Adversarial and Load Report (Phase 07)` connect `Adversarial Audit Findings` to `Security Fixes and Hygiene`, `Codex Verification Handoff`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Should `Forge3D API Endpoints` be split into smaller, more focused modules?**
  _Cohesion score 0.05217391304347826 - nodes in this community are weakly interconnected._