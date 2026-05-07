# Z-Depth Precision Fix - Task Breakdown

**Context:** Lab 7 Section B - Reversed-Z depth buffering implementation
**Status:** PENDING

> **CRITICAL WARNING:** Tasks Z1, Z2, and Z3 MUST be applied together as an atomic change. Applying any one without the others will produce incorrect rendering (objects invisible, inverted depth, or z-fighting). Do not commit or test partial application of these three tasks.

---

## Task Z1: Change Depth Clear Value

| Field | Value |
|-------|-------|
| Priority | CRITICAL |
| Status | PENDING |
| Dependencies | None |
| Location | `main.cpp`, line 51 |
| Atomic Group | Z1 + Z2 + Z3 (must apply together) |

### Description

Change the depth buffer clear value from `1.0f` to `0.0f` for reversed-Z. In standard depth, far plane = 1.0 and near plane = 0.0. Reversed-Z flips this: far plane = 0.0 and near plane = 1.0. The clear value must match the far plane.

### Change

```cpp
// BEFORE (standard depth):
clearValues[1].depthStencil = { 1.0f, 0 };

// AFTER (reversed-Z):
clearValues[1].depthStencil = { 0.0f, 0 };
```

### Why Reversed-Z?

Standard floating-point depth loses precision at distance because float32 has more precision near 0 than near 1. Reversed-Z maps the near plane to 1.0 and far plane to 0.0, putting more floating-point precision where it matters most (distant objects), dramatically reducing z-fighting artifacts.

### Acceptance Criteria

- [ ] Depth clear value changed from `1.0f` to `0.0f`
- [ ] Change applied at `main.cpp` line 51 (or equivalent clear value location)
- [ ] Applied simultaneously with Z2 and Z3

---

## Task Z2: Swap Depth Comparison Operator

| Field | Value |
|-------|-------|
| Priority | CRITICAL |
| Status | PENDING |
| Dependencies | None |
| Location | `renderer.h` (depth stencil state) |
| Atomic Group | Z1 + Z2 + Z3 (must apply together) |

### Description

Swap the depth comparison operator from `VK_COMPARE_OP_LESS` to `VK_COMPARE_OP_GREATER` and swap the depth bounds to match.

### Change

```cpp
// BEFORE (standard depth - closer objects have LESS depth):
depthStencilState.depthCompareOp = VK_COMPARE_OP_LESS;
depthStencilState.minDepthBounds = 0.0f;
depthStencilState.maxDepthBounds = 1.0f;

// AFTER (reversed-Z - closer objects have GREATER depth):
depthStencilState.depthCompareOp = VK_COMPARE_OP_GREATER;
depthStencilState.minDepthBounds = 0.0f;
depthStencilState.maxDepthBounds = 1.0f;
```

### Explanation

With reversed-Z, closer objects have depth values closer to 1.0 and farther objects have values closer to 0.0. Therefore, a fragment passes the depth test when its depth is GREATER than the stored value (meaning it is closer to the camera).

### Acceptance Criteria

- [ ] `depthCompareOp` changed from `VK_COMPARE_OP_LESS` to `VK_COMPARE_OP_GREATER`
- [ ] Depth bounds swapped appropriately
- [ ] Applied simultaneously with Z1 and Z3

---

## Task Z3: Reverse Viewport Depth Range

| Field | Value |
|-------|-------|
| Priority | CRITICAL |
| Status | PENDING |
| Dependencies | None |
| Location | `renderer.h` (viewport configuration) |
| Atomic Group | Z1 + Z2 + Z3 (must apply together) |

### Description

Reverse the viewport depth range so that `minDepth = 1.0f` and `maxDepth = 0.0f`.

### Change

```cpp
// BEFORE (standard depth):
viewport.minDepth = 0.0f;
viewport.maxDepth = 1.0f;

// AFTER (reversed-Z):
viewport.minDepth = 1.0f;
viewport.maxDepth = 0.0f;
```

### Explanation

The viewport depth range defines the mapping from NDC z-coordinates to framebuffer depth values. By setting `minDepth = 1.0` and `maxDepth = 0.0`, Vulkan maps the NDC near plane (z=0) to depth 1.0 and the NDC far plane (z=1) to depth 0.0, completing the reversed-Z setup.

Note: Vulkan explicitly allows `minDepth > maxDepth` (unlike OpenGL), making this a valid and well-defined configuration.

### Acceptance Criteria

