# BrightForge Improvement Roadmap
**Developer:** Marcus Daley
**Date:** 2026-04-14
**Purpose:** Prioritized refactoring and feature roadmap with dependency graph, risk assessment, and milestone tracking

---

## Executive Summary

**Total Phases:** 6 major phases over ~12 weeks
**Estimated Effort:** 420 hours (10.5 work-weeks at 40 hrs/week)
**Risk Level:** MEDIUM (core refactors are high-impact but well-understood)
**Success Criteria:** Vulkan renderer running alongside software rasterizer with 60% code reuse

**Critical Path:** Phase 1 (Decouple) → Phase 2 (UI) → Phase 3 (Vulkan Stub) → Phase 4 (Vulkan Rendering) → Phase 5 (Integration)

---

## Phase 1: Decouple Core Systems (3 weeks, 120 hours)

**Goal:** Eliminate global state, enable unit testing, prepare for Vulkan integration

**Risk:** HIGH (core refactor, touches 80% of codebase)
**Reward:** HIGH (unlocks all future work)

### Week 1: Global State Elimination

#### Task 1.1: Create RenderContext Struct (8 hours)

**File:** `src/core/RenderContext.h` (NEW)

**Implementation:**
```cpp
struct LightingParams {
    float ambientIntensity = 0.2f;

    bool useDirectional = false;
    Vector4 directionalDir;
    unsigned int directionalColor;

    bool usePoint = false;
    Vector4 pointPos;
    unsigned int pointColor;
    float pointRadius = 1.0f;
};

struct RenderContext {
    Matrix4x4 world;
    Matrix4x4 view;
    Matrix4x4 projection;

    LightingParams lighting;

    bool isCube = false;

    VertexShaderFunc vertexShader = nullptr;
    PixelShaderFunc pixelShader = nullptr;
};
```

**Changes:**
- Remove all global variables from Shaders.h/cpp (15 variables → 0)
- Update all shader functions to take `const RenderContext&` parameter
- Update Renderer to own `RenderContext mContext` member

**Files Modified:**
- Shaders.h (remove 15 extern declarations)
- Shaders.cpp (remove 15 global definitions, update 4 shader functions)
- Renderer.h (add mContext member, update renderMesh)
- LineDrawing.h (update draw3DLine, draw3DTriangle to take context param)
- TestManager.h (update all 5 places that write to global state)

**Testing:**
- Verify software rasterizer still renders cube/grid/stars
- Compare screenshots before/after (pixel-perfect match required)

**Risk Mitigation:**
- Create git branch `refactor/render-context`
- Commit after each file modification
- Keep old global state for 1 week (deprecated, but fallback available)

---

#### Task 1.2: Split TestManager God Object (16 hours)

**Files:**
- `src/ui/UIController.h/cpp` (NEW) — keyboard input, menu display
- `src/scene/LightingManager.h/cpp` (NEW) — lighting config
- `src/scene/SceneManager.h/cpp` (NEW) — mesh generation, star field
- `src/scene/CameraController.h/cpp` (NEW) — camera orbit/zoom
- `src/test/Assignment4Orchestrator.h/cpp` (NEW) — stage progression

**Refactor Strategy:**
1. Extract UIController first (120 lines) — lowest risk
2. Extract LightingManager (250 lines) — uses new RenderContext
3. Extract CameraController (80 lines) — simple state machine
4. Extract SceneManager (350 lines) — mesh/star generation
5. Reduce TestManager to 139 lines (orchestration only)

**Dependencies:**
- UIController → none
- LightingManager → RenderContext (Task 1.1)
- CameraController → Camera
- SceneManager → Mesh, Renderer
- Assignment4Orchestrator → all above

**Testing:**
- Each extracted class gets 10+ unit tests
- Integration test: Assignment4Orchestrator reproduces original behavior

**Risk Mitigation:**
- Extract one class per day
- Keep original TestManager.h for comparison
- Add `#define USE_LEGACY_TEST_MANAGER` toggle

---

#### Task 1.3: Dependency Injection for Renderer (8 hours)

**Changes:**
- Renderer no longer owns Camera (pointer instead of unique_ptr)
- Renderer constructor takes GraphicsHelper&, Camera* (injected)
- Remove global objects from main.cpp

**Before:**
```cpp
// main.cpp (GLOBAL)
GraphicsHelper graphics;
Renderer renderer(graphics);  // Renderer creates its own Camera
TestManager testManager(graphics);
```

