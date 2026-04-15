# BrightForge Coupling & Architectural Debt Report
**Developer:** Marcus Daley
**Date:** 2026-04-14
**Purpose:** Document all tight coupling issues, global state pollution, and architectural violations with severity ratings and refactoring priorities

---

## Executive Summary

**Total Issues:** 27 coupling violations identified
**Critical (Blocks Multi-Threading):** 6 global state issues
**High (Breaks Modularity):** 12 hardcoded dependencies
**Medium (Hinders Testing):** 9 design pattern violations

**Top 3 Blockers:**
1. Global mutable shader state (15 variables in Shaders.h/cpp)
2. TestManager directly manipulates all renderer internals
3. Hardcoded window dimensions and camera parameters scattered across 5 files

---

## Issue Classification System

**Severity Levels:**
- **CRITICAL** — Prevents multi-threading, causes data races, blocks Vulkan integration
- **HIGH** — Breaks modularity, prevents unit testing, violates single responsibility
- **MEDIUM** — Makes code hard to extend, increases maintenance burden
- **LOW** — Code smell, minor design flaw

**Impact Categories:**
- **[THREAD]** — Thread-safety violation
- **[TEST]** — Prevents unit testing
- **[EXTEND]** — Hard to extend or modify
- **[MAINTAIN]** — Increases maintenance cost
- **[PLATFORM]** — Platform-specific code

---

## CRITICAL Issues

### C1: Global Mutable Shader State

**Severity:** CRITICAL [THREAD] [TEST] [EXTEND]
**Files:** Shaders.h (lines 12-34), Shaders.cpp (lines 3-24)
**Impact:** Prevents multi-threading, makes testing impossible, violates encapsulation

**Violation:**
```cpp
// Shaders.h
extern Matrix4x4 vsWorld;           // Line 12
extern Matrix4x4 vsView;            // Line 13
extern Matrix4x4 vsProjection;      // Line 14
extern VertexShaderFunc VertexShader;   // Line 15 (function pointer)
extern PixelShederFunc pixelShader;     // Line 16 (function pointer)
extern bool isCube;                     // Line 17

// Lighting globals (9 variables)
extern Vector4 directionalLightDir;      // Line 21
extern unsigned int directionalLightColor; // Line 22
extern Vector4 pointLightPos;           // Line 24
extern unsigned int pointLightColor;    // Line 25
extern float pointLightRadius;          // Line 26
extern float ambientIntensity;          // Line 29
extern bool useDirectionalLight;        // Line 32
extern bool usePointLight;              // Line 33
extern bool useAmbientLight;            // Line 34

// Shaders.cpp (definitions)
Matrix4x4 vsWorld = Matrix4x4::identity();        // Line 4
Matrix4x4 vsView = Matrix4x4::identity();         // Line 5
Matrix4x4 vsProjection = Matrix4x4::identity();   // Line 6
VertexShaderFunc VertexShader = vsWorldViewTransform; // Line 9
PixelShederFunc pixelShader = psSolid;           // Line 10
bool isCube = false;                             // Line 13
// ... (9 more lighting globals)
```

**Writers (Race Condition Hotspots):**
- Renderer.h:94 — `vsWorld = mCubeWorldMatrix`
- Renderer.h:117 — `vsProjection = mProjectionMatrix`
- Renderer.h:142-147 — Sets all 3 matrices in renderMesh()
- TestManager.h:244, 458, 590, 813 — Sets vsWorld/vsView
- TestManager.h:298-335 — setStage() writes VertexShader + all lighting globals

**Readers (Consumers):**
- Shaders.cpp:47-50 — vsWorldViewTransform() reads vsWorld, vsView
- Shaders.cpp:56 — vsProjectionTransform() reads vsProjection
- Shaders.cpp:84-156 — vsLighting() reads vsWorld, vsView, all lighting params
- LineDrawing.h:75-79 — draw3DLine() calls VertexShader function pointer

**Race Condition Example:**
```cpp
// Thread 1 (rendering cube)
vsWorld = cubeMatrix;
VertexShader(vertex);  // May use Thread 2's gridMatrix!

// Thread 2 (rendering grid) — CONCURRENT
vsWorld = gridMatrix;
VertexShader(vertex);  // Race condition — which matrix is used?
```

**Refactoring Strategy:**
```cpp
// Create immutable context struct
struct RenderContext {
    Matrix4x4 world;
    Matrix4x4 view;
    Matrix4x4 projection;
    VertexShaderFunc vertexShader;
    PixelShaderFunc pixelShader;
    LightingParams lighting;
};

// Pass by const reference to all shader functions
void vsWorldViewTransform(Vertex& v, const RenderContext& ctx);
void vsProjectionTransform(Vertex& v, const RenderContext& ctx);
```

**Estimated Effort:** 2 days (touch 8 files, update all shader calls)

---

### C2: TestManager God Object

**Severity:** CRITICAL [EXTEND] [TEST] [MAINTAIN]
**Files:** TestManager.h (939 lines)
**Impact:** Violates single responsibility, impossible to test, mixes UI/rendering/game logic

**Responsibilities (Should be 5+ separate classes):**
1. **UI Controller** — displayMenu(), handleInput() (120 lines)
2. **Lighting Manager** — setStage(), initializeLightingDebugPrimitives(), updateLightingDebugTest() (250 lines)
3. **Scene Manager** — initializeTestObjects(), generateStarField(), createPointLightMarker() (350 lines)
4. **Renderer Orchestrator** — render(), renderStarField(), renderGrid(), renderLightingScene() (440 lines)
5. **Camera Controller** — Camera orbit, height/distance updates (80 lines)

