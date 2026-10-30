# Branch Reconciliation Report

| Field | Value |
|---|---|
| Date | 2026-10-30 |
| Repository | `https://github.com/GrizzwaldHouse/BrightForge` |
| Inspected from | Linux cloud container (no access to the MSI or PowerSpec machines) |
| Tooling | git, Node v22.22.0, npm 10.9.4, Python 3.11.17, Docker 29.8.2 (daemon started inside the container) |
| Fetch | `git fetch --all --prune --tags` succeeded; all remote refs listed below are as of this fetch |
| Status | Inventory completed before any source change. Machine ownership still NOT established. Owner approved the baseline and pushing a repair branch (see section 7) |

## 1. Remote refs

| Ref | Tip | Tip date | Merge base with `origin/main` | main-only / ref-only | Unique patches (`git cherry`) |
|---|---|---|---|---|---|
| `origin/main` | `b69377f` | 2026-05-26 | — | 0 / 0 | — |
| `origin/feat/migrate-d-drive-untracked-work` | `16c98f2` | 2026-05-29 | `b69377f` (main tip) | 0 / 1 | 1 (`16c98f2`) |
| `origin/claude/brightforge-master-execution-UYu2k` | `be12e20` | 2026-05-07 | `46d1cd7` | 45 / 4 | 4 (`057c95e`, `8d562cd`, `05bf915`, `be12e20`) |
| `origin/claude/mcp-deepseek-integration-1ymcK` | `4e8175d` | 2026-02-21 | `e8183ab` (= tag `v4.2.0-alpha`) | 73 / 2 | 2 (`eca0dd3`, `4e8175d`) |
| tag `v4.2.0-alpha` | `e8183ab` | 2026-02-19 | ancestor of main | 73 / 0 | 0 |
| tag `v4.0.0-alpha` | `b21d5fb` | 2026-02-16 | **none (unrelated history)** | 78 / 20 | 20 (no subject matches on main) |

No branch, tag, commit message or tracked file names the MSI or PowerSpec computer.

## 2. What the history shows

### 2.1 Two working copies, merged repeatedly

Commit messages identify two working copies on Windows drives, a **C: copy** (`C:\Users\<user>\Projects\BrightForge`) and a **D: copy** (`D:\BrightForge`):

- `6bf9977` (2026-04-15) "merge Phase 11-13 from D:\"
- `737cf5b` (2026-04-16) "reconcile D:\ and C:\ repos"
- Main also has merge commits `1ad85a1`, `eebbb14`, `b751248` (April) and `b69377f` (May). In `b69377f` one side is a single local commit `468f0c5` ("wip: pre-japan"), and the other side holds the six May 8 commits (`0d448da` … `c558f47`). That shape is consistent with two copies pushing to the same `main`.

### 2.2 Contradiction about which copy is canonical

| Evidence | Date | Claim |
|---|---|---|
| `ARCHIVED.md`, added on main by `468f0c5` | dated 2026-04-17, committed 2026-05-26 | The C: copy is archived; **D: is canonical**. Points to commit `7abd9c6` and tag `v4.2.0-reconciled` |
| `16c98f2` message (branch `feat/migrate-d-drive-untracked-work`) | 2026-05-29 (newest commit anywhere) | D: was "2 commits behind C:" with unpushed local work; that work was copied into the **C: copy, now canonical**; "D:\BrightForge is now safe to delete" |
| `git cat-file -t 7abd9c6` | 2026-10-30 | **Not a valid object.** Tag `v4.2.0-reconciled` does not exist on the remote |

Interpretation:
- The newest evidence (`16c98f2`) supersedes `ARCHIVED.md`.
- However, `7abd9c6` / `v4.2.0-reconciled` were referenced as real and are **absent from GitHub**. They may exist only in a local repository (most likely the D: copy), or they may have been lost.
- **This is the one point that blocks a safe reconciliation.**

### 2.3 Mapping to MSI and PowerSpec

**Not establishable from the repository.** Git records no host names, and both copies commit as the same author. The C: and D: copies could be on the same computer or on different ones. The project notes mention an RTX 5080 and the use of `D:` storage, which hints that the D: copy is on the GPU desktop, but that is an inference, not evidence.

