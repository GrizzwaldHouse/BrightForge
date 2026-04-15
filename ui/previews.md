# BrightForge Layout Previews
Developer: Marcus Daley
Date: 2026-04-14
Purpose: Define three layout variations (Minimal, Standard, Professional) with pros/cons/target users

---

## Overview

BrightForge supports three workspace layouts optimized for different workflows:
1. **Minimal** - Viewport-only with floating tool palettes (for sculpting focus)
2. **Standard** - Fixed sidebars with bottom asset browser (default for general 3D editing)
3. **Professional** - Multi-viewport with dockable panels (for technical modeling and animation)

Users can switch layouts via **View → Layout → [Minimal/Standard/Professional]** or save custom layouts.

---

## Layout 1: Minimal

### Visual Structure

```
┌─────────────────────────────────────────────────────────────┐
│ MenuBar (40px)                                         [⚙]  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│                                                              │
│                    VIEWPORT (fills screen)                   │
│                                                              │
│                   ┌──────────────┐                          │
│                   │ Tools        │ ← Floating palette       │
│                   │ □ Clay       │    (draggable, collapsible)
│                   │ □ Smooth     │                          │
│                   │ □ Inflate    │                          │
│                   └──────────────┘                          │
│                                                              │
│                                         ┌─────────────────┐ │
│                                         │ Properties      │ │
│                                         │ Position: 0,0,0 │ │
│                                         │ Rotation: 0,0,0 │ │
│                                         └─────────────────┘ │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ StatusBar: FPS 60 | 1,234 tris | 128 MB        [Quote here] │
└─────────────────────────────────────────────────────────────┘
```

### Features

**Maximized Viewport**:
- Viewport fills entire screen except MenuBar (40px) and StatusBar (24px)
- No fixed sidebars (all collapsed)
- No bottom asset browser (hidden by default)

**Floating Tool Palettes**:
- Tools and properties shown as floating windows (draggable, resizable)
- Click-to-collapse: minimize palette to title bar only
- Always-on-top (z-index above viewport)
- Semi-transparent background (70% opacity) to see scene behind
- Snap to screen edges (magnetic snapping within 10px)

**Keyboard-First Workflow**:
- All tools accessible via shortcuts (B=Clay, S=Smooth, G=Grab, etc.)
- Spacebar pie menu: radial tool selector (8 common tools)
- Tab key: toggle all palettes visible/hidden
- Ctrl+Tab: cycle through palettes (focus for keyboard input)

**Minimal Distractions**:
- MenuBar auto-hides after 3 seconds (slide up, show on mouse hover)
- StatusBar shows only FPS and quote message (no triangle count or memory)
- Grid and axis indicators hidden by default

### Pros
- **Maximum viewport space** - Ideal for sculpting detail work where every pixel counts
- **Distraction-free** - No visual clutter, focus purely on the model
- **Fast tool access** - Keyboard shortcuts and pie menu faster than clicking sidebar buttons
- **Custom palette layout** - Arrange floating windows exactly where you want them

### Cons
- **Learning curve** - Must memorize keyboard shortcuts (not beginner-friendly)
- **No persistent tool visibility** - Palettes can be accidentally closed or lost off-screen
- **Harder asset management** - No visible asset browser (must open via Ctrl+Shift+A shortcut)
- **Not ideal for multi-monitor** - Floating windows don't remember positions across monitor configs

### Target User
**Digital sculptors and character artists** who spend hours in sculpting mode (ZBrush-style workflow). Users who prioritize viewport space over panel organization. Comfortable with keyboard shortcuts and minimal UI.

**Example Workflow**: Artist presses B to switch to Clay brush, sculpts with pen tablet, presses S to smooth, presses G to grab and pull. Occasionally presses Tab to check properties, then hides palettes again.

### Config File Difference
```json
{
  "layoutName": "Minimal",
  "panels": {
    "toolPanel": { "visible": false, "collapsed": true },
    "propertyInspector": { "visible": false, "collapsed": true },
    "assetBrowser": { "visible": false, "collapsed": true },
    "viewport": {
      "rendering": {
        "showGrid": false,
        "showAxis": false
      }
    },
    "menuBar": { "autoHide": true, "autoHideDelayMs": 3000 },
    "statusBar": { "sections": { "triangleCount": { "visible": false }, "memoryUsage": { "visible": false } } }
  },
  "floatingPalettes": [
    { "id": "toolPalette", "visible": true, "position": [50, 100], "size": [200, 300], "opacity": 0.7 },
    { "id": "propertyPalette", "visible": true, "position": [1100, 100], "size": [250, 200], "opacity": 0.7 }
  ]
}
```

