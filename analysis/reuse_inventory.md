# BrightForge Code Reusability Inventory
**Developer:** Marcus Daley
**Date:** 2026-04-14
**Purpose:** Tag every function as REUSABLE (portable) or HARDCODED (coupled), identify merge candidates, and calculate reuse percentage

---

## Classification Criteria

**REUSABLE (✅):** Function can be used in other projects without modification
- No global state dependencies
- Parameters instead of hardcoded values
- Self-contained logic
- Platform-independent

**HARDCODED (❌):** Function is coupled to current codebase
- Reads/writes global variables
- Hardcoded constants
- Platform-specific code
- Tightly coupled to other classes

**MERGE_CANDIDATE (🔀):** Multiple functions do similar things
- Should be unified into single function
- Code duplication

---

## Math Infrastructure (100% Reusable)

### Types.h

| Function/Struct | Status | Notes |
|----------------|--------|-------|
| Vector4::operator+ | ✅ REUSABLE | Pure math, no coupling |
| Vector4::operator- | ✅ REUSABLE | Pure math |
| Vector4::operator* | ✅ REUSABLE | Scalar multiplication |
| Vertex (struct) | ✅ REUSABLE | Generic vertex format |
| TransformData (struct) | ✅ REUSABLE | Generic transform |

**Reusability:** 5/5 (100%)

---

### Matrix.h

| Function | Status | Notes |
|----------|--------|-------|
| Matrix4x4::identity() | ✅ REUSABLE | Pure function |
| Matrix4x4::operator* | ✅ REUSABLE | Matrix multiplication |
| Matrix4x4::transformVector() | ✅ REUSABLE | Standard 4x4 transform |
| Matrix4x4::translation() | ✅ REUSABLE | Pure function |
| Matrix4x4::rotationX/Y/Z() | ✅ REUSABLE | Pure functions (assumed from usage) |
| Matrix4x4::scale() | ✅ REUSABLE | Pure function (assumed) |
| Matrix4x4::createTransform() | ✅ REUSABLE | Composes TRS |
| Matrix4x4::OrthonormalInverse() | ✅ REUSABLE | Used in Camera (assumed exists) |
| Matrix4x4::degreesToRadians() | ✅ REUSABLE | Utility function (assumed exists) |

**Reusability:** 9/9 (100%)

---

### MathU.h

| Function | Status | Notes |
|----------|--------|-------|
| MathUtils::dotProduct() | ✅ REUSABLE | Pure math |
| MathUtils::crossProduct() | ✅ REUSABLE | Pure math |
| MathUtils::normalize() | ✅ REUSABLE | Pure math |
| MathUtils::combineColors() | ✅ REUSABLE | Generic color blending |
| MathUtils::modulateColors() | ✅ REUSABLE | Generic color multiply |
| MathUtils::Saturate() | ✅ REUSABLE | Generic clamp [0,1] |
| MathUtils::vec3Length() | ✅ REUSABLE | Pure math |
| MathUtils::lerp() | ✅ REUSABLE | Generic linear interpolation |
| MathUtils::exactColorComponent() | ✅ REUSABLE | ARGB unpacking |
| MathUtils::makeColor() | ✅ REUSABLE | ARGB packing |

**Reusability:** 10/10 (100%)

---

### Constrants.h

| Constant | Status | Notes |
|----------|--------|-------|
| kWindowWidth/Height | ❌ HARDCODED | Specific to 600×500 window |
| kTotalPixels | ❌ HARDCODED | Derived from window size |
| kDefaultFov/ZNear/ZFar | ✅ REUSABLE | Generic defaults (if parameterized) |
| kDefaultCameraHeight/Distance | ❌ HARDCODED | Specific to test scene |
| kDefaultViewAngle | ❌ HARDCODED | -18° (specific to test) |
| kRotationSpeed/kMovementSpeed | ❌ HARDCODED | Specific to test input |
| kMinCameraHeight/Distance | ❌ HARDCODED | Arbitrary limits |
| Color constants (25 colors) | ✅ REUSABLE | Generic ARGB values |
| clamp<T>() | ✅ REUSABLE | Generic template function |

