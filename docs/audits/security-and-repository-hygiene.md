# Security and Repository Hygiene

| Field | Value |
|---|---|
| Repair branch | `repair/p0-recovery-2026-10` |
| Baseline | `16c98f2` (`origin/feat/migrate-d-drive-untracked-work`) |
| Platform | Linux container, Node v22.22.0 (host) and v20.20.2 (Docker images), Python 3.11 |
| Secrets policy | No secret values were read, printed or committed. Only variable names appear here |

Evidence logs referenced below were produced by the commands named in each row. Regression tests are committed under `src/tests/` and `python/tests/`.

## 1. Security findings and fixes

| ID | Finding (reproduced on baseline) | Severity | Fix (commit) | Regression test | Result |
|---|---|---|---|---|---|
| S1 | `POST /api/chat/revert/:commitHash` interpolated the URL parameter into `execSync`. Payload `HEAD;touch <sentinel>` returned HTTP 200 and created the sentinel file | Critical (RCE) | `execFileSync('git', argv)`, hex-hash allow-list, only `brightforge:` checkpoint commits revertible (`cd80966`) | `npm run test-security` section 5; `node src/core/git-checkpointer.js --test` tests 9–11 | Fixed. Baseline: sentinel created. Repair: 4 payloads → 400, no sentinel |
| S2 | Checkpoint commit label escaped `"` only; `$()` and backticks reached the shell | High | Label passed as one argv element (`cd80966`) | git-checkpointer test 11 | Fixed |
| S3 | Skill name interpolated into a `curl` shell string (`POST /api/skills/load`) | High | Name allow-list `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, `execFileSync('curl', argv)` (`cd80966`) | Validation probe (8 inputs) | Fixed |
| S4 | Server listened on `0.0.0.0` (socket `00000000:0F07`) | High | Default `127.0.0.1`; non-loopback host without `BRIGHTFORGE_API_KEY` exits 1 (`c323f8d`) | `npm run test-security` sections 1–2; `npm run test-bind-policy` | Fixed. Baseline: LAN address reachable. Repair: refused |
| S5 | API reachable without authentication: `/api/config`, `/api/forge3d/projects`, `/api/metrics`, `/api/forge3d/queue`, `/api/agentforge/status` returned 200 | High | No key: loopback peers only (socket address, not `X-Forwarded-For`). Key: Bearer token with constant-time compare (`c323f8d`) | `npm run test-security` sections 3–4 | Fixed |
| S6 | Public-endpoint lookup compared an upper-cased set with a mixed-case path, so `/api/health` required a token whenever a key was set | Medium | Lookup key upper-cased (`c323f8d`) | `npm run test-security` section 3 | Fixed |
| S7 | WebSocket `/ws/events` had no authentication | Medium | Same policy as HTTP via `verifyClient` (`0dfb1ed`) | `npm run test-events-queue` (loopback, no key) | Fixed for the no-key path. **With a key: UNVERIFIED end to end** (dashboard does not send a token, see R1) |
| S8 | Remote, unpinned scripts: three.js from jsDelivr (files absent in r171), Lucide `@latest` from unpkg | Medium (supply chain) | Pinned npm packages served from `/vendor` (`1387bfe`) | `npm run test-frontend-assets` | Fixed |
| S9 | `docker-compose.yml` published 3847 and 8765 on all host interfaces | Medium | Published on `127.0.0.1` only; web container requires `BRIGHTFORGE_API_KEY` (`c323f8d`) | `docker compose config` | Fixed |
| S10 | Containers ran as root; base images unpinned | Medium | Non-root users, digest-pinned bases (`733f643`) | Image inspection (uid 1000) | Fixed for node-server, test, python-test. **python-server (GPU) unchanged** (R4) |

### Remaining security risks (not fixed in this branch)

| ID | Risk | Why not fixed here |
|---|---|---|
| R1 | Dashboard never sends `Authorization`, so with `BRIGHTFORGE_API_KEY` set the UI cannot call the API. `EventSource` cannot send headers | Needs a UI token flow design (owner decision). Local use without a key works and is loopback-only |
| R2 | `projectRoot` is still accepted from request bodies (chat routes) and used for file writes and git; path checks in `plan-engine.js` / `project-manager.js` use prefix `startsWith` | Requires an allowed-roots design. Mitigated by loopback-only default; not mitigated when a key is set and the server is exposed |
| R3 | Generated code executed by the tester runs as the server user with no container isolation. `src/security/sandbox.js` env allow-list includes `NODE_OPTIONS` | Needs sandbox redesign (container or VM per run) |
| R4 | `python-server` stage runs as root and binds `0.0.0.0` inside the container | GPU image cannot be built or run in this environment |
| R5 | `public/js/forge-bg.js` imports `@splinetool/runtime@latest` from unpkg at runtime; dashboard requests `ui-avatars.com` | Optional visual features; listed for owner decision |
| R6 | Helmet CSP disabled; about 131 `innerHTML` assignments in `public/js` | Needs CSP rollout plus sanitisation pass |
| R7 | `bin/brightforge-desktop.js` spawns Electron with `shell: true` | Arguments are fixed paths (no user input). Windows `.cmd` resolution cannot be tested here |
| R8 | Gemini API key is sent in the URL query string (provider API design) | Errors are already redacted; inherent to that API |

### Secret scan

- Patterns: OpenAI/Anthropic/Groq-style keys, AWS AKIA, GitHub PATs, Google API keys, private-key headers, Firecrawl keys.
- Scope: candidate tree **and every commit of every ref**.
- Result: no matches.
- No `.env`, `.env.local`, `.env.production` file has ever been committed; only `*.example` files are tracked, all with empty values.
- No blob over 1 MB exists in history.
- Variable names only: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `BRIGHTFORGE_API_KEY` (all absent in the test environment).

## 2. Repository hygiene findings

| ID | Finding | Action taken |
|---|---|---|
| H1 | `package-lock.json` out of sync (`@mendable/firecrawl-js` missing), so `npm ci` failed and CI was red since 2026-05-21 | Lockfile synced (`49f1a90`) |
| H2 | `public/js/integrations-panel.js` (from the D: rescue) ended in a duplicated fragment and did not parse, breaking `app.js` and lint | Fixed (`c71fa9d`); the other 45 rescued files parse |
| H3 | `.dockerignore` excluded `package-lock.json` | Fixed (`733f643`) |
| H4 | Self-tests ran when their module was only imported (37 modules), and basename guards collided (`index.js` ×4, `database.js` ×2, `config-loader.js` ×2) | Fixed (`ff899df`) |
| H5 | 782 `console.assert` calls could never fail a test | Fixed (`34e1ebd`); one stale assertion surfaced and was corrected |
| H6 | Self-tests rewrote tracked files: `test/sample-llm-output.txt`, `defaults/prompts.json`, `.claude/HANDOFF.md`, `.claude/skill_registry.json`, `.claude/skill_usage.md` | First two fixed (`34e1ebd`). **The skill orchestrator self-test still writes `.claude/*`**; in Docker those paths are tmpfs. Restore with `git checkout -- .claude` after local runs |
| H7 | `@mendable/firecrawl-js@1.29.3` declares `engines: node >=22`; `package.json` says `>=18`, CI tests 18 and 20 | **Open.** npm warns (EBADENGINE) but installs; the Firecrawl integration is not exercised at runtime by the test suite. Decide: raise the Node floor to 22 or pin an older Firecrawl client |
| H8 | Python mesh optimisation could never succeed: `fast-simplification` not declared, and trimesh ≥ 4 reads the positional argument as `percent` | Fixed (`fec80a9`) |

## 3. Exposed-folder review

Decision key: **Keep** (intentional source), **Ignore** (should not be tracked going forward), **Quarantine** (move out of the served/released tree after owner review), **Owner** (depends on ownership/branch decisions).

> No tracked file was deleted or untracked in this branch. Untracking a file deletes it from every other working copy on the next pull, which would destroy local agent memory on the MSI/PowerSpec machines. Each "Ignore" decision therefore needs the owner to back the file up locally first, then `git rm --cached`.

| Path | Classification | Decision | Rationale |
|---|---|---|---|
| `src/`, `bin/`, `public/js`, `public/css`, `config/`, `python/*.py` | Intentional source | Keep | Application code |
| `.omc/` (`project-memory.json`, `state/`) | Machine-specific agent state; contains a `C:\Users\…` path | Ignore | Local memory; leaks machine layout |
| `.agentforge/audit_result.json` | Generated audit output | Ignore | Regenerated by the AgentForge tool |
| `.brightforge/memory.json` | Per-project runtime memory written by `project-memory.js` | Ignore | Runtime state |
| `.claude/HANDOFF.md`, `.claude/skill_usage.md`, `.claude/skill_registry.json` | Agent session state, rewritten by the skill orchestrator | Ignore (registry: Owner) | Changes on every run |
| `.claude/skills/*.md`, `.claude/cowork-skills`, `.claude/karpathy-skills` (submodules) | Development tooling | Keep | Intentional; submodules are third-party (`forrestchang/andrej-karpathy-skills`): check licence before redistribution |
| `src/api/server.js.backup` | Stale backup copy | Quarantine (delete after review) | Dead code shipped with the source |
| `ARCHIVED.md` | Stale and contradicted by `16c98f2` | Owner | Rewrite once the canonical copy is confirmed |
| `public/tools/vetassist-pro-brainstorm.html`, `public/tools/brainstorm-template.html` | Content from another product, served by the web server | Quarantine | Unrelated IP exposed at `/tools/...` |
| `public/mockups/*`, `public/icons/preview.html`, `public/icons/image-prompts.md`, `public/spline/README.md` | Design exploration served by the web server | Quarantine | Dev-only material reachable over HTTP |
| `src/core/*.h`, `src/core/test_headers.cpp`, `src/rendering/*.h`, `src/ui/*.h`, `src/filesystem/*.h`, `Shaders/` | Duplicated C++ renderer scaffolding (34 files), referenced by no build file | Owner | Three implementations exist (these, plus the `engine/` scaffold on `claude/brightforge-master-execution-UYu2k`). Consolidate only after ownership is decided |
| `ue5-plugin/` | Intentional source (Unreal importer) | Keep | Not compiled or tested here |
| `analysis/`, `integration/`, `ui/`, `planning/`, `tasks/`, `verification/`, `SESSION_HANDOFF.md`, `STATUS.md`, `TASK.md`, `REPO_AUDIT_AGENT.md`, `PRODUCT.md` | Planning and agent working documents | Owner | Not secret; consider moving under `docs/` |
| `docs/competitive-analysis-2026.md`, `docs/feature-strategy-2026.md` | Business strategy in a public repo | Owner | Potentially sensitive IP |
| `defaults/prompts.json` | Generated defaults (written by the model generator) | Keep | Tests no longer rewrite it |
| `test/sample-llm-output.txt`, `test/fixtures/` | Test fixtures | Keep | Tests no longer rewrite them |
| Machine paths in code: `src/core/file-context.js:237`, `src/model-intelligence/{database,inventory-writer}.js` (`C:\Users\…\ollama.exe`) | Machine-specific literals in self-tests/fixtures | Owner | Replace with temp paths when those tests are next touched |

### Ignore rules

- `.gitignore` already covers `.env*` (with example exceptions), `data/`, `sessions/`, `logs/`, `output/`, `qa-reports/`.
- `.dockerignore` now also excludes `.env.*`, `.omc/`, `.agentforge/`, `.brightforge/`, `qa-reports/`, `logs/` from build contexts (`733f643`).
- Suggested `.gitignore` additions, after the local backup step above: `.omc/`, `.agentforge/`, `.brightforge/`, `.claude/HANDOFF.md`, `.claude/skill_usage.md`, `*.backup`.
