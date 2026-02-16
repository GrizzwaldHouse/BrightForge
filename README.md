# BrightForge - Hybrid Developer Coding, Design + 3D Agent

A CLI coding, design, and 3D generation agent that uses local LLMs (Ollama) for free, with cloud fallback for complex tasks. Features AI-powered image generation, HTML layout creation, and GPU-accelerated 3D mesh generation. Plan-review-run workflow ensures you always approve changes before they're applied.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment variables (optional - Ollama works without keys)
cp .env.example .env.local

# Run a coding task
node bin/brightforge.js "add a hello world function" --project ./my-project

# Generate a design
node bin/brightforge.js --design "landing page for a coffee shop" --style blue-glass

# Rollback last changes
node bin/brightforge.js --rollback --project ./my-project

# View session history
node bin/brightforge.js --history

# Start web dashboard
npm run server
```

## Requirements

- Node.js 18+
- Ollama (recommended, for free local inference): https://ollama.com
  - Pull a code model: `ollama pull qwen2.5-coder:14b`

## How It Works

### Coding Workflow

1. You submit a coding task via CLI
2. The agent classifies complexity and routes to local (Ollama) or cloud LLM
3. LLM generates a plan with file changes
4. You review colored diffs in the terminal
5. Approve to apply, reject to discard, or edit to modify
6. All actions logged to `sessions/` directory

### Design Engine

1. Describe your design (e.g., "landing page for a coffee shop")
2. Select a style (default, blue-glass, dark-industrial)
3. BrightForge generates images via free-tier AI providers (Pollinations, Together AI, Gemini)
4. LLM creates semantic HTML layout with inline CSS
5. Preview design in terminal or web dashboard
6. Approve to export HTML + images to `output/designs/`

**Design Features:**
- Free-first image generation (no API keys required for Pollinations)
- Multiple design styles with customizable palettes
- Responsive layouts with semantic HTML5
- Web dashboard with live preview
- Export to standalone HTML files

### ForgePipeline (3D Generation)

GPU-accelerated 3D mesh generation powered by a local Python inference server (InstantMesh + SDXL). Runs entirely offline after initial model download.

**Three generation modes:**
- **Image-to-mesh** -- Upload a reference image, receive a GLB mesh
- **Text-to-image** -- Generate an image from a text prompt via SDXL
- **Full pipeline (text-to-mesh)** -- Text prompt goes through SDXL image generation, then InstantMesh converts to a 3D mesh

**Features:**
- Web-based Three.js 3D preview with orbit controls, grid, and wireframe toggle
- Project and asset management backed by SQLite
- Batch generation queue (FIFO, one GPU job at a time)
- VRAM monitoring with auto-warning and degradation thresholds
- glTF/GLB download for generated assets
- Crash recovery for interrupted generations

**ForgePipeline system requirements:**
- NVIDIA GPU with 8GB+ VRAM (tested on RTX 5080)
- Python 3.10+
- CUDA 12.x
- Node.js 18+ (same as base BrightForge)

See `docs/30_DAY_PLAN.md` for the full development roadmap.

## Provider Priority (free-first)

1. Ollama (local, free)
2. Groq (free tier)
3. Cerebras (free tier)
4. Together (free $25 credit)
5. Mistral (free tier)
6. Claude (paid fallback)
7. OpenAI (last resort)

## Testing

Each module has a self-contained `--test` block. Run individual tests via npm scripts:

```bash
# Core modules
npm run test-llm              # LLM client provider chain
npm run test-plan             # Plan engine parsing
npm run test-context          # File context scanning
npm run test-diff             # Diff applier + rollback
npm run test-session          # Session logging
npm run test-terminal         # Terminal UI
npm run test-image            # Image generation client
npm run test-design           # Design engine
npm run test-history          # Message history
npm run test-conversation     # Conversation session
npm run test-multi-step       # Multi-step planner
npm run test-api              # Web session API

# ForgePipeline (3D generation)
npm run test-bridge           # Python inference server bridge
npm run test-forge-db         # SQLite database layer
npm run test-forge-session    # Generation lifecycle
npm run test-project-manager  # Project/asset CRUD
npm run test-queue            # Batch generation queue

# Run all core tests
npm run test-all-core

# Linting
npm run lint
npm run lint:fix
```

## License

MIT
