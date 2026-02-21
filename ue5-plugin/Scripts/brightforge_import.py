"""
BrightForge UE5 Import Script

Run inside Unreal Engine 5 Editor (requires Python Editor Scripting plugin).
Connects to BrightForge API and imports FBX assets with material setup.

Usage in UE5:
  1. Enable "Python Editor Scripting" plugin in UE5
  2. Open Output Log -> Python console
  3. Run: import brightforge_import; brightforge_import.import_latest()
"""

import unreal
import json
import os
import tempfile
import urllib.request
import urllib.error

# Default BrightForge API endpoint
BRIGHTFORGE_API = "http://localhost:3847/api/forge3d"


def _api_get(endpoint):
    """Send a GET request to the BrightForge API and return parsed JSON."""
    url = BRIGHTFORGE_API + endpoint
    try:
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        unreal.log_error("BrightForge API error ({}): {}".format(url, e))
        return None
    except json.JSONDecodeError as e:
        unreal.log_error("BrightForge JSON parse error: {}".format(e))
        return None


def _api_download(endpoint, destination_path):
    """Download a binary file from the BrightForge API."""
    url = BRIGHTFORGE_API + endpoint
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
            with open(destination_path, "wb") as f:
                f.write(data)
            return destination_path
    except urllib.error.URLError as e:
        unreal.log_error("BrightForge download error ({}): {}".format(url, e))
        return None


def check_connection():
    """Verify the BrightForge server is reachable."""
    result = _api_get("/bridge")
    if result is not None:
        unreal.log("BrightForge server connected at {}".format(BRIGHTFORGE_API))
        return True
    unreal.log_error("Cannot reach BrightForge server at {}".format(BRIGHTFORGE_API))
    return False


def get_projects():
    """Fetch all projects from BrightForge API."""
    result = _api_get("/projects")
    if result and "projects" in result:
        projects = result["projects"]
        unreal.log("Found {} BrightForge project(s)".format(len(projects)))
        return projects
    return []


def get_assets(project_id):
    """Fetch assets for a project."""
    result = _api_get("/projects/{}/assets".format(project_id))
    if result and "assets" in result:
        assets = result["assets"]
        unreal.log("Found {} asset(s) in project {}".format(len(assets), project_id))
        return assets
    return []


def download_fbx(asset_id, destination_dir=None):
    """Download FBX file for an asset.

    Args:
        asset_id: The asset ID from BrightForge.
        destination_dir: Directory to save into. Uses temp dir if None.

    Returns:
        File path to downloaded FBX, or None on failure.
    """
    if destination_dir is None:
        destination_dir = tempfile.mkdtemp(prefix="brightforge_")

    os.makedirs(destination_dir, exist_ok=True)
    fbx_path = os.path.join(destination_dir, "{}.fbx".format(asset_id))

    result = _api_download(
        "/assets/{}/download?format=fbx".format(asset_id),
        fbx_path
    )

    if result and os.path.exists(fbx_path) and os.path.getsize(fbx_path) > 0:
        unreal.log("Downloaded FBX: {} ({} bytes)".format(
            fbx_path, os.path.getsize(fbx_path)
        ))
        return fbx_path

    unreal.log_warning("FBX download failed for asset {}".format(asset_id))
    return None


def download_material_manifest(asset_id, destination_dir=None):
    """Download material manifest JSON for an asset.

    Triggers server-side material extraction if not already done.

    Args:
        asset_id: The asset ID from BrightForge.
        destination_dir: Directory to save manifest into. Uses temp dir if None.

    Returns:
        Parsed manifest dict, or None on failure.
    """
    if destination_dir is None:
        destination_dir = tempfile.mkdtemp(prefix="brightforge_")

    # Request material extraction from the server
    url = BRIGHTFORGE_API + "/assets/{}/extract-materials".format(asset_id)
    try:
        data = json.dumps({"preset": "ue5-standard"}).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        unreal.log_warning("Material extraction failed for {}: {}".format(asset_id, e))
        return None

    if result and result.get("success"):
        manifest_path = os.path.join(destination_dir, "{}_materials.json".format(asset_id))
        with open(manifest_path, "w") as f:
            json.dump(result.get("manifest", {}), f, indent=2)
        unreal.log("Material manifest saved: {}".format(manifest_path))
        return result.get("manifest")

    return None


