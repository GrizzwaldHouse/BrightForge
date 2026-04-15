# Smoke Tests — BrightForge End-to-End Validation

**Author:** Marcus Daley
**Date:** April 2026
**Purpose:** Manual test scenarios with expected results for system integration validation

---

## Test 1: Cold Start Test

### Purpose
Verify clean initialization of all subsystems with no assets loaded.

### Steps
1. Delete `D:\BrightForge\data\session_state.db` (if exists)
2. Launch `BrightForge.exe`
3. Wait for window to appear
4. Observe all panels and viewport

### Expected Results
- Window opens at 1280x720 within 2 seconds
- Viewport is empty (dark gray clear color)
- File Browser panel shows "No files loaded" message
- Performance Panel shows:
  - FPS: 60-144 (vsync dependent)
  - Frame Time: <16.67ms
  - Draw Calls: 0
  - Triangles: 0
- DebugWindow shows green status for all channels:
  - `[Rendering]` ✅ Initialized
  - `[FileIO]` ✅ Initialized
  - `[UI]` ✅ Initialized
  - `[Camera]` ✅ Initialized
  - `[EventBus]` ✅ Ready (0 pending events)
- No error messages in console

### Expected QuoteSystem Logs
```
[Rendering] "Clarity in code, as in life, comes from good structure." — Vulkan initialized
[Rendering] "Clarity in code, as in life, comes from good structure." — Shader pipeline compiled (5 shaders)
[FileIO] "Simple systems, powerful outcomes." — File watcher initialized
[UI] "Every problem is solvable with the right tools." — ImGui context created
[Camera] "Keep moving forward, even if it's one step at a time." — Camera controller initialized
[EventBus] "Simple systems, powerful outcomes." — EventBus ready (24 subscribers)
```

### Pass Criteria
- ✅ All subsystems initialize without errors
- ✅ Viewport renders clear color
- ✅ All panels are visible and interactive
- ✅ DebugWindow shows green status
- ✅ No memory leaks reported in console

---

## Test 2: File Load Test

### Purpose
Verify GLTF file loading and rendering pipeline.

### Steps
1. Complete Test 1 (cold start)
2. Drag `test_assets/cube.gltf` onto viewport
3. Start timer
4. Observe viewport and file browser

### Expected Results
- File loads within 2 seconds
- File Browser adds "cube.gltf" entry with:
  - Vertex count: 24
  - Triangle count: 12
  - File size: ~2KB
- Viewport shows cube centered at origin
- Cube has default material (gray diffuse)
- Performance Panel updates:
  - Draw Calls: 1
  - Triangles: 12
  - Frame Time: <16.67ms (no slowdown)
- DebugWindow logs load sequence

### Expected QuoteSystem Logs
```
[FileIO] "Simple systems, powerful outcomes." — File dropped: test_assets/cube.gltf
[FileIO] "Every problem is solvable with the right tools." — GLTF parsed: 24 vertices, 12 triangles
[Rendering] "Clarity in code, as in life, comes from good structure." — GPU buffer uploaded: 1152 bytes
[Rendering] "Small steps lead to big changes." — Draw call registered: cube.gltf
```

### Expected Event Sequence (DebugWindow)
1. `file.dropped` — {paths: ["test_assets/cube.gltf"]}
2. `file.loaded` — {path: "cube.gltf", type: "GLTF", vertexCount: 24, triangleCount: 12}
3. `resource.loaded` — {resourceType: "VertexBuffer", memorySize: 1152}
4. `render.frame_end` — {drawCalls: 1, triangles: 12}

### Pass Criteria
- ✅ File loads within 2 seconds
- ✅ Cube renders correctly in viewport
- ✅ File Browser updates with asset info
- ✅ No console errors
- ✅ Performance remains stable

---

## Test 3: Camera Interaction Test

### Purpose
Verify camera controller and view matrix propagation.

### Steps
1. Complete Test 2 (file loaded)
2. Click and hold right mouse button in viewport
3. Move mouse left/right (yaw rotation)
4. Move mouse up/down (pitch rotation)
5. Release right mouse button
6. Press W key (forward movement)
7. Press S key (backward movement)
8. Press A key (left strafe)
9. Press D key (right strafe)
10. Observe viewport and DebugWindow

### Expected Results
- Mouse movement rotates camera smoothly (no stuttering)
- Cube rotates visually around viewport center
- WASD movement translates camera position
- Camera position updates in DebugWindow "Camera" channel every frame:
  - Position: (x, y, z) values change
  - Forward: (x, y, z) normalized direction
