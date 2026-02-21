# BrightForge UE5 Import Tools

Two approaches for importing BrightForge-generated 3D assets into Unreal Engine 5:

1. **Python Script** (quick, no compilation needed)
2. **C++ Plugin** (full editor integration with UI panel)

Both connect to the BrightForge server running on `localhost:3847`.

## Prerequisites

- BrightForge server running: `node bin/brightforge-server.js` (or `npm run server`)
- At least one Forge3D project with generated assets
- FBX conversion available (Python inference server with Assimp/Blender backend)

---

## Option 1: Python Editor Script

The fastest way to import assets. No compilation required.

### Installation

1. Enable the **Python Editor Scripting** plugin in UE5:
   - Edit > Plugins > search "Python" > enable "Python Editor Scripting Plugin"
   - Restart the editor

2. Copy the `Scripts/` folder to your UE5 project:
   ```
   cp ue5-plugin/Scripts/brightforge_import.py  YourProject/Content/Python/brightforge_import.py
   ```
   Or add the `Scripts/` directory to your project's Python path in
   Edit > Project Settings > Python > Additional Paths.

### Usage

Open the Output Log (Window > Developer Tools > Output Log), switch to the Python tab:

```python
# Import the module
import brightforge_import

# Check server connection
brightforge_import.check_connection()

# Import the most recent asset from the most recent project
brightforge_import.import_latest()

# Import from a specific project
brightforge_import.import_latest(project_name="MyProject")

# Import all assets from a project
brightforge_import.import_all(project_name="MyProject")

# Import to a custom Content Browser path
brightforge_import.import_latest(destination="/Game/MyAssets/FromBrightForge")

# List available projects
projects = brightforge_import.get_projects()

# List assets in a project
assets = brightforge_import.get_assets("project-id-here")
```

Assets are imported as Static Meshes with materials and textures into
`/Game/BrightForge/Generated` by default.

---

## Option 2: C++ Editor Plugin

Full editor integration with a toolbar button and dedicated panel.

### Installation

1. Copy the `BrightForgeImporter/` folder into your UE5 project's `Plugins/` directory:
   ```
   cp -r ue5-plugin/BrightForgeImporter/  YourProject/Plugins/BrightForgeImporter/
   ```

2. Regenerate project files:
   - Right-click your `.uproject` file > Generate Visual Studio project files
   - Or from the editor: File > Refresh Visual Studio Project

3. Build the project (the plugin compiles as part of the editor build).

4. Enable the plugin if not already enabled:
   - Edit > Plugins > search "BrightForge" > enable "BrightForge Importer"
   - Restart the editor

### Usage

1. Click the **BrightForge** button in the editor toolbar (or Window > BrightForge Importer).

2. In the panel:
   - Enter the server URL (default: `http://localhost:3847`)
   - Click **Connect**
   - Select a project from the dropdown
   - Click **Import** on individual assets or **Import All Assets**

3. Downloaded FBX files are saved to `YourProject/Saved/BrightForge/Downloads/`.

### Plugin Structure

```
BrightForgeImporter/
  BrightForgeImporter.uplugin          # Plugin descriptor
  Source/BrightForgeImporter/
    BrightForgeImporter.Build.cs       # Module build rules
    Public/
      BrightForgeImporterModule.h      # Module interface
      SBrightForgePanel.h             # Slate panel widget
      BrightForgeHttpClient.h         # HTTP client for BrightForge API
    Private/
      BrightForgeImporterModule.cpp   # Module startup, toolbar registration
      SBrightForgePanel.cpp           # Panel UI: connect, browse, import
      BrightForgeHttpClient.cpp       # HTTP requests via FHttpModule
```

---

## API Endpoints Used

Both tools communicate with the BrightForge Forge3D API:

| Endpoint | Purpose |
|---|---|
| `GET /api/forge3d/bridge` | Health check / connection test |
| `GET /api/forge3d/projects` | List all projects |
| `GET /api/forge3d/projects/:id/assets` | List assets in a project |
| `GET /api/forge3d/assets/:id/download?format=fbx` | Download asset as FBX |
| `POST /api/forge3d/assets/:id/extract-materials` | Extract PBR material manifest |
| `GET /api/forge3d/material-presets` | Available material presets |

---

## Troubleshooting

**"Connection failed"** -- Verify the BrightForge server is running (`npm run server`) and
accessible at the configured URL.

**"No FBX file for this asset"** -- The asset may only have GLB format. Use the
`POST /api/forge3d/convert` endpoint to convert it first, or run conversion from the
BrightForge web dashboard.

**Python script not found** -- Ensure the script is on UE5's Python path. Check
Edit > Project Settings > Python > Additional Paths.

**Plugin won't compile** -- Verify your UE5 version supports the module dependencies listed
in `BrightForgeImporter.Build.cs`. The plugin targets UE5 5.3+.
