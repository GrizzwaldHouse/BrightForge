# BRIGHTFORGE — MASTER EXECUTION FILE

## PURPOSE
This file is the SINGLE SOURCE OF TRUTH for Claude Code.

It consolidates:
- Project architecture and goals
- All 4 production-ready C++ header files (QuoteSystem, DebugWindow, TestManager, EventBus)
- All skill definitions (logging, debugging, testing, rendering conventions)
- All task phases (Phase 1 through 5 plus Z-Depth fix)
- Rendering pipeline blueprint
- Z-Depth precision analysis with exact code fixes
- Claude Code command reference
- Architecture rules and coding standards

Claude MUST use this file to:
- Understand the complete system before writing any code
- Execute tasks deterministically without re-analysis loops
- Produce production-ready output that follows all conventions
- Know which existing functions to reuse instead of rewriting

---

# EXECUTION RULES (READ FIRST)

## MANDATORY BEHAVIOR
1. Read this ENTIRE file before making any changes
2. Every new function MUST log through QuoteSystem (SUCCESS or ERROR_MSG)
3. Every new subsystem MUST register a DebugWindow channel
4. Every new feature MUST have TestManager test cases
5. No hardcoded values anywhere. Use named constants at file top.
6. Show FULL function before and after when making changes
7. Combine similar functions using switch statements, do not duplicate
8. Add guard clauses at the top of every function
9. Add retry mechanisms for critical operations (shader compilation, file loading)
10. Comments explain WHY, not just WHAT

## ARCHITECTURE RULES (MANDATORY)
- Event-driven ONLY. No polling. No direct system coupling.
- 95% reusable / 5% configurable
- Composition over inheritance
- Dependency injection required
- Code to interfaces
- Strict separation of concerns
- No global mutable state
- No public mutable members
- Fail fast with typed errors
- No silent failures

## EVENT SYSTEM (CRITICAL)
ALL systems MUST communicate through EventBus.

FORBIDDEN - direct calls between subsystems:
```cpp
renderService->LoadModel(file);  // WRONG: UI calling renderer directly
```

REQUIRED - event-driven communication:
```cpp
EventBus::Instance().Publish("file.loaded", EventPayload::String(file));
// Renderer subscribes to "file.loaded" independently
```

## QUOTESYSTEM LOGGING CONVENTION
- SUCCESS = Harry Potter quotes (task completed)
- WARNING = Alice in Wonderland quotes (something odd)
- ERROR_MSG = Holes quotes (something broke)
- DEBUG = Naruto quotes (developer tracing)
- INFO = Maya Angelou quotes (general status)
- SECURITY = Black Clover quotes (integrity checks)

Every function that creates, loads, compiles, or initializes something:
```cpp
void DoSomething(const std::string& input) {
    if (input.empty()) {
        quoteSystem.Log("DoSomething: empty input", QuoteSystem::MessageType::WARNING);
        return;
    }
    quoteSystem.Log("Starting: " + input, QuoteSystem::MessageType::DEBUG);
    bool success = ActualWork(input);
    if (success) {
        quoteSystem.Log("Complete: " + input, QuoteSystem::MessageType::SUCCESS);
    } else {
        quoteSystem.Log("FAILED: " + input, QuoteSystem::MessageType::ERROR_MSG);
    }
}
```

## SQL AND ASSEMBLY USAGE NOTES
SQL fits for: asset database indexing (SQLite), game state persistence, frame timing analysis.
Assembly fits for: SIMD matrix multiplication (SSE/AVX), bulk memory operations, CRC32 integrity.
Only use assembly when profiling proves it is the bottleneck.

---


# PROJECT OVERVIEW

# BrightForge Engine - Master Project Plan

## Ultimate Goal
Evolve BrightForge from a Vulkan lab project into a production-grade 3D sculpting and editing platform. The engine must demonstrate portfolio-level engineering with modular rendering, scalable UI, and config-driven architecture.

## Current State
The codebase has two rendering paths:

1. **Software Rasterizer** (Renderer.h, GraphicsHelper.hpp, LineDrawing.h, Shaders.h/cpp)
   - CPU-based rendering with depth buffer
   - Supports wireframe and filled triangles
   - Has camera, projection, and world matrix transforms
   - Includes directional and point lighting

2. **Vulkan Hardware Pipeline** (renderer.h, Camera.h, FragmentShader_PBR.hlsl)
   - Full Vulkan surface with GateWare library
   - PBR shading with IBL (image-based lighting)
   - GLTF model loading via tinygltf
   - Texture loading with descriptor sets and bindless support
   - Free-look camera with keyboard/mouse/controller input

## Architecture Principles
- 95% reusable, 5% configurable
- Config-driven systems only, no hardcoded values
- Separation of concerns between UI, Controller, Rendering, FileSystem, and Config layers
- Event-driven architecture with dependency injection
- Composition over inheritance
- Fail-fast validation at every boundary

## Existing Helper Files That Can Be Reused
These files from previous projects contain functions that should be integrated rather than rewritten:

| File | Reusable Components |
|------|-------------------|
| Camera.h | FreeLookCamera function (Gateware), input handling patterns |
| GraphicsHelper.hpp | Pixel buffer management, depth buffer, color conversion, NDC-to-screen, alpha blending |
| Matrix.h | 4x4 matrix math, transformations, identity/rotation/translation factories |
| MathU.h | Vector math utilities, interpolation, clamping |
| LineDrawing.h | Bresenham line drawing, triangle rasterization, barycentric coordinates |
| Shaders.h/cpp | Software shader function pointers, lighting calculations |
| Constrants.h/cpp | Window dimensions, render constants |
| FileIntoString.h | File-to-string loader for shader source |
| mesh.h | Mesh data structures |
| QuoteSystem.h | Motivational logging system (being rebuilt in this package) |

## Five Phases

### Phase 1: Analysis
- Map full project structure
- Identify coupling issues between rendering and UI
- Audit which functions are duplicated across the two renderer paths
- Produce improvement roadmap

### Phase 2: Backend Refactor (parallel tasks)
- Extract rendering into isolated services
- Implement config-driven rendering settings
- Design file ingestion and indexing system
- Support OBJ, FBX, GLTF formats

### Phase 3: UI/UX Design (parallel tasks)
- Design 3D editor layout with viewport, tool panel, property inspector
- Design upload interface with drag-and-drop and search
- Define component architecture with layout trees and interaction maps

### Phase 4: Frontend Implementation
- Build drag-and-drop component
- Build searchable file browser
- Implement 3D viewport UI
- Connect UI via event system (no direct backend coupling)

### Phase 5: Integration
- Wire rendering, frontend, and filesystem together
- End-to-end testing
- Performance optimization

## Code Quality Requirements
- All functions must have QuoteSystem logging for success/failure
- All subsystems must register with DebugWindow for pipeline monitoring
- All new features must have TestManager test cases
- No hardcoded values; use named constants at top of files
- Combine similar functions using switch statements rather than writing duplicates
- Show full function implementations when making changes
- Comments explain "why" not just "what"

## SQL and Assembly Language Notes

### Where SQL Fits
- Game state persistence (save/load player progress, settings, high scores)
- Asset database indexing (fast lookup of models, textures, materials by name/tag)
- Level editor data storage (entity positions, properties, relationships)
- Example: SQLite embedded database for asset manifest

### Where Assembly Fits
- SIMD matrix multiplication (SSE/AVX for 4x4 matrix ops in Matrix.h)
- Memory copy optimization (bulk vertex buffer uploads)
- Texture format conversion (BGRA to ARGB in GraphicsHelper.hpp)
- CRC32 integrity checking (SSE4.2 intrinsic in QuoteSystem)
- Only use assembly when profiling proves it is the bottleneck

---

# RENDERING PIPELINE BLUEPRINT

# Rendering Pipeline Blueprint

## Current Pipeline Analysis

### Software Rasterizer Path
```
main.cpp -> App -> Renderer -> GraphicsHelper (pixel buffer)
                      |
                      +-> Shaders.h (vertex/pixel function pointers)
                      +-> LineDrawing.h (rasterization)
                      +-> Camera (software camera, Matrix4x4)
```

### Vulkan Hardware Path
```
main.cpp -> Renderer (Vulkan) -> GVulkanSurface
                |
                +-> shaderc (runtime HLSL compilation)
                +-> FreeLookCamera (Gateware math/input)
                +-> tinygltf (GLTF model loading)
                +-> Descriptor Sets (UBO + textures)
                +-> PBR Fragment Shader (IBL + Cook-Torrance)
```

## Target Architecture

```
                    +-----------------+
                    |   Application   |
                    +--------+--------+
                             |
                    +--------v--------+
                    |  Engine Core    |
                    |  (Event Bus)    |
                    +--------+--------+
                             |
          +------------------+------------------+
          |                  |                  |
+---------v------+  +--------v--------+  +-----v----------+
|  RenderService |  |  FileService    |  |  UIService     |
|  (abstraction) |  |  (drag+search)  |  |  (components)  |
+--------+-------+  +-----------------+  +----------------+
         |
    +----+----+
    |         |
+---v---+ +---v------+
|Vulkan | |Software  |
|Backend| |Rasterizer|
+-------+ +----------+
```

## RenderService Interface

The key refactor is creating an abstract RenderService that both the Vulkan
and software backends implement. This lets the UI and game logic talk to
one interface without knowing which renderer is active.

```cpp
// IRenderService.h - Abstract rendering interface
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

### Step 1: Extract VkDevice management
Currently scattered across the Renderer class. Move to a VulkanContext
that owns device, physical device, and surface.

### Step 2: Separate pipeline creation
The current InitializeGraphicsPipeline() is 200+ lines. Break into:
- PipelineBuilder (configurable, reusable)
- ShaderCompiler (wraps shaderc)
- DescriptorManager (pool, layouts, sets)

### Step 3: Resource management
Current texture and buffer creation is inline. Move to:
- BufferAllocator (vertex, index, uniform buffers)
- TextureManager (loading, caching, descriptor binding)
- MeshManager (GLTF parsing, vertex format handling)

### Step 4: Render loop separation
Current Render() mixes update logic with draw calls. Split into:
- Update phase (matrices, camera, uniforms)
- Record phase (command buffer recording)
- Submit phase (queue submission)

## Existing Functions to Reuse (Not Rewrite)

### From renderer.h (Vulkan)
- GetHandlesFromSurface() - Device handle extraction
- CreateDescriptorSetLayout() - Descriptor layout creation
- CompileVertexShader() / CompileFragmentShader() - Shader compilation
- CreatePipelineLayout() - Pipeline layout setup
- All the CreateVk* helper functions (viewport, scissor, blend, etc.)

### From Renderer.h (Software)
- setProjection() - Perspective matrix calculation
- renderMesh() - Triangle rasterization with transforms
- updateCubeRotation() - Animation update pattern

### From Camera.h
- FreeLookCamera() - Complete input-driven camera
  NOTE: This uses static locals which makes it non-reentrant.
  For the refactor, extract the input reading and matrix math
  into a CameraController class that can be instanced.

### From GraphicsHelper.hpp
- NDCToScreen() - Coordinate conversion
- AlphaBlendColors() - Pixel blending
- drawPixel() with depth test - Depth buffer pattern

## Shader Pipeline

### Current Shaders
- VertexShader.hlsl (basic transform)
- FragmentShader.hlsl (basic color)
- FragmentShader_PBR.hlsl (full PBR with IBL)

### Target Shader Architecture
```
Shaders/
  Common/
    math_utils.hlsli      (shared math, extracted from PBR)
    lighting_common.hlsli  (shared lighting structs)
  Vertex/
    standard_vs.hlsl       (world/view/proj transform)
    skinned_vs.hlsl        (with bone matrices, future)
  Fragment/
    unlit_ps.hlsl          (solid color / texture only)
    pbr_ps.hlsl            (current PBR, cleaned up)
    debug_ps.hlsl          (normals/depth visualization)
```

## Config-Driven Rendering

All rendering parameters must come from a config struct, never hardcoded:

```cpp
struct RenderConfig {
    // Window
    int windowWidth;
    int windowHeight;
    bool fullscreen;

    // Quality
    int msaaSamples;
    bool enableVSync;
    float renderScale;

    // Lighting
    float ambientIntensity;
    float sunIntensity;

    // Debug
    bool wireframeMode;
    bool showNormals;
    bool showDepthBuffer;
};
```

## Performance Notes

### Where Assembly Could Help
- Matrix4x4 multiplication in Matrix.h currently uses scalar C++.
  SSE intrinsics (_mm_mul_ps, _mm_add_ps) would give roughly 4x speedup
  on the inner loop. This matters when transforming thousands of vertices.

- The BGRAtoARGB conversion in GraphicsHelper.hpp processes one pixel
  at a time. An AVX2 implementation could convert 8 pixels simultaneously.

### Where SQL Could Help
- Asset manifest: Instead of scanning the filesystem at startup, maintain
  a SQLite database of all assets with metadata (format, dimensions, tags).
  Queries like "find all GLTF models tagged 'character'" become instant.

- Render statistics: Log frame times, draw call counts, and memory usage
  to a SQLite table for offline analysis and profiling graphs.

---

# Z-DEPTH PRECISION ANALYSIS

// ============================================================================
// Z_DEPTH_ANALYSIS.md - BrightForge Z-Buffer Precision Issue
// ============================================================================
// This document catalogs the Z-depth precision problems found in both
// the Vulkan hardware renderer (renderer.h) and the software rasterizer
// (Renderer.h / GraphicsHelper.hpp / LineDrawing.h), explains WHY they
// happen, and provides the exact code changes needed to fix them.
//
// The Lab 7 assignment (Section B) specifically requires implementing
// reversed-Z depth for the Vulkan pipeline. This analysis covers that
// requirement plus additional depth issues found in the software path.
// ============================================================================

# Z-Depth Precision Analysis - BrightForge Engine

## The Problem in Plain English

When you move the camera far away from the bottle model, the surface starts
flickering and showing visual corruption. Triangles that should be behind
other triangles bleed through, creating a shimmering mess called "Z-fighting."
This gets dramatically worse when the near plane is set to a very small value
(0.00001f) and the far plane to a very large one (10000.0f), which is exactly
what Lab 7 Task B1 asks you to do.

The root cause is that a standard depth buffer stores values in a nonlinear
distribution. Most of the precision gets crammed into the range near the
camera, and almost none is left for distant objects. With a near plane of
0.00001f and far plane of 10000.0f, the ratio is 1,000,000,000:1. A 24-bit
depth buffer only has about 16 million discrete values, so distant geometry
shares the same depth values and the GPU cannot tell which triangle is in front.


## Issue Map Across Both Renderers

### VULKAN RENDERER (renderer.h) - 4 Issues Found

ISSUE V1: Standard depth clear value (1.0f) and comparison (LESS)
  Location: main.cpp line 51 and CreateVkPipelineDepthStencilStateCreateInfo()
  Severity: HIGH - directly causes Z-fighting at distance
  Lab 7 Requirement: Section B, Task B2

ISSUE V2: Hardcoded near/far planes in InitializeProjectionMatrix()
  Location: renderer.h InitializeProjectionMatrix(), lines 330-334
  Severity: MEDIUM - makes depth range inflexible
  Lab 7 Requirement: Section B, Task B1

ISSUE V3: Viewport depth range not reversed
  Location: renderer.h CreateViewportFromWindowDimensions(), lines 620-621
  Severity: HIGH - must be swapped for reverse-Z to work
  Lab 7 Requirement: Section B, Task B2

ISSUE V4: Depth bounds not swapped in depth stencil state
  Location: renderer.h CreateVkPipelineDepthStencilStateCreateInfo(), lines 683-685
  Severity: HIGH - must be swapped for reverse-Z to work
  Lab 7 Requirement: Section B, Task B2

### SOFTWARE RASTERIZER (Renderer.h, GraphicsHelper.hpp, LineDrawing.h) - 2 Issues Found

ISSUE S1: Depth buffer clears to float max, compares with LESS
  Location: GraphicsHelper.hpp clearBuffer() line 87, drawPixel() line 96
  Severity: MEDIUM - works for standard Z but cannot support reverse-Z

ISSUE S2: Depth interpolation uses post-projection Z without perspective correction
  Location: LineDrawing.h barycentric depth interpolation
  Severity: LOW - only affects software path, not the primary Vulkan pipeline


## DETAILED FIX: Reversed-Z for Vulkan Pipeline

The reversed-Z technique exploits the fact that floating-point numbers have
more precision near zero than near one. By mapping the far plane to 0.0 and
the near plane to 1.0, distant objects get the high-precision end of the
float range where they need it most. This is how modern engines like Unreal
and Unity handle massive draw distances.

Four coordinated changes are required. If you do only some of them, the
depth test will be completely wrong and nothing will render.

### Fix 1 of 4: Clear depth buffer to 0 instead of 1

This change is in main.cpp. The depth clear value tells the GPU what value
every pixel in the depth buffer starts at before any geometry is drawn.
With standard Z, we clear to 1.0 (the farthest possible). With reversed Z,
the far plane is 0.0, so we clear to 0.0.

CURRENT CODE (main.cpp, around line 51):
```cpp
clrAndDepth[1].depthStencil = { 1.0f, 0u };
```

FIXED CODE:
```cpp
// REVERSED-Z: Clear depth to 0.0 (which now represents the far plane)
// WHY: In reversed-Z, 0.0 = far plane and 1.0 = near plane.
//      We want every pixel to start at "infinitely far away" so that
//      any geometry drawn will be closer and pass the depth test.
clrAndDepth[1].depthStencil = { 0.0f, 0u };
```

### Fix 2 of 4: Swap depth comparison from LESS to GREATER

This change is in CreateVkPipelineDepthStencilStateCreateInfo() in renderer.h.
With standard Z, closer objects have smaller Z values, so we use LESS.
With reversed Z, closer objects have LARGER Z values (closer to 1.0), so
we switch to GREATER.

CURRENT CODE (renderer.h, around line 676):
```cpp
VkPipelineDepthStencilStateCreateInfo CreateVkPipelineDepthStencilStateCreateInfo()
{
    VkPipelineDepthStencilStateCreateInfo retval = {};
    retval.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    retval.depthTestEnable = VK_TRUE;
    retval.depthWriteEnable = VK_TRUE;
    retval.depthCompareOp = VK_COMPARE_OP_LESS;        // <-- PROBLEM
    retval.depthBoundsTestEnable = VK_FALSE;
    retval.minDepthBounds = 0.0f;                       // <-- PROBLEM
    retval.maxDepthBounds = 1.0f;                       // <-- PROBLEM
    retval.stencilTestEnable = VK_FALSE;
    return retval;
}
```

FIXED CODE:
```cpp
VkPipelineDepthStencilStateCreateInfo CreateVkPipelineDepthStencilStateCreateInfo()
{
    VkPipelineDepthStencilStateCreateInfo retval = {};
    retval.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    retval.depthTestEnable = VK_TRUE;
    retval.depthWriteEnable = VK_TRUE;

    // REVERSED-Z: Use GREATER instead of LESS
    // WHY: In reversed-Z, near plane maps to 1.0 and far plane to 0.0.
    //      A closer fragment has a LARGER depth value, so we keep the
    //      fragment whose depth is GREATER (closer to the camera).
    retval.depthCompareOp = VK_COMPARE_OP_GREATER;

    retval.depthBoundsTestEnable = VK_FALSE;

    // REVERSED-Z: Swap min and max depth bounds
    // WHY: The valid depth range is now 1.0 (near) to 0.0 (far).
    //      Even though depthBoundsTestEnable is FALSE right now,
    //      setting these correctly prevents confusion if we enable
    //      depth bounds testing later for optimizations.
    retval.minDepthBounds = 1.0f;
    retval.maxDepthBounds = 0.0f;

    retval.stencilTestEnable = VK_FALSE;

    // Log this critical state for pipeline debugging
    // quoteSystem.Log("Depth stencil: REVERSED-Z active (GREATER compare, bounds swapped)",
    //     QuoteSystem::MessageType::SUCCESS);

    return retval;
}
```

### Fix 3 of 4: Swap viewport depth values

This change is in CreateViewportFromWindowDimensions() in renderer.h.
The viewport's minDepth and maxDepth tell Vulkan how to map the NDC depth
range [0,1] to the framebuffer depth range. Swapping them reverses the
mapping direction.

CURRENT CODE (renderer.h, around line 613):
```cpp
VkViewport CreateViewportFromWindowDimensions()
{
    VkViewport retval = {};
    retval.x = 0;
    retval.y = 0;
    retval.width = static_cast<float>(windowWidth);
    retval.height = static_cast<float>(windowHeight);
    retval.minDepth = 0;    // <-- PROBLEM
    retval.maxDepth = 1;    // <-- PROBLEM
    return retval;
}
```

FIXED CODE:
```cpp
VkViewport CreateViewportFromWindowDimensions()
{
    VkViewport retval = {};
    retval.x = 0;
    retval.y = 0;
    retval.width = static_cast<float>(windowWidth);
    retval.height = static_cast<float>(windowHeight);

    // REVERSED-Z: Swap min and max depth in the viewport
    // WHY: This inverts the depth mapping so that:
    //   - Fragments at the near plane get depth value 1.0
    //   - Fragments at the far plane get depth value 0.0
    //   Combined with the GREATER comparison op, this means closer
    //   fragments always win the depth test, just like before, but
    //   with dramatically better precision at distance.
    retval.minDepth = 1.0f;
    retval.maxDepth = 0.0f;

    return retval;
}
```

### Fix 4 of 4: Use aggressive near/far plane values (Lab 7 Task B1)

This change is in InitializeProjectionMatrix() in renderer.h. The lab
specifically asks you to set near=0.00001f and far=10000.0f to demonstrate
the problem, and then reversed-Z to fix it.

CURRENT CODE (renderer.h, around line 327):
```cpp
void InitializeProjectionMatrix()
{
    float fovY = G_DEGREE_TO_RADIAN(65.0f);
    float aspectRatio;
    vlk.GetAspectRatio(aspectRatio);
    float nearPlane = 0.1f;     // <-- Lab wants 0.00001f
    float farPlane = 100.0f;    // <-- Lab wants 10000.0f

    mathLibrary.ProjectionVulkanLHF(fovY, aspectRatio, nearPlane, farPlane, projectionMatrix);
}
```

FIXED CODE:
```cpp
void InitializeProjectionMatrix()
{
    // CONFIGURABLE: These should be constants at the top of the file
    // or loaded from RenderConfig. They are here temporarily for Lab 7.
    float fovY = G_DEGREE_TO_RADIAN(65.0f);
    float aspectRatio;
    vlk.GetAspectRatio(aspectRatio);

    // Lab 7 Task B1: Aggressive near/far planes to stress-test depth
    // Without reversed-Z, these values cause severe Z-fighting.
    // With reversed-Z (Fixes 1-3 above), the precision is dramatically
    // better because floating-point has exponentially more precision
    // near zero, and reversed-Z maps distant objects to near-zero depth.
    float nearPlane = 0.00001f;
    float farPlane = 10000.0f;

    mathLibrary.ProjectionVulkanLHF(fovY, aspectRatio, nearPlane, farPlane, projectionMatrix);

    // ALTERNATIVE: If you want even better precision, you can swap the
    // near and far planes in the projection matrix itself instead of
    // swapping the viewport depths. The lab mentions this in Task B2
    // point 4a. Either approach works; viewport swap is simpler.
    //
    // To do it via projection matrix swap:
    //   mathLibrary.ProjectionVulkanLHF(fovY, aspectRatio, farPlane, nearPlane, projectionMatrix);
    // Then keep the viewport at minDepth=0, maxDepth=1 (standard).
}
```


## VERIFICATION: How to Confirm the Fix Works

After making all four changes, run the engine and perform these checks:

1. The bottle should render correctly at normal camera distance (no change
   from before, just the depth mapping is inverted internally).

2. Move the camera far away from the bottle. With standard Z and the
   aggressive near/far planes, you would see severe Z-fighting (shimmering
   surfaces). With reversed-Z, the bottle should remain clean and stable
   even at extreme distance.

3. Move the camera very close to the bottle. Near-plane clipping should
   still work correctly because the near plane value has not changed,
   only how depth values are distributed between near and far.

Add these test cases to TestManager:
```cpp
// Verify reversed-Z configuration is consistent
tm.AddTest("Renderer", "Depth clear value is 0 for reversed-Z", [&]() {
    // Check that clrAndDepth[1].depthStencil.depth == 0.0f
    return clrAndDepth[1].depthStencil.depth == 0.0f;
});

