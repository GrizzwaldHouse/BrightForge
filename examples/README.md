# BrightForge Examples

Practical examples and starter templates to help you get started with BrightForge.

---

## Example Projects

| Example | Difficulty | Features | Description |
|---------|------------|----------|-------------|
| [hello-world](hello-world/) | Beginner | Coding | Simple function generation |
| [react-component](react-component/) | Intermediate | Coding | React component with hooks |
| [full-stack-app](full-stack-app/) | Advanced | Coding | Multi-file Express + React app |
| [landing-page](landing-page/) | Intermediate | Design | AI-generated landing page |
| [3d-asset-batch](3d-asset-batch/) | Advanced | Forge3D | Batch 3D mesh generation |

---

## Quick Start

### 1. Choose an Example

```bash
cd examples/hello-world
```

### 2. Read the README

Each example has a dedicated README with:
- Overview and learning objectives
- Prerequisites
- Step-by-step instructions
- Expected output
- Troubleshooting tips

### 3. Run BrightForge

Follow the example's instructions to run BrightForge commands.

---

## Example Summaries

### Hello World (Beginner)

**Goal:** Generate a simple "Hello, World!" function in JavaScript.

**What you'll learn:**
- Basic CLI usage
- Plan-review-run workflow
- Backup and rollback

**Time:** 5 minutes

---

### React Component (Intermediate)

**Goal:** Create a reusable React button component with TypeScript.

**What you'll learn:**
- Multi-file editing
- Import dependency tracking
- TypeScript integration

**Time:** 10 minutes

---

### Full-Stack App (Advanced)

**Goal:** Build a complete Express backend + React frontend for a todo app.

**What you'll learn:**
- Project structure generation
- API route creation
- Frontend-backend integration
- Multi-step planning

**Time:** 20-30 minutes

---

### Landing Page (Intermediate)

**Goal:** Generate an AI-powered landing page with images and HTML.

**What you'll learn:**
- Design Engine workflow
- Style selection
- Image generation providers
- HTML export

**Time:** 10 minutes

---

### 3D Asset Batch (Advanced)

**Goal:** Generate multiple 3D meshes from a list of prompts.

**What you'll learn:**
- Forge3D pipeline
- Batch processing
- Queue management
- GLB/FBX export

**Time:** 30 minutes (includes model generation)

---

## Prerequisites

### All Examples

- Node.js 18+
- BrightForge installed (`npm install` in root directory)
- Ollama with `qwen2.5-coder:14b` model (or cloud API keys)

### Design Examples

- At least one image provider configured (Gemini, Together, etc.)

### Forge3D Examples

- Python 3.10+
- NVIDIA GPU with 8GB+ VRAM
- CUDA 12.4+
- Python dependencies installed (`pip install -r python/requirements.txt`)

---

## Running Examples

### CLI Mode

```bash
# Navigate to example directory
cd examples/hello-world

# Run BrightForge with the provided prompt
node ../../bin/brightforge.js "add a hello world function" --project .

# Or use the example's script (if provided)
./run-example.sh
```

### Web Dashboard

```bash
# Start server
npm run server

# Open browser
# http://localhost:3847

# Paste the example prompt from README
# Follow the web UI workflow
```

---

## Creating Your Own Examples

Want to contribute an example? Follow this structure:

```
examples/
  my-example/
    README.md          # Overview, instructions, expected output
    prompt.txt         # The BrightForge prompt to use
    expected-output/   # What the result should look like
    run-example.sh     # (Optional) Automated script
```

**Example README Template:**

```markdown
# My Example

## Overview

Brief description of what this example demonstrates.

## Prerequisites

- Specific requirements beyond base BrightForge

## Instructions

1. Step one
2. Step two
3. Step three

## Expected Output

```
## Troubleshooting

Common issues and fixes

```

---

## Additional Resources

- [Installation Guide](../INSTALL.md)
- [Docker Deployment](../DOCKER.md)
- [Cloud Deployment](../DEPLOYMENT.md)
- [API Reference](../docs/API.md)
- [Architecture](../docs/ARCHITECTURE.md)

---

## License

All examples are released under the MIT License (same as BrightForge).