def import_fbx(fbx_path, destination_path="/Game/BrightForge/Generated"):
    """Import FBX file into UE5 Content Browser.

    Uses unreal.AssetImportTask for automated import.

    Args:
        fbx_path: Absolute path to FBX file on disk.
        destination_path: Content Browser destination (default /Game/BrightForge/Generated).

    Returns:
        List of imported asset paths, or empty list on failure.
    """
    if not os.path.exists(fbx_path):
        unreal.log_error("FBX file not found: {}".format(fbx_path))
        return []

    task = unreal.AssetImportTask()
    task.filename = fbx_path
    task.destination_path = destination_path
    task.automated = True
    task.replace_existing = True
    task.save = True

    # FBX import options
    options = unreal.FbxImportUI()
    options.import_mesh = True
    options.import_materials = True
    options.import_textures = True
    options.import_as_skeletal = False
    options.static_mesh_import_data.combine_meshes = True
    task.options = options

    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

    imported = list(task.imported_object_paths)
    if imported:
        unreal.log("Imported {} asset(s) to {}".format(len(imported), destination_path))
        for path in imported:
            unreal.log("  -> {}".format(path))
    else:
        unreal.log_warning("No assets imported from {}".format(fbx_path))

    return imported


def import_latest(project_name=None, destination="/Game/BrightForge/Generated"):
    """Import the most recent asset from BrightForge.

    If project_name is None, uses the most recent project.

    Args:
        project_name: Name of the project to import from (optional).
        destination: UE5 Content Browser path.

    Returns:
        List of imported asset paths, or empty list on failure.
    """
    if not check_connection():
        return []

    projects = get_projects()
    if not projects:
        unreal.log_warning("No projects found in BrightForge")
        return []

    # Find matching project
    project = None
    if project_name:
        for p in projects:
            if p.get("name", "").lower() == project_name.lower():
                project = p
                break
        if not project:
            unreal.log_error("Project '{}' not found".format(project_name))
            return []
    else:
        # Use the most recently created project
        project = projects[0]

    project_id = project.get("id")
    unreal.log("Using project: {} ({})".format(project.get("name"), project_id))

    assets = get_assets(project_id)
    if not assets:
        unreal.log_warning("No assets in project '{}'".format(project.get("name")))
        return []

    # Import the most recent asset (first in list — API returns newest first)
    asset = assets[0]
    asset_id = asset.get("id")
    asset_name = asset.get("name", "unknown")
    unreal.log("Importing asset: {} ({})".format(asset_name, asset_id))

    fbx_path = download_fbx(asset_id)
    if not fbx_path:
        return []

    return import_fbx(fbx_path, destination)


def import_all(project_name=None, destination="/Game/BrightForge/Generated"):
    """Import all assets from a BrightForge project.

    Args:
        project_name: Name of the project to import from (optional).
        destination: UE5 Content Browser path.

    Returns:
        List of all imported asset paths.
    """
    if not check_connection():
        return []

    projects = get_projects()
    if not projects:
        unreal.log_warning("No projects found in BrightForge")
        return []

    # Find matching project
    project = None
    if project_name:
        for p in projects:
            if p.get("name", "").lower() == project_name.lower():
                project = p
                break
        if not project:
            unreal.log_error("Project '{}' not found".format(project_name))
            return []
    else:
        project = projects[0]

    project_id = project.get("id")
    project_label = project.get("name", project_id)
    unreal.log("Importing all assets from project: {}".format(project_label))

    assets = get_assets(project_id)
    if not assets:
        unreal.log_warning("No assets in project '{}'".format(project_label))
        return []

    all_imported = []
    for asset in assets:
        asset_id = asset.get("id")
        asset_name = asset.get("name", "unknown")
        unreal.log("Importing: {} ({})".format(asset_name, asset_id))

        fbx_path = download_fbx(asset_id)
        if fbx_path:
            imported = import_fbx(fbx_path, destination)
            all_imported.extend(imported)

    unreal.log("Import complete: {} asset(s) imported".format(len(all_imported)))
    return all_imported


# Log availability when imported
if __name__ != "__main__":
    unreal.log(
        "BrightForge Import Script loaded. "
        "Use: brightforge_import.import_latest() or brightforge_import.import_all()"
    )