tm.AddTest("Renderer", "Viewport depth is reversed (min=1, max=0)", [&]() {
    VkViewport vp = CreateViewportFromWindowDimensions();
    return vp.minDepth == 1.0f && vp.maxDepth == 0.0f;
});

tm.AddTest("Renderer", "Depth compare op is GREATER", [&]() {
    VkPipelineDepthStencilStateCreateInfo ds = CreateVkPipelineDepthStencilStateCreateInfo();
    return ds.depthCompareOp == VK_COMPARE_OP_GREATER;
});
```

Add QuoteSystem logging after each fix is applied:
```cpp
quoteSystem.Log("Reversed-Z depth buffer active - precision enhanced",
    QuoteSystem::MessageType::SUCCESS);
// Output: [SUCCESS] Reversed-Z depth buffer active - precision enhanced
//   >> "Mischief Managed!"
```


## SOFTWARE RASTERIZER DEPTH ISSUES (Secondary)

These affect Renderer.h / GraphicsHelper.hpp / LineDrawing.h. They are
lower priority since the Vulkan pipeline is the primary renderer, but
they should be addressed for completeness.

### Issue S1: Standard-Z depth buffer in GraphicsHelper

The software rasterizer clears the depth buffer to float::max and uses
a "less than" comparison. This is functionally correct for standard-Z
but does not match the reversed-Z approach in the Vulkan pipeline.

CURRENT CODE (GraphicsHelper.hpp, clearBuffer and drawPixel):
```cpp
void clearBuffer(unsigned int color)
{
    std::fill(pixels, pixels + (width * height), color);
    // Clears to max float - standard Z (far = max, near = 0)
    std::fill(mDepthBuffer.begin(), mDepthBuffer.end(),
              std::numeric_limits<float>::max());
}

void drawPixel(unsigned int x, unsigned int y, float depth, unsigned int color)
{
    if (x >= width || y >= height) return;
    unsigned int index = y * width + x;
    // Standard Z comparison: smaller depth = closer
    if (depth <= mDepthBuffer[index])
    {
        pixels[index] = color;
        mDepthBuffer[index] = depth;
    }
}
```

FIXED CODE (config-driven depth mode):
```cpp
// Add this enum at the top of GraphicsHelper.hpp next to the other constants
enum class DepthMode {
    STANDARD,   // Clear to max, compare LESS (traditional)
    REVERSED    // Clear to 0, compare GREATER (modern, matches Vulkan path)
};

// Add as a member variable
DepthMode mDepthMode = DepthMode::STANDARD;

void setDepthMode(DepthMode mode) {
    mDepthMode = mode;
}

void clearBuffer(unsigned int color)
{
    std::fill(pixels, pixels + (width * height), color);

    // Config-driven depth clear based on active depth mode
    float clearValue = (mDepthMode == DepthMode::REVERSED)
        ? 0.0f
        : std::numeric_limits<float>::max();

    std::fill(mDepthBuffer.begin(), mDepthBuffer.end(), clearValue);
}

void drawPixel(unsigned int x, unsigned int y, float depth, unsigned int color)
{
    if (x >= width || y >= height) return;
    unsigned int index = y * width + x;

    // Depth comparison direction depends on active depth mode
    bool passesDepthTest = false;
    switch (mDepthMode) {
        case DepthMode::STANDARD:
            passesDepthTest = (depth <= mDepthBuffer[index]);
            break;
        case DepthMode::REVERSED:
            passesDepthTest = (depth >= mDepthBuffer[index]);
            break;
    }

    if (passesDepthTest)
    {
        pixels[index] = color;
        mDepthBuffer[index] = depth;
    }
}
```


## Lab 7 Task B3: Rotating Light Direction Over Time

While not directly a depth issue, Task B3 is part of the same Section B.
The lab asks you to rotate the sun direction around the model over time.

The existing Vulkan renderer.h already has light direction handling in
the Render function. The fix is to track elapsed time and rotate the
light's direction vector by that time interpreted as radians:

```cpp
// In the Render() function, before updating shader uniforms:
static auto startTime = std::chrono::steady_clock::now();
double elapsed = std::chrono::duration<double>(
    std::chrono::steady_clock::now() - startTime).count();

// Create a rotation matrix that spins on Y axis over time
GW::MATH::GMATRIXF lightRotation = GW::MATH::GIdentityMatrixF;
mathLibrary.RotateYGlobalF(lightRotation, static_cast<float>(elapsed), lightRotation);

// Rotate the original sun direction by the time-based rotation
GW::MATH::GVECTORF originalSunDir = { -1.0f, -1.0f, 2.0f, 0.0f };
GW::MATH::GVECTORF rotatedSunDir;
mathLibrary.VectorXMatrixF(originalSunDir, lightRotation, rotatedSunDir);

// Normalize the rotated direction
mathLibrary.NormalizeF(rotatedSunDir, rotatedSunDir);

// Set in shader vars
shaderVars.sunDirection = rotatedSunDir;
```


## Why Reversed-Z Works (The Math)

A standard 24-bit depth buffer stores values as:

  depth = (far * near) / (far - z * (far - near))

With near=0.00001 and far=10000, half of the 16 million depth buffer
values are consumed by the first 0.01 units from the camera. Everything
beyond that shares the remaining values, causing Z-fighting.

Reversed-Z flips this distribution. Because IEEE 754 floating-point has
logarithmic precision (more bits near zero), mapping the far plane to 0.0
gives distant objects the high-precision end of the float range. The result
is nearly uniform precision across the entire depth range, regardless of
the near/far ratio.

For a visual explanation, see the NVIDIA article linked in the lab:
https://developer.nvidia.com/content/depth-precision-visualized


## Assembly Optimization Note

The depth comparison in drawPixel() runs for every single pixel of every
triangle. For the software rasterizer, this is the innermost hot loop.
If profiling shows drawPixel is the bottleneck, the depth test could be
vectorized using SSE2 comparisons:

```cpp
// Pseudocode for SIMD depth test (4 pixels at once)
// __m128 depthVec = _mm_loadu_ps(&mDepthBuffer[index]);
// __m128 newDepth = _mm_set1_ps(depth);
// __m128 mask = _mm_cmplt_ps(newDepth, depthVec);  // standard-Z
// or:  mask = _mm_cmpgt_ps(newDepth, depthVec);    // reversed-Z
// Use mask to conditionally write pixels and update depth buffer
```

This would process 4 pixels per CPU instruction instead of 1, roughly
a 4x speedup on the depth test portion of the rasterizer.


## SQL Note

For debugging depth precision issues over time, you could log the depth
distribution per frame to a SQLite table:

```sql
CREATE TABLE depth_stats (
    frame_id INTEGER,
    min_depth REAL,
    max_depth REAL,
    avg_depth REAL,
    z_fighting_pixels INTEGER,  -- count of pixels where depth diff < epsilon
    depth_mode TEXT             -- 'standard' or 'reversed'
);

-- Find frames with Z-fighting
SELECT frame_id, z_fighting_pixels FROM depth_stats
WHERE z_fighting_pixels > 0 ORDER BY z_fighting_pixels DESC;
```

---

# SKILL: QUOTESYSTEM INTEGRATION

# Skill: QuoteSystem Integration

## Overview
The QuoteSystem is BrightForge's themed logging system. Every function that
completes a meaningful operation must log its result through QuoteSystem.
This is not optional. It is how we track pipeline health and debug issues.

## Quick Reference

### Include and Create
```cpp
#include "QuoteSystem.h"
QuoteSystem quoteSystem;
```

### Message Types
- `SUCCESS` - Task completed (Harry Potter quotes)
- `WARNING` - Something unexpected (Alice in Wonderland quotes)
- `ERROR_MSG` - Something failed (Holes quotes)
- `DEBUG` - Developer tracing (Naruto quotes)
- `INFO` - General status (Maya Angelou quotes)
- `SECURITY` - Integrity checks (Black Clover quotes)

### Logging Pattern
Every function that creates, loads, compiles, or initializes something
must follow this pattern:

```cpp
void DoSomething(const std::string& input) {
    // Guard clause
    if (input.empty()) {
        quoteSystem.Log("DoSomething called with empty input",
            QuoteSystem::MessageType::WARNING);
        return;
    }

    // Attempt the operation
    quoteSystem.Log("Starting DoSomething: " + input,
        QuoteSystem::MessageType::DEBUG);

    bool success = ActualWork(input);

    if (success) {
        quoteSystem.Log("DoSomething completed: " + input,
            QuoteSystem::MessageType::SUCCESS);
    } else {
        quoteSystem.Log("DoSomething FAILED: " + input,
            QuoteSystem::MessageType::ERROR_MSG);
    }
}
```

### Security Registration
At subsystem init, register an integrity phrase:
```cpp
quoteSystem.RegisterIntegrity("MySubsystem", "I solemnly swear I am up to no good");
```

Later, validate it has not been corrupted:
```cpp
if (!quoteSystem.ValidateIntegrity("MySubsystem", "I solemnly swear I am up to no good")) {
    // Memory corruption detected, abort or recover
}
```

### Verbose Toggle
```cpp
quoteSystem.SetVerbose(false);  // Suppress DEBUG messages in release
quoteSystem.SetVerbose(true);   // Show everything in development
```

### Debug History
```cpp
quoteSystem.PrintHistory(20);  // Show last 20 log entries
```

## Rules
1. Never use raw std::cout for status messages. Always use QuoteSystem.
2. Every new file must include QuoteSystem.h.
3. Every init function must log SUCCESS or ERROR_MSG.
4. Every retry attempt must log WARNING before retrying.
5. Security-sensitive subsystems must register integrity phrases.

---

# SKILL: DEBUGWINDOW PIPELINE MONITOR

# Skill: DebugWindow Pipeline Monitor

## Overview
The DebugWindow is a singleton that provides categorized, channel-based
debug output. Every subsystem registers a channel and posts messages to it.
This keeps the console organized so any developer can quickly find where
a problem is occurring.

## Quick Reference

### Access the Singleton
```cpp
#include "DebugWindow.h"
DebugWindow& dbg = DebugWindow::Instance();
```

### Register and Post
```cpp
dbg.RegisterChannel("MySubsystem");
dbg.Post("MySubsystem", "Initialized successfully", DebugLevel::INFO);
dbg.Post("MySubsystem", "Texture missing!", DebugLevel::ERR);
```

### Check Files at Init Time
```cpp
dbg.CheckFileExists("Shaders", "../VertexShader.hlsl");
dbg.CheckFileExists("Shaders", "../FragmentShader_PBR.hlsl");
```

### View Dashboard
```cpp
dbg.PrintDashboard();  // Shows all channels with status summary
```

### Toggle Channels
```cpp
dbg.ToggleChannel("Physics", false);  // Suppress physics messages
dbg.ToggleChannel("Physics", true);   // Re-enable
```

### View Channel History
```cpp
dbg.PrintChannelHistory("Renderer", 10);  // Last 10 renderer messages
```

## Debug Levels
- `TRACE` - Ultra-verbose, usually off in normal development
- `INFO` - General operational status
- `WARN` - Unexpected but recoverable
- `ERR` - Something failed, needs attention
- `CRITICAL` - System cannot continue

## Default Channels
These channels are auto-registered at startup:
Engine, Renderer, FileSystem, Shaders, UI, Input, Audio, Physics, Network

## Rules
1. Every new subsystem must RegisterChannel in its constructor.
2. Every init function must CheckFileExists for required dependencies.
3. Use ERR level for failures, not WARN (WARN is for unusual-but-ok situations).
4. Call PrintDashboard() at the end of engine initialization for a health summary.
5. Channel names must match across Post calls (case-sensitive).

---

# SKILL: TESTMANAGER SUBSYSTEM VALIDATOR

# Skill: TestManager Subsystem Validator

## Overview
The TestManager runs validation tests for every engine subsystem before the
main loop starts. This catches missing files, broken configs, and logic
errors before they cause mysterious crashes during gameplay.

## Quick Reference

### Create and Register Tests
```cpp
#include "TestManager.h"
TestManager tm;

// Register a suite for your subsystem
tm.RegisterSuite("Renderer");

