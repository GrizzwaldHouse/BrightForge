# BrightForge Installation Guide

Complete installation instructions for Windows, Linux, and macOS.

## Prerequisites

### Required

- **Node.js 18+** - JavaScript runtime ([download](https://nodejs.org/))
- **Git** - Version control ([download](https://git-scm.com/downloads))
- **npm** - Package manager (included with Node.js)

### Optional (for 3D generation)

- **Python 3.10+** - Required for Forge3D pipeline ([download](https://www.python.org/downloads/))
- **CUDA GPU** - NVIDIA GPU with 8GB+ VRAM for SDXL + InstantMesh models
- **NVIDIA Drivers** - Latest GPU drivers with CUDA 12.4+ support

### Optional (for local LLM)

- **Ollama** - Local LLM runtime ([download](https://ollama.ai/download))

---

## Quick Start (All Platforms)

```bash
# 1. Clone repository
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.local.example .env.local

# 4. (Optional) Add API keys to .env.local
# See "Configuration" section below

# 5. Test installation
npm run test-llm

# 6. Start coding
node bin/brightforge.js "add a hello world function"
```

---

## Windows Installation

### 1. Install Node.js

Download and install from [nodejs.org](https://nodejs.org/). Choose the **LTS** version (18.x or higher).

Verify installation:
```powershell
node --version  # Should show v18.x.x or higher
npm --version   # Should show 9.x.x or higher
```

### 2. Install Git

Download from [git-scm.com](https://git-scm.com/download/win) and install with default options.

Verify:
```powershell
git --version
```

### 3. Clone BrightForge

```powershell
cd C:\Users\YourName\Projects
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge
```

### 4. Install Dependencies

```powershell
npm install
```

This installs all Node.js dependencies (~50MB, takes 1-2 minutes).

### 5. Configure Environment

```powershell
# Copy template
copy .env.local.example .env.local

# Edit with Notepad
notepad .env.local
```

Add your API keys (see **Configuration** section below).

### 6. (Optional) Install Python for 3D Generation

**Skip this if you only want coding + image generation features.**

1. Download Python 3.10+ from [python.org](https://www.python.org/downloads/)
2. **Important:** Check "Add Python to PATH" during installation
3. Install dependencies:

```powershell
cd python
pip install -r requirements.txt
```

This downloads PyTorch, SDXL, and InstantMesh models (~15GB, takes 10-30 minutes).

### 7. (Optional) Install Ollama for Local LLM

Download from [ollama.ai/download](https://ollama.ai/download) and install.

Pull a coding model:
```powershell
ollama pull qwen2.5-coder:14b
```

### 8. Verify Installation

```powershell
# Test LLM client (tries all providers)
npm run test-llm

# Test image generation
npm run test-image

# Test design engine
npm run test-design

# Start web server
npm run server
# Open http://localhost:3847
```

---

## Linux Installation (Ubuntu/Debian)

### 1. Install Node.js 18+

```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# Install Node.js
sudo apt-get install -y nodejs

# Verify
node --version
npm --version
```

### 2. Install Git

```bash
sudo apt-get update
sudo apt-get install -y git

git --version
```

### 3. Clone BrightForge

```bash
cd ~/Projects
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Configure Environment

```bash
cp .env.local.example .env.local
nano .env.local  # or vim, emacs, etc.
```

Add your API keys (see **Configuration** section).

### 6. (Optional) Install Python for 3D Generation

```bash
# Install Python 3.10+
sudo apt-get install -y python3.10 python3-pip

# Install CUDA toolkit (if you have NVIDIA GPU)
# Follow: https://developer.nvidia.com/cuda-downloads

# Install Python dependencies
cd python
pip3 install -r requirements.txt
```

### 7. (Optional) Install Ollama

```bash
curl https://ollama.ai/install.sh | sh
ollama pull qwen2.5-coder:14b
```

### 8. Verify Installation

```bash
npm run test-llm
npm run server
# Open http://localhost:3847
```

---

## macOS Installation

### 1. Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Node.js

```bash
brew install node@18

# Verify
node --version
npm --version
```

### 3. Install Git

```bash
brew install git
git --version
```

### 4. Clone BrightForge

```bash
cd ~/Projects
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge
```

### 5. Install Dependencies

```bash
npm install
```

### 6. Configure Environment

```bash
cp .env.local.example .env.local
nano .env.local
```

### 7. (Optional) Install Python for 3D Generation

```bash
# Install Python 3.10+
brew install python@3.10

# Install dependencies
cd python
pip3 install -r requirements.txt
```

**Note:** 3D generation on macOS requires **Apple Silicon (M1/M2/M3)** with Metal support. CUDA is NVIDIA-only.

### 8. (Optional) Install Ollama

```bash
brew install ollama
ollama pull qwen2.5-coder:14b
```

### 9. Verify Installation

```bash
npm run test-llm
npm run server
# Open http://localhost:3847
```

---

## Configuration

### Environment Variables (.env.local)

BrightForge uses a **free-first provider chain**. All API keys are optional — the system will use Ollama (local, free) if no keys are set.

Create `.env.local` from the template:

```bash
# Copy template
cp .env.local.example .env.local
```

Edit `.env.local` and add API keys for cloud providers:

```env
# LLM Providers (all optional, free-first chain)
GROQ_API_KEY=gsk_...           # Free tier: 14,000 tokens/min
CEREBRAS_API_KEY=csk-...       # Free tier
TOGETHER_API_KEY=...           # Free $25 credit
MISTRAL_API_KEY=...            # Free tier
GEMINI_API_KEY=...             # Free tier + image generation
CLAUDE_API_KEY=sk-ant-...      # Paid fallback
OPENAI_API_KEY=sk-...          # Paid fallback
OPENROUTER_API_KEY=sk-or-...   # Aggregator

# Image Providers (optional, free-first)
# Pollinations is completely free, no key needed
# STABILITY_API_KEY=sk-...     # Paid, disabled by default

# Server Configuration (optional)
PORT=3847
NODE_ENV=development
```

### Getting API Keys

| Provider | Free Tier | Sign Up Link |
|----------|-----------|--------------|
| **Groq** | 14K tokens/min | [console.groq.com](https://console.groq.com) |
| **Cerebras** | Yes | [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| **Together** | $25 credit | [api.together.xyz](https://api.together.xyz) |
| **Mistral** | Free tier | [console.mistral.ai](https://console.mistral.ai) |
| **Gemini** | Free tier | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Claude** | Paid only | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | Paid only | [platform.openai.com](https://platform.openai.com/api-keys) |
| **OpenRouter** | Aggregator | [openrouter.ai](https://openrouter.ai/keys) |

### Provider Chain Priority

BrightForge tries providers in this order:

1. **Ollama** (local, free) — If running and model is pulled
2. **Groq** (free tier) — Fast inference, 14K tokens/min
3. **Cerebras** (free tier) — Ultra-fast inference
4. **Together** (free $25) — FLUX image + LLM
5. **Mistral** (free tier) — Mixtral models
6. **Gemini** (free tier) — Gemini 2.0 Flash + image gen
7. **Claude** (paid) — High quality fallback
8. **OpenAI** (paid) — GPT-4 last resort
9. **OpenRouter** (aggregator) — Multiple providers

If a provider is unavailable (no API key, rate limited, or offline), the system automatically falls back to the next provider.

### Daily Budget

Default budget limit: **$1.00 per day** (configurable in `config/llm-providers.yaml`).

Budget resets at midnight. When budget is exceeded, only free providers (Ollama, Groq, Cerebras) are used.

---

## Verification

### Test Core Modules

```bash
# LLM client (tests provider chain)
npm run test-llm

# Image generation
npm run test-image

# Design engine (image + layout)
npm run test-design

# Plan engine (parsing + validation)
npm run test-plan

# File context (project scanning)
npm run test-context

# Diff applier (backup + rollback)
npm run test-diff

# All Forge3D modules (requires Python)
npm run test-bridge
npm run test-forge-session
npm run test-forge-db
npm run test-project-manager
```

### Start Web Server

```bash
npm run server
```

Open http://localhost:3847 in your browser. You should see the BrightForge dashboard.

### Test Coding Agent (CLI)

```bash
# Simple task
node bin/brightforge.js "add a hello world function"

# Interactive chat
node bin/brightforge.js --chat

# Design mode
node bin/brightforge.js --design "modern landing page"
```

### Test 3D Generation (requires Python + GPU)

```bash
# Start Python server manually (one-time)
cd python
python inference_server.py
# Keep running in separate terminal

# Generate 3D mesh from image
# Upload image via web dashboard at http://localhost:3847
# Navigate to Forge3D tab and start generation
```

---

## Troubleshooting

### "node: command not found"

**Cause:** Node.js not in PATH.

**Fix (Windows):**
1. Reinstall Node.js from [nodejs.org](https://nodejs.org/)
2. Restart terminal/PowerShell

**Fix (Linux/Mac):**
```bash
# Ubuntu/Debian
sudo apt-get install -y nodejs npm

# macOS
brew install node@18
```

### "npm install" fails with EACCES errors

**Cause:** Permission issues (common on Linux/Mac).

**Fix:**
```bash
# Option 1: Use npm's fix
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH

# Option 2: Fix permissions
sudo chown -R $(whoami) ~/.npm
```

### "Cannot find module" errors

**Cause:** Dependencies not installed.

**Fix:**
```bash
rm -rf node_modules package-lock.json
npm install
```

### "OLLAMA_HOST connection refused"

**Cause:** Ollama not running.

**Fix:**
```bash
# Windows: Start Ollama from Start Menu
# Linux/Mac:
ollama serve

# Pull a model
ollama pull qwen2.5-coder:14b
```

### "Python server not responding" (Forge3D)

**Cause:** Python dependencies not installed or GPU issues.

**Fix:**
```bash
# Install dependencies
cd python
pip install -r requirements.txt

# Check GPU
python -c "import torch; print(torch.cuda.is_available())"
# Should print: True

# Start server manually
python inference_server.py
```

### "CUDA out of memory"

**Cause:** GPU VRAM insufficient for SDXL + InstantMesh.

**Fix:** Reduce image resolution in `python/config.yaml`:
```yaml
generation:
  default_width: 512   # Lower from 1024
  default_height: 512
```

Requires restart of Python server.

### "Port 3847 already in use"

**Cause:** Another process using the port.

**Fix (Windows):**
```powershell
netstat -ano | findstr :3847
taskkill /PID <PID> /F
```

**Fix (Linux/Mac):**
```bash
lsof -ti:3847 | xargs kill -9
```

Or change port in `.env.local`:
```env
PORT=8080
```

### "API key not valid"

**Cause:** Incorrect API key format or expired key.

**Fix:**
1. Regenerate key from provider's console
2. Verify no extra spaces in `.env.local`
3. Restart server: `npm run server`

### Tests fail with "Budget exceeded"

**Cause:** Daily budget limit reached ($1.00 default).

**Fix:** Wait until midnight (budget resets) or increase limit in `config/llm-providers.yaml`:
```yaml
budget:
  daily_limit: 5.00  # Increase to $5/day
```

---

## Next Steps

Once installation is verified:

1. **Try a coding task:**
   ```bash
   node bin/brightforge.js "add a loading spinner component"
   ```

2. **Start the web dashboard:**
   ```bash
   npm run server
   # Open http://localhost:3847
   ```

3. **Generate an image:**
   Navigate to **Design** tab in dashboard, enter a prompt.

4. **Generate a 3D mesh (requires Python + GPU):**
   Navigate to **Forge3D** tab, upload image or enter prompt.

5. **Read the documentation:**
   - [README.md](README.md) - Feature overview
   - [DOCKER.md](DOCKER.md) - Docker deployment
   - [CLAUDE.md](CLAUDE.md) - Development guide

---

## Support

- **Issues:** [GitHub Issues](https://github.com/GrizzwaldHouse/BrightForge/issues)
- **Discussions:** [GitHub Discussions](https://github.com/GrizzwaldHouse/BrightForge/discussions)
- **Documentation:** [README.md](README.md)

---

## License

MIT License - see [LICENSE](LICENSE) for details.