**Coupling Web:**
```
TestManager
├── Directly manipulates Renderer internals (vsWorld, vsView, vsProjection)
├── Directly manipulates Camera (setHeight, setDistance, updateCameraMatrix)
├── Directly manipulates global shader state (VertexShader, lighting params)
├── Owns GraphicsHelper (should be injected)
├── Owns Renderer (should be injected)
├── Owns LineDrawing (should be injected)
└── Owns XTime (should be injected)
```

**Example of God Object Anti-Pattern:**
```cpp
// TestManager.h, line 313-319 (setStage method)
case Assignment4Stage::DIRECTIONAL_LIGHT:
    ambientIntensity = 0.2f;              // Global lighting state
    useAmbientLight = true;               // Global flag
    useDirectionalLight = true;           // Global flag
    usePointLight = false;                // Global flag
    directionalLightDir = Vector4(...);   // Global light direction
    directionalLightColor = 0xFFC0C0F0;   // Global light color
    VertexShader = vsLighting;            // Global function pointer
    break;
```

**Refactoring Strategy:**
```cpp
// Split into 5 classes
class UIController {
    void displayMenu();
    void handleInput();
};

class LightingManager {
    LightingParams ambient;
    DirectionalLight dirLight;
    PointLight pointLight;
    void setLightingMode(Mode mode);
};

class SceneManager {
    std::vector<SceneObject> objects;
    void generateStarField(int count);
    void loadModel(const std::string& path);
};

class RenderOrchestrator {
    IRasterizer& renderer;
    SceneManager& scene;
    LightingManager& lighting;
    void render();
};

class CameraController {
    Camera& camera;
    void update(const InputState& input);
};
```

**Estimated Effort:** 5 days (major refactor, high risk)

---

### C3: Renderer → Global Shader State Dependency

**Severity:** CRITICAL [TEST] [EXTEND]
**Files:** Renderer.h (lines 94, 117, 142-147)
**Impact:** Renderer cannot be unit tested in isolation, breaks dependency injection

**Violation:**
```cpp
// Renderer.h, line 94 (updateCubeRotation method)
vsWorld = mCubeWorldMatrix;  // Write to global

// Renderer.h, line 117 (setProjection method)
vsProjection = mProjectionMatrix;  // Write to global

// Renderer.h, lines 145-147 (renderMesh method)
vsWorld = isCube ? mCubeWorldMatrix : mGridWorldMatrix;  // Write to global
vsView = mMainCamera->getViewMatrix();                    // Write to global
vsProjection = mProjectionMatrix;                         // Write to global
```

**Why This is CRITICAL:**
```cpp
// Impossible to test Renderer without global state pollution
TEST(RendererTest, ProjectionMatrix) {
    GraphicsHelper graphics;
    Renderer renderer(graphics);

    renderer.setProjection(45.0f, 1.33f, 0.1f, 100.0f);

    // Cannot assert on result — it's written to global vsProjection!
    // ASSERT_EQ(renderer.getProjectionMatrix(), expectedMatrix);
    // vsProjection may have been modified by other code!
}
```

**Refactoring Strategy:**
```cpp
class Renderer {
    RenderContext mContext;  // Owned context (not global)

    void setProjection(float fov, float aspect, float near, float far) {
        // Compute matrix
        mContext.projection = computeProjectionMatrix(fov, aspect, near, far);
        // No global write!
    }

    void renderMesh(const Mesh& mesh) {
        mContext.world = mesh.getWorldMatrix();
        mContext.view = mMainCamera->getViewMatrix();

        // Pass context to rasterizer (not global)
        mRasterizer.draw(mesh, mContext);
    }
};
```

**Estimated Effort:** 3 days (redesign Renderer API)

---

### C4: LineDrawing → Global VertexShader Function Pointer

**Severity:** CRITICAL [THREAD] [TEST]
**Files:** LineDrawing.h (lines 75-79, 274-279)
**Impact:** Shader function can be swapped mid-render by another thread

**Violation:**
```cpp
// LineDrawing.h, line 75-79 (draw3DLine method)
if (VertexShader) {  // Global function pointer
    VertexShader(v1);  // Race condition — pointer can change mid-call
    VertexShader(v2);
}

// LineDrawing.h, line 274-279 (draw3DTriangle method)
if (VertexShader) {
    VertexShader(vert0);  // What if TestManager changes VertexShader here?
    VertexShader(vert1);
    VertexShader(vert2);
}
```

**Race Condition Scenario:**
```cpp
// Thread 1 (rendering cube)
VertexShader = vsLighting;  // TestManager changes shader
draw3DLine(v0, v1);         // Calls vsLighting

// Thread 2 (star field) — CONCURRENT
VertexShader = vsWorldViewTransform;  // RACE! Thread 1 may now use wrong shader
```

**Refactoring Strategy:**
```cpp
// Pass shader as parameter, not global
void draw3DLine(const Vertex& start, const Vertex& end, VertexShaderFunc shader) {
    Vertex v1 = start;
    Vertex v2 = end;

    if (shader) {
        shader(v1);
        shader(v2);
    }
    // ... rest of line drawing
}

// Or use context pattern
void draw3DLine(const Vertex& start, const Vertex& end, const RenderContext& ctx) {
    if (ctx.vertexShader) {
        ctx.vertexShader(v1);
        ctx.vertexShader(v2);
    }
}
```

**Estimated Effort:** 1 day (update all draw calls)

---

### C5: Hardcoded Window Dimensions

