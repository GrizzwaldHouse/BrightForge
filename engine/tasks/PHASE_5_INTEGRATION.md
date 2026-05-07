# Phase 5: Integration - Task Breakdown

**Agents:** RenderingEngineer + FrontendEngineer + FileSystemEngineer (collaborative)
**Prerequisite:** Phases 2, 3, and 4 complete (backend services, UI designs, and frontend components all finalized)
**Status:** PENDING

---

## Task 5.1: Wire Rendering to Event Bus

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phases 2-4 complete |
| Agents | RenderingEngineer + FrontendEngineer |

### Description

Connect the `VulkanRenderService` to the EventBus so that rendering responds to camera changes, config updates, and publishes frame timing data.

### Event Subscriptions

```cpp
void VulkanRenderService::wireEventBus(EventBus& bus) {
    // Subscribe: start rendering when frame begins
    bus.subscribe("render.frame_start", [this](const EventPayload& p) {
        m_currentFrame = p.getUint64("frameNumber");
        m_deltaTime = p.getFloat("deltaTime");
        beginFrame();
    });

    // Subscribe: update camera when UI changes it
    bus.subscribe("camera.updated", [this](const EventPayload& p) {
        CameraState cam;
        cam.position = p.getVec3("position");
        cam.target = p.getVec3("target");
        cam.up = p.getVec3("up");
        setCamera(cam);
    });

    // Subscribe: apply config changes at runtime
    bus.subscribe("config.changed", [this](const EventPayload& p) {
        std::string key = p.getString("key");
        if (key == "vsync") {
            m_config.vsync = p.getBool("newValue");
            recreateSwapchain();
        } else if (key == "msaa") {
            m_config.msaaSamples = static_cast<VkSampleCountFlagBits>(p.getInt("newValue"));
            recreatePipeline();
        }
        // ... other config keys
    });
}
```

### Event Publications

```cpp
// After frame submission:
EventBus::instance().publish("render.frame_end", {
    {"frameNumber", m_currentFrame},
    {"frameTimeMs", frameTimer.elapsedMs()},
    {"drawCalls", m_drawCallCount},
    {"triangles", m_triangleCount}
});
```

### Acceptance Criteria

- [ ] Render service subscribes to `render.frame_start`, `camera.updated`, `config.changed`
- [ ] Render service publishes `render.frame_end` with timing data
- [ ] Camera updates from UI are reflected in the next rendered frame
- [ ] Config changes trigger appropriate pipeline/swapchain recreation
- [ ] No direct function calls between UI components and render service

---

## Task 5.2: Wire FileSystem to Event Bus

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phases 2-4 complete |
| Agents | FileSystemEngineer + FrontendEngineer |

### Description

Connect the `FileService`, `AssetIndex`, and `DropHandler` to the EventBus so that the entire file loading pipeline is event-driven.

### End-to-End File Flow

```
User drops file onto DragDropZone
        |
        v
DragDropZone publishes "file.dropped"
        |                                        EventBus
        v
DropHandler subscribes to "file.dropped"
        |
        +---> FileService.loadFile(path)
        |         |
        |         +---> Validate magic bytes
        |         +---> Read file data
        |         +---> Detect format
        |
        +---> AssetIndex.addAsset(metadata)
        |         |
        |         +---> Insert into SQLite
        |         +---> Return assetId
        |
        +---> On success: publish "file.loaded"
        |         |
        |         v
        |     AssetBrowser subscribes to "file.loaded"
        |         +---> Refresh file list
        |         +---> Show new asset
        |
        +---> On failure: publish "file.error"
                  |
                  v
              DragDropZone subscribes to "file.error"
                  +---> Show error message
                  +---> Reset to idle state
```

### Wiring Code

