# RED TEAM REPORT: ForgePipeline Security & Stability Risks

**Date:** February 14, 2026
**Scope:** All attack surfaces for a local-first AI 3D generation tool

---

## SEVERITY LEVELS

- **CRITICAL:** Will cause data loss, crashes, or security breach in normal usage
- **HIGH:** Likely to occur, significant user impact
- **MEDIUM:** Possible under specific conditions
- **LOW:** Unlikely but worth documenting

---

## 1. VRAM EXHAUSTION (CRITICAL)

### 1.1 Simultaneous Model Loading
**Trigger:** Bug in sequential pipeline loads SDXL (8.5GB) + InstantMesh (6GB) simultaneously
**Impact:** CUDA OOM -> Python process crash -> generation lost -> no user feedback
**Probability:** HIGH (race conditions in async code are common)
**Mitigation:**
- Enforce single-model mutex in Python server
- Check `torch.cuda.memory_allocated()` before loading any model
- Hard limit: refuse to load if available VRAM < model size + 2GB buffer
- If OOM occurs: catch exception, unload all models, report to user

### 1.2 VRAM Fragmentation During Batch Processing
**Trigger:** Generate 50+ assets in sequence without process restart
**Impact:** Gradual VRAM fragmentation -> eventually OOM despite sufficient total VRAM
**Probability:** MEDIUM
**Mitigation:**
- Restart Python process every 20 generations (configurable)
- Call `torch.cuda.empty_cache()` + `gc.collect()` between each generation
- Monitor fragmentation via `torch.cuda.memory_stats()`

### 1.3 Large Input Image
**Trigger:** User uploads 8K+ resolution image
**Impact:** Preprocessing spikes VRAM during resize/encode
**Probability:** MEDIUM
**Mitigation:**
- Resize all inputs to max 2048x2048 before inference
- Validate image dimensions on upload, reject >4096x4096

