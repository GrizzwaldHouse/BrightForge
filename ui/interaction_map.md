# BrightForge Interaction Map
Developer: Marcus Daley
Date: 2026-04-14
Purpose: Visual diagrams of all event flows between UI components, controllers, and services

---

## Event Flow Diagrams

### 1. Application Startup Flow

```
EditorApplication::Initialize()
  │
  ├─→ EventBus::Initialize()
  │   └─→ Create global event bus singleton
  │
  ├─→ QuoteSystem::Initialize()
  │   └─→ Log INFO: "Application starting"
  │
  ├─→ ConfigService::LoadLayout("default_layout.json")
  │   ├─→ Read JSON file
  │   ├─→ Validate panel dimensions (clamp to min/max)
  │   └─→ Emit layout.loaded {config: LayoutConfig}
  │
  ├─→ LayoutManager::Subscribe("layout.loaded")
  │   ├─→ Apply panel sizes to UI
  │   ├─→ Apply collapsed states
  │   └─→ Restore camera position
  │
  ├─→ FileService::Initialize()
  │   ├─→ Load metadata.json (asset database)
  │   ├─→ Validate thumbnail cache exists
  │   └─→ Emit assets.loaded {files: FileMetadata[]}
  │
  ├─→ RenderService::Initialize()
  │   ├─→ Create Vulkan surface
  │   ├─→ Compile shaders (PBR fragment shader)
  │   ├─→ Initialize scene graph (empty)
  │   └─→ Emit renderer.ready {}
  │
  ├─→ PerformanceMonitor::Start()
  │   └─→ Begin FPS/memory tracking loop (1000ms interval)
  │
  └─→ MainWindow::Show()
      └─→ Render first frame
```

---

### 2. File Upload Flow (Drag-and-Drop)

```
User drags file.obj into window
  │
  ↓
OS sends drag event to window
  │
  ↓
DragDropZone::OnDragEnter(event)
  │
  ├─→ EventBus.Publish("drag.enter", {})
  │
  └─→ Update internal state: DRAG_OVER
      └─→ Render highlighted border (--accent-primary)
          └─→ Animate upload icon (pulse effect)

User releases mouse (drop event)
  │
  ↓
DragDropZone::OnDrop(event)
  │
  ├─→ Extract FileList from event.dataTransfer
  │
  ├─→ EventBus.Publish("file.dropped", {files: FileList})
  │
  └─→ Update internal state: UPLOADING
      └─→ Render progress bar at 0%

FileService::OnFileDropped(event)  ← Subscribed to "file.dropped"
  │
  ├─→ For each file in event.files:
  │   │
  │   ├─→ Validate extension (check whitelist)
  │   │   ├─ Invalid → EventBus.Publish("upload.error", {filename, reason: "Unsupported format"})
  │   │   │            QuoteSystem.Log(ERROR_MSG, "Invalid file: " + filename)
  │   │   │            return
  │   │   └─ Valid   → Continue
  │   │
  │   ├─→ Validate file size (max 500MB mesh, 50MB texture)
  │   │   ├─ Too large → EventBus.Publish("upload.error", {filename, reason: "File too large"})
  │   │   │              return
  │   │   └─ OK       → Continue
  │   │
  │   ├─→ Read file header (first 16 bytes)
  │   │   └─→ Validate magic number (PNG: 89 50 4E 47, JPG: FF D8 FF, etc.)
  │   │       ├─ Mismatch → EventBus.Publish("upload.error", {filename, reason: "Corrupt file"})
  │   │       │              return
  │   │       └─ Match    → Continue
  │   │
  │   ├─→ Generate unique fileId (UUID v4)
  │   │
  │   ├─→ Copy file to assets directory: {projectRoot}/assets/{fileId}.{ext}
  │   │   └─→ EventBus.Publish("upload.progress", {filename, percent: 50})
  │   │
  │   ├─→ Generate thumbnails:
  │   │   ├─ For textures: Load image, scale to 128x128 and 32x32, save PNG
  │   │   └─ For meshes:   Load mesh, render wireframe, save 128x128 and 32x32 PNG
  │   │   └─→ EventBus.Publish("upload.progress", {filename, percent: 75})
  │   │
  │   ├─→ Read metadata:
  │   │   ├─ For textures: width, height, format
  │   │   └─ For meshes:   vertex count, triangle count, bounding box
  │   │
  │   ├─→ Write metadata.json entry:
  │   │   {
  │   │     fileId: "uuid",
  │   │     path: "assets/uuid.obj",
  │   │     name: "file.obj",
  │   │     extension: "obj",
  │   │     type: "mesh",
  │   │     tags: [],
  │   │     stats: {triangles: 1234, vertices: 5678},
  │   │     timestamp: "2026-04-14T12:00:00Z"
  │   │   }
  │   │
  │   └─→ EventBus.Publish("file.uploaded", {fileId, path, type})
  │       └─→ QuoteSystem.Log(SUCCESS, "File uploaded: " + filename)
  │
  └─→ EventBus.Publish("upload.progress", {filename, percent: 100})

DragDropZone::OnFileUploaded(event)  ← Subscribed to "file.uploaded"
  │
  └─→ Update internal state: SUCCESS
      ├─→ Render checkmark icon + green border
      ├─→ Start 2-second timer
      └─→ Timer expires → Update state to IDLE

AssetBrowser::OnFileUploaded(event)  ← Subscribed to "file.uploaded"
  │
  └─→ FileList::AddFile(event.fileId)
      ├─→ Load metadata from FileService
      ├─→ Load thumbnail from cache (.brightforge/thumbnails/{fileId}_128.png)
      └─→ Re-render grid/list view with new file
```