**After:**
```cpp
// main.cpp (LOCAL)
int main() {
    GraphicsHelper graphics(600, 500);
    Camera camera;
    Renderer renderer(graphics, &camera);
    CameraController cameraController(camera);
    LightingManager lightingManager;
    UIController ui;
    Assignment4Orchestrator orchestrator(renderer, cameraController, lightingManager, ui);

    while (RS_Update(graphics.getPixels(), 600 * 500)) {
        orchestrator.update();
        orchestrator.render();
    }
    return 0;
}
```

**Benefits:**
- Can create multiple renderers (e.g., render-to-texture)
- Can mock Camera for unit tests
- Clear ownership (orchestrator owns components)

**Risk:** LOW (simple refactor, no logic changes)

---

#### Task 1.4: Parameterize Hardcoded Constants (16 hours)

**GraphicsHelper:**
- Remove hardcoded width/height from constructor
- Add `GraphicsHelper(unsigned int width, unsigned int height)` constructor
- Add `resize(unsigned int newWidth, unsigned int newHeight)` method

**Camera:**
- Add `CameraSettings` struct (height, distance, viewAngle, moveSpeed, rotationSpeed, min/max limits)
- Camera constructor takes `const CameraSettings&`

**Renderer:**
- Add `ProjectionSettings` struct (fovDegrees, nearPlane, farPlane)
- Add `setProjectionSettings(const ProjectionSettings&)` method

**Mesh:**
- `createCube(float size, unsigned int color = 0xFFFFFFFF)` — add color param
- `createGrid(float size, unsigned int divisions, unsigned int color = 0xFFFFFFFF)`

**Constrants.h → Settings.h:**
- Rename file
- Convert `constexpr` to default struct values
- Example:
  ```cpp
  struct WindowSettings {
      unsigned int width = 600;
      unsigned int height = 500;
  };

  struct CameraDefaults {
      float height = 2.0f;
      float distance = 5.0f;
      float viewAngle = -15.0f * (3.14159f / 180.0f);
  };
  ```

**Files Modified:** 8 files (GraphicsHelper.hpp, Camera.h, Renderer.h, mesh.h, Constrants.h→Settings.h, main.cpp)

**Testing:**
- Test window resize (create 800×600, resize to 1024×768, verify no crash)
- Test camera limits (min/max clamping)
- Test projection (verify FOV changes affect rendering)

**Risk:** MEDIUM (changes constructor signatures, may break downstream code)

---

#### Task 1.5: Cross-Platform Input (Replace _kbhit) (8 hours)

**Option A: SDL2 Integration**

**Add Dependency:**
```cmake
find_package(SDL2 REQUIRED)
target_link_libraries(BrightForge SDL2::SDL2)
```

**Replace RasterSurface:**
```cpp
// src/platform/SDLWindow.h (NEW)
class SDLWindow {
    SDL_Window* mWindow;
    SDL_Renderer* mRenderer;
    SDL_Texture* mTexture;

public:
    bool initialize(const char* title, unsigned int width, unsigned int height);
    bool update(unsigned int* pixels, unsigned int pixelCount);
    void shutdown();

    SDL_Event pollEvent();  // Returns keyboard/mouse events
};
```

**Update main.cpp:**
```cpp
SDLWindow window;
window.initialize("BrightForge", 600, 500);

while (window.update(graphics.getPixels(), 600 * 500)) {
    SDL_Event event;
    while (window.pollEvent(event)) {
        if (event.type == SDL_KEYDOWN) {
            ui.handleKeyDown(event.key.keysym.sym);
        }
    }
    orchestrator.update();
    orchestrator.render();
}
```

**Files Modified:**
- Remove: TestManager.h lines 2, 122-123 (`<conio.h>`, `_kbhit()`, `_getch()`)
- Add: src/platform/SDLWindow.h/cpp (NEW, 150 lines)
- Update: main.cpp (replace RasterSurface with SDLWindow)
- Update: UIController.h/cpp (replace switch(char) with switch(SDL_Keycode))

**Testing:**
- Compile on Windows, Linux, macOS
- Verify keyboard input works on all platforms

**Risk:** MEDIUM (new dependency, requires testing on multiple platforms)

**Fallback:** If SDL2 causes issues, use GLFW instead (same API pattern)

---

### Week 1 Deliverables

- [x] RenderContext struct replaces 15 global variables
- [x] Shaders are pure functions (take context parameter)
- [x] TestManager split into 5 focused classes
- [x] Renderer uses dependency injection
- [x] All hardcoded constants moved to settings structs
- [x] Cross-platform input via SDL2

**Acceptance Criteria:**
- Zero global variables in Shaders.h/cpp
- Unit tests for 5 new classes (50+ tests total)
- Software rasterizer still renders correctly (pixel-perfect match)
- Compiles on Windows + Linux

**Risk Assessment:** HIGH effort, HIGH reward. Critical path item.