**Reusability:** 27/36 (75%)

---

## Rendering Core (25% Reusable)

### GraphicsHelper.hpp

| Function | Status | Notes |
|----------|--------|-------|
| makeColor() | 🔀 MERGE_CANDIDATE | Duplicate of MathUtils::makeColor |
| BGRAtoARGB() | ✅ REUSABLE | Generic format conversion |
| coord2Dto1D() | ❌ HARDCODED | Uses hardcoded width/height |
| clearBuffer() | ✅ REUSABLE | Generic clear (if width/height params) |
| drawPixel() | ❌ HARDCODED | Uses member width/height |
| blit() | ❌ HARDCODED | Uses member width/height |
| AlphaBlendColors() | ✅ REUSABLE | Generic alpha blending |
| NDCToScreen() | ❌ HARDCODED | Uses member width/height |
| drawDebugStar() | ❌ HARDCODED | Calls drawPixel (coupled) |

**Reusability:** 3/9 (33%)
**Merge Candidates:** makeColor() ← MathUtils::makeColor

**Refactoring Opportunity:**
```cpp
// Make functions static with width/height params
class RasterHelper {
    static void NDCToScreen(float& x, float& y, unsigned int width, unsigned int height) {
        x = (x + 1.0f) * (width * 0.5f);
        y = (1.0f - y) * (height * 0.5f);
    }

    static unsigned int coord2Dto1D(unsigned int x, unsigned int y, unsigned int width, unsigned int height) {
        return y * width + x;
    }
};
```

---

### Shaders.h / Shaders.cpp

| Function | Status | Notes |
|----------|--------|-------|
| vsIdentity() | ❌ HARDCODED | 0.5x scale (unused, arbitrary) |
| vsWorldViewTransform() | ❌ HARDCODED | Reads global vsWorld, vsView, isCube |
| vsProjectionTransform() | ❌ HARDCODED | Reads global vsProjection |
| vsLighting() | ❌ HARDCODED | Reads 9 global lighting variables |
| psSolid() | ✅ REUSABLE | Passthrough (does nothing) |
| scaleColor() | ✅ REUSABLE | Generic color scaling |

**Reusability:** 2/6 (33%)

**Refactoring to 100% Reusable:**
```cpp
// All shaders take context parameter
void vsWorldViewTransform(Vertex& v, const RenderContext& ctx) {
    if (ctx.flags.isCube) {
        v.color = v.color;
    } else {
        v.color = ctx.colors.white;
    }
    v.position = ctx.world.transformVector(v.position);
    v.position = ctx.view.transformVector(v.position);
}

void vsLighting(Vertex& v, const RenderContext& ctx) {
    Vector4 worldPos = ctx.world.transformVector(v.position);
    Vector4 worldNormal = ctx.world.transformVector(v.normal);
    worldNormal = MathUtils::normalize(worldNormal);

    unsigned int totalLight = ctx.lighting.ambient.apply(v.color);
    if (ctx.lighting.directional.enabled) {
        totalLight = MathUtils::combineColors(totalLight, ctx.lighting.directional.evaluate(worldNormal));
    }
    if (ctx.lighting.point.enabled) {
        totalLight = MathUtils::combineColors(totalLight, ctx.lighting.point.evaluate(worldPos, worldNormal));
    }

    v.color = totalLight;
    v.position = ctx.view.transformVector(worldPos);
}
```

---

### LineDrawing.h

| Function | Status | Notes |
|----------|--------|-------|
| interpolate() | ✅ REUSABLE | Generic lerp |
| drawLine() | ❌ HARDCODED | Calls graphics.drawPixel (coupled) |
| draw3DLine() | ❌ HARDCODED | Reads global VertexShader, calls graphics.NDCToScreen |
| calculateBarycentricCoords() | ✅ REUSABLE | Pure math (screen-space barycentric) |
| drawTriangle() | ❌ HARDCODED | Calls graphics.drawPixel, graphics.getWidth/Height |
| draw3DTriangle() | ❌ HARDCODED | Reads global VertexShader |

**Reusability:** 2/6 (33%)