// Add individual tests as lambdas that return bool
tm.AddTest("Renderer", "Pipeline creates successfully", []() {
    // Your test logic here
    return pipeline.IsValid();
});
```

### Run Tests
```cpp
tm.RunAll();                  // Run every enabled suite
tm.RunSuite("Renderer");     // Run one suite only
```

### Toggle Suites
```cpp
tm.ToggleSuite("Physics", false);  // Skip physics tests
```

### Quick Start with Default Tests
```cpp
// Automatically creates file existence tests for your shaders and assets
tm.RegisterDefaultEngineTests(
    { "../VertexShader.hlsl", "../FragmentShader_PBR.hlsl" },  // shaders
    { "../Assets/model.gltf", "../Assets/albedo.png" }          // assets
);
tm.RunAll();
```

### Check Results
```cpp
int total, passed, failed;
tm.GetResults(total, passed, failed);
if (failed > 0) {
    // Handle failures: log, show dialog, or abort
}
```

## Test Writing Guidelines
1. Each test must be independent (no shared state between tests).
2. Tests must not modify engine state (read-only validation).
3. Test names should describe what they verify, not how.
4. Return true on pass, false on fail. Throw for unexpected crashes.
5. Keep tests fast. If a test takes more than 100ms, it is too slow.

## When to Add Tests
- Every new subsystem constructor needs a "subsystem initializes" test.
- Every file-loading function needs a "file exists" test.
- Every config parser needs a "default config is valid" test.
- Every event bus subscription needs a "event delivers payload" test.

## Rules
1. Never ship without running TestManager.RunAll() successfully.
2. Failed tests produce QuoteSystem ERROR_MSG logs (Holes quotes).
3. Passed tests produce QuoteSystem SUCCESS logs (Harry Potter quotes).
4. The TestManager itself uses its own QuoteSystem instance (isolated).

---

# SKILL: RENDERING PIPELINE

# Skill: BrightForge Rendering Pipeline

## Overview
BrightForge has two rendering paths. The Vulkan hardware path is the primary
pipeline. The software rasterizer exists for testing and education. Both must
implement the same IRenderService interface.

## Vulkan Pipeline Quick Reference

### Initialization Order (must follow exactly)
1. Create GWindow
2. Create GVulkanSurface with DEPTH_BUFFER_SUPPORT | BINDLESS_SUPPORT
3. Get device handles from surface
4. Create descriptor set layouts
5. Create shader compiler and compile all shaders
6. Create pipeline layout
7. Create graphics pipeline
8. Create vertex/index/uniform buffers
9. Create descriptor pool and allocate descriptor sets
10. Bind shutdown callback for cleanup

### Shader Compilation Pattern
Use the unified ShaderCompiler instead of separate compile functions:
```cpp
ShaderCompiler compiler;
auto vertSpirv = compiler.Compile(ShaderType::VERTEX, "../VertexShader.hlsl");
auto fragSpirv = compiler.Compile(ShaderType::FRAGMENT, "../FragmentShader_PBR.hlsl");
```

### Frame Loop Pattern
```cpp
while (win.ProcessWindowEvents()) {
    if (vulkan.StartFrame(clearCount, clearValues)) {
        renderService->BeginFrame();
        renderService->SubmitMesh(meshHandle, transform);
        renderService->EndFrame();
        vulkan.EndFrame(true);
    }
}
```

### Cleanup Order (reverse of init)
1. vkDeviceWaitIdle
2. Destroy buffers and free memory
3. Destroy descriptor pool and layout
4. Destroy shader modules
5. Destroy pipeline layout and pipeline
6. GVulkanSurface handles the rest

## Existing Helper Functions to Reuse

### From renderer.h (do not duplicate these)
- CreateViewportFromWindowDimensions()
- CreateScissorFromWindowDimensions()
- CreateVkPipelineInputAssemblyStateCreateInfo()
- CreateVkPipelineRasterizationStateCreateInfo()
- CreateVkPipelineMultisampleStateCreateInfo()
- CreateVkPipelineDepthStencilStateCreateInfo()
- CreateVkPipelineColorBlendAttachmentState()
- CreateVkPipelineColorBlendStateCreateInfo()
- CreateVkPipelineDynamicStateCreateInfo()
- CreateVkPipelineViewportStateCreateInfo()

### From Camera.h
- FreeLookCamera() for input-driven camera control

### From GraphicsHelper.hpp
- NDCToScreen() for coordinate conversion
- drawPixel() for software rasterizer fallback

## Rules
1. Never create a Vulkan resource without a corresponding destroy in CleanUp.
2. Always check VkResult after Vulkan API calls.
3. All rendering parameters come from RenderConfig, never hardcoded.
4. Log every shader compilation with QuoteSystem (SUCCESS or ERROR_MSG).
5. Register "Renderer" channel with DebugWindow at init.
6. CheckFileExists for every shader file before attempting compilation.

---

# TASK: PHASE 1 - ANALYSIS

# Phase 1: Analysis - Task Breakdown

## Agent: RepoAnalyzer
## Gate: Must complete before all other phases

---

## Task 1.1: Map Project Structure
**Status:** TODO
**Priority:** HIGH
**Estimated Time:** 1 hour

### Steps
1. List every source file and categorize by role (rendering, math, UI, utility, game logic)
2. Identify which files belong to the software rasterizer path vs the Vulkan path
3. Document include dependency chains (which headers include which)
4. Flag any circular dependencies
5. Note files that exist in project but are unused or orphaned

### Output
- File: `analysis/structure_map.md`
- Diagram: Include dependency graph (text-based)

### Debug Checkpoint
- QuoteSystem log: "Project structure mapped" (INFO)
- DebugWindow post to "Engine" channel with file count summary

---

## Task 1.2: Identify Rendering Pipeline Flow
**Status:** TODO
**Priority:** HIGH
**Estimated Time:** 2 hours

### Steps
1. Trace the Vulkan pipeline from main.cpp through Renderer constructor to Render()
2. Document each Vulkan resource created (buffers, descriptors, shaders, pipeline)
3. Trace the software rasterizer from App through Renderer.renderMesh() to pixel output
4. Map the data flow: vertex data -> transforms -> rasterization -> pixel buffer
5. Identify which pipeline is active in the current main.cpp (Vulkan is active)

### Output
- File: `analysis/pipeline_flow.md`
- Flow diagrams for both paths

### Debug Checkpoint
- QuoteSystem log: "Pipeline analysis complete" (SUCCESS)
- DebugWindow post to "Renderer" channel with pipeline stage list

---

## Task 1.3: Audit UI/UX Implementation
**Status:** TODO
**Priority:** MEDIUM
**Estimated Time:** 1.5 hours

### Steps
1. Review existing wxWidgets UI files (App.h/cpp, MainWindow.h/cpp, DrawingPanel.h/cpp)
2. Document which UI components exist and their current functionality
3. Identify coupling between UI event handlers and rendering code
4. Note any hardcoded UI values (positions, sizes, colors)
5. List missing UI components needed for a 3D editor (viewport, tool panel, property inspector)

### Output
- File: `analysis/ui_audit.md`

### Debug Checkpoint
- QuoteSystem log: "UI audit complete" (INFO)
- DebugWindow post to "UI" channel with component inventory

---

## Task 1.4: Detect Coupling Issues
**Status:** TODO
**Priority:** HIGH
**Estimated Time:** 1.5 hours

### Steps
1. Find places where rendering code directly reads UI state
2. Find places where UI code directly calls rendering functions
3. Identify global mutable state (extern variables in Shaders.h)
4. List functions that do more than one thing (violate single responsibility)
5. Flag hardcoded values that should be config-driven

### Known Issues to Investigate
- `extern Matrix4x4 vsWorld, vsView, vsProjection;` in Shaders.h (global mutable state)
- `extern bool isCube;` controls rendering mode globally
- `extern VertexShaderFunc VertexShader;` is a global function pointer
- The software Renderer directly accesses GraphicsHelper internals
- Camera.h uses static locals making FreeLookCamera non-reentrant

### Output
- File: `analysis/coupling_report.md`
- Severity rating for each coupling issue (LOW/MED/HIGH)

### Debug Checkpoint
- QuoteSystem log for each HIGH severity issue (WARNING)
- DebugWindow post to "Engine" channel with coupling count

---

## Task 1.5: Identify Reusable vs Hardcoded Logic
**Status:** TODO
**Priority:** MEDIUM
**Estimated Time:** 1 hour

### Steps
1. For each source file, tag functions as REUSABLE or HARDCODED
2. REUSABLE = function works with any input, no magic numbers inside
3. HARDCODED = function has literal values, fixed array sizes, or path strings
4. List functions that are nearly identical across files (candidates for merging)
5. Estimate effort to make HARDCODED functions configurable

### Known Candidates for Merging
- CompileVertexShader() and CompileFragmentShader() in renderer.h are nearly identical.
  Combine into CompileShader(type, sourcePath, entryPoint)
- The three CreateVk*StateCreateInfo() functions follow the same pattern.
  Could use a builder pattern or template
- setProjection() in Renderer.h and the projection setup in renderer.h
  do the same math differently. Unify into one function

### Output
- File: `analysis/reuse_inventory.md`

---

## Task 1.6: Produce Improvement Roadmap
**Status:** TODO (depends on Tasks 1.1 through 1.5)
**Priority:** HIGH
**Estimated Time:** 1 hour

### Steps
1. Prioritize coupling issues by impact and effort
2. Define refactoring order (what must change first to unblock other work)
3. Estimate time for each Phase 2/3/4 task based on analysis findings
4. Identify risks (things that might be harder than expected)
5. Create a dependency graph showing which tasks block which

### Output
- File: `analysis/roadmap.md`

### Debug Checkpoint
- QuoteSystem log: "Analysis phase complete, roadmap generated" (SUCCESS)
- DebugWindow PrintDashboard() to show full system status

---

# TASK: PHASE 2 - BACKEND REFACTOR

# Phase 2: Backend Refactor - Task Breakdown

## Agents: RenderingEngineer + FileSystemEngineer (parallel)
## Prerequisite: Phase 1 Analysis complete

---

# RENDERING ENGINEER TASKS

## Task 2.1: Extract Vulkan Context
**Status:** TODO
**Priority:** HIGH

### Steps
1. Create VulkanContext class that owns VkDevice, VkPhysicalDevice, VkInstance
2. Move GetHandlesFromSurface() logic into VulkanContext constructor
3. Provide getters for device handles used by other subsystems
4. Add validation: check device features (bindless, descriptor indexing) at init
5. Register with DebugWindow "Renderer" channel

### Files to Modify
- renderer.h (extract device management out)
- main.cpp (create VulkanContext before Renderer)

### Files to Create
- src/rendering/VulkanContext.h

### Reuse From Existing Code
- GetHandlesFromSurface() pattern from renderer.h (do not rewrite, move it)

### Debug Checkpoint
```cpp
quoteSystem.Log("VulkanContext initialized", QuoteSystem::MessageType::SUCCESS);
debugWindow.Post("Renderer", "Device: " + deviceName, DebugLevel::INFO);
debugWindow.CheckFileExists("Renderer", "../VertexShader.hlsl");
```

---

## Task 2.2: Create ShaderCompiler Service
**Status:** TODO
**Priority:** HIGH

### Steps
1. Create ShaderCompiler class that wraps shaderc
2. Combine CompileVertexShader() and CompileFragmentShader() into one method
   using a shader type parameter (switch on VK_SHADER_STAGE_VERTEX_BIT vs FRAGMENT_BIT)
3. Add retry mechanism: if compilation fails, wait 100ms and retry once
   (handles cases where file is still being written by editor)
4. Return compiled SPIR-V bytes, not VkShaderModule (let caller create module)
5. Cache compiled shaders by file hash to avoid recompilation

### Current Code to Merge
These two functions from renderer.h are nearly identical:
```
CompileVertexShader()    -> reads file, calls shaderc_compile_into_spv, creates module
CompileFragmentShader()  -> reads file, calls shaderc_compile_into_spv, creates module
CompilePBRFragmentShader() -> same pattern with different options
```
Merge into:
```
CompileShader(ShaderType type, const std::string& path, const ShaderOptions& options)
```

### Files to Create
- src/rendering/ShaderCompiler.h

### Debug Checkpoint
```cpp
quoteSystem.Log("Shader compiled: " + path, QuoteSystem::MessageType::SUCCESS);
// On failure:
quoteSystem.Log("Shader compilation FAILED, retrying...", QuoteSystem::MessageType::WARNING);
```

---

## Task 2.3: Create DescriptorManager
**Status:** TODO
**Priority:** HIGH

### Steps
1. Create DescriptorManager class that owns pools, layouts, and sets
2. Move CreateDescriptorSetLayout(), CreateTextureDescriptorSetLayout(),
   CreateDescriptorPool(), AllocateDescriptorSets() into this class
3. Support dynamic descriptor allocation for multiple materials
4. Handle pool exhaustion gracefully (create new pool, log warning)

### Files to Modify
- renderer.h (remove descriptor management code)

### Files to Create
- src/rendering/DescriptorManager.h

---

## Task 2.4: Create BufferAllocator
**Status:** TODO
**Priority:** MEDIUM

### Steps
1. Create BufferAllocator that wraps GvkHelper::create_buffer
2. Track all allocations for cleanup
3. Provide typed helpers: CreateVertexBuffer, CreateIndexBuffer, CreateUniformBuffer
4. Add memory budget tracking and warning when approaching limits

### Reuse From Existing Code
- InitalializeUniformBuffers() pattern from renderer.h
- Buffer creation + write pattern is repeated everywhere

### Files to Create
- src/rendering/BufferAllocator.h

---

## Task 2.5: Implement RenderService Interface
**Status:** TODO
**Priority:** HIGH
**Depends On:** Tasks 2.1 through 2.4

### Steps
1. Create IRenderService abstract interface (see pipeline blueprint)
2. Create VulkanRenderService that implements IRenderService using
   the components from tasks 2.1 through 2.4
3. Separate Render() into BeginFrame/SubmitMesh/EndFrame
4. Make the software rasterizer also implement IRenderService (optional, lower priority)

### Files to Create
- src/rendering/IRenderService.h
- src/rendering/VulkanRenderService.h

---

## Task 2.6: Config-Driven Rendering
**Status:** TODO
**Priority:** MEDIUM

### Steps
1. Create RenderConfig struct with all rendering parameters
2. Load config from JSON or INI file at startup
3. Replace all hardcoded values in renderer.h with config lookups
4. Support runtime config changes (wireframe toggle, MSAA change)

### Hardcoded Values to Extract (from current codebase)
- Window size 800x600 in main.cpp
- Clear color {0.5f, 0.0f, 0.0f, 1.0f} in main.cpp
- Grid size 25 in renderer.h
- Camera speed 0.3f in Camera.h
- FOV 45 degrees in Renderer.h

---

# FILE SYSTEM ENGINEER TASKS

## Task 2.7: Design File Ingestion System
**Status:** TODO
**Priority:** HIGH

### Steps
1. Create FileService class with format validation
2. Support these formats: OBJ, FBX, GLTF/GLB, PNG, JPG, TGA, HDR
3. Validate file format at boundary (check magic bytes, not just extension)
4. Return standardized internal format regardless of input format
5. Add QuoteSystem logging for every file load attempt

### Files to Create
- src/filesystem/FileService.h
- src/filesystem/FormatValidator.h

### Debug Checkpoint
```cpp
debugWindow.CheckFileExists("FileSystem", filePath);
quoteSystem.Log("Loaded: " + filePath, QuoteSystem::MessageType::SUCCESS);
// On invalid format:
quoteSystem.Log("Invalid format: " + filePath, QuoteSystem::MessageType::ERROR_MSG);
```

---

## Task 2.8: Create Asset Index
**Status:** TODO
**Priority:** MEDIUM

### Steps
1. Create AssetIndex class that maintains a searchable catalog of loaded assets
2. Index by: name, type, tags, file path
3. Support search queries: "find all GLTF models", "find texture named 'albedo'"
4. Persist index to disk (SQLite or JSON) for fast startup

### SQL Usage Note
This is an ideal place for SQLite:
```sql
CREATE TABLE assets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,       -- 'mesh', 'texture', 'material', 'shader'
    path TEXT UNIQUE NOT NULL,
    format TEXT NOT NULL,     -- 'gltf', 'obj', 'png', etc.
    size_bytes INTEGER,
    last_modified TEXT,
    tags TEXT                 -- comma-separated for simple queries
);

-- Fast lookup by type
CREATE INDEX idx_type ON assets(type);

-- Search by name
SELECT * FROM assets WHERE name LIKE '%character%' AND type = 'mesh';
```

### Files to Create
- src/filesystem/AssetIndex.h

---

## Task 2.9: Drag-and-Drop Backend
**Status:** TODO
**Priority:** MEDIUM
**Depends On:** Tasks 2.7 and 2.8

### Steps
1. Create DropHandler that receives file paths from the OS drop event
2. For each dropped file: validate format -> load -> index -> notify UI
3. Support batch drops (multiple files at once)
4. Queue files for async loading (do not block the render loop)

### Files to Create
- src/filesystem/DropHandler.h

---

## Testing Requirements for Phase 2

All Phase 2 tasks must register tests with TestManager:

```cpp
TestManager tm;

// Rendering tests
tm.AddTest("Renderer", "VulkanContext creates device", []() { ... });
tm.AddTest("Renderer", "ShaderCompiler compiles vertex shader", []() { ... });
tm.AddTest("Renderer", "ShaderCompiler retry on failure", []() { ... });
tm.AddTest("Renderer", "DescriptorManager creates layout", []() { ... });

// FileSystem tests
tm.AddTest("FileSystem", "FormatValidator accepts GLTF", []() { ... });
tm.AddTest("FileSystem", "FormatValidator rejects bad extension", []() { ... });
tm.AddTest("FileSystem", "AssetIndex search by name", []() { ... });
tm.AddTest("FileSystem", "DropHandler validates before loading", []() { ... });
```

---

# TASK: PHASE 3 - UI/UX DESIGN

# Phase 3: UI/UX Design - Task Breakdown

## Agents: UIUXArchitect + AIDesignAssistant (parallel)
## Prerequisite: Phase 1 Analysis complete

---

# UI/UX ARCHITECT TASKS

## Task 3.1: Design 3D Editor Layout
**Status:** TODO
**Priority:** HIGH

### Goal
Define the spatial arrangement of the 3D editor interface. The layout must
support a central viewport with surrounding tool panels that can be resized,
collapsed, and rearranged by the user.

### Layout Components
1. **Viewport** (center, takes remaining space)
   - Renders the 3D scene from VulkanRenderService
   - Handles mouse input for camera orbit, pan, zoom
   - Overlay for gizmo controls (move, rotate, scale)

2. **ToolPanel** (left sidebar, collapsible)
   - Sculpting tools: smooth, inflate, pinch, flatten
   - Transform tools: move, rotate, scale
   - Selection modes: vertex, edge, face, object

3. **PropertyInspector** (right sidebar, collapsible)
   - Shows properties of selected object
   - Material editor (PBR parameters from FragmentShader_PBR.hlsl)
   - Transform values (position, rotation, scale)

4. **AssetBrowser** (bottom panel, collapsible)
   - Drag-and-drop zone for file ingestion
   - Searchable grid/list view of loaded assets
   - Thumbnail previews

5. **MenuBar** (top)
   - File, Edit, View, Tools, Help
   - Quick-access toolbar with common operations

### Layout Tree
```
ApplicationWindow
  MenuBar
  HorizontalSplit
    ToolPanel (left, 200px default, min 150px)
    VerticalSplit
      Viewport (center, flex)
      AssetBrowser (bottom, 250px default, min 100px)
    PropertyInspector (right, 300px default, min 200px)
```

### Config-Driven Layout
All panel sizes, positions, and visibility states must come from a layout
config file so users can save and restore their workspace arrangement.

```json
{
  "layout": {
    "toolPanel": { "width": 200, "visible": true, "side": "left" },
    "propertyInspector": { "width": 300, "visible": true, "side": "right" },
    "assetBrowser": { "height": 250, "visible": true, "position": "bottom" }
  }
}
```

### Output
- File: `ui/layout_tree.md`
- File: `ui/default_layout.json`

### Debug Checkpoint
```cpp
debugWindow.Post("UI", "Layout initialized from config", DebugLevel::INFO);
quoteSystem.Log("Editor layout ready", QuoteSystem::MessageType::SUCCESS);
```

---

## Task 3.2: Design Upload Interface
**Status:** TODO
**Priority:** HIGH

### Components

1. **DragDropZone** - Accepts files dragged from OS file explorer
   - Visual feedback: border highlights, file type icons
   - Shows progress bar during loading
   - Validates format before attempting load
   - Connects to FileService (Phase 2) via event bus

2. **FileSearchBox** - Text input for searching loaded assets
   - Filters AssetIndex results in real time
   - Supports type filters: "type:mesh", "type:texture"
   - Keyboard shortcut: Ctrl+F to focus

3. **FileList** - Grid or list view of search results
   - Thumbnail preview for textures
   - Wireframe preview for meshes
   - Double-click to load into viewport
   - Right-click context menu: rename, delete, properties

### Interaction Map
```
User drags file onto DragDropZone
  -> DragDropZone emits "file.dropped" event with file path
  -> FileService validates and loads the file
  -> FileService emits "file.loaded" event with asset handle
  -> AssetIndex adds entry
  -> FileList refreshes to show new asset
  -> QuoteSystem logs success
