# Phase 3: UI/UX Design - Task Breakdown

**Agents:** UIUXArchitect + AIDesignAssistant (parallel tracks)
**Prerequisite:** Phase 1 complete (all 6 analysis tasks done)
**Status:** PENDING

---

## Track A: UI/UX Architect Tasks

### Task 3.1: Design 3D Editor Layout

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | UIUXArchitect |

### Description

Design the primary 3D editor window layout with five core regions: Viewport, ToolPanel, PropertyInspector, AssetBrowser, and MenuBar.

### Layout Tree

```
EditorWindow
+-- MenuBar (top, fixed height: 32px)
+-- MainContent (fill remaining)
    +-- ToolPanel (left, fixed width: 48px)
    +-- CenterSplit (fill remaining)
    |   +-- Viewport3D (top/center, flex: 3)
    |   +-- AssetBrowser (bottom, flex: 1, collapsible)
    +-- PropertyInspector (right, fixed width: 280px, collapsible)
```

### Config-Driven Layout

Layout definitions should be data-driven to support user customization:

```json
{
  "layout": {
    "type": "vertical",
    "children": [
      {
        "id": "menuBar",
        "component": "MenuBar",
        "height": 32,
        "resizable": false
      },
      {
        "type": "horizontal",
        "flex": 1,
        "children": [
          {
            "id": "toolPanel",
            "component": "ToolPanel",
            "width": 48,
            "resizable": false
          },
          {
            "type": "vertical",
            "flex": 1,
            "children": [
              {
                "id": "viewport",
                "component": "Viewport3D",
                "flex": 3,
                "minHeight": 200
              },
              {
                "id": "assetBrowser",
                "component": "AssetBrowser",
                "flex": 1,
                "minHeight": 100,
                "collapsible": true
              }
            ]
          },
          {
            "id": "propertyInspector",
            "component": "PropertyInspector",
            "width": 280,
            "minWidth": 200,
            "maxWidth": 500,
            "collapsible": true
          }
        ]
      }
    ]
  }
}
```

### Component Specifications

| Component | Responsibilities |
|-----------|-----------------|
| **MenuBar** | File (New, Open, Save, Export), Edit (Undo, Redo), View (toggle panels), Tools, Help |
| **Viewport3D** | Hosts Vulkan render surface, camera controls (orbit/pan/zoom), gizmo overlays, selection highlighting |
| **ToolPanel** | Vertical icon toolbar: Select, Move, Rotate, Scale, Measure, Slice. Active tool highlighted |
| **PropertyInspector** | Context-sensitive properties for selected object: Transform (position, rotation, scale), Material, Mesh info |
| **AssetBrowser** | Grid/list view of loaded assets, thumbnails, drag-to-viewport support, search/filter |

### Acceptance Criteria

- [ ] Layout tree fully defined with all regions
- [ ] Config JSON schema documented
- [ ] Each component's responsibilities listed
- [ ] Minimum sizes and collapsible behavior specified
- [ ] Layout is loadable from configuration file

---

### Task 3.2: Design Upload Interface

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | UIUXArchitect |

### Description

Design the file upload interface with drag-and-drop zone, search box, and file list.

### Components

| Component | Purpose |
|-----------|---------|
| **DragDropZone** | Large drop target area, visual feedback on drag-over, format validation display |
| **FileSearchBox** | Text input with live filtering, format filter dropdown |
| **FileList** | Scrollable list/grid of files with metadata columns |

### Interaction Map

```
User Action                     UI Response                     Backend Event
-----------                     -----------                     -------------
Drag file over DragDropZone --> Border highlight + format hint  --> (none)
Drop file on DragDropZone   --> Loading spinner + progress bar  --> file.dropped -> FileService.load()
                                                                --> file.loaded -> AssetIndex.add()
                                                                --> AssetBrowser refresh

Type in FileSearchBox       --> FileList filters in real-time   --> (local filter, no backend call)
                            --> Debounce 200ms before filter

Click format filter         --> Dropdown: All, OBJ, FBX,       --> FileList re-filters
                                glTF, GLB, STL

Click file in FileList      --> Highlight row                   --> asset.selected event
                            --> PropertyInspector updates        --> Load into viewport if double-click

Right-click file            --> Context menu: Open, Delete,     --> Respective backend action
                                Rename, Show in Explorer

Drag from FileList          --> Ghost preview follows cursor    --> (none until drop)
Drop on Viewport            --> Load into scene at drop point   --> asset.loaded + scene.updated
```

