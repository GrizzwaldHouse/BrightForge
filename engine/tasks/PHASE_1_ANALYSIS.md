# Phase 1: Analysis - Task Breakdown

**Agent:** RepoAnalyzer
**Gate:** Must complete before all other phases (Phase 2-5 are blocked until Phase 1 is done)
**Estimated Duration:** 8 hours total
**Status:** PENDING

---

## Task 1.1: Map Project Structure

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Estimate | 1 hour |
| Status | PENDING |
| Dependencies | None |
| Output | `analysis/structure_map.md` |

### Description

List all source files in the project, categorize them by subsystem (rendering, UI, math, utilities), and produce a full dependency map.

### Steps

1. Recursively list all `.cpp`, `.h`, `.hpp` files in the project tree
2. Categorize each file into its subsystem:
   - **Rendering**: Vulkan pipeline, shaders, rasterizer
   - **UI**: wxWidgets panels, dialogs, controls
   - **Math**: Vector, matrix, transform utilities
   - **Core**: Entry point, configuration, globals
3. Build include-dependency chains for each file
4. Flag any circular dependencies detected
5. Note unused files (included by nothing, include nothing beyond stdlib)

### Debug Checkpoints

```cpp
// After structure scan completes
QuoteSystem::log("PHASE1", "Structure scan complete: %d files mapped", fileCount);
DebugWindow::append("[1.1] Dependency chains built. Circular deps found: %d", circularCount);
```

### Acceptance Criteria

- [ ] Every source file is listed and categorized
- [ ] Dependency chains are complete (no missing edges)
- [ ] Circular dependencies are explicitly flagged with file pairs
- [ ] Unused files are identified
- [ ] Output written to `analysis/structure_map.md`

---

## Task 1.2: Identify Rendering Pipeline Flow

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Estimate | 2 hours |
| Status | PENDING |
| Dependencies | None |
| Output | `analysis/pipeline_flow.md` |

### Description

Trace the full rendering pipeline from application entry through frame submission. Document both the Vulkan hardware path and the software rasterizer path.

### Steps

1. Trace Vulkan pipeline from `main.cpp` entry point through `Renderer`:
   - Instance creation -> Physical device selection -> Logical device
   - Swapchain setup -> Render pass -> Framebuffers
   - Command buffer recording -> Queue submission -> Presentation
2. Trace the software rasterizer path (if present) as an alternative backend
3. Map data flow for each frame:
   - Vertex data source -> Vertex shader -> Rasterization -> Fragment shader -> Framebuffer
4. Document synchronization primitives (fences, semaphores)
5. Identify where pipeline state is configured vs hardcoded

### Debug Checkpoints

```cpp
QuoteSystem::log("PHASE1", "Vulkan pipeline traced: %d stages identified", stageCount);
DebugWindow::append("[1.2] Render pass structure: %d subpasses, %d attachments", subpassCount, attachmentCount);
```

### Acceptance Criteria

- [ ] Vulkan pipeline fully traced from init to frame present
- [ ] Software rasterizer path documented
- [ ] Data flow diagram produced
- [ ] All synchronization points identified
- [ ] Output written to `analysis/pipeline_flow.md`

---

## Task 1.3: Audit UI/UX Implementation

| Field | Value |
|-------|-------|
| Priority | MED |
| Estimate | 1.5 hours |
| Status | PENDING |
| Dependencies | None |
| Output | `analysis/ui_audit.md` |

### Description

Review all wxWidgets-based UI files, document existing components, and identify coupling between UI and backend subsystems.

### Steps

1. Identify all wxWidgets source files (panels, frames, dialogs, controls)
2. Document each UI component:
   - Class name, parent class, purpose
   - Event handlers registered
   - Backend calls made directly from UI code
3. Identify coupling issues:
   - Direct renderer calls from UI event handlers
   - Shared global state between UI and rendering
   - Missing abstraction layers
4. Note any accessibility features present or absent
5. Catalog custom controls vs stock wxWidgets controls

### Debug Checkpoints

```cpp
QuoteSystem::log("PHASE1", "UI audit: %d components found, %d coupling issues", componentCount, couplingCount);
DebugWindow::append("[1.3] wxWidgets components cataloged. Direct backend calls: %d", directCallCount);
```

### Acceptance Criteria

- [ ] All UI components documented with class hierarchy
- [ ] Event handler inventory complete
- [ ] Coupling issues listed with file:line references
- [ ] Output written to `analysis/ui_audit.md`

---

## Task 1.4: Detect Coupling Issues

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Estimate | 1.5 hours |
| Status | PENDING |
| Dependencies | None |
| Output | `analysis/coupling_report.md` |

### Description

Find all direct cross-subsystem calls, global mutable state, and hardcoded values that prevent clean separation.

### Steps

1. Find direct calls between subsystems (e.g., UI calling Vulkan functions directly)
2. Identify all global mutable state, especially `extern` variables
3. Flag hardcoded magic numbers and string literals
4. Document each issue with file, line, and severity

### Known Issues

The following are already identified and must appear in the report:

