---
name: Web Artifacts Builder
description: Build self-contained web artifacts using React, Tailwind CSS, and shadcn/ui, bundled into single HTML files. Use for standalone tools, rich previews, or component-based widgets alongside BrightForge's dashboard.
---

# Web Artifacts Builder

Adapted from [Anthropic Skills](https://github.com/anthropics/skills) `web-artifacts-builder` skill. Full source at `C:\ClaudeSkills\anthropic-skills\skills\web-artifacts-builder\`.

## When to Use

- Building standalone tools (project exporters, asset viewers, report generators)
- Creating rich component-based previews for the Design tab
- Prototyping new dashboard features with React before vanilla JS integration
- Building self-contained HTML widgets to serve alongside the BrightForge dashboard

## Stack

React 18 + TypeScript + Vite + Parcel (bundling) + Tailwind CSS + shadcn/ui

## Quick Start

### Step 1: Initialize Project

**On Windows** (Git Bash required):
```bash
# From Git Bash (C:\Program Files\Git\bin\bash.exe)
bash "C:\ClaudeSkills\anthropic-skills\skills\web-artifacts-builder\scripts\init-artifact.sh" <project-name>
cd <project-name>
```

**What it creates:**
- React + TypeScript via Vite
- Tailwind CSS 3.4.1 with shadcn/ui theming
- Path aliases (`@/`) configured
- 40+ shadcn/ui components pre-installed (from `shadcn-components.tar.gz`)
- All Radix UI dependencies included
- Node 18+ compatibility

### Step 2: Develop

Edit the generated files. Key locations:
- `src/App.tsx` — Main application component
- `src/components/` — Your custom components
- `src/components/ui/` — shadcn/ui components (pre-installed)

### Step 3: Bundle to Single HTML

```bash
# From Git Bash
bash "C:\ClaudeSkills\anthropic-skills\skills\web-artifacts-builder\scripts\bundle-artifact.sh"
```

Creates `bundle.html` — self-contained with all JS, CSS, and dependencies inlined.

### Step 4: Serve or Share

The `bundle.html` file works immediately in any browser. Can be:
- Served via BrightForge's Express static middleware
- Opened directly as a local file
- Embedded in an iframe within the dashboard

## Design Guidelines

Avoid "AI slop" — no excessive centered layouts, purple gradients, uniform rounded corners, or Inter-everywhere monotony.

### Align with BrightForge Design System
When building artifacts for BrightForge, match the existing design tokens:

```css
/* Use BrightForge tokens in Tailwind config or inline */
--bg-app: #09090b;
--bg-card: #141820;
--brand-primary: #3B82F6;
--text-primary: #FAFAFA;
--text-secondary: #A1A1AA;
--radius-md: 8px;
```

See `.claude/skills/ui-design-system.md` for the full token reference.

## BrightForge Integration Points

### Standalone Tools
Build self-contained tools that run alongside the dashboard:

| Tool Idea | Purpose | Serves At |
|-----------|---------|-----------|
| Asset Browser | Rich 3D asset gallery with filters/search | `/tools/asset-browser` |
| Generation Report | Visual report of generation history + stats | `/tools/report` |
| Project Exporter | Package project assets for download | `/tools/export` |
| Prompt Library | Browse/edit/test prompt templates | `/tools/prompts` |

### Serving from Express
```javascript
// In src/api/server.js — mount bundled artifacts
import { join } from 'path';
app.use('/tools', express.static(join(__dirname, '../../tools')));
```

### Design Tab Previews
Generated HTML layouts from the Design Engine could use React + shadcn/ui components for richer, more interactive previews than the current vanilla HTML output.

### Future Dashboard Migration
If BrightForge's dashboard is ever modernized from vanilla JS to React:
- This skill provides the scaffolding pattern
- shadcn/ui components replace hand-written CSS components
- Tailwind replaces the custom CSS custom property system
- Each tab (Chat, Design, Forge3D, Health) becomes a React component

## Windows Notes

- The init and bundle scripts are bash — use **Git Bash** (installed with Git for Windows)
- `shadcn-components.tar.gz` requires `tar` (available in Git Bash and Windows 10+)
- Node.js 18+ required (the script auto-detects and pins Vite version for compatibility)
- If `npx` fails, ensure `npm` is in PATH and not aliased

## Reference Files

Available at `C:\ClaudeSkills\anthropic-skills\skills\web-artifacts-builder\scripts\`:

| File | Purpose |
|------|---------|
| `init-artifact.sh` | Project scaffolding (creates Vite + React + Tailwind project) |
| `bundle-artifact.sh` | Bundles project into single self-contained HTML file |
| `shadcn-components.tar.gz` | Pre-built shadcn/ui component library (40+ components) |

## shadcn/ui Component Reference

Full docs: https://ui.shadcn.com/docs/components

Key components available after init:
- **Layout**: Card, Separator, ScrollArea, Tabs, Accordion
- **Forms**: Button, Input, Select, Checkbox, Switch, Slider, Form
- **Feedback**: Alert, Badge, Toast, Progress, Skeleton
- **Overlay**: Dialog, Sheet, Popover, Tooltip, DropdownMenu
- **Data**: Table, DataTable (with sorting/filtering)
- **Navigation**: NavigationMenu, Breadcrumb, Pagination