- [ ] `viewport.minDepth` changed from `0.0f` to `1.0f`
- [ ] `viewport.maxDepth` changed from `1.0f` to `0.0f`
- [ ] Applied simultaneously with Z1 and Z2

---

## Task Z4: Set Aggressive Near/Far Planes

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Z1, Z2, Z3 |
| Location | `renderer.h` (projection setup) |

### Description

Set aggressive near and far plane values to maximize the usable depth range. Reversed-Z enables extreme near/far ratios without z-fighting.

### Change

```cpp
// BEFORE (conservative):
float nearPlane = 0.1f;
float farPlane = 100.0f;

// AFTER (aggressive - reversed-Z handles this without z-fighting):
float nearPlane = 0.00001f;
float farPlane = 10000.0f;
```

### Why This Works

With standard depth, a near/far ratio of 1:1,000,000,000 would cause severe z-fighting. With reversed-Z and float32 depth, the precision distribution is inverted, giving excellent depth resolution even at extreme distances. A near plane of 0.00001 and far plane of 10000 yields a ratio of 1:1,000,000,000 which is perfectly usable with reversed-Z.

### Acceptance Criteria

- [ ] `nearPlane` set to `0.00001f`
- [ ] `farPlane` set to `10000.0f`
- [ ] No z-fighting visible at any distance

---

## Task Z5: Add Rotating Light Direction

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Z1, Z2, Z3 |
| Location | `renderer.h` or main render loop |

### Description

Add a time-based rotating light direction using `<chrono>` for elapsed time, rotating around the Y-axis.

### Implementation

```cpp
#include <chrono>

// In render loop or update function:
static auto startTime = std::chrono::high_resolution_clock::now();

auto currentTime = std::chrono::high_resolution_clock::now();
float elapsed = std::chrono::duration<float>(currentTime - startTime).count();

// Rotate light direction around Y-axis
float lightAngle = elapsed * 0.5f; // 0.5 radians per second
glm::vec3 lightDir = glm::normalize(glm::vec3(
    cosf(lightAngle),   // X: oscillates
    -0.5f,              // Y: slightly downward (fixed)
    sinf(lightAngle)    // Z: oscillates
));

// Pass to shader uniforms
shaderVars.lightDirection = lightDir;
```

### Acceptance Criteria

- [ ] Light rotates smoothly around Y-axis using elapsed time
- [ ] Light direction is normalized before passing to shader
- [ ] `shaderVars` updated each frame with new direction
- [ ] Rotation speed is reasonable (visible but not disorienting)

---

## Task Z6: Add QuoteSystem and DebugWindow Integration

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Z1-Z5 |
| Location | Multiple files |

### Description

Add logging through `QuoteSystem` and `DebugWindow` for all depth configuration changes, and add `TestManager` test cases to verify depth settings.

### Logging

```cpp
// After depth config is applied:
QuoteSystem::log("DEPTH", "Reversed-Z enabled: clearValue=%.1f, compareOp=GREATER, viewport=[%.1f, %.1f]",
    clearValue, viewport.minDepth, viewport.maxDepth);

DebugWindow::append("[Z-DEPTH] Near=%.6f Far=%.1f Ratio=%.0f:1",
    nearPlane, farPlane, farPlane / nearPlane);

DebugWindow::append("[Z-DEPTH] Light direction: (%.2f, %.2f, %.2f)",
    lightDir.x, lightDir.y, lightDir.z);
```

### TestManager Tests

```cpp
TestManager::add("ZDepth_clear_value_is_zero", []() {
    auto config = Renderer::getDepthConfig();
    ASSERT(config.clearValue == 0.0f);
});

TestManager::add("ZDepth_compare_op_is_greater", []() {
    auto config = Renderer::getDepthConfig();
    ASSERT(config.compareOp == VK_COMPARE_OP_GREATER);
});

TestManager::add("ZDepth_viewport_reversed", []() {
    auto config = Renderer::getDepthConfig();
    ASSERT(config.viewportMinDepth == 1.0f);
    ASSERT(config.viewportMaxDepth == 0.0f);
});

TestManager::add("ZDepth_near_far_aggressive", []() {
    auto config = Renderer::getDepthConfig();
    ASSERT(config.nearPlane <= 0.0001f);
    ASSERT(config.farPlane >= 10000.0f);
});

TestManager::add("ZDepth_light_direction_normalized", []() {
    auto lightDir = Renderer::getLightDirection();
    float length = sqrtf(lightDir.x * lightDir.x + lightDir.y * lightDir.y + lightDir.z * lightDir.z);
    ASSERT(fabsf(length - 1.0f) < 0.001f);
});
```