### 1.4 External GPU Pressure
**Trigger:** User running other GPU apps (games, video editing, other AI tools)
**Impact:** Less VRAM available than expected
**Probability:** HIGH (users don't close other apps)
**Mitigation:**
- Query `torch.cuda.mem_get_info()` at startup and before each operation
- Warn user: "Close other GPU applications for best results"
- Graceful degradation: switch to CPU inference (slow but doesn't crash)

---

## 2. PROCESS MANAGEMENT (HIGH)

### 2.1 Python Subprocess Hang
**Trigger:** CUDA driver bug, deadlock in PyTorch, infinite loop in model inference
**Impact:** Generation queue blocked indefinitely, no user feedback
**Probability:** MEDIUM
**Mitigation:**
- 180-second timeout per generation operation
- Watchdog timer in Node.js: if no progress in 60 sec, kill and restart Python
- Report timeout to user with actionable message

### 2.2 Python Process Crash
**Trigger:** Segfault in CUDA, uncaught exception, OOM kill by OS
**Impact:** Generation fails, queue state inconsistent
**Probability:** MEDIUM
**Mitigation:**
- Auto-restart Python process on unexpected exit
- Queue state persisted in SQLite (survives process death)
- Mark in-progress generation as "failed" on restart

### 2.3 Orphaned Temp Files
**Trigger:** Crash during generation leaves temp images/meshes on disk
**Impact:** Disk space leak over time
**Probability:** HIGH
**Mitigation:**
- Temp files in dedicated directory with timestamps
- Cleanup on startup: delete anything older than 24 hours
- Cleanup between generations: delete inputs/outputs of completed jobs

### 2.4 Port Conflict
**Trigger:** Another service using port 8001 (Python server)
**Impact:** Python server fails to start, all generation fails
**Probability:** LOW
**Mitigation:**
- Try port range 8001-8010
- Report clear error: "Port 8001 in use, ForgePipeline cannot start"

---

## 3. DATA INTEGRITY (HIGH)

### 3.1 SQLite Corruption
**Trigger:** Process crash during write, power failure, disk full
**Impact:** Loss of project history, generation metadata
**Probability:** LOW (SQLite is crash-safe by design with WAL mode)
**Mitigation:**
- Use WAL (Write-Ahead Logging) mode
- Regular backup of database file (daily)
- Integrity check on startup: `PRAGMA integrity_check`
- If corrupt: start fresh, warn user, attempt recovery from WAL

### 3.2 Concurrent Database Access
**Trigger:** Web dashboard + CLI both writing to same SQLite file
**Impact:** SQLITE_BUSY errors, lost writes
**Probability:** MEDIUM
**Mitigation:**
- WAL mode allows concurrent reads
- Single writer with retry (busy_timeout = 5000ms)
- If persistent: queue writes through single Node.js process

### 3.3 Generated Mesh Corruption
**Trigger:** Disk full during mesh write, Python crash mid-write
**Impact:** Partial/corrupt .glb file saved to project
**Probability:** LOW
**Mitigation:**
- Write to temp file first, then atomic rename
- Validate mesh after generation (vertex count > 0, file size > 100 bytes)
- Never overwrite existing files without backup

---

## 4. SECURITY VULNERABILITIES (MEDIUM)

### 4.1 Path Traversal in Project Names
**Trigger:** User creates project named `../../etc/passwd` or `..\..\Windows\System32`
**Impact:** File operations outside project directory
**Probability:** LOW (deliberate attack)
**Mitigation:**
- Sanitize all user input: strip `../`, `..\\`, null bytes
- Use project IDs (UUIDs) for file paths, not user-provided names
- Validate resolved path starts with expected base directory

### 4.2 Prompt Injection via Generation Request
**Trigger:** Malicious prompt text passed to Python subprocess
**Impact:** If using `eval()` or `exec()` on user input: arbitrary code execution
**Probability:** LOW (if designed correctly)
**Mitigation:**
- NEVER eval/exec user input
- Pass prompts as JSON strings over HTTP, not command-line arguments
- Python server treats all prompts as opaque text strings

### 4.3 Malicious Model Files
**Trigger:** User downloads model from untrusted source, places in models directory
**Impact:** PyTorch pickle deserialization can execute arbitrary code
**Probability:** MEDIUM (common attack vector for AI models)
**Mitigation:**
- Only load .safetensors format (safe deserialization)
- SHA-256 hash verification against known-good values
- Quarantine directory for unverified models
- Safe mode: skip custom models, use built-in only

### 4.4 Web API Without Authentication
**Trigger:** BrightForge Express server exposed on network
**Impact:** Anyone on network can generate assets, access projects
**Probability:** MEDIUM (if user opens firewall)
**Mitigation:**
- Bind to 127.0.0.1 only (localhost)
- Add API key authentication for non-localhost access
- Rate limiting on generation endpoints

### 4.5 Sensitive Data in Logs
**Trigger:** Prompts, file paths, or system info logged to disk
**Impact:** Privacy leak if logs are shared or accessed
**Probability:** HIGH (logging is aggressive by design)
**Mitigation:**
- Never log full prompts in production mode
- Truncate logged data (first 50 chars of prompt)
- Log files in user-only directory (chmod 600 equivalent)

---

## 5. GPU DRIVER RISKS (MEDIUM)

### 5.1 TDR (Timeout Detection and Recovery)
**Trigger:** Single GPU operation takes >2 seconds
**Impact:** Windows kills GPU process, display flickers, all GPU state lost
**Probability:** MEDIUM (complex mesh generation can exceed 2 sec)
**Mitigation:**
- Document registry fix: increase TdrDelay to 30 seconds
- Include in setup wizard
- Detect TDR and report: "GPU operation timed out. See setup guide."

### 5.2 Driver Version Incompatibility
**Trigger:** User has old NVIDIA driver, or driver incompatible with CUDA version
**Impact:** Silent failures, garbled output, crashes
**Probability:** MEDIUM
**Mitigation:**
- Check driver version on startup via `nvidia-smi`
- Minimum version requirement in documentation
- Clear error: "NVIDIA driver 550+ required, you have 470"

### 5.3 Multi-GPU Confusion
**Trigger:** User has integrated GPU (Intel) + discrete GPU (NVIDIA)
**Impact:** PyTorch selects wrong GPU, inference fails or uses CPU
**Probability:** LOW (RTX 5080 users typically have it as primary)
**Mitigation:**
- Set `CUDA_VISIBLE_DEVICES=0` explicitly
- Log which GPU is selected on startup
- Allow user to configure GPU index in settings

---

## 6. USER EXPERIENCE RISKS (MEDIUM)

### 6.1 Model Download Failure
**Trigger:** Network drops during 7GB model download
**Impact:** Partial model file, subsequent load crash
**Probability:** HIGH
**Mitigation:**
- Resume-capable downloads (HTTP Range headers)
- Hash verification after download
- Progress bar with estimated time
- Retry with exponential backoff

### 6.2 First-Run Experience Failure
**Trigger:** Missing CUDA, wrong Python version, no GPU detected
**Impact:** User cannot generate anything, abandons tool
**Probability:** HIGH (environment setup is the #1 barrier)
**Mitigation:**
- Pre-flight check script that validates everything before first generation
- Clear, actionable error messages: "CUDA not found. Install from: [URL]"
- Fallback to CPU mode (slow but works)

### 6.3 Misleading Quality Expectations
**Trigger:** User expects "game-ready assets in seconds" based on marketing
**Impact:** Disappointment, negative reviews, abandonment
**Probability:** HIGH
**Mitigation:**
- Set expectations clearly: "Rapid 3D prototyping tool. Output requires post-processing for production use."
- Show example outputs with honest quality labels
- Include post-processing guidance in documentation

---

## 7. ARCHITECTURAL RISKS (LOW)

### 7.1 Node.js + Python IPC Overhead
**Trigger:** Every generation requires HTTP round-trip between processes
**Impact:** ~50ms overhead per request (negligible vs. 30-60 sec inference)
**Probability:** LOW (concern)
**Mitigation:** Accept the overhead. It's <0.1% of total generation time.

### 7.2 BrightForge Backward Compatibility
**Trigger:** New code breaks existing LLM coding features
**Impact:** Existing users lose functionality
**Probability:** LOW (if new code is additive, not modifying existing modules)
**Mitigation:**
- New routes under /api/forge3d (separate from /api/chat)
- New modules in src/forge3d/ (separate from src/core)
- Shared only: TelemetryBus, ErrorHandler, Express server

### 7.3 Single-Threaded Bottleneck
**Trigger:** Long-running mesh validation blocks Express event loop
**Impact:** Web dashboard becomes unresponsive during generation
**Probability:** MEDIUM
**Mitigation:**
- All heavy computation in Python subprocess (off main thread)
- Node.js only does HTTP routing, database, and queue management
- Use worker_threads for CPU-bound mesh validation if needed

---

## SUMMARY TABLE

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| VRAM Exhaustion | 1 | 1 | 2 | 0 |
| Process Management | 0 | 2 | 2 | 1 |
| Data Integrity | 0 | 1 | 1 | 1 |
| Security | 0 | 1 | 3 | 1 |
| GPU Drivers | 0 | 0 | 2 | 1 |
| User Experience | 0 | 2 | 1 | 0 |
| Architecture | 0 | 0 | 1 | 2 |
| **Total** | **1** | **7** | **12** | **6** |

**Total risks identified: 26**

The single CRITICAL risk (simultaneous model loading causing OOM) must be addressed in week 1 of implementation. The 7 HIGH risks should be addressed by the end of week 3. MEDIUM and LOW risks can be tracked as known issues for P1.
