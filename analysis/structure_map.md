# BrightForge Codebase Structure Map
**Developer:** Marcus Daley
**Date:** 2026-04-14
**Purpose:** Complete inventory of all source files with categorization, dependency analysis, and architectural role documentation

---

## Executive Summary

**Total Files Analyzed:** 15 source files
**Architecture Type:** Software rasterizer (CPU-based 3D rendering)
**Missing Components:** Vulkan pipeline, UI framework, all service abstractions mentioned in BRIGHTFORGE_MASTER.md
**Critical Issues:** 6 global mutable state variables, tight coupling between rendering and testing code

---

## File Categorization by Role

### Core Rendering Pipeline (5 files)
These files form the complete software rasterizer pipeline from vertex input to pixel output.

#### **Renderer.h**
- **Role:** Primary rendering coordinator and state manager
- **Size:** 232 lines
- **Key Responsibilities:**
  - Manages Camera pointer and projection matrix
  - Owns RenderState (wireframe, depth test, backface culling flags)
  - renderMesh() orchestrates vertex transformation and rasterization
  - updateCubeRotation() for animation
  - Directly writes to global shader state (vsWorld, vsView, vsProjection)
- **Dependencies:** Camera.h, GraphicsHelper.hpp, LineDrawing.h, Matrix.h, Shaders.h, Types.h
- **Coupling Issues:**
  - Direct manipulation of 6 global shader variables (lines 94, 117, 142, 145-147)
  - Hardcoded transformation logic
- **TestMode enum:** Defines ASPECT_RATIO_TEST, COLORED_TRIANGLES, DEPTH_BUFFER_TEST, TEXTURE_TEST (not actively used in renderMesh)

#### **Shaders.h / Shaders.cpp**
- **Role:** Global shader state + vertex/pixel shader function implementations
- **Size:** 42 lines (header), 163 lines (implementation)
- **Global State (ALL mutable):**
  ```cpp
  extern Matrix4x4 vsWorld;           // Line 12
  extern Matrix4x4 vsView;            // Line 13
  extern Matrix4x4 vsProjection;      // Line 14
  extern VertexShaderFunc VertexShader;   // Line 15 (function pointer)
  extern PixelShederFunc pixelShader;     // Line 16 (function pointer)
  extern bool isCube;                     // Line 17
  ```
- **Lighting Globals (9 variables):**
  - directionalLightDir, directionalLightColor
  - pointLightPos, pointLightColor, pointLightRadius
  - ambientIntensity
  - useDirectionalLight, usePointLight, useAmbientLight (bool flags)
- **Shader Functions:**
  - vsIdentity() — simple 0.5x scaling (unused in current pipeline)
  - vsWorldViewTransform() — world + view transformation, color handling
  - vsProjectionTransform() — projection + perspective divide
  - vsLighting() — ambient + directional + point light with attenuation
  - psSolid() — passthrough pixel shader
  - scaleColor() — color intensity scaling helper
- **Dependencies:** Types.h, Matrix.h, MathU.h, Constrants.h
- **Critical Flaw:** All state is global mutable — violates encapsulation, prevents multi-threading, makes testing impossible

#### **GraphicsHelper.hpp**
- **Role:** Framebuffer management (pixel + depth buffers) and low-level drawing primitives
- **Size:** 179 lines (header-only)
- **Key Features:**
  - Pixel buffer (unsigned int*, dynamically allocated in constructor)
  - Depth buffer (vector&lt;float&gt;, initialized to float::max)
  - drawPixel() — depth test with &lt;= comparison (line 96)
  - clearBuffer() — resets both color and depth
  - NDCToScreen() — normalized device coords → screen space
  - BGRAtoARGB() — texture format conversion
  - blit() — block image transfer with alpha blending
  - drawDebugStar() — star field rendering helper
- **Dependencies:** Constrants.h (for window dimensions)
- **Buffer Ownership:** Constructor allocates, destructor deletes (no copy/move allowed)
- **Hardcoded Values:** Window dimensions come from GraphicsConstrants::kWindowWidth/Height

