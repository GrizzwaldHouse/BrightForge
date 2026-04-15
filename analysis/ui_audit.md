# BrightForge UI Framework Audit
**Developer:** Marcus Daley
**Date:** 2026-04-14
**Purpose:** Document current UI state, gaps vs. 3D editor requirements, and framework selection criteria

---

## Executive Summary

**Current UI:** Console-based keyboard input via `_kbhit()` / `_getch()` (Windows-specific)
**Frameworks Present:** NONE (no ImGui, no wxWidgets, no Qt, no Dear ImGui)
**UI Infrastructure:** 0% complete
**3D Editor Requirements:** Viewport, scene hierarchy, property inspector, asset browser, toolbar, menu system
**Recommended Path:** ImGui for immediate prototyping, evaluate wxWidgets/Qt for production

---

## Current UI Implementation

### Input System: Console Keyboard Polling

**File:** TestManager.h, lines 121-220

**Implementation:**
```cpp
#include <conio.h>  // Line 2 (Windows-specific header)

void handleInput() {
    if (_kbhit()) {  // Non-blocking keyboard check (line 122)
        char key = _getch();  // Blocking read (returns immediately if _kbhit() true)
        bool needRefresh = true;

        switch (key) {
            // Stage selection
            case '1': setStage(Assignment4Stage::STAR_FIELD); break;         // Line 128
            case '2': setStage(Assignment4Stage::DIRECTIONAL_LIGHT); break;  // Line 130
            case '3': setStage(Assignment4Stage::POINT_LIGHT); break;        // Line 131

            // Camera controls (WASD + QE)
            case 'w': case 'W':  // Line 134
                cameraHeight += moveSpeed;
                camera->setHeight(cameraHeight);
                camera->updateCameraMatrix(cameraRotationAngle);
                break;
            case 's': case 'S':  // Line 142
                cameraHeight -= moveSpeed;
                // ... (similar pattern)
                break;
            case 'a': case 'A':  // Line 150 (rotate left)
                cameraRotationAngle += rotationSpeed;
                camera->updateCameraMatrix(cameraRotationAngle);
                break;
            case 'd': case 'D':  // Line 158 (rotate right)
                cameraRotationAngle -= rotationSpeed;
                // ...
                break;
            case 'q': case 'Q':  // Line 164 (zoom in)
                cameraDistance -= moveSpeed;
                camera->setDistance(cameraDistance);
                // ...
                break;
            case 'e': case 'E':  // Line 172 (zoom out)
                cameraDistance += moveSpeed;
                // ...
                break;

            // Toggles
            case 'g': case 'G':  // Line 180 (toggle grid)
                showGrid = !showGrid;
                break;
            case 'v': case 'V':  // Line 184 (toggle debug viz)
                debugVisualization = !debugVisualization;
                break;

            // Function keys (F1-F4)
            case 59:  // F1 (line 187) — Debug stars
                currentDebugMode = DebugMode::STARS;
                debugVisualization = true;
                break;
            case 60:  // F2 (line 191) — Debug grid
                currentDebugMode = DebugMode::GRID;
                // ...
                break;
            case 61:  // F3 (line 195) — Debug all
                currentDebugMode = DebugMode::ALL;
                // ...
                break;
            case 62:  // F4 (line 199) — Disable debug
                debugVisualization = false;
                currentDebugMode = DebugMode::NONE;
                break;

            case 'l': case 'L':  // Line 203 (cycle light modes)
                currentLightTestMode = static_cast<LightTestMode>(
                    (static_cast<int>(currentLightTestMode) + 1) % 4
                );
                updateLightingDebugTest(currentLightTestMode);
                break;

            default:
                needRefresh = false;  // Line 212
        }

        if (needRefresh) {
            displayMenu();  // Re-print console menu (line 216)
        }
    }
}
```

**Platform Dependency:**
- `_kbhit()` — Windows-only (NOT POSIX, NOT cross-platform)
- `_getch()` — Windows-only
- **Linux/macOS Alternative:** ncurses library (requires complete rewrite)

### Output System: Console Text Menu

**File:** TestManager.h, lines 101-119