---

## Layout 2: Standard (Default)

### Visual Structure

```
┌─────────────────────────────────────────────────────────────┐
│ MenuBar (40px)  [File] [Edit] [View] [Tools]    [💾 ↶ ↷]   │
├───────┬─────────────────────────────────────────────┬───────┤
│       │                                              │       │
│ Tool  │                                              │ Prop  │
│ Panel │            VIEWPORT (main 3D view)          │ Insp  │
│       │                                              │       │
│ 200px │                                              │ 300px │
│       │                                              │       │
│ ├───┤ │                                              │ ├───┤ │
│ Sculpt│                                              │ Obj   │
│ □ Clay│                                              │ Name  │
│ □ Smoo│                                              │ Pos X │
│ □ Infl│                                              │ Pos Y │
│       │                                              │ Pos Z │
│ ├───┤ │                                              │       │
│ Trans │                                              │ ├───┤ │
│ ◉ Move│                                              │ Mater │
│ ○ Rot │                                              │ Metal │
│ ○ Scal│                                              │ Rough │
│       │                                              │       │
├───────┴──────────────────────────────────────────────┴───────┤
│ AssetBrowser (250px height, collapsible)                     │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Drag files here or click to browse                      │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [🔍] Search assets...                                 [Grid] │
│ ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐  │
│ │[📷]│[📷]│[📷]│[📦]│[📦]│[📦]│[📦]│[📦]│[📦]│[📦]│[📦]│  │
│ │tex1│tex2│tex3│mesh│mesh│mesh│mesh│mesh│mesh│mesh│mesh│  │
│ └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘  │
├─────────────────────────────────────────────────────────────┤
│ StatusBar: "Mesh loaded successfully" | FPS 60 | 1,234 tris │
└─────────────────────────────────────────────────────────────┘
```

### Features

**Fixed Sidebars**:
- **ToolPanel** (left, 200px): All tools organized in collapsible sections
- **PropertyInspector** (right, 300px): Object properties, transform, material
- Both panels resizable (drag splitter edges)
- Both panels collapsible (click header chevron)

**Bottom Asset Browser**:
- Fixed height (250px), resizable via top splitter
- Drag-and-drop upload zone always visible
- Search box with filter syntax
- Grid view of all assets with thumbnails
- Scrollable if more assets than fit in view

**Center Viewport**:
- Fills remaining space between sidebars and above asset browser
- Grid and axis indicators visible
- Transform gizmo appears when object selected

**Persistent Panel States**:
- Panel widths/heights saved to `default_layout.json`
- Collapsed states saved
- Restored on next launch

### Pros
- **Predictable layout** - Tools and properties always in same location (muscle memory)
- **Efficient space usage** - Sidebars use fixed width, viewport dynamically fills remaining space
- **Quick asset access** - Asset browser always visible at bottom (no need to open separate window)
- **Beginner-friendly** - All features visible and labeled (no need to memorize shortcuts)
- **Multi-monitor friendly** - Fixed layout works consistently across monitor configs

### Cons
- **Less viewport space** - Sidebars and bottom panel reduce available 3D workspace
- **Can feel cramped on small screens** - 1920x1080 screen leaves ~1520x786 viewport (sidebars take 500px width)
- **Fixed workflow** - Layout optimized for general editing, not specialized tasks (sculpting, UV unwrapping)

### Target User
**General 3D artists, modelers, and level designers** working on a variety of tasks (modeling, texturing, scene assembly). Users who value organized workspace over maximum viewport space. Comfortable with mouse-driven UI.

**Example Workflow**: Artist imports mesh via drag-and-drop to asset browser, double-clicks to load into scene, selects object in viewport, adjusts position via PropertyInspector inputs, changes material roughness via slider, switches to sculpt mode via ToolPanel button.

### Config File Difference
```json
{
  "layoutName": "Standard",
  "panels": {
    "toolPanel": { "visible": true, "collapsed": false, "width": 200 },
    "propertyInspector": { "visible": true, "collapsed": false, "width": 300 },
    "assetBrowser": { "visible": true, "collapsed": false, "height": 250 },
    "viewport": {
      "rendering": {
        "showGrid": true,
        "showAxis": true
      }
    }
  }
}
```

---

## Layout 3: Professional

### Visual Structure