### 2.4 Unrelated early history (`v4.0.0-alpha`)

- Tag `v4.0.0-alpha` points to a 20-commit history (Phase 1 to Phase 8, 2026-02-10 to 02-16) whose root is `d1eebe8`. Main's root is `1dd8852` (2026-02-17); the two share no ancestor.
- The closest main commit to the tag's tree is `1dd8852` itself, differing in 18 paths, all modifications or additions and **no deletions**.
- So main was re-rooted from that history's tree and the content was carried forward. The 20 commits survive only through the tag. **Keep the tag. Do not merge the unrelated histories.**

### 2.5 The uploaded clean-room snapshot

The 385 files in `BrightForge-Clean-Room-Handoff-2026-10-09.zip/BrightForge/` are **byte-identical to `origin/main@b69377f`** (385 identical, 0 different). The main files absent from the snapshot are 5 local-memory files plus 2 submodule gitlinks. The snapshot does not include the newer `16c98f2`.

## 3. Unique work that must be preserved

| Ref | Unique content | Status |
|---|---|---|
| `16c98f2` (D: rescue) | 46 files: `src/integrations/*` (agentforge-bridge, firecrawl-client, model-knowledge-sync), `src/scripts/generate-and-validate-models.js`, `src/api/routes/{agentforge,integrations}.js`, 5 config files, UI panels, mockups, planning docs; edits to `forge3d-panel.js`, `inference_server.py`, `requirements.txt`, `reviewer-agent.js`, `forge3d.js`, `server.js`, `database.js`, `event-bus.js`, `index.html`, `app.js`, `API.md` | Fast-forward of main. It supplies the files whose absence broke three npm test scripts on main. **One rescued file is corrupt** (see section 5) |
| `eca0dd3`, `4e8175d` (MCP + DeepSeek) | New `src/mcp/{deepseek-provider,mcp-client,mcp-registry,mcp-server}.js`, `config/mcp-servers.yaml`, `docs/MCP-DEEPSEEK-ARCHITECTURE.md`, `.claude/skills/approval-enforcement.md`; edits to `CLAUDE.md`, `config/llm-providers.yaml` | Never merged; 73 commits behind. Needs an owner decision |
| `057c95e` … `be12e20` (UYu2k) | `engine/` C++ scaffold and docs | Never merged; its headers differ substantially from `src/core/*.h` on main (for example `QuoteSystem.h` +569/-214 lines ignoring CR). A prior review found a demo deadlock. Needs an owner decision |
| `v4.0.0-alpha` history | 20 early commits | Preserved by the tag only |

## 4. Recommendation

1. **Candidate baseline: `16c98f2`** (`origin/feat/migrate-d-drive-untracked-work`).
   - It is the newest commit and descends directly from `main`.
   - It contains the rescued D: work, and restores the three scripts that failed with MODULE_NOT_FOUND on main: they now exit 0.
   - **Adopt it only after the owner confirms** that no local-only commits exist on either machine, `7abd9c6` in particular. If any exist, push them to a new remote branch first; the plan then gains one merge step.
2. **Repair branch:** `repair/p0-recovery-2026-10`, created from the confirmed baseline.
3. **Recovery refs**, created before any history operation. They are lightweight annotated tags, pushed only with approval:
   - `recovery/2026-10-30/main` → `b69377f`
   - `recovery/2026-10-30/d-drive-rescue` → `16c98f2`
   - `recovery/2026-10-30/claude-uyu2k` → `be12e20`
   - `recovery/2026-10-30/mcp-deepseek` → `4e8175d`
   - (`v4.0.0-alpha` and `v4.2.0-alpha` already exist; leave them.)
4. **Integration plan:**
   - Repair commits go on the repair branch only.
   - The DeepSeek and engine branches stay untouched and unmerged. Each gets its own later review, merged commit by commit if accepted.
   - No rebase, reset, force-push or branch deletion.

## 5. Defects reproduced against the candidate baseline `16c98f2`

Run in a disposable copy (`git archive` output) inside the container. Evidence logs are kept outside the repo.