```

### Output
- File: `ui/upload_interface.md`
- File: `ui/interaction_map.md`

---

## Task 3.3: Define Component Architecture
**Status:** TODO
**Priority:** HIGH

### Design Tokens
All UI styling must use design tokens, never hardcoded colors or sizes:

```json
{
  "tokens": {
    "color": {
      "background": { "primary": "#1E1E2E", "secondary": "#2A2A3E" },
      "text": { "primary": "#FFFFFF", "secondary": "#B0B0C0" },
      "accent": { "primary": "#7C3AED", "hover": "#8B5CF6" },
      "status": {
        "success": "#22C55E",
        "warning": "#EAB308",
        "error": "#EF4444",
        "info": "#3B82F6"
      }
    },
    "spacing": { "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32 },
    "radius": { "sm": 4, "md": 8, "lg": 12 },
    "font": {
      "family": "Inter, system-ui, sans-serif",
      "size": { "sm": 12, "md": 14, "lg": 16, "xl": 20 }
    }
  }
}
```

### Component Definitions

Each component follows this pattern:
- Props (configurable inputs)
- State (internal reactive data)
- Events (what it emits to the event bus)
- Slots (where child components can be injected)

### Output
- File: `ui/component_definitions.md`
- File: `ui/design_tokens.json`

---

## Task 3.4: Accessibility and Responsiveness
**Status:** TODO
**Priority:** MEDIUM

### Requirements
1. All interactive elements must be keyboard-navigable
2. Panel resize handles must have minimum touch target of 44px
3. Text must maintain 4.5:1 contrast ratio against backgrounds
4. Viewport must maintain aspect ratio when window resizes
5. Layout must work at minimum resolution of 1280x720

### Reuse From Existing Code
- The wxWidgets files (MainWindow, DrawingPanel, SettingsDialog) contain
  event handling patterns for resize, keyboard, and mouse that can inform
  the new component designs even though we are moving away from wxWidgets
  for the 3D editor.

---

# AI DESIGN ASSISTANT TASKS

## Task 3.5: Generate Layout Concepts
**Status:** TODO
**Priority:** MEDIUM

### Steps
1. Create three layout variations: Minimal, Standard, Professional
2. Minimal: viewport-only with floating tool palettes
3. Standard: fixed sidebars with central viewport (default)
4. Professional: multi-viewport with dockable panels

### Output
- File: `ui/previews.md` with descriptions of each layout

---

## Task 3.6: Explain Design Tradeoffs
**Status:** TODO
**Priority:** LOW

### Document for each layout:
- Pros and cons
- Target user (beginner vs power user)
- Screen space efficiency
- Learning curve
- Implementation complexity

---

## Testing Requirements for Phase 3

```cpp
// UI tests verify component configuration, not rendering
tm.AddTest("UI", "Layout config loads valid JSON", []() { ... });
tm.AddTest("UI", "Design tokens all have required keys", []() { ... });
tm.AddTest("UI", "DragDropZone emits correct event type", []() { ... });
tm.AddTest("UI", "FileSearchBox filters by type prefix", []() { ... });
tm.AddTest("UI", "Panel minimum sizes are respected", []() { ... });
```

---

# TASK: PHASE 4 - FRONTEND IMPLEMENTATION

# Phase 4: Frontend Implementation - Task Breakdown

## Agent: FrontendEngineer
## Prerequisite: Phase 2 and Phase 3 complete

---

## Task 4.1: Implement Event Bus
**Status:** TODO
**Priority:** HIGH (blocks all other Phase 4 tasks)

### Purpose
The event bus is the nervous system of the engine. It allows subsystems to
communicate without direct references to each other. The renderer does not
know the UI exists, and the UI does not know the renderer exists. They both
just post and listen for events.

### Design
```cpp
// EventBus.h - Typed, decoupled event system
// Uses string event names with typed payloads
// Thread-safe via mutex on subscribe/publish

class EventBus {
public:
    // Subscribe a callback to an event name
    // Returns a subscription ID for later unsubscribe
    int Subscribe(const std::string& eventName, EventCallback callback);

    // Remove a subscription by ID
    void Unsubscribe(int subscriptionId);

    // Publish an event to all subscribers
    // The payload is a variant type (string, int, float, or void*)
    void Publish(const std::string& eventName, const EventPayload& payload);
};
```

### Event Catalog
These are the standard events that flow through the system:

| Event Name | Payload | Producer | Consumer |
|-----------|---------|----------|----------|
| file.dropped | string (path) | DragDropZone | FileService |
| file.loaded | AssetHandle | FileService | AssetBrowser, Viewport |
| file.error | string (message) | FileService | StatusBar |
| asset.selected | AssetHandle | AssetBrowser | PropertyInspector |
| tool.changed | ToolType enum | ToolPanel | Viewport |
| camera.updated | CameraData | Viewport | RenderService |
| render.frame_start | none | Engine | RenderService |
| render.frame_end | none | RenderService | UI (for FPS counter) |
| config.changed | ConfigKey+Value | SettingsDialog | All subsystems |

### Files to Create
- src/core/EventBus.h

### Reuse From Existing Code
- GW::CORE::GEventReceiver pattern from Camera.h and main.cpp
  shows how Gateware does events. Our EventBus wraps similar concepts
  but with string-based event names for flexibility.

### Debug Checkpoint
```cpp
quoteSystem.Log("EventBus initialized with " + std::to_string(count)
    + " default subscriptions", QuoteSystem::MessageType::SUCCESS);
debugWindow.Post("Engine", "EventBus ready", DebugLevel::INFO);
```

---

## Task 4.2: Build DragDropZone Component
**Status:** TODO
**Priority:** HIGH

### Steps
1. Create a UI region that accepts OS-level drag-and-drop events
2. On dragenter: show visual highlight (border glow, icon change)
3. On drop: extract file path, emit "file.dropped" event
4. On dragexit: remove visual highlight
5. Show loading spinner while FileService processes the file
6. On "file.loaded" event: show success state briefly, then reset
7. On "file.error" event: show error message with retry button

### Guard Clauses
- Reject drops of unsupported file types immediately (before sending to FileService)
- Reject drops while another file is still loading (queue them instead)
- Validate path is not empty and file actually exists on disk

### Files to Create
- src/ui/DragDropZone.h

### Debug Checkpoint
```cpp
quoteSystem.Log("File dropped: " + path, QuoteSystem::MessageType::INFO);
debugWindow.Post("UI", "DragDrop accepted: " + path, DebugLevel::INFO);
// On rejection:
quoteSystem.Log("Unsupported format rejected: " + ext,
    QuoteSystem::MessageType::WARNING);
```

---

## Task 4.3: Build Searchable File Browser
**Status:** TODO
**Priority:** MEDIUM

### Steps
1. Create FileSearchBox with text input and type filter dropdown
2. Create FileList that displays AssetIndex query results
3. Wire FileSearchBox onChange to AssetIndex search query
4. Display results as thumbnail grid (textures) or icon list (meshes)
5. Support keyboard navigation: arrow keys to move, Enter to select
6. Double-click item emits "asset.selected" event

### Reuse From Existing Code
- CalculatorProcessor.h/cpp has input processing patterns
- ButtonFactory.h/cpp has UI component creation patterns
  These are wxWidgets-based but the event wiring logic transfers

### Files to Create
- src/ui/FileSearchBox.h
- src/ui/FileList.h
- src/ui/AssetBrowser.h (composes FileSearchBox + FileList)

---

## Task 4.4: Implement 3D Viewport UI
**Status:** TODO
**Priority:** HIGH

### Steps
1. Create Viewport component that hosts the Vulkan render surface
2. Forward mouse events to camera controller (orbit, pan, zoom)
3. Forward keyboard events to tool system
4. Overlay gizmo handles for selected object manipulation
5. Display FPS counter and render stats in corner overlay
6. Handle resize events: update viewport dimensions and projection matrix

### Reuse From Existing Code
- FreeLookCamera() from Camera.h handles input-to-camera-matrix conversion
  Extract the input reading portion into a reusable InputMapper
- DrawingPanel.h/cpp has the pattern for embedding a render surface in a panel
  The OnPaint/OnResize event handlers transfer to Vulkan surface events

### Integration Points
- Viewport subscribes to "tool.changed" to switch input modes
- Viewport publishes "camera.updated" when mouse moves
- Viewport subscribes to "asset.selected" to highlight objects
- Viewport reads render stats from RenderService for FPS display

### Files to Create
- src/ui/Viewport.h
- src/ui/GizmoOverlay.h

---

## Task 4.5: Connect UI via Event System
**Status:** TODO
**Priority:** HIGH
**Depends On:** Tasks 4.1 through 4.4

### Steps
1. Wire all components to EventBus (subscribe + publish)
2. Verify no component directly references another component
3. Test event flow end-to-end: drop file -> load -> display in browser -> select -> show in inspector
4. Add event logging to DebugWindow for tracing event flow

### Validation Checklist
- [ ] DragDropZone only publishes, never subscribes to FileService directly
- [ ] FileList only subscribes to "file.loaded", never calls FileService.Load()
- [ ] Viewport only subscribes to "camera.updated", never reads input directly
  (it delegates to a CameraController that reads input)
- [ ] PropertyInspector only subscribes to "asset.selected", never queries AssetIndex
- [ ] No #include between ui/ and rendering/ directories
- [ ] No #include between ui/ and filesystem/ directories

### Debug Checkpoint
```cpp
// Log every event publish for debugging
eventBus.Subscribe("*", [](const std::string& name, const EventPayload& p) {
    debugWindow.Post("Engine", "Event: " + name, DebugLevel::TRACE);
});
```

---

## Testing Requirements for Phase 4

```cpp
// Event bus tests
tm.AddTest("EventBus", "Subscribe and publish delivers callback", []() { ... });
tm.AddTest("EventBus", "Unsubscribe stops delivery", []() { ... });
tm.AddTest("EventBus", "Multiple subscribers all receive event", []() { ... });

// Component tests
tm.AddTest("UI", "DragDropZone rejects unsupported extension", []() { ... });
tm.AddTest("UI", "FileSearchBox filters results by query", []() { ... });
tm.AddTest("UI", "Viewport forwards resize to projection update", []() { ... });

// Integration tests (no rendering, just event flow)
tm.AddTest("Integration", "Drop file triggers file.loaded event", []() { ... });
tm.AddTest("Integration", "File loaded appears in FileList", []() { ... });
tm.AddTest("Integration", "Select asset updates PropertyInspector", []() { ... });
```

---

# TASK: PHASE 5 - INTEGRATION

# Phase 5: Integration - Task Breakdown

## Agents: RenderingEngineer + FrontendEngineer + FileSystemEngineer
## Prerequisite: Phases 2, 3, and 4 complete

---

## Task 5.1: Wire Rendering to Event Bus
**Status:** TODO
**Priority:** HIGH

### Steps
1. VulkanRenderService subscribes to "render.frame_start" to begin recording commands
2. VulkanRenderService subscribes to "camera.updated" to update view matrix
3. VulkanRenderService subscribes to "config.changed" to hot-reload render settings
4. VulkanRenderService publishes "render.frame_end" with frame statistics
5. Verify zero direct calls between UI code and VulkanRenderService

### Validation
- Render loop only communicates through EventBus
- Camera updates flow: Viewport -> "camera.updated" event -> RenderService
- Config changes flow: SettingsDialog -> "config.changed" event -> RenderService

### Debug Checkpoint
```cpp
quoteSystem.Log("Render-Event wiring complete", QuoteSystem::MessageType::SUCCESS);
debugWindow.Post("Renderer", "Subscribed to " + std::to_string(count) + " events",
    DebugLevel::INFO);
```

---

## Task 5.2: Wire FileSystem to Event Bus
**Status:** TODO
**Priority:** HIGH

### Steps
1. FileService subscribes to "file.dropped" to receive new file paths
2. FileService publishes "file.loaded" after successful load and index
3. FileService publishes "file.error" when validation or loading fails
4. AssetIndex subscribes to "file.loaded" to add entries
5. AssetIndex publishes "index.updated" when the catalog changes

### End-to-End File Flow
```
User drops file -> OS drag event -> DragDropZone
  -> publishes "file.dropped" with path
  -> FileService receives, validates format
  -> FileService loads asset (mesh, texture, etc.)
  -> FileService publishes "file.loaded" with handle
  -> AssetIndex adds entry, publishes "index.updated"
  -> AssetBrowser refreshes display
  -> QuoteSystem logs success with Harry Potter quote
```

---

## Task 5.3: End-to-End Smoke Test
**Status:** TODO
**Priority:** HIGH

### Test Scenarios

1. **Cold Start Test**
   - Launch engine with no assets
   - Verify empty viewport renders without crash
   - Verify all panels load with default layout
   - Verify DebugWindow dashboard shows all channels green
   - Verify QuoteSystem logs "Engine initialized" with INFO

2. **File Load Test**
   - Drop a GLTF file onto DragDropZone
   - Verify file appears in AssetBrowser within 2 seconds
   - Verify model renders in viewport
   - Verify PropertyInspector shows mesh properties when selected

3. **Camera Interaction Test**
   - Click viewport and use WASD to move camera
   - Verify smooth movement without stuttering
   - Verify view matrix updates propagate to shader uniforms
   - Verify camera state persists across file loads

4. **Config Change Test**
   - Toggle wireframe mode in settings
   - Verify viewport immediately switches to wireframe rendering
   - Toggle back and verify solid rendering restores
   - Verify config change event flows through EventBus (visible in DebugWindow)

5. **Stress Test**
   - Load 10 different GLTF models simultaneously
   - Verify no memory leaks (track allocations in BufferAllocator)
   - Verify frame rate stays above 30fps with simple models
   - Verify AssetIndex handles batch additions correctly

### Debug Checkpoint for Each Test
```cpp
// At the start of each test scenario
quoteSystem.Log("Starting smoke test: " + testName, QuoteSystem::MessageType::INFO);
// At the end
quoteSystem.Log("Smoke test PASSED: " + testName, QuoteSystem::MessageType::SUCCESS);
// On failure
quoteSystem.Log("Smoke test FAILED: " + testName + " - " + reason,
    QuoteSystem::MessageType::ERROR_MSG);
```

---

## Task 5.4: Performance Optimization
**Status:** TODO
**Priority:** MEDIUM

### Steps
1. Profile frame time breakdown (update vs record vs submit)
2. Identify bottlenecks using DebugWindow timing channels
3. Batch draw calls for objects sharing the same material
4. Minimize descriptor set bindings per frame
5. Consider frustum culling for large scenes

### Assembly Optimization Candidates
- Matrix multiplication in the vertex transform loop
  Current path: Matrix4x4::transformVector called per-vertex
  Optimized: SIMD batch transform using _mm256_mul_ps (AVX)
  Expected gain: 4-8x on the transform stage

- Uniform buffer updates use GvkHelper::write_to_buffer which calls memcpy
  If profiling shows this is hot, replace with SSE streaming stores
  (_mm_stream_si128) to avoid polluting CPU cache

### SQL Optimization Candidates
- Frame timing data logged to SQLite for offline analysis
  ```sql
  CREATE TABLE frame_stats (
      frame_id INTEGER PRIMARY KEY,
      timestamp TEXT,
      update_ms REAL,
      record_ms REAL,
      submit_ms REAL,
      total_ms REAL,
      draw_calls INTEGER,
      vertices INTEGER
  );
  -- Find frames that took longer than 16ms (60fps target)
  SELECT * FROM frame_stats WHERE total_ms > 16.0 ORDER BY total_ms DESC;
  ```

---

## Task 5.5: Documentation and Portfolio Polish
**Status:** TODO
**Priority:** MEDIUM

### Steps
1. Write README.md with build instructions and feature overview
2. Add screenshots and GIF recordings of the editor in action
3. Document the architecture with diagrams
4. Write code comments for every public method (already in progress)
5. Create a "Getting Started" guide for new developers

### Portfolio Showcase Points
- Modular rendering pipeline with abstraction layer
- Config-driven architecture with zero hardcoded values
- Event-driven communication between decoupled subsystems
- Custom debug tooling (QuoteSystem + DebugWindow + TestManager)
- PBR rendering with IBL
- File ingestion with format validation

---

## Final Checklist Before Release

- [ ] All TestManager suites pass
- [ ] DebugWindow dashboard shows zero errors across all channels
- [ ] QuoteSystem integrity checks pass for all subsystems
- [ ] No hardcoded values remain (search for magic numbers)
- [ ] No direct coupling between UI and rendering (grep for cross-layer includes)
- [ ] All public methods have doc comments
- [ ] Config files load cleanly with defaults for missing values
- [ ] Engine starts and shuts down without memory leaks (check CleanUp)
- [ ] Frame rate stable above 30fps with test scene
- [ ] Build succeeds on Windows (MSVC) and ideally Linux (GCC/Clang)

---

# TASK: Z-DEPTH PRECISION FIX

# Z-Depth Precision Fix - Task Breakdown

## Context
Lab 7 Section B requires implementing reversed-Z depth buffering to handle
aggressive near/far plane ratios (0.00001f to 10000.0f) without Z-fighting.
The current codebase uses standard-Z (clear to 1, compare LESS) which causes
severe depth precision breakdown at distance.

## Prerequisite Reading
- docs/Z_DEPTH_ANALYSIS.md (full analysis with explanations)
- skills/rendering/SKILL.md (pipeline conventions)
- skills/quotesystem/SKILL.md (logging requirements)

---

## Task Z1: Change Depth Clear Value
**Status:** TODO
**Priority:** CRITICAL (must be done together with Z2, Z3, Z4)
**File:** main.cpp, line 51

### Current Code
```cpp
clrAndDepth[1].depthStencil = { 1.0f, 0u };
```

### Required Change
```cpp
clrAndDepth[1].depthStencil = { 0.0f, 0u };
```

### Why
In reversed-Z, the far plane maps to 0.0. Clearing to 0.0 means every
pixel starts at "infinitely far away" so any geometry drawn will pass
the GREATER depth test.

---

## Task Z2: Swap Depth Comparison Operator
**Status:** TODO
**Priority:** CRITICAL
**File:** renderer.h, CreateVkPipelineDepthStencilStateCreateInfo()

### Current Code
```cpp
retval.depthCompareOp = VK_COMPARE_OP_LESS;
retval.minDepthBounds = 0.0f;
retval.maxDepthBounds = 1.0f;
```

### Required Change
```cpp
retval.depthCompareOp = VK_COMPARE_OP_GREATER;
retval.minDepthBounds = 1.0f;
retval.maxDepthBounds = 0.0f;
```

### Why
Closer fragments now have LARGER depth values (near 1.0), so we keep
the fragment with the GREATER value. The bounds are swapped to match
the new valid range direction.

---

## Task Z3: Reverse Viewport Depth Range
**Status:** TODO
**Priority:** CRITICAL
**File:** renderer.h, CreateViewportFromWindowDimensions()

### Current Code
```cpp
retval.minDepth = 0;
retval.maxDepth = 1;
```

### Required Change
```cpp
retval.minDepth = 1.0f;
retval.maxDepth = 0.0f;
```

### Why
This inverts the depth mapping in the viewport transform so that NDC
depth 0 (near plane) maps to framebuffer depth 1.0 and NDC depth 1
(far plane) maps to framebuffer depth 0.0.

---

## Task Z4: Set Aggressive Near/Far Planes
**Status:** TODO
**Priority:** HIGH
**File:** renderer.h, InitializeProjectionMatrix()

### Current Code
```cpp
float nearPlane = 0.1f;
float farPlane = 100.0f;
```

### Required Change
```cpp
float nearPlane = 0.00001f;
float farPlane = 10000.0f;
```

### Why
Lab 7 Task B1 requires these values to demonstrate the depth precision
problem. With reversed-Z active (Tasks Z1-Z3), these aggressive values
will work correctly without Z-fighting.

---

## Task Z5: Add Rotating Light Direction (Lab 7 Task B3)
**Status:** TODO
**Priority:** MEDIUM
**File:** renderer.h, Render() function

### Steps
1. Track elapsed time since program start using chrono
2. Create a Y-axis rotation matrix using elapsed time as radians
3. Rotate the original sun direction vector by the rotation matrix
4. Normalize the result and set it in SHADER_VARS
5. The light should smoothly orbit around the model

### Required Code (insert before uniform buffer update in Render)
```cpp
static auto startTime = std::chrono::steady_clock::now();
double elapsed = std::chrono::duration<double>(
    std::chrono::steady_clock::now() - startTime).count();

GW::MATH::GMATRIXF lightRotation = GW::MATH::GIdentityMatrixF;
mathLibrary.RotateYGlobalF(lightRotation, static_cast<float>(elapsed), lightRotation);

GW::MATH::GVECTORF originalSunDir = { -1.0f, -1.0f, 2.0f, 0.0f };
GW::MATH::GVECTORF rotatedSunDir;
mathLibrary.VectorXMatrixF(originalSunDir, lightRotation, rotatedSunDir);
mathLibrary.NormalizeF(rotatedSunDir, rotatedSunDir);

shaderVars.sunDirection = rotatedSunDir;
```

---

## Task Z6: Add QuoteSystem and DebugWindow Integration
**Status:** TODO
**Priority:** MEDIUM

### Steps
1. Log reversed-Z activation in the Renderer constructor
2. Add DebugWindow post to "Renderer" channel confirming depth mode
3. Add TestManager tests validating all four depth config values
4. Add QuoteSystem security integrity check for depth configuration

### Required Logging
```cpp
quoteSystem.Log("Reversed-Z depth buffer active", QuoteSystem::MessageType::SUCCESS);
debugWindow.Post("Renderer", "Depth mode: REVERSED-Z (GREATER, clear=0, viewport=1->0)",
    DebugLevel::INFO);
```

### Required Tests
```cpp
tm.AddTest("Renderer", "Depth clear value is 0 for reversed-Z", [&]() {
    return clrAndDepth[1].depthStencil.depth == 0.0f;
});
tm.AddTest("Renderer", "Viewport depth is reversed (min=1, max=0)", [&]() {
    VkViewport vp = CreateViewportFromWindowDimensions();
    return vp.minDepth == 1.0f && vp.maxDepth == 0.0f;
});
tm.AddTest("Renderer", "Depth compare op is GREATER", [&]() {
    auto ds = CreateVkPipelineDepthStencilStateCreateInfo();
    return ds.depthCompareOp == VK_COMPARE_OP_GREATER;
});
```

---

## Task Z7: Software Rasterizer Depth Mode (Optional)
**Status:** TODO
**Priority:** LOW
**Files:** GraphicsHelper.hpp

### Steps
1. Add DepthMode enum (STANDARD, REVERSED) to GraphicsHelper
2. Make clearBuffer use config-driven clear value
3. Make drawPixel use config-driven comparison via switch
4. Default to STANDARD for backward compatibility

### See docs/Z_DEPTH_ANALYSIS.md for full implementation

---

## Verification Checklist

After applying Tasks Z1 through Z4:
- [ ] Bottle renders correctly at normal distance (same as before)
- [ ] Bottle remains clean and stable at extreme distance
- [ ] Near-plane clipping still works when camera is very close
- [ ] No Z-fighting visible with near=0.00001f, far=10000.0f
- [ ] Light rotates around model smoothly (Task Z5)
- [ ] DebugWindow shows "Depth mode: REVERSED-Z" in Renderer channel
- [ ] TestManager reports all depth tests PASS

## CRITICAL WARNING
Tasks Z1, Z2, Z3 MUST be applied together. If you change only the
comparison operator but not the clear value, nothing will render.
If you change only the viewport but not the comparison, everything
will be inside-out. All four changes work as a coordinated set.

---

# SOURCE: QuoteSystem.h (PRODUCTION READY - COPY TO PROJECT)

```cpp
// ============================================================================
// QuoteSystem.h - BrightForge Engine Motivational Logging System
// ============================================================================
// PURPOSE:  Provides themed console output using quotes from favorite books
//           and anime. Acts as both a debugging aid and a morale booster.
//           Each message type (SUCCESS, WARNING, ERROR, DEBUG, INFO) pulls
//           from a different quote pool so you always know at a glance
//           what kind of message you are reading.
//
// USAGE:    #include "QuoteSystem.h"
//           QuoteSystem qs;
//           qs.Log("Shader compiled", QuoteSystem::MessageType::SUCCESS);
//
// SOURCES:  Harry Potter, Alice in Wonderland, Holes, Maya Angelou,
//           Naruto, Black Clover
//
// SECURITY: The QuoteSystem doubles as a code-integrity checkpoint.
//           Each subsystem can register a "security quote" at init time.
//           If the quote changes at runtime it means someone tampered
//           with memory. See ValidateIntegrity() below.
//
// NOTES:    - Thread-safe via mutex on all public methods
//           - Verbose mode is togglable at runtime
//           - Log output goes to both console and optional file
//           - All configurable values are at the top as constants
// ============================================================================
#pragma once

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <random>
#include <chrono>
#include <mutex>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <functional>

// ============================================================================
// CONFIGURABLE CONSTANTS - Change these to customize behavior
// ============================================================================
namespace QuoteConfig {
    // Toggle verbose logging globally (set false for release builds)
    static bool VERBOSE_MODE = true;

    // Toggle file logging
    static bool FILE_LOGGING_ENABLED = false;

    // Default log file path (only used if FILE_LOGGING_ENABLED is true)
    static const char* DEFAULT_LOG_FILE = "brightforge_engine.log";

    // Maximum log entries kept in memory ring buffer
    static constexpr int MAX_LOG_HISTORY = 500;

    // Color codes for console output (ANSI escape sequences)
    // Set USE_ANSI_COLORS to false on Windows cmd that does not support them
    static bool USE_ANSI_COLORS = true;

    static const char* COLOR_RESET   = "\033[0m";
    static const char* COLOR_GREEN   = "\033[32m";    // SUCCESS
    static const char* COLOR_YELLOW  = "\033[33m";    // WARNING
    static const char* COLOR_RED     = "\033[31m";    // ERROR
    static const char* COLOR_CYAN    = "\033[36m";    // DEBUG
    static const char* COLOR_BLUE    = "\033[34m";    // INFO
    static const char* COLOR_MAGENTA = "\033[35m";    // SECURITY
}

// ============================================================================
// QuoteSystem Class
// ============================================================================
class QuoteSystem {
public:
    // -----------------------------------------------------------------
    // MessageType - Determines which quote pool is sampled and what
    //               color/prefix the console line gets.
    // -----------------------------------------------------------------
    enum class MessageType {
        SUCCESS,    // Task completed - Harry Potter celebration quotes
        WARNING,    // Something odd - Alice in Wonderland curiosity quotes
        ERROR_MSG,  // Something broke - Holes persistence quotes
        DEBUG,      // Dev info - Naruto determination quotes
        INFO,       // General info - Maya Angelou wisdom quotes
        SECURITY    // Integrity check - Black Clover willpower quotes
    };

    // -----------------------------------------------------------------
    // LogEntry - A single timestamped log record kept in the ring buffer
    // -----------------------------------------------------------------
    struct LogEntry {
        std::string timestamp;
        std::string message;
        std::string quote;
        MessageType type;
    };

private:
    // Quote pools organized by message type
    std::unordered_map<int, std::vector<std::string>> mQuotePools;

    // Ring buffer of recent log entries
    std::vector<LogEntry> mLogHistory;
    int mLogIndex;

    // Security integrity map: subsystem name -> hash of registration quote
    std::unordered_map<std::string, size_t> mIntegrityHashes;

    // Random engine for quote selection
    std::mt19937 mRng;

    // Thread safety
    mutable std::mutex mMutex;

    // Optional file stream for persistent logging
    std::ofstream mLogFile;

    // -----------------------------------------------------------------
    // InitializeQuotePools - Populates all quote vectors.
    //   Called once from the constructor.
    //   Each pool maps to a MessageType so the right flavor of quote
    //   appears for the right situation.
    //
    // WHY SEPARATE POOLS:
    //   A developer scanning console output can instantly tell SUCCESS
    //   from ERROR just by recognizing the quote style, even before
    //   reading the actual message. Harry Potter = good. Holes = bad.
    // -----------------------------------------------------------------
    void InitializeQuotePools() {
        // SUCCESS quotes - Harry Potter (celebration, triumph)
        mQuotePools[static_cast<int>(MessageType::SUCCESS)] = {
            "Mischief Managed!",
            "After all this time? Always.",
            "It does not do to dwell on dreams and forget to live.",
            "Happiness can be found even in the darkest of times, if one only remembers to turn on the light.",
            "We did it! The task is complete, just like finding the Snitch!",
            "I solemnly swear that this function is up to no good... and it worked!",
            "Dobby is a free elf! And this task is free of errors!",
            "10 points to your house for completing this task!",
            "The wand chooses the wizard, and this code chose to work!",
            "Nitwit! Blubber! Oddment! Tweak! Task complete!"
        };

        // WARNING quotes - Alice in Wonderland (curiosity, strangeness)
        mQuotePools[static_cast<int>(MessageType::WARNING)] = {
            "Curiouser and curiouser!",
            "I think of six impossible things before breakfast... this warning is one of them.",
            "We are all mad here. But this warning deserves attention.",
            "If you do not know where you are going, any road will get you there... but check this warning first.",
            "Begin at the beginning and go on till you come to the end; then stop. But first, read this warning.",
            "Who in the world am I? Ah, that is the great puzzle. And so is this warning.",
            "It would be so nice if something made sense for a change... like this warning.",
            "Why, sometimes I have believed as many as six impossible bugs before breakfast.",
            "Off with their heads! ...Just kidding, but seriously check this warning.",
            "The rabbit hole goes deeper. Investigate this warning."
        };

        // ERROR quotes - Holes (persistence through hardship)
        mQuotePools[static_cast<int>(MessageType::ERROR_MSG)] = {
            "You will have to fill in the holes yourself. Something went wrong.",
            "If only, if only, the woodpecker sighs... if only this function had not failed.",
            "I can fix it. I am pretty good at fixing things. Let us debug this.",
            "You take a bad boy, make him dig holes all day in the hot sun, it makes him a good boy. Debug time.",
            "The lizards will not bite you... but this error might. Check the logs.",
            "There is no lake at Camp Green Lake, and there is no success in this function call.",
            "Dig deeper. The error is buried in the stack trace.",
            "Stanley Yelnats would not give up, and neither should we. Retry initiated.",
            "The curse is real, but so is the fix. Check your parameters.",
            "Zero found water. You can find this bug. Keep digging."
        };

        // DEBUG quotes - Naruto (determination, never give up)
        mQuotePools[static_cast<int>(MessageType::DEBUG)] = {
            "Believe it! Debugging in progress!",
            "I am not gonna run away, I never go back on my word! Checking the pipeline...",
            "A smile is the easiest way out of a difficult situation. But first, check these values.",
            "When people are protecting something truly special to them, they truly can become as strong as they can be. Protecting the codebase now.",
            "If you do not like your destiny, do not accept it. Fix the bug instead!",
            "The next generation will always surpass the previous one. Refactoring...",
            "Hard work is worthless for those that do not believe in themselves. This debug log believes in you.",
            "I will become Hokage! But first, let me trace this variable.",
            "Those who break the rules are trash, but those who abandon their comrades are worse than trash. Check your dependencies.",
            "Dattebayo! Debug checkpoint reached!"
        };

        // INFO quotes - Maya Angelou (wisdom, encouragement)
        mQuotePools[static_cast<int>(MessageType::INFO)] = {
            "There is no greater agony than bearing an untold story inside you. Here is your info.",
            "We delight in the beauty of the butterfly, but rarely admit the changes it has gone through. System update.",
            "If you are always trying to be normal, you will never know how amazing you can be. Engine status report.",
            "I have learned that people will forget what you said, people will forget what you did, but people will never forget how you made them feel. Logging info.",
            "Nothing will work unless you do. Pipeline active.",
            "Life is not measured by the number of breaths we take, but by the moments that take our breath away. Checkpoint reached.",
            "You may not control all the events that happen to you, but you can decide not to be reduced by them. System nominal.",
            "Try to be a rainbow in someone else's cloud. Info logged.",
            "Do the best you can until you know better. Then when you know better, do better. Updating state.",
            "Courage is the most important of all the virtues. Proceeding with operation."
        };

        // SECURITY quotes - Black Clover (willpower, anti-magic determination)
        mQuotePools[static_cast<int>(MessageType::SECURITY)] = {
            "I will not give up! I will become the Wizard King! Integrity check passed!",
            "Surpassing your limits right here, right now! Security validated!",
            "Not giving up is my magic! Memory integrity confirmed!",
            "I will never stop moving forward! Subsystem hash verified!",
            "The magic is in never giving up! Security checkpoint clear!",
            "Even without magic, I will become the Wizard King! Anti-tamper check passed!",
            "My grimoire is my promise! Code integrity sealed!",
            "Black bulls never back down! Security scan complete!",
            "Limits are meant to be surpassed! Validation successful!",
            "I will protect everyone! Memory guard active!"
        };
    }

    // -----------------------------------------------------------------
    // GetTimestamp - Returns current time as a formatted string
    //   Format: [YYYY-MM-DD HH:MM:SS.mmm]
    //   RETURNS: String with bracketed timestamp
    // -----------------------------------------------------------------
    std::string GetTimestamp() const {
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()) % 1000;

        std::stringstream ss;
        std::tm tm_buf;
#ifdef _WIN32
        localtime_s(&tm_buf, &time);
#else
        localtime_r(&time, &tm_buf);
#endif
        ss << "[" << std::put_time(&tm_buf, "%Y-%m-%d %H:%M:%S")
           << "." << std::setfill('0') << std::setw(3) << ms.count() << "]";
        return ss.str();
    }

    // -----------------------------------------------------------------
    // GetRandomQuote - Picks a random quote from the pool matching
    //                  the given MessageType.
    //   PARAM type: Which quote pool to draw from
    //   RETURNS:    A random quote string, or fallback if pool is empty
    // -----------------------------------------------------------------
    std::string GetRandomQuote(MessageType type) {
        auto it = mQuotePools.find(static_cast<int>(type));
        if (it == mQuotePools.end() || it->second.empty()) {
            return "No quote available. The story continues...";
        }
        std::uniform_int_distribution<size_t> dist(0, it->second.size() - 1);
        return it->second[dist(mRng)];
    }

    // -----------------------------------------------------------------
    // GetPrefix - Returns the colored tag prefix for a message type
    //   PARAM type: The message type
    //   RETURNS:    String like "[SUCCESS]" with optional ANSI color
    // -----------------------------------------------------------------
    std::string GetPrefix(MessageType type) const {
        const char* color = QuoteConfig::COLOR_RESET;
        const char* label = "UNKNOWN";

        switch (type) {
            case MessageType::SUCCESS:
                color = QuoteConfig::COLOR_GREEN;
                label = "SUCCESS";
                break;
            case MessageType::WARNING:
                color = QuoteConfig::COLOR_YELLOW;
                label = "WARNING";
                break;
            case MessageType::ERROR_MSG:
                color = QuoteConfig::COLOR_RED;
                label = "ERROR";
                break;
            case MessageType::DEBUG:
                color = QuoteConfig::COLOR_CYAN;
                label = "DEBUG";
                break;
            case MessageType::INFO:
                color = QuoteConfig::COLOR_BLUE;
                label = "INFO";
                break;
            case MessageType::SECURITY:
                color = QuoteConfig::COLOR_MAGENTA;
                label = "SECURITY";
                break;
        }

        std::stringstream ss;
        if (QuoteConfig::USE_ANSI_COLORS) {
            ss << color << "[" << label << "]" << QuoteConfig::COLOR_RESET;
        } else {
            ss << "[" << label << "]";
        }
        return ss.str();
    }

    // -----------------------------------------------------------------
    // HashString - Simple FNV-1a hash for integrity checking
    //   PARAM str: The string to hash
    //   RETURNS:   size_t hash value
    //   WHY FNV:   Fast, good distribution, no crypto overhead needed.
    //              We are detecting accidental corruption, not attacks.
    // -----------------------------------------------------------------
    size_t HashString(const std::string& str) const {
        size_t hash = 14695981039346656037ULL;  // FNV offset basis
        for (char c : str) {
            hash ^= static_cast<size_t>(c);
            hash *= 1099511628211ULL;           // FNV prime
        }
        return hash;
    }

public:
    // -----------------------------------------------------------------
    // Constructor - Seeds RNG, initializes quote pools and ring buffer
    // -----------------------------------------------------------------
    QuoteSystem()
        : mLogIndex(0)
    {
        // Seed with high-resolution clock for unique sequences each run
        auto seed = static_cast<unsigned int>(
            std::chrono::high_resolution_clock::now().time_since_epoch().count());
        mRng.seed(seed);

        mLogHistory.resize(QuoteConfig::MAX_LOG_HISTORY);
        InitializeQuotePools();

        // Open log file if file logging is enabled
        if (QuoteConfig::FILE_LOGGING_ENABLED) {
            mLogFile.open(QuoteConfig::DEFAULT_LOG_FILE, std::ios::app);
        }
    }

    // -----------------------------------------------------------------
    // Destructor - Flushes and closes log file
    // -----------------------------------------------------------------
    ~QuoteSystem() {
        if (mLogFile.is_open()) {
            mLogFile.flush();
            mLogFile.close();
        }
    }

    // Prevent copying (file handle + mutex are not copyable)
    QuoteSystem(const QuoteSystem&) = delete;
    QuoteSystem& operator=(const QuoteSystem&) = delete;

    // -----------------------------------------------------------------
    // Log - Main logging method. Prints message with timestamp, prefix,
    //        a random thematic quote, and stores it in the ring buffer.
    //
    //   PARAM message: The actual information to log
    //   PARAM type:    Determines color, prefix, and quote pool
    //
    //   EXAMPLE:
    //     qs.Log("Vertex buffer created", QuoteSystem::MessageType::SUCCESS);
    //     // Output:
    //     // [2026-04-14 10:30:15.042] [SUCCESS] Vertex buffer created
    //     //   >> "Mischief Managed!"
    // -----------------------------------------------------------------
    void Log(const std::string& message, MessageType type) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Skip DEBUG messages when not in verbose mode
        if (type == MessageType::DEBUG && !QuoteConfig::VERBOSE_MODE) {
            return;
        }

        std::string timestamp = GetTimestamp();
        std::string prefix = GetPrefix(type);
        std::string quote = GetRandomQuote(type);

        // Console output
        std::cout << timestamp << " " << prefix << " " << message << std::endl;
        std::cout << "   >> \"" << quote << "\"" << std::endl;

        // File output (no ANSI colors in file)
        if (mLogFile.is_open()) {
            // Strip ANSI from prefix for file logging
            std::string cleanPrefix;
            switch (type) {
                case MessageType::SUCCESS:  cleanPrefix = "[SUCCESS]"; break;
                case MessageType::WARNING:  cleanPrefix = "[WARNING]"; break;
                case MessageType::ERROR_MSG:cleanPrefix = "[ERROR]"; break;
                case MessageType::DEBUG:    cleanPrefix = "[DEBUG]"; break;
                case MessageType::INFO:     cleanPrefix = "[INFO]"; break;
                case MessageType::SECURITY: cleanPrefix = "[SECURITY]"; break;
            }
            mLogFile << timestamp << " " << cleanPrefix << " " << message
                     << " >> \"" << quote << "\"" << std::endl;
        }

        // Store in ring buffer
        int idx = mLogIndex % QuoteConfig::MAX_LOG_HISTORY;
        mLogHistory[idx] = { timestamp, message, quote, type };
        mLogIndex++;
    }

    // -----------------------------------------------------------------
    // RegisterIntegrity - Registers a subsystem with a security quote.
    //   Store the hash of the quote. Later call ValidateIntegrity()
    //   to verify nothing changed unexpectedly.
    //
    //   PARAM subsystemName:  Unique name like "RenderPipeline"
    //   PARAM securityPhrase: A secret phrase that should never change
    //
    //   HOW IT WORKS:
    //     Think of it like the Marauder's Map password. If someone
    //     changes the phrase, the map will not open. Similarly, if
    //     memory corruption alters your phrase, validation fails.
    //
    //   SQL ANALOGY:
    //     This is conceptually similar to a database CHECK constraint.
    //     In SQL you might write:
    //       ALTER TABLE subsystems ADD CONSTRAINT chk_hash
    //       CHECK (hash_value = HASHBYTES('SHA2_256', security_phrase));
    //     We are doing the same thing in-memory with FNV-1a.
    //
    //   ASSEMBLY NOTE:
    //     For ultra-performance-critical integrity checks (like per-frame
    //     validation), you could replace HashString with an SSE4.2 CRC32
    //     intrinsic: _mm_crc32_u8(). This reduces the hash to a single
    //     CPU instruction per byte. Only worth it if you call
    //     ValidateIntegrity() inside a hot loop.
    // -----------------------------------------------------------------
    void RegisterIntegrity(const std::string& subsystemName,
                           const std::string& securityPhrase) {
        std::lock_guard<std::mutex> lock(mMutex);
        mIntegrityHashes[subsystemName] = HashString(securityPhrase);
        Log("Registered integrity check for: " + subsystemName,
            MessageType::SECURITY);
    }

    // -----------------------------------------------------------------
    // ValidateIntegrity - Re-hashes the phrase and compares to stored hash
    //   PARAM subsystemName:  Which subsystem to check
    //   PARAM securityPhrase: The phrase that was originally registered
    //   RETURNS: true if hash matches, false if tampered or not found
    // -----------------------------------------------------------------
    bool ValidateIntegrity(const std::string& subsystemName,
                           const std::string& securityPhrase) {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mIntegrityHashes.find(subsystemName);
        if (it == mIntegrityHashes.end()) {
            std::cout << GetPrefix(MessageType::ERROR_MSG)
                      << " Integrity check failed: subsystem '"
                      << subsystemName << "' not registered!" << std::endl;
            return false;
        }
        size_t currentHash = HashString(securityPhrase);
        bool valid = (currentHash == it->second);
        if (valid) {
            Log("Integrity PASSED for: " + subsystemName,
                MessageType::SECURITY);
        } else {
            Log("INTEGRITY VIOLATION for: " + subsystemName
                + " - possible memory corruption or tampering!",
                MessageType::ERROR_MSG);
        }
        return valid;
    }

    // -----------------------------------------------------------------
    // SetVerbose - Toggle debug message visibility at runtime
    //   PARAM enabled: true = show DEBUG messages, false = suppress them
    // -----------------------------------------------------------------
    void SetVerbose(bool enabled) {
        QuoteConfig::VERBOSE_MODE = enabled;
        Log(enabled ? "Verbose mode ON" : "Verbose mode OFF",
            MessageType::INFO);
    }

    // -----------------------------------------------------------------
    // SetFileLogging - Toggle persistent file logging at runtime
    //   PARAM enabled:  true = write to file, false = console only
    //   PARAM filePath: Optional custom log file path
    // -----------------------------------------------------------------
    void SetFileLogging(bool enabled,
                        const std::string& filePath = "") {
        std::lock_guard<std::mutex> lock(mMutex);
        QuoteConfig::FILE_LOGGING_ENABLED = enabled;
        if (enabled) {
            std::string path = filePath.empty()
                ? QuoteConfig::DEFAULT_LOG_FILE : filePath;
            if (!mLogFile.is_open()) {
                mLogFile.open(path, std::ios::app);
            }
        } else {
            if (mLogFile.is_open()) {
                mLogFile.flush();
                mLogFile.close();
            }
        }
    }

    // -----------------------------------------------------------------
    // PrintHistory - Dumps the ring buffer to console for review.
    //   PARAM count: How many recent entries to show (0 = all stored)
    //
    //   This is your "Debugging Window" - call it from a debug menu
    //   or key binding to see what happened without scrolling through
    //   the main console output.
    // -----------------------------------------------------------------
    void PrintHistory(int count = 0) const {
        std::lock_guard<std::mutex> lock(mMutex);
        int total = std::min(mLogIndex, QuoteConfig::MAX_LOG_HISTORY);
        int toShow = (count > 0 && count < total) ? count : total;

        std::cout << "\n========== BRIGHTFORGE LOG HISTORY ==========" << std::endl;
        std::cout << "Showing last " << toShow << " of " << total
                  << " entries" << std::endl;
        std::cout << "==============================================" << std::endl;

        int startIdx = (mLogIndex - toShow);
        if (startIdx < 0) startIdx = 0;

        for (int i = startIdx; i < mLogIndex && i < startIdx + toShow; i++) {
            int bufIdx = i % QuoteConfig::MAX_LOG_HISTORY;
            const LogEntry& entry = mLogHistory[bufIdx];
            if (entry.timestamp.empty()) continue;
            std::cout << entry.timestamp << " "
                      << GetPrefix(entry.type) << " "
                      << entry.message << std::endl;
            std::cout << "   >> \"" << entry.quote << "\"" << std::endl;
        }
        std::cout << "==============================================" << std::endl;
    }

    // -----------------------------------------------------------------
    // GetLogCount - Returns total number of log entries recorded
    // -----------------------------------------------------------------
    int GetLogCount() const {
        std::lock_guard<std::mutex> lock(mMutex);
        return mLogIndex;
    }

    // -----------------------------------------------------------------
    // AddCustomQuote - Lets users extend the quote pools at runtime
    //   PARAM type:  Which pool to add to
    //   PARAM quote: The new quote string
    // -----------------------------------------------------------------
    void AddCustomQuote(MessageType type, const std::string& quote) {
        std::lock_guard<std::mutex> lock(mMutex);
        mQuotePools[static_cast<int>(type)].push_back(quote);
    }
};

