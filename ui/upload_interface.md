# BrightForge Upload Interface Design
Developer: Marcus Daley
Date: 2026-04-14
Purpose: Define drag-and-drop file ingestion, search, and asset browsing components for 3D editor

---

## Component Specifications

### 1. DragDropZone Component

#### Visual Design
```
┌─────────────────────────────────────────────────────┐
│  ╔═══════════════════════════════════════════════╗  │
│  ║  Drag files here or click to browse           ║  │
│  ║                                                ║  │
│  ║  [Upload Icon]                                ║  │
│  ║                                                ║  │
│  ║  Supported: OBJ, FBX, GLTF, GLB               ║  │
│  ║             PNG, JPG, TGA, BMP                ║  │
│  ╚═══════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────┘
```

#### States and Visual Feedback

**IDLE** (default state):
- Dashed border (2px, color: --border-secondary)
- Background: --background-secondary
- Icon: upload arrow (gray)
- Text: "Drag files here or click to browse"

**DRAG_OVER** (user dragging file over zone):
- Dashed border (3px, color: --accent-primary)
- Background: --accent-primary with 10% opacity
- Icon: upload arrow (accent color, animated pulse)
- Text: "Drop to upload"
- Event emitted: `drag.enter` (no payload)

**UPLOADING** (file processing in progress):
- Solid border (2px, color: --accent-primary)
- Background: --background-secondary
- Progress bar: 0-100% horizontal bar (color: --accent-primary)
- Text: "Uploading {filename}... {percent}%"
- Cancel button: small X icon in top-right corner
- Event emitted: `upload.progress` with `{filename: string, percent: float}`

**SUCCESS** (upload complete):
- Solid border (2px, color: --status-success)
- Background: --status-success with 10% opacity
- Icon: checkmark (green)
- Text: "{filename} uploaded successfully"
- Auto-transition back to IDLE after 2 seconds
- Event emitted: `file.uploaded` with `{fileId: string, path: string, type: string}`

**ERROR** (validation failed or upload error):
- Solid border (2px, color: --status-error)
- Background: --status-error with 10% opacity
- Icon: X symbol (red)
- Text: "Error: {reason}" (examples: "Unsupported format", "File too large", "Read failed")
- Retry button: "Try Again" (resets to IDLE)
- Auto-transition back to IDLE after 5 seconds
- Event emitted: `upload.error` with `{filename: string, reason: string}`

#### Format Validation Rules

**Accepted mesh formats**: `.obj`, `.fbx`, `.gltf`, `.glb`
**Accepted texture formats**: `.png`, `.jpg`, `.jpeg`, `.tga`, `.bmp`

Validation sequence:
1. Check file extension against whitelist (case-insensitive)
2. Check file size (max 500MB for meshes, max 50MB for textures)
3. Attempt header magic number validation:
   - OBJ: starts with `#` or `v ` or `vt ` or `vn ` or `f `
   - FBX: binary header `Kaydara FBX Binary` or text header `; FBX`
   - GLTF: JSON with `"asset": {"version": "2.0"}`
   - GLB: binary header `glTF` (0x46546C67)
   - PNG: header `89 50 4E 47`
   - JPG: header `FF D8 FF`
   - TGA: footer `TRUEVISION-XFILE`
   - BMP: header `42 4D`
4. If validation fails, emit `upload.error` with specific reason
5. If validation passes, emit `file.dropped` event

#### Events

| Event | Payload | Emitted When | Consumed By |
|-------|---------|--------------|-------------|
| `drag.enter` | `{}` | File dragged over zone | Visual state update |
| `drag.leave` | `{}` | File dragged out of zone | Visual state update |
| `file.dropped` | `{files: FileList}` | User drops files | FileService for processing |
| `upload.progress` | `{filename: string, percent: float}` | During upload | Progress bar update |
| `file.uploaded` | `{fileId: string, path: string, type: string}` | Upload complete | AssetBrowser refresh |
| `upload.error` | `{filename: string, reason: string}` | Validation or I/O error | Error display |
| `upload.cancelled` | `{filename: string}` | User clicks cancel button | FileService cleanup |