```cpp
void DropHandler::wireEventBus(EventBus& bus) {
    bus.subscribe("file.dropped", [this](const EventPayload& p) {
        auto paths = p.getStringArray("paths");
        std::vector<std::filesystem::path> fsPaths;
        for (const auto& path : paths) {
            fsPaths.emplace_back(path);
        }

        auto result = handleBatchDrop(fsPaths);

        for (int id : result.assetIds) {
            auto meta = m_assetIndex.getById(id);
            if (meta) {
                bus.publish("file.loaded", {
                    {"assetId", id},
                    {"path", meta->path},
                    {"format", meta->format},
                    {"vertexCount", meta->vertexCount},
                    {"faceCount", meta->faceCount}
                });
            }
        }

        for (const auto& error : result.errors) {
            bus.publish("file.error", {
                {"error", error}
            });
        }
    });
}
```

### Acceptance Criteria

- [ ] `file.dropped` -> `DropHandler` -> `file.loaded` / `file.error` flow works end-to-end
- [ ] AssetBrowser refreshes when `file.loaded` fires
- [ ] DragDropZone shows error when `file.error` fires
- [ ] Batch drops correctly publish one event per file
- [ ] No direct calls between UI and filesystem services

---

## Task 5.3: End-to-End Smoke Test

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Tasks 5.1, 5.2 |
| Agents | All three engineers |

### Description

Run five smoke test scenarios that exercise the full stack from UI interaction through backend processing and back to visual output.

### Scenario 1: Cold Start

| Step | Expected Result |
|------|----------------|
| Launch application | Window appears with default layout |
| Verify MenuBar | All menus present and responsive |
| Verify Viewport | Vulkan surface renders clear color |
| Verify AssetBrowser | Empty state with "No assets loaded" message |
| Verify PropertyInspector | Empty state with "No selection" message |
| Check FPS counter | Displays non-zero FPS |
| Check EventBus | `render.frame_start` and `render.frame_end` events flowing |

### Scenario 2: File Load

| Step | Expected Result |
|------|----------------|
| Drag `.obj` file onto DragDropZone | Zone shows "Valid" state (green border) |
| Drop the file | Loading spinner appears |
| Wait for load | `file.loaded` event fires |
| Check AssetBrowser | New asset appears in list |
| Check Viewport | Model rendered in viewport |
| Check PropertyInspector | Vertex count, face count, format displayed |

### Scenario 3: Camera Interaction

| Step | Expected Result |
|------|----------------|
| Left-click drag in Viewport | Camera orbits around model |
| Middle-click drag | Camera pans |
| Scroll wheel | Camera zooms in/out |
| Press `F` key | Camera animates to frame selected object |
| Verify `camera.updated` events | Position/target/up values change correctly |
| Verify render output | Model perspective updates each frame |

### Scenario 4: Config Change

| Step | Expected Result |
|------|----------------|
| Open View menu | Config options displayed |
| Toggle VSync | `config.changed` event fires with key=vsync |
| Verify swapchain recreated | Present mode changes, no crash |
| Change clear color | Background color updates in viewport |
| Change MSAA setting | Pipeline recreated, antialiasing changes visible |

### Scenario 5: Stress Test

| Step | Expected Result |
|------|----------------|
| Load 10 models simultaneously | All load without crash |
| Orbit camera rapidly | Frame rate stays above 30 FPS |
| Resize window repeatedly | Swapchain recreates cleanly each time |
| Open/close panels rapidly | No layout corruption or crashes |
| Run for 5 minutes | No memory growth beyond 10%, no leaks |

### Acceptance Criteria

- [ ] All 5 scenarios pass without crashes
- [ ] No Vulkan validation layer errors
- [ ] No memory leaks detected (validation layers or sanitizers)
- [ ] Frame rate meets minimum threshold (30 FPS) under stress
- [ ] All EventBus events fire with correct payloads

---

## Task 5.4: Performance Optimization

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Task 5.3 |
| Agents | RenderingEngineer |

### Description

Profile the integrated application and optimize bottlenecks.

### Steps

