# Validation Checklist — BrightForge Phase 5 Integration

**Author:** Marcus Daley
**Date:** April 2026
**Purpose:** Comprehensive validation criteria for production-ready system integration

---

## Architecture Validation

### Event-Driven Architecture
- [ ] All subsystem communication uses EventBus exclusively
- [ ] No direct method calls between RenderService and CameraController
- [ ] No direct method calls between FileService and UIService
- [ ] No polling loops (all state changes publish events)
- [ ] All event handlers are non-blocking (async work offloaded)
- [ ] EventBus::Publish() called with proper payload types
- [ ] EventBus::Subscribe() lambdas capture `this` safely
- [ ] Wildcard subscriber in DebugWindow for event tracing
- [ ] Event payload structs defined in Events/EventTypes.h
- [ ] No circular event dependencies (A→B→A loops)

### Global State Elimination
- [ ] Shaders.h global externs removed completely
- [ ] ShaderManager is instance-based (not static)
- [ ] MaterialManager is instance-based (not static)
- [ ] No global mutable state in any subsystem
- [ ] All singletons use getInstance() pattern with explicit initialization
- [ ] Thread-local storage used where thread-specific state needed
- [ ] Const globals allowed (PI, VERSION, etc.)

### Layer Boundaries
- [ ] UI files do NOT #include Engine/Rendering/*.h
- [ ] Rendering files do NOT #include UI/*.h
- [ ] Shared types in Events/EventTypes.h or Core/Types.h only
- [ ] Forward declarations used to minimize coupling
- [ ] Interface abstractions (IRenderService) defined in Core/
- [ ] Implementation details private to subsystem folders
- [ ] No circular #include dependencies (check with dependency graph)

### Modularity
- [ ] IRenderService abstraction defined in Core/Interfaces/IRenderService.h
- [ ] RenderService implements IRenderService
- [ ] Application depends on IRenderService interface, not concrete class
- [ ] Mock implementations exist for unit testing (MockRenderService)
- [ ] Dependency injection used in constructors (no global lookups)
- [ ] Each subsystem can be tested in isolation
- [ ] Subsystems can be replaced without recompiling dependents

---

## Code Quality

### No Placeholders
- [ ] All functions have complete implementations (no `// TODO` stubs)
- [ ] All shader files compile without errors
- [ ] All classes have proper constructors and destructors
- [ ] All virtual functions overridden where required
- [ ] All switch statements have default cases
- [ ] All error paths handled (no unchecked returns)
- [ ] All memory allocations have corresponding deallocations
- [ ] All file operations check return codes

### Production-Ready Standards
- [ ] All public APIs have documentation comments
- [ ] All functions under 100 lines (refactor if longer)
- [ ] All classes under 500 lines (split if longer)
- [ ] All magic numbers replaced with named constants
- [ ] All string literals in Config/strings.yaml (i18n-ready)
- [ ] All file paths use cross-platform utilities (std::filesystem)
- [ ] All platform-specific code in #ifdef blocks
- [ ] All warnings-as-errors enabled (/WX on MSVC)

---

## Reversed-Z Depth Implementation

### Coordinate 1: Projection Matrix
- [ ] Near plane maps to NDC z = 1.0
- [ ] Far plane maps to NDC z = 0.0
- [ ] Projection matrix builds in Camera/CameraController.cpp
- [ ] Verified with unit test (Test_ReversedZ_ProjectionMatrix)
- [ ] Near/far values NOT swapped in glm::perspective call
- [ ] Manual matrix construction if glm doesn't support reversed-Z

### Coordinate 2: Depth Clear Value
- [ ] VkClearDepthStencilValue::depth = 0.0f (not 1.0f)
- [ ] vkCmdClearDepthStencilImage uses 0.0f
- [ ] Depth attachment clear operation in RenderService::BeginFrame()
- [ ] Verified in DebugWindow depth visualization (far objects = black)

### Coordinate 3: Depth Compare Mode
- [ ] VkPipelineDepthStencilStateCreateInfo::depthCompareOp = VK_COMPARE_OP_GREATER
- [ ] NOT VK_COMPARE_OP_LESS (standard forward-Z)
- [ ] Applied in RenderService::CreateGraphicsPipeline()
- [ ] Verified with depth test (close objects pass, far objects fail correctly)

### Coordinate 4: Depth Buffer Format
- [ ] VkFormat = VK_FORMAT_D32_SFLOAT (32-bit float depth)
- [ ] NOT D24_UNORM or D16_UNORM (insufficient precision at far distances)
- [ ] Verified in RenderService::CreateDepthResources()
- [ ] Image view created with correct format

