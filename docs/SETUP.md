# ForgePipeline Setup Guide

Complete installation and configuration guide for BrightForge's AI-powered 3D generation pipeline (ForgePipeline). This covers Node.js setup, Python environment, GPU configuration, model downloads, and verification.

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| GPU | NVIDIA GPU, 8 GB VRAM | RTX 3070 or better (optimized for RTX 5080) |
| RAM | 16 GB | 64 GB |
| Disk | 15 GB free | 30 GB free (models + workspace + temp files) |
| OS | Windows 10 | Windows 11 |
| Node.js | 18.0+ (ES Modules required) | 20+ LTS |
| Python | 3.10+ | 3.11 or 3.12 |
| CUDA | Toolkit 12.x (optional -- PyTorch bundles its own) | 12.4 |
| NVIDIA Driver | 550+ | Latest Game Ready driver |

Linux is supported but Windows is the primary development platform.

---

## Quick Start

For experienced developers who want to get running fast:

```bash
# 1. Clone and install Node.js dependencies
cd C:\Users\daley\Projects\LLCApp
npm install

# 2. Copy environment file and add your API keys
copy .env.example .env.local

# 3. Create Python virtual environment and install dependencies
python -m venv python\venv
python\venv\Scripts\activate
pip install -r python\requirements.txt --extra-index-url https://download.pytorch.org/whl/cu124

# 4. Run the automated setup validator
python python\setup.py

# 5. Start the web dashboard
npm run server
```

If everything works, the dashboard is at `http://localhost:3847`. Read on for detailed steps and troubleshooting.

---

## Step 1: Node.js Setup

### Install Dependencies

```bash
cd C:\Users\daley\Projects\LLCApp
npm install
```

This installs four production dependencies:
- `better-sqlite3` -- SQLite database for projects and generation history
- `dotenv` -- Environment variable loading
- `express` -- HTTP server for the web dashboard and API
- `yaml` -- Configuration file parsing

