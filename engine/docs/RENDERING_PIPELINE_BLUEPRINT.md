# RENDERING PIPELINE BLUEPRINT

## Current Pipeline Analysis

### Software Rasterizer Path

```
Application
    |
    v
main() loop
    |
    +-- Camera input (keyboard/mouse)
    +-- Transform vertices (Matrix.h multiply)
    +-- Clip to view frustum
    +-- Project to screen space
    +-- Rasterize triangles (scanline fill)
    |       |
    |       +-- Depth test (per-pixel Z comparison)
    |       +-- Texture sampling (nearest/bilinear)
    |       +-- Lighting (per-vertex or per-pixel)
    |
    +-- Write to framebuffer (raw pixel array)
    +-- Present (blit to window)
```

### Vulkan Hardware Path

```
Application
    |
    v
main() loop
    |
    +-- GWindow event pump (GateWare)
    +-- GVulkanSurface acquire swapchain image
    +-- vkBeginCommandBuffer
    |
    +-- vkCmdBeginRenderPass (clear color + depth)
    |       |
    |       +-- vkCmdBindPipeline (graphics pipeline)
    |       +-- vkCmdBindDescriptorSets (UBO: MVP matrices, lighting)
    |       +-- vkCmdBindVertexBuffers
    |       +-- vkCmdBindIndexBuffer
    |       +-- vkCmdDrawIndexed (per mesh)
    |
    +-- vkCmdEndRenderPass
    +-- vkEndCommandBuffer
    +-- vkQueueSubmit
    +-- GVulkanSurface present
```

## Target Architecture

```
Application Layer
    |
    v
Engine Core (EventBus, Config, TestManager, DebugWindow)
    |
    +---------------------------+---------------------------+
    |                           |                           |
    v                           v                           v
RenderService               FileService                 UIService
(IRenderService)            (asset loading)             (panels, tools)
    |                           |                           |
    +----------+----------+     +-- GLTF loader             +-- Toolbar
    |          |          |     +-- Texture loader           +-- Properties
    v          v          v     +-- Scene serializer         +-- Asset Browser
  Vulkan   Software    (Future)                             +-- Viewport
  Backend  Backend     backends                             +-- Timeline
```

All three services communicate exclusively through the EventBus. RenderService never includes UI headers. UIService never includes Vulkan headers. FileService publishes "file.loaded" events that both RenderService and UIService subscribe to independently.

## RenderService Interface

The abstract interface that both backends implement. Defined in `src/rendering/IRenderService.h`:

```cpp
// IRenderService.h

#pragma once
#include "RenderConfig.h"
#include <string>
#include <cstdint>

using MeshHandle = uint32_t;
using TextureHandle = uint32_t;

struct CameraData {
    float position[3];
    float target[3];
    float up[3];
    float fovY;
    float aspectRatio;
    float nearPlane;
    float farPlane;
};

struct Transform {
    float worldMatrix[16];
};

struct LightingData {
    float sunDirection[3];
    float sunColor[3];
    float sunIntensity;
    float ambientColor[3];
    float ambientIntensity;
};

class IRenderService {
public:
    virtual ~IRenderService() = default;

    // Lifecycle
    virtual bool Initialize(const RenderConfig& config) = 0;
    virtual void Shutdown() = 0;

    // Frame management
    virtual void BeginFrame() = 0;
    virtual void EndFrame() = 0;

    // Scene commands
    virtual void SetCamera(const CameraData& camera) = 0;
    virtual void SubmitMesh(MeshHandle mesh, const Transform& transform) = 0;
    virtual void SetLighting(const LightingData& lighting) = 0;

    // Resource management
    virtual MeshHandle LoadMesh(const std::string& path) = 0;
    virtual TextureHandle LoadTexture(const std::string& path) = 0;
    virtual void UnloadMesh(MeshHandle handle) = 0;
    virtual void UnloadTexture(TextureHandle handle) = 0;
};
```

## Vulkan Backend Refactor Steps

### Step 1: Extract VkDevice Management

Pull all device/instance/surface creation into a `VulkanDevice` class:

- `VkInstance` creation with validation layers
- Physical device selection (GPU enumeration, queue family lookup)
- `VkDevice` creation with required extensions
- Surface and swapchain setup via GateWare `GVulkanSurface`
- Currently scattered across `GetHandlesFromSurface()` and constructor -- consolidate into one owner

### Step 2: Separate Pipeline Creation

Extract `VkPipeline` setup into a `VulkanPipelineBuilder`:

- Shader module creation from SPIR-V (currently in `CompileVertexShader()` / `CompileFragmentShader()`)
- Vertex input state, input assembly, rasterization state
- Depth/stencil state (with reversed-Z configuration)
- Viewport/scissor state
- Pipeline layout and descriptor set layout (currently `CreateDescriptorSetLayout()`, `CreatePipelineLayout()`)
- Multi-pipeline support: solid, wireframe, PBR, debug overlay

### Step 3: Resource Management

Create a `VulkanResourceManager` that owns all GPU memory:

- Vertex/index buffer allocation and upload
- Uniform buffer management (per-frame, per-object)
- Texture loading and `VkImageView` / `VkSampler` creation
- Descriptor pool and descriptor set allocation
- Handle-based API matching `IRenderService` (MeshHandle, TextureHandle)

### Step 4: Render Loop Separation

Extract the per-frame rendering into a `VulkanRenderer` that implements `IRenderService`:

- Command buffer recording
- Render pass begin/end
- Draw call submission
- Swapchain present
- Frame synchronization (fences, semaphores)

## Existing Functions to Reuse

### From `renderer.h` (Vulkan Renderer)

| Function | Current Role | Target Module |
|---|---|---|
| `GetHandlesFromSurface()` | Extracts VkDevice, VkPhysicalDevice, queue from GateWare surface | VulkanDevice |
| `CreateDescriptorSetLayout()` | Builds VkDescriptorSetLayout for UBO binding | VulkanPipelineBuilder |
| `CompileVertexShader()` | HLSL -> SPIR-V -> VkShaderModule | VulkanPipelineBuilder |
| `CompileFragmentShader()` | HLSL -> SPIR-V -> VkShaderModule | VulkanPipelineBuilder |
| `CreatePipelineLayout()` | VkPipelineLayout with push constants | VulkanPipelineBuilder |
| `CreateViewportFromWindowDimensions()` | VkViewport + VkRect2D scissor | VulkanRenderer |
| `CreateVkPipelineDepthStencilStateCreateInfo()` | Depth/stencil state | VulkanPipelineBuilder |
| `InitializeProjectionMatrix()` | Perspective projection with near/far planes | VulkanRenderer (via RenderConfig) |
| `Render()` | Main draw loop: bind pipeline, bind descriptors, draw indexed | VulkanRenderer |

### From `Renderer.h` (Software Rasterizer)

| Function | Current Role | Target Module |
|---|---|---|
| Triangle rasterization | Scanline fill with interpolation | SoftwareRenderer |
| Depth buffer management | Per-pixel Z test and write | SoftwareRenderer |
| Texture sampling | Nearest-neighbor and bilinear | SoftwareRenderer |
| Framebuffer blit | Copy pixel array to window surface | SoftwareRenderer |

### From `Camera.h`

| Function | Current Role | Target Module |
|---|---|---|
| `FreeLookCamera()` | Reads input, updates view matrix | CameraController (new class, instanced) |

### From `GraphicsHelper.hpp`

| Function | Current Role | Target Module |
|---|---|---|
| Vulkan object creation helpers | Reduce boilerplate for VkBuffer, VkImage, etc. | VulkanDevice / VulkanResourceManager |

## Shader Pipeline

### Current Architecture

```
HLSL source (embedded strings in Shaders.h)
    |
    v
shaderc (runtime compilation)
    |
    v
SPIR-V bytecode (in memory)
    |
    v
vkCreateShaderModule
    |
    v
VkPipeline
```

### Target Architecture

```
HLSL source files (shaders/ directory)
    |
    +-- Build time: shaderc offline compilation -> .spv files (optional)
    |
    +-- Runtime: shaderc online compilation (development mode)
    |
    v
SPIR-V bytecode (.spv files or in-memory)
    |
    v
ShaderManager (cache compiled modules, hot-reload in dev mode)
    |
    v
VulkanPipelineBuilder (consumes shader modules)
    |
    v
VkPipeline (one per material/render pass combination)
```

Shader files:
- `VertexShader.hlsl` -- Basic world/view/projection transform
- `FragmentShader.hlsl` -- Solid color and texture sampling
- `FragmentShader_PBR.hlsl` -- Full PBR with Cook-Torrance BRDF and image-based lighting

## Config-Driven Rendering

All rendering parameters are controlled by the `RenderConfig` struct defined in `src/rendering/RenderConfig.h`:

```cpp
struct RenderConfig {
    // Window
    int windowWidth = 800;
    int windowHeight = 600;
    bool fullscreen = false;

    // Quality
    int msaaSamples = 1;
    bool enableVSync = true;
    float renderScale = 1.0f;

    // Lighting
    float ambientIntensity = 0.25f;
    float sunIntensity = 1.0f;

    // Camera
    float cameraSpeed = 0.3f;
    float fovDegrees = 65.0f;
    float nearPlane = 0.00001f;
    float farPlane = 10000.0f;

    // Debug
    bool wireframeMode = false;
    bool showNormals = false;
    bool showDepthBuffer = false;
    bool reversedZ = true;
};
```

This struct is loaded from a JSON or INI file at startup. Every renderer, camera, and lighting system reads from this struct -- no hardcoded values in rendering code.

## Performance Notes

### Assembly Opportunities

- **Matrix multiply** -- The software rasterizer's transform pipeline performs millions of 4x4 matrix multiplications per frame. SSE intrinsics (`_mm_mul_ps`, `_mm_add_ps`, `_mm_shuffle_ps`) can process 4 floats simultaneously, yielding ~3-4x speedup over scalar code.
- **Depth buffer clear** -- Clearing the depth buffer to 1.0 (or 0.0 for reversed-Z) can use `_mm_store_ps` to write 4 depth values per instruction instead of one.
- **Vertex batch transform** -- AVX2 can transform 8 vertices simultaneously when the data is laid out in structure-of-arrays format.

### SQL Opportunities

- **Render statistics** -- Log frame times, draw call counts, and GPU memory usage to a SQLite table for offline analysis. Schema: `render_stats(frame_id, timestamp, frame_time_ms, draw_calls, triangles, gpu_memory_mb)`.
- **Asset metadata** -- Track which meshes and textures are loaded, their memory footprint, and usage frequency for smart caching and eviction.
- **Shader variants** -- Catalog compiled shader permutations (feature flags, quality levels) to avoid redundant recompilation.