### Integration Verification
- [ ] All 4 coordinates implemented consistently
- [ ] No Z-fighting at extreme close distances (<0.01 units)
- [ ] Depth precision maintained at far distances (>1000 units)
- [ ] Debug depth visualization shows reversed gradient (white=near, black=far)
- [ ] QuoteSystem logs confirm reversed-Z enabled at startup

---

## Logging and Observability

### QuoteSystem Integration
- [ ] QuoteSystem::Log() on subsystem initialization
- [ ] QuoteSystem::Log() on file load success/failure
- [ ] QuoteSystem::Log() on shader compilation success/failure
- [ ] QuoteSystem::Log() on pipeline creation
- [ ] QuoteSystem::Log() on resource allocation/deallocation
- [ ] QuoteSystem::Log() on config changes
- [ ] QuoteSystem::Log() on shutdown sequence
- [ ] Proper category used (Rendering, FileIO, UI, Camera)
- [ ] No log spam (max 10 logs per second per category)

### DebugWindow Channels
- [ ] "Rendering" channel registered (green status on init)
- [ ] "FileIO" channel registered (green status on init)
- [ ] "UI" channel registered (green status on init)
- [ ] "Camera" channel registered (green status on init)
- [ ] "EventBus" channel registered (shows event throughput)
- [ ] "Performance" channel registered (shows frame stats)
- [ ] Each channel updates on relevant events
- [ ] Color coding: green=healthy, yellow=warning, red=error
- [ ] Historical data retained (last 1000 entries per channel)

---

## Testing Infrastructure

### TestManager Coverage
- [ ] Test_EventBus_PublishSubscribe()
- [ ] Test_EventBus_WildcardSubscriber()
- [ ] Test_CameraController_ViewMatrix()
- [ ] Test_CameraController_Input()
- [ ] Test_FileService_LoadGLTF()
- [ ] Test_FileService_InvalidPath()
- [ ] Test_RenderService_ShaderCompilation()
- [ ] Test_RenderService_PipelineCreation()
- [ ] Test_ReversedZ_ProjectionMatrix()
- [ ] Test_ReversedZ_DepthTest()
- [ ] Test_ConfigManager_Persistence()
- [ ] Test_MemoryLeaks_StressTest()

### Test Execution
- [ ] All tests pass in Debug build
- [ ] All tests pass in Release build
- [ ] Tests run on CI/CD pipeline
- [ ] Test coverage report generated (>80% target)
- [ ] Performance tests have baseline metrics
- [ ] Memory leak tests use Valgrind/Dr. Memory

---

## Configuration System

### Config-Driven Rendering
- [ ] No hardcoded clear color (read from config/render_settings.yaml)
- [ ] No hardcoded FOV (read from config/camera_settings.yaml)
- [ ] No hardcoded resolution (read from config/window_settings.yaml)
- [ ] No hardcoded shader paths (read from config/shader_manifest.yaml)
- [ ] Wireframe mode toggle via config (not recompile)
- [ ] Debug visualization modes via config
- [ ] MSAA sample count via config
- [ ] Anisotropy level via config

### Config Persistence
- [ ] Changes to config persist to disk immediately
- [ ] Config reloaded on application restart
- [ ] Invalid config values rejected with warning
- [ ] Default config loaded if file missing
- [ ] Config schema validated on load (YAML schema)
- [ ] Config changes publish `config.changed` event

---

## Thread Safety

### Mutex Protection
- [ ] EventBus::eventSubscribers protected by std::mutex
- [ ] DebugWindow::eventLog protected by std::mutex
- [ ] ResourceManager::resources protected by std::mutex
- [ ] FileService::loadQueue protected by std::mutex
- [ ] No data races detected by ThreadSanitizer
- [ ] No deadlocks in shutdown sequence

### Atomic Operations
- [ ] Frame counter uses std::atomic<uint64_t>
- [ ] Event counter uses std::atomic<uint64_t>
- [ ] Resource allocation counter uses std::atomic<size_t>

### Thread Communication
- [ ] Render thread only publishes events (no blocking calls)
- [ ] File loading happens on worker thread
- [ ] EventBus dispatch happens on caller thread (no queue delay)

---

## Resource Management

