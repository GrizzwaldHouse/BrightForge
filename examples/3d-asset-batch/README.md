# 3D Asset Batch Generation Example

**Difficulty:** Advanced
**Time:** 30 minutes (includes generation time)
**Features:** Forge3D Pipeline, Batch Processing, Queue Management

---

## Overview

Generate multiple 3D meshes from a list of prompts using the Forge3D pipeline.

**What you'll learn:**
- Forge3D generation modes (text-to-mesh, image-to-mesh)
- Batch processing with generation queue
- VRAM monitoring and management
- GLB and FBX export
- Project organization

---

## Prerequisites

- **Required:**
  - Node.js 18+
  - Python 3.10+
  - NVIDIA GPU with 8GB+ VRAM
  - CUDA 12.4+

- **Setup:**
  ```bash
  # Install Python dependencies
  cd python
  pip install -r requirements.txt
  cd ..

  # Start BrightForge server
  npm run server
  ```

---

## Instructions

### Step 1: Start Web Server

```bash
npm run server

# Open http://localhost:3847
```

### Step 2: Navigate to Forge3D Tab

Click **Forge 3D** tab in the dashboard.

### Step 3: Create a Project

1. Click **New Project** button
2. Name: "Game Assets Batch"
3. Description: "Low-poly game assets for 3D platformer"
4. Click **Create**

### Step 4: Batch Generate Assets

Use the batch generation script:

```bash
cd examples/3d-asset-batch
node batch-generate.js
```

This script will generate 5 assets:
1. Low-poly house with red roof
2. Low-poly tree with green foliage
3. Low-poly rock formation
4. Low-poly treasure chest
5. Low-poly wooden crate

### Step 5: Monitor Progress

In the Forge3D tab, watch:
- **Queue panel** - Shows all pending/generating/complete items
- **VRAM usage** - Real-time GPU memory monitoring
- **Generation log** - Status updates

Expected timeline:
- Each asset: ~3-5 minutes
- Total batch: ~20-25 minutes

### Step 6: Download Assets

Once complete:

1. Click on each asset in the **Asset Gallery**
2. View 3D preview (orbit camera, wireframe toggle)
3. Click **Download GLB** or **Download FBX**
4. Assets saved to `data/output/Game-Assets-Batch/`

---

## Batch Generation Script

**batch-generate.js:**

```javascript
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3847/api/forge3d';

const prompts = [
  'low-poly isometric house with red roof and chimney',
  'low-poly tree with green foliage and brown trunk',
  'low-poly gray rock formation with moss',
  'low-poly treasure chest with gold trim',
  'low-poly wooden crate with metal bands'
];

async function generateAsset(prompt, projectId) {
  console.log(`Queuing: ${prompt}`);

  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'full_pipeline',
      prompt,
      projectId
    })
  });

  const data = await response.json();
  console.log(`Queued: ${data.sessionId}`);
  return data.sessionId;
}

async function main() {
  // Get or create project
  const projects = await fetch(`${API_BASE}/projects`).then(r => r.json());
  let project = projects.find(p => p.name === 'Game Assets Batch');

  if (!project) {
    const createRes = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Game Assets Batch',
        description: 'Low-poly game assets for 3D platformer'
      })
    });
    project = await createRes.json();
  }

  console.log(`Using project: ${project.name} (ID: ${project.id})`);

  // Queue all assets
  const sessionIds = [];
  for (const prompt of prompts) {
    const sessionId = await generateAsset(prompt, project.id);
    sessionIds.push(sessionId);
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
  }

  console.log(`\nQueued ${sessionIds.length} assets. Check dashboard for progress.`);
  console.log('http://localhost:3847 (Forge 3D tab)');
}

main().catch(console.error);
```

---

## Expected Output

### Project Structure

```
data/output/Game-Assets-Batch/
├── house_20260220_123045.glb
├── house_20260220_123045.fbx
├── tree_20260220_123320.glb
├── tree_20260220_123320.fbx
├── rock_20260220_123610.glb
├── rock_20260220_123610.fbx
├── chest_20260220_123855.glb
├── chest_20260220_123855.fbx
├── crate_20260220_124140.glb
└── crate_20260220_124140.fbx
```

### Asset Metadata (SQLite DB)

```sql
-- data/forge3d.db
SELECT * FROM assets WHERE project_id = 1;

-- Results:
-- id | project_id | name        | type | file_path              | created_at
-- 1  | 1          | house       | glb  | house_20260220_...glb  | 2026-02-20 12:30:45
-- 2  | 1          | tree        | glb  | tree_20260220_...glb   | 2026-02-20 12:33:20
-- ...
```

---

## Manual Generation (Web UI)

Prefer the web UI? Generate assets one by one:

1. **Forge 3D** tab → **Generate** button
2. Select **Full Pipeline (Text-to-Mesh)**
3. Enter prompt: "low-poly isometric house with red roof"
4. Select project: "Game Assets Batch"
5. Click **Generate**
6. Wait for completion (~3-5 min)
7. Repeat for each prompt

---

## Advanced Variations

### Image-to-Mesh Batch

Upload reference images and convert to 3D:

```javascript
// batch-image-to-mesh.js
const imagePaths = [
  'reference-images/house.png',
  'reference-images/tree.png',
  'reference-images/rock.png'
];

for (const imagePath of imagePaths) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'image_to_mesh',
      imageData: `data:image/png;base64,${base64Image}`,
      projectId: project.id
    })
  });
}
```

### Custom Resolution

Reduce VRAM usage by lowering image resolution:

```javascript
// config/forge3d.yaml (edit before running)
generation:
  default_width: 512  # Lower from 1024
  default_height: 512

# Restart server for changes to take effect
```

---

## Troubleshooting

### "CUDA out of memory"

**Cause:** GPU VRAM insufficient for batch processing.

**Fix:**

```bash
# Option 1: Reduce resolution (see above)

# Option 2: Generate one at a time (queue handles this automatically)
# The queue enforces max 1 concurrent generation

# Option 3: Use smaller model (edit python/config.yaml)
models:
  sdxl:
    model_id: "stabilityai/sdxl-turbo"  # Smaller variant
```

### "Queue stuck at 'generating'"

**Cause:** Python server crashed or unresponsive.

**Fix:**

```bash
# Check Python server logs
docker-compose logs python

# Or restart Python server
docker-compose restart python

# Check GPU health
nvidia-smi
```

### "Generation failed: timeout"

**Cause:** Generation took longer than timeout (default: 300s).

**Fix:**

```yaml
# config/forge3d.yaml
generation:
  timeout_seconds: 600  # Increase to 10 minutes
```

Restart server for changes.

---

## Performance Tips

1. **Queue Management:**
   - Max 1 concurrent generation (GPU constraint)
   - Queue automatically processes in FIFO order
   - Pause queue if needed (Pause button in UI)

2. **VRAM Optimization:**
   - Monitor VRAM usage (displayed in UI)
   - Stay below 90% usage to prevent crashes
   - Reduce image resolution if hitting limits

3. **Batch Size:**
   - Recommended: 5-10 assets per batch
   - Larger batches increase total time linearly
   - Python server handles queue automatically

---

## Next Steps

1. Import GLB files into Blender or Unity
2. Apply textures and materials
3. Optimize mesh topology (reduce poly count if needed)
4. Add to game engine (Unity, Unreal, Godot)

---

## License

MIT License - see [LICENSE](../../LICENSE) for details.