```
┌─────────────────────────────────────────────────────────────┐
│ MenuBar (40px)  [File] [Edit] [View] [Tools]    [💾 ↶ ↷]   │
├───────┬─────────────────────────┬───────────────────┬───────┤
│       │ Viewport: Perspective   │ Viewport: Top     │       │
│ Tool  │                          │                   │ Prop  │
│ Panel │                          │                   │ Insp  │
│       │                          │                   │       │
│ 200px │                          │                   │ 300px │
│       │                          │                   │       │
│       ├──────────────────────────┼───────────────────┤       │
│ ├───┤ │ Viewport: Front         │ Viewport: Right   │ ├───┤ │
│ Sculpt│                          │                   │ Obj   │
│ □ Clay│                          │                   │ Name  │
│ □ Smoo│                          │                   │ Pos X │
│       │                          │                   │       │
│ ├───┤ │                          │                   │ ├───┤ │
│ Trans │                          │                   │ Mater │
│ ◉ Move│                          │                   │ Metal │
│ ○ Rot │                          │                   │ Rough │
│       │                          │                   │       │
├───────┴──────────────────────────┴───────────────────┴───────┤
│ Timeline / Animation Panel (150px height, dockable)          │
│ [Frame: 1 / 120] [▶ Play] [Keyframe Editor]                 │
├─────────────────────────────────────────────────────────────┤
│ AssetBrowser (200px height, collapsible)                     │
│ [🔍] Search...                                        [List] │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ [📷] texture_diffuse.png                    2048x2048 │   │
│ │ [📦] character_body.fbx                    12,450 tris│   │
│ └───────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│ StatusBar: Frame 1/120 | FPS 60 | 1,234 tris | 256 MB      │
└─────────────────────────────────────────────────────────────┘
```

### Features

**Quad Viewport Layout**:
- Four equal-sized viewports in 2x2 grid
- Each viewport shows different camera angle:
  - **Top-left**: Perspective (free-look, user-controlled)
  - **Top-right**: Top (orthographic, looking down Y axis)
  - **Bottom-left**: Front (orthographic, looking along Z axis)
  - **Bottom-right**: Right (orthographic, looking along X axis)
