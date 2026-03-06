# Multi-Model 3D Generation Architecture

**Status:** Validated and stable
**Tag:** `forge3d-multimodel-v1`
**Date:** March 5, 2026

## Overview

BrightForge's 3D generation pipeline now supports multiple mesh generation providers through a `UniversalMeshClient` provider chain. The architecture mirrors the existing `UniversalLLMClient` pattern for LLM routing, providing automatic fallback, budget tracking, and task-based routing for mesh generation.

## Architecture

```
Frontend (model selector + cost estimate)
    |
    v
POST /api/forge3d/generate
    |
    v
ForgeSession._runMesh() / _runFull()
    |
    v
UniversalMeshClient.generateMesh()
    |--- task routing (default, low_vram, premium, batch, fast)
    |--- provider chain: try preferred[] in order
    |--- budget check per provider
    |--- availability check (bridge state / API key)
    |
    +--- Local: modelBridge.generateMesh() --> Python inference server
    |       |--- Hunyuan3D (default, 12GB VRAM)
    |       |--- Shap-E (fallback, 4GB VRAM)
    |
    +--- Cloud: cloudMeshClient.generate() --> external API
            |--- Meshy.ai ($0.25/gen)
            |--- TencentCloud Hunyuan3D Pro ($0.10/gen)
```

## Components

| File | Purpose |
|------|---------|
| `config/mesh-providers.yaml` | Provider definitions, routing profiles, budget limits |
| `src/forge3d/universal-mesh-client.js` | Provider chain router with budget tracking |
| `src/forge3d/cloud-mesh-client.js` | Meshy.ai and TencentCloud API integrations |
| `python/shap_e_adapter.py` | Shap-E ModelAdapter for lightweight mesh generation |
| `src/forge3d/test-multi-model.js` | 73-assertion validation test suite |

## Provider Tiers

| Provider | Type | Tier | Cost | VRAM | Avg Time |
|----------|------|------|------|------|----------|
| Hunyuan3D | local | default | Free | 12GB | ~5 min |
| Shap-E | local | free | Free | 4GB | ~30s |
| Meshy.ai | cloud | premium | $0.25/gen | N/A | ~60s |
| TencentCloud | cloud | premium | $0.10/gen | N/A | ~2 min |

## Task Routing Profiles

- **default**: Hunyuan3D -> Shap-E, fallback: Meshy
- **low_vram**: Shap-E -> Meshy, fallback: TencentCloud
- **premium**: Hunyuan3D -> TencentCloud -> Meshy, fallback: Shap-E
- **batch**: Shap-E only, fallback: Meshy
- **fast**: Shap-E -> Meshy, fallback: Hunyuan3D

## Budget Enforcement

- Daily limit: $5.00 (configurable)
- Alert threshold: $2.50
- Local models always free (bypass budget checks)
- Automatic daily reset at midnight
- Projected cost checked before each cloud generation

## Frontend Integration

- Model selector shows tier labels and cost per generation
- Cost estimate displayed when paid model selected
- History cards show colored model badges (green=free, blue=default, orange=premium)
- Provider info fetched from `GET /api/forge3d/providers`

## Validation Results

| Metric | Value |
|--------|-------|
| Total Tests | 73 |
| Pass Rate | 100% |
| Test Scenarios | 15 |
| Categories | Config, Routing, Cloud Failure, Budget, Security, Integration |

Run with: `npm run test-multi-model`

## CI Protection

GitHub Actions workflow at `.github/workflows/tests.yml` runs on every push and PR to main:
- Lint check
- Core self-tests
- Multi-model architecture tests (73 assertions)
- Forge3D module self-tests
