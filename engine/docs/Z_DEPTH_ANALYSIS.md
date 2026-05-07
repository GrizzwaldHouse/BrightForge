# Z-DEPTH PRECISION ANALYSIS

## The Problem in Plain English

When a 3D engine draws two triangles that are almost the same distance from the camera, the depth buffer decides which one is "in front." The problem is that standard depth buffers waste most of their precision on objects close to the camera and have almost none left for objects far away. This causes **Z-fighting** -- flickering, shimmering surfaces where two objects overlap at a distance.

The standard [0, 1] depth range packs ~90% of its floating-point precision into the first 10% of the view distance. A scene with a near plane at 0.1 and a far plane at 10000 has roughly 24 bits of precision at 1 meter, but only ~2 bits of precision at 5000 meters. Reversed-Z flips this distribution so that far objects get the lion's share of precision, which matches how floating-point numbers naturally distribute their mantissa bits.

## Issue Map Across Both Renderers

### Vulkan Hardware Path

| ID | Issue | Location | Severity |
|---|---|---|---|
| **V1** | Depth buffer clears to 1.0 (standard Z) | `vkCmdBeginRenderPass` clear values | High |
| **V2** | Depth comparison uses `VK_COMPARE_OP_LESS` | `CreateVkPipelineDepthStencilStateCreateInfo()` | High |
| **V3** | Viewport depth range is `minDepth=0.0, maxDepth=1.0` | `CreateViewportFromWindowDimensions()` | High |
| **V4** | Near/far planes are conservative (0.1 / 1000.0) | `InitializeProjectionMatrix()` | Medium |

### Software Rasterizer Path

| ID | Issue | Location | Severity |
|---|---|---|---|
| **S1** | Depth test assumes standard Z ordering | Triangle rasterizer depth comparison | High |
| **S2** | No config flag to switch between standard and reversed Z | Hardcoded in rasterizer | Medium |

## DETAILED FIX: Reversed-Z for Vulkan Pipeline

### Fix 1: Clear Depth Buffer to 0.0 (was 1.0)

In reversed-Z, "infinitely far away" is depth 0.0 and "right at the camera" is depth 1.0. The clear value must match "farthest possible."

**Current code:**
```cpp
// In render pass begin info -- clear values
VkClearValue clearValues[2];
clearValues[0].color = { {0.0f, 0.0f, 0.0f, 1.0f} };  // color clear
clearValues[1].depthStencil = { 1.0f, 0 };               // depth clear to 1.0
```

**Fixed code:**
```cpp
// REVERSED-Z: Clear depth to 0.0 (farthest) instead of 1.0
VkClearValue clearValues[2];
clearValues[0].color = { {0.0f, 0.0f, 0.0f, 1.0f} };  // color clear
clearValues[1].depthStencil = { 0.0f, 0 };               // depth clear to 0.0
```

### Fix 2: Swap Depth Comparison from LESS to GREATER

With reversed-Z, closer objects have *larger* depth values, so the "pass if closer" test becomes GREATER instead of LESS.

**Current code:**
```cpp
VkPipelineDepthStencilStateCreateInfo depthStencil = {};
depthStencil.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
depthStencil.depthTestEnable = VK_TRUE;
depthStencil.depthWriteEnable = VK_TRUE;
depthStencil.depthCompareOp = VK_COMPARE_OP_LESS;  // standard Z
depthStencil.depthBoundsTestEnable = VK_FALSE;
depthStencil.stencilTestEnable = VK_FALSE;
```

**Fixed code:**
```cpp
VkPipelineDepthStencilStateCreateInfo depthStencil = {};
depthStencil.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
depthStencil.depthTestEnable = VK_TRUE;
depthStencil.depthWriteEnable = VK_TRUE;
depthStencil.depthCompareOp = VK_COMPARE_OP_GREATER;  // REVERSED-Z
depthStencil.depthBoundsTestEnable = VK_FALSE;
depthStencil.stencilTestEnable = VK_FALSE;
```

### Fix 3: Swap Viewport Depth Values

The viewport's `minDepth` and `maxDepth` define the output range for the depth pipeline stage. Swapping them inverts the mapping.

**Current code:**
```cpp
VkViewport viewport = {};
viewport.x = 0.0f;
viewport.y = 0.0f;
viewport.width = (float)windowWidth;
viewport.height = (float)windowHeight;
viewport.minDepth = 0.0f;  // standard: near maps to 0
viewport.maxDepth = 1.0f;  // standard: far maps to 1
```

**Fixed code:**
```cpp
VkViewport viewport = {};
viewport.x = 0.0f;
viewport.y = 0.0f;
viewport.width = (float)windowWidth;
viewport.height = (float)windowHeight;
viewport.minDepth = 1.0f;  // REVERSED-Z: near maps to 1
viewport.maxDepth = 0.0f;  // REVERSED-Z: far maps to 0
```

### Fix 4: Use Aggressive Near/Far Planes

With reversed-Z, you can push the near plane extremely close and the far plane extremely far without losing precision. This eliminates the need to carefully tune near/far to avoid Z-fighting.

**Current code:**
```cpp
float nearPlane = 0.1f;
float farPlane = 1000.0f;
// Perspective projection matrix using these values
```

**Fixed code:**
```cpp
float nearPlane = 0.00001f;   // 10 micrometers -- effectively zero
float farPlane = 10000.0f;    // 10 kilometers -- effectively infinite
// These extreme values are safe with reversed-Z because precision
// is distributed where it matters (near the camera)
```

These values are defined in `RenderConfig.h` so they can be tuned per-project without recompiling.

## VERIFICATION

After applying all 4 fixes, verify with the following tests:

1. **Z-fighting test** -- Place two coplanar quads at distance 500 units from camera. With standard Z, they should flicker. With reversed-Z, they should render cleanly with the correct one in front.

