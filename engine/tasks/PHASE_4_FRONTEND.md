# Phase 4: Frontend Implementation - Task Breakdown

**Agent:** FrontendEngineer
**Prerequisite:** Phases 2 and 3 complete (backend services and UI designs finalized)
**Status:** PENDING

---

## Task 4.1: Implement Event Bus

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phases 2 and 3 complete |
| Agent | FrontendEngineer |
| Blocks | All other Phase 4 tasks |

### Description

Implement a central `EventBus` with string-based event names, typed payloads, and thread-safe dispatch. This is the backbone of all inter-component communication -- no component may call another directly.

### Implementation

```cpp
class EventBus {
public:
    using EventId = std::string;
    using Callback = std::function<void(const EventPayload&)>;
    using SubscriptionId = uint64_t;

    static EventBus& instance(); // singleton

    // Subscribe to an event, returns handle for unsubscription
    SubscriptionId subscribe(const EventId& event, Callback callback);

    // Unsubscribe by handle
    void unsubscribe(SubscriptionId id);

    // Publish an event (thread-safe, dispatches to all subscribers)
    void publish(const EventId& event, const EventPayload& payload);

    // Deferred publish (queued, dispatched on next pump())
    void publishDeferred(const EventId& event, const EventPayload& payload);

    // Process deferred events (call from main thread each frame)
    void pump();

    // Debug: list all registered events and subscriber counts
    std::map<EventId, size_t> debugSubscriberCounts() const;

private:
    std::mutex m_mutex;
    std::unordered_map<EventId, std::vector<std::pair<SubscriptionId, Callback>>> m_subscribers;
    std::queue<std::pair<EventId, EventPayload>> m_deferredQueue;
    std::atomic<uint64_t> m_nextId{1};
};
```

### Event Catalog

| Event Name | Payload Type | Description |
|------------|-------------|-------------|
| `file.dropped` | `{ paths: string[], source: string }` | Files dropped onto DragDropZone |
| `file.loaded` | `{ assetId: int, path: string, format: string }` | File successfully loaded and indexed |
| `file.error` | `{ path: string, error: string }` | File load or validation failed |
| `asset.selected` | `{ assetId: int, name: string }` | Asset selected in browser or viewport |
| `tool.changed` | `{ tool: string, previous: string }` | Active tool changed (select, move, rotate, etc.) |
| `camera.updated` | `{ position: vec3, target: vec3, up: vec3 }` | Camera transform changed |
| `render.frame_start` | `{ frameNumber: uint64, deltaTime: float }` | Frame rendering begins |
| `render.frame_end` | `{ frameNumber: uint64, frameTimeMs: float }` | Frame rendering complete |
| `config.changed` | `{ key: string, oldValue: any, newValue: any }` | Configuration value changed |

### Thread Safety Requirements

- `publish()` must be safe to call from any thread
- Callbacks execute on the thread that calls `publish()` (synchronous) or `pump()` (deferred)
- `pump()` is called once per frame on the main/render thread
- Cross-thread events should use `publishDeferred()` to avoid UI threading issues

### Acceptance Criteria

- [ ] EventBus singleton implemented
- [ ] Subscribe/unsubscribe/publish working
- [ ] Thread-safe with mutex protection
- [ ] Deferred event queue with `pump()` working
- [ ] All 9 event types from the catalog registered
- [ ] Debug introspection method available

---

## Task 4.2: Build DragDropZone Component

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Task 4.1 |
| Agent | FrontendEngineer |

### Description

Implement the `DragDropZone` wxWidgets component with visual state feedback, format guard clauses, and EventBus integration.

### Visual States

| State | Appearance | Trigger |
|-------|-----------|---------|
| **Idle** | Dashed border, muted icon, "Drag files here" text | Default |
| **Hover** | Solid highlight border, icon pulses, format hints shown | Drag enters zone |
| **Valid** | Green border, checkmark icon, accepted format shown | Dragged file matches accepted format |
| **Invalid** | Red border, X icon, "Unsupported format" message | Dragged file does not match |
| **Loading** | Spinner animation, progress bar, filename displayed | File being processed |

### Guard Clauses

