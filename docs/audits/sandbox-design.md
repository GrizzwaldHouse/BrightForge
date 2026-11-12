# Sandbox Design: BrightForge Clean-Room Validation

| Field | Value |
|---|---|
| Source of truth | `repair/p0-recovery-2026-10` at `ed7bfca` (approved 2026-11-12) |
| Snapshot method | `git archive <commit>` into an empty directory; never a copy of C: or D: |
| Status | Tier 1 built and run (see `clean-room-run-ed7bfca.md`). Tiers 2 to 4 designed, not executed |

## 1. Tiers

| Tier | Where | Used for | Approval |
|---|---|---|---|
| 1 | Cloud container (Linux), Docker `test` and `python-test` profiles | Lint, unit, integration, regression and security tests; backend with fake providers; adversarial tests at low load | Granted (approval 3) |
| 2 | Disposable Windows VM (Hyper-V or Windows Sandbox) on the PowerSpec | Electron desktop app, `py` launcher, model scanner, `C:\` paths, UE5 plugin | Pending; Hyper-V availability not yet confirmed |
| 3 | WSL 2 + Docker Desktop on the PowerSpec with `--gpus 1` | Minimal CUDA check, then one Forge3D generation | Pending (Phase 08) |
| 4 | Tier 1 or 3 with an outbound allow-list | One request per real LLM/image provider | Pending (Phase 09) |

## 2. Tier 1 controls (as implemented in `docker-compose.yml`)

| Control | `brightforge-test` | `brightforge-python-test` |
|---|---|---|
| User | `node` (uid 1000) | `tester` (uid 1000) |
| Root filesystem | read-only | read-only |
| Writable paths | tmpfs only, size-limited | tmpfs `/tmp` |
| Network at run time | `none` | `none` |
| Capabilities | `cap_drop: ALL`, `no-new-privileges` | same |
| Privileged / Docker socket / host mounts | no / no / no | no / no / no |
| Limits | 2 CPU, 2 GB, 512 PIDs, 300 s per script | 1 CPU, 1 GB, 256 PIDs |
| Secrets | none | none |
| Base images | digest-pinned | digest-pinned |

Build-time network is used only to fetch npm and PyPI packages. A TLS-intercepting proxy CA, where needed, is passed as a BuildKit secret and is not stored in any layer (checked with `docker history --no-trunc`).

## 3. Tier 3 (GPU) plan, for approval

1. On the PowerSpec, confirm `docker run --rm --gpus 1 nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi` works. No BrightForge code involved.
2. Build a minimal image with pinned PyTorch (CUDA 12.8 build) and run `torch.cuda.is_available()` and one matrix multiply. Network off at run time.
3. Pin `shap-e` to a commit and every Python package to exact versions; fetch model weights once into a cache volume; review sizes and sources.
4. Run the `python-server` image as a non-root user, cache mounted read-only, published on `127.0.0.1` only, network off during inference.
5. One small generation; validate the GLB with the checks in `python/tests/test_mesh_postprocess.py`.

No drivers or system packages are installed on the host by this plan.

## 4. Tier 2 (Windows VM) plan, for approval

- Requires Hyper-V or Windows Sandbox (check in an elevated prompt).
- Source copied in from a `git archive` zip; no shared folders; NAT network only while installing; VM discarded after each run.