2. **Near-clip test** -- Place an object at 0.001 units from camera. With standard Z and near=0.1, the object clips. With reversed-Z and near=0.00001, the object renders correctly.

3. **Far-distance test** -- Place two objects at 8000 and 8001 units from camera. With standard Z, they Z-fight. With reversed-Z, they sort correctly.

4. **Depth buffer visualization** -- Enable `showDepthBuffer` in RenderConfig. With standard Z, the depth image should appear almost entirely white (all precision used up near camera). With reversed-Z, the depth gradient should be visibly smoother across the entire view distance.

## SOFTWARE RASTERIZER DEPTH ISSUES

### S1: Config-Driven Depth Mode

The software rasterizer's depth test must respect the `reversedZ` flag in RenderConfig:

```cpp
// Config-driven depth comparison
bool DepthTest(float incomingDepth, float bufferDepth, bool reversedZ) {
    if (reversedZ) {
        // Reversed-Z: closer objects have LARGER depth values
        return incomingDepth > bufferDepth;
    } else {
        // Standard Z: closer objects have SMALLER depth values
        return incomingDepth < bufferDepth;
    }
}

// Config-driven depth buffer clear
float GetClearDepth(bool reversedZ) {
    if (reversedZ) {
        return 0.0f;  // Farthest possible in reversed-Z
    } else {
        return 1.0f;  // Farthest possible in standard Z
    }
}
```

This ensures both renderers behave identically regardless of which depth mode is active, and allows toggling at runtime for debugging.

## Lab 7 Task B3: Rotating Light Direction

The sun direction should rotate over time so the lighting changes dynamically. This verifies that the depth buffer handles varying shadow angles without artifacts.

```cpp
// In the Render() function, compute elapsed time rotation
float elapsed = /* seconds since application start */;

// Rotate light direction around the Y axis
float lightAngle = elapsed * 0.5f;  // radians per second
float sunDirX = cosf(lightAngle);
float sunDirY = -0.5f;              // angled downward
float sunDirZ = sinf(lightAngle);

// Normalize
float len = sqrtf(sunDirX * sunDirX + sunDirY * sunDirY + sunDirZ * sunDirZ);
sunDirX /= len;
sunDirY /= len;
sunDirZ /= len;

// Update the UBO or push constant with the new direction
lightingData.sunDirection[0] = sunDirX;
lightingData.sunDirection[1] = sunDirY;
lightingData.sunDirection[2] = sunDirZ;
```

This creates a slow, continuous orbit of the light source. Combined with the depth buffer fixes, shadows should remain crisp at all distances.

## Why Reversed-Z Works

The key insight is how IEEE 754 floating-point numbers distribute their precision.

A 32-bit float has 23 mantissa bits. The **absolute precision** of a float depends on its **exponent** -- numbers near 0 have extremely fine granularity, while numbers near 1 have coarser granularity.

In a standard [0, 1] depth buffer:
- Near plane maps to **0.0** (high float precision)
- Far plane maps to **1.0** (low float precision)
- Objects near the camera get depth values near 0.0 (lots of precision -- wasted, because close objects rarely Z-fight)
- Objects far from the camera get depth values near 1.0 (almost no precision -- exactly where Z-fighting happens)

In a reversed [1, 0] depth buffer:
- Near plane maps to **1.0**
- Far plane maps to **0.0** (high float precision)
- Objects far from the camera get depth values near 0.0 (maximum float precision -- exactly where it is needed)
- Objects near the camera get depth values near 1.0 (less precision, but close objects have large depth differences so it does not matter)

The mathematical result: reversed-Z with a 32-bit float depth buffer provides roughly **log2(far/near)** bits of effective precision uniformly across the entire view range. With near=0.00001 and far=10000, this gives ~30 bits of usable precision everywhere, compared to ~10 bits at far distances with standard Z.

## Assembly Optimization Note

The per-pixel depth test in the software rasterizer is the single hottest loop in the entire rendering pipeline. SIMD acceleration can test 4 pixels simultaneously:

```asm
; SSE depth test for 4 pixels at once (reversed-Z: GREATER comparison)
; xmm0 = incoming depth values (4 floats)
; xmm1 = buffer depth values (4 floats)
; Result: xmm2 = mask of pixels that pass depth test

movaps  xmm2, xmm0         ; copy incoming depths
cmpps   xmm2, xmm1, 6      ; compare: NLE (not less-or-equal) = GREATER
                             ; xmm2 now has 0xFFFFFFFF for pass, 0x00000000 for fail
movmskps eax, xmm2          ; extract mask to integer register
; eax bits [3:0] indicate which of the 4 pixels passed
```

This replaces 4 scalar comparisons and branches with a single SIMD instruction, which is critical when the rasterizer is processing millions of fragments per frame.

## SQL Note

For profiling and debugging depth issues, log depth statistics to a SQLite table:

```sql
CREATE TABLE depth_stats (
    frame_id     INTEGER PRIMARY KEY,
    timestamp    TEXT NOT NULL,
    min_depth    REAL,    -- minimum depth value written this frame
    max_depth    REAL,    -- maximum depth value written this frame
    avg_depth    REAL,    -- average depth value across all fragments
    zfight_count INTEGER, -- number of pixels where depth delta < epsilon
    clear_depth  REAL,    -- depth clear value used (0.0 or 1.0)
    reversed_z   INTEGER  -- 1 if reversed-Z was active, 0 if standard
);
```

Query to find frames with likely Z-fighting:

```sql
SELECT frame_id, zfight_count, min_depth, max_depth
FROM depth_stats
WHERE zfight_count > 100
ORDER BY zfight_count DESC
LIMIT 20;
```