---

### Week 2: Enable Unit Testing (40 hours)

#### Task 1.6: Set Up Unit Test Framework (4 hours)

**Add Google Test:**
```cmake
# CMakeLists.txt
include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG v1.14.0
)
FetchContent_MakeAvailable(googletest)

enable_testing()
add_subdirectory(tests)
```

**Test Structure:**
```
tests/
├── math/
│   ├── test_vector4.cpp
│   ├── test_matrix4x4.cpp
│   └── test_mathutils.cpp
├── core/
│   ├── test_render_context.cpp
│   └── test_shaders.cpp
├── scene/
│   ├── test_camera.cpp
│   ├── test_mesh.cpp
│   └── test_lighting_manager.cpp
└── CMakeLists.txt
```

**First Test (Example):**
```cpp
// tests/math/test_vector4.cpp
#include <gtest/gtest.h>
#include "Types.h"

TEST(Vector4Test, DefaultConstructor) {
    Vector4 v;
    EXPECT_FLOAT_EQ(v.x, 0.0f);
    EXPECT_FLOAT_EQ(v.y, 0.0f);
    EXPECT_FLOAT_EQ(v.z, 0.0f);
    EXPECT_FLOAT_EQ(v.w, 1.0f);
}

TEST(Vector4Test, Addition) {
    Vector4 a(1.0f, 2.0f, 3.0f, 1.0f);
    Vector4 b(4.0f, 5.0f, 6.0f, 1.0f);
    Vector4 result = a + b;
    EXPECT_FLOAT_EQ(result.x, 5.0f);
    EXPECT_FLOAT_EQ(result.y, 7.0f);
    EXPECT_FLOAT_EQ(result.z, 9.0f);
}
```

**Goal:** 80% code coverage for math/core modules

**Files Created:** 15 test files (~2000 lines of test code)