**Implementation:**
```cpp
void displayMenu() {
    system("cls");  // Line 102 (Windows-only — clears console screen)
    std::cout << "Assignment 4: Lighting and Model Loading\n\n";  // Line 103
    std::cout << "Current Progress: " << getStageDescription() << "\n\n";

    std::cout << "Controls:\n";
    std::cout << "  1-3: Change implementation stage (25%, 50%, 75%, 100%)\n";
    std::cout << "  W/S: Adjust camera height\n";
    std::cout << "  A/D: Rotate camera\n";
    std::cout << "  Q/E: Zoom in/out\n";
    std::cout << "  G: Toggle grid\n";

    std::cout << "Debug Options:\n";
    std::cout << "  V: Toggle debug visualization\n";
    std::cout << "  F1: Debug stars\n";
    std::cout << "  F2: Debug grid\n";
    std::cout << "  F3: Debug all\n";
    std::cout << "  F4: Disable debug visualization\n";

    std::cout << "\nCurrent Debug Mode: " << getDebugModeString() << "\n";  // Line 117
    std::cout << "\nPress any key to continue...\n";
}
```

**Example Output:**
```
Assignment 4: Lighting and Model Loading

Current Progress: Point Light with Attenuation (100%)

Controls:
  1-3: Change implementation stage (25%, 50%, 75%, 100%)
  W/S: Adjust camera height
  A/D: Rotate camera
  Q/E: Zoom in/out
  G: Toggle grid
Debug Options:
  V: Toggle debug visualization
  F1: Debug stars
  F2: Debug grid
  F3: Debug all
  F4: Disable debug visualization

Current Debug Mode: Off

Press any key to continue...
```

**Limitations:**
- No visual feedback (text-only, no graphics overlays)
- No mouse support
- No drag-and-drop
- No real-time parameter sliders
- Menu disappears when rendering starts
- Cannot see values change in real-time

### Window System: External RasterSurface Library

**File:** main.cpp, lines 21-26, 38

**API:**
```cpp
#include "RasterSurface.h"  // Line 2 (external library, implementation not present)

bool RS_Initialize(const char* windowTitle, unsigned int width, unsigned int height);
bool RS_Update(unsigned int* pixelBuffer, unsigned int pixelCount);  // Returns false when window closed
void RS_Shutdown();
```

**Usage:**
```cpp
if (!RS_Initialize("MarusDaley Graphic Engine Demo", 600, 500)) {  // Line 21
    std::cout << "failed to intitialize" << std::endl;
    return -1;
}

while (RS_Update(graphics.getPixels(), GraphicsConstrants::kTotalPixels)) {  // Line 29
    testManager.update();
    testManager.render();
    Sleep(1);
}

RS_Shutdown();  // Line 38
```

**RasterSurface Responsibilities (Inferred):**
- Create native window (Win32 API? SDL? GLFW? Unknown)
- Handle window events (close, minimize, resize — not exposed to application)
- Blit framebuffer to window surface
- No mouse input API exposed
- No window resize callback
- No UI widget support

**Platform:** Windows-only (based on `_kbhit` usage — Linux/macOS would require different implementation)

---

## UI Framework Inventory

**Frameworks Found:** NONE

### Searched For (Not Present):

#### ImGui (Dear ImGui)
- **Files:** imgui.h, imgui.cpp, imgui_impl_*.cpp
- **Status:** ❌ Not found
- **Purpose:** Immediate-mode GUI for debug panels, property editors, scene hierarchy