#### **LineDrawing.h**
- **Role:** 2D/3D line and triangle rasterization
- **Size:** 293 lines
- **Key Methods:**
  - drawLine() — 2D Bresenham-style line drawing
  - draw3DLine() — applies VertexShader, NDC conversion, then drawLine
  - drawTriangle() — barycentric rasterization with depth interpolation
  - draw3DTriangle() — applies VertexShader, then drawTriangle
  - calculateBarycentricCoords() — triangle inside/outside test
- **Features:**
  - Perspective-correct texture mapping (lines 196-218)
  - Vertex color interpolation (lines 236-256)
  - Triangle bounding box clipping (lines 158-175)
- **Dependencies:** GraphicsHelper.hpp, Shaders.h (for VertexShader function pointer)
- **Coupling:** Directly calls global VertexShader function pointer (lines 75-79, 274-279)

#### **Camera.h**
- **Role:** Orbit camera with spherical coordinate system
- **Size:** 110 lines
- **Key Features:**
  - Orbit mode: updateCameraMatrix(rotationAngle) uses spherical coords
  - Free look: setPosition/setRotation + updateViewMatrix
  - OrthonormalInverse() for view matrix construction
  - Height/distance/viewAngle clamping using GraphicsConstrants limits
- **Dependencies:** Matrix.h, Constrants.h
- **State:** mViewMatrix, mPosition, mRotation, mHeight, mDistance, mViewAngle
- **Note:** Constructor calls updateViewMatrix() twice (line 24-25) — likely typo

---

### Math Infrastructure (3 files)

#### **Matrix.h**
- **Role:** 4x4 matrix with transformation builders
- **Size:** 100+ lines (read truncated at 100)
- **Key Features:**
  - Union layout (float V[16], named components xx-ww, AxisX-W)
  - operator* for matrix multiplication
  - transformVector() for vector transformation
  - Static builders: identity(), translation(), rotation{X,Y,Z}(), scale(), createTransform()
- **Dependencies:** Types.h
- **Note:** Comprehensive math foundation, appears production-ready

#### **MathU.h**
- **Role:** Vector and color math utilities
- **Size:** 118 lines
- **Namespace:** MathUtils
- **Key Functions:**
  - dotProduct(), crossProduct(), normalize()
  - combineColors() — additive color blending with clamping
  - modulateColors() — multiplicative color blending
  - Saturate() — clamp to [0,1]
  - vec3Length(), lerp()
  - exactColorComponent(), makeColor() — ARGB packing/unpacking
- **Dependencies:** Types.h
- **Quality:** Clean, well-documented, reusable

#### **Types.h**
- **Role:** Core data structures (Vector4, Vertex, TransformData)
- **Size:** 90 lines
- **Structures:**
  - Vector4: union layout (float V[4] or x,y,z,w), operator overloads (+, -, * scalar)
  - Vertex: position, normal, color, u/v, barycentric coords (alpha/beta/gamma)
  - TransformData: position, rotation, scale
- **Dependencies:** Constrants.h
- **Note:** Barycentric coords in Vertex struct are unused (set but never read)

---

### Configuration & Constants (1 file)

#### **Constrants.h**
- **Role:** System-wide constants and color palette
- **Size:** 53 lines
- **Namespace:** GraphicsConstrants
- **Window:**
  - kWindowWidth = 600, kWindowHeight = 500, kTotalPixels = 300000
- **Camera:**
  - Default FOV, near/far planes, height, distance, view angle
  - Movement/rotation speeds
  - Min/max constraints for height/distance
- **Colors:** 25 predefined ARGB colors (kColorWhite, kColorRed, etc.)
- **Template:** clamp&lt;T&gt;() for value clamping
- **Dependencies:** None (leaf node)
- **Typo:** "Constrants" should be "Constants"

---

### Test Harness (1 file)

