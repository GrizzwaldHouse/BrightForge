# CLAUDE CODE COMMAND REFERENCE

## How to Use These Commands

These are natural-language prompts designed to be pasted directly into Claude Code when working on the BrightForge engine. Each command describes a specific task with enough context for Claude to execute it correctly against the codebase.

Copy the entire command block (including the quoted text) and paste it as your prompt. Claude will read the relevant source files, apply the changes, and report what it did.

Commands are organized by phase to match the project roadmap. Run them in order within each phase, but phases can overlap.

---

## Phase 1 Commands

### Start Phase 1

```
"Analyze the BrightForge engine scaffold in engine/src/ and engine/shaders/. 
Read every .h, .cpp, and .TODO file. Produce a dependency graph showing which 
files include which, list every public function and class, identify all 
hardcoded values that should become config-driven, and flag any coupling 
between modules that violates the separation-of-concerns principle described 
in engine/docs/PROJECT_OVERVIEW.md. Output the results as a structured report."
```

### Run Analysis Audit

```
"Audit the existing helper files listed in PROJECT_OVERVIEW.md (Camera.h, 
GraphicsHelper.hpp, Matrix.h, MathU.h, LineDrawing.h, Shaders.h/cpp, 
Constrants.h/cpp, FileIntoString.h, mesh.h, QuoteSystem.h). For each file, 
determine: (1) which target module it maps to in the RENDERING_PIPELINE_BLUEPRINT 
architecture, (2) what refactoring is needed to fit behind IRenderService, 
(3) what config values need to be extracted into RenderConfig, and (4) any 
technical debt or code smells. Cross-reference with the .TODO port notes."
```

---

## Phase 2 Commands

### Execute Rendering Refactor

```
"Implement the Vulkan backend refactor described in RENDERING_PIPELINE_BLUEPRINT.md. 
Create four new classes: VulkanDevice (Step 1), VulkanPipelineBuilder (Step 2), 
VulkanResourceManager (Step 3), and VulkanRenderer (Step 4). VulkanRenderer must 
implement the IRenderService interface from src/rendering/IRenderService.h. 
Port the functions listed in the 'Existing Functions to Reuse' table into their 
target modules. Apply all 4 reversed-Z fixes from Z_DEPTH_ANALYSIS.md. Wire 
lifecycle events through the EventBus. All rendering parameters must come from 
RenderConfig -- no hardcoded values."
```

### Execute FileSystem Design

```
"Design and implement a FileService class for the BrightForge engine. It should 
handle: GLTF model loading (via tinygltf), texture loading (PNG/JPG/HDR), 
scene serialization (save/load the scene graph as JSON), and shader file 
loading (HLSL from the shaders/ directory). Publish EventBus events for all 
file operations: 'file.loaded', 'file.failed', 'file.saved'. Include a file 
watcher for hot-reload during development. Register self-tests with TestManager."
```

---

## Phase 3 Commands

### Generate UI Preview v1

```
"Design the BrightForge editor UI layout as an ASCII wireframe. The layout 
should include: a 3D viewport (center, largest area), a toolbar (top, 
horizontal), a properties panel (right sidebar), an asset browser (bottom 
panel), and a debug/console panel (toggleable). Show the proportions and 
describe the interaction model for select, move, rotate, and scale tools. 
Define keyboard shortcuts for the most common operations."
```

### Generate UI Preview v2

```
"Based on the UI layout from v1, create an HTML/CSS mockup of the BrightForge 
editor interface. Use a dark theme consistent with the existing web dashboard 
(see public/css/). The viewport area should be a placeholder div. Include 
working tab switching for the bottom panel (Asset Browser, Console, Timeline). 
The properties panel should show placeholder fields for position, rotation, 
scale, and material properties. Save to engine/docs/ui-preview.html."
```

---

## Phase 4 Commands

### Build Event Bus

```
"The EventBus in src/core/EventBus.h is already implemented. Now wire it into 
the rendering pipeline. Add the following event publications: 'render.frame.begin', 
'render.frame.end', 'render.mesh.submitted', 'render.camera.updated', 
'render.config.changed'. Add subscriptions in the relevant modules so that 
config changes propagate without direct coupling. Add a new test suite to 
TestManager that verifies all rendering events fire correctly during a 
simulated frame. Include a wildcard subscriber that logs all events to 
DebugWindow for development tracing."
```

### Build DragDrop System