| # | Reported defect | Result | Evidence |
|---|---|---|---|
| 1 | `npm ci` fails on lockfile | **CONFIRMED** | `npm ci` exit 1: "Missing: @mendable/firecrawl-js@1.29.3 from lock file", "Missing: axios@1.21.0 …" |
| 2 | Shell injection via `POST /api/chat/revert/:commitHash` | **CONFIRMED** | HTTP 200 for hash `HEAD;touch <sentinel>`; the sentinel file was created. `git-checkpointer.js` interpolates into `execSync` |
| 3 | Binds to all interfaces without auth | **CONFIRMED** | Listening socket `00000000:0F07` (0.0.0.0:3847) |
| 4 | Importing `self-healing-orchestrator.js` hijacks other suites | **CONFIRMED** | `test-llm`, `test-api`, `test-queue`, `test-forge-session` all exit 0 with "[HEALING] 17 passed"; unguarded block at line 267 |
| 5 | three.js CDN files missing for the pinned version | **CONFIRMED** | `index.html:604-606` loads `three@0.171.0/build/three.min.js` and `examples/js/*`; the npm package 0.171.0 contains neither (checked against the registry file list on 2026-10-10). Lucide `@latest` unpinned (`:609`) |
| 6 | WebSocket bridge / dashboard path wrong | **CONFIRMED** | `bin/brightforge-server.js:103` calls `attach(server)` without the event bus. A client on `/` gets HTTP 400; `/ws/events` opens. Both `agent-pipeline-panel.js:199` and the new `pipeline-tasks-panel.js:112` use `/` |
| 7 | Jobs cannot reach dead-letter | **CONFIRMED** | No code sets `status = 'dead_letter'`; `GET /api/forge3d/queue` has no `deadLetterCount`; `test-forge3d-e2e` 4 passed / 1 failed on that check |
| 8 | Reviewer/tester randomness and simulated passes | **CONFIRMED** | `reviewer-agent.js:166-168,220-222` use `Math.random()`; `tester-agent.js:125-132` "simulated pass" with random duration |
| 9 | Optimised mesh discarded | **CONFIRMED (source)** | `/postprocess/optimize` returns `JSONResponse(result)` (`inference_server.py:628`) with no mesh bytes; `optimize-mesh.js:59` reads `result.buffer`/`result.optimizedBuffer`, so the value is null. Runtime not tested: no trimesh/torch in the container |
| 10 | `/api/projects/search` 404 | **CONFIRMED** | HTTP 404; called by `file-browser.js:123` |
| 11 | API reachable without auth | **CONFIRMED** | 200 for `/api/config`, `/api/forge3d/projects`, `/api/metrics`, `/api/forge3d/queue`, and the new `/api/agentforge/status` |
| 12 | `forceProvider` unused, budget incomplete | **CONFIRMED (source)** | Only use is `routes/chat.js:546`; `chatWithProvider` (`llm-client.js:528`) has no callers; `checkBudget` is called only at `:428`, not on the fallback path (`:470-492`) |
| 13 | Duplicate / conflicting C++ renderer folders | **CONFIRMED** | 34 C/C++/HLSL files in `src/core` (5), `src/rendering` (8), `src/ui` (11), `src/filesystem` (5), `Shaders` (6), no build file references them. Branch `engine/` is a third, different implementation |
| 14 | No SSM functionality | **CONFIRMED** | Zero hits for mamba/rwkv/hyena/jamba/ssm/state-space in `src`, `python`, `config` |

### New findings (not in the prior report)

| # | Finding | Evidence |
|---|---|---|
| N1 | **Corrupt rescued file:** `public/js/integrations-panel.js` ends with a duplicated fragment; it does not parse, so `npm run lint` fails | `node --check`: "SyntaxError: Unexpected token '?'" at line 400. The other 45 rescued files parse (JS, Python, JSON, YAML, HTML) |
| N2 | `.dockerignore` excludes `package-lock.json`, so a Docker build can never use `npm ci` | `.dockerignore` line 4 |
| N3 | Local agent memory and session state are tracked in the public repo | `.agentforge/audit_result.json`, `.brightforge/memory.json`, `.claude/HANDOFF.md`, `.claude/skill_usage.md`, `.omc/project-memory.json`, `.omc/state/*` |
| N4 | Machine-specific absolute paths in source | 1–2 occurrences each in `routes/{world,scene,prototype,playtest}.js`, `model-intelligence/{inventory-writer,database}.js`, `core/file-context.js`, `.omc/project-memory.json` |
| N5 | `ARCHIVED.md` on main is stale and contradicts the newest commit | Section 2.2 |

