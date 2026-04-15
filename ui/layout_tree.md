# BrightForge 3D Editor Layout Design
Developer: Marcus Daley
Date: 2026-04-14
Purpose: Define spatial hierarchy and resizing behavior for all UI panels in the 3D sculpting platform

---

## Layout Tree Hierarchy

```
EditorWindow (root container, fills screen)
│
├─ MenuBar (top, 40px fixed height, event: menu.command)
│  ├─ FileMenu (dropdown: New, Open, Save, Import, Export, Exit)
│  ├─ EditMenu (dropdown: Undo, Redo, Preferences)
│  ├─ ViewMenu (dropdown: Toggle Panels, Reset Layout, Wireframe/Solid)
│  ├─ ToolsMenu (dropdown: Sculpt, Transform, Paint, UV Unwrap)
│  ├─ HelpMenu (dropdown: Documentation, About)
│  └─ QuickToolbar (inline icons: Save, Undo, Redo, Play/Pause)
│
├─ WorkspaceContainer (fills remaining vertical space below MenuBar)
│  │
│  ├─ ToolPanel (left sidebar)
│  │  │  Default: 200px width, min 150px, max 400px
│  │  │  Collapsible: click header to hide/show (event: panel.collapsed)
│  │  │  Resizable: right edge drag handle (event: panel.resized)
│  │  │
│  │  ├─ SculptTools (section, collapsible accordion)
│  │  │  └─ Buttons: Clay, Smooth, Inflate, Grab, Pinch, Flatten
│  │  ├─ TransformTools (section)
│  │  │  └─ Buttons: Translate, Rotate, Scale, Pivot
│  │  └─ SelectionModes (section)
│  │     └─ Radio buttons: Vertex, Edge, Face, Object
│  │
│  ├─ CenterPanel (horizontal split, takes remaining width after sidebars)
│  │  │
│  │  ├─ Viewport (main 3D view, takes all space above AssetBrowser)
│  │  │  │  Renders 3D scene via RenderService
│  │  │  │  Events: camera.orbited, camera.panned, camera.zoomed
│  │  │  │  Mouse interactions: left-drag=orbit, middle-drag=pan, scroll=zoom
│  │  │  │
│  │  │  └─ GizmoOverlay (canvas layer, z-index above scene)
│  │  │     └─ Transform gizmo (XYZ arrows for translate, rotation rings, scale handles)
│  │  │        Event: object.transformed
│  │  │
│  │  └─ AssetBrowser (bottom panel, horizontal splitter)
│  │     Default: 250px height, min 100px, max 600px
│  │     Collapsible: click header (event: panel.collapsed)
│  │     Resizable: top edge drag handle (event: panel.resized)
│  │     │
│  │     ├─ DragDropZone (top section, 150px height, dashed border)
│  │     │  Visual states: idle, drag-over (highlight), uploading (progress bar)
│  │     │  Event: file.dropped, file.uploaded
│  │     │
│  │     ├─ FileSearchBox (below drop zone, 36px height)
│  │     │  Text input with search icon, placeholder "Search assets..."
│  │     │  Filter syntax: "type:mesh", "type:texture", "tag:character"
│  │     │  Shortcut: Ctrl+F to focus
│  │     │  Event: search.changed
│  │     │
│  │     └─ FileList (scrollable grid/list, fills remaining height)
│  │        View modes: Grid (thumbnails 128x128), List (rows with icon+name)
│  │        Thumbnails: wireframe preview for meshes, image preview for textures
│  │        Interactions: double-click to load, right-click for context menu
│  │        Events: file.selected, file.loaded, file.contextmenu
│  │
│  └─ PropertyInspector (right sidebar)
│     Default: 300px width, min 200px, max 500px
│     Collapsible: click header (event: panel.collapsed)
│     Resizable: left edge drag handle (event: panel.resized)
│     │
│     ├─ ObjectProperties (section, shows when object selected)
│     │  └─ Fields: Name, Visible checkbox, Lock checkbox
│     │
│     ├─ TransformProperties (section)
│     │  └─ Float inputs: Position XYZ, Rotation XYZ, Scale XYZ
│     │     Precision: 0.001, range validation per axis
│     │     Event: property.changed
│     │
│     └─ MaterialEditor (section)
│        └─ PBR Parameters (all float sliders 0.0-1.0):
│           - BaseColor (RGB color picker + alpha)
│           - Metallic (0=dielectric, 1=metal)
│           - Roughness (0=smooth, 1=rough)
│           - Normal map slot (texture browser button)
│           - AO map slot
│           Event: material.changed
│
└─ StatusBar (bottom, 24px fixed height, dark background)
   └─ Sections (left to right):
      - QuoteSystem message (70% width, truncated with ellipsis)
      - FPS counter (event: metrics.updated)
      - Triangle count (event: scene.stats)
      - Memory usage (event: metrics.updated)
```

