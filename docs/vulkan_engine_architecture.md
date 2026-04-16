# BrightForge Vulkan Engine Architecture Documentation

**Author:** Marcus Daley
**Date:** April 2026
**Version:** Phase 5 Integration

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Layer Boundaries](#layer-boundaries)
4. [Event Flow](#event-flow)
5. [Module Inventory](#module-inventory)
6. [Design Decisions](#design-decisions)
7. [Reversed-Z Depth](#reversed-z-depth)
8. [Observability Systems](#observability-systems)
9. [Thread Safety](#thread-safety)
10. [Extension Points](#extension-points)

---

## System Overview

BrightForge is a modern C++ Vulkan 3D rendering engine built on event-driven architecture principles. The system prioritizes:

- **Decoupling**: No direct system-to-system coupling; all communication via EventBus
- **Modularity**: Each subsystem can be tested and replaced independently
- **Observability**: QuoteSystem logging and DebugWindow tracing on all operations
- **Configuration**: All rendering behavior driven by YAML config files
- **Precision**: Reversed-Z depth buffering for enhanced depth precision

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Application Layer                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ main.cpp     │  │ Application  │  │ Config       │          │
│  │              │─>│  Manager     │<─│  Manager     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└────────────────────────┬─────────────────────────────────────────┘
                         │ Publishes events
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Engine Core Layer                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      EventBus                             │   │
│  │  - Subscribe(eventName, callback)                        │   │
│  │  - Publish(eventName, payload)                           │   │
│  │  - Thread-safe event dispatch                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │                    │                    │              │
│         │ Events             │ Events             │ Events       │
│         ▼                    ▼                    ▼              │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐     │
│  │ Render      │      │ File        │      │ Camera      │     │
│  │ Service     │      │ Service     │      │ Controller  │     │
│  └─────────────┘      └─────────────┘      └─────────────┘     │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         │ Events             │ Events             │ Events
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                          UI Layer                                │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐     │
│  │ Debug       │      │ Performance │      │ File        │     │
│  │ Window      │      │ Panel       │      │ Browser     │     │
│  └─────────────┘      └─────────────┘      └─────────────┘     │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         │ Render             │ Render             │ Render
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Rendering Backend                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Vulkan API                             │   │
│  │  - VkDevice, VkQueue, VkSwapchain                        │   │
│  │  - VkPipeline, VkRenderPass, VkFramebuffer              │   │
│  │  - VkBuffer, VkImage, VkCommandBuffer                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer Boundaries

### Application Layer → Engine Core Layer
**Direction**: Top-down
**Allowed**:
- Application can call Engine Core interfaces (IRenderService, IFileService)
- Application can publish events to EventBus
- Application can read Config via ConfigManager

**Forbidden**:
- Direct instantiation of concrete classes (use dependency injection)
- Accessing internal state of subsystems

### Engine Core Layer → UI Layer
**Direction**: Bottom-up via events
**Allowed**:
- Engine publishes events consumed by UI
- UI subscribes to `render.frame_end`, `file.loaded`, etc.

**Forbidden**:
- Engine Core cannot call UI methods directly
- Engine Core cannot #include UI headers
- All UI updates must be event-driven

### UI Layer → Engine Core Layer
**Direction**: Top-down via events
**Allowed**:
- UI publishes user actions as events (`ui.button_clicked`, `file.dropped`)
- Engine subscribes to UI events

**Forbidden**:
- UI cannot call Engine Core methods directly
- UI cannot #include Rendering/FileSystem headers
- Use EventTypes.h for shared data structures only

### Cross-Layer Include Rules
```cpp
// ✅ ALLOWED
#include "Core/EventBus.h"           // Any layer can include EventBus
#include "Events/EventTypes.h"       // Shared type definitions
#include "Core/Interfaces/IRenderService.h"  // Interface abstractions

// ❌ FORBIDDEN
#include "Rendering/RenderService.h"  // UI must NOT include concrete Rendering classes
#include "UI/DebugWindow.h"           // Rendering must NOT include UI classes
```

---

## Event Flow

### Frame Render Event Flow

```
Application::MainLoop()
    │
    ├─> EventBus::Publish("render.frame_start", frameData)
    │       │
    │       ├─> RenderService::BeginFrame()
    │       ├─> DebugWindow::OnFrameStart()
    │       └─> TestManager::OnFrameStart()
    │
    ├─> CameraController::Update(deltaTime)
    │       │
    │       └─> EventBus::Publish("camera.updated", cameraData)
    │               │
    │               └─> RenderService::UpdateCameraMatrices()
    │
    ├─> RenderService::Render()
    │       │
    │       └─> Vulkan draw calls
    │
    └─> EventBus::Publish("render.frame_end", frameStats)
            │
            ├─> DebugWindow::UpdateFrameStats()
            └─> PerformancePanel::UpdateDisplay()
```

### File Load Event Flow

```
User drags file onto viewport
    │
    └─> UIService::OnFileDrop()
            │
            └─> EventBus::Publish("file.dropped", fileDropData)
                    │
                    └─> FileService::LoadFiles()
                            │
                            ├─> Parse GLTF
                            ├─> Extract mesh data
                            │
                            ├─> EventBus::Publish("file.loaded", assetData)
                            │       │
                            │       ├─> RenderService::LoadAssetToGPU()
                            │       └─> FileBrowser::AddItem()
                            │
                            └─> (on error) EventBus::Publish("file.error", errorData)
                                    │
                                    ├─> DebugWindow::LogError()
                                    └─> UIService::ShowNotification()
```

### Config Change Event Flow

```
User toggles wireframe checkbox in UI
    │
    └─> UIService::OnButtonClicked()
            │
            └─> EventBus::Publish("ui.button_clicked", buttonData)
                    │
                    └─> ConfigManager::SetValue("wireframe_mode", true)
                            │
                            ├─> Save to config/render_settings.yaml
                            │
                            └─> EventBus::Publish("config.wireframe_toggle", true)
                                    │
                                    ├─> RenderService::SetWireframeMode(true)
                                    └─> DebugWindow::LogConfigChange()
```

---

## Module Inventory

### Application Layer
| File Path | Purpose | Dependencies |
|-----------|---------|--------------|
| `Source/main.cpp` | Entry point, initializes subsystems | EventBus, ConfigManager |
| `Source/Application/Application.h/cpp` | Main loop, lifecycle management | All services |
| `Source/Application/ConfigManager.h/cpp` | YAML config loading/saving | yaml-cpp |

### Engine Core Layer
| File Path | Purpose | Dependencies |
|-----------|---------|--------------|
| `Source/Core/EventBus.h/cpp` | Event publish/subscribe system | STL (thread-safe) |
| `Source/Core/Interfaces/IRenderService.h` | Rendering abstraction | None (interface) |
| `Source/Core/Interfaces/IFileService.h` | File I/O abstraction | None (interface) |
| `Source/Events/EventTypes.h` | Shared event payload structs | glm |

### Rendering Subsystem
| File Path | Purpose | Dependencies |
|-----------|---------|--------------|
| `Source/Rendering/RenderService.h/cpp` | Vulkan rendering implementation | Vulkan, IRenderService |
| `Source/Rendering/ShaderManager.h/cpp` | Shader compilation and hot reload | Vulkan, QuoteSystem |
| `Source/Rendering/MaterialManager.h/cpp` | Material property management | Vulkan |
| `Source/Rendering/CameraController.h/cpp` | Camera transform and input | glm, EventBus |

### File System Subsystem
| File Path | Purpose | Dependencies |
|-----------|---------|--------------|
| `Source/FileSystem/FileService.h/cpp` | GLTF loading, file watching | tinygltf, IFileService |
| `Source/FileSystem/ResourceManager.h/cpp` | GPU resource tracking | Vulkan |

### UI Subsystem
| File Path | Purpose | Dependencies |
|-----------|---------|--------------|
| `Source/UI/UIService.h/cpp` | ImGui initialization and input | ImGui, EventBus |
| `Source/UI/DebugWindow.h/cpp` | Multi-channel debug overlay | ImGui, EventBus |
| `Source/UI/PerformancePanel.h/cpp` | Frame stats display | ImGui, EventBus |
| `Source/UI/FileBrowser.h/cpp` | Asset list UI | ImGui, EventBus |

### Observability
| File Path | Purpose | Dependencies |
|-----------|---------|--------------|
| `Source/Core/QuoteSystem.h/cpp` | Motivational logging system | STL |
| `Source/Core/DebugWindow.h/cpp` | Real-time event tracing | EventBus |
| `Source/Core/TestManager.h/cpp` | Unit test framework | EventBus |

### Shaders
| File Path | Purpose | Dependencies |
|-----------|---------|--------------|
| `Shaders/Common/math_utils.hlsli` | Math utilities (PI, saturate, etc.) | None |
| `Shaders/Common/lighting_common.hlsli` | Lighting structs and functions | math_utils.hlsli |
| `Shaders/Vertex/standard_vs.hlsl` | Standard vertex shader | math_utils.hlsli |
| `Shaders/Fragment/unlit_ps.hlsl` | Unlit pixel shader | math_utils.hlsli |
| `Shaders/Fragment/pbr_ps.hlsl` | PBR pixel shader with IBL | math_utils, lighting_common |
| `Shaders/Fragment/debug_ps.hlsl` | Debug visualization shader | math_utils.hlsli |

---

## Design Decisions

### Why Event-Driven Architecture?

**Decision**: All subsystem communication via EventBus, no direct method calls.

**Rationale**:
- Decouples systems — UI can be replaced without touching Rendering code
- Enables runtime composition — new subsystems can be added without recompiling dependents
- Facilitates testing — mock subscribers can verify event payloads
- Improves observability — DebugWindow wildcard subscriber traces all events

**Alternatives Considered**:
- Direct method calls: Rejected due to tight coupling
- Global singletons: Rejected due to testability issues
- Observer pattern per subsystem: Rejected due to duplication (EventBus centralizes this)

### Why Reversed-Z Depth?

**Decision**: Use reversed-Z depth buffering (near=1.0, far=0.0).

**Rationale**:
- IEEE 754 floating-point has higher precision near 0.0 than 1.0
- Reversing depth puts higher precision at far plane (where Z-fighting usually occurs)
- Eliminates Z-fighting at extreme distances (1000+ units)
- Modern best practice (used by Unreal, Unity, Call of Duty)

**Tradeoffs**:
- Requires 4 coordinated changes (projection matrix, clear value, compare mode, format)
- Slightly more complex to reason about initially
- Benefits far outweigh costs for large open-world scenes

### Why No Global Mutable State?

**Decision**: All global state removed; subsystems are instance-based.

**Rationale**:
- Enables multiple engine instances in same process (e.g., editor + game)
- Simplifies unit testing (no global state to reset between tests)
- Prevents action-at-a-distance bugs
- Thread-safe by design (no shared mutable globals)

**Migration Path**:
- Shaders.h global externs → ShaderManager instance
- MaterialLibrary static map → MaterialManager instance
- Config singleton → ConfigManager instance passed via dependency injection

### Why QuoteSystem?

**Decision**: All subsystems log via QuoteSystem with motivational quotes.

**Rationale**:
- Uniform logging format across all modules
- Human-friendly log output (encourages developers to read logs)
- Built-in log categories match subsystem boundaries
- QuoteSystem serves as single point of control for log filtering

**Example**:
```cpp
QuoteSystem::Log(QuoteCategory::Rendering, "Shader compiled successfully");
// Output: [Rendering] "Clarity in code, as in life, comes from good structure." — Shader compiled successfully
```

---

## Reversed-Z Depth

### Problem Statement

Standard depth buffering uses near=0.0, far=1.0 in clip space. Due to IEEE 754 floating-point precision distribution, there are far fewer representable values near 1.0 than near 0.0. This causes Z-fighting at far distances.

**Example (32-bit float depth)**:
- 0.0 to 0.5: ~50% of all representable values
- 0.5 to 1.0: ~50% of all representable values
- But 0.9 to 1.0: only ~10% of representable values

Objects at far distances (e.g., mountains at 5000 units) compete for very few depth values, causing Z-fighting.

### Solution: Reversed-Z

Reverse the depth mapping so near=1.0, far=0.0. This places the high-precision region (near 0.0) at the far plane.

**Result**:
- Near objects (0.1 to 10 units): adequate precision at 1.0 region
- Far objects (10 to 10000 units): high precision at 0.0 region
- Eliminates Z-fighting at far distances

### Implementation (4 Coordinated Changes)

#### Change 1: Projection Matrix
```cpp
// Standard forward-Z projection (glm default)
glm::mat4 proj = glm::perspective(fov, aspect, nearPlane, farPlane);
// This maps near→0.0, far→1.0

// Reversed-Z projection (manual construction)
glm::mat4 proj = glm::mat4(1.0f);
float f = 1.0f / tan(fov / 2.0f);
proj[0][0] = f / aspect;
proj[1][1] = f;
proj[2][2] = 0.0f;              // Maps far to 0.0
proj[2][3] = -1.0f;
proj[3][2] = nearPlane;         // Maps near to 1.0
```

#### Change 2: Depth Clear Value
```cpp
// Standard depth clear
VkClearDepthStencilValue clearDepth;
clearDepth.depth = 1.0f; // Clear to far plane

// Reversed-Z depth clear
VkClearDepthStencilValue clearDepth;
clearDepth.depth = 0.0f; // Clear to far plane (reversed)
```

#### Change 3: Depth Compare Mode
```cpp
// Standard depth test
depthStencil.depthCompareOp = VK_COMPARE_OP_LESS; // Closer = smaller depth

// Reversed-Z depth test
depthStencil.depthCompareOp = VK_COMPARE_OP_GREATER; // Closer = larger depth
```

#### Change 4: Depth Buffer Format
```cpp
// Use 32-bit float format for maximum precision
VkFormat depthFormat = VK_FORMAT_D32_SFLOAT;

// NOT D24_UNORM or D16_UNORM (insufficient precision)
```

### Validation

#### Visual Test
1. Enable debug depth visualization (`debug_ps.hlsl` mode 1)
2. Move camera very close to object (< 0.1 units)
3. Expect: WHITE visualization (depth near 1.0)
4. Move camera very far from object (> 1000 units)
5. Expect: BLACK visualization (depth near 0.0)

#### Precision Test
1. Place two objects at extreme distance (5000 units)
2. Offset by small amount (0.01 units)
3. Expect: NO Z-fighting, clean depth sorting

---

## Observability Systems

### QuoteSystem

**Purpose**: Centralized logging with human-friendly format.

**Categories**:
- `QuoteCategory::Rendering` — Shader compilation, pipeline creation, draw calls
- `QuoteCategory::FileIO` — File loading, parsing, errors
- `QuoteCategory::UI` — ImGui initialization, input events
- `QuoteCategory::Camera` — Transform updates, input handling
- `QuoteCategory::EventBus` — Event throughput, queue depth
- `QuoteCategory::Performance` — Frame time, memory usage

**Usage**:
```cpp
QuoteSystem::Log(QuoteCategory::Rendering, "Vulkan initialized");
// Output: [Rendering] "Clarity in code, as in life, comes from good structure." — Vulkan initialized
```

### DebugWindow

**Purpose**: Real-time event tracing and system health monitoring.

**Features**:
- Wildcard event subscriber (logs all events)
- Per-channel status indicators (green/yellow/red)
- Historical event log (last 1000 events)
- Frame stats graph (FPS, frame time, draw calls)
- Memory usage tracking

**Channels**:
- `[Rendering]` — Pipeline status, shader compilation
- `[FileIO]` — Loaded assets, file errors
- `[UI]` — Panel visibility, button clicks
- `[Camera]` — Position, rotation
- `[EventBus]` — Event throughput, processing time
- `[Performance]` — CPU/GPU time, memory

### TestManager

**Purpose**: Unit test framework integrated with event system.

**Features**:
- Event-driven test execution
- Automatic test discovery (register via macro)
- Performance regression detection
- Test results published as events (consumed by DebugWindow)

**Usage**:
```cpp
TEST_CASE("EventBus_PublishSubscribe") {
    bool received = false;
    EventBus::Subscribe("test.event", [&](const Event& e) {
        received = true;
    });
    EventBus::Publish("test.event", nullptr);
    ASSERT(received);
}
```

---

## Thread Safety

### EventBus Thread Safety

**Implementation**: Internal `std::mutex` on subscriber map.

**Guarantees**:
- `Subscribe()` and `Publish()` are thread-safe
- Multiple threads can publish simultaneously
- Subscriber callbacks execute on caller thread (not queue, no latency)

**Constraints**:
- Subscribers MUST NOT block (offload heavy work to async tasks)
- Subscribers MUST NOT call `Subscribe()` or `Unsubscribe()` in callback (deadlock risk)

### Subsystem Thread Safety

| Subsystem | Thread Model | Synchronization |
|-----------|--------------|------------------|
| RenderService | Single-threaded (render thread) | None needed |
| FileService | Multi-threaded (worker pool) | `std::mutex` on resource map |
| UIService | Single-threaded (main thread) | None needed |
| CameraController | Single-threaded (main thread) | None needed |
| DebugWindow | Multi-threaded (readers + writer) | `std::mutex` on event log |

### Atomic Counters

- Frame counter: `std::atomic<uint64_t>`
- Event counter: `std::atomic<uint64_t>`
- Resource allocation counter: `std::atomic<size_t>`

---

## Extension Points

### Adding a New Subsystem

1. **Define Interface** (if abstraction needed)
   ```cpp
   // Source/Core/Interfaces/IMyService.h
   class IMyService {
   public:
       virtual ~IMyService() = default;
       virtual void DoWork() = 0;
   };
   ```

2. **Implement Concrete Class**
   ```cpp
   // Source/MySubsystem/MyService.h
   class MyService : public IMyService {
   public:
       MyService(EventBus* eventBus);
       void DoWork() override;
   private:
       void RegisterEventHandlers();
   };
   ```

3. **Register Event Handlers**
   ```cpp
   void MyService::RegisterEventHandlers() {
       eventBus->Subscribe("application.init", [this](const Event& e) {
           Initialize();
           QuoteSystem::Log(QuoteCategory::MyService, "Initialized");
       });
   }
   ```

4. **Add DebugWindow Channel**
   ```cpp
   debugWindow->RegisterChannel("MyService", DebugWindow::ColorGreen);
   ```

5. **Add QuoteSystem Category**
   ```cpp
   enum class QuoteCategory {
       // ... existing categories
       MyService
   };
   ```

6. **Write Unit Tests**
   ```cpp
   TEST_CASE("MyService_DoWork") {
       MyService service(&eventBus);
       service.DoWork();
       ASSERT(service.GetState() == Expected);
   }
   ```

### Adding a New Event

1. **Define Payload Struct** (if needed)
   ```cpp
   // Events/EventTypes.h
   struct MyEventData {
       std::string message;
       int value;
   };
   ```

2. **Publish Event**
   ```cpp
   MyEventData data { "Hello", 42 };
   EventBus::Publish("my.event", &data);
   ```

3. **Subscribe to Event**
   ```cpp
   EventBus::Subscribe("my.event", [](const Event& e) {
       auto* data = e.GetPayload<MyEventData>();
       DoSomething(data->message, data->value);
   });
   ```

4. **Document in Wiring Manifest**
   - Add row to event flow table
   - Document payload type
   - List all producers and consumers

---

**End of Architecture Documentation**