#### **TestManager.h**
- **Role:** Assignment-driven test orchestration with keyboard input
- **Size:** 939 lines (massive for a header!)
- **Responsibilities:**
  - Drives Assignment4Stage progression (STAR_FIELD → DIRECTIONAL_LIGHT → POINT_LIGHT)
  - Keyboard input via _kbhit()/_getch() (console-based UI)
  - Lighting config management (directly sets all global shader lighting variables)
  - Star field generation (3000 stars with spherical distribution)
  - Camera orbit automation
  - Grid/cube/light marker rendering
  - Debug visualization modes
- **Dependencies:** GraphicsHelper.hpp, Renderer.h, mesh.h, LineDrawing.h, Camera.h, Shaders.h (heavy coupling to entire stack)
- **Global State Manipulation:**
  - Lines 298-335: setStage() directly writes useAmbientLight, useDirectionalLight, usePointLight, VertexShader, directionalLightDir, etc.
  - Line 244: vsView = camera-&gt;getViewMatrix()
  - Lines 458, 590, 813: vsWorld = identity() or saved/restored
- **Anti-Patterns:**
  - Should be a separate .cpp file
  - Mixing test logic with rendering setup
  - No abstraction layer between test and renderer
- **Included Behavior:**
  - StoneHenge model loading (commented out, lines 817-937)
  - Lighting debug primitives (cube, grid, light marker)

---

### Geometry Generation (1 file)

#### **mesh.h**
- **Role:** Procedural mesh generation (cube, grid)
- **Size:** 175 lines
- **Key Features:**
  - Static factory methods: createCube(size), createGrid(size, divisions)
  - Cube: 24 vertices (4 per face), 36 indices, per-face colors
  - Grid: line-based wireframe mesh
  - toggleWireFrameMode() swaps triangle/line indices
  - Color management: setVetrexColor(), setAllVertexColors()
- **Dependencies:** Types.h
- **Typo:** "Idices" should be "Indices", "Vetrex" should be "Vertex"
- **Quality:** Clean, self-contained, reusable

---

### Application Entry Point (1 file)

#### **main.cpp**
- **Role:** Window initialization and main loop
- **Size:** 40 lines
- **Flow:**
  1. Create global instances: graphics, renderer, lineDrawing, timer, testManager (lines 11-15)
  2. Initialize RasterSurface window (line 21)
  3. Main loop: testManager.update()/render(), RS_Update() blits pixels (lines 29-36)
  4. Shutdown (line 38)
- **Dependencies:** RasterSurface.h (external windowing library), all core headers
- **Global Objects:** All major components are global variables (anti-pattern for testing/modularity)
- **Typo:** "MarusDaley" should be "MarcusDaley" (line 21)

---

### External Dependencies (4 files — headers only, no source)

#### **RasterSurface.h**
- **Role:** Window management API
- **Functions:** RS_Initialize(), RS_Update(), RS_Shutdown()
- **Not Found:** Implementation not present in codebase scan

#### **XTime.h**
- **Role:** Frame timing
- **Usage:** XTime timer(60) in main.cpp, timer.Signal() in TestManager
- **Not Found:** Implementation not present

#### **StoneHenge.h / StoneHenge.cpp / StoneHenge_Texture.h**
- **Role:** 3D model data (vertices, indices, texture)
- **Usage:** Included in TestManager.h (lines 13-15), but model loading code is commented out
- **Status:** Present but unused in current build

---

## Dependency Graph

### Include Hierarchy (Root → Leaf)