**Risk:** LOW (tests don't affect production code)

---

#### Task 1.7: Write Core Unit Tests (36 hours)

**Test Coverage Targets:**

| Module | Tests | Coverage |
|--------|-------|----------|
| Vector4 | 15 tests | 100% |
| Matrix4x4 | 30 tests | 100% |
| MathUtils | 20 tests | 100% |
| RenderContext | 10 tests | 100% |
| Shaders (pure functions) | 25 tests | 90% |
| Camera | 20 tests | 85% |
| Mesh | 15 tests | 80% |
| LightingManager | 15 tests | 80% |
| CameraController | 10 tests | 80% |
| **TOTAL** | **160 tests** | **~90%** |

**High-Value Tests:**

1. **Matrix4x4 Multiplication** (catches common bugs)
   ```cpp
   TEST(Matrix4x4Test, MultiplicationIdentity) {
       Matrix4x4 m = Matrix4x4::translation(Vector4(1, 2, 3));
       Matrix4x4 identity = Matrix4x4::identity();
       Matrix4x4 result = m * identity;
       EXPECT_MATRIX_EQ(result, m);  // Custom matcher
   }
   ```

2. **Shader Lighting Calculations** (ensures correct math)
   ```cpp
   TEST(ShadersTest, DirectionalLightPerpendicular) {
       RenderContext ctx;
       ctx.lighting.useDirectional = true;
       ctx.lighting.directionalDir = Vector4(0, -1, 0, 0);  // Downward
       ctx.lighting.directionalColor = 0xFFFFFFFF;

       Vertex v;
       v.position = Vector4(0, 0, 0, 1);
       v.normal = Vector4(0, 1, 0, 0);  // Upward (perpendicular to light)
       v.color = 0xFFFFFFFF;

       vsLighting(v, ctx);

       // Expect minimal lighting (dot product ~ 0)
       EXPECT_NEAR(getColorIntensity(v.color), 0.0f, 0.1f);
   }
   ```

3. **Camera View Matrix** (critical for rendering)
   ```cpp
   TEST(CameraTest, LookAtOrigin) {
       CameraSettings settings{2.0f, 5.0f, 0.0f};
       Camera camera(settings);
       camera.updateCameraMatrix(0.0f);  // Angle 0 (looking from -Z axis)

       Vector4 worldOrigin(0, 0, 0, 1);
       Vector4 viewPos = camera.getViewMatrix().transformVector(worldOrigin);

       // Origin should be 5 units in front of camera (negative Z in view space)
       EXPECT_FLOAT_EQ(viewPos.z, -5.0f);
   }
   ```

**Testing Strategy:**
- Start with math (Vector4, Matrix4x4) — 100% pure, easy to test
- Move to rendering (shaders, camera) — need RenderContext setup
- End with scene (mesh, lighting) — higher-level integration tests

**Continuous Integration:**
```yaml
# .github/workflows/tests.yml
name: Unit Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v3
      - name: Build
        run: cmake -B build && cmake --build build
      - name: Test
        run: cd build && ctest --output-on-failure
```

**Risk:** LOW (pure testing, doesn't break production)

---

### Week 2 Deliverables

- [x] Google Test framework integrated
- [x] 160+ unit tests written
- [x] 90% code coverage for core modules
- [x] CI pipeline runs tests on every commit

**Acceptance Criteria:**
- All tests pass on Windows, Linux, macOS
- Code coverage report shows 90%+ for math/core
- No regressions detected

---

### Week 3: Refine & Document (40 hours)

#### Task 1.8: Extract Reusable Libraries (16 hours)

**BFMath Library:**
```
libs/bfmath/
├── include/
│   ├── bfmath/Vector4.h
│   ├── bfmath/Matrix4x4.h
│   ├── bfmath/MathUtils.h
│   └── bfmath/ColorUtils.h
├── src/
│   └── (header-only, no .cpp)
├── tests/
│   └── test_bfmath.cpp
└── CMakeLists.txt
```

**BFRaster Library:**
```
libs/bfraster/
├── include/
│   ├── bfraster/RasterAlgorithms.h
│   ├── bfraster/Framebuffer.h
│   └── bfraster/DepthBuffer.h
├── src/
│   ├── RasterAlgorithms.cpp
│   ├── Framebuffer.cpp
│   └── DepthBuffer.cpp
├── tests/
│   └── test_bfraster.cpp
└── CMakeLists.txt
```

**BFScene Library:**
```
libs/bfscene/
├── include/
│   ├── bfscene/Mesh.h
│   ├── bfscene/Camera.h
│   └── bfscene/Transform.h
├── src/
│   ├── Mesh.cpp
│   ├── Camera.cpp
│   └── Transform.cpp
├── tests/
│   └── test_bfscene.cpp
└── CMakeLists.txt
```

**Top-Level CMake:**
```cmake
# CMakeLists.txt
add_subdirectory(libs/bfmath)
add_subdirectory(libs/bfraster)
add_subdirectory(libs/bfscene)

add_executable(BrightForge src/main.cpp)
target_link_libraries(BrightForge bfmath bfraster bfscene)
```

**Benefits:**
- Libraries can be reused in other projects
- Clear dependency graph (bfraster depends on bfmath, bfscene depends on bfmath)
- Easier to distribute (header-only bfmath can be dropped into any project)

**Risk:** LOW (code organization, doesn't change logic)

---

#### Task 1.9: API Documentation (12 hours)

**Add Doxygen:**
```cmake
find_package(Doxygen)
if(DOXYGEN_FOUND)
    set(DOXYGEN_GENERATE_HTML YES)
    set(DOXYGEN_GENERATE_MAN NO)
    doxygen_add_docs(docs
        ${PROJECT_SOURCE_DIR}/libs
        ${PROJECT_SOURCE_DIR}/src
        COMMENT "Generate API documentation")
endif()
```

**Document All Public APIs:**
```cpp
/**
 * @brief Transforms a vector by this matrix
 * @param v The vector to transform (4D homogeneous coordinates)
 * @return Transformed vector
 *
 * Performs the matrix-vector multiplication: result = M * v
 * This is used for vertex transformations in the rendering pipeline.
 *
 * @code
 * Matrix4x4 translation = Matrix4x4::translation(Vector4(1, 2, 3));
 * Vector4 v(0, 0, 0, 1);
 * Vector4 result = translation.transformVector(v);  // (1, 2, 3, 1)
 * @endcode
 */
Vector4 transformVector(const Vector4& v) const;
```

**Documentation Targets:**
- All public classes (30 classes)
- All public methods (150+ methods)
- Code examples for complex APIs (camera, lighting, shaders)

**Output:** HTML documentation at `build/docs/html/index.html`

**Risk:** NONE (documentation doesn't affect code)

---

#### Task 1.10: Performance Profiling (12 hours)

**Add Tracy Profiler:**
```cpp
// src/core/Profiler.h
#include <tracy/Tracy.hpp>

#define PROFILE_SCOPE(name) ZoneScoped; ZoneName(name, strlen(name))
#define PROFILE_FUNCTION() ZoneScoped

// Usage
void Renderer::renderMesh(...) {
    PROFILE_FUNCTION();

    {
        PROFILE_SCOPE("Vertex Transformation");
        for (auto& vertex : vertices) {
            vsWorldViewTransform(vertex, mContext);
        }
    }

    {
        PROFILE_SCOPE("Rasterization");
        lineDrawing.drawTriangle(...);
    }
}
```

**Profiling Targets:**
1. **Frame time breakdown:**
   - Input handling: X ms
   - Update logic: X ms
   - Rendering: X ms
   - Blit to screen: X ms

2. **Rendering breakdown:**
   - Vertex transformation: X ms
   - Projection: X ms
   - Rasterization: X ms
   - Depth testing: X ms

3. **Identify bottlenecks:**
   - Is star field rendering the bottleneck? (3000 vertices)
   - Is triangle rasterization slow? (barycentric test per pixel)
   - Is depth buffer access cache-inefficient?

**Optimization Opportunities:**
- If vertex transformation is slow → SIMD vectorization
- If rasterization is slow → tile-based rendering
- If depth test is slow → reverse-Z or hierarchical Z-buffer

**Risk:** LOW (profiling doesn't change logic, only adds instrumentation)

---

### Week 3 Deliverables

- [x] BFMath, BFRaster, BFScene extracted as libraries
- [x] Full API documentation (Doxygen)
- [x] Performance profiling integrated (Tracy)
- [x] Baseline performance metrics captured

**Acceptance Criteria:**
- Libraries compile standalone (can be used in other projects)
- Documentation builds without errors
- Profiler shows frame breakdown

---

## Phase 1 Summary

**Duration:** 3 weeks (120 hours)
**Outcome:** Decoupled, tested, documented codebase ready for Vulkan integration

**Before Phase 1:**
- 15 global variables
- 0 unit tests
- 0% code reuse potential
- Windows-only

**After Phase 1:**
- 0 global variables
- 160+ unit tests (90% coverage)
- 80% code reuse (3 standalone libraries)
- Cross-platform (Windows, Linux, macOS)

**Risk Mitigation:**
- All changes backward-compatible (keep old code for 1 week)
- Git branches for each task (easy rollback)
- Continuous testing (every commit runs tests)
- Incremental approach (one task per day)

---

## Phase 2: UI Framework Integration (2 weeks, 80 hours)

**Goal:** Replace console UI with ImGui, add viewport panels, enable mouse input

**Risk:** MEDIUM (new dependency, major UX change)
**Reward:** HIGH (unlocks 3D editor features)

### Week 4: ImGui Integration (40 hours)

#### Task 2.1: Add ImGui Dependency (4 hours)

**CMake:**
```cmake
FetchContent_Declare(
    imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG v1.90.1-docking
)
FetchContent_MakeAvailable(imgui)

add_library(imgui
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_sdl2.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_sdlrenderer2.cpp
)
target_link_libraries(BrightForge imgui SDL2::SDL2)
```

**Initialize in main.cpp:**
```cpp
IMGUI_CHECKVERSION();
ImGui::CreateContext();
ImGuiIO& io = ImGui::GetIO();
io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;  // Enable docking

ImGui_ImplSDL2_InitForSDLRenderer(window.getSDLWindow(), window.getSDLRenderer());
ImGui_ImplSDLRenderer2_Init(window.getSDLRenderer());
```

**Render Loop:**
```cpp
while (window.update(graphics.getPixels(), 600 * 500)) {
    // Handle events
    SDL_Event event;
    while (window.pollEvent(event)) {
        ImGui_ImplSDL2_ProcessEvent(&event);
        // ...
    }

    // Start ImGui frame
    ImGui_ImplSDLRenderer2_NewFrame();
    ImGui_ImplSDL2_NewFrame();
    ImGui::NewFrame();

    // Draw UI
    ui.render();  // ImGui windows

    // Render scene
    orchestrator.render();

    // Render ImGui
    ImGui::Render();
    ImGui_ImplSDLRenderer2_RenderDrawData(ImGui::GetDrawData());
}
```

**Risk:** LOW (well-documented integration)

---

#### Task 2.2: Create Dockable Workspace (12 hours)

**Panels:**
1. **Viewport** — 3D scene rendering (main panel)
2. **Scene Hierarchy** — Tree view of objects
3. **Properties** — Transform, lighting, material editing
4. **Console** — Log output
5. **Stats** — FPS, triangle count, memory usage

**Layout Code:**
```cpp
// src/ui/EditorUI.cpp
void EditorUI::render() {
    ImGuiViewport* viewport = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(viewport->Pos);
    ImGui::SetNextWindowSize(viewport->Size);
    ImGui::SetNextWindowViewport(viewport->ID);

    ImGuiWindowFlags windowFlags = ImGuiWindowFlags_MenuBar | ImGuiWindowFlags_NoDocking;
    ImGui::Begin("DockSpace", nullptr, windowFlags);

    ImGuiID dockspaceId = ImGui::GetID("MyDockspace");
    ImGui::DockSpace(dockspaceId, ImVec2(0.0f, 0.0f), ImGuiDockNodeFlags_None);

    // Menu bar
    if (ImGui::BeginMenuBar()) {
        if (ImGui::BeginMenu("File")) {
            if (ImGui::MenuItem("New Scene")) { /* ... */ }
            if (ImGui::MenuItem("Open Scene")) { /* ... */ }
            if (ImGui::MenuItem("Save Scene")) { /* ... */ }
            ImGui::Separator();
            if (ImGui::MenuItem("Exit")) { /* ... */ }
            ImGui::EndMenu();
        }
        ImGui::EndMenuBar();
    }

    // Individual panels
    renderViewportPanel();
    renderHierarchyPanel();
    renderPropertiesPanel();
    renderConsolePanel();
    renderStatsPanel();

    ImGui::End();
}
```

**Risk:** MEDIUM (complex UI layout, requires iteration to get right)

---

#### Task 2.3: Embed Software Rasterizer in Viewport (8 hours)

**Strategy:** Blit software rasterizer output to ImGui image widget

```cpp
void EditorUI::renderViewportPanel() {
    ImGui::Begin("Viewport");

    // Get framebuffer from renderer
    unsigned int* pixels = mGraphics.getPixels();
    unsigned int width = mGraphics.getWidth();
    unsigned int height = mGraphics.getHeight();

    // Upload to SDL texture
    SDL_UpdateTexture(mViewportTexture, nullptr, pixels, width * sizeof(unsigned int));

    // Display in ImGui
    ImVec2 viewportSize = ImGui::GetContentRegionAvail();
    ImGui::Image((void*)(intptr_t)mViewportTexture, viewportSize);

    ImGui::End();
}
```

**Mouse Picking:**
```cpp
if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(0)) {
    ImVec2 mousePos = ImGui::GetMousePos();
    ImVec2 viewportPos = ImGui::GetItemRectMin();
    float clickX = mousePos.x - viewportPos.x;
    float clickY = mousePos.y - viewportPos.y;

    // Raycast from (clickX, clickY) into scene
    SceneObject* clicked = sceneManager.raycast(clickX, clickY);
    if (clicked) {
        selectedObject = clicked;
    }
}
```

**Risk:** MEDIUM (texture upload performance, may need optimization)

---

#### Task 2.4: Implement Scene Hierarchy Panel (8 hours)

**Tree View:**
```cpp
void EditorUI::renderHierarchyPanel() {
    ImGui::Begin("Scene Hierarchy");

    for (auto& obj : mSceneManager.getObjects()) {
        ImGuiTreeNodeFlags flags = ImGuiTreeNodeFlags_OpenOnArrow;
        if (obj == mSelectedObject) {
            flags |= ImGuiTreeNodeFlags_Selected;
        }

        bool nodeOpen = ImGui::TreeNodeEx(obj->getName().c_str(), flags);

        if (ImGui::IsItemClicked()) {
            mSelectedObject = obj;
        }

        if (nodeOpen) {
            for (auto& child : obj->getChildren()) {
                // Recursive tree node
            }
            ImGui::TreePop();
        }
    }

    ImGui::End();
}
```

**Risk:** LOW (standard ImGui pattern)

---

#### Task 2.5: Implement Properties Panel (8 hours)

**Transform Editing:**
```cpp
void EditorUI::renderPropertiesPanel() {
    ImGui::Begin("Properties");

    if (mSelectedObject) {
        ImGui::Text("Object: %s", mSelectedObject->getName().c_str());

        // Transform
        if (ImGui::CollapsingHeader("Transform", ImGuiTreeNodeFlags_DefaultOpen)) {
            Vector4& pos = mSelectedObject->getPosition();
            ImGui::DragFloat3("Position", &pos.x, 0.1f);

            Vector4& rot = mSelectedObject->getRotation();
            ImGui::DragFloat3("Rotation", &rot.x, 1.0f);

            Vector4& scale = mSelectedObject->getScale();
            ImGui::DragFloat3("Scale", &scale.x, 0.1f);
        }

        // Material
        if (ImGui::CollapsingHeader("Material")) {
            unsigned int& color = mSelectedObject->getColor();
            float col[4];
            ImGui::ColorConvert(color, col);  // ARGB → float4
            if (ImGui::ColorEdit3("Color", col)) {
                color = ImGui::ColorConvertFloat4ToU32(ImVec4(col[0], col[1], col[2], 1.0f));
            }
        }
    } else {
        ImGui::Text("No object selected");
    }

    ImGui::End();
}
```

**Risk:** LOW (standard property grid)

---

### Week 4 Deliverables

- [x] ImGui integrated with SDL2
- [x] Dockable workspace with 5 panels
- [x] Software rasterizer output in viewport panel
- [x] Scene hierarchy with selection
- [x] Properties panel with transform editing

**Acceptance Criteria:**
- Can click on objects in viewport to select
- Can edit transform values in properties panel
- Framerate stays above 30 FPS (ImGui overhead <5ms)

---

### Week 5: Advanced UI Features (40 hours)

#### Task 2.6: Asset Browser Panel (12 hours)
#### Task 2.7: Console Log Panel (4 hours)
#### Task 2.8: Stats/Profiler Panel (8 hours)
#### Task 2.9: Transform Gizmos (16 hours — most complex)

(Detailed breakdown omitted for brevity — similar pattern to Week 4)

---

## Phase 3: Vulkan Stub & Swapchain (2 weeks, 80 hours)

**Goal:** Create IRasterizer interface, implement Vulkan context/swapchain, render solid color triangle

**Risk:** HIGH (Vulkan boilerplate is verbose and error-prone)
**Reward:** HIGH (unlocks GPU acceleration)

### Week 6-7 Tasks

- Task 3.1: Create IRasterizer interface
- Task 3.2: Vulkan instance + device initialization
- Task 3.3: Swapchain setup
- Task 3.4: Render pass + framebuffer
- Task 3.5: Command buffer recording
- Task 3.6: Render solid color triangle (Hello World)

(Detailed plan omitted — standard Vulkan tutorial progression)

---

## Phase 4: Vulkan Rendering Pipeline (3 weeks, 120 hours)

**Goal:** Implement vertex/fragment shaders, depth buffer, lighting in GLSL

### Week 8-10 Tasks

- Task 4.1: Write GLSL vertex shader (world/view/projection transform)
- Task 4.2: Write GLSL fragment shader (lighting calculations)
- Task 4.3: Create Vulkan pipeline (vertex input, rasterization state, depth test)
- Task 4.4: Upload mesh data to GPU (vertex/index buffers)
- Task 4.5: Uniform buffer objects (UBOs) for matrices/lighting
- Task 4.6: Render cube with lighting (feature parity with software rasterizer)

---

## Phase 5: Integration & Polish (2 weeks, 80 hours)

**Goal:** Side-by-side software/Vulkan rendering, performance comparison, bug fixes

### Week 11-12 Tasks

- Task 5.1: Add renderer selection (Software vs Vulkan radio button)
- Task 5.2: Performance comparison dashboard (FPS, frame time)
- Task 5.3: Screenshot comparison tool (pixel-perfect validation)
- Task 5.4: Bug fixing (lighting discrepancies, depth test edge cases)
- Task 5.5: Optimization (batch rendering, instancing)

---

## Phase 6: Production Readiness (1 week, 40 hours)

**Goal:** Documentation, packaging, deployment

### Week 13 Tasks

- Task 6.1: User documentation (Getting Started, API reference)
- Task 6.2: Build scripts (CMake presets for Release/Debug)
- Task 6.3: Installer (Windows: NSIS, Linux: AppImage, macOS: DMG)
- Task 6.4: Final QA pass (test on 5 different GPUs)

---

## Risk Assessment

### High-Risk Tasks

| Task | Risk Level | Mitigation |
|------|-----------|------------|
| Phase 1: Global state refactor | HIGH | Incremental commits, keep old code for 1 week |
| Phase 2: ImGui integration | MEDIUM | Use imgui-demo.cpp as reference |
| Phase 3: Vulkan swapchain | HIGH | Follow Vulkan Tutorial (vulkan-tutorial.com) |
| Phase 4: GLSL shaders | MEDIUM | Port existing C++ shader logic 1:1 |
| Phase 5: Performance parity | MEDIUM | Capture baseline metrics in Phase 1 |

### Fallback Plans

**If Vulkan integration fails:**
- Keep software rasterizer as primary renderer
- Focus on ImGui editor instead
- Delay Vulkan to Phase 7 (separate project)

**If performance is poor:**
- Add tile-based rasterization to software renderer
- SIMD optimization (SSE/AVX)
- Multi-threaded rendering

---

## Dependency Graph

```
Phase 1 (Decouple)
    ├─ Week 1: Global state → RenderContext
    │   ├─ Task 1.1: RenderContext struct
    │   ├─ Task 1.2: Split TestManager
    │   ├─ Task 1.3: Dependency injection
    │   ├─ Task 1.4: Parameterize constants
    │   └─ Task 1.5: SDL2 input
    ├─ Week 2: Unit testing
    │   ├─ Task 1.6: Google Test setup
    │   └─ Task 1.7: Write 160+ tests
    └─ Week 3: Libraries & docs
        ├─ Task 1.8: Extract BFMath/BFRaster/BFScene
        ├─ Task 1.9: Doxygen documentation
        └─ Task 1.10: Tracy profiling

Phase 2 (UI) — DEPENDS ON Phase 1 Week 1
    ├─ Week 4: ImGui integration
    │   ├─ Task 2.1: ImGui + SDL2
    │   ├─ Task 2.2: Dockable workspace
    │   ├─ Task 2.3: Embed viewport
    │   ├─ Task 2.4: Scene hierarchy
    │   └─ Task 2.5: Properties panel
    └─ Week 5: Advanced UI
        └─ Tasks 2.6-2.9

Phase 3 (Vulkan Stub) — DEPENDS ON Phase 1 Week 1
    └─ Weeks 6-7: Tasks 3.1-3.6

Phase 4 (Vulkan Rendering) — DEPENDS ON Phase 3
    └─ Weeks 8-10: Tasks 4.1-4.6

Phase 5 (Integration) — DEPENDS ON Phase 4
    └─ Weeks 11-12: Tasks 5.1-5.5

Phase 6 (Production) — DEPENDS ON Phase 5
    └─ Week 13: Tasks 6.1-6.4
```

**Critical Path:** 1.1 → 1.2 → 1.3 → 2.1 → 2.2 → 3.1 → 3.2 → 4.1 → 5.1 → 6.1
**Total Duration:** 13 weeks (3 months)

---

## Success Metrics

### Phase 1 Success Criteria

- [ ] Zero global variables in Shaders.h/cpp
- [ ] 160+ unit tests, 90% code coverage
- [ ] Compiles on Windows + Linux + macOS
- [ ] Software rasterizer pixel-perfect match (before/after screenshots)

### Phase 2 Success Criteria

- [ ] ImGui renders at 60 FPS
- [ ] Can select objects in viewport via mouse
- [ ] Can edit transform in properties panel
- [ ] Scene hierarchy shows all objects

### Phase 3 Success Criteria

- [ ] Vulkan renders solid color triangle at 60 FPS
- [ ] No validation layer errors

### Phase 4 Success Criteria

- [ ] Vulkan renders lit cube identical to software rasterizer
- [ ] Lighting calculations match C++ shaders (GLSL port)

### Phase 5 Success Criteria

- [ ] Side-by-side rendering (Software | Vulkan split screen)
- [ ] <1% pixel difference between renderers
- [ ] Vulkan >10× faster than software (at 1920×1080)

### Phase 6 Success Criteria

- [ ] Installer works on 3 platforms
- [ ] Documentation covers 100% of public API
- [ ] Tested on NVIDIA, AMD, Intel GPUs

---

## Timeline

```
Week 1: Jan 20 - Jan 26  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 1
Week 2: Jan 27 - Feb 2   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 1
Week 3: Feb 3 - Feb 9    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 1
Week 4: Feb 10 - Feb 16  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 2
Week 5: Feb 17 - Feb 23  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 2
Week 6: Feb 24 - Mar 2   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 3
Week 7: Mar 3 - Mar 9    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 3
Week 8: Mar 10 - Mar 16  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 4
Week 9: Mar 17 - Mar 23  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 4
Week 10: Mar 24 - Mar 30 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 4
Week 11: Mar 31 - Apr 6  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 5
Week 12: Apr 7 - Apr 13  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 5
Week 13: Apr 14 - Apr 20 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Phase 6
```

**Milestone Dates:**
- **Feb 9:** Phase 1 complete (Decoupled codebase)
- **Feb 23:** Phase 2 complete (ImGui editor)
- **Mar 9:** Phase 3 complete (Vulkan triangle)
- **Mar 30:** Phase 4 complete (Vulkan cube with lighting)
- **Apr 13:** Phase 5 complete (Software/Vulkan parity)
- **Apr 20:** Phase 6 complete (Production release)

---

## Conclusion

This roadmap transforms the BrightForge software rasterizer from a tightly-coupled assignment project into a production-ready 3D engine with both CPU and GPU rendering paths. The 6-phase approach prioritizes decoupling and testing first, enabling safe Vulkan integration later.

**Key Achievements:**
- 60% code reuse (BFMath, BFRaster, BFScene libraries)
- 90% unit test coverage
- Cross-platform (Windows, Linux, macOS)
- Side-by-side CPU/GPU rendering
- ImGui-based 3D editor

**Next Steps:** Begin Phase 1, Week 1, Task 1.1 (Create RenderContext struct) on January 20, 2026.