```cpp
bool DragDropZone::validateDrop(const std::vector<std::filesystem::path>& files) {
    for (const auto& file : files) {
        // Guard: file exists
        if (!std::filesystem::exists(file)) {
            setError("File not found: " + file.filename().string());
            return false;
        }
        // Guard: file size within limit
        auto size = std::filesystem::file_size(file);
        if (m_maxFileSize > 0 && size > m_maxFileSize) {
            setError("File too large: " + file.filename().string());
            return false;
        }
        // Guard: format is accepted
        auto ext = file.extension().string();
        if (!isAcceptedFormat(ext)) {
            setError("Unsupported format: " + ext);
            return false;
        }
    }
    return true;
}
```

### Event Bus Integration

```cpp
// On successful drop:
EventBus::instance().publish("file.dropped", {
    {"paths", droppedPaths},
    {"source", "drag_drop_zone"}
});

// Listen for load completion to update visual state:
EventBus::instance().subscribe("file.loaded", [this](const EventPayload& p) {
    setState(DragState::Idle);
    showSuccess(p.getString("path") + " loaded successfully");
});

EventBus::instance().subscribe("file.error", [this](const EventPayload& p) {
    setState(DragState::Idle);
    showError(p.getString("error"));
});
```

### Acceptance Criteria

- [ ] All 5 visual states render correctly
- [ ] Guard clauses reject invalid files before processing
- [ ] `file.dropped` event published on valid drop
- [ ] Listens for `file.loaded` and `file.error` to update state
- [ ] No direct calls to `FileService` -- all communication via EventBus

---

## Task 4.3: Build Searchable File Browser

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Task 4.1 |
| Agent | FrontendEngineer |

### Description

Implement `FileSearchBox`, `FileList`, and `AssetBrowser` components for browsing, searching, and managing loaded assets.

### Components

#### FileSearchBox

```cpp
class FileSearchBox : public wxPanel {
public:
    FileSearchBox(wxWindow* parent);

    void setFilterCallback(std::function<void(const std::string&)> cb);

private:
    wxTextCtrl* m_searchInput;
    wxChoice* m_formatFilter; // All, OBJ, FBX, glTF, GLB, STL
    wxTimer m_debounceTimer;  // 200ms debounce

    void onTextChanged(wxCommandEvent& event);
    void onFormatChanged(wxCommandEvent& event);
    void applyFilter();
};
```

#### FileList

```cpp
class FileList : public wxListCtrl {
public:
    FileList(wxWindow* parent);

    void setAssets(const std::vector<AssetMetadata>& assets);
    void applyFilter(const std::string& query, const std::string& format);
    void setViewMode(ViewMode mode); // Grid or List

    enum class ViewMode { List, Grid };

private:
    std::vector<AssetMetadata> m_allAssets;
    std::vector<AssetMetadata> m_filteredAssets;
    ViewMode m_viewMode = ViewMode::List;

    void onItemSelected(wxListEvent& event);
    void onItemActivated(wxListEvent& event); // double-click
    void onRightClick(wxListEvent& event);    // context menu
};
```

#### AssetBrowser

```cpp
class AssetBrowser : public wxPanel {
public:
    AssetBrowser(wxWindow* parent);

private:
    FileSearchBox* m_searchBox;
    FileList* m_fileList;

    // EventBus subscriptions
    void onFileLoaded(const EventPayload& payload);  // refresh list
    void onAssetDeleted(const EventPayload& payload); // remove from list
};
```

### Event Bus Integration

- Publishes `asset.selected` when a file is clicked
- Subscribes to `file.loaded` to refresh the asset list
- Does NOT call `AssetIndex` directly -- receives data via events

### Acceptance Criteria

- [ ] Search filters assets in real-time with 200ms debounce
- [ ] Format dropdown filters by file type
- [ ] Grid and list view modes both functional
- [ ] Double-click loads asset into viewport via event
- [ ] Context menu provides Open, Delete, Rename, Show in Explorer
- [ ] All communication via EventBus, no direct service calls

---

## Task 4.4: Implement 3D Viewport UI

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Task 4.1 |
| Agent | FrontendEngineer |

### Description

Implement the 3D viewport component that hosts the Vulkan render surface with camera controls, gizmo overlay, and performance display.

### Features

#### Vulkan Surface Hosting

```cpp
class Viewport3D : public wxPanel {
public:
    Viewport3D(wxWindow* parent);

    void attachRenderService(IRenderService* service);

private:
    IRenderService* m_renderService = nullptr;

    // Platform-specific surface creation
    void createVulkanSurface();
    // Resize handling
    void onResize(wxSizeEvent& event);
};
```