```
main.cpp (root)
├── RasterSurface.h (external, no impl)
├── GraphicsHelper.hpp
│   └── Constrants.h (leaf)
├── LineDrawing.h
│   ├── GraphicsHelper.hpp → ...
│   └── Shaders.h
│       ├── Types.h
│       │   └── Constrants.h (leaf)
│       ├── Matrix.h
│       │   └── Types.h → ...
│       └── MathU.h
│           └── Types.h → ...
├── Renderer.h
│   ├── Camera.h
│   │   ├── Matrix.h → ...
│   │   └── Constrants.h (leaf)
│   ├── GraphicsHelper.hpp → ...
│   ├── LineDrawing.h → ...
│   ├── Matrix.h → ...
│   ├── Types.h → ...
│   └── Shaders.h → ...
├── mesh.h
│   └── Types.h → ...
├── TestManager.h
│   ├── GraphicsHelper.hpp → ...
│   ├── Renderer.h → ...
│   ├── mesh.h → ...
│   ├── XTime.h (external, no impl)
│   ├── LineDrawing.h → ...
│   ├── Constrants.h (leaf)
│   ├── Camera.h → ...
│   ├── MathU.h → ...
│   └── StoneHenge.h/cpp/Texture.h (external, unused)
└── XTime.h (external)
```

### Leaf Nodes (No Dependencies)
- **Constrants.h** — Foundation for entire system

### Dependency Depth by File
| File | Depth | Max Include Chain |
|------|-------|-------------------|
| Constrants.h | 0 | (leaf) |
| Types.h | 1 | Constrants.h |
| Matrix.h, MathU.h, mesh.h | 2 | → Types.h → Constrants.h |
| Shaders.h, GraphicsHelper.hpp, Camera.h | 2-3 | → Matrix/Types → Constrants.h |
| LineDrawing.h, Renderer.h | 4 | → Shaders → Matrix → Types → Constrants.h |
| TestManager.h | 5 | → Renderer → Shaders → ... |
| main.cpp | 6 | → TestManager → ... |

---

## Circular Dependency Analysis

**Status:** ✅ **No circular dependencies detected**

All includes form a directed acyclic graph (DAG). The deepest chain is:
```
main.cpp → TestManager.h → Renderer.h → Shaders.h → Matrix.h → Types.h → Constrants.h
```

**Forward Declarations:** None used (not needed due to clean hierarchy)

---

## Orphaned Files

**Files included but not found in source tree:**
1. **RasterSurface.h** — Window management (likely compiled library)
2. **XTime.h** — Frame timing (likely compiled library)
3. **StoneHenge.h / StoneHenge.cpp / StoneHenge_Texture.h** — 3D model data (present but unused)

**Unused Source Files:** None — all files are actively included in the build

---

## Files Mentioned in BRIGHTFORGE_MASTER.md But Not Present

These files are part of the planned Vulkan architecture but do not exist yet:

### Rendering Subsystem (0 files exist)
- **renderer.h (lowercase)** — Vulkan rendering pipeline (distinct from Renderer.h which is the software rasterizer)
- **IRenderService.h** — Rendering service interface
- **VulkanContext.h** — Vulkan device/swapchain management
- **ShaderCompiler.h** — SPIR-V shader compilation
- **FragmentShader_PBR.hlsl** — PBR pixel shader

### UI Framework (0 files exist)
- **DebugWindow.h** — ImGui debug panel
- No wxWidgets integration
- No Qt integration

### Event System (0 files exist)
- **EventBus.h** — Observer pattern event dispatcher
- **QuoteSystem.h** — Quote management (purpose unclear)

### Utilities (0 files exist)
- **FileIntoString.h** — File loading helper

---

## File Size Statistics

| Category | File Count | Total Lines | Avg Lines/File |
|----------|-----------|-------------|----------------|
| Core Rendering | 5 | ~809 | ~162 |
| Math Infrastructure | 3 | ~256 | ~85 |
| Test Harness | 1 | 939 | 939 |
| Geometry | 1 | 175 | 175 |
| Config | 1 | 53 | 53 |
| Entry Point | 1 | 40 | 40 |
| **Total** | **12** | **~2272** | **~189** |

**Outliers:**
- TestManager.h is 41% of the entire codebase (939 / 2272 lines)
- Should be split into TestManager.h (interface) + TestManager.cpp (implementation)

---