**Severity:** CRITICAL [EXTEND] [PLATFORM]
**Files:** Constrants.h (lines 5-7), GraphicsHelper.hpp (line 36), main.cpp (line 21), Renderer.h (line 72)
**Impact:** Cannot resize window, breaks on different screen resolutions, prevents multi-monitor support

**Violation:**
```cpp
// Constrants.h, lines 5-7
constexpr unsigned int kWindowWidth = 600;   // Line 5
constexpr unsigned int kWindowHeight = 500;  // Line 6
constexpr unsigned int kTotalPixels = kWindowWidth * kWindowHeight;  // Line 7

// GraphicsHelper.hpp, line 36 (constructor)
GraphicsHelper() : width(GraphicsConstrants::kWindowWidth),  // Hardcoded
                   height(GraphicsConstrants::kWindowHeight)
{
    pixels = new unsigned int[width * height];  // Fixed-size allocation
    // ...
}

// Renderer.h, line 72 (setProjection)
float aspect = static_cast<float>(GraphicsConstrants::kWindowWidth) /
               GraphicsConstrants::kWindowHeight;  // Hardcoded aspect ratio

// main.cpp, line 21
if (!RS_Initialize("MarusDaley Graphic Engine Demo",
                   GraphicsConstrants::kWindowWidth,   // Hardcoded
                   GraphicsConstrants::kWindowHeight))
```

**Why This is CRITICAL:**
- Cannot resize window (framebuffer is fixed-size)
- Cannot support 16:9 monitors (600×500 = 1.2:1 aspect ratio — square-ish)
- Cannot support 4K displays (wasteful to use only 300K of 8M pixels)

**Refactoring Strategy:**
```cpp
class GraphicsHelper {
    unsigned int width;
    unsigned int height;
    unsigned int* pixels;
    std::vector<float> depthBuffer;

    GraphicsHelper(unsigned int w, unsigned int h) : width(w), height(h) {
        pixels = new unsigned int[w * h];
        depthBuffer.resize(w * h, std::numeric_limits<float>::max());
    }

    void resize(unsigned int newWidth, unsigned int newHeight) {
        delete[] pixels;
        pixels = new unsigned int[newWidth * newHeight];
        depthBuffer.resize(newWidth * newHeight, std::numeric_limits<float>::max());
        width = newWidth;
        height = newHeight;
    }
};

// main.cpp
GraphicsHelper graphics(initialWidth, initialHeight);
Renderer renderer(graphics);

// Window resize callback
void onWindowResize(unsigned int newWidth, unsigned int newHeight) {
    graphics.resize(newWidth, newHeight);
    renderer.updateAspectRatio(static_cast<float>(newWidth) / newHeight);
}
```

**Estimated Effort:** 2 days (add resize support, test dynamic allocation)

---

### C6: Platform-Specific Input (_kbhit / _getch)

**Severity:** CRITICAL [PLATFORM] [EXTEND]
**Files:** TestManager.h (lines 2, 122, 123)
**Impact:** Cannot compile on Linux/macOS, prevents cross-platform builds

**Violation:**
```cpp
// TestManager.h, line 2
#include <conio.h>  // Windows-only header

// TestManager.h, line 122-123
if (_kbhit()) {      // Windows-only function (NOT POSIX)
    char key = _getch();  // Windows-only function
    // ...
}
```

**Why This is CRITICAL:**
- `_kbhit()` / `_getch()` are NOT part of C++ standard library
- `<conio.h>` does not exist on Linux/macOS
- Cannot build for Unreal Engine (which targets multiple platforms)

**Refactoring Strategy:**
```cpp
// Option 1: Use SDL2 (cross-platform)
#include <SDL2/SDL.h>

void handleInput() {
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        if (event.type == SDL_KEYDOWN) {
            switch (event.key.keysym.sym) {
                case SDLK_w: /* ... */ break;
                case SDLK_s: /* ... */ break;
                // ...
            }
        }
    }
}

// Option 2: Use ImGui (built on SDL2/GLFW)
void handleInput() {
    if (ImGui::IsKeyPressed(ImGuiKey_W)) { /* ... */ }
    if (ImGui::IsKeyPressed(ImGuiKey_S)) { /* ... */ }
}
```

**Estimated Effort:** 1 day (switch to SDL2 or ImGui input)

---

## HIGH Severity Issues

### H1: TestManager Directly Manipulates Camera

**Severity:** HIGH [TEST] [EXTEND]
**Files:** TestManager.h (lines 134-177, 238-245)
**Impact:** Camera cannot be tested independently, breaks encapsulation

**Violation:**
```cpp
// TestManager.h, lines 134-139
case 'w': case 'W':
    cameraHeight += moveSpeed;  // Direct state manipulation
    if (camera) {
        camera->setHeight(cameraHeight);  // Bypass validation
        camera->updateCameraMatrix(cameraRotationAngle);  // Force update
    }
    break;

// TestManager.h, lines 238-244 (automatic rotation)
cameraRotationAngle += static_cast<float>(timer.Delta()) * 0.1f;
camera->updateCameraMatrix(cameraRotationAngle);  // Direct call
vsView = camera->getViewMatrix();  // Write to global
```