#### Camera Controls

| Input | Action | Parameters |
|-------|--------|-----------|
| Left mouse drag | Orbit around target | Azimuth + elevation angles |
| Middle mouse drag | Pan camera | X/Y translation in view plane |
| Scroll wheel | Zoom in/out | Distance to target |
| Right mouse drag | Free look | Yaw + pitch rotation |
| `F` key | Focus on selection | Animate camera to frame selected object |
| `Numpad 1/3/7` | Front/Right/Top view | Snap to orthographic axis view |

#### Gizmo Overlay

- Translation gizmo: RGB arrows for X/Y/Z axes
- Rotation gizmo: RGB rings for X/Y/Z axes
- Scale gizmo: RGB cubes on axes with uniform center cube
- Active axis highlighted on hover
- Gizmo type follows `tool.changed` event

#### FPS Counter

```cpp
// Bottom-left overlay
struct FrameStats {
    float fps;          // frames per second
    float frameTimeMs;  // last frame time in ms
    uint32_t drawCalls; // draw calls this frame
    uint32_t triangles; // triangles rendered
};
```

### Event Bus Integration

```cpp
// Publish camera changes
EventBus::instance().publish("camera.updated", {
    {"position", camera.position()},
    {"target", camera.target()},
    {"up", camera.up()}
});

// Subscribe to tool changes for gizmo switching
EventBus::instance().subscribe("tool.changed", [this](const EventPayload& p) {
    setGizmoType(p.getString("tool"));
});

// Subscribe to asset selection for focus target
EventBus::instance().subscribe("asset.selected", [this](const EventPayload& p) {
    setFocusTarget(p.getInt("assetId"));
});
```

### Acceptance Criteria

- [ ] Vulkan surface renders correctly within wxWidgets panel
- [ ] Camera orbit, pan, and zoom working with mouse input
- [ ] Gizmo overlays render for translate, rotate, scale tools
- [ ] FPS counter displays accurate frame statistics
- [ ] Window resize triggers swapchain recreation
- [ ] All input events published to EventBus

---

## Task 4.5: Connect UI via Event System

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Tasks 4.1, 4.2, 4.3, 4.4 |
| Agent | FrontendEngineer |

### Description

