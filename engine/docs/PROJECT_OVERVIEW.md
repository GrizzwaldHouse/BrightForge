# PROJECT OVERVIEW

## Ultimate Goal

Evolve BrightForge from a Vulkan lab project into a production-grade 3D sculpting and editing platform. The existing renderer code (software rasterizer + Vulkan hardware pipeline) becomes the rendering backbone of a larger application that includes file management, UI/UX, scene editing, and asset pipelines.

## Current State

BrightForge currently has two rendering paths:

1. **Software Rasterizer** -- A CPU-based renderer that draws triangles, applies textures, and handles depth testing entirely in software. Useful for debugging, fallback on machines without a GPU, and as a reference implementation to validate the Vulkan path.

2. **Vulkan Hardware Pipeline** -- A GPU-accelerated renderer built on the Vulkan API via the GateWare library. Handles vertex/fragment shaders (HLSL compiled to SPIR-V at runtime via shaderc), descriptor sets, pipeline state, and swapchain presentation. Supports GLTF model loading via tinygltf.

Both paths share common math utilities (Matrix.h, MathU.h) and a camera system (Camera.h). The infrastructure layer (QuoteSystem, DebugWindow, TestManager, EventBus) is already ported and compiles independently of any GPU or graphics library.

## Architecture Principles

| Principle | What It Means |
|---|---|
| **95% Reusable / 5% Configurable** | Every module should work out of the box with sensible defaults. Only platform-specific or user-preference values live in config. |
| **Config-Driven** | No magic numbers in rendering code. Window size, MSAA, near/far planes, camera speed, lighting intensity -- all come from `RenderConfig` structs loaded from JSON/INI at startup. |
| **Separation of Concerns** | Rendering knows nothing about UI. UI knows nothing about file I/O. They communicate exclusively through the EventBus. |
| **Event-Driven** | Subsystems publish events ("file.loaded", "mesh.selected", "camera.moved") and subscribe to events they care about. No direct function calls across module boundaries. |
| **Composition Over Inheritance** | Prefer small, focused interfaces (like `IRenderService`) that can be implemented by different backends. Avoid deep class hierarchies. |
| **Fail-Fast** | Every subsystem validates its own state at startup via TestManager. Missing shaders, broken pipelines, and bad configs are caught before the main loop begins. |

## Existing Helper Files

These files are already written and should be reused, not rewritten:

| File | Purpose |
|---|---|
| `Camera.h` | FreeLookCamera function -- handles keyboard/mouse/controller input via GateWare GInput. Uses static locals (refactor target: extract into instanced CameraController class). Camera speed currently hardcoded at 0.3f (should read from RenderConfig). |
| `GraphicsHelper.hpp` | Utility functions for Vulkan object creation and teardown. Wraps verbose Vulkan boilerplate into one-liner helpers. |
| `Matrix.h` | 4x4 matrix operations: multiply, transpose, inverse, identity. Used by both renderers. |
| `MathU.h` | Math utilities: lerp, clamp, deg-to-rad, rad-to-deg, vector normalize, dot product, cross product. |
| `LineDrawing.h` | Bresenham line drawing for the software rasterizer. Also used for wireframe debug overlay. |
| `Shaders.h` / `Shaders.cpp` | HLSL shader source strings and runtime compilation via shaderc. Compiles vertex and fragment shaders to SPIR-V byte code. |
| `Constrants.h` / `Constrants.cpp` | Application-wide constants: window dimensions, default colors, max vertex count, buffer sizes. (Note: filename is intentionally misspelled from original project.) |
| `FileIntoString.h` | Reads an entire file into a `std::string`. Used for shader loading and config file reading. |
| `mesh.h` | Mesh data structures: vertex format (position, normal, UV, color), index buffer, bounding box. Shared between both renderers. |
| `QuoteSystem.h` | Motivational logging system with themed quote pools (Harry Potter, Naruto, etc.) and FNV-1a integrity checking. Already ported to the engine scaffold. |

## Five Phases

### Phase 1: Analysis

- Audit every existing source file from the Vulkan renderer repository
- Catalog all functions, their dependencies, and their current coupling
- Identify which functions map to which layer in the target architecture
- Document technical debt and hardcoded values that need to become config-driven
- Produce a dependency graph showing which files include which

### Phase 2: Backend Refactor

- Extract rendering logic behind the `IRenderService` interface
- Separate VkDevice management, pipeline creation, resource management, and render loop into distinct modules
- Port the Vulkan backend to implement `IRenderService`
- Port the software rasterizer to implement `IRenderService`
- Wire both backends to the EventBus for lifecycle events
- Make all rendering parameters config-driven via `RenderConfig`

### Phase 3: UI/UX Design

- Design the application layout: viewport, toolbar, properties panel, asset browser, timeline
- Create wireframes and mockup previews
- Define the interaction model: select, move, rotate, scale, sculpt
- Plan keyboard shortcuts and input mapping
- Design the theme system (colors, fonts, spacing)

### Phase 4: Frontend Implementation

- Build the EventBus-based drag-and-drop system
- Implement the toolbar and properties panel
- Connect UI actions to rendering commands via events
- Build the asset browser with file system integration
- Implement undo/redo via command pattern

### Phase 5: Integration

- Connect all subsystems through the EventBus
- Run integration tests across rendering + UI + file system
- Performance profiling and optimization pass
- Stability testing under sustained load
- Package for distribution

## Code Quality Requirements

- **C++17 minimum** -- use `std::variant`, `std::optional`, `std::filesystem`, structured bindings, `if constexpr`
- **No raw `new`/`delete`** -- use `std::unique_ptr`, `std::shared_ptr`, RAII wrappers
- **const correctness** -- mark everything `const` that does not mutate
- **Thread safety** -- all shared state protected by `std::mutex` or `std::atomic`
- **Self-tests** -- every module includes a test suite runnable via TestManager
- **Logging** -- all console output goes through QuoteSystem or DebugWindow, never raw `std::cout` in production code
- **No magic numbers** -- all tunables live in config structs or `namespace Config` blocks at the top of each file

## SQL Notes

SQL is used for asset and project metadata persistence, not for rendering. Planned uses:

- **Asset database** -- Track imported models, textures, and materials with metadata (file path, format, polygon count, last modified)
- **Project state** -- Save/restore scene graph, camera positions, lighting setups
- **Generation history** -- Log all 3D generation requests and results (mirrors the Node.js Forge3D SQLite schema)
- **Undo/redo journal** -- Persistent command history for crash recovery

Storage engine: SQLite via `better-sqlite3` on the Node.js side, or `sqlite3.h` amalgamation compiled directly into the C++ engine.

## Assembly Language Notes

Assembly (x86-64, primarily SIMD intrinsics via SSE/AVX) is used only where it provides measurable performance gains in hot paths:

- **Depth buffer operations** -- SIMD-accelerated depth comparison and clearing (see Z_DEPTH_ANALYSIS.md)
- **Matrix multiplication** -- 4x4 matrix multiply using SSE `_mm_mul_ps` / `_mm_add_ps` for the software rasterizer's transform pipeline
- **Vertex transformation** -- Batch vertex transform using AVX when available
- **Pixel blending** -- Alpha blending in the software rasterizer's fragment stage

All assembly optimizations are guarded by `#ifdef` and have pure C++ fallbacks. The compiler's auto-vectorization handles most cases; hand-written assembly is a last resort after profiling confirms a bottleneck.
