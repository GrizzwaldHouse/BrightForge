# BrightForge Demo Video Script

**Target Duration:** 2-3 minutes
**Recommended Tool:** OBS Studio, QuickTime (Mac), or Windows Game Bar

This script guides you through recording a comprehensive demo video showcasing all BrightForge features.

---

## Pre-Recording Checklist

- [ ] Start BrightForge server: `npm run server`
- [ ] Verify Python server running (check `http://localhost:8765/health`)
- [ ] Pull Ollama model: `ollama pull qwen2.5-coder:14b`
- [ ] Clear browser cache and sessions directory
- [ ] Prepare test project in separate folder
- [ ] Set up screen recorder (1920x1080 recommended)
- [ ] Test audio levels (optional voice-over)
- [ ] Close unnecessary applications (clean desktop)

---

## Scene 1: Introduction (0:00 - 0:15)

**Visual:** BrightForge logo + README.md headline

**Script (Optional Voice-Over):**
> "BrightForge is a production-ready AI creative studio combining three powerful capabilities: a coding agent, design engine, and GPU-accelerated 3D mesh generation. All powered by a free-first LLM provider chain."

**On-Screen Actions:**
1. Show README.md in browser
2. Highlight version badge (v4.2.0)
3. Scroll to features section

---

## Scene 2: Web Dashboard Overview (0:15 - 0:30)

**Visual:** Web dashboard at `http://localhost:3847`

**Script:**
> "The dashboard provides a clean, professional interface with tabs for Chat, Design, Forge3D, Health, and Sessions."

**On-Screen Actions:**
1. Open `http://localhost:3847`
2. Click through each tab (2 seconds each):
   - **Chat** - Coding assistant
   - **Design** - Image generation
   - **Forge 3D** - 3D mesh pipeline
   - **Health** - System monitoring
   - **Sessions** - History
3. Return to **Chat** tab

---

## Scene 3: Coding Agent Demo (0:30 - 1:00)

**Visual:** Chat tab with plan-review-run workflow

**Script:**
> "The coding agent uses a plan-review-run workflow. Watch as it generates a plan, shows colored diffs, and applies changes with automatic backup."

**On-Screen Actions:**
1. Type prompt: `"add a hello world function to index.js"`
2. Click **Send** button
3. Wait for plan to generate (~5-10 seconds)
4. **Highlight plan preview:**
   - Show green + lines (additions)
   - Show red - lines (deletions)
   - Point to file path
5. Click **Approve** button
6. Wait for success message
7. **Show backup file** in file browser (`index.js.brightforge-backup`)
8. Optional: Click **Rollback** button to demonstrate undo

---

## Scene 4: Design Engine Demo (1:00 - 1:25)

**Visual:** Design tab with image generation

**Script:**
> "The design engine generates AI images and semantic HTML layouts. It uses a free-first provider chain: Pollinations, Together AI, and Gemini."

**On-Screen Actions:**
1. Click **Design** tab
2. Type prompt: `"modern landing page for a coffee shop"`
3. Select style: **blue-glass**
4. Click **Generate Design**
5. Wait for image to appear (~10-15 seconds)
6. **Show generated result:**
   - Image preview
   - HTML code preview
7. Click **Preview** button to open in new tab
8. Show responsive design (resize browser)

---

## Scene 5: Forge3D Pipeline Demo (1:25 - 2:00)

**Visual:** Forge3D tab with 3D generation

**Script:**
> "Forge3D generates 3D meshes using GPU-accelerated SDXL and InstantMesh models. It supports image-to-mesh, text-to-image, and full pipeline modes."

**On-Screen Actions:**
1. Click **Forge 3D** tab
2. Select generation type: **Full Pipeline (Text-to-Mesh)**
3. Type prompt: `"low-poly isometric house with red roof"`
4. Click **Generate**
5. **Show generation progress:**
   - Queue status (Generating...)
   - Progress bar
   - VRAM usage meter
6. Wait for completion (~30-60 seconds)
7. **Show 3D viewer:**
   - Orbit camera with mouse
   - Toggle wireframe button
   - Show grid toggle
8. Click **Download GLB** button

---

## Scene 6: Health Monitoring Demo (2:00 - 2:15)

**Visual:** Health tab with system metrics

**Script:**
> "BrightForge provides comprehensive monitoring with provider statistics, latency percentiles, and error tracking."

**On-Screen Actions:**
1. Click **Health** tab
2. **Show metrics:**
   - Provider status grid (green = available)
   - Latency chart (P50/P95/P99)
   - Success rate percentage
   - Budget usage ($X.XX / $1.00)
3. Scroll to **Error Log** section
4. Show empty error log (or recent errors if any)

---

## Scene 7: Status Dashboard Demo (2:15 - 2:30)

**Visual:** Real-time status page

**Script:**
> "The real-time status dashboard provides a bird's-eye view of system health with auto-refresh every 10 seconds."

**On-Screen Actions:**
1. Open new tab: `http://localhost:3847/status.html`
2. **Show status cards:**
   - Overall Status (Operational)
   - Server Uptime
   - Memory Usage
   - Component Health (Node.js, Database, Python)
   - LLM Provider grid (color-coded)
   - Usage Statistics
3. Wait 10 seconds to show auto-refresh

---

## Scene 8: CLI Demo (2:30 - 2:50)

