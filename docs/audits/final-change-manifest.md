# Final Change Manifest

| Field | Value |
|---|---|
| Branch | `repair/p0-recovery-2026-10` (pushed; not merged; no pull request opened) |
| Base | `16c98f2553dd9e90351dca02910e74fd88851224` |
| Code head | `733f6439091f18c3895a90aa7240a7ccae538c2f` (+ documentation commit) |
| Diff | 153 files changed, 2907 insertions, 549 deletions (14 added, 139 modified, 0 deleted) |
| History | Linear, fast-forward from the base. No rebase, reset, force-push or branch deletion anywhere |

Commit identity: the repository's configured identity. Commit messages carry no tool attribution, per `CLAUDE.md`.

## Commits in order

| # | Commit | Defect(s) | Files | Tests added or changed | Evidence |
|---|---|---|---|---|---|
| 1 | `c71fa9d` fix(ui): corrupt `integrations-panel.js` | New H2 | `public/js/integrations-panel.js` | — (lint) | `node --check` passes; `npm run lint` 0 errors |
| 2 | `49f1a90` fix(deps): sync lockfile | P0-1 | `package-lock.json` | — | `npm ci` in a clean copy: exit 0 (was 1) |
| 3 | `ff899df` fix(tests): self-test entry-point guard | P0-4 | `src/core/is-main-module.js` (new), `src/tests/selftest-guard-check.js` (new), `package.json`, `.github/workflows/tests.yml`; 119 `src/**/*.js` files: guard line only (codemod), including two negated guards → `isMainRun`; `src/forge3d/pipeline/test-pipeline.js`: stale "5 handlers" assertion replaced | `test-selftest-guard` | Guard check: 158 problems → 0 |
| 4 | `cd80966` fix(security): shell interpolation | P0-2 + S2, S3 | `src/core/git-checkpointer.js`, `src/core/skill-orchestrator.js`, `src/api/routes/chat.js` | git-checkpointer self-test 9–11 | Injection payloads rejected, no sentinel |
| 5 | `c323f8d` fix(security): loopback bind + API key | P0-3, P0-11, S6, S9 | `src/api/bind-policy.js` (new), `src/api/middleware/auth.js`, `bin/brightforge-server.js`, `docker-compose.yml`, `.env.docker.example`, `package.json`, CI | `test-security`, `test-bind-policy` | Repair 19/19; baseline 11/19 (sentinel created) |
| 6 | `0dfb1ed` fix(events): WS bridge + dead-letter | P0-6, P0-7, S7 | `bin/brightforge-server.js`, `src/api/ws-event-bus.js`, `src/forge3d/generation-queue.js`, `public/js/agent-pipeline-panel.js`, `public/js/pipeline-tasks-panel.js`, `package.json`, CI | `test-events-queue` | Repair 17/17; baseline 3 failures |
| 7 | `1387bfe` fix(viewer): pinned three.js/lucide | P0-5, S8 | `public/index.html`, `public/js/forge3d-viewer.js`, `src/api/server.js`, `package.json` (three 0.171.0, lucide 1.57.0 exact), `package-lock.json`, `test/fixtures/cube.glb` + generator (new), CI | `test-frontend-assets` | 15/15; Chromium render of the fixture |
| 8 | `8894101` fix(agents): deterministic tester/reviewer | P0-8 | `src/agents/tester-agent.js`, `src/agents/reviewer-agent.js` | Both self-tests rewritten/extended | No `Math.random`/simulated passes left in either |
| 9 | `fec80a9` fix(forge3d): optimisation and export | P0-9 + H8 | `python/model_manager.py`, `python/requirements.txt` (+ `fast-simplification`), `src/forge3d/model-bridge.js`, `src/forge3d/pipeline/stages/optimize-mesh.js`, `package.json`, CI (new `python-mesh` job) | `test-mesh-flow`, `python/tests/test_mesh_postprocess.py` | Node 8/8 (baseline 5 failed); Python 4/4 (baseline 3 failed) |
| 10 | `284d902` fix(ui): stale `/api/projects/search` | P0-10 | `public/js/file-browser.js`, `src/tests/frontend-routes-check.js` (new) | `test-frontend-routes` | 111 URLs routed; baseline fails on that URL |
| 11 | `e5741c3` fix(llm): forceProvider, fallback budget, Ollama config | P0-12 + Ollama requirements | `src/core/llm-client.js`, `src/agents/base-agent.js`, `src/agents/master-agent.js`, `src/tests/llm-provider-contract.js` (new), `package.json`, CI | `test-llm-contract` (`test-llm` delegates to it), `test-ollama-live` (opt-in) | 17/17 |
| 12 | `34e1ebd` fix(tests): `console.assert` and repo-writing tests | H5, H6 | `src/core/is-main-module.js`, `src/tests/selftest-guard-check.js`, `src/core/plan-engine.js`, `src/scripts/generate-and-validate-models.js`, `src/forge3d/config-loader.js` | Guard check: assert-guard probe | Deliberate assert failure → exit 1 |
| 13 | `733f643` build(docker): test and Ollama profiles | Docker requirements, H3 | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `python/requirements-test.txt` (new), `src/tests/run-deterministic-suite.js` (new), `package.json` | `npm run ci:deterministic` | Docker: 86/86, Python 4/4 |
| 14 | docs | Reporting | `docs/audits/*.md`, `docs/audits/viewer-render-evidence.png` | — | — |