Wire all UI components together exclusively through the EventBus. No component may hold a direct reference to another component or backend service (except `Viewport3D`'s render service attachment).

### Wiring Map

```
DragDropZone --[file.dropped]--> DropHandler --[file.loaded]--> AssetBrowser
                                             --[file.error]---> DragDropZone

AssetBrowser --[asset.selected]--> PropertyInspector
                                --> Viewport3D (highlight)

ToolPanel --[tool.changed]--> Viewport3D (gizmo switch)

Viewport3D --[camera.updated]--> RenderService
           --[render.frame_start/end]--> FPS overlay

PropertyInspector --[config.changed]--> RenderService (material/transform update)
```

### Validation Checklist

The following must all be true before Task 4.5 is marked COMPLETE:

| # | Validation | How to Verify |
|---|-----------|---------------|
| 1 | No UI component imports another UI component's header | `grep -r "#include" src/ui/ -- exclude EventBus` |
| 2 | No UI component holds a pointer to another UI component | Code review: no `Component*` member variables |
| 3 | All inter-component communication goes through EventBus | Search for direct method calls between components |
| 4 | Removing any single UI component does not cause compile errors in others | Comment out each component's `.cpp`, verify others build |
| 5 | EventBus subscriber counts match expected wiring | `EventBus::instance().debugSubscriberCounts()` |
| 6 | Deferred events are pumped once per frame on main thread | Verify `pump()` call in main loop |

### Steps

1. Register all EventBus subscriptions in each component's constructor
2. Implement the event handlers that update component state
3. Verify the wiring map works end-to-end:
   - Drop a file -> see it appear in AssetBrowser
   - Select an asset -> see properties in PropertyInspector
   - Change a tool -> see gizmo change in Viewport
   - Move camera -> see coordinates update in status bar
4. Run the validation checklist
5. Fix any direct coupling discovered

### Acceptance Criteria

- [ ] All 6 validation checklist items pass
- [ ] End-to-end file drop flow works
- [ ] End-to-end asset selection flow works
- [ ] End-to-end tool change flow works
- [ ] No compile-time dependencies between UI components (except through EventBus)

---

## Testing Requirements

### EventBus Tests

```cpp
TestManager::add("EventBus_subscribe_and_publish", []() {
    EventBus bus;
    bool received = false;
    bus.subscribe("test.event", [&](const EventPayload& p) {
        received = true;
        ASSERT(p.getString("key") == "value");
    });
    bus.publish("test.event", {{"key", "value"}});
    ASSERT(received);
});

TestManager::add("EventBus_unsubscribe", []() {
    EventBus bus;
    int callCount = 0;
    auto id = bus.subscribe("test.event", [&](const EventPayload&) { callCount++; });
    bus.publish("test.event", {});
    bus.unsubscribe(id);
    bus.publish("test.event", {});
    ASSERT(callCount == 1);
});

TestManager::add("EventBus_deferred_pump", []() {
    EventBus bus;
    bool received = false;
    bus.subscribe("test.deferred", [&](const EventPayload&) { received = true; });
    bus.publishDeferred("test.deferred", {});
    ASSERT(!received); // not yet delivered
    bus.pump();
    ASSERT(received); // delivered after pump
});

TestManager::add("EventBus_thread_safety", []() {
    EventBus bus;
    std::atomic<int> count{0};
    bus.subscribe("test.threaded", [&](const EventPayload&) { count++; });
    std::vector<std::thread> threads;
    for (int i = 0; i < 10; i++) {
        threads.emplace_back([&]() {
            for (int j = 0; j < 100; j++) {
                bus.publish("test.threaded", {});
            }
        });
    }
    for (auto& t : threads) t.join();
    ASSERT(count == 1000);
});
```

### DragDropZone Tests

```cpp
TestManager::add("DragDropZone_valid_format_accepted", []() {
    DragDropZone zone({".obj", ".fbx"});
    ASSERT(zone.validateDrop({"model.obj"}) == true);
});

TestManager::add("DragDropZone_invalid_format_rejected", []() {
    DragDropZone zone({".obj", ".fbx"});
    ASSERT(zone.validateDrop({"document.pdf"}) == false);
});

TestManager::add("DragDropZone_publishes_event_on_drop", []() {
    EventBus bus;
    bool eventReceived = false;
    bus.subscribe("file.dropped", [&](const EventPayload&) { eventReceived = true; });
    DragDropZone zone({".obj"});
    zone.simulateDrop({"model.obj"});
    ASSERT(eventReceived);
});
```

### Integration Tests

```cpp
TestManager::add("EndToEnd_drop_to_browser", []() {
    // Simulate: drop file -> file.dropped -> DropHandler -> file.loaded -> AssetBrowser refresh
    EventBus& bus = EventBus::instance();
    AssetBrowser browser;
    ASSERT(browser.assetCount() == 0);

    // Simulate file.loaded event (as if DropHandler processed it)
    bus.publish("file.loaded", {{"assetId", 1}, {"path", "cube.obj"}, {"format", "obj"}});
    ASSERT(browser.assetCount() == 1);
});

TestManager::add("EndToEnd_select_updates_inspector", []() {
    EventBus& bus = EventBus::instance();
    PropertyInspector inspector;
    ASSERT(inspector.selectedAssetId() == -1);

    bus.publish("asset.selected", {{"assetId", 42}, {"name", "TestCube"}});
    ASSERT(inspector.selectedAssetId() == 42);
});
```

---

## Phase 4 Summary

| Task | Priority | Dependencies | Blocks |
|------|----------|--------------|--------|
| 4.1 Implement Event Bus | HIGH | Phases 2+3 | All Phase 4 tasks |
| 4.2 Build DragDropZone Component | HIGH | 4.1 | 4.5 |
| 4.3 Build Searchable File Browser | MED | 4.1 | 4.5 |
| 4.4 Implement 3D Viewport UI | HIGH | 4.1 | 4.5 |
| 4.5 Connect UI via Event System | HIGH | 4.1, 4.2, 4.3, 4.4 | Phase 5 |

**Critical Path:** Task 4.1 (EventBus) blocks everything. Tasks 4.2, 4.3, 4.4 can run in parallel after 4.1. Task 4.5 is the final integration gate.