### Acceptance Criteria

- [ ] QuoteSystem logs depth configuration on startup
- [ ] DebugWindow shows near/far plane ratio
- [ ] DebugWindow shows current light direction
- [ ] All 5 TestManager tests pass
- [ ] Logging does not impact frame rate (no per-frame string allocations)

---

## Task Z7: Software Rasterizer Depth Mode (Optional)

| Field | Value |
|-------|-------|
| Priority | LOW |
| Status | PENDING (Optional) |
| Dependencies | Z1-Z3 |
| Location | `GraphicsHelper.hpp` |

### Description

Add a `DepthMode` enum to the software rasterizer in `GraphicsHelper.hpp` so it can match the hardware renderer's reversed-Z behavior.

### Implementation

```cpp
// In GraphicsHelper.hpp:
enum class DepthMode {
    Standard,   // Near=0.0, Far=1.0, compare=LESS
    ReversedZ   // Near=1.0, Far=0.0, compare=GREATER
};

class GraphicsHelper {
public:
    void setDepthMode(DepthMode mode) {
        m_depthMode = mode;
        if (mode == DepthMode::ReversedZ) {
            m_depthClearValue = 0.0f;
            m_depthCompareFunc = [](float incoming, float stored) {
                return incoming > stored; // GREATER
            };
        } else {
            m_depthClearValue = 1.0f;
            m_depthCompareFunc = [](float incoming, float stored) {
                return incoming < stored; // LESS
            };
        }
    }

    DepthMode depthMode() const { return m_depthMode; }

private:
    DepthMode m_depthMode = DepthMode::Standard;
    float m_depthClearValue = 1.0f;
    std::function<bool(float, float)> m_depthCompareFunc;
};
```

### Acceptance Criteria

- [ ] `DepthMode` enum defined with `Standard` and `ReversedZ` values
- [ ] `setDepthMode()` configures clear value and compare function
- [ ] Software rasterizer uses `m_depthCompareFunc` instead of hardcoded comparison
- [ ] Default mode remains `Standard` for backward compatibility

---

## Verification Checklist

After applying all changes, verify the following 7 items:

| # | Verification | How to Check | Status |
|---|-------------|--------------|--------|
| 1 | Depth clear value is `0.0f` | Inspect `clearValues[1].depthStencil.depth` in debugger | [ ] |
| 2 | Depth compare op is `VK_COMPARE_OP_GREATER` | Inspect `depthStencilState.depthCompareOp` in debugger | [ ] |
| 3 | Viewport minDepth=`1.0f`, maxDepth=`0.0f` | Inspect `viewport.minDepth` and `viewport.maxDepth` | [ ] |
| 4 | Near plane is `0.00001f`, far plane is `10000.0f` | Inspect projection matrix setup | [ ] |
| 5 | Objects render correctly (not invisible, not inverted) | Visual inspection: cube/model visible, correct face culling | [ ] |
| 6 | No z-fighting at any camera distance | Zoom in close and zoom out far, inspect overlapping surfaces | [ ] |
| 7 | Light rotates smoothly around Y-axis | Visual inspection over 10+ seconds | [ ] |

---

## Change Summary

| Task | File | Line | Change | Priority |
|------|------|------|--------|----------|
| Z1 | `main.cpp` | 51 | `1.0f` -> `0.0f` (depth clear) | CRITICAL |
| Z2 | `renderer.h` | - | `VK_COMPARE_OP_LESS` -> `VK_COMPARE_OP_GREATER`, swap bounds | CRITICAL |
| Z3 | `renderer.h` | - | `minDepth 0->1`, `maxDepth 1->0` | CRITICAL |
| Z4 | `renderer.h` | - | `nearPlane=0.00001f`, `farPlane=10000.0f` | HIGH |
| Z5 | render loop | - | chrono elapsed time, Y-axis rotation, normalize, set shaderVars | MED |
| Z6 | multiple | - | QuoteSystem/DebugWindow logging, TestManager tests | MED |
| Z7 | `GraphicsHelper.hpp` | - | `DepthMode` enum, configurable depth comparison | LOW |

> **Reminder:** Z1, Z2, Z3 are an atomic group. Never apply or test them individually.