#### Interaction Flow
```
User drags file into window
  → DragDropZone detects dragenter event
  → Emit drag.enter
  → Update visual state to DRAG_OVER
  → User releases mouse (drop event)
  → Emit file.dropped with FileList
  → Update visual state to UPLOADING
  → FileService validates file format
    → If invalid: Emit upload.error, show ERROR state
    → If valid: Copy file to project assets directory
  → FileService reads file metadata (vertex count, texture dimensions)
  → FileService generates thumbnail (wireframe for mesh, scaled image for texture)
  → Emit file.uploaded with asset ID
  → Update visual state to SUCCESS
  → Auto-transition to IDLE after 2 seconds
  → AssetBrowser receives file.uploaded event
  → AssetBrowser refreshes file list
```

---

### 2. FileSearchBox Component

#### Visual Design
```
┌─────────────────────────────────────────────────────┐
│  [🔍]  Search assets...                       [X]  │
└─────────────────────────────────────────────────────┘
```

#### Features

**Text Input**:
- Placeholder text: "Search assets..."
- Icon: magnifying glass (left side, 16px padding)
- Clear button: X icon (right side, only visible when text entered)
- Shortcut: Ctrl+F to focus input field
- Debounce: 300ms delay before emitting search.changed (prevents lag on rapid typing)

**Filter Syntax**:
Users can type plain text or use filter tags:
- Plain text: "castle" → matches filenames containing "castle"
- Type filter: "type:mesh" → shows only mesh files (.obj, .fbx, .gltf, .glb)
- Type filter: "type:texture" → shows only texture files (.png, .jpg, etc.)
- Tag filter: "tag:character" → shows files tagged with "character"
- Combined: "castle type:mesh" → mesh files with "castle" in name

**Auto-suggest** (optional enhancement):
- Show dropdown of recent searches + matching tags while typing
- Arrow keys to navigate suggestions, Enter to select
- Not required for Phase 3, can defer to Phase 4

#### Events

| Event | Payload | Emitted When | Consumed By |
|-------|---------|--------------|-------------|
| `search.focused` | `{}` | Input field gains focus (Ctrl+F) | Highlight search box |
| `search.changed` | `{query: string}` | User types (300ms debounce) | FileList filter |
| `search.cleared` | `{}` | User clicks clear button (X) | FileList reset |

#### Filter Logic (Consumed by FileList)

FileList component receives `search.changed` event and applies filtering:
```
function filterFiles(files, query) {
    // Parse query into tokens
    const tokens = query.toLowerCase().split(' ');
    let typeFilter = null;
    let tagFilters = [];
    let textQuery = [];

    for (const token of tokens) {
        if (token.startsWith('type:')) {
            typeFilter = token.substring(5); // "mesh" or "texture"
        } else if (token.startsWith('tag:')) {
            tagFilters.push(token.substring(4));
        } else {
            textQuery.push(token);
        }
    }

    // Apply filters
    return files.filter(file => {
        // Type filter
        if (typeFilter === 'mesh' && !isMeshExtension(file.extension)) return false;
        if (typeFilter === 'texture' && !isTextureExtension(file.extension)) return false;

        // Tag filter
        if (tagFilters.length > 0 && !file.tags.some(tag => tagFilters.includes(tag))) return false;

        // Text search (filename contains all text tokens)
        const lowerName = file.name.toLowerCase();
        if (!textQuery.every(token => lowerName.includes(token))) return false;

        return true;
    });
}
```

---

### 3. FileList Component

#### View Modes

**GRID VIEW** (default for textures):
```
┌──────┬──────┬──────┬──────┐
│ [📷] │ [📷] │ [📷] │ [📷] │  ← 128x128px thumbnails
│ tex1 │ tex2 │ tex3 │ tex4 │  ← Filename below (truncated)
├──────┼──────┼──────┼──────┤
│ [📦] │ [📦] │ [📦] │ [📦] │  ← Wireframe preview for meshes
│mesh1 │mesh2 │mesh3 │mesh4 │
└──────┴──────┴──────┴──────┘
```
- Fixed thumbnail size: 128x128px (configurable in default_layout.json)
- 8px gap between items
- Responsive grid: 4 columns on standard layout, 3 columns when sidebars expanded
- Thumbnail generation:
  - **Textures**: Scale image to 128x128 (preserve aspect, letterbox if needed)
  - **Meshes**: Render wireframe view at 128x128 (white lines on dark background)