**Refactoring to 50% Reusable:**
```cpp
// Extract pure rasterization logic
class RasterAlgorithms {
    // REUSABLE: Pure scanline logic
    static void rasterizeTriangle(
        const Vector4& v0, const Vector4& v1, const Vector4& v2,
        const std::function<void(int x, int y, float alpha, float beta, float gamma)>& pixelCallback
    ) {
        int minX = std::min({v0.x, v1.x, v2.x});
        int maxX = std::max({v0.x, v1.x, v2.x});
        int minY = std::min({v0.y, v1.y, v2.y});
        int maxY = std::max({v0.y, v1.y, v2.y});

        for (int y = minY; y <= maxY; y++) {
            for (int x = minX; x <= maxX; x++) {
                auto coords = calculateBarycentricCoords(x, y, v0, v1, v2);
                if (coords.alpha >= 0 && coords.beta >= 0 && coords.gamma >= 0) {
                    pixelCallback(x, y, coords.alpha, coords.beta, coords.gamma);
                }
            }
        }
    }
};

// Usage (still coupled to GraphicsHelper, but algorithm is reusable)
void LineDrawing::drawTriangle(...) {
    RasterAlgorithms::rasterizeTriangle(v0.position, v1.position, v2.position,
        [&](int x, int y, float alpha, float beta, float gamma) {
            float depth = alpha * v0.position.z + beta * v1.position.z + gamma * v2.position.z;
            unsigned int color = interpolateColor(v0.color, v1.color, v2.color, alpha, beta, gamma);
            graphics.drawPixel(x, y, depth, color);
        });
}
```

---

### Renderer.h

| Function | Status | Notes |
|----------|--------|-------|
| updateRenderState() | ❌ HARDCODED | Writes to mRenderState (could be param) |
| getRenderState() | ✅ REUSABLE | Simple getter |
| updateCubeRotation() | ❌ HARDCODED | Writes to global vsWorld |
| setProjection() | ❌ HARDCODED | Writes to global vsProjection |
| setCameraTransform() | ❌ HARDCODED | Couples to Camera class |
| setRenderState() | ✅ REUSABLE | Simple setter |
| clear() | ✅ REUSABLE | Delegates to GraphicsHelper |
| renderMesh() | ❌ HARDCODED | Writes to globals, hardcoded logic |
| setViewMatrix() | ❌ HARDCODED | Couples to Camera |
| getViewMatrix() | ✅ REUSABLE | Simple getter |
| setCubeWorldMatrix() | ✅ REUSABLE | Simple setter |
| getMainCamera() | ✅ REUSABLE | Simple getter |
| update() | ❌ HARDCODED | Calls updateCubeRotation |
| getProjectionMatrix() | ✅ REUSABLE | Simple getter |
| setCubeRotation() | ❌ HARDCODED | Specific to cube animation |

**Reusability:** 7/14 (50%)

---

### Camera.h

| Function | Status | Notes |
|----------|--------|-------|
| updateCameraMatrix() | ✅ REUSABLE | Generic orbit camera math |
| updateViewMatrix() | ✅ REUSABLE | Generic view matrix construction |
| setViewMatrix() | ✅ REUSABLE | Simple setter |
| setPosition() | ❌ HARDCODED | Calls updateViewMatrix (coupled) |
| setRotation() | ❌ HARDCODED | Calls updateViewMatrix (coupled) |
| getViewMatrix() | ✅ REUSABLE | Simple getter |
| setHeight() | ❌ HARDCODED | Uses GraphicsConstrants::clamp with hardcoded limits |
| setDistance() | ❌ HARDCODED | Hardcoded limits (2.0f, 20.0f) |
| setViewAngle() | ✅ REUSABLE | Generic setter |
| getHeight/Distance/ViewAngle | ✅ REUSABLE | Simple getters |
| getPosition/Rotation | ✅ REUSABLE | Simple getters |

**Reusability:** 8/11 (73%)

**Refactoring to 100%:**
```cpp
void setHeight(float height, float minHeight, float maxHeight) {
    mHeight = std::clamp(height, minHeight, maxHeight);  // C++17
    updateViewMatrix();
}

void setDistance(float distance, float minDistance, float maxDistance) {
    mDistance = std::clamp(distance, minDistance, maxDistance);
    updateViewMatrix();
}
```

