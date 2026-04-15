# Wiring Manifest — BrightForge Event Architecture

**Author:** Marcus Daley
**Date:** April 2026
**Purpose:** Complete event flow documentation for all subsystems

---

## Event Flow Table

| Event Name | Payload Type | Producer | Consumer(s) |
|-----------|--------------|----------|-------------|
| `application.init` | None | Application | RenderService, FileService, UIService |
| `application.shutdown` | None | Application | RenderService, FileService, UIService |
| `camera.updated` | CameraTransformData | CameraController | RenderService, DebugWindow |
| `camera.moved` | Vec3 (position) | CameraController | RenderService |
| `camera.rotated` | Vec2 (pitch, yaw) | CameraController | RenderService |
| `config.changed` | ConfigChangeData | ConfigManager | RenderService, UIService |
| `config.shader_reload` | None | ConfigManager | RenderService |
| `config.wireframe_toggle` | bool (enabled) | ConfigManager | RenderService |
| `file.dropped` | FileDropData | UIService | FileService |
| `file.loaded` | AssetData | FileService | RenderService, FileBrowser |
| `file.error` | ErrorData | FileService | DebugWindow, UIService |
| `render.frame_start` | FrameData | RenderService | DebugWindow, TestManager |
| `render.frame_end` | FrameStatsData | RenderService | DebugWindow, PerformancePanel |
| `render.shader_compiled` | ShaderCompileData | ShaderManager | DebugWindow |
| `render.pipeline_created` | PipelineData | RenderService | DebugWindow |
| `render.viewport_resize` | Vec2 (width, height) | WindowManager | RenderService |
| `ui.panel_toggled` | PanelToggleData | UIService | DebugWindow |
| `ui.button_clicked` | ButtonEventData | UIService | ConfigManager, FileService |
| `debug.log` | LogData | Any | DebugWindow |
| `debug.clear` | None | DebugWindow | DebugWindow |
| `test.run_started` | TestRunData | TestManager | DebugWindow |
| `test.run_complete` | TestResultData | TestManager | DebugWindow, PerformancePanel |
| `resource.loaded` | ResourceData | ResourceManager | DebugWindow |
| `resource.freed` | ResourceData | ResourceManager | DebugWindow |

---

## Payload Type Definitions

```cpp
// CameraTransformData
struct CameraTransformData {
    glm::mat4 viewMatrix;
    glm::mat4 projectionMatrix;
    glm::vec3 position;
    glm::vec3 forward;
};

// ConfigChangeData
struct ConfigChangeData {
    std::string key;
    std::string oldValue;
    std::string newValue;
};

// FileDropData
struct FileDropData {
    std::vector<std::string> paths;
    glm::vec2 dropPosition;
};

// AssetData
struct AssetData {
    std::string path;
    std::string type;
    size_t vertexCount;
    size_t triangleCount;
    void* handle;
};

// ErrorData
struct ErrorData {
    std::string subsystem;
    std::string message;
    int severity; // 0=info, 1=warning, 2=error, 3=critical
};

// FrameData
struct FrameData {
    uint64_t frameNumber;
    double deltaTime;
};

// FrameStatsData
struct FrameStatsData {
    uint64_t frameNumber;
    double frameTime;
    double cpuTime;
    double gpuTime;
    uint32_t drawCalls;
    uint32_t triangles;
};

// ShaderCompileData
struct ShaderCompileData {
    std::string shaderName;
    bool success;
    std::string errorLog;
    double compileTime;
};

// PipelineData
struct PipelineData {
    std::string pipelineName;
    uint32_t pipelineHandle;
};

// PanelToggleData
struct PanelToggleData {
    std::string panelName;
    bool visible;
};

// ButtonEventData
struct ButtonEventData {
    std::string buttonId;
    std::string action;
};

// LogData
struct LogData {
    std::string channel;
    std::string message;
    int severity;
    double timestamp;
};

// TestRunData
struct TestRunData {
    std::string suiteName;
    uint32_t testCount;
};

// TestResultData
struct TestResultData {
    std::string suiteName;
    uint32_t passed;
    uint32_t failed;
    double totalTime;
};

// ResourceData
struct ResourceData {
    std::string resourceType;
    std::string resourceId;
    size_t memorySize;
};
```

---

## Rendering Subsystem Wiring