---

### 3. Search and Filter Flow

```
User presses Ctrl+F
  │
  ↓
MainWindow::OnKeyDown(event)
  │
  ├─→ Check if key == Ctrl+F
  │
  └─→ EventBus.Publish("search.focused", {})

FileSearchBox::OnSearchFocused(event)  ← Subscribed to "search.focused"
  │
  └─→ InputField::Focus()
      └─→ Render highlighted border (--accent-primary)

User types "castle type:mesh"
  │
  ↓
FileSearchBox::OnInputChanged(event)
  │
  ├─→ Read current text value: "castle type:mesh"
  │
  ├─→ Start 300ms debounce timer (cancel previous timer if exists)
  │
  └─→ Timer expires (300ms of no typing)
      └─→ EventBus.Publish("search.changed", {query: "castle type:mesh"})

FileList::OnSearchChanged(event)  ← Subscribed to "search.changed"
  │
  ├─→ Parse query into tokens:
  │   ├─ typeFilter = "mesh"
  │   └─ textQuery = ["castle"]
  │
  ├─→ Filter internal file array:
  │   │
  │   └─→ For each file:
  │       ├─ Check type filter: file.type == "mesh" ? keep : discard
  │       ├─ Check text query: file.name.includes("castle") ? keep : discard
  │       └─ Add to filteredFiles[] if passes all checks
  │
  ├─→ Clear current grid/list display
  │
  └─→ Re-render with filteredFiles[] (only matching files shown)

User clicks X button (clear search)
  │
  ↓
FileSearchBox::OnClearButtonClicked(event)
  │
  ├─→ Clear input field text
  │
  └─→ EventBus.Publish("search.cleared", {})

FileList::OnSearchCleared(event)  ← Subscribed to "search.cleared"
  │
  ├─→ Reset filteredFiles[] to all files
  │
  └─→ Re-render with complete file list
```

---

### 4. Asset Loading Flow (Double-Click)