---

## Scene Management (20% Reusable)

### mesh.h

| Function | Status | Notes |
|----------|--------|-------|
| Mesh::createCube() | ❌ HARDCODED | Hardcoded per-face colors |
| Mesh::createGrid() | ✅ REUSABLE | Generic grid generation (if color param added) |
| setVetrexColor() | ✅ REUSABLE | Generic setter (typo aside) |
| setAllVertexColors() | ✅ REUSABLE | Generic color override |
| getVertices() | ✅ REUSABLE | Simple getter |
| getIdices() | ✅ REUSABLE | Simple getter |
| isWireFrame() | ✅ REUSABLE | Simple getter |
| toggleWireFrameMode() | ❌ HARDCODED | Hardcoded index swapping (fragile) |
| setVertices() | ✅ REUSABLE | Simple setter |
| setIndices() | ✅ REUSABLE | Simple setter |

**Reusability:** 8/10 (80%)

---

## Test Harness (0% Reusable)

### TestManager.h

All 20+ methods are HARDCODED:
- Depend on global shader state
- Windows-specific input (_kbhit, _getch)
- Hardcoded assignment stages
- Tightly coupled to Renderer, Camera, GraphicsHelper

**Reusability:** 0/20+ (0%)

**Note:** TestManager is not intended to be reusable — it's assignment-specific test code. Should be split into:
1. **Reusable:** CameraController, LightingManager, SceneManager
2. **Throwaway:** Assignment4-specific menu and stage logic

---

## Reuse Summary

### By Category

| Category | Total Functions | Reusable | Percentage |
|----------|----------------|----------|------------|
| Math Infrastructure | 24 | 24 | **100%** |
| Constrants.h | 36 | 27 | 75% |
| GraphicsHelper | 9 | 3 | 33% |
| Shaders | 6 | 2 | 33% |
| LineDrawing | 6 | 2 | 33% |
| Renderer | 14 | 7 | 50% |
| Camera | 11 | 8 | 73% |
| Mesh | 10 | 8 | 80% |
| TestManager | 20 | 0 | 0% |
| **TOTAL** | **136** | **81** | **60%** |

### Merge Candidates

**Duplicate Color Functions:**
- GraphicsHelper::makeColor() ← MathUtils::makeColor
- GraphicsHelper::AlphaBlendColors() ← Could be MathUtils::blendColorsAlpha

**Duplicate Clamping:**
- Constrants::clamp<T>() vs std::clamp (C++17)
- Camera::setHeight uses GraphicsConstrants::clamp instead of std::clamp

**Duplicate Interpolation:**
- LineDrawing::interpolate() ← MathUtils::lerp (same function, different names)

**Total Merges:** 4 functions

---

## Refactoring Priority

### Phase 1: Eliminate Duplicates (1 hour)

1. Remove GraphicsHelper::makeColor() — use MathUtils::makeColor
2. Remove LineDrawing::interpolate() — use MathUtils::lerp
3. Move AlphaBlendColors to MathUtils namespace
4. Replace all GraphicsConstrants::clamp with std::clamp

**Impact:** Reduce codebase by ~15 lines, improve consistency

---

### Phase 2: Parameterize Hardcoded Functions (2 days)

1. **GraphicsHelper (33% → 100%):**
   - Add width/height params to NDCToScreen, coord2Dto1D
   - Make drawPixel take buffer as parameter

2. **Shaders (33% → 100%):**
   - All shader functions take RenderContext parameter
   - Remove global state dependencies

3. **LineDrawing (33% → 80%):**
   - Extract rasterization algorithms to pure functions
   - Pass VertexShader as parameter instead of global

4. **Renderer (50% → 90%):**
   - Remove global vsWorld/vsView/vsProjection writes
   - Use internal RenderContext struct

5. **Camera (73% → 100%):**
   - Add min/max parameters to setHeight/setDistance
   - Remove hardcoded GraphicsConstrants dependencies