### RenderService Subscriptions
```cpp
void RenderService::RegisterEventHandlers() {
    EventBus::Subscribe("application.init", [this](const Event& e) {
        Initialize();
    });

    EventBus::Subscribe("application.shutdown", [this](const Event& e) {
        Shutdown();
    });

    EventBus::Subscribe("camera.updated", [this](const Event& e) {
        auto* data = e.GetPayload<CameraTransformData>();
        UpdateCameraMatrices(data->viewMatrix, data->projectionMatrix);
    });

    EventBus::Subscribe("config.changed", [this](const Event& e) {
        auto* data = e.GetPayload<ConfigChangeData>();
        ApplyConfigChange(data->key, data->newValue);
    });

    EventBus::Subscribe("config.wireframe_toggle", [this](const Event& e) {
        auto* enabled = e.GetPayload<bool>();
        SetWireframeMode(*enabled);
    });

    EventBus::Subscribe("render.frame_start", [this](const Event& e) {
        BeginFrame();
    });

    EventBus::Subscribe("render.viewport_resize", [this](const Event& e) {
        auto* size = e.GetPayload<glm::vec2>();
        ResizeViewport(static_cast<uint32_t>(size->x), static_cast<uint32_t>(size->y));
    });

    EventBus::Subscribe("file.loaded", [this](const Event& e) {
        auto* data = e.GetPayload<AssetData>();
        LoadAssetToGPU(data);
    });
}
```

### RenderService Publications
```cpp
void RenderService::BeginFrame() {
    FrameData frameData { currentFrame, deltaTime };
    EventBus::Publish("render.frame_start", &frameData);
}

void RenderService::EndFrame() {
    FrameStatsData stats {
        currentFrame,
        frameTimer.GetElapsed(),
        cpuTimer.GetElapsed(),
        gpuTimer.GetElapsed(),
        drawCallCount,
        triangleCount
    };
    EventBus::Publish("render.frame_end", &stats);
}

void RenderService::OnShaderCompiled(const std::string& name, bool success) {
    ShaderCompileData data { name, success, errorLog, compileTime };
    EventBus::Publish("render.shader_compiled", &data);
}
```

---

## FileSystem Subsystem Wiring

### FileService Subscriptions
```cpp
void FileService::RegisterEventHandlers() {
    EventBus::Subscribe("application.init", [this](const Event& e) {
        InitializeFileWatcher();
    });

    EventBus::Subscribe("file.dropped", [this](const Event& e) {
        auto* data = e.GetPayload<FileDropData>();
        LoadFiles(data->paths);
    });

    EventBus::Subscribe("ui.button_clicked", [this](const Event& e) {
        auto* data = e.GetPayload<ButtonEventData>();
        if (data->action == "open_file_dialog") {
            OpenFileDialog();
        }
    });
}
```

### FileService Publications
```cpp
void FileService::OnFileLoaded(const std::string& path, void* handle) {
    AssetData data {
        path,
        DetectFileType(path),
        ExtractVertexCount(handle),
        ExtractTriangleCount(handle),
        handle
    };
    EventBus::Publish("file.loaded", &data);
    QuoteSystem::Log(QuoteCategory::FileIO, "Asset loaded: " + path);
}

void FileService::OnFileError(const std::string& path, const std::string& error) {
    ErrorData data {
        "FileService",
        "Failed to load " + path + ": " + error,
        2 // error severity
    };
    EventBus::Publish("file.error", &data);
    QuoteSystem::Log(QuoteCategory::FileIO, "Error: " + error);
}
```

---

## UI Subsystem Wiring

### UIService Subscriptions
```cpp
void UIService::RegisterEventHandlers() {
    EventBus::Subscribe("application.init", [this](const Event& e) {
        InitializeUI();
    });

    EventBus::Subscribe("render.frame_end", [this](const Event& e) {
        auto* stats = e.GetPayload<FrameStatsData>();
        UpdatePerformanceDisplay(stats);
    });

    EventBus::Subscribe("file.loaded", [this](const Event& e) {
        auto* data = e.GetPayload<AssetData>();
        AddToFileBrowser(data->path);
    });

    EventBus::Subscribe("file.error", [this](const Event& e) {
        auto* data = e.GetPayload<ErrorData>();
        ShowErrorNotification(data->message);
    });
}
```

### UIService Publications
```cpp
void UIService::OnPanelToggled(const std::string& panelName, bool visible) {
    PanelToggleData data { panelName, visible };
    EventBus::Publish("ui.panel_toggled", &data);
}

void UIService::OnButtonClicked(const std::string& buttonId, const std::string& action) {
    ButtonEventData data { buttonId, action };
    EventBus::Publish("ui.button_clicked", &data);
}

void UIService::OnFileDrop(const std::vector<std::string>& paths, glm::vec2 position) {
    FileDropData data { paths, position };
    EventBus::Publish("file.dropped", &data);
}
```

---

## CameraController Wiring