### Acceptance Criteria

- [ ] DragDropZone visual states defined (idle, hover, valid, invalid, loading)
- [ ] FileSearchBox filtering behavior specified with debounce
- [ ] FileList supports both grid and list view modes
- [ ] Interaction map covers all user actions
- [ ] Context menu actions defined

---

### Task 3.3: Define Component Architecture

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | UIUXArchitect |

### Description

Define design tokens and a component architecture pattern that all UI components must follow.

### Design Tokens

```json
{
  "colors": {
    "bg": {
      "primary": "#1a1a2e",
      "secondary": "#16213e",
      "tertiary": "#0f3460",
      "surface": "#222244",
      "hover": "#2a2a4e",
      "active": "#3a3a6e"
    },
    "text": {
      "primary": "#e0e0e0",
      "secondary": "#a0a0b0",
      "disabled": "#606070",
      "accent": "#00d4ff"
    },
    "border": {
      "default": "#333355",
      "focus": "#00d4ff",
      "error": "#ff4444"
    },
    "status": {
      "success": "#44ff88",
      "warning": "#ffaa44",
      "error": "#ff4444",
      "info": "#00d4ff"
    }
  },
  "spacing": {
    "xs": 4,
    "sm": 8,
    "md": 12,
    "lg": 16,
    "xl": 24,
    "xxl": 32
  },
  "radius": {
    "sm": 4,
    "md": 8,
    "lg": 12,
    "pill": 9999
  },
  "font": {
    "family": {
      "primary": "Inter, system-ui, sans-serif",
      "mono": "JetBrains Mono, monospace"
    },
    "size": {
      "xs": 10,
      "sm": 12,
      "md": 14,
      "lg": 16,
      "xl": 20,
      "heading": 24
    },
    "weight": {
      "normal": 400,
      "medium": 500,
      "bold": 700
    }
  }
}
```

### Component Definition Pattern

Every UI component must be defined with this structure:

```
Component: <Name>
  Props:    Static configuration passed at creation
  State:    Internal mutable state
  Events:   Events this component emits
  Slots:    Child component insertion points
```

**Example:**

```
Component: DragDropZone
  Props:
    - acceptedFormats: string[]      // e.g., [".obj", ".fbx", ".gltf"]
    - maxFileSize: number            // bytes, 0 = unlimited
    - multiple: boolean              // allow multiple files
  State:
    - dragState: "idle" | "hover" | "valid" | "invalid" | "loading"
    - progress: number               // 0.0 - 1.0 during loading
    - errorMessage: string | null
  Events:
    - onFilesDropped(files: File[])
    - onValidationError(error: string)
    - onLoadProgress(current: number, total: number)
  Slots:
    - icon: Custom icon component
    - label: Custom label component
```

### Acceptance Criteria

- [ ] Design tokens cover colors, spacing, radius, and typography
- [ ] Component definition pattern documented with Props/State/Events/Slots
- [ ] At least 3 core components defined using the pattern
- [ ] Tokens are referenceable by key path (e.g., `colors.bg.primary`)

---

### Task 3.4: Accessibility and Responsiveness

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | UIUXArchitect |

### Description

Define accessibility and responsive design requirements for the editor UI.

### Keyboard Navigation