// ============================================================================
// TestManager for QuoteSystem - Validates all features in isolation
// ============================================================================
class QuoteSystemTestManager {
public:
    // -----------------------------------------------------------------
    // RunAllTests - Exercises every public method of QuoteSystem
    //   Call this early in your main() during development to verify
    //   the logging system is working before anything else starts.
    //
    //   RETURNS: true if all tests pass, false otherwise
    // -----------------------------------------------------------------
    static bool RunAllTests() {
        std::cout << "\n===== QUOTESYSTEM TEST SUITE =====" << std::endl;
        bool allPassed = true;

        allPassed &= TestBasicLogging();
        allPassed &= TestAllMessageTypes();
        allPassed &= TestIntegritySystem();
        allPassed &= TestVerboseToggle();
        allPassed &= TestHistory();
        allPassed &= TestCustomQuotes();

        std::cout << "\n===== TEST RESULTS: "
                  << (allPassed ? "ALL PASSED" : "SOME FAILED")
                  << " =====" << std::endl;
        return allPassed;
    }

private:
    static bool TestBasicLogging() {
        std::cout << "\n[TEST] Basic Logging..." << std::endl;
        QuoteSystem qs;
        qs.Log("Test message", QuoteSystem::MessageType::INFO);
        bool passed = (qs.GetLogCount() == 1);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - Log count check" << std::endl;
        return passed;
    }