| Issue | Type | Location |
|-------|------|----------|
| `extern Matrix4x4` | Global mutable state | Shared across rendering and math |
| `extern bool isCube` | Global mutable state | Controls geometry selection globally |
| `extern VertexShaderFunc` | Global mutable state | Function pointer shared across modules |
| `static` locals in `Camera.h` | Hidden state | Camera state persists unexpectedly via static |

### Debug Checkpoints

```cpp
QuoteSystem::log("PHASE1", "Coupling scan: %d extern vars, %d direct cross-calls", externCount, crossCallCount);
DebugWindow::append("[1.4] Global mutable state inventory: %d items flagged", globalStateCount);
```

### Acceptance Criteria

- [ ] All `extern` variables cataloged
- [ ] All direct cross-subsystem calls identified
- [ ] All four known issues confirmed and documented
- [ ] Hardcoded values flagged with suggested replacements
- [ ] Output written to `analysis/coupling_report.md`

---

## Task 1.5: Identify Reusable vs Hardcoded Logic

| Field | Value |
|-------|-------|
| Priority | MED |
| Estimate | 1 hour |
| Status | PENDING |
| Dependencies | None |
| Output | `analysis/reuse_inventory.md` |

### Description

Tag every significant function as REUSABLE (can be extracted into a service/utility) or HARDCODED (tightly coupled, needs refactoring). Identify merge candidates.

### Steps

1. Audit each function for:
   - Dependency on global state (HARDCODED)
   - Pure input/output behavior (REUSABLE)
   - Mixed behavior (partial REUSABLE with refactoring notes)
2. Tag functions with classification
3. Identify merge candidates where multiple functions do the same thing with minor variations

### Known Merge Candidates

| Candidate | Description |
|-----------|-------------|
| `CompileVertexShader` + `CompileFragmentShader` | Merge into single `CompileShader(stage, source)` with stage parameter |
| `CreateVk*StateCreateInfo` functions | Multiple nearly-identical Vulkan state creation helpers; merge into parameterized factory |
| `setProjection` unification | Multiple projection-setting paths that should converge into one configurable function |

### Debug Checkpoints

```cpp
QuoteSystem::log("PHASE1", "Reuse audit: %d reusable, %d hardcoded, %d merge candidates", reusable, hardcoded, mergeCount);
DebugWindow::append("[1.5] Function inventory complete. Merge candidates: %d", mergeCount);
```

### Acceptance Criteria

- [ ] Every significant function tagged REUSABLE or HARDCODED
- [ ] All three known merge candidates documented
- [ ] Refactoring notes added for HARDCODED functions
- [ ] Output written to `analysis/reuse_inventory.md`

---

## Task 1.6: Produce Improvement Roadmap

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Estimate | 1 hour |
| Status | PENDING |
| Dependencies | Tasks 1.1, 1.2, 1.3, 1.4, 1.5 |
| Output | `analysis/roadmap.md` |

### Description

Synthesize findings from all previous analysis tasks into a prioritized improvement roadmap with time estimates, risk assessment, and a dependency graph.

### Steps

1. Prioritize improvements by impact and effort:
   - **Critical**: Blocking issues that prevent further development
   - **High**: Significant architectural improvements
   - **Medium**: Quality-of-life and maintainability improvements
   - **Low**: Nice-to-have polish items
2. Define execution order respecting dependencies
3. Estimate time for each improvement item
4. Identify risks:
   - Breaking changes to existing functionality
   - Performance regressions
   - Third-party dependency risks (Vulkan SDK version, wxWidgets version)
5. Create dependency graph showing which improvements must precede others

### Debug Checkpoints

```cpp
QuoteSystem::log("PHASE1", "Roadmap generated: %d items, %d critical, estimated %d hours", totalItems, criticalCount, totalHours);
DebugWindow::append("[1.6] Improvement roadmap finalized. Risk items: %d", riskCount);
```

### Acceptance Criteria

- [ ] All findings from Tasks 1.1-1.5 incorporated
- [ ] Items prioritized with clear rationale
- [ ] Time estimates provided for each item
- [ ] Risks identified with mitigation strategies
- [ ] Dependency graph included
- [ ] Output written to `analysis/roadmap.md`

---

## Phase 1 Summary

| Task | Priority | Estimate | Dependencies | Output |
|------|----------|----------|--------------|--------|
| 1.1 Map Project Structure | HIGH | 1 hr | None | `analysis/structure_map.md` |
| 1.2 Identify Rendering Pipeline Flow | HIGH | 2 hr | None | `analysis/pipeline_flow.md` |
| 1.3 Audit UI/UX Implementation | MED | 1.5 hr | None | `analysis/ui_audit.md` |
| 1.4 Detect Coupling Issues | HIGH | 1.5 hr | None | `analysis/coupling_report.md` |
| 1.5 Identify Reusable vs Hardcoded Logic | MED | 1 hr | None | `analysis/reuse_inventory.md` |
| 1.6 Produce Improvement Roadmap | HIGH | 1 hr | 1.1-1.5 | `analysis/roadmap.md` |

**Gate Rule:** All 6 tasks must reach COMPLETE status before Phases 2-5 can begin.
