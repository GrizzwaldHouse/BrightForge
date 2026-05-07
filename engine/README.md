# BrightForge Engine

C++ Vulkan rendering engine embedded inside the BrightForge AI coding agent. This is the foundation for evolving BrightForge into a production-grade 3D sculpting and editing platform.

## Current State

The engine scaffold includes four production-ready infrastructure headers and a demo program that exercises them. The Vulkan renderer has **not yet been ported** — placeholder `.TODO` files indicate exactly which files to pull from the [reference repo](https://github.com/GrizzwaldHouse/Vulkan-Renderer).

### What's Here Now

| Directory | Contents |
|-----------|----------|
| `src/core/` | QuoteSystem.h, DebugWindow.h, TestManager.h, EventBus.h (production-ready) |
| `src/rendering/` | RenderConfig.h, IRenderService.h (abstractions), .TODO placeholders |
| `shaders/` | .TODO placeholders for HLSL shaders |
| `docs/` | Architecture docs, Z-depth analysis, command reference |
| `skills/` | Coding convention guides (logging, debugging, testing, rendering) |
| `tasks/` | Phase 1-5 task breakdowns + Z-depth fix |

### What's NOT Here Yet

- Vulkan device/pipeline/shader code (the actual renderer)
- GateWare library integration
- TinyGLTF model loading
- 3D model assets
- Window creation and input handling

## Build the Demo

The demo requires only a C++17 compiler and pthreads. No Vulkan SDK, no GPU.

```bash
cd engine
cmake -B build
cmake --build build
./build/brightforge_engine_demo    # Linux/Mac
# or: build\Debug\brightforge_engine_demo.exe   # Windows
```

Expected output:
- All 6 QuoteSystem message types with themed quotes
- Integrity check: PASSED for correct phrase, DETECTED TAMPERING for wrong phrase
- DebugWindow `CheckFileExists` shows `FILE MISSING` for unported shaders (intentional)
- `QuoteSystemTestManager::RunAllTests()` → ALL PASSED
- `EventBusTests::RunAll()` → ALL PASSED
- EventBus `file.dropped` delivery confirmed
- Final DebugWindow dashboard with all channels

## Next Session: Porting Checklist

To bring in the actual Vulkan renderer from the [reference repo](https://github.com/GrizzwaldHouse/Vulkan-Renderer):

### Step 1: Copy Source Files

```
# From the reference repo, copy these into engine/:
renderer.h          → src/rendering/renderer.h      (remove .TODO placeholder)
Camera.h            → src/rendering/Camera.h         (remove .TODO placeholder)
FileIntoString.h    → src/rendering/FileIntoString.h
mesh.h              → src/rendering/mesh.h
TextureUtils.h      → src/rendering/TextureUtils.h
TextureUtilsKTX.h   → src/rendering/TextureUtilsKTX.h (if using KTX textures)
```

### Step 2: Copy Shaders

```
VertexShader.hlsl       → shaders/VertexShader.hlsl       (remove .TODO)
FragmentShader.hlsl     → shaders/FragmentShader.hlsl      (remove .TODO)
FragmentShader_PBR.hlsl → shaders/FragmentShader_PBR.hlsl  (remove .TODO)
```

### Step 3: Copy Third-Party Libraries

```
# Create engine/third_party/ and copy:
TinyGLTF/           → third_party/TinyGLTF/
tiny_gltf.h         → third_party/tiny_gltf.h
json.hpp            → third_party/json.hpp
stb_image.h         → third_party/stb_image.h
stb_image_write.h   → third_party/stb_image_write.h
ktx/                → third_party/ktx/              (if using KTX textures)
```

### Step 4: Copy Assets

```
# Create engine/assets/ and copy:
Models/             → assets/Models/
Materials/          → assets/Materials/
PBR IBL ENV/        → assets/PBR_IBL_ENV/
```

### Step 5: Install Dependencies

- **GateWare SDK** — Download from the course materials or GateWare repo. Place in `third_party/Gateware/`.
- **Vulkan SDK** — Install from https://vulkan.lunarg.com/
- **shaderc** — Included with Vulkan SDK

### Step 6: Update CMakeLists.txt

Enable Vulkan and add the new source files:
```cmake
set(BRIGHTFORGE_ENABLE_VULKAN ON)
# Add find_package(Vulkan), link GateWare, shaderc, tinygltf
# Change main.cpp to create a GWindow + GVulkanSurface instead of console demo
```

### Step 7: Apply Reversed-Z Depth Fix

While porting, apply the 4-point reversed-Z fix documented in `tasks/Z_DEPTH_FIX.md`:

1. **main.cpp**: Change depth clear from `1.0f` to `0.0f`
2. **renderer.h** `CreateVkPipelineDepthStencilStateCreateInfo()`: Change `VK_COMPARE_OP_LESS` → `VK_COMPARE_OP_GREATER`, swap depth bounds
3. **renderer.h** `CreateViewportFromWindowDimensions()`: Swap `minDepth` (0→1) and `maxDepth` (1→0)
4. **renderer.h** `InitializeProjectionMatrix()`: Set `nearPlane = 0.00001f`, `farPlane = 10000.0f`

**All 4 changes must be applied together** — partial application will produce a black screen.

### Step 8: Wire Infrastructure

After porting, integrate the infrastructure headers:
- Add `#include "QuoteSystem.h"` to renderer.h and Camera.h
- Add QuoteSystem logging to shader compilation, buffer creation, pipeline init
- Register "Renderer" channel with DebugWindow
- Add `CheckFileExists` calls for all shader paths
- Register TestManager test cases for depth config values

## How This Relates to BrightForge

The engine lives alongside the Node.js AI coding agent. Integration options:

1. **Subprocess**: The Node.js side spawns the engine binary via `child_process` (same pattern used for `python/inference_server.py`)
2. **Shared assets**: The engine reads from `data/output/` where BrightForge's Forge3D pipeline writes GLB meshes
3. **WebSocket**: The engine could connect to BrightForge's WebSocket event bus at `ws://localhost:3847/ws/events` for real-time coordination

## Architecture

See `docs/PROJECT_OVERVIEW.md` for the full architecture description and `docs/RENDERING_PIPELINE_BLUEPRINT.md` for the target rendering pipeline design.

## Conventions

All code must follow the conventions documented in `skills/`:
- **QuoteSystem**: Every function logs SUCCESS or ERROR_MSG. See `skills/quotesystem/SKILL.md`
- **DebugWindow**: Every subsystem registers a channel. See `skills/debugwindow/SKILL.md`
- **TestManager**: Every feature has test cases. See `skills/testmanager/SKILL.md`
- **Rendering**: Config-driven, no hardcoded values. See `skills/rendering/SKILL.md`