```
User double-clicks mesh file in FileList
  │
  ↓
FileList::OnDoubleClick(event)
  │
  ├─→ Get clicked file's fileId from grid/list item
  │
  └─→ EventBus.Publish("file.loaded", {fileId: "uuid-1234"})

RenderService::OnFileLoaded(event)  ← Subscribed to "file.loaded"
  │
  ├─→ FileService::GetMetadata(event.fileId)
  │   └─→ Returns {path: "assets/uuid-1234.obj", type: "mesh", ...}
  │
  ├─→ Check file type:
  │   ├─ If "mesh":   → LoadMesh(path)
  │   └─ If "texture": → ShowTextureAssignmentDialog(path)
  │
  ├─→ LoadMesh(path):
  │   │
  │   ├─→ Determine importer based on extension:
  │   │   ├─ .obj  → OBJImporter::Load(path)
  │   │   ├─ .fbx  → FBXImporter::Load(path)
  │   │   └─ .gltf → GLTFImporter::Load(path)
  │   │
  │   ├─→ Parse file into Mesh data structure:
  │   │   {
  │   │     vertices: Vector3[],
  │   │     normals: Vector3[],
  │   │     uvs: Vector2[],
  │   │     indices: uint32[],
  │   │     materials: Material[]
  │   │   }
  │   │
  │   ├─→ Validate mesh:
  │   │   ├─ Check for degenerate triangles (area == 0)
  │   │   ├─ Check for NaN/Inf values in vertices
  │   │   └─ If invalid:
  │   │       └─→ EventBus.Publish("load.error", {fileId, reason: "Corrupt mesh"})
  │   │           QuoteSystem.Log(ERROR_MSG, "Mesh validation failed")
  │   │           return
  │   │
  │   ├─→ Upload mesh to GPU:
  │   │   ├─→ Create vertex buffer (Vulkan VkBuffer)
  │   │   ├─→ Create index buffer
  │   │   └─→ Create descriptor set for material textures
  │   │
  │   ├─→ Add mesh to scene graph:
  │   │   └─→ SceneGraph::AddObject(meshId, transform: identity at origin)
  │   │
  │   └─→ EventBus.Publish("scene.updated", {stats: {triangles: 1234, vertices: 5678}})
  │       QuoteSystem.Log(SUCCESS, "Mesh loaded: " + filename)
  │
  └─→ EventBus.Publish("object.selected", {objectId: meshId})

Viewport::OnSceneUpdated(event)  ← Subscribed to "scene.updated"
  │
  └─→ RenderFrame()
      └─→ Draw mesh at origin (0,0,0) with default material

PropertyInspector::OnObjectSelected(event)  ← Subscribed to "object.selected"
  │
  ├─→ SceneGraph::GetObject(event.objectId)
  │   └─→ Returns {name, transform: {position, rotation, scale}, material}
  │
  ├─→ Populate ObjectProperties panel:
  │   ├─ Name: "mesh_uuid-1234"
  │   ├─ Visible: checkbox (checked)
  │   └─ Lock: checkbox (unchecked)
  │
  ├─→ Populate TransformProperties panel:
  │   ├─ Position: [0.0, 0.0, 0.0]
  │   ├─ Rotation: [0.0, 0.0, 0.0]
  │   └─ Scale: [1.0, 1.0, 1.0]
  │
  └─→ Populate MaterialEditor panel:
      ├─ BaseColor: [1.0, 1.0, 1.0, 1.0]
      ├─ Metallic: 0.0
      ├─ Roughness: 0.5
      ├─ Normal map: (none)
      └─ AO map: (none)

StatusBar::OnSceneUpdated(event)  ← Subscribed to "scene.updated"
  │
  └─→ Update triangle count display: "1,234 tris"
```

---

### 5. Camera Control Flow (Viewport Interaction)

```
User left-clicks and drags in Viewport
  │
  ↓
Viewport::OnMouseDown(event)
  │
  ├─→ Check if mouse over gizmo:
  │   ├─ Yes → Start gizmo drag (see Transform Gizmo Flow)
  │   └─ No  → Start camera orbit
  │
  └─→ Capture mouse input (all mouse move events go to Viewport until release)

Viewport::OnMouseMove(event) [while left button held]
  │
  ├─→ Calculate delta: (currentX - lastX, currentY - lastY)
  │
  ├─→ EventBus.Publish("camera.orbited", {deltaX, deltaY})
  │
  └─→ Store lastX/lastY for next frame

CameraController::OnCameraOrbited(event)  ← Subscribed to "camera.orbited"
  │
  ├─→ Convert screen delta to rotation:
  │   ├─ yaw   += deltaX * sensitivity (default 0.005)
  │   └─ pitch += deltaY * sensitivity
  │
  ├─→ Clamp pitch to [-89°, +89°] (prevent camera flip)
  │
  ├─→ Calculate new camera position (orbit around target):
  │   ├─ distance = length(cameraPos - target)
  │   ├─ newPos.x = target.x + distance * cos(pitch) * sin(yaw)
  │   ├─ newPos.y = target.y + distance * sin(pitch)
  │   └─ newPos.z = target.z + distance * cos(pitch) * cos(yaw)
  │
  ├─→ Update camera position
  │
  └─→ EventBus.Publish("camera.updated", {position, target, up})

Viewport::OnCameraUpdated(event)  ← Subscribed to "camera.updated"
  │
  └─→ RenderFrame()
      └─→ Build view matrix from camera position/target/up
          └─→ Render scene with new camera

User middle-clicks and drags in Viewport
  │
  ↓
Viewport::OnMouseDown(event)
  │
  └─→ Start camera pan mode

Viewport::OnMouseMove(event) [while middle button held]
  │
  ├─→ Calculate delta: (currentX - lastX, currentY - lastY)
  │
  └─→ EventBus.Publish("camera.panned", {deltaX, deltaY})

CameraController::OnCameraPanned(event)  ← Subscribed to "camera.panned"
  │
  ├─→ Convert screen delta to world space:
  │   ├─ right = normalize(cross(forward, up))
  │   ├─ offsetX = right * (deltaX * panSpeed)
  │   └─ offsetY = up * (deltaY * panSpeed)
  │
  ├─→ Move camera and target by offset:
  │   ├─ cameraPos += offsetX + offsetY
  │   └─ target    += offsetX + offsetY
  │
  └─→ EventBus.Publish("camera.updated", {position, target, up})

User scrolls mouse wheel in Viewport
  │
  ↓
Viewport::OnMouseScroll(event)
  │
  ├─→ Get scroll delta: event.deltaY (positive = zoom out, negative = zoom in)
  │
  └─→ EventBus.Publish("camera.zoomed", {delta: event.deltaY})

CameraController::OnCameraZoomed(event)  ← Subscribed to "camera.zoomed"
  │
  ├─→ Calculate zoom factor: delta * zoomSpeed (default 0.1)
  │
  ├─→ Move camera toward/away from target:
  │   ├─ direction = normalize(target - cameraPos)
  │   ├─ cameraPos += direction * zoomFactor
  │   └─ Clamp distance to [minDist=1.0, maxDist=100.0]
  │
  └─→ EventBus.Publish("camera.updated", {position, target, up})
```