1. **Profile frame times:**
   - Measure CPU time vs GPU time per frame
   - Identify whether bottleneck is CPU-bound or GPU-bound
   - Target: < 16.6ms per frame (60 FPS)

2. **Batch draw calls:**
   - Group meshes by material to minimize pipeline state changes
   - Use instanced rendering for repeated geometry
   - Target: < 100 draw calls for typical scenes

3. **Identify assembly/SQL optimization candidates:**
   - Profile SQLite query times in AssetIndex
   - Add indices for commonly queried columns if missing
   - Consider prepared statements for repeated queries
   - Profile hot loops in math/transform code for potential SIMD optimization

4. **Memory optimization:**
   - Profile allocation patterns with a memory tracker
   - Pool frequently allocated objects (EventPayload, small buffers)
   - Verify no per-frame heap allocations in the render loop

### Acceptance Criteria

- [ ] Frame time profiling data collected and documented
- [ ] Draw call batching implemented where applicable
- [ ] SQLite queries optimized with proper indices
- [ ] No per-frame heap allocations in the hot path
- [ ] Performance report produced with before/after metrics

---

## Task 5.5: Documentation and Portfolio Polish

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Tasks 5.3, 5.4 |
| Agents | All three engineers |

### Description

Produce final documentation, capture screenshots, and create architecture diagrams for the completed engine.

### Steps

1. **README:**
   - Project overview and features
   - Build instructions (dependencies, CMake, platform notes)
   - Usage guide with screenshots
   - Architecture overview with diagram references

2. **Screenshots:**
   - Default layout with a loaded model
   - Each layout variation (Minimal, Standard, Professional)
   - DragDropZone in each visual state
   - PropertyInspector showing model metadata
   - FPS counter overlay

3. **Architecture Diagrams:**
   - System overview (all subsystems and their connections)
   - EventBus wiring diagram (which components publish/subscribe to which events)
   - File loading pipeline (end-to-end flow)
   - Vulkan render pipeline (initialization through frame present)
   - Class hierarchy diagram

### Acceptance Criteria

- [ ] README covers build, run, and architecture
- [ ] At least 5 screenshots captured
- [ ] At least 3 architecture diagrams produced
- [ ] All code has doc comments on public APIs

---

## Final Checklist

Before the project is considered complete, all 10 items must be verified:

| # | Item | Status |
|---|------|--------|
| 1 | Application launches without errors on target platform | [ ] |
| 2 | Vulkan validation layers report zero errors/warnings | [ ] |
| 3 | All 5 smoke test scenarios pass | [ ] |
| 4 | Frame rate >= 30 FPS with 10 loaded models | [ ] |
| 5 | File drag-and-drop works end-to-end (drop -> load -> display) | [ ] |
| 6 | Camera orbit/pan/zoom are smooth and responsive | [ ] |
| 7 | All UI panels render correctly at 1280x720 minimum | [ ] |
| 8 | No memory leaks after 5-minute run (validated by tooling) | [ ] |
| 9 | EventBus validation checklist passes (6 items from Task 4.5) | [ ] |
| 10 | Documentation, screenshots, and architecture diagrams complete | [ ] |

---

## Phase 5 Summary

| Task | Priority | Dependencies | Agents |
|------|----------|--------------|--------|
| 5.1 Wire Rendering to Event Bus | HIGH | Phases 2-4 | RenderingEngineer + FrontendEngineer |
| 5.2 Wire FileSystem to Event Bus | HIGH | Phases 2-4 | FileSystemEngineer + FrontendEngineer |
| 5.3 End-to-End Smoke Test | HIGH | 5.1, 5.2 | All |
| 5.4 Performance Optimization | MED | 5.3 | RenderingEngineer |
| 5.5 Documentation and Portfolio Polish | MED | 5.3, 5.4 | All |

**Note:** Tasks 5.1 and 5.2 can run in parallel. Task 5.3 blocks on both. Tasks 5.4 and 5.5 are sequential after 5.3.