### Secret scan

- Patterns checked: OpenAI/Anthropic/Groq keys, AWS AKIA, GitHub PAT, Google API, private keys.
- **No secret-like values were found in the candidate tree or in any commit of any ref.**
- No `.env`, `.env.local` or `.env.production` file has ever been committed; only `*.example` files are tracked.
- No blob over 1 MB exists in history. Values were never printed.

## 6. What is needed from the owner

Run this on **each** computer (MSI and PowerSpec), in **each** BrightForge folder (C: copy and D: copy if both still exist). Keep the output private and paste back only what is asked.

```powershell
hostname
git rev-parse --show-toplevel
git status --short --branch
git fetch --all --prune
git branch -vv
git stash list
git log --oneline --all --not --remotes          # commits that exist ONLY on this machine
git cat-file -t 7abd9c6                          # does the "reconciled" commit exist here?
git tag -l "*reconciled*"
git rev-list --left-right --count HEAD...origin/main
git status --short --untracked-files=all | Measure-Object -Line   # count only
```

Decisions:
1. Which computer is MSI and which is PowerSpec, and which BrightForge folder is on each?
2. If `git log --all --not --remotes` prints anything, may those commits be pushed to a new branch such as `machine/<computer>-<date>` (no merge)?
3. Approve `16c98f2` as the repair baseline, or name another.
4. Approve pushing the four recovery tags and the repair branch (no merge to main).
5. Owner decision on the DeepSeek/MCP branch and the `engine/` branch: keep separate (recommended), or schedule a review for merge.

## 7. Decisions and actions after the inventory (2026-10-30)

Owner decisions:
- **Approved:** repair on `16c98f2`, and push the recovery references plus the repair branch. Never push to `main`.
- **Not answered:** the MSI/PowerSpec mapping and the machine evidence (section 6). These remain open.

| Action | Result |
|---|---|
| Annotated recovery tags created locally: `recovery/2026-10-30/{main,d-drive-rescue,claude-uyu2k,mcp-deepseek}` | Created |
| Push recovery tags | **Refused: HTTP 403 from the session's git proxy** (tag pushes are not permitted from this session; not routed around). The four remote branch tips they point to are unchanged. Owner can push them with the commands below |
| Repair branch `repair/p0-recovery-2026-10` created from `16c98f2` and pushed | Done; fast-forward descendant of `16c98f2`, which is a fast-forward descendant of `main@b69377f` |
| Branches `main`, `feat/migrate-d-drive-untracked-work`, `claude/brightforge-master-execution-UYu2k`, `claude/mcp-deepseek-integration-1ymcK`, tags `v4.0.0-alpha`, `v4.2.0-alpha` | Untouched (no rebase, reset, force-push or deletion) |
| Unique work not on the repair branch | DeepSeek/MCP (2 commits) and `engine/` scaffold (4 commits) remain on their own branches, unmerged, pending owner review |

Create the recovery tags from a machine that can push tags:

```bash
git fetch origin
git tag -a recovery/2026-10-30/main           b69377fdd8e48f71bf85733957541f346c988dd7 -m "Recovery point before P0 repair"
git tag -a recovery/2026-10-30/d-drive-rescue 16c98f2553dd9e90351dca02910e74fd88851224 -m "Recovery point before P0 repair"
git tag -a recovery/2026-10-30/claude-uyu2k   be12e206cdefc33255813c9ab0ae6f3f7c05ac83 -m "Recovery point before P0 repair"
git tag -a recovery/2026-10-30/mcp-deepseek   4e8175dbd4f320bfa1316d3b2c36b2718823edc7 -m "Recovery point before P0 repair"
git push origin 'refs/tags/recovery/2026-10-30/*'
```

Still required before merging the repair branch: run section 6 on both computers.
- If any machine has commits that exist only locally (in particular `7abd9c6` / `v4.2.0-reconciled`), push them to a new branch `machine/<computer>-<date>`.
- Then merge them into the repair branch with a normal merge. Rebase is not an option because the repair branch is already pushed.
