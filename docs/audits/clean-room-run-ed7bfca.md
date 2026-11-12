# Clean-Room Run at `ed7bfca` (2026-11-12)

| Field | Value |
|---|---|
| Source | `git archive ed7bfca` into an empty directory (no copy of C: or D:; no `.env` files present) |
| Snapshot hashes (sha256) | `package-lock.json` `4dbf4f75…`, `Dockerfile` `89590486…`, `docker-compose.yml` `34bce6f8…` |
| Where | Linux cloud container, Docker 29.9.2. Nothing ran on the PowerSpec |
| Build network | Used only while building images (npm, PyPI); proxy CA passed as a BuildKit secret |
| Run network | `none` |
| Images | `brightforge-test:local` (`sha256:722cc68a…`, user `node`), `brightforge-python-test:local` (`sha256:eae22aae…`, user `tester`) |
| Layer check | `docker history --no-trunc` contains no proxy URL or certificate material (0 matches, both images) |

## Results

| Run | Command | Exit | Result |
|---|---|---|---|
| Deterministic Node suite | `docker compose --profile test run --rm --no-deps --pull never brightforge-test` | 0 | **90/90 passed** (86 at `733f643`; 4 scripts added by PRs #2 to #4) |
| Python tests, first run | `docker compose --profile test run --rm --no-deps --pull never brightforge-python-test` | 1 | 14 tests, **4 errors**: `ModuleNotFoundError: No module named 'xatlas'` |
| Python tests, after pinning `xatlas` | same | 1 | 14 tests, **1 error**: `ModuleNotFoundError: No module named 'PIL'` (GLB export with a texture material) |
| Python tests, after pinning Pillow | same | 0 | **14/14 OK** |

## Defect found and fixed

`python/tests/test_mesh_quality.py` (added in `2bca607`) needs `xatlas` and Pillow. Neither was in `python/requirements-test.txt`, so the `python-test` image could not run it. The CI `python-mesh` job installed `xatlas` but not Pillow, so one test would fail there too.

Fix in this commit:
- `python/requirements-test.txt`: `xatlas==0.0.11`, `pillow==12.3.0`.
- `.github/workflows/tests.yml` (`python-mesh` job): add `Pillow>=11.0.0`, matching `python/requirements.txt`.

## Not covered by this run

Everything that needs a GPU, a running Python inference server, Windows, a display, live Ollama or real provider keys. See `sandbox-design.md` tiers 2 to 4.