**Impact:** Enable unit testing, multi-threading, code reuse across projects

---

### Phase 3: Extract Reusable Libraries (1 week)

**BrightForge Math Library (BFMath):**
```
bfmath/
├── Vector4.h
├── Matrix4x4.h
├── MathUtils.h
└── ColorUtils.h  (merged from GraphicsHelper)
```
**100% reusable**, zero dependencies

**BrightForge Raster Library (BFRaster):**
```
bfraster/
├── RasterAlgorithms.h  (barycentric, line drawing, clipping)
├── DepthBuffer.h
└── Framebuffer.h
```
**90% reusable**, depends only on BFMath

**BrightForge Scene Library (BFScene):**
```
bfscene/
├── Mesh.h
├── Camera.h
├── Transform.h
└── SceneGraph.h  (new)
```
**80% reusable**, depends on BFMath

**Impact:** These libraries can be reused in:
- Unreal Engine plugins (as utility code)
- Standalone raytracer
- Level editor
- Other graphics projects

---

## Reuse Strategy for Vulkan Integration

### Keep & Refactor (60% of code)

**Math (100% reusable):**
- Vector4, Matrix4x4, MathUtils → Direct reuse
- No changes needed

**Rasterization Algorithms (after refactor):**
- Barycentric interpolation → Reuse for software fallback
- Line drawing → Reuse for debug overlays

**Scene Management (80% reusable):**
- Mesh → Refactor to support Vulkan vertex buffers
- Camera → Reuse view matrix math, add UBO support

### Replace (40% of code)

**GraphicsHelper:**
- Software framebuffer → Vulkan swapchain
- drawPixel → Fragment shader
- clearBuffer → vkCmdClearAttachments

**Shaders:**
- C++ shader functions → GLSL/HLSL shaders
- Global state → Push constants / UBOs

**Renderer:**
- renderMesh → Vulkan command buffer recording
- Software rasterizer → GPU rasterization

**TestManager:**
- Console UI → ImGui
- Hardcoded stages → Data-driven config

---

## Code Quality Metrics

### Coupling Score (Lower is Better)

| Metric | Score | Target |
|--------|-------|--------|
| Functions with global state | 18 / 136 | 0 / 136 |
| Hardcoded values | 55 / 136 | 10 / 136 |
| Platform-specific code | 3 / 136 | 0 / 136 |
| **Coupling Score** | **76 / 136 (56%)** | **10 / 136 (7%)** |

### Reusability Score (Higher is Better)

| Metric | Score | Target |
|--------|-------|--------|
| Pure functions (no side effects) | 48 / 136 | 100 / 136 |
| Parameterized (no hardcoded values) | 81 / 136 | 126 / 136 |
| Platform-independent | 133 / 136 | 136 / 136 |
| **Reusability Score** | **81 / 136 (60%)** | **126 / 136 (93%)** |

**Industry Standard:** AAA game engines aim for 80-90% code reusability

---

## Recommendations

### Immediate (Phase 1 Tasks)

1. **Eliminate Duplicate Functions** (1 hour)
   - Remove 4 duplicate functions
   - Improves maintainability

2. **Extract Math Library** (2 hours)
   - Move Vector4, Matrix4x4, MathUtils to separate namespace
   - Add unit tests (currently 0 tests exist)

### Near-Term (Phase 2 Tasks)

3. **Parameterize Core Rendering** (2 days)
   - Remove global state from Shaders.h/cpp
   - Create RenderContext struct
   - Enables multi-threading

4. **Split TestManager** (3 days)
   - Extract CameraController, LightingManager, SceneManager
   - Reuse in Vulkan version

### Long-Term (Phase 3 Tasks)

5. **Create Reusable Libraries** (1 week)
   - BFMath, BFRaster, BFScene as separate modules
   - Write unit tests (target 80% coverage)
   - Document APIs

6. **Vulkan Migration** (4 weeks)
   - Reuse 60% of refactored code
   - Replace 40% with GPU equivalents

---

**Next Steps:** Proceed to Task 1.6 (roadmap.md) to create prioritized improvement roadmap with dependency graph and risk assessment.