    static bool TestAllMessageTypes() {
        std::cout << "\n[TEST] All Message Types..." << std::endl;
        QuoteSystem qs;
        qs.Log("Success test", QuoteSystem::MessageType::SUCCESS);
        qs.Log("Warning test", QuoteSystem::MessageType::WARNING);
        qs.Log("Error test", QuoteSystem::MessageType::ERROR_MSG);
        qs.Log("Debug test", QuoteSystem::MessageType::DEBUG);
        qs.Log("Info test", QuoteSystem::MessageType::INFO);
        qs.Log("Security test", QuoteSystem::MessageType::SECURITY);
        bool passed = (qs.GetLogCount() == 6);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - All 6 types logged" << std::endl;
        return passed;
    }

    static bool TestIntegritySystem() {
        std::cout << "\n[TEST] Integrity System..." << std::endl;
        QuoteSystem qs;
        // The registration itself logs, so count starts at 1
        qs.RegisterIntegrity("TestSubsystem", "I solemnly swear I am up to no good");

        bool valid = qs.ValidateIntegrity("TestSubsystem",
                                          "I solemnly swear I am up to no good");
        bool invalid = !qs.ValidateIntegrity("TestSubsystem",
                                             "tampered phrase");
        bool notFound = !qs.ValidateIntegrity("NonExistent", "anything");

        std::cout << (valid ? "  PASS" : "  FAIL")
                  << " - Valid phrase accepted" << std::endl;
        std::cout << (invalid ? "  PASS" : "  FAIL")
                  << " - Tampered phrase rejected" << std::endl;
        std::cout << (notFound ? "  PASS" : "  FAIL")
                  << " - Unregistered subsystem rejected" << std::endl;
        return valid && invalid && notFound;
    }

    static bool TestVerboseToggle() {
        std::cout << "\n[TEST] Verbose Toggle..." << std::endl;
        QuoteSystem qs;
        int before = qs.GetLogCount();
        qs.SetVerbose(false);
        qs.Log("Should be suppressed", QuoteSystem::MessageType::DEBUG);
        // SetVerbose itself logs an INFO, so count goes up by 1
        // but the DEBUG should be suppressed
        int afterSuppress = qs.GetLogCount();
        qs.SetVerbose(true);
        qs.Log("Should appear", QuoteSystem::MessageType::DEBUG);
        int afterRestore = qs.GetLogCount();

        // before=0, after SetVerbose(false) INFO log = 1,
        // suppressed DEBUG = still 1, SetVerbose(true) INFO = 2,
        // DEBUG now logged = 3
        bool passed = (afterSuppress == before + 1)
                   && (afterRestore == before + 3);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - Verbose toggle works" << std::endl;
        return passed;
    }

    static bool TestHistory() {
        std::cout << "\n[TEST] History Ring Buffer..." << std::endl;
        QuoteSystem qs;
        for (int i = 0; i < 10; i++) {
            qs.Log("Entry " + std::to_string(i), QuoteSystem::MessageType::INFO);
        }
        bool passed = (qs.GetLogCount() == 10);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - 10 entries recorded" << std::endl;
        // Visual check
        qs.PrintHistory(3);
        return passed;
    }

    static bool TestCustomQuotes() {
        std::cout << "\n[TEST] Custom Quote Addition..." << std::endl;
        QuoteSystem qs;
        qs.AddCustomQuote(QuoteSystem::MessageType::SUCCESS,
                          "Custom submarine veteran quote: All ahead full!");
        // Log a few times to see if custom quote appears
        for (int i = 0; i < 5; i++) {
            qs.Log("Custom quote test " + std::to_string(i),
                   QuoteSystem::MessageType::SUCCESS);
        }
        bool passed = (qs.GetLogCount() == 5);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - Custom quotes integrated" << std::endl;
        return passed;
    }
};
```

---

# SOURCE: DebugWindow.h (PRODUCTION READY - COPY TO PROJECT)

```cpp
// ============================================================================
// DebugWindow.h - BrightForge Engine Pipeline Debug Monitor
// ============================================================================
// PURPOSE:  Provides a structured, categorized debug output system that
//           keeps the console organized so any developer can quickly scan
//           the pipeline state, find missing files, and trace failures.
//
// DESIGN:   Messages are grouped into "channels" (Renderer, FileSystem,
//           UI, etc). Each channel can be toggled independently. Output
//           uses visual separators and indentation for easy scanning.
//
// USAGE:    DebugWindow& dbg = DebugWindow::Instance();
//           dbg.RegisterChannel("Renderer");
//           dbg.Post("Renderer", "Pipeline initialized", DebugLevel::INFO);
//           dbg.PrintDashboard();
//
// NOTES:    - Singleton pattern so every subsystem shares one instance
//           - Channels auto-create on first Post if not registered
//           - File attachment checker built in (see CheckFileExists)
//           - All constants at top for easy customization
// ============================================================================
#pragma once

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <sstream>
#include <fstream>
#include <chrono>
#include <iomanip>
#include <algorithm>

// ============================================================================
// CONFIGURABLE CONSTANTS
// ============================================================================
namespace DebugConfig {
    // Maximum messages per channel before oldest are discarded
    static constexpr int MAX_MESSAGES_PER_CHANNEL = 100;

    // Dashboard refresh separator width
    static constexpr int SEPARATOR_WIDTH = 60;

    // Default channels to register automatically
    static const char* DEFAULT_CHANNELS[] = {
        "Engine",
        "Renderer",
        "FileSystem",
        "Shaders",
        "UI",
        "Input",
        "Audio",
        "Physics",
        "Network"
    };
    static constexpr int NUM_DEFAULT_CHANNELS = 9;

    // ANSI colors for debug levels (disable if terminal does not support)
    static bool USE_COLORS = true;
}

// ============================================================================
// DebugLevel - Severity tiers for channel messages
// ============================================================================
enum class DebugLevel {
    TRACE,      // Ultra-verbose, usually off
    INFO,       // General operational info
    WARN,       // Something unexpected but recoverable
    ERR,        // Something failed
    CRITICAL    // System cannot continue
};

// ============================================================================
// DebugMessage - A single message in a channel's history
// ============================================================================
struct DebugMessage {
    std::string timestamp;
    std::string content;
    DebugLevel level;
};

// ============================================================================
// DebugChannel - A named group of messages with toggle state
// ============================================================================
struct DebugChannel {
    std::string name;
    bool enabled;
    std::vector<DebugMessage> messages;
    int totalPosted;     // Lifetime count (even after ring buffer wraps)
    int errorCount;      // Lifetime error + critical count
    int warningCount;    // Lifetime warning count

    DebugChannel()
        : enabled(true), totalPosted(0), errorCount(0), warningCount(0) {}
};

// ============================================================================
// DebugWindow Class (Singleton)
// ============================================================================
class DebugWindow {
private:
    std::unordered_map<std::string, DebugChannel> mChannels;
    mutable std::mutex mMutex;

    // Private constructor for singleton
    DebugWindow() {
        // Auto-register default channels
        for (int i = 0; i < DebugConfig::NUM_DEFAULT_CHANNELS; i++) {
            RegisterChannel(DebugConfig::DEFAULT_CHANNELS[i]);
        }
    }

    // -----------------------------------------------------------------
    // GetTimestamp - Formatted current time
    // -----------------------------------------------------------------
    std::string GetTimestamp() const {
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()) % 1000;
        std::stringstream ss;
        std::tm tm_buf;
#ifdef _WIN32
        localtime_s(&tm_buf, &time);
#else
        localtime_r(&time, &tm_buf);
#endif
        ss << std::put_time(&tm_buf, "%H:%M:%S")
           << "." << std::setfill('0') << std::setw(3) << ms.count();
        return ss.str();
    }

    // -----------------------------------------------------------------
    // LevelToString - Converts DebugLevel to display string
    // -----------------------------------------------------------------
    std::string LevelToString(DebugLevel level) const {
        switch (level) {
            case DebugLevel::TRACE:    return "TRACE";
            case DebugLevel::INFO:     return "INFO ";
            case DebugLevel::WARN:     return "WARN ";
            case DebugLevel::ERR:      return "ERROR";
            case DebugLevel::CRITICAL: return "CRIT ";
            default:                   return "?????";
        }
    }

    // -----------------------------------------------------------------
    // LevelColor - ANSI color for a debug level
    // -----------------------------------------------------------------
    std::string LevelColor(DebugLevel level) const {
        if (!DebugConfig::USE_COLORS) return "";
        switch (level) {
            case DebugLevel::TRACE:    return "\033[90m";   // gray
            case DebugLevel::INFO:     return "\033[37m";   // white
            case DebugLevel::WARN:     return "\033[33m";   // yellow
            case DebugLevel::ERR:      return "\033[31m";   // red
            case DebugLevel::CRITICAL: return "\033[31;1m"; // bold red
            default:                   return "";
        }
    }

    std::string ColorReset() const {
        return DebugConfig::USE_COLORS ? "\033[0m" : "";
    }

    // -----------------------------------------------------------------
    // PrintSeparator - Draws a visual line in the console
    // -----------------------------------------------------------------
    void PrintSeparator(char ch = '=') const {
        std::cout << std::string(DebugConfig::SEPARATOR_WIDTH, ch) << std::endl;
    }