| Context | Key | Action |
|---------|-----|--------|
| Global | `Ctrl+O` | Open file |
| Global | `Ctrl+S` | Save project |
| Global | `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| Global | `Tab` / `Shift+Tab` | Navigate between panels |
| Global | `F11` | Toggle fullscreen |
| Viewport | `W/A/S/D` | Camera movement |
| Viewport | `Q/E` | Camera up/down |
| Viewport | `1-5` | Switch tool (Select, Move, Rotate, Scale, Measure) |
| Viewport | `F` | Focus on selected object |
| Viewport | `Delete` | Delete selected object |
| AssetBrowser | `Arrow keys` | Navigate items |
| AssetBrowser | `Enter` | Load selected asset |
| AssetBrowser | `Ctrl+F` | Focus search box |
| PropertyInspector | `Tab` | Next field |
| PropertyInspector | `Enter` | Confirm value |
| PropertyInspector | `Escape` | Revert value |

### Touch Targets

- Minimum touch target: 44x44 pixels (WCAG 2.5.5 AAA)
- ToolPanel icons: 48x48 pixels minimum
- Property fields: 32px height minimum, 44px click area
- Scrollbar thumb: 8px visible width, 20px click width

### Contrast Ratios

| Element | Foreground | Background | Ratio | WCAG Level |
|---------|-----------|------------|-------|------------|
| Body text | `#e0e0e0` | `#1a1a2e` | 12.5:1 | AAA |
| Secondary text | `#a0a0b0` | `#1a1a2e` | 7.2:1 | AAA |
| Disabled text | `#606070` | `#1a1a2e` | 3.1:1 | (below AA, intentional for disabled) |
| Accent on dark | `#00d4ff` | `#1a1a2e` | 8.9:1 | AAA |
| Error text | `#ff4444` | `#1a1a2e` | 5.1:1 | AA |

### Minimum Resolution

- **Minimum supported:** 1280 x 720
- **Recommended:** 1920 x 1080
- Below minimum: panels collapse to icon-only mode, AssetBrowser hides
- Viewport always gets at least 60% of window width

### Acceptance Criteria

- [ ] Full keyboard navigation table defined
- [ ] Touch targets meet WCAG 2.5.5
- [ ] Contrast ratios verified for all text/background combinations
- [ ] Minimum resolution behavior documented
- [ ] Panel collapse rules specified for small windows

---

## Track B: AI Design Assistant Tasks

### Task 3.5: Generate Layout Concepts

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | AIDesignAssistant |

### Description

Generate three distinct layout variations for the 3D editor, each targeting different use cases.

### Variation 1: Minimal

```
+--------------------------------------------+
| Menu                                       |
+------+-------------------------------------+
|      |                                     |
| Tools|           Viewport (100%)           |
|      |                                     |
|      |                                     |
+------+-------------------------------------+
```

- **Target user:** Quick viewer, presentations
- **Visible panels:** ToolPanel (icon-only), Viewport
- **Hidden panels:** PropertyInspector, AssetBrowser (accessible via hotkey)
- **Screen usage:** Viewport takes maximum space
- **Best for:** Reviewing models, client demos

### Variation 2: Standard

```
+--------------------------------------------+
| Menu                                       |
+------+--------------------------+----------+
|      |                          |          |
| Tools|     Viewport (flex: 3)   | Property |
|      |                          | Inspector|
|      +--------------------------+          |
|      |     AssetBrowser (flex:1) |          |
+------+--------------------------+----------+
```

- **Target user:** General 3D editing workflow
- **Visible panels:** All five panels
- **Layout:** Balanced split with collapsible bottom and right panels
- **Best for:** Day-to-day editing, import/export workflows

### Variation 3: Professional

```
+--------------------------------------------+
| Menu                                       |
+------+---+-------------------+---+---------+
|      |Out|                   |Scn|         |
| Tools|lin| Viewport (center) |Hie| Property|
|      |er |                   |r  | Inspect |
|      |   +-------------------+   |         |
|      |   | AssetBrowser      |   | Material|
|      |   |                   |   | Editor  |
+------+---+-------------------+---+---------+
| Timeline / Animation Bar                   |
+--------------------------------------------+
```

- **Target user:** Professional 3D artist, animator
- **Additional panels:** Outliner (scene tree), Scene Hierarchy, Material Editor, Timeline
- **Layout:** Multi-column with dockable/floating panels
- **Best for:** Complex scenes, animation, material authoring

### Acceptance Criteria

- [ ] Three distinct variations produced with ASCII layout diagrams
- [ ] Target user and use case defined for each
- [ ] Panel visibility rules specified per variation
- [ ] Variations are achievable with the config-driven layout system from Task 3.1

---

### Task 3.6: Explain Design Tradeoffs