**LIST VIEW** (better for large asset libraries):
```
┌────────────────────────────────────────────────┐
│ [📷] texture_diffuse_001.png      2048x2048   │
│ [📷] texture_normal_001.png       2048x2048   │
│ [📦] character_body.fbx          12,450 tris  │
│ [📦] environment_tree.obj         3,200 tris  │
└────────────────────────────────────────────────┘
```
- 32x32px icon (left side)
- Filename (middle, truncated with ellipsis if too long)
- Metadata (right side): resolution for textures, triangle count for meshes
- Row height: 40px
- Alternating row colors for readability

#### Interaction Patterns

**Selection**:
- Single-click: Select file (highlight with --accent-primary border)
- Ctrl+click: Multi-select (toggle selection)
- Shift+click: Range select (select all between last selected and current)
- Emit `file.selected` with `{fileIds: string[]}`

**Loading**:
- Double-click: Load asset into scene
- Emit `file.loaded` with `{fileId: string}`
- For meshes: RenderService adds mesh to scene at origin (0,0,0)
- For textures: Show texture assignment dialog (which material slot?)

**Context Menu** (right-click):
- Right-click opens context menu with options:
  - **Rename**: Inline text input to change filename
  - **Delete**: Confirm dialog, then remove file and emit `file.deleted`
  - **Duplicate**: Copy file with "_copy" suffix
  - **Add Tag**: Text input to add tag (stored in asset metadata)
  - **Properties**: Open modal with full metadata (size, date, vertex count, etc.)
- Emit `file.contextmenu` with `{fileId: string, action: string}`

**Drag-and-Drop** (from FileList into Viewport):
- User clicks+drags file from list
- Cursor shows file icon + filename while dragging
- Viewport highlights drop zone (entire viewport)
- User releases mouse over viewport
- Mesh instantiated at cursor's 3D world position (raycast from mouse to scene plane)
- Emit `file.dragged` with `{fileId: string, worldPosition: Vector3}`

#### Thumbnail Generation Strategy

**Why Pre-Generate Thumbnails**:
- Real-time thumbnail rendering tanks performance with 100+ assets
- Pre-generate on upload, cache as PNG files in `.brightforge/thumbnails/`
- FileList displays cached images (fast bitmap blit, no 3D rendering)

**Thumbnail Cache Structure**:
```
project_root/
  .brightforge/
    thumbnails/
      {fileId}_128.png   ← Grid view size
      {fileId}_32.png    ← List view size
    metadata.json        ← Maps fileId to file path, tags, stats
```

**Generation Process** (runs in FileService on upload):
1. User uploads mesh → FileService assigns unique fileId (UUID)
2. For textures:
   - Load image, scale to 128x128 and 32x32, save as PNG
3. For meshes:
   - Load mesh into RenderService (offscreen buffer)
   - Render wireframe view from 45-degree angle
   - Save framebuffer as PNG (128x128 and 32x32)
4. Write metadata entry: `{fileId, path, name, extension, type, tags, stats}`
5. Emit `file.uploaded` with fileId

#### Events

| Event | Payload | Emitted When | Consumed By |
|-------|---------|--------------|-------------|
| `file.selected` | `{fileIds: string[]}` | User clicks file | PropertyInspector |
| `file.loaded` | `{fileId: string}` | User double-clicks file | RenderService |
| `file.contextmenu` | `{fileId: string, action: string}` | User right-clicks | FileService |
| `file.dragged` | `{fileId: string, worldPosition: Vector3}` | User drags file to viewport | RenderService |
| `file.deleted` | `{fileId: string}` | User confirms delete | AssetBrowser refresh |
| `file.renamed` | `{fileId: string, newName: string}` | User saves new filename | Metadata update |

---

## Complete Interaction Flow Map