public:
    // -----------------------------------------------------------------
    // Instance - Singleton accessor
    //   RETURNS: Reference to the single DebugWindow instance
    //   WHY SINGLETON: Every subsystem (Renderer, FileSystem, UI)
    //     needs to post to the same debug window. Passing a reference
    //     everywhere would add coupling. Singleton keeps it simple.
    //     NOTE: In a multi-DLL engine you would use a service locator
    //     pattern instead to avoid static init order issues.
    // -----------------------------------------------------------------
    static DebugWindow& Instance() {
        static DebugWindow instance;
        return instance;
    }

    // Delete copy/move for singleton
    DebugWindow(const DebugWindow&) = delete;
    DebugWindow& operator=(const DebugWindow&) = delete;

    // -----------------------------------------------------------------
    // RegisterChannel - Creates a named channel for categorized output
    //   PARAM name: Channel identifier like "Renderer" or "FileSystem"
    //   NOTE: Safe to call multiple times; will not overwrite existing
    // -----------------------------------------------------------------
    void RegisterChannel(const std::string& name) {
        std::lock_guard<std::mutex> lock(mMutex);
        if (mChannels.find(name) == mChannels.end()) {
            DebugChannel ch;
            ch.name = name;
            mChannels[name] = ch;
        }
    }

    // -----------------------------------------------------------------
    // Post - Send a message to a specific channel
    //   PARAM channel: Target channel name (auto-creates if not found)
    //   PARAM message: The debug content
    //   PARAM level:   Severity (default INFO)
    //
    //   GUARD CLAUSE: If channel is disabled, message is counted but
    //                 not stored or printed. This lets you track totals
    //                 even when output is suppressed.
    // -----------------------------------------------------------------
    void Post(const std::string& channel, const std::string& message,
              DebugLevel level = DebugLevel::INFO) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Auto-create channel if it does not exist
        if (mChannels.find(channel) == mChannels.end()) {
            DebugChannel ch;
            ch.name = channel;
            mChannels[channel] = ch;
        }

        DebugChannel& ch = mChannels[channel];
        ch.totalPosted++;

        if (level == DebugLevel::ERR || level == DebugLevel::CRITICAL) {
            ch.errorCount++;
        }
        if (level == DebugLevel::WARN) {
            ch.warningCount++;
        }

        // Guard: skip storage and print if channel is disabled
        if (!ch.enabled) return;

        // Build the message entry
        DebugMessage msg;
        msg.timestamp = GetTimestamp();
        msg.content = message;
        msg.level = level;

        // Ring buffer eviction
        if (static_cast<int>(ch.messages.size()) >= DebugConfig::MAX_MESSAGES_PER_CHANNEL) {
            ch.messages.erase(ch.messages.begin());
        }
        ch.messages.push_back(msg);

        // Print to console with formatting
        std::cout << LevelColor(level)
                  << "[" << msg.timestamp << "] "
                  << "[" << channel << "] "
                  << "[" << LevelToString(level) << "] "
                  << message
                  << ColorReset() << std::endl;
    }

    // -----------------------------------------------------------------
    // ToggleChannel - Enable or disable a channel's output
    //   PARAM channel: Which channel to toggle
    //   PARAM enabled: true = show messages, false = suppress
    // -----------------------------------------------------------------
    void ToggleChannel(const std::string& channel, bool enabled) {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mChannels.find(channel);
        if (it != mChannels.end()) {
            it->second.enabled = enabled;
        }
    }

    // -----------------------------------------------------------------
    // CheckFileExists - Verifies a file is present on disk and posts
    //                   a debug message with the result.
    //   PARAM channel:  Which channel to report to
    //   PARAM filePath: Path to check
    //   RETURNS: true if file exists, false otherwise
    //
    //   WHY THIS EXISTS: The most common engine bug is forgetting to
    //     include an asset file or misspelling a path. This method
    //     gives you an immediate, visible check at init time.
    //
    //   USAGE:
    //     dbg.CheckFileExists("Shaders", "../VertexShader.hlsl");
    //     dbg.CheckFileExists("Shaders", "../FragmentShader_PBR.hlsl");
    // -----------------------------------------------------------------
    bool CheckFileExists(const std::string& channel,
                         const std::string& filePath) {
        std::ifstream f(filePath);
        bool exists = f.good();
        f.close();

        if (exists) {
            Post(channel, "File OK: " + filePath, DebugLevel::INFO);
        } else {
            Post(channel, "FILE MISSING: " + filePath
                 + " -- Check your project include paths!",
                 DebugLevel::ERR);
        }
        return exists;
    }

    // -----------------------------------------------------------------
    // PrintDashboard - Renders a summary view of all channels
    //   Shows: channel name, enabled status, message counts, last msg
    //   This is the "at a glance" view for when you just want to know
    //   if anything is on fire.
    // -----------------------------------------------------------------
    void PrintDashboard() const {
        std::lock_guard<std::mutex> lock(mMutex);

        std::cout << std::endl;
        PrintSeparator('=');
        std::cout << "   BRIGHTFORGE DEBUG DASHBOARD" << std::endl;
        PrintSeparator('=');

        for (const auto& pair : mChannels) {
            const DebugChannel& ch = pair.second;
            std::string status = ch.enabled ? " ON" : "OFF";

            std::cout << " [" << status << "] " << ch.name
                      << " | Total: " << ch.totalPosted
                      << " | Errors: " << ch.errorCount
                      << " | Warnings: " << ch.warningCount
                      << std::endl;

            if (!ch.messages.empty()) {
                const DebugMessage& last = ch.messages.back();
                std::cout << "       Last: [" << last.timestamp << "] "
                          << last.content << std::endl;
            }
            PrintSeparator('-');
        }
        PrintSeparator('=');
    }

    // -----------------------------------------------------------------
    // PrintChannelHistory - Dumps all stored messages for one channel
    //   PARAM channel: Which channel to dump
    //   PARAM count:   Max entries to show (0 = all)
    // -----------------------------------------------------------------
    void PrintChannelHistory(const std::string& channel,
                             int count = 0) const {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mChannels.find(channel);
        if (it == mChannels.end()) {
            std::cout << "Channel '" << channel << "' not found." << std::endl;
            return;
        }

        const DebugChannel& ch = it->second;
        int total = static_cast<int>(ch.messages.size());
        int toShow = (count > 0 && count < total) ? count : total;
        int startIdx = total - toShow;

        std::cout << std::endl;
        PrintSeparator();
        std::cout << " Channel: " << channel << " (showing "
                  << toShow << " of " << total << ")" << std::endl;
        PrintSeparator();

        for (int i = startIdx; i < total; i++) {
            const DebugMessage& msg = ch.messages[i];
            std::cout << LevelColor(msg.level)
                      << "  [" << msg.timestamp << "] "
                      << "[" << LevelToString(msg.level) << "] "
                      << msg.content
                      << ColorReset() << std::endl;
        }
        PrintSeparator();
    }

    // -----------------------------------------------------------------
    // ClearChannel - Removes all stored messages from a channel
    // -----------------------------------------------------------------
    void ClearChannel(const std::string& channel) {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mChannels.find(channel);
        if (it != mChannels.end()) {
            it->second.messages.clear();
        }
    }

    // -----------------------------------------------------------------
    // GetErrorCount - Returns lifetime error count for a channel
    //   PARAM channel: Channel to query
    //   RETURNS: Error count, or -1 if channel not found
    // -----------------------------------------------------------------
    int GetErrorCount(const std::string& channel) const {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mChannels.find(channel);
        return (it != mChannels.end()) ? it->second.errorCount : -1;
    }
};
```

---

# SOURCE: TestManager.h (PRODUCTION READY - COPY TO PROJECT)

```cpp
// ============================================================================
// TestManager.h - BrightForge Engine Subsystem Test Runner
// ============================================================================
// PURPOSE:  Centralized test runner that validates every engine subsystem
//           independently. Run this before starting the main loop to catch
//           missing files, broken pipelines, and configuration errors early.
//
// USAGE:    TestManager tm;
//           tm.RunAll();  // Runs every registered test
//           tm.RunSuite("Renderer");  // Run one suite only
//
// DESIGN:   Tests are registered as lambdas so any subsystem can add
//           its own tests without modifying this file. Uses the
//           QuoteSystem for themed pass/fail output.
//
// NOTES:    - Each test returns bool (pass/fail)
//           - Failed tests do not abort; all tests run, then summary
//           - Toggle individual suites on/off for focused debugging
// ============================================================================
#pragma once

#include "QuoteSystem.h"
#include "DebugWindow.h"
#include <functional>
#include <string>
#include <vector>
#include <unordered_map>
#include <iostream>

// ============================================================================
// CONFIGURABLE CONSTANTS
// ============================================================================
namespace TestConfig {
    // If true, stops running tests in a suite after the first failure
    static bool STOP_ON_FIRST_FAILURE = false;

    // If true, prints detailed output for passing tests too
    static bool VERBOSE_PASS = true;
}

// ============================================================================
// TestCase - A single named test with a callable
// ============================================================================
struct TestCase {
    std::string name;
    std::function<bool()> testFunc;
};

// ============================================================================
// TestSuite - A named group of related tests
// ============================================================================
struct TestSuite {
    std::string name;
    bool enabled;
    std::vector<TestCase> tests;

    TestSuite() : enabled(true) {}
};

// ============================================================================
// TestManager Class
// ============================================================================
class TestManager {
private:
    std::unordered_map<std::string, TestSuite> mSuites;
    QuoteSystem mQuotes;  // Own instance for test output
    int mTotalRun;
    int mTotalPassed;
    int mTotalFailed;

public:
    TestManager() : mTotalRun(0), mTotalPassed(0), mTotalFailed(0) {}

    // -----------------------------------------------------------------
    // RegisterSuite - Creates a named test suite
    //   PARAM name: Suite identifier (e.g. "Renderer", "FileSystem")
    // -----------------------------------------------------------------
    void RegisterSuite(const std::string& name) {
        if (mSuites.find(name) == mSuites.end()) {
            TestSuite suite;
            suite.name = name;
            mSuites[name] = suite;
        }
    }

    // -----------------------------------------------------------------
    // AddTest - Adds a test case to a suite
    //   PARAM suiteName: Which suite to add to (auto-creates if needed)
    //   PARAM testName:  Human-readable test name
    //   PARAM testFunc:  Lambda that returns true on pass, false on fail
    //
    //   EXAMPLE:
    //     tm.AddTest("Renderer", "Pipeline Init", []() {
    //         return pipeline.IsValid();
    //     });
    // -----------------------------------------------------------------
    void AddTest(const std::string& suiteName,
                 const std::string& testName,
                 std::function<bool()> testFunc) {
        RegisterSuite(suiteName);
        TestCase tc;
        tc.name = testName;
        tc.testFunc = testFunc;
        mSuites[suiteName].tests.push_back(tc);
    }

    // -----------------------------------------------------------------
    // ToggleSuite - Enable or disable an entire test suite
    //   PARAM name:    Suite to toggle
    //   PARAM enabled: true = run during RunAll, false = skip
    // -----------------------------------------------------------------
    void ToggleSuite(const std::string& name, bool enabled) {
        auto it = mSuites.find(name);
        if (it != mSuites.end()) {
            it->second.enabled = enabled;
        }
    }

    // -----------------------------------------------------------------
    // RunSuite - Runs all tests in a single named suite
    //   PARAM name: Suite to run
    //   RETURNS: true if all tests in the suite passed
    // -----------------------------------------------------------------
    bool RunSuite(const std::string& name) {
        auto it = mSuites.find(name);
        if (it == mSuites.end()) {
            mQuotes.Log("Test suite '" + name + "' not found!",
                        QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        TestSuite& suite = it->second;
        if (!suite.enabled) {
            mQuotes.Log("Suite '" + name + "' is disabled, skipping",
                        QuoteSystem::MessageType::WARNING);
            return true;
        }

        std::cout << "\n";
        std::cout << std::string(50, '-') << std::endl;
        std::cout << " TEST SUITE: " << name << std::endl;
        std::cout << std::string(50, '-') << std::endl;

        int passed = 0;
        int failed = 0;

        for (auto& tc : suite.tests) {
            mTotalRun++;
            bool result = false;

            try {
                result = tc.testFunc();
            } catch (const std::exception& e) {
                mQuotes.Log("EXCEPTION in test '" + tc.name + "': " + e.what(),
                            QuoteSystem::MessageType::ERROR_MSG);
                result = false;
            } catch (...) {
                mQuotes.Log("UNKNOWN EXCEPTION in test '" + tc.name + "'",
                            QuoteSystem::MessageType::ERROR_MSG);
                result = false;
            }

            if (result) {
                passed++;
                mTotalPassed++;
                if (TestConfig::VERBOSE_PASS) {
                    mQuotes.Log("PASS: " + tc.name,
                                QuoteSystem::MessageType::SUCCESS);
                }
            } else {
                failed++;
                mTotalFailed++;
                mQuotes.Log("FAIL: " + tc.name,
                            QuoteSystem::MessageType::ERROR_MSG);

                if (TestConfig::STOP_ON_FIRST_FAILURE) {
                    mQuotes.Log("Stopping suite (STOP_ON_FIRST_FAILURE = true)",
                                QuoteSystem::MessageType::WARNING);
                    break;
                }
            }
        }

        std::cout << std::string(50, '-') << std::endl;
        std::cout << " " << name << " Results: "
                  << passed << " passed, " << failed << " failed"
                  << " out of " << suite.tests.size() << std::endl;
        std::cout << std::string(50, '-') << std::endl;

        return (failed == 0);
    }

    // -----------------------------------------------------------------
    // RunAll - Runs every enabled suite in registration order
    //   RETURNS: true if every test in every suite passed
    // -----------------------------------------------------------------
    bool RunAll() {
        mTotalRun = 0;
        mTotalPassed = 0;
        mTotalFailed = 0;

        mQuotes.Log("Starting full test run...",
                     QuoteSystem::MessageType::INFO);

        std::cout << "\n";
        std::cout << std::string(60, '=') << std::endl;
        std::cout << "   BRIGHTFORGE ENGINE - FULL TEST RUN" << std::endl;
        std::cout << std::string(60, '=') << std::endl;

        bool allPassed = true;
        for (auto& pair : mSuites) {
            bool suiteResult = RunSuite(pair.first);
            if (!suiteResult) allPassed = false;
        }

        // Final summary
        std::cout << "\n";
        std::cout << std::string(60, '=') << std::endl;
        std::cout << "   FINAL RESULTS" << std::endl;
        std::cout << "   Total:  " << mTotalRun << std::endl;
        std::cout << "   Passed: " << mTotalPassed << std::endl;
        std::cout << "   Failed: " << mTotalFailed << std::endl;
        std::cout << std::string(60, '=') << std::endl;

        if (allPassed) {
            mQuotes.Log("ALL TESTS PASSED! Engine is ready.",
                        QuoteSystem::MessageType::SUCCESS);
        } else {
            mQuotes.Log("SOME TESTS FAILED. Check output above for details.",
                        QuoteSystem::MessageType::ERROR_MSG);
        }

        return allPassed;
    }

    // -----------------------------------------------------------------
    // GetResults - Returns pass/fail counts for external reporting
    // -----------------------------------------------------------------
    void GetResults(int& total, int& passed, int& failed) const {
        total = mTotalRun;
        passed = mTotalPassed;
        failed = mTotalFailed;
    }

    // -----------------------------------------------------------------
    // RegisterDefaultEngineTests - Pre-built tests that check common
    //   engine setup problems. Call this to get instant file/config
    //   validation without writing any test lambdas.
    //
    //   PARAM shaderPaths: List of shader file paths to verify
    //   PARAM assetPaths:  List of asset file paths to verify
    // -----------------------------------------------------------------
    void RegisterDefaultEngineTests(
            const std::vector<std::string>& shaderPaths,
            const std::vector<std::string>& assetPaths) {

        // File existence tests for shaders
        for (const auto& path : shaderPaths) {
            AddTest("FileSystem", "Shader exists: " + path,
                [path]() {
                    std::ifstream f(path);
                    return f.good();
                });
        }

        // File existence tests for assets
        for (const auto& path : assetPaths) {
            AddTest("FileSystem", "Asset exists: " + path,
                [path]() {
                    std::ifstream f(path);
                    return f.good();
                });
        }

        // QuoteSystem self-test
        AddTest("Core", "QuoteSystem basic logging", []() {
            QuoteSystem qs;
            qs.Log("Test", QuoteSystem::MessageType::INFO);
            return qs.GetLogCount() == 1;
        });

        // QuoteSystem integrity test
        AddTest("Core", "QuoteSystem integrity system", []() {
            QuoteSystem qs;
            qs.RegisterIntegrity("test", "secret");
            return qs.ValidateIntegrity("test", "secret");
        });

        // DebugWindow channel test
        AddTest("Core", "DebugWindow channel registration", []() {
            DebugWindow& dbg = DebugWindow::Instance();
            dbg.RegisterChannel("TestChannel_Temp");
            dbg.Post("TestChannel_Temp", "Validation post", DebugLevel::INFO);
            return dbg.GetErrorCount("TestChannel_Temp") == 0;
        });
    }
};
```

---

# SOURCE: EventBus.h (PRODUCTION READY - COPY TO PROJECT)

```cpp
// ============================================================================
// EventBus.h - BrightForge Engine Decoupled Communication System
// ============================================================================
// PURPOSE:  Allows any engine subsystem to communicate with any other
//           subsystem without knowing it exists. Rendering does not include
//           UI headers. UI does not include rendering headers. They both
//           just post and listen for events through this bus.
//
// HOW IT WORKS:
//   Think of it like a radio station. Publishers broadcast on a named
//   frequency ("file.dropped"), and anyone tuned to that frequency
//   receives the message. The broadcaster does not know or care who
//   is listening.
//
//   This is the Observer pattern combined with a Mediator. In Gateware
//   terms, it is similar to how GEventResponder works with GWindow events,
//   but generalized to arbitrary string-named events with typed payloads.
//
// USAGE:
//   EventBus& bus = EventBus::Instance();
//   int subId = bus.Subscribe("file.loaded", [](const EventPayload& p) {
//       std::string path = std::get<std::string>(p.data);
//       // handle the loaded file
//   });
//   // Later, from a different subsystem:
//   bus.Publish("file.loaded", EventPayload::String("model.gltf"));
//
// SQL ANALOGY:
//   This is conceptually similar to database triggers.
//   In SQL:  CREATE TRIGGER on_file_loaded AFTER INSERT ON files ...
//   Here:    bus.Subscribe("file.loaded", callback);
//   Both fire callbacks in response to events without the event source
//   needing to know who is listening.
//
// ASSEMBLY NOTE:
//   The Subscribe/Publish methods use std::mutex which is heavyweight.
//   For ultra-hot event paths (like per-vertex events), you would want
//   a lock-free ring buffer using atomic compare-and-swap instructions:
//     lock cmpxchg [rdi], rsi   ; x86 atomic CAS
//   But for engine-level events (per-frame at most), mutex is fine.
//
// THREAD SAFETY: All public methods are mutex-protected.
// ============================================================================
#pragma once

#include <string>
#include <functional>
#include <unordered_map>
#include <vector>
#include <variant>
#include <mutex>
#include <atomic>
#include <iostream>

// ============================================================================
// CONFIGURABLE CONSTANTS
// ============================================================================
namespace EventBusConfig {
    // Maximum subscribers per event name (guard against leaks)
    static constexpr int MAX_SUBSCRIBERS_PER_EVENT = 50;

    // Enable event trace logging (posts every event to console)
    static bool TRACE_EVENTS = false;
}

// ============================================================================
// EventPayload - Variant-typed data attached to an event
// ============================================================================
struct EventPayload {
    // The data can be one of these types
    std::variant<std::monostate, std::string, int, float, double, void*> data;

    // Factory methods for clean construction
    static EventPayload None()                          { return { std::monostate{} }; }
    static EventPayload String(const std::string& s)    { return { s }; }
    static EventPayload Int(int i)                      { return { i }; }
    static EventPayload Float(float f)                  { return { f }; }
    static EventPayload Double(double d)                { return { d }; }
    static EventPayload Pointer(void* p)                { return { p }; }

    // Type-safe getters with fallback defaults
    // WHY DEFAULTS: If someone subscribes to "file.loaded" expecting a string
    // but gets an int payload (programming error), we return the default
    // instead of crashing. The mismatch will be visible in DebugWindow.
    std::string GetString(const std::string& fallback = "") const {
        if (auto* val = std::get_if<std::string>(&data)) return *val;
        return fallback;
    }
    int GetInt(int fallback = 0) const {
        if (auto* val = std::get_if<int>(&data)) return *val;
        return fallback;
    }
    float GetFloat(float fallback = 0.0f) const {
        if (auto* val = std::get_if<float>(&data)) return *val;
        return fallback;
    }
    double GetDouble(double fallback = 0.0) const {
        if (auto* val = std::get_if<double>(&data)) return *val;
        return fallback;
    }
    void* GetPointer(void* fallback = nullptr) const {
        if (auto* val = std::get_if<void*>(&data)) return *val;
        return fallback;
    }
};

// Callback type: receives the event name and payload
using EventCallback = std::function<void(const std::string& eventName,
                                          const EventPayload& payload)>;

// ============================================================================
// Subscription - Internal record of a subscriber
// ============================================================================
struct Subscription {
    int id;
    std::string eventName;    // The event this subscription listens to
    EventCallback callback;
    bool active;              // Can be deactivated without removal
};

// ============================================================================
// EventBus Class (Singleton)
// ============================================================================
class EventBus {
private:
    // Map from event name to list of subscriptions
    std::unordered_map<std::string, std::vector<Subscription>> mSubscriptions;

    // Wildcard subscribers (receive ALL events, used for debug tracing)
    std::vector<Subscription> mWildcardSubscriptions;

    // Auto-incrementing subscription ID
    std::atomic<int> mNextId;

    // Thread safety
    mutable std::mutex mMutex;

    // Private constructor for singleton
    EventBus() : mNextId(1) {}

public:
    // -----------------------------------------------------------------
    // Instance - Singleton accessor
    // -----------------------------------------------------------------
    static EventBus& Instance() {
        static EventBus instance;
        return instance;
    }

    // Delete copy/move
    EventBus(const EventBus&) = delete;
    EventBus& operator=(const EventBus&) = delete;

    // -----------------------------------------------------------------
    // Subscribe - Register a callback for a specific event name
    //   PARAM eventName: The event to listen for (e.g. "file.loaded")
    //                    Use "*" for wildcard (receives all events)
    //   PARAM callback:  Function to call when event fires
    //   RETURNS:         Subscription ID for later unsubscribe
    //
    //   GUARD: Rejects subscription if the event already has
    //          MAX_SUBSCRIBERS_PER_EVENT listeners (likely a leak).
    // -----------------------------------------------------------------
    int Subscribe(const std::string& eventName, EventCallback callback) {
        std::lock_guard<std::mutex> lock(mMutex);

        int id = mNextId.fetch_add(1);

        Subscription sub;
        sub.id = id;
        sub.eventName = eventName;
        sub.callback = callback;
        sub.active = true;

        if (eventName == "*") {
            mWildcardSubscriptions.push_back(sub);
        } else {
            auto& subs = mSubscriptions[eventName];

            // Guard clause: check for subscription leak
            if (static_cast<int>(subs.size()) >= EventBusConfig::MAX_SUBSCRIBERS_PER_EVENT) {
                std::cerr << "[EventBus] WARNING: Max subscribers reached for '"
                          << eventName << "'. Possible subscription leak!" << std::endl;
                return -1;  // Indicate failure
            }

            subs.push_back(sub);
        }

        return id;
    }

    // -----------------------------------------------------------------
    // Unsubscribe - Remove a subscription by its ID
    //   PARAM subscriptionId: The ID returned by Subscribe
    //   RETURNS: true if found and removed, false if not found
    // -----------------------------------------------------------------
    bool Unsubscribe(int subscriptionId) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Check wildcards first
        for (auto it = mWildcardSubscriptions.begin();
             it != mWildcardSubscriptions.end(); ++it) {
            if (it->id == subscriptionId) {
                mWildcardSubscriptions.erase(it);
                return true;
            }
        }

        // Check named subscriptions
        for (auto& pair : mSubscriptions) {
            auto& subs = pair.second;
            for (auto it = subs.begin(); it != subs.end(); ++it) {
                if (it->id == subscriptionId) {
                    subs.erase(it);
                    return true;
                }
            }
        }

        return false;
    }

    // -----------------------------------------------------------------
    // Publish - Fire an event to all matching subscribers
    //   PARAM eventName: Which event to fire
    //   PARAM payload:   Data to send with the event
    //
    //   Delivers to:
    //   1. All subscribers of this exact event name
    //   2. All wildcard ("*") subscribers
    //
    //   Exceptions in callbacks are caught and logged, not propagated.
    //   One bad subscriber must not break the event chain for others.
    // -----------------------------------------------------------------
    void Publish(const std::string& eventName,
                 const EventPayload& payload = EventPayload::None()) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Trace logging (for development debugging)
        if (EventBusConfig::TRACE_EVENTS) {
            std::cout << "[EventBus TRACE] " << eventName << std::endl;
        }

        // Deliver to named subscribers
        auto it = mSubscriptions.find(eventName);
        if (it != mSubscriptions.end()) {
            for (auto& sub : it->second) {
                if (!sub.active) continue;
                try {
                    sub.callback(eventName, payload);
                } catch (const std::exception& e) {
                    std::cerr << "[EventBus] Exception in subscriber "
                              << sub.id << " for '" << eventName
                              << "': " << e.what() << std::endl;
                } catch (...) {
                    std::cerr << "[EventBus] Unknown exception in subscriber "
                              << sub.id << " for '" << eventName << "'"
                              << std::endl;
                }
            }
        }

        // Deliver to wildcard subscribers
        for (auto& sub : mWildcardSubscriptions) {
            if (!sub.active) continue;
            try {
                sub.callback(eventName, payload);
            } catch (...) {
                // Swallow wildcard subscriber exceptions
            }
        }
    }