- Viewport renders continuously at 60+ FPS
- No input lag

### Expected QuoteSystem Logs
```
[Camera] "Keep moving forward, even if it's one step at a time." — Position updated: (1.2, 0.5, 3.0)
[Camera] "Small steps lead to big changes." — Rotation updated: pitch=15.2°, yaw=45.8°
[Rendering] "Clarity in code, as in life, comes from good structure." — View matrix updated
```

### Expected Event Sequence (DebugWindow)
1. `camera.updated` — {position: (0, 0, 5)} (initial)
2. `camera.rotated` — {pitch: 15.2, yaw: 45.8} (after mouse drag)
3. `camera.updated` — {position: (1.2, 0.5, 3.0)} (after WASD)
4. `render.frame_end` — (continuous, 60+ per second)

### Pass Criteria
- ✅ Camera rotation is smooth and responsive
- ✅ Camera movement updates view matrix
- ✅ `camera.updated` events propagate to RenderService
- ✅ No visual artifacts or jitter
- ✅ Frame time remains <16.67ms

---

## Test 4: Config Change Test

### Purpose
Verify configuration system and immediate visual feedback.

### Steps
1. Complete Test 2 (file loaded)
2. Open DebugWindow (if not already visible)
3. Navigate to "Config" tab in DebugWindow
4. Click "Wireframe Mode" checkbox
5. Observe viewport change
6. Click checkbox again to toggle off
7. Observe viewport return to normal

### Expected Results
- Clicking "Wireframe Mode" checkbox:
  - Viewport immediately switches to wireframe rendering
  - Cube shows only edges (no filled triangles)
  - DebugWindow logs config change
- Clicking checkbox again:
  - Viewport returns to solid shading
  - Cube shows filled triangles
- No frame drops during transition
- Config persists to `config/render_settings.yaml`

### Expected QuoteSystem Logs
```
[Config] "Every problem is solvable with the right tools." — Config changed: wireframe_mode = true
[Rendering] "Clarity in code, as in life, comes from good structure." — Wireframe mode enabled
[Config] "Every problem is solvable with the right tools." — Config changed: wireframe_mode = false
[Rendering] "Clarity in code, as in life, comes from good structure." — Wireframe mode disabled
```

### Expected Event Sequence (DebugWindow)
1. `ui.button_clicked` — {buttonId: "wireframe_toggle", action: "toggle"}
2. `config.changed` — {key: "wireframe_mode", oldValue: "false", newValue: "true"}
3. `config.wireframe_toggle` — {enabled: true}
4. `render.frame_end` — (immediate visual update)

### Pass Criteria
- ✅ Wireframe toggle applies immediately (within 1 frame)
- ✅ Events propagate from UI → Config → Rendering
- ✅ DebugWindow shows event trace
- ✅ No console errors
- ✅ Config file updates on disk

---

## Test 5: Stress Test

### Purpose
Verify stability under heavy asset load and confirm no memory leaks.

### Steps
1. Complete Test 1 (cold start)
2. Drag `test_assets/stress_test/` folder onto viewport (contains 10 GLTF files)
3. Wait for all files to load
4. Observe Performance Panel for 60 seconds
5. Check memory usage in Task Manager
6. Close application
7. Restart and repeat steps 2-5

### Expected Results
- All 10 GLTF files load within 10 seconds total
- File Browser shows all 10 entries
- Viewport renders all 10 meshes simultaneously
- Performance Panel shows:
  - FPS: 30-60 (depends on scene complexity)
  - Frame Time: <33ms
  - Draw Calls: 10
  - Triangles: varies (sum of all meshes)
- Memory usage stabilizes after initial load
- No memory growth over 60 seconds of runtime
- Second run shows identical memory usage (no leak accumulation)
- Application shuts down cleanly (no hang)

### Expected QuoteSystem Logs
```
[FileIO] "Simple systems, powerful outcomes." — Batch load started: 10 files
[FileIO] "Every problem is solvable with the right tools." — GLTF parsed: mesh_01.gltf
[FileIO] "Every problem is solvable with the right tools." — GLTF parsed: mesh_02.gltf
... (8 more)
[Rendering] "Clarity in code, as in life, comes from good structure." — Batch upload: 10 vertex buffers
[Rendering] "Small steps lead to big changes." — Scene complexity: 10 draw calls, 4823 triangles
```