---

### 6. Transform Gizmo Flow

```
User clicks object in Viewport
  │
  ↓
Viewport::OnMouseDown(event)
  │
  ├─→ Raycast from mouse position into scene
  │   └─→ Find intersected object (if any)
  │
  ├─→ If object hit:
  │   └─→ EventBus.Publish("object.selected", {objectId})
  │
  └─→ If no object hit:
      └─→ EventBus.Publish("object.deselected", {})

GizmoOverlay::OnObjectSelected(event)  ← Subscribed to "object.selected"
  │
  ├─→ SceneGraph::GetObject(event.objectId)
  │   └─→ Returns {transform: {position, rotation, scale}}
  │
  ├─→ Set gizmo visible: true
  │
  ├─→ Set gizmo position to object position
  │
  └─→ Render gizmo overlay:
      ├─ Red arrow (X axis)
      ├─ Green arrow (Y axis)
      ├─ Blue arrow (Z axis)
      └─ Rotation rings + scale handles (depending on mode)

User clicks and drags red arrow (X axis)
  │
  ↓
GizmoOverlay::OnMouseDown(event)
  │
  ├─→ Raycast from mouse to gizmo geometry
  │   └─→ Check intersection with X arrow (red cone + cylinder)
  │
  ├─→ If hit X arrow:
  │   ├─→ Highlight X arrow (brighter red)
  │   ├─→ Store initial mouse position
  │   ├─→ Store initial object position
  │   └─→ Set dragging state: {axis: X, mode: translate}
  │
  └─→ Capture mouse input

GizmoOverlay::OnMouseMove(event) [while dragging]
  │
  ├─→ Calculate world-space offset along X axis:
  │   ├─ Cast ray from current mouse position
  │   ├─ Project ray onto X axis plane
  │   └─ offset = projectedPoint - initialPoint
  │
  ├─→ Calculate new position:
  │   └─ newPos = initialObjectPos + offset (only X component changes)
  │
  ├─→ If snap enabled (user holding Ctrl):
  │   └─ newPos.x = round(newPos.x / snapIncrement) * snapIncrement
  │
  ├─→ EventBus.Publish("object.transformed", {objectId, transform: {position: newPos}})
  │
  └─→ Update gizmo position to follow object

SceneGraph::OnObjectTransformed(event)  ← Subscribed to "object.transformed"
  │
  ├─→ Find object by objectId
  │
  ├─→ Update object's transform matrix
  │
  └─→ EventBus.Publish("scene.updated", {stats: unchanged})

Viewport::OnSceneUpdated(event)
  │
  └─→ RenderFrame() with updated object position

PropertyInspector::OnObjectTransformed(event)  ← Subscribed to "object.transformed"
  │
  └─→ Update TransformProperties panel:
      └─→ Position X input field: newPos.x (real-time update while dragging)

GizmoOverlay::OnMouseUp(event)
  │
  ├─→ Clear highlighting on red arrow
  │
  ├─→ Clear dragging state
  │
  └─→ Release mouse capture
```

---

### 7. Property Editing Flow