---

## Panel Resizing Rules

### Sidebar Resize Behavior
- **ToolPanel** (left sidebar):
  - Drag right edge to resize
  - Width constraints: min 150px, max 400px
  - Viewport adjusts width to compensate (flex-grow fills remaining space)
  - Emit `panel.resized` event with new width for layout persistence

- **PropertyInspector** (right sidebar):
  - Drag left edge to resize
  - Width constraints: min 200px, max 500px
  - Viewport adjusts width to compensate
  - Emit `panel.resized` event with new width

### Bottom Panel Resize Behavior
- **AssetBrowser**:
  - Drag top edge to resize
  - Height constraints: min 100px, max 600px (never obscures viewport below 50% height)
  - Viewport adjusts height to compensate
  - Emit `panel.resized` event with new height

### Collapse Behavior
- All panels have collapse button (chevron icon) in header
- Collapsed state: panel hidden, only header bar visible (24px)
- Viewport expands to fill space of collapsed panels
- Double-click panel header to toggle collapse
- Emit `panel.collapsed` event with panel ID + collapsed state (boolean)

### Splitter Visual Design
- 4px wide/tall invisible hit target
- 1px solid border line (color: --border-secondary from design tokens)
- Hover state: change cursor (ew-resize for vertical, ns-resize for horizontal)
- Active drag state: highlight splitter with accent color (--accent-primary)

---

## Responsive Layout Breakpoints

### Window Width < 1280px (tablet mode)
- ToolPanel auto-collapses to icon-only mode (40px width, tooltip on hover)
- PropertyInspector auto-collapses
- AssetBrowser switches to list view (no grid thumbnails)

### Window Width < 800px (mobile mode — not primary target, disable if needed)
- Show message: "BrightForge requires minimum 800px width for 3D editing"
- Alternatively: full-screen viewport only, floating tool palettes

---

## Layout Persistence

### Save Layout State
When user resizes or collapses panels, write to `default_layout.json`:
- Panel IDs with width/height values (px)
- Collapsed state (boolean)
- View mode preferences (grid vs list for AssetBrowser)

### Restore Layout State
On editor launch, read `default_layout.json`:
- Apply saved dimensions (validate against min/max constraints)
- Apply collapsed states
- Apply view mode preferences
- If file missing or corrupted, use hardcoded defaults from this spec

### Reset Layout Command
View menu → Reset Layout:
- Restore hardcoded default values (ToolPanel 200px, PropertyInspector 300px, AssetBrowser 250px)
- Expand all collapsed panels
- Emit `layout.reset` event

---

## Event Communication

All panel interactions emit events via EventBus (no direct coupling):

