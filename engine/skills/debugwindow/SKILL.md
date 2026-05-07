# Skill: DebugWindow Pipeline Monitor

## Overview

DebugWindow is a singleton providing categorized, channel-based debug output for all engine subsystems. It organizes diagnostic messages into named channels with severity levels so that output can be filtered, toggled, and reviewed per-subsystem.

## Quick Reference

### Access Singleton

```cpp
DebugWindow& debug = DebugWindow::Instance();
```

### Register and Post

```cpp
debug.RegisterChannel("Renderer");
debug.Post("Renderer", DebugLevel::INFO, "Swapchain created");
```

### CheckFileExists

```cpp
debug.CheckFileExists("shaders/vert.spv");
```

### PrintDashboard

```cpp
debug.PrintDashboard();
```

### ToggleChannel

```cpp
debug.ToggleChannel("Physics"); // Mute or unmute a channel
```

### PrintChannelHistory

```cpp
debug.PrintChannelHistory("Renderer", 50); // Last 50 messages from Renderer
```

## Debug Levels

| Level | Usage |
|-------|-------|
| `TRACE` | Fine-grained diagnostic detail, high volume |
| `INFO` | General status and progress messages |
| `WARN` | Non-fatal issues that may need attention |
| `ERR` | Failures that prevent an operation from completing |
| `CRITICAL` | Unrecoverable errors requiring immediate shutdown or fallback |

## Default Channels

The following channels are pre-registered by the engine:

- **Engine** -- Core engine lifecycle and initialization
- **Renderer** -- Vulkan/software rendering pipeline
- **FileSystem** -- File I/O, asset loading, path resolution
- **Shaders** -- Shader compilation, loading, and validation
- **UI** -- User interface events and layout
- **Input** -- Keyboard, mouse, and controller input
- **Audio** -- Audio subsystem and playback
- **Physics** -- Physics simulation and collision
- **Network** -- Network connections and data transfer

## Rules

1. **Every new subsystem must call `RegisterChannel`.** Before posting any messages, register a channel for the subsystem during its initialization.
2. **Every initialization routine must call `CheckFileExists`** for any required files (shaders, configs, assets) before attempting to load them.
3. **Use `ERR` for failures, not `WARN`.** If an operation cannot complete, post at `ERR` level. Reserve `WARN` for degraded-but-functional conditions.
4. **Call `PrintDashboard` at the end of initialization.** After all subsystems have initialized, print the dashboard to give a summary of channel status and recent activity.
