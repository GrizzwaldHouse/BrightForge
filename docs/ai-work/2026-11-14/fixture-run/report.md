# Static-crate cube fixture vs model_manager manifold reporting

Verdict: **PASS** (25/25 checks matched). Correlation id `fx-85574f4a9525`.

## Provenance
- Commit `e95b0393f0f21a90419bf215e81fe182075f4b44` (disposable detached checkout, no tracked or untracked changes before or after)
- Python 3.11.18, node v22.23.4, npm 10.9.9
- Dependencies (pinned by python/requirements-test.txt): fast_simplification==0.2.0, numpy==2.4.6, pillow==12.3.0, PyYAML==6.0.3, trimesh==5.2.0, xatlas==0.0.11
- Network namespace interfaces during the run: ['lo']; provider-style env vars present: []

## Per-edge incidence (oracle, plain Python) vs ModelManager.mesh_quality_report
- static_crate_cube: edges 18, incidence histogram {'2': 18}, boundary 0, non-manifold 0 []; model: V=8 F=12 manifold=True watertight=True boundary=0 non-manifold=0
- static_crate_cube_plus_one_triangle: edges 20, incidence histogram {'1': 2, '2': 17, '3': 1}, boundary 2, non-manifold 1 [[0, 1]]; model: V=9 F=13 manifold=False watertight=False boundary=2 non-manifold=1

## SHA-256
- `e0d8712773cb1c23cfdf85f0f9a13078321b35753f4f51fe5d874e7aeabfe841` static_crate_cube.glb
- `510b7ac343b222f59afdfc414e5dae1cc0113f53221e7ce709ec0d801d41553f` static_crate_cube_plus_one_triangle.glb

## Stage timings (single run, seconds) and memory
| stage | s | python peak alloc B |
|---|---|---|
| provenance | 0.456672 | 64966 |
| build_crate | 0.000104 | 1725 |
| build_variant | 0.000664 | 2275 |
| oracle_crate | 0.000255 | 5500 |
| oracle_variant | 0.000156 | 1930 |
| export_crate | 0.695177 | 16075897 |
| export_variant | 0.001591 | 25135 |
| sha256_crate | 0.000139 | 71900 |
| sha256_variant | 0.000085 | 71926 |
| import_model_manager | 0.251946 | 2002306 |
| construct_model_manager | 0.000436 | 6138 |
| mesh_quality_report_crate | 0.046072 | 202531 |
| mesh_quality_report_variant | 0.007066 | 62096 |
| trimesh_reference_crate | 0.002645 | 30576 |
| trimesh_reference_variant | 0.002577 | 30672 |

Process peak RSS: 63076 kB (high-water mark for the whole process, not per stage).

## Failures
none

## Skipped (not run, not claimed)
- UE 5.7 import or validation: not run, not claimed
- any provider/LLM/image/mesh model call: not run by design (no adapters loaded, network namespace empty)
- GPU/CUDA paths and Shap-E/Hunyuan/SDXL generation: not run
- UV unwrap (xatlas) and UV overlap report: not part of this comparison