| Event Name | Payload | Emitted By | Consumed By |
|------------|---------|------------|-------------|
| `panel.resized` | `{panelId: string, dimension: number}` | Splitter drag handler | LayoutManager |
| `panel.collapsed` | `{panelId: string, collapsed: bool}` | Panel header button | LayoutManager |
| `menu.command` | `{command: string}` | MenuBar | Various controllers |
| `camera.orbited` | `{deltaX: float, deltaY: float}` | Viewport mouse handler | CameraController |
| `camera.panned` | `{deltaX: float, deltaY: float}` | Viewport mouse handler | CameraController |
| `camera.zoomed` | `{delta: float}` | Viewport scroll handler | CameraController |
| `object.transformed` | `{objectId: string, transform: Matrix4x4}` | GizmoOverlay | SceneGraph |
| `file.dropped` | `{files: FileList}` | DragDropZone | FileService |
| `file.uploaded` | `{fileId: string, path: string}` | FileService | AssetBrowser |
| `file.selected` | `{fileId: string}` | FileList | PropertyInspector |
| `file.loaded` | `{fileId: string}` | FileList double-click | RenderService |
| `search.changed` | `{query: string}` | FileSearchBox | FileList filter |
| `property.changed` | `{objectId: string, property: string, value: any}` | PropertyInspector inputs | SceneGraph |
| `material.changed` | `{materialId: string, params: PBRParams}` | MaterialEditor | RenderService |
| `scene.stats` | `{triangles: int, vertices: int}` | RenderService | StatusBar |
| `metrics.updated` | `{fps: float, memoryMB: float}` | PerformanceMonitor | StatusBar |
| `layout.reset` | `{}` | View menu | LayoutManager |

---

## Viewport Interaction Modes

### Camera Control (default mode)
- Left mouse drag: Orbit camera around scene center (arcball rotation)
- Middle mouse drag: Pan camera (translate XY in view space)
- Mouse scroll: Zoom camera (move along view Z axis)
- Frame Selected: 'F' key focuses camera on selected object bounding box

### Transform Gizmo Mode (when object selected)
- Gizmo appears at object origin
- Hover highlights gizmo axis/plane (red=X, green=Y, blue=Z)
- Click+drag axis arrow: translate along axis
- Click+drag rotation ring: rotate around axis
- Click+drag scale handle: uniform or axis-specific scale
- Snapping: Hold Ctrl for grid snap (configurable increment: 0.1, 0.5, 1.0)

### Selection Mode (changed via ToolPanel radio buttons)
- Vertex mode: click vertices, drag to translate
- Edge mode: click edges, extrude/bevel operations
- Face mode: click faces, extrude/inset operations
- Object mode: click object, transform entire mesh

---

## Keyboard Shortcuts

| Key | Action | Event |
|-----|--------|-------|
| Ctrl+S | Save project | `menu.command: save` |
| Ctrl+Z | Undo | `menu.command: undo` |
| Ctrl+Shift+Z | Redo | `menu.command: redo` |
| Ctrl+F | Focus search box | `search.focused` |
| F | Frame selected object | `camera.frame` |
| 1 | Vertex selection mode | `selection.mode: vertex` |
| 2 | Edge selection mode | `selection.mode: edge` |
| 3 | Face selection mode | `selection.mode: face` |
| 4 | Object selection mode | `selection.mode: object` |
| W | Translate gizmo | `gizmo.mode: translate` |
| E | Rotate gizmo | `gizmo.mode: rotate` |
| R | Scale gizmo | `gizmo.mode: scale` |
| Tab | Toggle wireframe/solid | `viewport.wireframe` |
| Delete | Delete selected object | `object.delete` |

---

## Why This Design

### Center-Focused Workflow
- Viewport is the primary workspace (largest area, no fixed width)
- Sidebars provide tools and properties without obscuring scene
- Bottom panel keeps assets accessible without vertical scrolling

### Resizable + Collapsible Panels
- Users can optimize for their workflow (more viewport for modeling, more properties for material editing)
- Persistence saves custom layouts per project
- Collapse panels for distraction-free sculpting

### Event-Driven Decoupling
- No panel directly calls another panel's methods
- All communication via EventBus enables independent development and testing
- Easy to add new panels (subscribe to existing events) without modifying core

### Why NOT a Floating Tool Palette System
- Fixed sidebars are more predictable for precision work
- Floating windows have Z-order management complexity
- Resizable splitters give same flexibility without window clutter
- (Minimal layout variant offers floating palettes for users who prefer it)