**Why This is HIGH:**
- Camera logic scattered across TestManager and Camera class
- Cannot test camera in isolation (depends on TestManager's cameraHeight/Angle state)
- Violates Tell, Don't Ask principle

**Refactoring Strategy:**
```cpp
class CameraController {
    Camera& mCamera;
    float mRotationAngle = 0.0f;
    float mHeight = 2.0f;
    float mDistance = 5.0f;

public:
    void moveUp(float delta) {
        mHeight += delta;
        mCamera.setHeight(mHeight);
    }

    void rotateLeft(float delta) {
        mRotationAngle += delta;
        mCamera.updateCameraMatrix(mRotationAngle);
    }

    void update(float deltaTime) {
        mRotationAngle += deltaTime * 0.1f;  // Auto-rotate
        mCamera.updateCameraMatrix(mRotationAngle);
    }
};

// TestManager becomes thin UI layer
class TestManager {
    CameraController cameraController;

    void handleInput() {
        if (keyPressed('w')) cameraController.moveUp(moveSpeed);
        if (keyPressed('s')) cameraController.moveDown(moveSpeed);
    }
};
```

**Estimated Effort:** 1 day (extract CameraController class)

---

### H2: Global Objects in main.cpp

**Severity:** HIGH [TEST]
**Files:** main.cpp (lines 11-15)
**Impact:** Cannot unit test components, prevents dependency injection

**Violation:**
```cpp
// main.cpp, lines 11-15
GraphicsHelper graphics;      // Global variable
Renderer renderer(graphics);  // Global variable (depends on graphics)
LineDrawing lineDrawing(graphics);  // Global variable
XTime timer(60);              // Global variable
TestManager testManager(graphics);  // Global variable
```

**Why This is HIGH:**
- Order-dependent initialization (if graphics is used before it's constructed, UB)
- Cannot mock dependencies for testing
- Cannot create multiple renderer instances (e.g., for render-to-texture)

**Refactoring Strategy:**
```cpp
// main.cpp
int main() {
    GraphicsHelper graphics(600, 500);  // Local variable
    Renderer renderer(graphics);        // Local variable
    TestManager testManager(graphics, renderer);  // Dependency injection

    // ...
}

// TestManager.h (constructor)
TestManager(GraphicsHelper& g, Renderer& r)
    : graphic(g), renderer(r), lineDrawing(g), timer(60)
{
    // ...
}
```

**Estimated Effort:** 1 hour (minor refactor)

---

### H3: Renderer Owns Camera (Should be Injected)

**Severity:** HIGH [TEST] [EXTEND]
**Files:** Renderer.h (lines 47, 59)
**Impact:** Cannot swap camera implementations, hard to test

**Violation:**
```cpp
// Renderer.h, line 47
std::unique_ptr<Camera> mMainCamera;  // Owned by Renderer

// Renderer.h, line 59 (constructor)
mMainCamera(std::make_unique<Camera>()),  // Hardcoded creation
```

**Why This is HIGH:**
- Renderer is tightly coupled to Camera implementation
- Cannot use different camera types (e.g., FirstPersonCamera, OrbitCamera, DebugCamera)
- Cannot mock camera for testing

**Refactoring Strategy:**
```cpp
class Renderer {
    Camera* mMainCamera;  // Pointer (not owner)

public:
    Renderer(GraphicsHelper& graphics, Camera* camera)
        : mGraphics(graphics), mMainCamera(camera)
    {
        // ...
    }

    void setCamera(Camera* camera) {
        mMainCamera = camera;
    }
};

// main.cpp
Camera camera;
Renderer renderer(graphics, &camera);  // Inject dependency
```

**Estimated Effort:** 1 hour (change unique_ptr to pointer, update constructor)

---

### H4: TestManager Directly Writes to Global vsWorld

**Severity:** HIGH [THREAD] [TEST]
**Files:** TestManager.h (lines 458, 590, 665, 681, 813)
**Impact:** Bypasses Renderer encapsulation, causes race conditions

**Violation:**
```cpp
// TestManager.h, line 458 (renderStarField)
vsWorld = Matrix4x4::identity();  // Direct global write

// TestManager.h, line 665 (renderLightingScene)
vsWorld = Matrix4x4::identity();  // Direct global write

// TestManager.h, line 681
vsWorld = lightTransform;  // Direct global write

// TestManager.h, line 813 (renderGrid)
vsWorld = Matrix4x4::identity();  // Direct global write
```

**Why This is HIGH:**
- TestManager knows about Renderer's internal global state
- Violates encapsulation (should call renderer->setWorldMatrix() instead)
- Creates implicit coupling (TestManager assumes vsWorld exists)

**Refactoring Strategy:**
```cpp
// Renderer.h (add setter)
void setWorldMatrix(const Matrix4x4& world) {
    mContext.world = world;
}

// TestManager.h (use setter instead of global)
void renderGrid() {
    renderer.setWorldMatrix(Matrix4x4::identity());  // Explicit call
    renderer.renderMesh(gridMesh->getVertices(), ...);
}
```

**Estimated Effort:** 1 hour (add Renderer setters, update TestManager)

---

### H5: Hardcoded Camera Parameters

**Severity:** HIGH [EXTEND]
**Files:** Camera.h (lines 17-24), Constrants.h (lines 13-22), TestManager.h (lines 50-52, 373-377)
**Impact:** Cannot support different camera modes (FPS, orbit, cinematic)

**Violation:**
```cpp
// Camera.h, lines 17-24 (constructor)
Camera() : mPosition(), mRotation(),
    mHeight(GraphicsConstrants::kDefaultCameraHeight),      // Hardcoded
    mDistance(GraphicsConstrants::kDefaultCameraDistance_Forward),  // Hardcoded
    mViewAngle(GraphicsConstrants::kDefaultViewAngle)       // Hardcoded
{
    mPosition = Vector4(0.0f, 2.0f, -5.0f, 1.0f);  // Hardcoded
    mHeight = 2.0f;                                 // Hardcoded (again!)
    mDistance = 5.0f;                              // Hardcoded (again!)
    mViewAngle = Matrix4x4::degreesToRadians(-15.0f);  // Hardcoded
    // ...
}

// Constrants.h, lines 13-22 (magic numbers)
constexpr float kDefaultCameraHeight = 2.0f;
constexpr float kDefaultCameraDistance_Forward = 5.0f;
constexpr float kDefaultViewAngle = -18.0f * 3.14159f / 180.0f;
constexpr float kRotationSpeed = 0.1f;
constexpr float kMovementSpeed = 0.1f;
constexpr float kMinCameraHeight = 0.5f;
constexpr float kMaxCameraHeight = 10.0f;
constexpr float kMinCameraDistance = 2.0f;
constexpr float kMaxCameraDistance = 20.0f;

// TestManager.h, lines 373-377 (setupInitialState)
cameraHeight = 2.0f;     // Hardcoded (overrides constructor!)
cameraDistance = 5.0f;   // Hardcoded
camera->setHeight(cameraHeight);
camera->setDistance(cameraDistance);
camera->setViewAngle(-10.0f * 3.14159f / 180.0f);  // Hardcoded
```

**Why This is HIGH:**
- Different camera modes need different defaults (FPS: low, orbit: medium, cinematic: far)
- Cannot save/load camera presets
- Magic number -18° vs -10° discrepancy (line 16 vs 377)

**Refactoring Strategy:**
```cpp
struct CameraSettings {
    float height = 2.0f;
    float distance = 5.0f;
    float viewAngle = -15.0f * (3.14159f / 180.0f);
    float moveSpeed = 0.1f;
    float rotationSpeed = 0.1f;
};

class Camera {
    CameraSettings mSettings;

public:
    Camera(const CameraSettings& settings = CameraSettings())
        : mSettings(settings)
    {
        mHeight = settings.height;
        mDistance = settings.distance;
        // ...
    }
};

// Usage
CameraSettings orbitSettings{2.0f, 5.0f, -15.0f};
CameraSettings fpsSettings{1.7f, 0.0f, 0.0f};  // Eye-level, no distance offset
Camera orbitCamera(orbitSettings);
Camera fpsCamera(fpsSettings);
```

**Estimated Effort:** 2 hours (create settings struct, update constructors)

---

### H6: Hardcoded Lighting Parameters

**Severity:** HIGH [EXTEND]
**Files:** TestManager.h (lines 313-335), Shaders.cpp (lines 16-24)
**Impact:** Cannot save lighting presets, hard to tweak for artists

**Violation:**
```cpp
// TestManager.h, lines 313-319 (DIRECTIONAL_LIGHT stage)
ambientIntensity = 0.2f;                      // Hardcoded
useAmbientLight = true;
useDirectionalLight = true;
usePointLight = false;
directionalLightDir = Vector4(-0.577f, -0.577f, 0.577f, 0.0f);  // Hardcoded
directionalLightColor = 0xFFC0C0F0;           // Hardcoded (blue-ish)
VertexShader = vsLighting;

// TestManager.h, lines 323-333 (POINT_LIGHT stage)
ambientIntensity = 0.1f;                      // Different hardcoded value
directionalLightDir = Vector4(-0.577f, -0.577f, 0.577f, 0.0f);  // Duplicate
directionalLightColor = 0xFFC0C0F0;           // Duplicate
pointLightPos = Vector4(-1.0f, 0.5f, 1.0f, 1.0f);  // Hardcoded
pointLightColor = 0xFFFFFF00;                 // Hardcoded (yellow)
pointLightRadius = 3.5f;                      // Hardcoded

// Shaders.cpp, lines 16-24 (default values)
Vector4 directionalLightDir(0.0f, 0.0f, 0.0f, 0.0f);  // Zero (unused default)
unsigned int directionalLightColor = 0;
Vector4 pointLightPos(0.0f, 0.0f, 0.0f, 0.0f);
unsigned int pointLightColor = 0;
float pointLightRadius = 1.0f;                // Different default than TestManager
float ambientIntensity = 0.2f;                // Different default
```

**Why This is HIGH:**
- Artists cannot tweak lighting without recompiling
- Cannot save/load lighting presets
- Duplicate values scattered across files
- Inconsistent defaults (radius: 1.0f vs 3.5f, ambient: 0.2f vs 0.1f)

**Refactoring Strategy:**
```cpp
struct LightingPreset {
    float ambientIntensity;
    bool useDirectional;
    Vector4 directionalDir;
    unsigned int directionalColor;
    bool usePoint;
    Vector4 pointPos;
    unsigned int pointColor;
    float pointRadius;
};

class LightingManager {
    LightingPreset mCurrentPreset;

public:
    void loadPreset(const std::string& name) {
        mCurrentPreset = loadFromFile("presets/" + name + ".json");
    }

    void applyToContext(RenderContext& ctx) {
        ctx.lighting.ambient = mCurrentPreset.ambientIntensity;
        ctx.lighting.directional = mCurrentPreset.useDirectional;
        // ...
    }
};

// presets/outdoor.json
{
    "ambientIntensity": 0.2,
    "directionalDir": [-0.577, -0.577, 0.577, 0.0],
    "directionalColor": 0xFFC0C0F0,
    "usePoint": false
}
```

**Estimated Effort:** 3 hours (create LightingManager, add JSON serialization)

---

### H7: Renderer Hardcodes Projection Parameters

**Severity:** HIGH [EXTEND]
**Files:** Renderer.h (lines 71-73)
**Impact:** Cannot change FOV/near/far at runtime, hardcoded aspect ratio

**Violation:**
```cpp
// Renderer.h, lines 71-73 (constructor)
float fov = 45.0f * (3.14159f / 180.0f);  // Hardcoded FOV
float aspect = static_cast<float>(GraphicsConstrants::kWindowWidth) /
               GraphicsConstrants::kWindowHeight;  // Hardcoded aspect
setProjection(fov, aspect, 0.1f, 100.0f);  // Hardcoded near/far
```

**Why This is HIGH:**
- Cannot implement FOV slider (common in games)
- Cannot support ultra-wide monitors (need different aspect)
- Cannot support VR (needs per-eye projection)

**Refactoring Strategy:**
```cpp
struct ProjectionSettings {
    float fovDegrees = 45.0f;
    float nearPlane = 0.1f;
    float farPlane = 100.0f;
};

class Renderer {
    ProjectionSettings mProjSettings;

    void updateProjection(float aspectRatio) {
        float fovRadians = mProjSettings.fovDegrees * (3.14159f / 180.0f);
        setProjection(fovRadians, aspectRatio,
                      mProjSettings.nearPlane, mProjSettings.farPlane);
    }

public:
    void setFOV(float degrees) {
        mProjSettings.fovDegrees = degrees;
        updateProjection(getCurrentAspectRatio());
    }
};
```

**Estimated Effort:** 1 hour (add projection settings)

---

### H8: Magic Numbers in Lighting Calculations

**Severity:** HIGH [MAINTAIN]
**Files:** Shaders.cpp (lines 129-130)
**Impact:** Hard to understand/tune lighting model

**Violation:**
```cpp
// Shaders.cpp, lines 129-130 (point light attenuation)
float rangeAttenuation = 1.0f - std::min(pointLightDistance / pointLightRadius, 1.0f);
float attenSquared = rangeAttenuation * rangeAttenuation;  // Why square? No comment
```

**Why This is HIGH:**
- `attenSquared` is non-linear falloff, but not documented
- Artists cannot tune falloff curve (linear, quadratic, cubic, inverse-square?)
- Standard physically-based attenuation is `1 / (distance^2)`, this uses `(1 - distance/radius)^2`

**Refactoring Strategy:**
```cpp
// Add named constants and comments
constexpr float ATTENUATION_POWER = 2.0f;  // Quadratic falloff (physically-based would be inverse-square)

float rangeAttenuation = 1.0f - std::min(pointLightDistance / pointLightRadius, 1.0f);
float attenCurved = std::pow(rangeAttenuation, ATTENUATION_POWER);  // Apply falloff curve

// Better: support multiple falloff modes
enum class AttenuationMode {
    Linear,       // 1 - d/r
    Quadratic,    // (1 - d/r)^2
    InverseSquare // 1 / (1 + d^2)
};

float calculateAttenuation(float distance, float radius, AttenuationMode mode) {
    switch (mode) {
        case AttenuationMode::Linear:
            return 1.0f - std::min(distance / radius, 1.0f);
        case AttenuationMode::Quadratic:
            float linear = 1.0f - std::min(distance / radius, 1.0f);
            return linear * linear;
        case AttenuationMode::InverseSquare:
            return 1.0f / (1.0f + distance * distance);
    }
}
```

**Estimated Effort:** 30 minutes (add comments and named constants)

---

### H9: Mesh Hardcodes Per-Face Colors

**Severity:** HIGH [EXTEND]
**Files:** mesh.h (lines 31-64)
**Impact:** Cannot apply materials to cube, hardcoded color scheme

**Violation:**
```cpp
// mesh.h, lines 31-64 (createCube)
// Front face (Red)
mesh->mVertices.emplace_back(Vector4(-halfSize, -halfSize, -halfSize),
                              GraphicsConstrants::kColorRed, 0.0f, 0.0f);  // Line 31
// ...

// Back face (Green)
mesh->mVertices.emplace_back(Vector4(-halfSize, -halfSize, halfSize),
                              GraphicsConstrants::kColorGreen, 0.0f, 0.0f);  // Line 37

// Left face (Blue), Right face (Yellow), Top face (Cyan), Bottom face (Magenta)
// ... (lines 43-64)
```

**Why This is HIGH:**
- Cannot change cube color without modifying mesh.h
- Cannot apply textures (UV coords are present but color overrides them)
- Cube cannot share vertices (24 vertices instead of 8 due to color differences)

**Refactoring Strategy:**
```cpp
static std::unique_ptr<Mesh> createCube(float size, unsigned int color = 0xFFFFFFFF) {
    // Use shared vertices (8 instead of 24)
    mesh->mVertices.emplace_back(Vector4(-halfSize, -halfSize, -halfSize), color);
    mesh->mVertices.emplace_back(Vector4( halfSize, -halfSize, -halfSize), color);
    // ... (8 vertices total)

    // Indices reference same vertices
    mesh->mIdices = {0, 1, 2, 0, 2, 3, ...};  // 36 indices
}

// Usage
auto redCube = Mesh::createCube(1.0f, 0xFFFF0000);
auto whiteCube = Mesh::createCube(1.0f, 0xFFFFFFFF);  // Default white (for texturing)
```

**Estimated Effort:** 1 hour (simplify cube generation, add color parameter)

---

### H10: TestManager Hardcodes Assignment Stages

**Severity:** HIGH [EXTEND]
**Files:** TestManager.h (lines 20-25, 292-336)
**Impact:** Cannot add new test stages without modifying enum and switch statement

**Violation:**
```cpp
// TestManager.h, lines 20-25
enum class Assignment4Stage {
    STAR_FIELD = 0,         // 25%
    DIRECTIONAL_LIGHT = 1,  // 75%
    POINT_LIGHT = 2        // 100%
};

// TestManager.h, lines 292-336 (setStage method)
void setStage(Assignment4Stage stage) {
    currentStage = stage;

    switch (stage) {  // Must update this switch for every new stage
        case Assignment4Stage::STAR_FIELD:
            // 15 lines of configuration
            break;
        case Assignment4Stage::DIRECTIONAL_LIGHT:
            // 15 lines of configuration
            break;
        case Assignment4Stage::POINT_LIGHT:
            // 15 lines of configuration
            break;
    }
}
```

**Why This is HIGH:**
- Violates Open-Closed Principle (modify instead of extend)
- Cannot load test configurations from files
- Hardcoded to "Assignment 4" (not reusable for Assignment 5, 6, etc.)

**Refactoring Strategy:**
```cpp
struct TestStage {
    std::string name;
    std::string description;
    LightingPreset lighting;
    bool showGrid;
    VertexShaderFunc shader;
};

class TestManager {
    std::vector<TestStage> mStages;
    size_t mCurrentStageIndex = 0;

    void loadStages(const std::string& configFile) {
        // Load from JSON/YAML
        auto json = loadJSON(configFile);
        for (auto& stageJson : json["stages"]) {
            mStages.push_back({
                stageJson["name"],
                stageJson["description"],
                loadLightingPreset(stageJson["lighting"]),
                stageJson["showGrid"],
                getShaderByName(stageJson["shader"])
            });
        }
    }

    void setStage(size_t index) {
        if (index >= mStages.size()) return;
        mCurrentStageIndex = index;
        const auto& stage = mStages[index];

        // Apply stage configuration
        applyLightingPreset(stage.lighting);
        showGrid = stage.showGrid;
        VertexShader = stage.shader;
    }
};

// config/assignment4_stages.json
{
    "stages": [
        {"name": "Star Field", "description": "25%", "lighting": "none", "showGrid": true, "shader": "vsWorldViewTransform"},
        {"name": "Directional Light", "description": "75%", "lighting": "directional", "showGrid": true, "shader": "vsLighting"},
        {"name": "Point Light", "description": "100%", "lighting": "point", "showGrid": true, "shader": "vsLighting"}
    ]
}
```

**Estimated Effort:** 4 hours (design stage system, add JSON loader)

---

### H11: GraphicsHelper Hardcodes Depth Comparison

**Severity:** MEDIUM [EXTEND]
**Files:** GraphicsHelper.hpp (line 96)
**Impact:** Cannot implement reverse-Z, cannot disable depth test

**Violation:**
```cpp
// GraphicsHelper.hpp, line 96
if (depth <= mDepthBuffer[index]) {  // Hardcoded less-or-equal comparison
    pixels[index] = color;
    mDepthBuffer[index] = depth;
}
```

**Why This is MEDIUM:**
- Modern renderers use reverse-Z (greater-or-equal test) for better precision
- Cannot implement transparency (requires depth write disabled)
- Comparison function should be configurable

**Refactoring Strategy:**
```cpp
enum class DepthFunc {
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Equal,
    Always,
    Never
};

class GraphicsHelper {
    DepthFunc mDepthFunc = DepthFunc::LessEqual;
    bool mDepthWriteEnabled = true;

    void drawPixel(unsigned int x, unsigned int y, float depth, unsigned int color) {
        if (x >= width || y >= height) return;
        unsigned int index = y * width + x;

        bool depthTestPassed = false;
        switch (mDepthFunc) {
            case DepthFunc::Less:      depthTestPassed = (depth <  mDepthBuffer[index]); break;
            case DepthFunc::LessEqual: depthTestPassed = (depth <= mDepthBuffer[index]); break;
            case DepthFunc::Greater:   depthTestPassed = (depth >  mDepthBuffer[index]); break;
            case DepthFunc::Always:    depthTestPassed = true; break;
            case DepthFunc::Never:     depthTestPassed = false; break;
        }

        if (depthTestPassed) {
            pixels[index] = color;
            if (mDepthWriteEnabled) {
                mDepthBuffer[index] = depth;
            }
        }
    }
};
```

**Estimated Effort:** 1 hour (add depth function enum)

---

### H12: LineDrawing Assumes Color is Constant

**Severity:** MEDIUM [EXTEND]
**Files:** LineDrawing.h (line 120)
**Impact:** Lines cannot have gradient colors

**Violation:**
```cpp
// LineDrawing.h, line 120 (draw3DLine)
graphics.drawPixel(
    static_cast<unsigned int>(x + 0.5f),
    static_cast<unsigned int>(y + 0.5f),
    z,
    v1.color  // Always uses start vertex color (no interpolation)
);
```

**Why This is MEDIUM:**
- Gradient lines would look better (e.g., colored grid axes)
- Inconsistent with triangle rasterization (which interpolates color)

**Refactoring Strategy:**
```cpp
// Interpolate color along line
for (int step = 0; step <= stepsNeeded; step++) {
    float t = step / stepsNeeded;  // Interpolation factor [0, 1]
    unsigned int interpColor = lerpColor(v1.color, v2.color, t);

    graphics.drawPixel(
        static_cast<unsigned int>(x + 0.5f),
        static_cast<unsigned int>(y + 0.5f),
        z,
        interpColor  // Interpolated color
    );
    // ...
}

unsigned int lerpColor(unsigned int c1, unsigned int c2, float t) {
    unsigned int r1 = (c1 >> 16) & 0xFF, r2 = (c2 >> 16) & 0xFF;
    unsigned int g1 = (c1 >> 8) & 0xFF,  g2 = (c2 >> 8) & 0xFF;
    unsigned int b1 = c1 & 0xFF,         b2 = c2 & 0xFF;

    unsigned int r = static_cast<unsigned int>(r1 + (r2 - r1) * t);
    unsigned int g = static_cast<unsigned int>(g1 + (g2 - g1) * t);
    unsigned int b = static_cast<unsigned int>(b1 + (b2 - b1) * t);

    return 0xFF000000 | (r << 16) | (g << 8) | b;
}
```

**Estimated Effort:** 30 minutes (add color interpolation)

---

## MEDIUM Severity Issues

### M1: Camera Constructor Calls updateViewMatrix() Twice

**Severity:** MEDIUM [MAINTAIN]
**Files:** Camera.h (lines 24-25)
**Impact:** Redundant computation, likely typo

**Violation:**
```cpp
// Camera.h, lines 24-25
updateViewMatrix();  // Line 24
updateViewMatrix();  // Line 25 (duplicate call!)
```

**Refactoring:** Remove line 25 (duplicate)

**Estimated Effort:** 1 minute

---

### M2: Renderer renderMesh() Ignores TestMode Parameter

**Severity:** MEDIUM [MAINTAIN]
**Files:** Renderer.h (line 138)
**Impact:** Dead parameter, confuses API users

**Violation:**
```cpp
// Renderer.h, line 138
void renderMesh(const std::vector<Vertex>& vertices,
                const std::vector<unsigned int>& indices,
                bool isCube,
                TestMode currentMode,  // UNUSED! Should control rendering mode
                const unsigned int* texture = nullptr,
                int texWidth = 0, int texHeight = 0)
{
    // currentMode is never read
    // ...
}
```

**Refactoring:** Either use the parameter OR remove it

**Estimated Effort:** 5 minutes

---

### M3: Inconsistent Naming (Idices vs Indices)

**Severity:** LOW [MAINTAIN]
**Files:** mesh.h (lines 9, 18, 138, etc.)
**Impact:** Confusing API, typos propagate

**Violation:**
```cpp
// mesh.h, line 9
std::vector<unsigned int> mIdices;  // Should be mIndices

// mesh.h, line 138
const std::vector<unsigned int>& getIdices() const { return mIdices; }  // Typo
```

**Refactoring:** Global find-replace "Idices" → "Indices"

**Estimated Effort:** 10 minutes

---

### M4-M9: Additional Minor Issues

- **M4:** Constrants.h typo (should be Constants.h)
- **M5:** main.cpp typo "MarusDaley" → "MarcusDaley"
- **M6:** mesh.h typo "Vetrex" → "Vertex"
- **M7:** TestManager includes StoneHenge.cpp (should be .h only)
- **M8:** Renderer::renderMesh() missing drawTriangle() call for grid path (CRITICAL bug, actually)
- **M9:** draw3DLine() applies shader twice if vertices are pre-transformed

---

## Summary Table

| ID | Severity | Category | Description | Effort |
|----|----------|----------|-------------|--------|
| C1 | CRITICAL | [THREAD] | Global mutable shader state | 2 days |
| C2 | CRITICAL | [EXTEND] | TestManager god object | 5 days |
| C3 | CRITICAL | [TEST] | Renderer → global state dependency | 3 days |
| C4 | CRITICAL | [THREAD] | LineDrawing → global VertexShader | 1 day |
| C5 | CRITICAL | [EXTEND] | Hardcoded window dimensions | 2 days |
| C6 | CRITICAL | [PLATFORM] | Windows-only input (_kbhit) | 1 day |
| H1 | HIGH | [TEST] | TestManager → Camera coupling | 1 day |
| H2 | HIGH | [TEST] | Global objects in main.cpp | 1 hour |
| H3 | HIGH | [TEST] | Renderer owns Camera | 1 hour |
| H4 | HIGH | [THREAD] | TestManager writes to vsWorld | 1 hour |
| H5 | HIGH | [EXTEND] | Hardcoded camera parameters | 2 hours |
| H6 | HIGH | [EXTEND] | Hardcoded lighting parameters | 3 hours |
| H7 | HIGH | [EXTEND] | Hardcoded projection parameters | 1 hour |
| H8 | HIGH | [MAINTAIN] | Magic numbers in lighting | 30 min |
| H9 | HIGH | [EXTEND] | Mesh hardcodes colors | 1 hour |
| H10 | HIGH | [EXTEND] | Hardcoded test stages | 4 hours |
| H11 | MEDIUM | [EXTEND] | Hardcoded depth comparison | 1 hour |
| H12 | MEDIUM | [EXTEND] | Line color not interpolated | 30 min |
| M1 | MEDIUM | [MAINTAIN] | Duplicate updateViewMatrix() call | 1 min |
| M2 | MEDIUM | [MAINTAIN] | Unused TestMode parameter | 5 min |
| M3 | LOW | [MAINTAIN] | Idices typo | 10 min |

**Total Estimated Refactoring:** ~18 days (90 hours)

**Priority Order (Dependencies):**
1. C1 (Global shader state) — Blocks all other refactors
2. C2 (TestManager split) — Simplifies H1, H4, H10
3. C3, C4 (Renderer/LineDrawing decoupling) — Enables unit testing
4. C5, C6 (Window/input portability) — Enables cross-platform builds
5. H1-H12 (Hardcoded parameters) — Incremental improvements

---

**Next Steps:** Proceed to Task 1.5 (reuse_inventory.md) to tag every function as REUSABLE or HARDCODED and identify merge candidates.