### Cleanup Order
- [ ] Shutdown sequence in reverse of initialization:
  1. UI shutdown
  2. Rendering shutdown (pipelines, shaders, buffers)
  3. Vulkan device destroyed
  4. File system shutdown
  5. EventBus shutdown
- [ ] All resources freed before Vulkan device destruction
- [ ] No dangling pointers after shutdown
- [ ] Destructor order validated in unit tests

### Memory Tracking
- [ ] All `new` has corresponding `delete`
- [ ] All `malloc` has corresponding `free`
- [ ] All Vulkan allocations have vkFree* calls
- [ ] ResourceManager tracks allocation count
- [ ] DebugWindow shows current memory usage
- [ ] Memory leak detection enabled in Debug builds

---

## Performance Requirements

### Frame Time
- [ ] 60 FPS target (16.67ms frame budget)
- [ ] Frame time breakdown logged:
  - CPU time: <10ms
  - GPU time: <15ms
  - EventBus overhead: <0.5ms
- [ ] No frame spikes >33ms (visual stutter threshold)

### Asset Loading
- [ ] GLTF files load within 2 seconds (up to 1MB)
- [ ] Batch loading doesn't block rendering thread
- [ ] Progress reported via events during load
- [ ] Large files (>10MB) show loading UI

### Memory Budget
- [ ] Base application: <100MB
- [ ] Per loaded asset: <10MB overhead
- [ ] 10 assets loaded: <200MB total
- [ ] No memory growth during runtime (leak-free)

---

## Shader System

### Shader Compilation
- [ ] All shaders compile without errors
- [ ] All shaders compile without warnings
- [ ] Shader compiler errors shown in DebugWindow
- [ ] Invalid shaders don't crash application
- [ ] Fallback shader used if compilation fails

### Shader Files Validated
- [ ] `Shaders/Common/math_utils.hlsli` exists and compiles
- [ ] `Shaders/Common/lighting_common.hlsli` exists and compiles
- [ ] `Shaders/Vertex/standard_vs.hlsl` exists and compiles
- [ ] `Shaders/Fragment/unlit_ps.hlsl` exists and compiles
- [ ] `Shaders/Fragment/pbr_ps.hlsl` exists and compiles
- [ ] `Shaders/Fragment/debug_ps.hlsl` exists and compiles
- [ ] All #include directives resolve correctly
- [ ] All shader entry points named correctly (VSMain, PSMain)

### Hot Reload
- [ ] F5 key triggers shader reload
- [ ] Shader recompilation happens without restart
- [ ] Old shader remains active if new compilation fails
- [ ] Recompilation time <1 second
- [ ] Visual update applies immediately after compile

---

## Documentation

### Architecture Documentation
- [ ] `docs/architecture.md` exists and is complete
- [ ] System diagram included (ASCII or image)
- [ ] Layer boundaries explained
- [ ] Event flow diagrams included
- [ ] Module inventory with file paths
- [ ] Design decisions documented with rationale

### Developer Onboarding
- [ ] `docs/getting_started.md` exists and is complete
- [ ] Prerequisites listed with versions
- [ ] Build instructions step-by-step
- [ ] Project structure explained
- [ ] How to add subsystem documented
- [ ] Coding standards referenced

### Integration Documentation
- [ ] `integration/wiring_manifest.md` exists and is complete
- [ ] `integration/smoke_tests.md` exists and is complete
- [ ] `integration/validation_checklist.md` exists (this file)
- [ ] `integration/performance_notes.md` exists and is complete

---

## Final Checks

### Build System
- [ ] Solution builds in Debug configuration
- [ ] Solution builds in Release configuration
- [ ] No linker warnings
- [ ] No compiler warnings
- [ ] Build time <2 minutes for full rebuild

### Version Control
- [ ] All new files committed to git
- [ ] `.gitignore` excludes build artifacts
- [ ] `.gitignore` excludes user settings
- [ ] No binary files in repository (except assets)
- [ ] Commit messages follow convention

### Deployment
- [ ] Installer packages application
- [ ] Required DLLs included (Vulkan, GLFW)
- [ ] Config files included in install
- [ ] Test assets included in install
- [ ] README.md explains installation

---

## Acceptance Criteria Summary

All items in this checklist must be ✅ before Phase 5 is considered complete.

Priority levels:
- **P0 (Critical)**: Architecture, Reversed-Z, No Placeholders
- **P1 (High)**: Logging, Testing, Thread Safety
- **P2 (Medium)**: Performance, Documentation
- **P3 (Low)**: Deployment, Version Control

---

**End of Validation Checklist**