#### wxWidgets
- **Files:** wx/*.h
- **Status:** ❌ Not found
- **Purpose:** Retained-mode GUI for production editor (cross-platform)

#### Qt
- **Files:** QWidget, QMainWindow, etc.
- **Status:** ❌ Not found
- **Purpose:** Retained-mode GUI for production editor (cross-platform, commercial license required)

#### Native Win32 GUI
- **Files:** <windows.h> with WndProc, CreateWindow, etc.
- **Status:** ❌ Not used directly (may be inside RasterSurface.h)
- **Purpose:** Windows-native UI (not cross-platform)

#### SDL2
- **Files:** SDL.h
- **Status:** ❌ Not found (RasterSurface may use it internally)
- **Purpose:** Cross-platform windowing, input, OpenGL context

#### GLFW
- **Files:** GLFW/glfw3.h
- **Status:** ❌ Not found
- **Purpose:** Lightweight cross-platform windowing for OpenGL/Vulkan

---

## 3D Editor Requirements Analysis

### Essential UI Components for BrightForge Editor

Based on BRIGHTFORGE_MASTER.md and industry-standard 3D editors (Unreal, Unity, Blender):

#### 1. Viewport Panel (PRIMARY)
**Purpose:** Real-time 3D scene rendering with camera controls

**Requirements:**
- Multi-viewport support (Perspective, Top, Front, Side)
- Gizmos for transform manipulation (translate, rotate, scale)
- Grid overlay with snapping
- Selection highlighting
- Camera controls:
  - Orbit (hold Alt + LMB drag)
  - Pan (hold Alt + MMB drag)
  - Zoom (mouse wheel)
  - WASD fly-through camera
- Viewport shading modes:
  - Wireframe
  - Solid shading
  - Textured
  - Lit (with lighting preview)
- Debug overlays:
  - FPS counter
  - Draw call count
  - Triangle count
  - GPU memory usage

**Current Implementation:** ❌ None — software rasterizer renders full window, no overlay UI

#### 2. Scene Hierarchy Panel
**Purpose:** Tree view of all objects in the scene

**Requirements:**
- Hierarchical tree (parent-child relationships)
- Object visibility toggles (eye icon)
- Selection (click to select in viewport)
- Drag-and-drop for reparenting
- Search/filter
- Context menu (right-click):
  - Create child object
  - Duplicate
  - Delete
  - Rename

**Current Implementation:** ❌ None — no scene graph data structure

#### 3. Property Inspector Panel
**Purpose:** Edit selected object properties

**Requirements:**
- Transform (position, rotation, scale) with numeric input
- Component list (mesh, material, collider, script, etc.)
- Material properties:
  - Albedo color picker
  - Texture slots (drag-and-drop)
  - Metallic/roughness sliders
  - Normal map, AO, emissive
- Physics properties (mass, friction, restitution)
- Scripting properties (exposed variables)

**Current Implementation:** ❌ None — lighting params hardcoded in TestManager.h

#### 4. Asset Browser Panel
**Purpose:** File system view of project assets

**Requirements:**
- Thumbnail previews (meshes, textures, materials)
- Folder navigation
- Drag-and-drop into scene
- Asset import (FBX, OBJ, PNG, JPG, etc.)
- Asset creation (new material, new script)
- Right-click context menu (delete, rename, duplicate)

**Current Implementation:** ❌ None — StoneHenge model is hardcoded in header files

#### 5. Toolbar
**Purpose:** Quick access to common tools

**Requirements:**
- Transform gizmo mode (translate, rotate, scale)
- Coordinate space toggle (world, local)
- Snap settings (grid snap, rotation snap)
- Play/Pause/Stop buttons (for runtime testing)
- Build/Run button

**Current Implementation:** ❌ None — test stages changed via keyboard '1', '2', '3'

#### 6. Menu Bar
**Purpose:** File operations and editor settings

**Requirements:**
- File menu:
  - New scene
  - Open scene
  - Save scene
  - Export (FBX, OBJ, GLTF)
  - Exit
- Edit menu:
  - Undo/Redo
  - Cut/Copy/Paste
  - Preferences
- View menu:
  - Toggle panels
  - Camera bookmarks
  - Shading modes
- Help menu:
  - Documentation
  - About

**Current Implementation:** ❌ None — console menu only

#### 7. Status Bar
**Purpose:** Real-time feedback and notifications

**Requirements:**
- Progress bars (asset import, scene loading)
- Error/warning messages
- FPS counter
- Selected object name
- Viewport camera position

**Current Implementation:** ❌ None

---

## Framework Comparison for BrightForge

### Option 1: ImGui (Dear ImGui)

**Pros:**
- ✅ **Immediate-Mode:** Perfect for debug UI and rapid prototyping
- ✅ **Rendering Agnostic:** Works with Vulkan, OpenGL, DirectX, software rasterizer
- ✅ **Lightweight:** Single-header library, minimal dependencies
- ✅ **Industry Standard:** Used in Unreal, Unity, CryEngine debug tools
- ✅ **Open Source:** MIT license (no restrictions)
- ✅ **Docking:** Built-in docking system for panels (ImGuiDockSpace)
- ✅ **Widgets:** Sliders, color pickers, tree views, text input, drag-and-drop
- ✅ **Integration:** Example backends for Win32, GLFW, SDL2, Vulkan, OpenGL

**Cons:**
- ❌ **No Retained Mode:** State must be managed by application (not ideal for complex editors)
- ❌ **Limited Layout:** Manual window positioning (not auto-layout like Qt)
- ❌ **Styling:** Limited theming (functional, not beautiful out-of-box)
- ❌ **Text Editing:** Basic text input (no syntax highlighting, auto-complete)

**Best For:** Debug panels, quick prototypes, runtime editors

**Integration Effort:** Low (2-3 days)
- Add imgui.h, imgui.cpp, imgui_impl_win32.cpp, imgui_impl_vulkan.cpp
- Hook into RasterSurface window events
- Render ImGui after scene rendering

**Example Code:**
```cpp
// In main loop
ImGui_ImplVulkan_NewFrame();
ImGui_ImplWin32_NewFrame();
ImGui::NewFrame();

// UI code
if (ImGui::Begin("Scene Hierarchy")) {
    for (auto& obj : sceneObjects) {
        if (ImGui::Selectable(obj.name.c_str(), obj.isSelected)) {
            obj.isSelected = !obj.isSelected;
        }
    }
}
ImGui::End();

if (ImGui::Begin("Properties")) {
    ImGui::DragFloat3("Position", selectedObject.position);
    ImGui::ColorEdit3("Color", selectedObject.color);
}
ImGui::End();

ImGui::Render();
ImGui_ImplVulkan_RenderDrawData(ImGui::GetDrawData(), commandBuffer);
```

### Option 2: wxWidgets

**Pros:**
- ✅ **Native Look:** Uses platform-native widgets (Win32, GTK, Cocoa)
- ✅ **Cross-Platform:** Windows, Linux, macOS
- ✅ **Retained Mode:** Automatic layout, event handling, state management
- ✅ **Rich Widgets:** Tree controls, property grids, toolbars, menus, dialogs
- ✅ **Mature:** 30+ years of development
- ✅ **Open Source:** wxWindows license (LGPL-like)

**Cons:**
- ❌ **Heavy:** Large codebase, many dependencies
- ❌ **Learning Curve:** Steeper than ImGui
- ❌ **Rendering Integration:** Harder to embed Vulkan/OpenGL viewport
- ❌ **Styling:** Limited theming (native widgets hard to customize)

**Best For:** Production editors with native OS integration

**Integration Effort:** High (2-3 weeks)
- Set up wxWidgets build system
- Create wxFrame main window
- Embed Vulkan/OpenGL viewport in wxPanel
- Implement custom controls for 3D-specific features

### Option 3: Qt

**Pros:**
- ✅ **Professional:** Industry-standard for commercial editors (Maya, Blender 2.7 used Qt-like system)
- ✅ **QML:** Declarative UI language (like HTML/CSS for desktop apps)
- ✅ **Cross-Platform:** Windows, Linux, macOS, Android, iOS, embedded
- ✅ **Rich Widgets:** Everything wxWidgets has + more
- ✅ **Designer:** Qt Designer for visual UI layout
- ✅ **Rendering Integration:** QVulkanWindow for easy Vulkan embedding

**Cons:**
- ❌ **License:** LGPL (open source) OR Commercial ($5500+/year for closed-source)
- ❌ **Size:** Very large framework (100+ MB SDK)
- ❌ **Learning Curve:** Steepest of all options
- ❌ **Build Complexity:** Requires CMake + Qt build tools

**Best For:** Commercial-grade editors with budget for licensing

**Integration Effort:** Very High (4-6 weeks)

### Option 4: Custom Win32 GUI

**Pros:**
- ✅ **Full Control:** No third-party dependencies
- ✅ **Lightweight:** Only what you implement
- ✅ **Learning:** Deep understanding of OS windowing

**Cons:**
- ❌ **Windows-Only:** Not cross-platform
- ❌ **Reinventing Wheel:** Months of work to match ImGui/wxWidgets features
- ❌ **Maintenance:** All bugs are yours to fix

**Best For:** Windows-only projects with unique UI requirements

**Integration Effort:** Extreme (3-6 months for basic editor)

---

## Recommended Approach

### Phase 1: ImGui Prototype (Weeks 1-2)

**Goal:** Get basic 3D editor UI running quickly

**Implementation:**
1. Add ImGui to project (imgui_impl_win32.cpp + imgui_impl_vulkan.cpp)
2. Create dockable workspace:
   - Viewport panel (embed Vulkan/software rasterizer output)
   - Scene hierarchy (ImGui::TreeNode)
   - Properties panel (ImGui::DragFloat3, ImGui::ColorEdit)
   - Console output (ImGui::TextUnformatted)
3. Replace `_kbhit()` keyboard input with ImGui input handling
4. Add mouse picking for object selection

**Deliverables:**
- Functional 3D editor UI
- Proof-of-concept for Vulkan integration
- User feedback on workflow

**Code Estimate:** ~500 lines (UI) + ~300 lines (input) + ~200 lines (selection)

### Phase 2: Evaluate for Production (Week 3)

**Decision Criteria:**
- Does ImGui feel responsive enough for daily use?
- Do users want native OS integration (file dialogs, drag-from-Explorer)?
- Is immediate-mode state management becoming cumbersome?

**Options:**
- **If Yes to ImGui:** Continue with ImGui, add custom widgets (color grading curves, shader node editor)
- **If No:** Migrate to wxWidgets or Qt

### Phase 3: Production Editor (Months 2-3)

**If staying with ImGui:**
- Add advanced widgets (node graph editor, timeline)
- Custom rendering for thumbnails
- Improve styling (custom theme, icons)

**If migrating to wxWidgets/Qt:**
- Port ImGui prototype logic to retained-mode framework
- Implement native file dialogs, context menus
- Add professional polish (icons, animations, tooltips)

---

## Input System Requirements

### Current Input (Console-Only)

**Keyboard:**
- Polling via `_kbhit()` / `_getch()`
- No key repeat
- No modifier keys (Shift, Ctrl, Alt)
- No international keyboard support

**Mouse:**
- ❌ Not implemented

### Required Input for 3D Editor

**Keyboard:**
- ✅ Key down/up events (not just polling)
- ✅ Modifier keys (Shift+Click for multi-select, Ctrl+S for save)
- ✅ Hotkeys (F = Frame selected, G = Grab/Move, R = Rotate, S = Scale)
- ✅ Text input (for property editing, search, rename)

**Mouse:**
- ✅ Button events (down, up, double-click)
- ✅ Position (pixel coordinates)
- ✅ Drag (start, move, end)
- ✅ Scroll (zoom, scroll panels)
- ✅ Context menus (right-click)

**3D Viewport Specific:**
- ✅ Raycast from mouse position into scene (for picking)
- ✅ Gizmo interaction (click-drag on arrow/plane/circle)
- ✅ Camera controls:
  - Orbit: Alt + LMB drag
  - Pan: Alt + MMB drag
  - Zoom: Mouse wheel
  - Fly: WASD + mouse look (RMB held)

**Implementation Strategy:**
- **Phase 1 (ImGui):** Use ImGui input system (ImGui::IsKeyPressed, ImGui::GetMousePos, etc.)
- **Phase 2 (Vulkan):** Hook Win32 WM_KEYDOWN/WM_MOUSEMOVE events (or SDL2/GLFW event callbacks)

---

## File I/O Requirements

### Current File I/O (Hardcoded Data)

**Models:**
- StoneHenge vertices/indices embedded in StoneHenge.h/cpp (line 15, TestManager.h)
- Texture data in StoneHenge_Texture.h
- **No runtime loading**

**Scenes:**
- ❌ No scene save/load
- ❌ No serialization

### Required File I/O for 3D Editor

**Asset Import:**
- ✅ Mesh formats: FBX, OBJ, GLTF, STL
- ✅ Texture formats: PNG, JPG, TGA, DDS, EXR
- ✅ Material formats: MTL (OBJ materials), custom JSON/YAML

**Scene Persistence:**
- ✅ Scene format: JSON, YAML, or binary (custom)
- ✅ Prefab system (reusable object templates)
- ✅ Version control friendly (text-based preferred)

**Export:**
- ✅ Standalone build (executable + assets)
- ✅ Mesh export (FBX, OBJ, GLTF)

**File Dialogs:**
- **ImGui:** Use ImGuiFileDialog (third-party library)
- **wxWidgets/Qt:** Native file dialogs built-in

**Implementation Libraries:**
- **Mesh Import:** Assimp (supports 40+ formats)
- **Image Loading:** stb_image.h (single-header, PNG/JPG/TGA/BMP)
- **Serialization:** nlohmann/json (header-only JSON library) or yaml-cpp

---

## Critical UI Gaps

### 1. No Mouse Support (CRITICAL)

**Impact:** Cannot implement 3D viewport interaction
- No object picking
- No gizmo manipulation
- No viewport camera controls

**Solution:** Add mouse input via RasterSurface extension OR migrate to SDL2/GLFW

### 2. No Overlay Rendering (CRITICAL)

**Impact:** Cannot draw UI on top of 3D scene
- No gizmos (translate/rotate/scale arrows)
- No selection outlines
- No debug text overlays (FPS, object names)

**Solution:**
- **ImGui:** Render ImGui AFTER scene rendering
- **Custom:** Implement 2D overlay renderer (sprites, lines, text)

### 3. No Event System (HIGH)

**Impact:** Cannot decouple UI from logic
- TestManager directly manipulates renderer state
- No undo/redo (requires event log)
- No scripting hooks

**Solution:** Implement observer pattern (EventBus.h from BRIGHTFORGE_MASTER.md)

### 4. No Window Resize Handling (MEDIUM)

**Impact:** 600×500 resolution is hardcoded
- Cannot resize window (aspect ratio breaks)
- Cannot support multi-monitor setups

**Solution:** Add RS_OnResize callback, recreate framebuffers dynamically

### 5. No Undo/Redo (HIGH)

**Impact:** Every action is permanent
- Accidental deletions unrecoverable
- No experimentation workflow

**Solution:** Command pattern (store reverse operations in stack)

---

## Estimated Effort

| Task | Effort | Dependency |
|------|--------|------------|
| Add ImGui integration | 2 days | SDL2 or Win32 event hooks |
| Basic viewport panel | 1 day | ImGui |
| Scene hierarchy | 2 days | Scene graph data structure |
| Property inspector | 3 days | Reflection system or manual bindings |
| Asset browser | 3 days | File system API + thumbnails |
| Mouse picking | 2 days | Raycast implementation |
| Transform gizmos | 4 days | Custom 3D widget rendering |
| Undo/Redo | 3 days | Command pattern |
| **Total (ImGui path)** | **20 days** | — |

| Task | Effort | Dependency |
|------|--------|------------|
| wxWidgets setup | 3 days | Build system integration |
| Main window + panels | 5 days | wxWidgets frame layout |
| Vulkan viewport embed | 3 days | wxGLCanvas or custom |
| Scene hierarchy | 4 days | wxTreeCtrl |
| Property grid | 4 days | wxPropertyGrid |
| Asset browser | 5 days | wxDirCtrl + thumbnails |
| **Total (wxWidgets path)** | **24 days** | — |

---

## Recommendations

### Immediate (Phase 1)

1. **Add SDL2 or GLFW:**
   - Replace RasterSurface.h with SDL2 (cross-platform, well-documented)
   - Get mouse input, keyboard events, window resize callbacks

2. **Integrate ImGui:**
   - Use imgui_impl_sdl2.cpp + imgui_impl_vulkan.cpp (or imgui_impl_opengl3.cpp for software rasterizer)
   - Create dockable workspace with 4 panels (viewport, hierarchy, properties, console)

3. **Replace Console UI:**
   - Remove `_kbhit()` / `_getch()` input system
   - Remove `system("cls")` menu
   - Use ImGui::Text() for all UI output

### Near-Term (Phase 2)

4. **Implement Scene Graph:**
   - SceneObject class (transform, children, components)
   - SceneManager (add/remove objects, selection, serialization)

5. **Add Mouse Picking:**
   - Raycast from viewport mouse position
   - Highlight selected object in hierarchy + viewport

6. **Basic Asset Import:**
   - Integrate Assimp for mesh loading
   - Add stb_image for texture loading
   - Create asset browser panel (file list + thumbnail previews)

### Long-Term (Phase 3)

7. **Evaluate Production Framework:**
   - After 1 month with ImGui, decide if it meets long-term needs
   - If migrating, start wxWidgets/Qt port

8. **Advanced Features:**
   - Node-based material editor (ImNodes library)
   - Animation timeline
   - Profiler visualization

---

**Next Steps:** Proceed to Task 1.4 (coupling_report.md) to document all tight coupling issues with severity ratings (global state, hardcoded values, etc.).