**Note:** `better-sqlite3` includes a native C++ addon that compiles during install. If compilation fails, see [Troubleshooting: better-sqlite3](#better-sqlite3-compilation-fails).

### Environment Variables

Copy the example file and add your API keys:

```bash
copy .env.example .env.local
```

Edit `.env.local` with your keys:

```ini
# Free-tier LLM providers (optional -- Ollama works without any keys)
GROQ_API_KEY=your_key_here
CEREBRAS_API_KEY=your_key_here
TOGETHER_API_KEY=your_key_here
MISTRAL_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here

# Paid fallback (optional)
CLAUDE_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
```

All API keys are optional. BrightForge tries providers in priority order (Ollama first, then free tiers, then paid). If you have Ollama running locally, no keys are needed for LLM features.

### Verify Node.js Setup

```bash
node --version
# Should print v18.x.x or higher

npm run test-bridge
# Should print: [BRIDGE] Self-test passed
```

---

## Step 2: Python Environment

ForgePipeline uses a Python FastAPI server for GPU inference. The Node.js application communicates with it over HTTP on `localhost:8001`.

### Create a Virtual Environment

```bash
cd C:\Users\daley\Projects\LLCApp
python -m venv python\venv
```

Activate it:

```bash
# Windows (Command Prompt)
python\venv\Scripts\activate

# Windows (PowerShell)
python\venv\Scripts\Activate.ps1

# Linux/macOS
source python/venv/bin/activate
```

### Install Python Dependencies

```bash
pip install -r python\requirements.txt --extra-index-url https://download.pytorch.org/whl/cu124
```

This installs:

| Package | Version | Purpose |
|---------|---------|---------|
| torch | 2.10.0 | PyTorch with CUDA 12.4 support |
| torchvision | 0.21.0 | Image transforms for model input |
| diffusers | 0.33.1 | Hugging Face SDXL pipeline |
| transformers | 4.49.0 | Model loading and tokenization |
| accelerate | 1.4.0 | GPU optimization |
| fastapi | 0.115.8 | HTTP inference server |
| uvicorn | 0.34.0 | ASGI server for FastAPI |
| trimesh | 4.6.6 | Mesh processing and validation |
| Pillow | 11.1.0 | Image handling |
| huggingface-hub | 0.28.1 | Model downloads from Hugging Face |
| pynvml | 12.0.0 | NVIDIA VRAM monitoring |

PyTorch is approximately 2.5 GB. The install may take several minutes on slower connections.

### Verify CUDA Access

After installation, verify PyTorch can see your GPU:

```bash
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"
```

Expected output:

```
CUDA available: True
GPU: NVIDIA GeForce RTX 5080
```

If CUDA shows as unavailable, see [Troubleshooting: CUDA not found](#cuda-not-found).

---

## Step 3: Model Downloads

ForgePipeline uses two AI models:

| Model | Size | Purpose |
|-------|------|---------|
| InstantMesh (TencentARC/InstantMesh) | ~1.5 GB | Single-image to 3D mesh generation |
| SDXL (Stable Diffusion XL) | ~7 GB | Text-to-image generation |

### Automated Download

Run the setup script to download models automatically:

```bash
python python\setup.py
```

This will:
1. Check Python version (3.10+ required)
2. Detect your GPU and VRAM
3. Verify CUDA toolkit availability
4. Create data directories (`data/models/`, `data/output/`, `data/temp/`)
5. Install Python dependencies (if not already installed)
6. Download models from Hugging Face

Models are stored in `data/models/` by default. To use a different location:

```bash
python python\setup.py --models-dir D:\ai-models
```

### Setup Script Options

```bash
# Full setup (default)
python python\setup.py

# Check environment only, no installs or downloads
python python\setup.py --check-only

# Skip model downloads (install deps only)
python python\setup.py --skip-models

# Skip pip install (download models only)
python python\setup.py --skip-install

# Custom model directory
python python\setup.py --models-dir /path/to/models
```

### Verify Downloads

After download completes, check for the completion marker:

```bash
dir data\models\instantmesh\.download_complete
```

If the file exists, the download completed successfully. If a download was interrupted, delete the partial directory and re-run setup:

```bash
rmdir /s data\models\instantmesh
python python\setup.py
```

### Storage Requirements

| Component | Size |
|-----------|------|
| InstantMesh model | ~1.5 GB |
| SDXL model | ~7 GB |
| PyTorch + Python deps | ~2.5 GB |
| Working space (temp + output) | ~2 GB |
| SQLite database | < 100 MB |
| **Total** | **~13 GB minimum** |

---

## Step 4: GPU Configuration

### Windows TDR Timeout Fix

Windows has a GPU watchdog timer called TDR (Timeout Detection and Recovery). By default, it kills any GPU operation that takes longer than 2 seconds. AI model inference routinely exceeds this.

**You must increase the TDR timeout to prevent Windows from killing GPU operations mid-generation.**

Open Registry Editor (`regedit`) and navigate to:

```
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\GraphicsDrivers
```

Create or modify these DWORD (32-bit) values:

| Name | Value (Decimal) | Description |
|------|-----------------|-------------|
| TdrDelay | 30 | Seconds before timeout (default is 2) |
| TdrDdiDelay | 30 | DDI timeout in seconds |

After setting these values, restart your computer for the change to take effect.

**Symptoms of TDR timeout:** Screen flickers or goes black during generation, generation fails with no error, display driver crash notification in Windows Event Viewer.

### CUDA Device Selection

If you have multiple GPUs (e.g., integrated Intel + discrete NVIDIA), set the environment variable to force PyTorch to use the correct GPU:

```bash
# Windows (set in .env.local or system environment)
set CUDA_VISIBLE_DEVICES=0
```

The Python inference server logs which GPU it selects on startup. Check the output for:

```
[SERVER] GPU: NVIDIA GeForce RTX 5080 | VRAM: 16.0 GB total, 14.2 GB free
```

### VRAM Management

ForgePipeline loads models sequentially to stay within VRAM limits:

- SDXL uses ~8.5 GB VRAM during image generation
- InstantMesh uses ~4-6 GB VRAM during mesh generation
- Both cannot be loaded simultaneously on a 16 GB GPU

The Python server handles model loading and unloading automatically. For best results:

- Close other GPU-intensive applications (games, video editors, other AI tools) before generation
- The server calls `torch.cuda.empty_cache()` between generations
- If you encounter OOM errors, restart the Python server to fully clear VRAM

---

## Step 5: First Run

### Option A: Web Dashboard (Recommended)

Start the BrightForge web server:

```bash
npm run server
```

Or equivalently:

```bash
node bin\brightforge-server.js
```

The dashboard is available at `http://localhost:3847`. The port is configurable via the `PORT` environment variable.

The Python inference server starts automatically when the first 3D generation is requested via the ModelBridge. You can also start it manually:

```bash
python python\inference_server.py --port 8001
```

### Option B: CLI

Start an interactive chat session:

```bash
npm run chat
```

Or:

```bash
node bin\brightforge.js --chat
```

### Option C: Electron Desktop App

```bash
npm run desktop
```

Or:

```bash
node bin\brightforge-desktop.js
```

The desktop app wraps the web dashboard in an Electron window with native OS integration.

---

## Step 6: Verify Installation

Run the self-test suite to confirm each module works:

```bash
# Core BrightForge tests
npm run test-llm           # LLM client and provider chain
npm run test-plan          # Plan engine parser
npm run test-context       # File context scanner
npm run test-diff          # Diff applier
npm run test-session       # Session logger
npm run test-api           # Web session API

# ForgePipeline tests
npm run test-bridge        # Python model bridge (does not require Python running)
npm run test-forge-db      # SQLite database layer
npm run test-project-manager  # Project and asset management
npm run test-queue         # Generation queue

# Run all core tests at once
npm run test-all-core
```

Each test prints `[MODULE] Self-test passed` on success. If any test fails, see the Troubleshooting section below.

### End-to-End Verification

To verify the full pipeline works:

1. Start the web server: `npm run server`
2. Open `http://localhost:3847` in a browser
3. Navigate to the Forge3D section
4. Try generating an image from a text prompt
5. Check the generation status endpoint: `GET http://localhost:3847/api/forge3d/bridge`

The bridge endpoint should return the Python server state. If it shows `"state": "running"`, the full pipeline is operational.

---

## Troubleshooting

### CUDA Not Found

**Symptom:** `torch.cuda.is_available()` returns `False`.

**Solutions:**

1. Verify NVIDIA drivers are installed:
   ```bash
   nvidia-smi
   ```
   If this command fails, download drivers from https://www.nvidia.com/Download/index.aspx

2. Verify driver version is 550+:
   ```bash
   nvidia-smi --query-gpu=driver_version --format=csv,noheader
   ```

3. Reinstall PyTorch with the correct CUDA version:
   ```bash
   pip uninstall torch torchvision
   pip install torch==2.10.0 torchvision==0.21.0 --extra-index-url https://download.pytorch.org/whl/cu124
   ```

4. If `nvcc` is not found, the CUDA toolkit is not in your PATH. This is usually fine because PyTorch bundles its own CUDA runtime. Only install the standalone toolkit if you encounter compilation issues: https://developer.nvidia.com/cuda-downloads

### OOM Errors During Generation

**Symptom:** `CUDA out of memory` error, generation fails with HTTP 507.

**Solutions:**

1. Close other GPU applications (games, Chrome with hardware acceleration, video editors)
2. Check available VRAM before generation:
   ```bash
   nvidia-smi
   ```
3. Reduce image dimensions (use 1024x1024 instead of 2048x2048 for SDXL)
4. Reduce inference steps (use 20 instead of 25)
5. Restart the Python server to clear fragmented VRAM:
   ```bash
   # The ModelBridge will auto-restart, or manually:
   python python\inference_server.py --port 8001
   ```

### Port 8001 Already in Use

**Symptom:** Python inference server fails to start, logs show `Address already in use`.

**Solutions:**

1. The ModelBridge automatically tries ports 8001-8010. Check the log output for which port it bound to.

2. Find what is using the port:
   ```bash
   # Windows
   netstat -ano | findstr :8001

   # Linux
   lsof -i :8001
   ```

3. Kill the conflicting process, or set a custom port:
   ```bash
   python python\inference_server.py --port 8005
   ```

### Model Download Failures

**Symptom:** Download hangs, times out, or produces a partial model.

**Solutions:**

1. Check your internet connection and try again. The setup script has a 30-minute timeout per model.

2. Delete the partial download directory and re-run:
   ```bash
   rmdir /s data\models\instantmesh
   python python\setup.py
   ```

3. Download manually using `huggingface-cli`:
   ```bash
   pip install huggingface-hub
   huggingface-cli download TencentARC/InstantMesh --local-dir data\models\instantmesh
   ```

4. If behind a corporate proxy, set the proxy environment variables:
   ```bash
   set HTTPS_PROXY=http://proxy:port
   set HTTP_PROXY=http://proxy:port
   ```

### better-sqlite3 Compilation Fails

**Symptom:** `npm install` fails with errors about `node-gyp`, `MSBuild`, or `better-sqlite3`.

**Solutions:**

1. Install Windows Build Tools (needed for native addons):
   ```bash
   npm install --global windows-build-tools
   ```

2. Or install Visual Studio Build Tools manually from https://visualstudio.microsoft.com/visual-cpp-build-tools/ -- select the "Desktop development with C++" workload.

3. If you have Visual Studio installed but `node-gyp` cannot find it:
   ```bash
   npm config set msvs_version 2022
   ```

4. As a last resort, use a prebuilt binary:
   ```bash
   npm install better-sqlite3 --build-from-source=false
   ```

### Python Version Mismatch

**Symptom:** Setup script reports `Python 3.10+ required`.

**Solutions:**

1. Check your Python version:
   ```bash
   python --version
   ```

2. If you have multiple Python versions, use the specific one:
   ```bash
   py -3.11 -m venv python\venv
   ```

3. Download Python 3.11+ from https://www.python.org/downloads/

### Port 3847 Already in Use

**Symptom:** BrightForge web server fails to start.

**Solution:** Set a custom port via environment variable:
```bash
set PORT=4000
npm run server
```

---

## Environment Variables Reference

All variables are optional. Set them in `.env.local` in the project root.

### LLM Provider Keys

| Variable | Provider | Cost | Notes |
|----------|----------|------|-------|
| `GROQ_API_KEY` | Groq | Free tier | Primary free cloud LLM |
| `CEREBRAS_API_KEY` | Cerebras | Free | Fast inference |
| `TOGETHER_API_KEY` | Together AI | Free ($25 credit) | Also used for image generation |
| `MISTRAL_API_KEY` | Mistral | Free tier | |
| `GEMINI_API_KEY` | Gemini | Free tier | |
| `CLAUDE_API_KEY` | Anthropic Claude | Paid | Fallback |
| `OPENAI_API_KEY` | OpenAI | Paid | Last resort |
| `OPENROUTER_API_KEY` | OpenRouter | Varies | Aggregator, lowest priority |

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3847 | BrightForge web dashboard port |
| `CUDA_VISIBLE_DEVICES` | (auto) | GPU index for PyTorch (0 = first GPU) |

### Provider Priority

BrightForge tries LLM providers in this order:

1. Ollama (local, free, no key needed)
2. Groq
3. Cerebras
4. Together
5. Mistral
6. Gemini
7. Claude
8. OpenAI
9. OpenRouter

If a provider is unavailable or over budget ($1/day limit), it falls through to the next one.

---

## Directory Structure After Setup

```
LLCApp/
  bin/                    # CLI entry points
  config/                 # YAML configuration files
  data/                   # Runtime data (created by setup)
    models/               # AI model weights (~8.5 GB)
      instantmesh/        # InstantMesh model files
    output/               # Generated meshes and images
    temp/                 # Temporary files (auto-cleaned)
    forge3d.db            # SQLite database
  desktop/                # Electron desktop app
  docs/                   # Documentation
  public/                 # Web dashboard frontend
  python/                 # Python inference server
    inference_server.py   # FastAPI server (port 8001)
    model_manager.py      # GPU model loading/unloading
    requirements.txt      # Python dependencies
    setup.py              # Environment setup and validator
    venv/                 # Python virtual environment (created by you)
  sessions/               # Session logs (JSON)
  src/                    # Node.js source code
    agents/               # LLM agent implementations
    api/                  # Express server and routes
      routes/
        forge3d.js        # 3D generation API endpoints
    core/                 # Core modules (LLM client, plan engine, etc.)
    forge3d/              # ForgePipeline modules
      model-bridge.js     # Python subprocess manager
      database.js         # SQLite persistence
      forge-session.js    # Generation session lifecycle
      generation-queue.js # Batch job queue
      project-manager.js  # Project and asset CRUD
    ui/                   # Terminal UI
  .env.local              # Your API keys (not committed)
```

---

## Uninstalling

To remove ForgePipeline components without affecting the rest of BrightForge:

```bash
# Remove AI models (largest files)
rmdir /s data\models

# Remove generated output
rmdir /s data\output
rmdir /s data\temp

# Remove the SQLite database
del data\forge3d.db

# Remove the Python virtual environment
rmdir /s python\venv
```

The Node.js modules, web dashboard, and LLM coding features remain fully functional without the Python environment.
