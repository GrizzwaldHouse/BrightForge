# BrightForge Component Definitions
Developer: Marcus Daley
Date: 2026-04-14
Purpose: Define Props, State, Events, and Slots for all UI components in the 3D editor

---

## Component Architecture Principles

### Event-Driven Communication
All components communicate ONLY through EventBus. No component holds a direct reference to another component.

### State Management
Each component maintains internal state. State changes trigger re-renders. No shared mutable state between components.

### Props vs State
- **Props**: Configuration passed during construction (immutable after init)
- **State**: Internal runtime data (mutable, triggers re-render on change)

### Slots
Slots are render regions where child components can be inserted (similar to web component slots or Qt layouts).

---

## Component Definitions

### 1. MenuBar

**Purpose**: Top-level menu with dropdown commands and quick-access toolbar

#### Props
```cpp
struct MenuBarProps {
    int height = 40;                    // Fixed height in pixels
    bool showQuickToolbar = true;       // Show inline toolbar buttons
    std::vector<MenuItem> menuItems;    // File, Edit, View, Tools, Help
};

struct MenuItem {
    std::string label;                  // "File", "Edit", etc.
    std::vector<MenuCommand> commands;  // Dropdown items
};

struct MenuCommand {
    std::string label;                  // "Save", "Undo", etc.
    std::string commandId;              // "save", "undo" (for event payload)
    std::string shortcut;               // "Ctrl+S" (display only, handled by MainWindow)
    bool enabled = true;                // Gray out if false
    bool separator = false;             // Render as horizontal line if true
};
```

#### State
```cpp
struct MenuBarState {
    std::string activeMenu = "";        // Which dropdown is open ("file", "edit", etc.)
    bool quickToolbarVisible = true;    // Can be hidden via View menu
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `menu.command` | `{command: string}` | User clicks menu item |
| `menu.opened` | `{menuId: string}` | User opens dropdown |
| `menu.closed` | `{menuId: string}` | Dropdown closes |

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `project.saved` | Enable "Save" command (disable if no changes) |
| `undo.available` | Enable "Undo" command |
| `redo.available` | Enable "Redo" command |

#### Slots
- **QuickToolbar**: Horizontal slot for icon buttons (Save, Undo, Redo)

---

### 2. ToolPanel

**Purpose**: Left sidebar with sculpting tools, transform tools, and selection modes

#### Props
```cpp
struct ToolPanelProps {
    int width = 200;                    // Default width in pixels
    int minWidth = 150;                 // Minimum when resizing
    int maxWidth = 400;                 // Maximum when resizing
    bool collapsible = true;            // Show collapse button in header
    std::vector<ToolSection> sections;  // SculptTools, TransformTools, SelectionModes
};

struct ToolSection {
    std::string id;                     // "sculptTools", "transformTools", etc.
    std::string label;                  // "Sculpting", "Transform", etc.
    bool collapsible = true;            // Accordion-style collapse
    bool collapsed = false;             // Initial state
    std::vector<Tool> tools;            // Buttons inside section
};

struct Tool {
    std::string id;                     // "clay", "smooth", "translate", etc.
    std::string label;                  // "Clay", "Smooth", "Translate", etc.
    std::string icon;                   // Path to icon asset
    ToolType type;                      // BUTTON or RADIO_BUTTON
};