```
User changes Position X in PropertyInspector
  │
  ↓
PropertyInspector::OnInputChanged(event)
  │
  ├─→ Read new value from text input: "5.0"
  │
  ├─→ Validate input:
  │   ├─ Check if valid float (parseFloat succeeds)
  │   ├─ Check if within allowed range (depends on property)
  │   └─ If invalid:
  │       └─→ Highlight input field red, show error tooltip
  │           return
  │
  ├─→ Get currently selected objectId (stored in PropertyInspector state)
  │
  └─→ EventBus.Publish("property.changed", {
        objectId: "uuid-1234",
        property: "transform.position.x",
        value: 5.0
      })

SceneGraph::OnPropertyChanged(event)  ← Subscribed to "property.changed"
  │
  ├─→ Find object by objectId
  │
  ├─→ Parse property path: "transform.position.x"
  │   └─→ Navigate to nested property: object.transform.position.x
  │
  ├─→ Set new value: object.transform.position.x = 5.0
  │
  ├─→ Recompute transform matrix (TRS multiplication)
  │
  └─→ EventBus.Publish("scene.updated", {stats: unchanged})

Viewport::OnSceneUpdated(event)
  │
  └─→ RenderFrame() with updated object position

GizmoOverlay::OnSceneUpdated(event)
  │
  └─→ Update gizmo position to match object's new position

User changes Material Roughness slider
  │
  ↓
PropertyInspector::OnSliderChanged(event)
  │
  ├─→ Read new value: 0.75
  │
  ├─→ Get selected objectId
  │
  ├─→ Get object's materialId from SceneGraph
  │
  └─→ EventBus.Publish("material.changed", {
        materialId: "mat-1234",
        params: {roughness: 0.75}
      })

RenderService::OnMaterialChanged(event)  ← Subscribed to "material.changed"
  │
  ├─→ Find material by materialId
  │
  ├─→ Update material's PBR parameters:
  │   └─→ material.roughness = 0.75
  │
  ├─→ Update GPU uniform buffer:
  │   └─→ Write roughness to shader uniform (vkCmdUpdateBuffer)
  │
  └─→ EventBus.Publish("scene.updated", {stats: unchanged})

Viewport::OnSceneUpdated(event)
  │
  └─→ RenderFrame() with updated material (rougher surface)
```

---

### 8. Panel Resize Flow

```
User hovers over ToolPanel's right edge splitter
  │
  ↓
LayoutManager::OnMouseMove(event)
  │
  ├─→ Check if cursor within 4px of splitter hit target
  │
  └─→ If yes:
      └─→ Change cursor to ew-resize (horizontal arrows)

User clicks and drags splitter
  │
  ↓
LayoutManager::OnMouseDown(event)
  │
  ├─→ Identify which splitter was clicked (ToolPanel right edge)
  │
  ├─→ Store initial mouse X position
  │
  ├─→ Store initial panel width (200px)
  │
  └─→ Set dragging state: {panel: "toolPanel", initialWidth: 200}

LayoutManager::OnMouseMove(event) [while dragging]
  │
  ├─→ Calculate delta: currentX - initialX
  │
  ├─→ Calculate new width: initialWidth + delta
  │
  ├─→ Clamp to constraints: max(minWidth=150, min(newWidth, maxWidth=400))
  │
  ├─→ Update ToolPanel CSS width: clampedWidth
  │
  ├─→ Update Viewport CSS left margin: clampedWidth (to prevent overlap)
  │
  └─→ EventBus.Publish("panel.resized", {panelId: "toolPanel", dimension: clampedWidth})

ConfigService::OnPanelResized(event)  ← Subscribed to "panel.resized"
  │
  ├─→ Update default_layout.json in memory:
  │   └─→ panels.toolPanel.width = event.dimension
  │
  └─→ Debounced write to disk (only write after 1 second of no resize events)

LayoutManager::OnMouseUp(event)
  │
  ├─→ Clear dragging state
  │
  ├─→ Reset cursor to default
  │
  └─→ Trigger ConfigService to write layout to disk
```

---

### 9. Panel Collapse Flow