### Expected Event Sequence (DebugWindow)
1. `file.dropped` — {paths: [10 file paths]}
2. `file.loaded` × 10 — (one per GLTF)
3. `resource.loaded` × 10 — (one per vertex buffer)
4. `render.frame_end` — {drawCalls: 10, triangles: 4823}

### Memory Leak Detection
- Initial memory (after load): ~150MB
- After 60s: ~150MB (±5MB acceptable variance)
- After shutdown: all resources freed
- Second run initial: ~150MB (not cumulative)

### Pass Criteria
- ✅ All files load without errors
- ✅ Frame rate remains above 30 FPS
- ✅ Memory usage is stable (no growth)
- ✅ No console errors during stress test
- ✅ Application shuts down cleanly
- ✅ Second run shows no memory accumulation

---

## Test 6: Reversed-Z Depth Test

### Purpose
Verify depth buffer uses reversed-Z (near=1.0, far=0.0) for improved precision.

### Steps
1. Complete Test 2 (file loaded)
2. Open DebugWindow "Rendering" channel
3. Enable "Debug Depth" visualization mode
4. Move camera very close to cube (distance < 0.1 units)
5. Observe depth visualization
6. Move camera very far from cube (distance > 1000 units)
7. Observe depth visualization

### Expected Results
- Close to cube:
  - Depth visualization shows WHITE (depth value near 1.0)
  - DebugWindow logs: "Depth at center: 0.99"
- Far from cube:
  - Depth visualization shows BLACK (depth value near 0.0)
  - DebugWindow logs: "Depth at center: 0.01"
- No Z-fighting artifacts when extremely close
- Depth precision remains high at far distances

### Expected QuoteSystem Logs
```
[Rendering] "Clarity in code, as in life, comes from good structure." — Reversed-Z enabled
[Rendering] "Small steps lead to big changes." — Depth range: near=1.0, far=0.0
[Rendering] "Every problem is solvable with the right tools." — Depth clear value: 0.0
```

### Technical Validation
- Projection matrix maps near plane → 1.0, far plane → 0.0
- Depth clear value is 0.0 (not 1.0)
- Depth compare mode is GREATER (not LESS)
- Depth buffer format is D32_SFLOAT (32-bit precision)

### Pass Criteria
- ✅ Near objects show white in depth visualization
- ✅ Far objects show black in depth visualization
- ✅ No Z-fighting at extreme close distances
- ✅ Depth precision maintained at far distances
- ✅ DebugWindow confirms reversed-Z config

---

## Test 7: Event System Stress Test

### Purpose
Verify EventBus handles high event throughput without performance degradation.

### Steps
1. Complete Test 1 (cold start)
2. Open DebugWindow "EventBus" channel
3. Enable "Log All Events" checkbox
4. Perform Test 3 (camera interaction) for 10 seconds
5. Observe EventBus statistics in DebugWindow

### Expected Results
- EventBus processes 600+ events per second during camera movement
  - `camera.updated`: 60/sec
  - `render.frame_start`: 60/sec
  - `render.frame_end`: 60/sec
  - Other events as triggered
- DebugWindow shows:
  - Total Events: 6000+
  - Avg Processing Time: <0.1ms per event
  - Max Queue Depth: <10
  - Dropped Events: 0
- No frame rate impact (remains 60+ FPS)
- Event log scrolls smoothly (no UI freeze)

### Expected QuoteSystem Logs
```
[EventBus] "Simple systems, powerful outcomes." — Event throughput: 652 events/sec
[EventBus] "Small steps lead to big changes." — Avg processing time: 0.08ms
[EventBus] "Every problem is solvable with the right tools." — Max queue depth: 7
```

### Pass Criteria
- ✅ EventBus handles 600+ events/sec
- ✅ No events dropped
- ✅ Processing time <0.1ms per event
- ✅ No performance impact on rendering
- ✅ DebugWindow remains responsive

---

## Test 8: Shader Hot Reload Test

### Purpose
Verify shader recompilation at runtime without application restart.

### Steps
1. Complete Test 2 (file loaded)
2. Open `D:\BrightForge\Shaders\Fragment\pbr_ps.hlsl` in text editor
3. Change line with `float3 ambient = ...` to brighter value
4. Save file
5. Press F5 in BrightForge window (trigger shader reload)
6. Observe viewport change