### CameraController Subscriptions
```cpp
void CameraController::RegisterEventHandlers() {
    EventBus::Subscribe("application.init", [this](const Event& e) {
        InitializeCamera();
    });

    EventBus::Subscribe("render.viewport_resize", [this](const Event& e) {
        auto* size = e.GetPayload<glm::vec2>();
        UpdateProjectionMatrix(size->x, size->y);
    });
}
```

### CameraController Publications
```cpp
void CameraController::Update(float deltaTime) {
    ProcessInput(deltaTime);

    if (transformDirty) {
        CameraTransformData data {
            CalculateViewMatrix(),
            projectionMatrix,
            position,
            GetForward()
        };
        EventBus::Publish("camera.updated", &data);
        transformDirty = false;
    }
}
```

---

## DebugWindow Wildcard Subscriber

```cpp
void DebugWindow::RegisterEventHandlers() {
    // Wildcard subscriber for event tracing
    EventBus::Subscribe("*", [this](const Event& e) {
        LogEvent(e);
    });

    EventBus::Subscribe("debug.clear", [this](const Event& e) {
        ClearEventLog();
    });
}

void DebugWindow::LogEvent(const Event& e) {
    std::lock_guard<std::mutex> lock(eventLogMutex);

    EventLogEntry entry {
        e.GetName(),
        e.GetTimestamp(),
        e.HasPayload() ? "yes" : "no",
        GetEventChannel(e.GetName())
    };

    eventLog.push_back(entry);

    // Keep last 1000 events
    if (eventLog.size() > 1000) {
        eventLog.erase(eventLog.begin());
    }
}
```

---

## Validation Checklist

### ✅ No Direct System Coupling
- RenderService does NOT call CameraController methods directly
- FileService does NOT call UIService methods directly
- All communication via EventBus only

### ✅ No Cross-Layer Includes
- UI files do NOT include Engine/Rendering headers
- Rendering files do NOT include UI headers
- Shared types defined in Events/EventTypes.h

### ✅ Event-Driven Only
- No polling loops checking system state
- All state changes publish events
- All reactions subscribe to events

### ✅ Decoupled Initialization
- Systems initialize independently via `application.init` event
- Shutdown in reverse order via `application.shutdown` event
- No initialization dependencies between subsystems

---

## Event Catalog by Subsystem

### Application Events
- `application.init`
- `application.shutdown`

### Camera Events
- `camera.updated`
- `camera.moved`
- `camera.rotated`

### Config Events
- `config.changed`
- `config.shader_reload`
- `config.wireframe_toggle`

### File Events
- `file.dropped`
- `file.loaded`
- `file.error`

### Render Events
- `render.frame_start`
- `render.frame_end`
- `render.shader_compiled`
- `render.pipeline_created`
- `render.viewport_resize`

### UI Events
- `ui.panel_toggled`
- `ui.button_clicked`

### Debug Events
- `debug.log`
- `debug.clear`

### Test Events
- `test.run_started`
- `test.run_complete`

### Resource Events
- `resource.loaded`
- `resource.freed`

---

## Event Flow Diagrams

### Frame Render Flow
```
WindowManager
    └─> render.viewport_resize ──> RenderService::ResizeViewport()

CameraController::Update()
    └─> camera.updated ──> RenderService::UpdateCameraMatrices()

Application::MainLoop()
    └─> render.frame_start ──> RenderService::BeginFrame()
                                    ├─> DebugWindow::OnFrameStart()
                                    └─> TestManager::OnFrameStart()

RenderService::EndFrame()
    └─> render.frame_end ──> DebugWindow::UpdateStats()
                          └─> PerformancePanel::UpdateDisplay()
```

### File Load Flow
```
User drops file on viewport
    └─> UIService::OnFileDrop()
        └─> file.dropped ──> FileService::LoadFiles()
                                 ├─> file.loaded ──> RenderService::LoadAssetToGPU()
                                 │                └─> FileBrowser::AddItem()
                                 └─> file.error ──> DebugWindow::LogError()
                                                 └─> UIService::ShowNotification()
```

### Config Change Flow
```
User toggles wireframe checkbox
    └─> UIService::OnButtonClicked()
        └─> ui.button_clicked ──> ConfigManager::SetValue()
                                      └─> config.wireframe_toggle ──> RenderService::SetWireframeMode()
                                                                   └─> DebugWindow::LogConfigChange()
```

---

## Thread Safety Notes

All EventBus publications are thread-safe via internal mutex.
Subscribers MUST NOT block — use async processing for heavy work.
Payload data is copied by EventBus, original can be safely destroyed.

---

**End of Wiring Manifest**