## Namespace Usage

**Current State:** Only MathUtils uses a namespace (MathU.h)

**Global Namespace Pollution:**
- GraphicsConstrants (should be namespace or class)
- All classes (Renderer, Camera, LineDrawing, Mesh, GraphicsHelper)
- All global shader variables (Shaders.h/cpp)

**Recommendation:** Wrap all code in `namespace BrightForge { }` to avoid conflicts when integrating with Unreal/Vulkan

---

## Header vs Implementation Split

**Header-Only Files (4):**
- GraphicsHelper.hpp (179 lines) — Could remain header-only for inline performance
- mesh.h (175 lines) — Should split: mesh.h (30 lines interface) + mesh.cpp (145 lines impl)
- LineDrawing.h (293 lines) — Should split: LineDrawing.h (50 lines interface) + LineDrawing.cpp (243 lines impl)
- TestManager.h (939 lines) — **MUST split** into .h/.cpp

**Properly Split Files (1):**
- Shaders.h (42 lines) + Shaders.cpp (163 lines) ✅

**Header-Only Math (Justified):**
- Types.h, Matrix.h, MathU.h, Constrants.h — Small, inline-friendly, template-heavy

---

## Key Findings Summary

### Strengths
1. ✅ Clean dependency hierarchy (no circular includes)
2. ✅ Math library is well-designed and reusable
3. ✅ Depth buffer + perspective-correct texturing work correctly
4. ✅ Backface culling + frustum clipping implemented

### Critical Issues
1. ❌ **Global mutable state in Shaders.h/cpp** — 15+ global variables prevent multi-threading and testing
2. ❌ **TestManager.h is 939 lines** — violates single responsibility, should be .cpp
3. ❌ **Tight coupling** — TestManager directly manipulates all shader globals
4. ❌ **No abstraction layers** — Renderer writes directly to global shader state
5. ❌ **Hardcoded values** — Window size, FOV, movement speeds scattered throughout

### Missing Components (Per BRIGHTFORGE_MASTER.md)
1. Vulkan rendering pipeline (0% complete)
2. UI framework (ImGui/wxWidgets — not started)
3. Event system (EventBus — not started)
4. Service interfaces (IRenderService — not started)
5. Shader compilation (SPIR-V — not started)

---

## Recommendations

### Immediate Refactors (Phase 2 Prerequisites)
1. **Encapsulate shader state** — Create RenderContext struct to replace 15 global variables
2. **Split TestManager.h** — Move 900 lines of implementation to .cpp
3. **Extract lighting** — Create LightingManager class to own all light parameters
4. **Configuration system** — Move all hardcoded constants to JSON/YAML config file

### Architecture Improvements
1. **Namespace** — Wrap all code in `namespace BrightForge {}`
2. **Interface segregation** — Create IRasterizer interface for software renderer
3. **Dependency injection** — Pass GraphicsHelper/Camera as constructor params instead of globals
4. **Factory pattern** — MeshFactory for procedural geometry, MaterialFactory for shaders

### File Organization
```
src/
├── core/
│   ├── Types.h, Matrix.h, MathU.h, Constrants.h (math foundation)
│   └── RenderContext.h/cpp (replaces Shaders.h global state)
├── rasterizer/
│   ├── SoftwareRenderer.h/cpp (renamed from Renderer.h)
│   ├── GraphicsHelper.h/cpp (remove .hpp suffix)
│   ├── LineDrawing.h/cpp (split header/impl)
│   └── DepthBuffer.h/cpp (extract from GraphicsHelper)
├── scene/
│   ├── Camera.h/cpp
│   ├── Mesh.h/cpp (split from mesh.h)
│   └── LightingManager.h/cpp (new)
├── test/
│   └── TestManager.h/cpp (split 939-line file)
└── main.cpp
```

---

**Next Steps:** Proceed to Task 1.2 (pipeline_flow.md) to trace the software rasterizer data flow from vertex input to pixel output.
