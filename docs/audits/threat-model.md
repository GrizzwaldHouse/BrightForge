# Threat Model: BrightForge Clean-Room Validation

| Field | Value |
|---|---|
| Source | `repair/p0-recovery-2026-10` at `ed7bfca` (static review) |
| Host | PowerSpec (`GrizzieWorkShop`): Windows, RTX 5080 (driver 610.88), Docker 29.9.3 on WSL 2 |
| Scope | What can harm the Windows host, its data or its credentials while BrightForge is built, installed, tested or run |
| Method | Reading the code and build files only. No project code was run on the host |

## 1. Assets to protect

| Asset | Where it lives |
|---|---|
| Source and unpushed work | `D:\BrightForge`, `C:\Users\daley\Projects\BrightForge`, and their uncommitted changes |
| Credentials | `.env` / `.env.local` (provider keys), git credentials, browser and OS credential stores |
| Personal files | User profile, other drives |
| GPU and system stability | RTX 5080 driver, CUDA runtime, system Python |
| Other projects | `C:\AgentForge Control`, `D:\Alexander_Vault`, other repositories |

## 2. Entry points and what each can do

| # | Entry point | Capability | Severity | Evidence |
|---|---|---|---|---|
| T1 | `python/requirements.txt` installs `shap-e` from GitHub `HEAD` | Runs unreviewed code at install time; changes without notice | High | `shap-e @ git+https://github.com/openai/shap-e.git` |
| T2 | Python version ranges (`>=`) for every package | A rebuild can pull new code silently | High | `python/requirements.txt` |
| T3 | Runtime model downloads (Hugging Face, rembg) | Network access and large writes during inference | High | Model loaders in `python/` |
| T4 | Tester agent and `src/security/sandbox.js` run generated code | Runs AI-written code as the server user; `NODE_OPTIONS` is on the env allow-list, so code can be injected into child Node processes | High | `src/security/sandbox.js:37` (R3) |
| T5 | Model scanner | Runs `execFile` and PowerShell to list runtimes and drives | Medium on host, low in container | `src/model-intelligence/scanner.js:395,426` |
| T6 | npm install scripts | `better-sqlite3` (native build or prebuilt download), `electron` (binary download) | Medium | `package-lock.json` `hasInstallScript` |
| T7 | Desktop launcher | `spawn(..., { shell: true })` with fixed arguments | Medium | `bin/brightforge-desktop.js:25` (R7) |
| T8 | Web API and WebSocket | File writes, git operations, plan apply, chat routes accepting `projectRoot` | High if exposed, low on loopback | Loopback default and key requirement in `src/api/bind-policy.js`; `projectRoot` from request bodies (R2) |
| T9 | Python inference server | Runs as root, listens on `0.0.0.0` inside its container | Medium | `Dockerfile` `python-server` stage (R4) |
| T10 | Ollama compose profile | Container reaches the host through `host.docker.internal` | Medium (deliberate) | `docker-compose.yml` `brightforge-ollama-test` |
| T11 | Dashboard third-party scripts | `@splinetool/runtime@latest`, `ui-avatars.com`; CSP disabled | Low to medium | R5, R6 |
| T12 | Self-tests writing tracked files | Skill orchestrator self-test rewrites `.claude/*` | Low (data integrity) | H6 |

Fixed already on this branch (regression tests in the suite): revert-endpoint shell injection, skill-name shell injection, all-interfaces bind, unauthenticated API and WebSocket, unpinned CDN scripts, root test containers, self-tests running on import.

## 3. Rules that follow from this

1. Project code never runs directly on the host for validation. It runs in Tier 1 (cloud container) or a disposable VM.
2. Install-time network access is allowed only during image builds; tests run with `network_mode: none`.
3. `shap-e` and all Python packages must be pinned (commit hash and exact versions) before any GPU build.
4. Model weights are fetched once into a reviewed cache and mounted read-only; inference runs offline.
5. Generated-code execution (T4) is tested only in Tier 1 or a VM, never on the host.
6. Credentials: synthetic only until Phase 09 approval; then scoped keys through Docker secrets, never build args or image layers.
7. GPU work (Phase 08) starts with a minimal `torch.cuda` check in a container before any BrightForge code touches the GPU.