**Visual:** Terminal with CLI commands

**Script:**
> "BrightForge also works via command line with the same plan-review-run workflow."

**On-Screen Actions:**
1. Open terminal
2. Run: `node bin/brightforge.js "add a loading spinner component"`
3. **Show terminal output:**
   - File context scanning
   - Plan generation
   - Colored diff preview
   - Approval prompt
4. Type: `y` (approve)
5. Show success message
6. Run: `node bin/brightforge.js --rollback`
7. Show rollback confirmation

---

## Scene 9: Docker Deployment (2:50 - 3:00)

**Visual:** Docker commands and logs

**Script:**
> "Deploy to production with Docker. GPU-accelerated containers for the full 3D pipeline, or CPU-only for coding and design features."

**On-Screen Actions:**
1. Show `docker-compose.yml` in editor
2. Run: `docker-compose up -d`
3. **Show logs:** `docker-compose logs --tail=20`
4. Open `http://localhost:3847` in browser
5. Show dashboard running in Docker

---

## Scene 10: Closing (3:00 - 3:10)

**Visual:** README.md + GitHub repo

**Script:**
> "BrightForge v4.2.0 - production-ready AI creative studio. Free-first provider chain, comprehensive docs, and MIT licensed. Star the repo on GitHub!"

**On-Screen Actions:**
1. Show GitHub repository page
2. Highlight:
   - Star button
   - Documentation links (INSTALL.md, DOCKER.md, DEPLOYMENT.md)
   - License badge (MIT)
3. **End with call-to-action:**
   - "Get started at github.com/GrizzwaldHouse/BrightForge"

---

## Recording Tips

### Visual Quality

- **Resolution:** 1920x1080 (1080p) minimum
- **Frame Rate:** 30 FPS or 60 FPS
- **Bitrate:** 5-10 Mbps (high quality)
- **Font Size:** Increase terminal/editor font to 16-18pt for readability

### Audio (Optional)

- **Microphone:** USB mic or headset (avoid laptop mic)
- **Recording Level:** -12 to -6 dB (avoid clipping)
- **Background Music:** Royalty-free music at low volume (optional)
- **Silence Removal:** Trim pauses longer than 2 seconds

### Editing

- **Trim:** Remove dead air, long waits, mistakes
- **Speed Up:** 1.25-1.5x for long operations (model downloads, generation)
- **Annotations:** Add text overlays for key features
- **Transitions:** Simple cuts (avoid fancy effects)

### Tools

| Tool | Platform | Cost | Notes |
|------|----------|------|-------|
| **OBS Studio** | Windows/Mac/Linux | Free | Industry standard, highly configurable |
| **QuickTime** | Mac | Free | Built-in, simple screen recording |
| **Windows Game Bar** | Windows 10/11 | Free | Win+G shortcut, basic features |
| **ScreenFlow** | Mac | Paid ($169) | Professional editing + recording |
| **Camtasia** | Windows/Mac | Paid ($299) | Full-featured editor |

---

## Publishing

### Video Platforms

1. **YouTube** (Recommended)
   - Upload as unlisted or public
   - Title: "BrightForge v4.2.0 - AI Creative Studio Demo"
   - Description: Link to GitHub repo + feature list
   - Tags: ai, coding, 3d, mesh, generation, llm, free, open-source

2. **GitHub README**
   - Embed YouTube video: `[![Demo Video](thumbnail.png)](https://youtube.com/watch?v=...)`
   - Or upload directly to GitHub releases (max 100MB)

3. **Social Media**
   - Twitter/X: 30-60 second teaser clip
   - LinkedIn: Full video with professional description
   - Reddit: r/machinelearning, r/artificial

### Thumbnail Design

Create an eye-catching thumbnail (1280x720):
- **Title:** "BrightForge v4.2.0 Demo"
- **Visuals:** Split screen of Chat + 3D viewer
- **Colors:** Dark theme with blue accent (matches dashboard)
- **Text:** Large, bold, readable at small sizes

---

## Example Timeline (3-minute version)

| Time | Scene | Content |
|------|-------|---------|
| 0:00-0:15 | Intro | Logo + overview |
| 0:15-0:30 | Dashboard | Tab navigation |
| 0:30-1:00 | Coding | Plan-review-run workflow |
| 1:00-1:25 | Design | Image generation + HTML |
| 1:25-2:00 | Forge3D | 3D mesh generation |
| 2:00-2:15 | Health | Monitoring + metrics |
| 2:15-2:30 | Status | Real-time dashboard |
| 2:30-2:50 | CLI | Terminal demo |
| 2:50-3:00 | Docker | Deployment |
| 3:00-3:10 | Closing | Call-to-action |

---

## Post-Production Checklist

- [ ] Trim silences and dead air
- [ ] Add intro/outro graphics (optional)
- [ ] Normalize audio levels
- [ ] Color grade (if needed)
- [ ] Add captions/subtitles (optional, improves accessibility)
- [ ] Export at 1080p, H.264 codec
- [ ] Generate thumbnail image
- [ ] Upload to YouTube
- [ ] Update README.md with video link
- [ ] Share on social media

---

## License

This demo script is part of BrightForge and is released under the MIT License.

---

## Contact

Questions about the demo? Open a [GitHub Issue](https://github.com/GrizzwaldHouse/BrightForge/issues).