### Expected Results
- Pressing F5 triggers shader recompilation
- Viewport updates within 1 second
- Cube lighting changes (brighter ambient)
- DebugWindow logs:
  - "Shader reload requested"
  - "Compiling pbr_ps.hlsl"
  - "Compilation successful: 0.234s"
- No application restart needed
- If compilation fails (syntax error), old shader remains active

### Expected QuoteSystem Logs
```
[Rendering] "Every problem is solvable with the right tools." — Shader reload triggered
[Rendering] "Clarity in code, as in life, comes from good structure." — Compiling: pbr_ps.hlsl
[Rendering] "Small steps lead to big changes." — Compilation successful: 0.234s
[Rendering] "Keep moving forward, even if it's one step at a time." — Pipeline rebuilt
```

### Expected Event Sequence (DebugWindow)
1. `config.shader_reload` — {}
2. `render.shader_compiled` — {shaderName: "pbr_ps.hlsl", success: true, compileTime: 0.234}
3. `render.pipeline_created` — {pipelineName: "PBR_Pipeline"}
4. `render.frame_end` — (visual update)

### Pass Criteria
- ✅ Shader recompiles without restart
- ✅ Visual changes apply immediately
- ✅ Compilation errors show in DebugWindow (not crash)
- ✅ Old shader remains if compilation fails
- ✅ QuoteSystem logs compilation result

---

## Test 9: Multi-Monitor Test

### Purpose
Verify window and rendering work correctly across multiple monitors.

### Steps
1. Connect second monitor (if available)
2. Launch BrightForge on primary monitor
3. Drag window to secondary monitor
4. Complete Test 2 (load cube)
5. Verify rendering and interaction

### Expected Results
- Window moves smoothly to secondary monitor
- Rendering continues without artifacts
- Camera controls work identically
- Frame rate remains stable
- DPI scaling applies correctly (if monitors differ)

### Pass Criteria
- ✅ Rendering works on both monitors
- ✅ No visual corruption during move
- ✅ Input handling works on both monitors
- ✅ DPI scaling handled correctly

---

## Test 10: Clean Shutdown Test

### Purpose
Verify all resources are properly freed and no dangling handles remain.

### Steps
1. Complete Test 5 (stress test with 10 files)
2. Click window close button (X)
3. Observe console output
4. Check Task Manager for process termination

### Expected Results
- Application closes within 2 seconds
- Console shows shutdown sequence in reverse order:
  - UI shutdown
  - Rendering shutdown
  - File system shutdown
  - EventBus shutdown
- DebugWindow logs resource cleanup
- No "Resource leak detected" warnings
- Process terminates completely (not zombie)
- No crash or hang

### Expected QuoteSystem Logs
```
[Application] "Small steps lead to big changes." — Shutdown initiated
[UI] "Every problem is solvable with the right tools." — ImGui shutdown
[Rendering] "Clarity in code, as in life, comes from good structure." — Vulkan cleanup: 10 buffers freed
[Rendering] "Simple systems, powerful outcomes." — Pipeline destroyed
[Rendering] "Keep moving forward, even if it's one step at a time." — Device destroyed
[FileIO] "Simple systems, powerful outcomes." — File watcher stopped
[EventBus] "Small steps lead to big changes." — EventBus shutdown (6000 events processed)
[Application] "Every problem is solvable with the right tools." — Clean exit
```

### Expected Event Sequence (DebugWindow)
1. `application.shutdown` — {}
2. `resource.freed` × 10 — (vertex buffers)
3. `debug.log` — (shutdown confirmations)

### Pass Criteria
- ✅ Application closes within 2 seconds
- ✅ All resources freed (no leak warnings)
- ✅ Shutdown sequence completes in order
- ✅ No crash or hang
- ✅ Process terminates cleanly

---

## Automated Test Execution Checklist

For each test:
- [ ] Record start time
- [ ] Capture DebugWindow state before test
- [ ] Execute test steps
- [ ] Verify expected results
- [ ] Check QuoteSystem logs match expected
- [ ] Check EventBus trace matches expected
- [ ] Record pass/fail status
- [ ] Capture screenshot if visual verification needed
- [ ] Note any deviations from expected behavior

---

## Test Environment Requirements

- Windows 10/11 with Vulkan 1.3 support
- GPU: NVIDIA/AMD with 2GB+ VRAM
- RAM: 8GB+ system memory
- Visual Studio 2022 (for debug builds)
- Test assets in `test_assets/` directory
- Clean state (delete session_state.db before tests)

---

**End of Smoke Tests**