enum class ToolType {
    BUTTON,        // Click to activate (sculpt tools)
    RADIO_BUTTON   // Click to select one of group (selection modes)
};
```

#### State
```cpp
struct ToolPanelState {
    int width = 200;                    // Current width (changes on resize)
    bool collapsed = false;             // Panel collapsed to header-only
    std::string selectedTool = "";      // Currently active tool ID
    std::map<std::string, bool> sectionCollapsed;  // Per-section collapse state
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `panel.resized` | `{panelId: "toolPanel", dimension: int}` | User drags right edge splitter |
| `panel.collapsed` | `{panelId: "toolPanel", collapsed: bool}` | User clicks collapse button |
| `tool.selected` | `{toolId: string}` | User clicks tool button |
| `selection.mode` | `{mode: string}` | User clicks selection mode radio button |

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `object.selected` | Enable transform tools (disabled if no selection) |
| `viewport.mode` | Update selected tool highlight |

#### Slots
- **Sections**: Vertical stack of ToolSection components

---

### 3. PropertyInspector

**Purpose**: Right sidebar showing properties of selected object (transform, material)

#### Props
```cpp
struct PropertyInspectorProps {
    int width = 300;                    // Default width in pixels
    int minWidth = 200;                 // Minimum when resizing
    int maxWidth = 500;                 // Maximum when resizing
    bool collapsible = true;            // Show collapse button
    std::vector<PropertySection> sections;  // ObjectProperties, TransformProperties, MaterialEditor
};

struct PropertySection {
    std::string id;                     // "objectProperties", "transformProperties", etc.
    std::string label;                  // "Object", "Transform", etc.
    bool collapsible = true;            // Accordion-style collapse
    bool collapsed = false;             // Initial state
    std::vector<PropertyField> fields;  // Input fields inside section
};

struct PropertyField {
    std::string id;                     // "name", "position.x", "material.roughness", etc.
    std::string label;                  // "Name", "Position X", "Roughness", etc.
    FieldType type;                     // TEXT, FLOAT, COLOR, CHECKBOX, SLIDER
    float minValue = 0.0f;              // For FLOAT and SLIDER
    float maxValue = 1.0f;              // For FLOAT and SLIDER
    float precision = 0.001f;           // Decimal places for FLOAT
    bool readonly = false;              // Gray out if true
};

enum class FieldType {
    TEXT,       // String input (object name)
    FLOAT,      // Numeric input with validation (position, rotation, scale)
    COLOR,      // RGB/RGBA color picker
    CHECKBOX,   // Boolean toggle (visible, locked)
    SLIDER      // Float slider with range (roughness, metallic)
};
```

#### State
```cpp
struct PropertyInspectorState {
    int width = 300;                    // Current width (changes on resize)
    bool collapsed = false;             // Panel collapsed to header-only
    std::string selectedObjectId = "";  // Which object's properties are shown
    std::map<std::string, std::any> fieldValues;  // Current values of all fields
    std::map<std::string, bool> sectionCollapsed;  // Per-section collapse state
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `panel.resized` | `{panelId: "propertyInspector", dimension: int}` | User drags left edge splitter |
| `panel.collapsed` | `{panelId: "propertyInspector", collapsed: bool}` | User clicks collapse button |
| `property.changed` | `{objectId: string, property: string, value: any}` | User edits field (on blur or Enter key) |
| `material.changed` | `{materialId: string, params: PBRParams}` | User edits material property |

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `object.selected` | Load object properties into fields |
| `object.deselected` | Clear all fields, show "No selection" placeholder |
| `object.transformed` | Update transform fields (live during gizmo drag) |
| `scene.updated` | Refresh properties if selected object changed externally |

#### Slots
- **Sections**: Vertical stack of PropertySection components

---

### 4. Viewport

**Purpose**: Main 3D rendering area with camera controls and gizmo overlay

#### Props
```cpp
struct ViewportProps {
    CameraSettings camera;              // Initial camera position, FOV, clipping
    RenderSettings rendering;           // Wireframe, grid, background color
    GizmoSettings gizmo;                // Gizmo visibility, snap settings
};

struct CameraSettings {
    float fov = 60.0f;                  // Field of view in degrees
    float nearClip = 0.1f;              // Near clipping plane
    float farClip = 1000.0f;            // Far clipping plane
    Vector3 position = {0, 5, 10};      // Initial camera position
    Vector3 target = {0, 0, 0};         // Look-at target
    Vector3 up = {0, 1, 0};             // Up vector
};

struct RenderSettings {
    bool wireframe = false;             // Render as wireframe
    bool showGrid = true;               // Show ground grid
    float gridSize = 10.0f;             // Grid size in world units
    int gridSubdivisions = 10;          // Lines per grid square
    bool showAxis = true;               // Show XYZ axis indicator
    Vector4 backgroundColor = {0.12, 0.12, 0.18, 1.0};  // Clear color
};

struct GizmoSettings {
    bool visible = true;                // Show gizmo when object selected
    GizmoMode mode = TRANSLATE;         // TRANSLATE, ROTATE, SCALE
    bool snapEnabled = false;           // Snap to grid
    float snapIncrement = 0.5f;         // Grid snap size
};

enum class GizmoMode {
    TRANSLATE,
    ROTATE,
    SCALE
};
```

#### State
```cpp
struct ViewportState {
    CameraState camera;                 // Current camera position/rotation
    InteractionMode mode = CAMERA;      // CAMERA or GIZMO
    std::string selectedObjectId = "";  // Currently selected object
    bool isDragging = false;            // Mouse button held
    Vector2 lastMousePos;               // For delta calculation
};

struct CameraState {
    Vector3 position;
    Vector3 target;
    Vector3 up;
    float yaw = 0.0f;                   // Orbit rotation
    float pitch = 0.0f;                 // Orbit rotation
    float distance = 10.0f;             // Distance from target
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `camera.orbited` | `{deltaX: float, deltaY: float}` | User left-drags (orbit) |
| `camera.panned` | `{deltaX: float, deltaY: float}` | User middle-drags (pan) |
| `camera.zoomed` | `{delta: float}` | User scrolls mouse wheel |
| `camera.updated` | `{position: Vector3, target: Vector3, up: Vector3}` | Camera state changes |
| `object.selected` | `{objectId: string}` | User clicks object |
| `object.deselected` | `{}` | User clicks empty space |
| `object.transformed` | `{objectId: string, transform: Matrix4x4}` | User drags gizmo |
| `viewport.wireframe` | `{enabled: bool}` | Wireframe mode toggled |

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `scene.updated` | Re-render frame with updated scene graph |
| `camera.frame` | Focus camera on selected object bounding box |
| `gizmo.mode` | Change gizmo to translate/rotate/scale mode |
| `file.dragged` | Instantiate mesh at cursor's 3D world position |

#### Slots
- **GizmoOverlay**: Canvas layer for transform gizmo (rendered on top of scene)

---

### 5. GizmoOverlay

**Purpose**: Interactive transform gizmo for selected objects (translate, rotate, scale)

#### Props
```cpp
struct GizmoOverlayProps {
    GizmoMode mode = TRANSLATE;         // Which gizmo to show
    bool snapEnabled = false;           // Snap to grid
    float snapIncrement = 0.5f;         // Grid snap size
    Vector3 position = {0, 0, 0};       // Gizmo position (object origin)
};
```

#### State
```cpp
struct GizmoOverlayState {
    bool visible = false;               // Hidden if no object selected
    GizmoAxis selectedAxis = NONE;      // Which axis user is dragging (X/Y/Z/NONE)
    Vector3 initialPosition;            // Object position when drag started
    Vector2 initialMousePos;            // Mouse position when drag started
    bool isDragging = false;            // Mouse button held on gizmo
};

enum class GizmoAxis {
    NONE,
    X,
    Y,
    Z,
    XY,     // For plane drags
    XZ,
    YZ
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `object.transformed` | `{objectId: string, transform: Matrix4x4}` | User drags gizmo handle |
| `gizmo.drag.start` | `{axis: string}` | User clicks gizmo handle |
| `gizmo.drag.end` | `{}` | User releases mouse |

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `object.selected` | Show gizmo at object position |
| `object.deselected` | Hide gizmo |
| `gizmo.mode` | Switch between translate/rotate/scale gizmo |
| `scene.updated` | Update gizmo position if object moved externally |

#### Rendering
Gizmo is rendered as 3D geometry overlaid on viewport:
- **Translate**: 3 arrows (red=X, green=Y, blue=Z) + 3 plane handles
- **Rotate**: 3 rings (red=X, green=Y, blue=Z) + view-aligned ring
- **Scale**: 3 arrows with cube handles + center cube (uniform scale)

---

### 6. AssetBrowser

**Purpose**: Bottom panel with drag-drop upload, search, and file browsing

#### Props
```cpp
struct AssetBrowserProps {
    int height = 250;                   // Default height in pixels
    int minHeight = 100;                // Minimum when resizing
    int maxHeight = 600;                // Maximum when resizing
    bool collapsible = true;            // Show collapse button
    ViewMode viewMode = GRID;           // GRID or LIST
    int thumbnailSize = 128;            // Grid thumbnail size (128 or 256)
    SortMode sortBy = NAME;             // NAME, DATE, SIZE, TYPE
    SortOrder sortOrder = ASCENDING;    // ASCENDING or DESCENDING
};

enum class ViewMode {
    GRID,
    LIST
};

enum class SortMode {
    NAME,
    DATE,
    SIZE,
    TYPE
};

enum class SortOrder {
    ASCENDING,
    DESCENDING
};
```

#### State
```cpp
struct AssetBrowserState {
    int height = 250;                   // Current height (changes on resize)
    bool collapsed = false;             // Panel collapsed to header-only
    std::vector<FileMetadata> files;    // All files in project
    std::vector<FileMetadata> filteredFiles;  // Files after search filter
    std::string searchQuery = "";       // Current search text
    std::vector<std::string> selectedFileIds;  // Multi-selection
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `panel.resized` | `{panelId: "assetBrowser", dimension: int}` | User drags top edge splitter |
| `panel.collapsed` | `{panelId: "assetBrowser", collapsed: bool}` | User clicks collapse button |
| `file.selected` | `{fileIds: string[]}` | User clicks file in list |
| `file.loaded` | `{fileId: string}` | User double-clicks file |
| `file.contextmenu` | `{fileId: string, action: string}` | User right-clicks and selects action |
| `file.dragged` | `{fileId: string, worldPosition: Vector3}` | User drags file to viewport |

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `file.uploaded` | Add new file to list and refresh display |
| `file.deleted` | Remove file from list and refresh display |
| `search.changed` | Filter files based on query |
| `search.cleared` | Show all files (clear filter) |

#### Slots
- **DragDropZone**: Fixed height area at top for file uploads
- **FileSearchBox**: Single-line text input below drop zone
- **FileList**: Scrollable grid or list view filling remaining space

---

### 7. DragDropZone

**Purpose**: Visual area for drag-and-drop file uploads

#### Props
```cpp
struct DragDropZoneProps {
    int height = 150;                   // Fixed height in pixels
    std::vector<std::string> acceptedFormats;  // [".obj", ".fbx", ".gltf", ".png", etc.]
    int maxFileSizeMB = 500;            // Maximum file size for meshes
    int maxTextureSizeMB = 50;          // Maximum file size for textures
};
```

#### State
```cpp
struct DragDropZoneState {
    DropState state = IDLE;             // IDLE, DRAG_OVER, UPLOADING, SUCCESS, ERROR
    std::string currentFileName = "";   // File being uploaded
    float uploadProgress = 0.0f;        // 0.0 to 1.0
    std::string errorMessage = "";      // Error reason if state == ERROR
};

enum class DropState {
    IDLE,
    DRAG_OVER,
    UPLOADING,
    SUCCESS,
    ERROR
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `drag.enter` | `{}` | File dragged over zone |
| `drag.leave` | `{}` | File dragged out of zone |
| `file.dropped` | `{files: FileList}` | User drops files |
| `upload.progress` | `{filename: string, percent: float}` | Upload progress update |
| `file.uploaded` | `{fileId: string, path: string, type: string}` | Upload complete |
| `upload.error` | `{filename: string, reason: string}` | Validation or I/O error |
| `upload.cancelled` | `{filename: string}` | User clicks cancel button |

#### Events Subscribed
None (only emits events)

---

### 8. FileSearchBox

**Purpose**: Text input for filtering asset list with filter syntax

#### Props
```cpp
struct FileSearchBoxProps {
    int height = 36;                    // Fixed height in pixels
    std::string placeholder = "Search assets...";  // Placeholder text
    int debounceMs = 300;               // Delay before emitting search.changed
    bool autoSuggestEnabled = false;    // Show dropdown of recent searches (Phase 4 feature)
};
```

#### State
```cpp
struct FileSearchBoxState {
    std::string text = "";              // Current input text
    bool hasFocus = false;              // Input field focused
    std::vector<std::string> recentSearches;  // For auto-suggest dropdown
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `search.focused` | `{}` | Input field gains focus (Ctrl+F) |
| `search.changed` | `{query: string}` | User types (300ms debounce) |
| `search.cleared` | `{}` | User clicks clear button (X) |

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `search.focused` | Focus input field (external trigger via shortcut) |

---

### 9. FileList

**Purpose**: Scrollable grid or list of asset files with thumbnails

#### Props
```cpp
struct FileListProps {
    ViewMode viewMode = GRID;           // GRID or LIST
    int thumbnailSize = 128;            // Grid thumbnail size (128 or 256)
    SortMode sortBy = NAME;             // NAME, DATE, SIZE, TYPE
    SortOrder sortOrder = ASCENDING;    // ASCENDING or DESCENDING
    bool multiSelectEnabled = true;     // Allow Ctrl+click and Shift+click
};
```

#### State
```cpp
struct FileListState {
    std::vector<FileMetadata> files;    // All files
    std::vector<FileMetadata> filteredFiles;  // Files after search filter
    std::vector<std::string> selectedFileIds;  // Multi-selection
    int scrollOffset = 0;               // Vertical scroll position
    std::string contextMenuOpenForId = "";  // Which file's context menu is open
};
```

#### Events Emitted
| Event | Payload | When |
|-------|---------|------|
| `file.selected` | `{fileIds: string[]}` | User clicks file |
| `file.loaded` | `{fileId: string}` | User double-clicks file |
| `file.contextmenu` | `{fileId: string, action: string}` | User right-clicks and selects action |
| `file.dragged` | `{fileId: string, worldPosition: Vector3}` | User drags file to viewport |

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `file.uploaded` | Add file to list and re-render |
| `file.deleted` | Remove file from list and re-render |
| `file.renamed` | Update file name in list and re-render |
| `search.changed` | Filter files and re-render |
| `search.cleared` | Clear filter and re-render |

---

### 10. StatusBar

**Purpose**: Bottom bar showing QuoteSystem messages, FPS, triangle count, memory usage

#### Props
```cpp
struct StatusBarProps {
    int height = 24;                    // Fixed height in pixels
    bool showFPS = true;                // Show FPS counter
    bool showTriangleCount = true;      // Show triangle count
    bool showMemoryUsage = true;        // Show memory usage
    int fpsUpdateIntervalMs = 500;      // Update frequency for FPS
    int memoryUpdateIntervalMs = 1000;  // Update frequency for memory
};
```

#### State
```cpp
struct StatusBarState {
    std::string quoteMessage = "";      // Latest QuoteSystem message
    float fps = 0.0f;                   // Current FPS
    int triangleCount = 0;              // Total triangles in scene
    float memoryUsageMB = 0.0f;         // GPU memory usage
};
```

#### Events Emitted
None (only receives and displays data)

#### Events Subscribed
| Event | Reaction |
|-------|----------|
| `quote.logged` | Update quoteMessage field |
| `scene.updated` | Update triangleCount field |
| `metrics.updated` | Update fps and memoryUsageMB fields |

---

## Component Lifecycle

### Initialization
```cpp
// Example: Viewport component initialization
class Viewport : public Component {
public:
    void Initialize(const ViewportProps& props) {
        // Store props
        this->props = props;

        // Initialize state from props
        state.camera.position = props.camera.position;
        state.camera.target = props.camera.target;
        state.camera.up = props.camera.up;

        // Subscribe to events
        EventBus::Instance().Subscribe("scene.updated",
            std::bind(&Viewport::OnSceneUpdated, this, std::placeholders::_1));
        EventBus::Instance().Subscribe("camera.frame",
            std::bind(&Viewport::OnCameraFrame, this, std::placeholders::_1));

        // Perform initial render
        RenderFrame();

        // Log initialization
        QuoteSystem::Instance().Log("Viewport initialized", QuoteSystem::MessageType::SUCCESS);
    }
};
```

### Update Loop
```cpp
// Components re-render when state changes
void Viewport::OnSceneUpdated(const EventPayload& payload) {
    // Update internal scene stats
    state.triangleCount = payload.GetInt("triangles");

    // Trigger re-render
    RenderFrame();
}
```

### Cleanup
```cpp
void Viewport::Shutdown() {
    // Unsubscribe from all events
    EventBus::Instance().Unsubscribe("scene.updated");
    EventBus::Instance().Unsubscribe("camera.frame");

    // Release GPU resources
    ReleaseVulkanResources();

    // Log shutdown
    QuoteSystem::Instance().Log("Viewport shutdown", QuoteSystem::MessageType::INFO);
}
```

---

## Why This Component Architecture

### Clear Separation of Concerns
Each component owns its own state and rendering logic. No component directly modifies another component's state.

### Testability
Components can be tested in isolation by emitting mock events and verifying state changes. No need to instantiate entire UI tree.

### Reusability
Components like **FileSearchBox** and **DragDropZone** can be reused in other projects (file browser, level editor, texture importer).

### Event-Driven Decoupling
Adding a new panel (e.g., **OutlinerPanel** for scene hierarchy) doesn't require modifying existing components. Just subscribe to `object.selected` and `scene.updated` events.

### Performance
Components only re-render when their state changes (dirty flag pattern). Avoids unnecessary redraws.

### Composition Over Inheritance
No deep inheritance hierarchies. Components are composed of smaller components via **Slots** (MenuBar contains QuickToolbar, AssetBrowser contains DragDropZone + FileSearchBox + FileList).