    // -----------------------------------------------------------------
    // SetSubscriptionActive - Temporarily enable/disable without removing
    //   PARAM subscriptionId: Which subscription
    //   PARAM active:         true = deliver events, false = skip
    // -----------------------------------------------------------------
    void SetSubscriptionActive(int subscriptionId, bool active) {
        std::lock_guard<std::mutex> lock(mMutex);

        for (auto& sub : mWildcardSubscriptions) {
            if (sub.id == subscriptionId) { sub.active = active; return; }
        }
        for (auto& pair : mSubscriptions) {
            for (auto& sub : pair.second) {
                if (sub.id == subscriptionId) { sub.active = active; return; }
            }
        }
    }

    // -----------------------------------------------------------------
    // GetSubscriberCount - Returns how many active subscribers exist
    //                      for a given event name.
    //   PARAM eventName: Event to query (use "*" for wildcard count)
    //   RETURNS: Number of active subscriptions
    // -----------------------------------------------------------------
    int GetSubscriberCount(const std::string& eventName) const {
        std::lock_guard<std::mutex> lock(mMutex);

        if (eventName == "*") {
            return static_cast<int>(mWildcardSubscriptions.size());
        }

        auto it = mSubscriptions.find(eventName);
        if (it == mSubscriptions.end()) return 0;

        int count = 0;
        for (const auto& sub : it->second) {
            if (sub.active) count++;
        }
        return count;
    }

    // -----------------------------------------------------------------
    // ClearAll - Remove every subscription. Use during shutdown.
    // -----------------------------------------------------------------
    void ClearAll() {
        std::lock_guard<std::mutex> lock(mMutex);
        mSubscriptions.clear();
        mWildcardSubscriptions.clear();
    }

    // -----------------------------------------------------------------
    // PrintStats - Dump subscription counts per event name
    // -----------------------------------------------------------------
    void PrintStats() const {
        std::lock_guard<std::mutex> lock(mMutex);

        std::cout << "\n===== EventBus Stats =====" << std::endl;
        std::cout << "Wildcard subscribers: "
                  << mWildcardSubscriptions.size() << std::endl;

        for (const auto& pair : mSubscriptions) {
            int activeCount = 0;
            for (const auto& sub : pair.second) {
                if (sub.active) activeCount++;
            }
            std::cout << "  [" << pair.first << "] "
                      << activeCount << " active / "
                      << pair.second.size() << " total" << std::endl;
        }
        std::cout << "==========================" << std::endl;
    }
};

// ============================================================================
// EventBus Test Suite - Validates all EventBus functionality
// ============================================================================
namespace EventBusTests {
    inline bool RunAll() {
        std::cout << "\n===== EventBus Test Suite =====" << std::endl;
        bool allPassed = true;

        // Test 1: Subscribe and publish
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            bool received = false;
            std::string receivedData;

            int subId = bus.Subscribe("test.event",
                [&](const std::string& name, const EventPayload& p) {
                    received = true;
                    receivedData = p.GetString();
                });

            bus.Publish("test.event", EventPayload::String("hello"));

            bool passed = received && (receivedData == "hello") && (subId > 0);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Subscribe and publish" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 2: Unsubscribe stops delivery
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            int callCount = 0;

            int subId = bus.Subscribe("test.unsub",
                [&](const std::string&, const EventPayload&) { callCount++; });

            bus.Publish("test.unsub");
            bus.Unsubscribe(subId);
            bus.Publish("test.unsub");

            bool passed = (callCount == 1);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Unsubscribe stops delivery" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 3: Multiple subscribers
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            int countA = 0, countB = 0;

            bus.Subscribe("test.multi",
                [&](const std::string&, const EventPayload&) { countA++; });
            bus.Subscribe("test.multi",
                [&](const std::string&, const EventPayload&) { countB++; });

            bus.Publish("test.multi");

            bool passed = (countA == 1 && countB == 1);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Multiple subscribers both receive" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 4: Wildcard receives all events
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            int wildcardCount = 0;

            bus.Subscribe("*",
                [&](const std::string&, const EventPayload&) { wildcardCount++; });

            bus.Publish("event.alpha");
            bus.Publish("event.beta");
            bus.Publish("event.gamma");

            bool passed = (wildcardCount == 3);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Wildcard receives all events" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 5: Payload type safety
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            std::string gotString;
            int gotInt = -1;

            bus.Subscribe("test.types",
                [&](const std::string&, const EventPayload& p) {
                    gotString = p.GetString("default");
                    gotInt = p.GetInt(-1);
                });

            bus.Publish("test.types", EventPayload::String("actual"));

            // Should get the string but fall back on int
            bool passed = (gotString == "actual") && (gotInt == -1);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Payload type safety with fallbacks" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 6: Exception in subscriber does not break others
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            bool secondCalled = false;

            bus.Subscribe("test.exception",
                [](const std::string&, const EventPayload&) {
                    throw std::runtime_error("intentional test exception");
                });
            bus.Subscribe("test.exception",
                [&](const std::string&, const EventPayload&) {
                    secondCalled = true;
                });

            bus.Publish("test.exception");

            bool passed = secondCalled;
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Exception does not break other subscribers" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        std::cout << "\n===== EventBus: "
                  << (allPassed ? "ALL PASSED" : "SOME FAILED")
                  << " =====" << std::endl;
        return allPassed;
    }
}
```

---

# CLAUDE CODE COMMAND REFERENCE

# BrightForge - Claude Code Command Reference

## How to Use These Commands

Each command tells Claude Code exactly what to do, which files to read,
which skills to follow, and what output to produce. Copy and paste them
into Claude Code as-is.

---

## Phase 1 Commands

### Start Phase 1
```
Read the following files to understand the current codebase:
- tasks/PHASE_1_ANALYSIS.md (task list)
- skills/rendering/SKILL.md (rendering conventions)
- docs/PROJECT_OVERVIEW.md (big picture)

Then analyze the source files in order:
1. renderer.h (Vulkan pipeline)
2. Renderer.h (software rasterizer)
3. Camera.h
4. Shaders.h and Shaders.cpp
5. GraphicsHelper.hpp
6. main.cpp

Produce analysis/structure_map.md with:
- Complete file inventory categorized by role
- Include dependency chain for each file
- Coupling issues flagged with severity (LOW/MED/HIGH)

Use QuoteSystem SUCCESS log format for completed analysis items.
Use QuoteSystem WARNING log format for coupling issues found.
```

### Run Analysis Audit
```
Read tasks/PHASE_1_ANALYSIS.md Tasks 1.4 and 1.5.

Search the entire codebase for:
1. Hardcoded numeric values (magic numbers)
2. Global mutable state (extern variables)
3. Functions longer than 50 lines
4. Duplicated logic across files
5. Direct coupling between UI and rendering code

Produce analysis/coupling_report.md and analysis/reuse_inventory.md.
Tag each finding as REUSABLE or HARDCODED.
For each HARDCODED finding, show the current code and the refactored version.
```

---

## Phase 2 Commands

### Execute Rendering Refactor
```
Read the following before starting:
- tasks/PHASE_2_BACKEND_REFACTOR.md (full task list)
- skills/rendering/SKILL.md (pipeline conventions)
- docs/RENDERING_PIPELINE_BLUEPRINT.md (target architecture)
- src/core/QuoteSystem.h (logging system to integrate)
- src/core/DebugWindow.h (debug system to integrate)

Then implement Tasks 2.1 through 2.3 in order:
1. VulkanContext.h - extract device management from renderer.h
2. ShaderCompiler.h - merge the three compile functions into one
3. DescriptorManager.h - extract descriptor code from renderer.h

For each new file:
- Include QuoteSystem logging for all operations
- Register a DebugWindow channel
- Add TestManager test cases at the bottom of the file
- Use named constants, never hardcoded values
- Show full function implementations (not stubs)
- Add retry mechanism for shader compilation (Task 2.2)

When merging CompileVertexShader + CompileFragmentShader:
Show the ORIGINAL two functions side by side with the MERGED version
so I can clearly see what changed.
```

### Execute FileSystem Design
```
Read tasks/PHASE_2_BACKEND_REFACTOR.md Tasks 2.7 through 2.9.
Read skills/quotesystem/SKILL.md for logging conventions.
Read skills/debugwindow/SKILL.md for debug channel conventions.

Implement:
1. FileService.h with format validation (check magic bytes not just extension)
2. FormatValidator.h supporting: OBJ, FBX, GLTF, GLB, PNG, JPG, TGA, HDR
3. AssetIndex.h with searchable catalog

For AssetIndex, include the SQLite schema from the task file.
Explain where SQL gives an advantage over in-memory std::map.

Add guard clauses at the top of every function.
Add QuoteSystem logging for every file load attempt.
Add DebugWindow.CheckFileExists calls for every path.
```

---

## Phase 3 Commands

### Generate UI Preview v1
```
Read tasks/PHASE_3_UI_DESIGN.md for full requirements.

Design the Standard layout (Task 3.1) with:
- Layout tree showing component hierarchy
- Design tokens JSON with all colors, spacing, and fonts
- Interaction map for the DragDropZone (Task 3.2)

Output component definitions showing:
- Props (configurable inputs)
- State (internal reactive data)
- Events (what each component emits)

All sizes must use design token variables, never pixel literals.
```

### Generate UI Preview v2
```
Read tasks/PHASE_3_UI_DESIGN.md Task 3.5.

Create three layout variations:
1. Minimal - viewport with floating tool palettes
2. Standard - fixed sidebars (default, from v1)
3. Professional - multi-viewport with dockable panels

For each layout provide:
- ASCII art wireframe showing panel arrangement
- Pros and cons
- Target user profile
- Implementation complexity estimate (hours)
```

---

## Phase 4 Commands

### Build Event Bus
```
Read tasks/PHASE_4_FRONTEND.md Task 4.1.
Read skills/quotesystem/SKILL.md and skills/debugwindow/SKILL.md.

Implement EventBus.h with:
- String-based event names
- Typed payloads (variant of string, int, float, void*)
- Thread-safe subscribe/unsubscribe/publish
- Wildcard subscription for debug logging
- Full QuoteSystem integration
- TestManager test cases

Show the complete event catalog table from the task file.
Explain how this compares to GW::CORE::GEventReceiver from Camera.h.
```

### Build DragDrop System
```
Read tasks/PHASE_4_FRONTEND.md Tasks 4.2 and 4.3.

Implement DragDropZone.h with:
- OS-level drag-and-drop event handling
- Format validation before loading
- Loading queue for multiple drops
- Visual state machine (idle, hovering, loading, success, error)
- Event bus integration (publishes "file.dropped")

Show guard clauses for: empty path, unsupported format, already loading.
Add retry mechanism for file loading failures.
All visual parameters use design tokens from Phase 3.
```

---

## Phase 5 Commands

### Run Integration Test
```
Read tasks/PHASE_5_INTEGRATION.md Tasks 5.1 through 5.3.

Wire all subsystems to EventBus:
1. Connect RenderService events
2. Connect FileService events
3. Connect UI component events

Then run the smoke test scenarios:
1. Cold Start Test
2. File Load Test
3. Camera Interaction Test
4. Config Change Test

For each test, show:
- Setup code
- Expected event flow (which events fire in which order)
- Validation assertions
- QuoteSystem log for pass/fail

Verify the coupling checklist from Task 4.5.
```

### Performance Audit
```
Read tasks/PHASE_5_INTEGRATION.md Task 5.4.
Read docs/RENDERING_PIPELINE_BLUEPRINT.md for optimization targets.

Analyze the current rendering hot path:
1. Identify per-frame allocations
2. Find redundant Vulkan state changes
3. Check for unnecessary descriptor rebinds
4. Measure matrix math overhead

For each bottleneck found:
- Show the current code
- Show the optimized version
- Estimate the speedup
- Note if assembly (SSE/AVX) would help and why
```

---

## Z-Depth Precision Fix Commands

### Fix Reversed-Z Depth Buffer
```
Read the following files in order:
- docs/Z_DEPTH_ANALYSIS.md (full problem analysis and explanation)
- tasks/Z_DEPTH_FIX.md (step-by-step task list)
- skills/rendering/SKILL.md (pipeline conventions)

Apply Tasks Z1 through Z4 as a coordinated set:
1. main.cpp: Change depth clear from 1.0f to 0.0f
2. renderer.h CreateVkPipelineDepthStencilStateCreateInfo():
   Change VK_COMPARE_OP_LESS to VK_COMPARE_OP_GREATER
   Swap minDepthBounds and maxDepthBounds
3. renderer.h CreateViewportFromWindowDimensions():
   Swap minDepth (0->1) and maxDepth (1->0)
4. renderer.h InitializeProjectionMatrix():
   Set nearPlane = 0.00001f, farPlane = 10000.0f

CRITICAL: All four changes must be applied together.
Show each function BEFORE and AFTER the change so I can clearly
see the difference.

Add QuoteSystem SUCCESS log after each change.
Add DebugWindow post to "Renderer" channel confirming reversed-Z.
Add TestManager test cases for each depth config value.

Then implement Task Z5: rotating light direction using elapsed time.
Show the full Render() function with the light rotation code inserted
in the correct location.
```

### Analyze Z-Depth Issue
```
Read docs/Z_DEPTH_ANALYSIS.md for the full problem breakdown.

Explain in plain English:
1. Why Z-fighting happens with standard depth buffering
2. Why floating-point precision is nonlinear (more bits near zero)
3. How reversed-Z exploits this to get better precision at distance
4. Why all four changes (clear, compare, viewport, projection) must
   be coordinated

Include the NVIDIA depth precision visualization link from Lab 7.
Show the depth distribution curve for standard-Z vs reversed-Z.
```

---

## Utility Commands

### Run All Tests
```
Include TestManager.h and QuoteSystem.h.
Register all default engine tests.
Run TestManager.RunAll().
Show the debug dashboard after tests complete.
```

### Check Pipeline Health
```
Include DebugWindow.h.
Call DebugWindow::Instance().PrintDashboard().
Show all channels with their error counts.
Highlight any channel with errors > 0.
```

### Toggle Debug Verbosity
```
quoteSystem.SetVerbose(true);   // Show all DEBUG messages
quoteSystem.SetVerbose(false);  // Suppress DEBUG, keep everything else
```

---

# FIRST ACTION AFTER READING THIS FILE

Claude Code: After reading this entire document, your first action is to:

1. Read the existing source files in the project directory:
   - main.cpp
   - renderer.h (Vulkan pipeline, lowercase r)
   - Renderer.h (software rasterizer, capital R)
   - Camera.h
   - Shaders.h and Shaders.cpp
   - GraphicsHelper.hpp
   - Constrants.h and Constrants.cpp

2. Report back with:
   - Summary of current project state
   - Top 3 coupling issues found
   - Confirmation you understand QuoteSystem conventions
   - Confirmation you understand the reversed-Z depth fix (4 coordinated changes)
   - Your recommendation for which task to start first
   - The exact include path change needed in main.cpp to use the new QuoteSystem.h

3. Do NOT make any changes until the developer confirms which task to begin.

---
END OF MASTER EXECUTION FILE