## Reported defects: final status

| # | Reported defect | Reproduced | Status |
|---|---|---|---|
| 1 | `npm ci` lockfile | CONFIRMED | Fixed (`49f1a90`, `733f643`) |
| 2 | Revert endpoint shell injection | CONFIRMED (sentinel) | Fixed (`cd80966`) |
| 3 | Binds all interfaces without auth | CONFIRMED | Fixed (`c323f8d`) |
| 4 | Self-healing test hijacks other suites | CONFIRMED (11 suites; 37 modules) | Fixed (`ff899df`) |
| 5 | Three.js CDN files missing | CONFIRMED | Fixed (`1387bfe`) |
| 6 | WS bridge / dashboard path | CONFIRMED | Fixed (`0dfb1ed`) |
| 7 | Dead-letter unreachable | CONFIRMED | Fixed (`0dfb1ed`) |
| 8 | Random/simulated tester and reviewer | CONFIRMED | Fixed (`8894101`). The builder agent still returns simulated artifact paths, which are now reported as failures |
| 9 | Optimised mesh discarded | CONFIRMED (plus 2 Python defects) | Fixed (`fec80a9`) |
| 10 | `/api/projects/search` 404 | CONFIRMED | Stale call removed (`284d902`) |
| 11 | API reachable without auth | CONFIRMED | Fixed (`c323f8d`); UI token flow open (R1) |
| 12 | `forceProvider` unused / budget incomplete | CONFIRMED (source) | Fixed (`e5741c3`). Per-instance budget counters (several `UniversalLLMClient` instances) remain open |
| 13 | Duplicate C++ renderer folders | CONFIRMED (3 implementations) | **Not changed.** Needs an owner decision (ownership not established) |
| 14 | No SSM functionality | CONFIRMED (0 hits) | Research only; nothing built |

## Unresolved items

1. **MSI/PowerSpec machine evidence.** Not collected. Possible local-only commit `7abd9c6` / tag `v4.2.0-reconciled`. See `branch-reconciliation-report.md` section 6.
2. **Recovery tags.** Created locally; the push was refused (HTTP 403). Commands for the owner are in `branch-reconciliation-report.md` section 7.
3. **Unmerged branches.** `claude/mcp-deepseek-integration-1ymcK` and `claude/brightforge-master-execution-UYu2k` hold unique work with no decision yet.
4. **Security risks R1–R8.** See `security-and-repository-hygiene.md`.
5. **Firecrawl Node version.** `@mendable/firecrawl-js` requires Node ≥ 22 versus the declared `>=18` and the CI matrix 18/20 (H7).
6. **Skill orchestrator self-test.** It still rewrites tracked `.claude/*` files during local runs (H6).
7. **Unverified capabilities.** GPU generation, FBX export, live LLM providers, live Ollama, Windows-specific behaviour; see `baseline-test-report.md` section 4.