```
User clicks collapse button (chevron icon) in ToolPanel header
  │
  ↓
ToolPanel::OnCollapseButtonClicked(event)
  │
  ├─→ Toggle internal collapsed state: collapsed = !collapsed
  │
  ├─→ If collapsed:
  │   ├─→ Animate panel width from 200px to 24px (header only)
  │   ├─→ Rotate chevron icon 180° (point right instead of left)
  │   └─→ Hide panel content (display: none)
  │
  ├─→ If expanded:
  │   ├─→ Animate panel width from 24px to last width (200px)
  │   ├─→ Rotate chevron icon back (point left)
  │   └─→ Show panel content (display: block)
  │
  └─→ EventBus.Publish("panel.collapsed", {panelId: "toolPanel", collapsed: true})

LayoutManager::OnPanelCollapsed(event)  ← Subscribed to "panel.collapsed"
  │
  ├─→ Adjust Viewport position to fill space:
  │   └─→ If ToolPanel collapsed: Viewport left margin = 24px
  │       If ToolPanel expanded:  Viewport left margin = 200px
  │
  └─→ Trigger ConfigService to save layout state

ConfigService::OnPanelCollapsed(event)  ← Subscribed to "panel.collapsed"
  │
  └─→ Update default_layout.json:
      └─→ panels.toolPanel.collapsed = event.collapsed
```

---

### 10. Menu Command Flow

```
User clicks File → Save in MenuBar
  │
  ↓
MenuBar::OnMenuItemClicked(event)
  │
  ├─→ Get command name from menu item: "save"
  │
  └─→ EventBus.Publish("menu.command", {command: "save"})

ProjectController::OnMenuCommand(event)  ← Subscribed to "menu.command"
  │
  ├─→ Switch on event.command:
  │   │
  │   ├─ case "save":
  │   │   └─→ SaveProject()
  │   │       ├─→ SceneGraph::Serialize() → JSON
  │   │       ├─→ Write project.json to disk
  │   │       ├─→ QuoteSystem.Log(SUCCESS, "Project saved")
  │   │       └─→ EventBus.Publish("project.saved", {path})
  │   │
  │   ├─ case "undo":
  │   │   └─→ UndoStack::Undo()
  │   │       ├─→ Pop last command from undo stack
  │   │       ├─→ Execute command.Undo() (restore previous state)
  │   │       ├─→ Push command to redo stack
  │   │       └─→ EventBus.Publish("scene.updated", {stats})
  │   │
  │   └─ case "toggle_wireframe":
  │       └─→ RenderService::ToggleWireframe()
  │           └─→ EventBus.Publish("viewport.wireframe", {enabled: true/false})
  │
  └─→ StatusBar::OnProjectSaved(event)  ← Subscribed to "project.saved"
      └─→ Show temporary message: "Project saved at {timestamp}"
```

---

## Event Bus Architecture

### Subscription Model

All components subscribe to events during initialization:

```cpp
// Example: RenderService subscribes to file loading events
class RenderService {
public:
    void Initialize() {
        EventBus::Instance().Subscribe("file.loaded",
            std::bind(&RenderService::OnFileLoaded, this, std::placeholders::_1));

        EventBus::Instance().Subscribe("material.changed",
            std::bind(&RenderService::OnMaterialChanged, this, std::placeholders::_1));
    }

    void OnFileLoaded(const EventPayload& payload) {
        std::string fileId = payload.GetString("fileId");
        LoadMesh(fileId);
    }
};
```

### Event Payload Types

EventPayload supports multiple data types:
- **String**: `EventPayload::String("value")`
- **Int**: `EventPayload::Int(42)`
- **Float**: `EventPayload::Float(3.14f)`
- **Bool**: `EventPayload::Bool(true)`
- **Object**: `EventPayload::Object({{"key", "value"}, {"num", 123}})`
- **Array**: `EventPayload::Array({1, 2, 3})`

### Event Naming Convention

All events use dot-separated namespaces:
- `category.action` (e.g., `file.loaded`, `camera.orbited`)
- Category is the emitter or data type (file, camera, object, scene)
- Action is the verb (loaded, orbited, transformed, updated)

---

## Why Event-Driven Architecture

### Decoupling Benefits
- **FileService** doesn't know about **AssetBrowser** implementation
- **Viewport** doesn't know about **PropertyInspector** layout
- **RenderService** doesn't know about **StatusBar** display logic

### Testability
- Mock EventBus for unit tests (verify events emitted, inject fake events)
- Test components in isolation (emit test events, verify state changes)
- No need for complex dependency injection frameworks

### Extensibility
- Add new panels without modifying existing code (subscribe to events)
- Add new file types without changing UI (FileService emits same events)
- Swap Vulkan for DirectX without touching UI layer (RenderService is isolated)

### Performance
- EventBus uses hash map for O(1) subscription lookup
- Events processed synchronously (same frame, no latency)
- Optional deferred event queue for non-critical updates (reduce frame spikes)
