---
name: Algorithmic Art Generator
description: Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use when building generative art for BrightForge's Design tab, creating procedural textures, or generating interactive visual content.
---

# Algorithmic Art Generator

Adapted from [Anthropic Skills](https://github.com/anthropics/skills) `algorithmic-art` skill. Full source at `C:\ClaudeSkills\anthropic-skills\skills\algorithmic-art\`.

## When to Use

- User requests generative or procedural art creation
- Adding p5.js-based generative content to the Design tab
- Creating procedural textures or patterns for 3D assets (Forge3D)
- Building interactive visual demos or art installations

## Two-Phase Workflow

### Phase 1: Algorithmic Philosophy (.md)

Create a computational aesthetic manifesto (4-6 paragraphs) that guides the algorithm:

1. **Name the movement** (1-2 words): "Organic Turbulence", "Quantum Harmonics"
2. **Articulate the philosophy** describing how it manifests through:
   - Computational processes and mathematical relationships
   - Noise functions and randomness patterns
   - Particle behaviors and field dynamics
   - Temporal evolution and system states
   - Parametric variation and emergent complexity
3. **Emphasize craftsmanship** — meticulously crafted, master-level implementation
4. **Leave creative space** for implementation interpretation

### Phase 2: p5.js Implementation (.html)

Express the philosophy as interactive generative art in a self-contained HTML file.

## Technical Requirements

### Seeded Randomness (Art Blocks Pattern)
```javascript
let seed = 12345;
randomSeed(seed);
noiseSeed(seed);
// Same seed ALWAYS produces identical output
```

### Parameter Structure
```javascript
let params = {
  seed: 12345,
  // Define parameters that control YOUR algorithm:
  // - Quantities (how many?)
  // - Scales (how big? how fast?)
  // - Probabilities (how likely?)
  // - Ratios (what proportions?)
  // - Thresholds (when does behavior change?)
};
```

### Canvas Setup
```javascript
function setup() {
  createCanvas(1200, 1200);
  // Initialize your system
}
function draw() {
  // Your generative algorithm — can be static (noLoop) or animated
}
```

## BrightForge Theme Adaptation

The Anthropic viewer template uses their branding (Poppins/Lora fonts, light theme). For BrightForge, adapt to the dark theme design system:

| Anthropic Template | BrightForge Equivalent |
|---|---|
| Light background (#f5f4f0) | `var(--bg-app)` (#09090b) |
| Accent purple/peach | `var(--brand-primary)` (#3B82F6) |
| Poppins/Lora fonts | Inter/Outfit fonts (loaded in dashboard) |
| Anthropic gradient | BrightForge gradient (--brand-primary to --accent-purple) |

### BrightForge Viewer Sidebar Style
```css
/* Match BrightForge dark theme */
.sidebar {
  background: var(--bg-sidebar, #0F1116);
  color: var(--text-primary, #FAFAFA);
  border-right: 1px solid var(--border, #27272A);
  font-family: 'Inter', system-ui, sans-serif;
}
.sidebar h2 {
  font-family: 'Outfit', 'Inter', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.75rem;
  color: var(--text-dim, #52525B);
}
input[type="range"] {
  accent-color: var(--brand-primary, #3B82F6);
}
button {
  background: var(--brand-primary, #3B82F6);
  color: #fff;
  border-radius: var(--radius-md, 8px);
}
```

## Interactive Artifact Structure

Self-contained HTML with p5.js from CDN — no external dependencies:

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js"></script>
  <style>/* BrightForge dark theme styles */</style>
</head>
<body>
  <div id="canvas-container"></div>
  <div id="controls">
    <!-- Seed: display, prev/next/random/jump -->
    <!-- Parameters: sliders for each param -->
    <!-- Actions: regenerate, reset, download PNG -->
  </div>
  <script>
    // ALL p5.js code inline
    // Parameter objects, classes, functions
    // setup() and draw()
    // UI handlers
  </script>
</body>
</html>
```

### Required Features
1. **Parameter Controls** — Sliders for numeric params, color pickers for palette, real-time updates
2. **Seed Navigation** — Display seed, prev/next/random buttons, jump-to-seed input
3. **Actions** — Regenerate, Reset defaults, Download PNG

## BrightForge Integration Points

### Design Tab Integration
- Add "Generative Art" mode alongside image generation in `public/js/design-viewer.js`
- Use `UniversalLLMClient.chat()` with a system prompt to generate the philosophy + p5.js code
- Render output in an iframe or inline canvas within the Design tab

### Design Engine Extension
```javascript
// In src/core/design-engine.js — potential new method
async generateAlgorithmicArt(prompt, style) {
  // 1. Generate philosophy via LLM
  const philosophy = await llmClient.chat({
    task: 'algorithmic_art',
    messages: [{ role: 'user', content: prompt }]
  });
  // 2. Generate p5.js code via LLM using philosophy
  const code = await llmClient.chat({
    task: 'algorithmic_art_code',
    messages: [{ role: 'user', content: philosophy }]
  });
  // 3. Wrap in HTML template
  return this._wrapInViewer(code);
}
```

### Forge3D Texture Generation
- Generate procedural textures (noise patterns, organic surfaces) as PNG
- Feed into Forge3D pipeline as input images for mesh generation
- Save outputs via `ProjectManager.saveAsset()` to `data/output/{projectId}/`

## Philosophy Examples

| Movement | Core Concept | Algorithm |
|----------|-------------|-----------|
| Organic Turbulence | Chaos constrained by natural law | Flow fields + Perlin noise + particle trails |
| Quantum Harmonics | Wave-like interference patterns | Grid particles + phase interference + sine waves |
| Recursive Whispers | Self-similarity across scales | L-systems + golden ratio branching + noise perturbation |
| Field Dynamics | Invisible forces made visible | Vector fields + particle traces + force balance |
| Stochastic Crystallization | Random → ordered structures | Circle packing + Voronoi tessellation + relaxation |

## Reference Templates

Available at `C:\ClaudeSkills\anthropic-skills\skills\algorithmic-art\templates\`:

| File | Purpose |
|------|---------|
| `viewer.html` | Interactive viewer template (Anthropic-branded — adapt to BrightForge theme) |
| `generator_template.js` | p5.js best practices: parameter organization, seeded randomness, lifecycle |

Read these before creating a new generative art piece.