- Active viewport highlighted with accent border (--accent-primary)
- Click viewport to activate (arrow keys orbit active viewport's camera)
- Maximize viewport: double-click header to fill quad area (other 3 hidden)

**Dockable Panels**:
- All panels can be dragged and docked to different edges (top, bottom, left, right)
- Drag panel header to undock (becomes floating window)
- Drag floating panel to edge of screen to dock
- Tab groups: dock multiple panels in same slot (tabs at bottom, click to switch)
- Example: Asset browser and animation timeline docked at bottom with tabs

**Timeline Panel** (new in Professional layout):
- Shows current frame and total frames
- Play/pause animation controls
- Keyframe editor for transform animations
- Scrub timeline to preview animation at different frames
- Dockable (default: bottom, below viewport quad)

**Advanced Tools**:
- UV unwrap panel (shows 2D UV layout in one viewport, 3D mesh in another)
- Node editor panel (for material graphs and procedural generation)
- Outliner panel (hierarchical scene tree view)

**Side-by-Side Reference**:
- Load reference image in one viewport, model in another
- Mirror modeling: front view in one viewport, side view in another

### Pros
- **Technical precision** - Orthographic views show exact alignment (front/side/top views like CAD software)
- **Animation workflow** - Timeline panel integrated (no need for separate animation software)
- **Complex scene assembly** - Outliner panel shows full scene hierarchy
- **Flexible layout** - Dock panels anywhere, create custom tab groups
- **Professional features** - UV editor, node editor, outliner (features expected in Maya/Blender)

### Cons
- **Complexity** - Too many panels and viewports can overwhelm beginners
- **Performance cost** - Four viewports rendering simultaneously (4x draw calls, higher GPU load)
- **Smaller viewport size** - Each quad viewport is 1/4 the size (harder to see detail)
- **Requires larger screen** - Needs at least 2560x1440 or dual monitors to be usable
- **Longer setup time** - Must configure docking layout and tab groups (not instant productivity)

### Target User
**Professional 3D artists, technical animators, and game asset creators** working on complex projects requiring precision modeling, animation, and UV unwrapping. Users familiar with Maya, Blender, or 3ds Max. Multi-monitor setup preferred.

**Example Workflow**: Artist loads character mesh, switches to quad view, aligns vertices in front view, checks side view for symmetry, switches to perspective to verify overall shape. Opens UV editor in bottom-left viewport, unwraps UVs while previewing in perspective. Adds timeline panel to animate walk cycle, scrubs timeline to check motion.

### Config File Difference
```json
{
  "layoutName": "Professional",
  "panels": {
    "toolPanel": { "visible": true, "collapsed": false, "width": 200, "docked": "left" },
    "propertyInspector": { "visible": true, "collapsed": false, "width": 300, "docked": "right" },
    "assetBrowser": { "visible": true, "collapsed": false, "height": 200, "docked": "bottom", "tabGroup": "bottomPanel" },
    "timeline": { "visible": true, "collapsed": false, "height": 150, "docked": "bottom", "tabGroup": "bottomPanel" },
    "outliner": { "visible": true, "collapsed": false, "width": 250, "docked": "left", "tabGroup": "leftPanel" }
  },
  "viewports": [
    { "id": "perspective", "position": [0, 0], "size": [0.5, 0.5], "camera": { "mode": "perspective" } },
    { "id": "top", "position": [0.5, 0], "size": [0.5, 0.5], "camera": { "mode": "orthographic", "view": "top" } },
    { "id": "front", "position": [0, 0.5], "size": [0.5, 0.5], "camera": { "mode": "orthographic", "view": "front" } },
    { "id": "right", "position": [0.5, 0.5], "size": [0.5, 0.5], "camera": { "mode": "orthographic", "view": "right" } }
  ]
}
```

---

## Layout Comparison Table

| Feature | Minimal | Standard | Professional |
|---------|---------|----------|--------------|
| **Viewport Space** | Maximum (95%+ screen) | Moderate (60-70% screen) | Divided (4 viewports, 25% each) |
| **Tool Visibility** | Floating palettes (on-demand) | Fixed left sidebar (always visible) | Fixed left sidebar + dockable panels |
| **Asset Browser** | Hidden (Ctrl+Shift+A to open) | Bottom panel (always visible) | Bottom panel (tabbed with timeline) |
| **Learning Curve** | High (keyboard shortcuts required) | Low (all features labeled and visible) | Very High (many panels and features) |
| **Best For** | Sculpting, detail work | General 3D editing, modeling | Technical modeling, animation, UV unwrapping |
| **Performance** | Best (1 viewport) | Good (1 viewport) | Moderate (4 viewports rendering) |
| **Screen Size** | Works on any size (1920x1080+) | Best on 1920x1080 or larger | Requires 2560x1440 or dual monitors |
| **Workflow Speed** | Fast (if shortcuts memorized) | Moderate (mouse-driven) | Slow initial setup, fast once configured |
| **Customization** | High (palette positions) | Low (fixed sidebar layout) | Very High (dockable panels, tab groups) |
| **Target User** | Digital sculptors | General 3D artists | Professional animators, tech artists |

---

## Switching Between Layouts

### Menu Command
```
View → Layout → Minimal
View → Layout → Standard (Default)
View → Layout → Professional
View → Layout → Save Custom Layout...
View → Layout → Reset to Default
```

### Keyboard Shortcut
```
Ctrl+1 = Minimal
Ctrl+2 = Standard
Ctrl+3 = Professional
```

### Implementation
When user switches layout:
1. Save current layout state to `{layoutName}_layout.json` (preserve custom changes)
2. Load target layout config from JSON file
3. Animate panel transitions (slide sidebars in/out, resize viewports)
4. Emit `layout.changed` event with `{layoutName: string}`
5. QuoteSystem logs: "Switched to {layoutName} layout"

### Automatic Layout Suggestion
If user resizes panels significantly from defaults, show tooltip:
```
"Customize layout detected. Would you like to save this as a custom layout?"
[Save As...] [Ignore]
```

If user saves custom layout, it appears in View → Layout menu as "Custom: {name}".

---

## Why Three Layouts

### User Preference Diversity
Different workflows require different UIs. A sculptor needs maximum viewport space with minimal distractions. A technical modeler needs orthographic views and precise measurements. One size does NOT fit all.

### Learning Path
- **Beginners** start with Standard (all features visible and labeled)
- **Intermediate** users switch to Minimal once shortcuts memorized (faster workflow)
- **Advanced** users use Professional for complex multi-view projects (animation, UV editing)

### Performance Optimization
- Minimal layout is fastest (1 viewport, minimal UI updates)
- Standard layout balances performance and features
- Professional layout is slowest but provides most information (4 viewports, multiple panels)

### Competitive Parity
- **Blender**: Offers multiple workspaces (Modeling, Sculpting, Shading, Animation) with different panel layouts
- **Maya**: Offers single viewport vs quad viewport toggle
- **ZBrush**: Minimalist UI with floating palettes and keyboard shortcuts
- BrightForge matches industry expectations by supporting all three paradigms

### Config-Driven Design
All layouts are defined in JSON. Adding a fourth layout (e.g., "UV Editing") requires:
1. Create `uv_editing_layout.json` config file
2. Add menu item to View → Layout
3. No code changes required (all layout logic reads from JSON)

This follows the **95% reusable, 5% configurable** architecture rule.