### Upload Workflow
```
1. User drags file into DragDropZone
   ↓
2. DragDropZone emits drag.enter (visual feedback: highlight border)
   ↓
3. User drops file
   ↓
4. DragDropZone emits file.dropped {files: FileList}
   ↓
5. FileService receives file.dropped
   ↓
6. FileService validates format (check extension + magic number)
   ├─ Invalid → FileService emits upload.error {filename, reason}
   │            DragDropZone shows ERROR state
   └─ Valid   → FileService copies file to assets directory
                ↓
                FileService generates thumbnails (128px + 32px)
                ↓
                FileService reads metadata (tri count / resolution)
                ↓
                FileService emits file.uploaded {fileId, path, type}
                ↓
                DragDropZone shows SUCCESS state (2 sec)
                ↓
                AssetBrowser receives file.uploaded
                ↓
                FileList component refreshes (adds new file to grid/list)
```

### Search Workflow
```
1. User presses Ctrl+F
   ↓
2. FileSearchBox emits search.focused
   ↓
3. FileSearchBox input field gains focus (highlight border)
   ↓
4. User types "castle type:mesh"
   ↓
5. After 300ms debounce, FileSearchBox emits search.changed {query: "castle type:mesh"}
   ↓
6. FileList receives search.changed
   ↓
7. FileList filters internal file array (only mesh files with "castle" in name)
   ↓
8. FileList re-renders grid/list with filtered results
   ↓
9. User clicks X button (clear search)
   ↓
10. FileSearchBox emits search.cleared
    ↓
11. FileList resets filter, shows all files
```

### Load Asset Workflow
```
1. User double-clicks mesh file in FileList
   ↓
2. FileList emits file.loaded {fileId: "uuid-1234"}
   ↓
3. RenderService receives file.loaded
   ↓
4. RenderService looks up file path from metadata (fileId → path)
   ↓
5. RenderService loads mesh via appropriate importer (OBJ/FBX/GLTF)
   ├─ Load error → RenderService emits load.error {fileId, reason}
   │               QuoteSystem logs ERROR_MSG
   └─ Load success → RenderService adds mesh to scene graph at origin
                     ↓
                     RenderService emits scene.updated {stats: {triangles, vertices}}
                     ↓
                     Viewport re-renders with new mesh
                     ↓
                     PropertyInspector receives object.selected (auto-select new mesh)
                     ↓
                     StatusBar updates triangle count
```

### Context Menu Workflow
```
1. User right-clicks file in FileList
   ↓
2. FileList shows context menu at cursor position
   ↓
3. User clicks "Delete"
   ↓
4. FileList shows confirmation dialog: "Delete {filename}? This cannot be undone."
   ↓
5. User clicks "Confirm"
   ↓
6. FileList emits file.contextmenu {fileId: "uuid-1234", action: "delete"}
   ↓
7. FileService receives file.contextmenu
   ↓
8. FileService deletes file from disk + thumbnail cache + metadata.json
   ↓
9. FileService emits file.deleted {fileId: "uuid-1234"}
   ↓
10. FileList receives file.deleted
    ↓
11. FileList removes file from internal array and re-renders
```

---

## Why This Design

### Drag-and-Drop First
- Fastest interaction for bulk uploads (drag folder of 50 textures)
- Visual feedback at every step (idle → drag-over → uploading → success/error)
- Click-to-browse as fallback for users unfamiliar with drag-and-drop

### Format Validation at Boundary
- Prevents corrupt files from entering asset pipeline
- Magic number validation catches renamed files (castle.obj that's actually a PNG)
- Clear error messages help users fix issues ("Unsupported format: .max")

### Pre-Generated Thumbnails
- Avoids real-time rendering lag (100+ assets would stutter)
- Trade disk space for UI responsiveness (128px PNG ≈ 10KB each)
- Cache invalidation: regenerate thumbnail if source file modified (compare timestamps)

### Debounced Search
- 300ms debounce prevents lag when user types "environment_tree_LOD_high.fbx" (no filtering until pause)
- Filter logic runs synchronously (array.filter is fast for <1000 files)
- For massive asset libraries (10,000+ files), consider indexing with Bloom filter or trie

### Event-Driven Decoupling
- DragDropZone doesn't know about FileService implementation (can swap SQLite for JSON metadata)
- FileList doesn't know about RenderService (can add new mesh loaders without UI changes)
- All components testable in isolation (emit mock events, verify state changes)