| Field | Value |
|-------|-------|
| Priority | LOW |
| Status | PENDING |
| Dependencies | Task 3.5 |
| Agent | AIDesignAssistant |

### Description

Document the pros and cons of each layout variation to inform the final design decision.

### Tradeoff Analysis

| Criteria | Minimal | Standard | Professional |
|----------|---------|----------|--------------|
| **Learning curve** | Very low | Low | Moderate |
| **Screen efficiency** | Excellent | Good | Fair (many panels) |
| **Feature access** | Poor (hidden) | Good | Excellent |
| **Implementation effort** | Low (2-3 days) | Medium (1-2 weeks) | High (3-4 weeks) |
| **Customizability** | None needed | Panel toggle | Full dock system |
| **Min resolution** | 800x600 | 1280x720 | 1920x1080 |
| **Touch friendly** | Yes | Partially | No |
| **Keyboard driven** | Excellent | Good | Good |

### Recommendations

- **Ship first:** Standard layout as the default
- **Quick win:** Minimal layout as a "Focus Mode" toggle (`Ctrl+Shift+F`)
- **Future:** Professional layout as v2 milestone after docking system is built

### Acceptance Criteria

- [ ] Pros and cons listed for each variation
- [ ] Comparison table with consistent criteria
- [ ] Clear recommendation for which to implement first
- [ ] Implementation effort estimates provided

---

## Testing Requirements

### Layout Tests

```cpp
TestManager::add("Layout_loads_from_config", []() {
    auto layout = LayoutConfig::loadFromFile("test_layout.json");
    ASSERT(layout.children.size() == 2); // menubar + main content
    ASSERT(layout.findById("viewport") != nullptr);
});

TestManager::add("Layout_respects_min_dimensions", []() {
    auto layout = LayoutConfig::loadFromFile("test_layout.json");
    auto viewport = layout.findById("viewport");
    ASSERT(viewport->minHeight >= 200);
});

TestManager::add("Layout_collapsible_panels", []() {
    auto layout = LayoutConfig::loadFromFile("test_layout.json");
    auto inspector = layout.findById("propertyInspector");
    ASSERT(inspector->collapsible == true);
});
```

### Design Token Tests

```cpp
TestManager::add("DesignTokens_load_from_json", []() {
    auto tokens = DesignTokens::loadFromFile("design_tokens.json");
    ASSERT(tokens.color("bg.primary") == "#1a1a2e");
    ASSERT(tokens.spacing("md") == 12);
    ASSERT(tokens.fontSize("md") == 14);
});

TestManager::add("DesignTokens_contrast_ratio_meets_AA", []() {
    auto tokens = DesignTokens::loadFromFile("design_tokens.json");
    float ratio = tokens.contrastRatio("text.primary", "bg.primary");
    ASSERT(ratio >= 4.5f); // WCAG AA minimum
});
```

### Component Architecture Tests

```cpp
TestManager::add("DragDropZone_state_transitions", []() {
    DragDropZone zone({".obj", ".fbx"});
    ASSERT(zone.state() == DragState::Idle);
    zone.simulateDragEnter("test.obj");
    ASSERT(zone.state() == DragState::Valid);
    zone.simulateDragEnter("test.xyz");
    ASSERT(zone.state() == DragState::Invalid);
    zone.simulateDragLeave();
    ASSERT(zone.state() == DragState::Idle);
});
```

---

## Phase 3 Summary

| Task | Track | Priority | Dependencies | Agent |
|------|-------|----------|--------------|-------|
| 3.1 Design 3D Editor Layout | A | HIGH | Phase 1 | UIUXArchitect |
| 3.2 Design Upload Interface | A | HIGH | Phase 1 | UIUXArchitect |
| 3.3 Define Component Architecture | A | HIGH | Phase 1 | UIUXArchitect |
| 3.4 Accessibility and Responsiveness | A | MED | Phase 1 | UIUXArchitect |
| 3.5 Generate Layout Concepts | B | MED | Phase 1 | AIDesignAssistant |
| 3.6 Explain Design Tradeoffs | B | LOW | 3.5 | AIDesignAssistant |

**Note:** Tracks A and B can execute in parallel. Track B Task 3.6 depends on Task 3.5.