```
"Implement a drag-and-drop system for the BrightForge editor using the EventBus. 
When a file is dropped onto the viewport (event: 'file.dropped'), the system 
should: (1) identify the file type (GLTF, OBJ, PNG, HDR), (2) publish 
'file.import.requested' with the file path, (3) FileService loads the asset 
and publishes 'file.loaded', (4) RenderService subscribes and adds the mesh 
to the scene. Handle errors gracefully -- if the file is unsupported, publish 
'file.import.rejected' with a reason. Add DebugWindow logging for every step."
```

---

## Phase 5 Commands

### Run Integration Test

```
"Write an integration test that exercises the full pipeline: EventBus -> 
FileService -> RenderService -> DebugWindow. The test should: (1) publish 
a 'file.dropped' event with a test GLTF path, (2) verify FileService 
publishes 'file.loaded', (3) verify RenderService receives the mesh handle, 
(4) simulate 10 frames of rendering with BeginFrame/EndFrame, (5) verify 
DebugWindow captured all expected events, (6) verify no errors in any channel. 
Register the test with TestManager under the 'Integration' suite. Print a 
summary with pass/fail counts."
```

### Performance Audit

```
"Profile the BrightForge rendering pipeline. Measure: (1) time per frame 
for BeginFrame -> SubmitMesh (N meshes) -> EndFrame, (2) EventBus publish 
latency (time from Publish call to last subscriber callback), (3) memory 
usage per loaded mesh and texture, (4) depth buffer precision at distances 
1m, 10m, 100m, 1000m, 5000m (verify reversed-Z improvement). Output results 
to DebugWindow and optionally to the depth_stats SQLite table described in 
Z_DEPTH_ANALYSIS.md. Flag any measurements that exceed target thresholds."
```

---

## Z-Depth Precision Fix Commands

### Fix Reversed-Z Depth Buffer

```
"Apply the complete 4-point reversed-Z fix described in Z_DEPTH_ANALYSIS.md 
to the Vulkan rendering pipeline. Specifically: (1) change depth clear value 
from 1.0 to 0.0, (2) change depth compare op from VK_COMPARE_OP_LESS to 
VK_COMPARE_OP_GREATER, (3) swap viewport minDepth/maxDepth to 1.0/0.0, 
(4) set near plane to 0.00001 and far plane to 10000.0 from RenderConfig. 
Also apply the software rasterizer fix (S1): make the depth test read 
the reversedZ flag from RenderConfig. Add verification tests for all 4 
scenarios described in the VERIFICATION section."
```

### Analyze Z-Depth Issue

```
"I am seeing Z-fighting artifacts at far distances. Diagnose the issue by: 
(1) reading the current depth clear value, compare op, viewport range, and 
near/far planes from the rendering code, (2) comparing them against the 
fixes in Z_DEPTH_ANALYSIS.md, (3) checking if the RenderConfig.reversedZ 
flag is being respected in both the Vulkan and software renderers, (4) if 
the depth_stats SQLite table exists, query it for frames with high 
zfight_count. Report which of the 6 issues (V1-V4, S1-S2) are present 
and which have been fixed."
```

---

## Utility Commands

### Run All Tests

```
"Run every test suite registered with TestManager, plus the EventBus self-tests 
in EventBusTests::RunAll(), plus the QuoteSystem self-tests in 
QuoteSystemTestManager::RunAllTests(). If any test fails, read the source 
of the failing test, diagnose the root cause, fix it, and re-run. Report 
the final pass/fail summary. If the engine demo binary exists 
(build/brightforge_engine_demo), run it and capture the output."
```

### Check Pipeline Health

```
"Perform a health check on the BrightForge engine pipeline. Verify: 
(1) all .TODO files in engine/ have corresponding implementation files or 
documented blockers, (2) IRenderService.h compiles with no warnings, 
(3) RenderConfig.h has no hardcoded values that belong in external config, 
(4) EventBus has no subscription leaks (GetSubscriberCount for all known 
events), (5) DebugWindow has no unresolved errors in any channel, 
(6) CMakeLists.txt includes all source files. Report status for each check."
```

### Toggle Debug Verbosity

```
"Toggle debug verbosity for the BrightForge engine. Set 
EventBusConfig::TRACE_EVENTS to true so every EventBus publish is logged. 
Set QuoteConfig::VERBOSE_MODE to true so DEBUG-level messages appear. 
Set DebugConfig::USE_COLORS to true for ANSI color output. Then run the 
infrastructure demo (main.cpp) and capture the full verbose output. 
When done debugging, provide a command to set all three flags back to 
their production defaults."
```
